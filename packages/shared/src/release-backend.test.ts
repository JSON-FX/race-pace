import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployBackend, verifyBackendEvidence } from '../../../scripts/release/backend.mjs';

const directories: string[] = [];
const STAGING = 'pepbmqomiailnnvvwupz';
const PRODUCTION = 'whaqarofxdlzxrelbcrq';
const FIRST = '20261001000000';
const SECOND = '20261002000000';
const bundle = 'a'.repeat(64);

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'release-backend-'));
  directories.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = async (path: string, text: string) => {
    await mkdir(join(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), text);
  };
  git('init', '-q');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release@example.invalid');
  await put('.gitignore', 'supabase/.temp/\n');
  await put('supabase/config.toml', '[functions.webhook]\nverify_jwt = false\n');
  await put(`supabase/migrations/${FIRST}_initial.sql`, 'create table example(id int);\n');
  await put('supabase/functions/deno.json', '{"imports":{"zod":"npm:zod@3.23.8"}}');
  await put('supabase/functions/_shared/common.ts', 'export const x = 1;');
  await put('supabase/functions/webhook/index.ts', 'export const handler = 1;');
  await put('supabase/functions/secure/index.ts', 'export const handler = 1;');
  await put('supabase/functions/fake-checkout/index.ts', 'export const localOnly = true;');
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  const cli: string[][] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const evidence: Record<string, unknown>[] = [];
  let versions = [FIRST];
  let target = STAGING;
  let identityOverride: string | undefined;
  let jwtOverride: boolean | undefined;
  let wrongLink = false;
  let pushNoop = false;
  let failCommand = false;
  let failFunction = '';
  let omitFunction = '';
  const deployedSlugs = new Set<string>();
  const execute = async (command: string, args: string[]) => {
    if (command === 'git') return execFileSync(command, args, { cwd, encoding: 'utf8' });
    cli.push(args);
    if (args.includes('--version')) return '2.109.1\n';
    if (failCommand || (args.includes('deploy') && args.includes(failFunction))) throw new Error('SUPER_SECRET_DB_URL');
    if (args.includes('link')) await put('supabase/.temp/project-ref', wrongLink ? PRODUCTION : target);
    if (args.includes('push') && !pushNoop) versions = [FIRST, SECOND];
    if (args.includes('deploy')) {
      const slug = args[args.indexOf('deploy') + 1];
      if (!slug || slug.startsWith('--')) throw new Error('Expected an explicit function slug');
      deployedSlugs.add(slug);
    }
    return '';
  };
  const fetchImpl = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    let body: unknown;
    if (url.endsWith('/database/query')) body = versions.map((version) => ({ version }));
    else if (url.endsWith('/functions')) body = ['secure', 'webhook', ...(target === STAGING ? ['fake-checkout'] : [])].filter((slug) => slug !== omitFunction).map((slug) => ({ slug, version: deployedSlugs.has(slug) ? 2 : 1, status: 'ACTIVE', verify_jwt: jwtOverride ?? slug !== 'webhook', ezbr_sha256: bundle }));
    else if (url.includes('/functions/')) {
      const slug = url.split('/').at(-1)!;
      body = { slug, version: 2, status: 'ACTIVE', verify_jwt: jwtOverride ?? slug !== 'webhook', ezbr_sha256: bundle };
    } else body = { ref: identityOverride ?? target, status: 'ACTIVE_HEALTHY' };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'test-token');
  vi.stubEnv('SUPABASE_DB_PASSWORD', 'test-password');
  const run = async (head: string, environment = 'staging', reconciliationRefs: string[] = []) => {
    target = environment === 'production' ? PRODUCTION : STAGING;
    return deployBackend({ environment, base, head, reconciliationRefs, cwd, execute, fetchImpl, onEvidence: async (value: Record<string, unknown>) => { evidence.push(value); } });
  };
  return { cwd, git, put, commit, base, cli, requests, evidence, execute, fetchImpl, run,
    history: (value: string[]) => { versions = value; },
    identity: (value: string) => { identityOverride = value; },
    jwt: (value: boolean) => { jwtOverride = value; },
    wrongLink: () => { wrongLink = true; },
    pushNoop: () => { pushNoop = true; },
    failCommand: () => { failCommand = true; },
    failFunction: (slug: string) => { failFunction = slug; },
    omitFunction: (slug: string) => { omitFunction = slug; },
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('backend release boundaries', () => {
  it('skips an app-only release without requesting secrets or hosted services', async () => {
    const f = await fixture();
    await f.put('apps/web/page.tsx', 'new UI');
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    vi.stubEnv('SUPABASE_DB_PASSWORD', '');
    expect(await f.run(f.commit())).toMatchObject({ skipped: true, projectRef: STAGING });
    expect(f.cli).toEqual([]);
    expect(f.requests).toEqual([]);
  });

  it('records complete read-only backend evidence for a hosted UI-only release', async () => {
    const f = await fixture();
    vi.stubEnv('REQUIRE_BACKEND_EVIDENCE', 'true');
    vi.stubEnv('SUPABASE_DB_PASSWORD', '');
    await f.put('apps/web/page.tsx', 'new UI');
    const result = await f.run(f.commit());
    expect(result).toMatchObject({ skipped: true, state: 'complete', migrationVersions: [FIRST], inventoryVerifiedAt: expect.any(String) });
    expect(result.functionInventory!.map((item: { slug: string }) => item.slug)).toEqual(['secure', 'webhook']);
    expect(result.functionInventory!.every((item: { deployedThisRelease: boolean; candidateSourceSha256: string }) => !item.deployedThisRelease && /^[a-f0-9]{64}$/.test(item.candidateSourceSha256))).toBe(true);
    expect(f.cli).toEqual([]);
    expect(f.requests.filter(({ init }) => init.method === 'POST').every(({ init }) => JSON.parse(String(init.body)).read_only)).toBe(true);
  });

  it('refuses hosted UI-only releases without backend credentials or complete function inventory', async () => {
    const f = await fixture();
    vi.stubEnv('REQUIRE_BACKEND_EVIDENCE', 'true');
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', '');
    await f.put('apps/web/page.tsx', 'new UI');
    const head = f.commit();
    await expect(f.run(head)).rejects.toThrow('Missing protected Supabase credentials');
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'test-token');
    f.omitFunction('secure');
    await expect(f.run(head)).rejects.toThrow('inventory is missing');
    expect(f.cli).toEqual([]);
  });

  it('rechecks approved backend evidence without executing deployment commands', async () => {
    const f = await fixture();
    vi.stubEnv('REQUIRE_BACKEND_EVIDENCE', 'true');
    await f.put('apps/web/page.tsx', 'new UI');
    const sha = f.commit();
    const backendEvidence = await f.run(sha);
    const record = { sha, base: f.base, backendEvidence, otherEvidence: 'preserved' };
    const rechecked = await verifyBackendEvidence({ environment: 'staging', record, fetchImpl: f.fetchImpl });
    expect(rechecked).toEqual({ ...record, backendRecheckedAt: expect.any(String) });
    expect(f.cli).toEqual([]);
    f.history([FIRST, SECOND]);
    await expect(verifyBackendEvidence({ environment: 'staging', record, fetchImpl: f.fetchImpl })).rejects.toThrow('migrations changed');
    f.history([FIRST]);
    f.jwt(true);
    await expect(verifyBackendEvidence({ environment: 'staging', record, fetchImpl: f.fetchImpl })).rejects.toThrow('functions changed');
  });

  it('rejects stale versions, hashes and mismatched evidence during approval recheck', async () => {
    const f = await fixture();
    vi.stubEnv('REQUIRE_BACKEND_EVIDENCE', 'true');
    await f.put('apps/web/page.tsx', 'new UI');
    const sha = f.commit();
    const backendEvidence = await f.run(sha);
    const record = { sha, base: f.base, backendEvidence };
    for (const patch of [{ version: 20 }, { bundleSha256: 'b'.repeat(64) }]) {
      const changed = structuredClone(record);
      const entry = changed.backendEvidence.functionInventory?.[0];
      if (!entry) throw new Error('Expected the fixture function inventory');
      Object.assign(entry, patch);
      await expect(verifyBackendEvidence({ environment: 'staging', record: changed, fetchImpl: f.fetchImpl })).rejects.toThrow('functions changed');
    }
    await expect(verifyBackendEvidence({ environment: 'production', record, fetchImpl: f.fetchImpl })).rejects.toThrow('Complete backend evidence');
    await expect(verifyBackendEvidence({ environment: 'staging', record: { ...record, sha: f.base }, fetchImpl: f.fetchImpl })).rejects.toThrow('Complete backend evidence');
    await expect(verifyBackendEvidence({ environment: 'staging', record: { ...record, backendEvidence: { ...backendEvidence, state: 'failed' } }, fetchImpl: f.fetchImpl })).rejects.toThrow('Complete backend evidence');
  });

  it('deploys only the changed function with its JWT setting and pinned bundle evidence', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    const result = await f.run(f.commit());
    expect(f.cli.filter((args) => args.includes('deploy'))).toEqual([['exec', 'supabase', 'functions', 'deploy', 'webhook', '--project-ref', STAGING, '--use-api', '--import-map', 'supabase/functions/deno.json', '--no-verify-jwt']]);
    expect(result.functions).toEqual([{ slug: 'webhook', version: 2, verifyJwt: false, bundleSha256: bundle, sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/), verifiedAt: expect.any(String) }]);
    expect(f.cli.some((args) => args.includes('link') || args.includes('push'))).toBe(false);
    expect(f.requests.every(({ url }) => url.startsWith(`https://api.supabase.com/v1/projects/${STAGING}`))).toBe(true);
  });

  it('selects hosted functions for shared changes but never deploys fake-checkout', async () => {
    const f = await fixture();
    await f.put('supabase/functions/_shared/common.ts', 'export const x = 2;');
    const result = await f.run(f.commit(), 'production');
    expect(result.functions.map((fn: { slug: string }) => fn.slug)).toEqual(['secure', 'webhook']);
    expect(result.excludedFunctions).toEqual(['fake-checkout']);
    expect(f.cli.filter((args) => args.includes('deploy')).every((args) => args.includes(PRODUCTION))).toBe(true);
  });

  it('redeploys reverted function changes left by a rejected staging candidate', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    const rejected = f.commit();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 1;');
    const head = f.commit();
    expect(f.git('diff', '--name-only', f.base, head)).toBe('');
    const result = await f.run(head, 'staging', [rejected]);
    expect(result.reconciliationRefs).toEqual([rejected]);
    expect(result.functions.map((item) => item.slug)).toEqual(['webhook']);
  });

  it('reconciles older partial attempts even if the latest attempt matches production', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    const firstAttempt = f.commit();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 1;');
    await f.put('supabase/functions/secure/index.ts', 'export const handler = 2;');
    const secondAttempt = f.commit();
    await f.put('supabase/functions/secure/index.ts', 'export const handler = 1;');
    const latestAttempt = f.commit();
    await f.put('apps/web/page.tsx', 'new UI');
    const result = await f.run(f.commit(), 'staging', [latestAttempt, secondAttempt, firstAttempt]);
    expect(result.functions.map((item) => item.slug)).toEqual(['secure', 'webhook']);
    expect(result.newMigrationVersions).toEqual([]);
  });

  it.each(['supabase/functions/_shared/common.ts', 'supabase/functions/deno.json'])('reconciles every hosted function after a reverted shared input: %s', async (path) => {
    const f = await fixture();
    const original = await readFile(join(f.cwd, path), 'utf8');
    await f.put(path, path.endsWith('.json') ? '{"imports":{"zod":"npm:zod@3.23.9"}}' : 'export const x = 2;');
    const rejected = f.commit();
    await f.put(path, original);
    const result = await f.run(f.commit(), 'staging', [rejected]);
    expect(result.functions.map((item) => item.slug)).toEqual(['secure', 'webhook']);
    expect(result.excludedFunctions).toEqual(['fake-checkout']);
  });

  it('does not treat a reverted staged migration as permission to remove hosted history', async () => {
    const f = await fixture();
    vi.stubEnv('REQUIRE_BACKEND_EVIDENCE', 'true');
    const path = `supabase/migrations/${SECOND}_additive.sql`;
    await f.put(path, 'select 1;');
    const rejected = f.commit();
    await rm(join(f.cwd, path));
    f.history([FIRST, SECOND]);
    await expect(f.run(f.commit(), 'staging', [rejected])).rejects.toThrow('Hosted migration history differs');
    expect(f.cli).toEqual([]);
  });

  it('rejects removal of a function that a previous attempt could have deployed', async () => {
    const f = await fixture();
    await f.put('supabase/functions/temporary/index.ts', 'export const handler = 1;');
    const rejected = f.commit();
    await rm(join(f.cwd, 'supabase/functions/temporary'), { recursive: true });
    await expect(f.run(f.commit(), 'staging', [rejected])).rejects.toThrow('Function removal from a previous attempt');
    expect(f.requests).toEqual([]);
  });

  it('rejects malformed and non-ancestor reconciliation refs before contacting hosted services', async () => {
    const f = await fixture();
    await f.put('apps/web/page.tsx', 'new UI');
    const head = f.commit();
    for (const ref of ['main', '--all', head.slice(0, 7)]) {
      await expect(f.run(head, 'staging', [ref])).rejects.toThrow('full commit SHAs');
    }
    f.git('checkout', '-q', '-b', 'other-candidate', f.base);
    await f.put('apps/web/page.tsx', 'other UI');
    const divergent = f.commit();
    f.git('checkout', '-q', head);
    await expect(f.run(head, 'staging', [divergent])).rejects.toThrow('ancestors');
    expect(f.requests).toEqual([]);
  });

  it('checks migration history before and after an additive push without seeds or roles', async () => {
    const f = await fixture();
    await f.put(`supabase/migrations/${SECOND}_additive.sql`, 'alter table example add column name text;');
    const result = await f.run(f.commit());
    expect(result.migrationVersions).toEqual([FIRST, SECOND]);
    expect(result.newMigrationVersions).toEqual([SECOND]);
    expect(result.migrations.every((entry: { sha256: string }) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
    expect(f.cli).toContainEqual(['exec', 'supabase', 'link', '--project-ref', STAGING, '--yes']);
    expect(f.cli).toContainEqual(['exec', 'supabase', 'db', 'push', '--linked', '--yes']);
    for (const { init } of f.requests.filter(({ url }) => url.endsWith('/database/query'))) {
      expect(JSON.parse(String(init.body))).toEqual({ query: 'select version from supabase_migrations.schema_migrations order by version', read_only: true });
    }
  });

  it('accepts an already-applied candidate migration without pushing it again', async () => {
    const f = await fixture();
    await f.put(`supabase/migrations/${SECOND}_additive.sql`, 'alter table example add column name text;');
    f.history([FIRST, SECOND]);
    expect((await f.run(f.commit())).skipped).toBe(false);
    expect(f.cli.some((args) => args.includes('push') || args.includes('link'))).toBe(false);
  });

  it.each(['supabase/config.toml', 'supabase/templates/production-invite.html', 'supabase/functions/.env.example', 'supabase/seed.sql'])('refuses manual configuration changes: %s', async (path) => {
    const f = await fixture();
    await f.put(path, 'changed');
    await expect(f.run(f.commit())).rejects.toThrow('manual operation');
    expect(f.requests).toEqual([]);
  });

  it.each(['edit', 'delete', 'rename'])('refuses %s of an existing migration', async (operation) => {
    const f = await fixture();
    const path = `supabase/migrations/${FIRST}_initial.sql`;
    if (operation === 'edit') await f.put(path, 'select 1;');
    else if (operation === 'delete') await rm(join(f.cwd, path));
    else f.git('mv', path, `supabase/migrations/${FIRST}_renamed.sql`);
    await expect(f.run(f.commit())).rejects.toThrow('Existing migration');
    expect(f.requests).toEqual([]);
  });

  it('rejects removed functions before hosted writes', async () => {
    const f = await fixture();
    await rm(join(f.cwd, 'supabase/functions/webhook'), { recursive: true });
    await expect(f.run(f.commit())).rejects.toThrow('Function removal');
  });

  it('rejects mutable function dependencies before hosted writes', async () => {
    const f = await fixture();
    await f.put('supabase/functions/deno.json', '{"imports":{"supabase":"npm:@supabase/supabase-js@2"}}');
    await expect(f.run(f.commit())).rejects.toThrow('not pinned');
    expect(f.requests).toEqual([]);
  });

  it.each([[], [FIRST, '20261003000000']])('rejects incomplete or unknown remote migration history: %j', async (...args) => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    f.history(args as string[]);
    await expect(f.run(f.commit())).rejects.toThrow('Hosted migration history');
    expect(f.cli.some((command) => command.includes('deploy') || command.includes('push'))).toBe(false);
  });

  it('rejects wrong project identity and incorrect linked project', async () => {
    const f = await fixture();
    await f.put(`supabase/migrations/${SECOND}_additive.sql`, 'select 1;');
    const head = f.commit();
    f.identity(PRODUCTION);
    await expect(f.run(head)).rejects.toThrow('project identity');
    f.identity(STAGING);
    f.wrongLink();
    await expect(f.run(head)).rejects.toThrow('Linked database project');
    expect(f.cli.some((command) => command.includes('push'))).toBe(false);
  });

  it('blocks successful command with missing migration readback', async () => {
    const f = await fixture();
    await f.put(`supabase/migrations/${SECOND}_additive.sql`, 'select 1;');
    f.pushNoop();
    await expect(f.run(f.commit())).rejects.toThrow('migration readback');
    expect(f.evidence.at(-1)).toMatchObject({ state: 'failed', failedPhase: 'verifying-migrations', migrationPushStartedAt: expect.any(String), migrationPushCompletedAt: expect.any(String) });
  });

  it('persists migrations and the first deployed function when a later function fails', async () => {
    const f = await fixture();
    await f.put(`supabase/migrations/${SECOND}_additive.sql`, 'select 1;');
    await f.put('supabase/functions/_shared/common.ts', 'export const x = 2;');
    f.failFunction('webhook');
    await expect(f.run(f.commit())).rejects.toThrow('Supabase command failed');
    expect(f.evidence.at(-1)).toMatchObject({
      state: 'failed', failedPhase: 'deploying-function', failedAt: expect.any(String),
      migrationVersions: [FIRST, SECOND], migrationsVerifiedAt: expect.any(String),
      functions: [{ slug: 'secure', version: 2, bundleSha256: bundle, verifiedAt: expect.any(String) }],
      activeFunction: { slug: 'webhook', previousVersion: 1, startedAt: expect.any(String) },
    });
    expect(f.evidence.some((item) => item.state === 'applying-migrations')).toBe(true);
    expect(f.evidence.some((item) => item.state === 'verifying-function')).toBe(true);
    expect(JSON.stringify(f.evidence)).not.toContain('SUPER_SECRET');
  });

  it('blocks incorrect JWT readback after deployment', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    f.jwt(true);
    await expect(f.run(f.commit())).rejects.toThrow('JWT readback');
  });

  it('never forwards credential-bearing command errors', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    f.failCommand();
    await expect(f.run(f.commit())).rejects.toThrow('Supabase command failed');
    await expect(f.run(f.git('rev-parse', 'HEAD'))).rejects.not.toThrow('SUPER_SECRET');
  });

  it('rejects checkout mismatch and dirty backend files', async () => {
    const f = await fixture();
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 2;');
    const head = f.commit();
    await expect(f.run(f.base)).rejects.toThrow('Checkout does not match');
    await f.put('supabase/functions/webhook/index.ts', 'export const handler = 3;');
    await expect(f.run(head)).rejects.toThrow('uncommitted inputs');
  });

  it('requires full SHAs and known environments', async () => {
    const f = await fixture();
    await expect(f.run(f.base, 'preview')).rejects.toThrow('Expected staging or production');
    await expect(f.run(f.base.slice(0, 7))).rejects.toThrow('full base/head');
    expect(await readFile(join(f.cwd, 'supabase/config.toml'), 'utf8')).toContain('verify_jwt = false');
  });
});
