import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const PROJECTS = { staging: 'pepbmqomiailnnvvwupz', production: 'whaqarofxdlzxrelbcrq' };
// This local payment simulator was deliberately removed from production in September 2026.
const LOCAL_FUNCTIONS = new Set(['fake-checkout']);
const SHA = /^[a-f0-9]{40}$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const splitNull = (value) => value.split('\0').filter(Boolean);

async function defaultExecute(command, args, options) {
  return (await runFile(command, args, { ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
}

function migrationPaths(paths) {
  const migrations = paths.filter((path) => path.startsWith('supabase/migrations/'));
  const versions = new Set();
  for (const path of migrations) {
    const match = /^supabase\/migrations\/(\d{14})_[\w-]+\.sql$/.exec(path);
    if (!match || versions.has(match[1])) throw new Error('Invalid or duplicate migration version; reconcile migration files manually.');
    versions.add(match[1]);
  }
  return migrations.sort();
}

function functionSlugs(paths) {
  return [...new Set(paths.map((path) => /^supabase\/functions\/([a-z][a-z0-9-]*)\/index\.ts$/.exec(path)?.[1]).filter(Boolean))].sort();
}

function jwtSettings(config) {
  // Only the boolean setting is needed. Reject unsupported syntax rather than guessing its value.
  const settings = new Map();
  let section = '';
  for (const raw of config.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line.startsWith('[')) { section = line; continue; }
    if (!section.startsWith('[functions.') || !line || line.startsWith('#')) continue;
    const match = /^\[functions\.([a-z][a-z0-9-]*)\]$/.exec(section);
    if (!match) throw new Error('Unsupported function configuration; review the backend deployment helper.');
    if (/^verify_jwt\s*=/.test(line)) {
      const value = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
      if (!value || settings.has(match[1])) throw new Error('Invalid or duplicate function JWT setting.');
      settings.set(match[1], value[1] === 'true');
    } else {
      throw new Error('Function configuration beyond verify_jwt requires manual deployment review.');
    }
  }
  return settings;
}

function assertPinnedImports(sources) {
  for (const source of sources) {
    for (const match of source.matchAll(/["'](npm:[^"']+)["']/g)) {
      if (!/^npm:(?:@[^/]+\/)?[^@/]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\/[^\s]*)?$/.test(match[1])) {
        throw new Error('Function dependency is not pinned. Commit exact npm versions and dependency evidence before releasing functions.');
      }
    }
    if (/(?:from\s*|import\s*\(?\s*)["'](?:https?:|jsr:)/.test(source)) {
      throw new Error('Remote function imports need an immutable dependency review before automated deployment.');
    }
  }
}

function managementApi(projectRef, token, fetchImpl) {
  return async (path, body) => {
    let response;
    try {
      response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
    } catch { throw new Error('Supabase readback request failed.'); }
    if (!response.ok) throw new Error(`Supabase readback failed (HTTP ${response.status}).`);
    try { return await response.json(); } catch { throw new Error('Invalid Supabase readback response.'); }
  };
}

/** Recheck a staged record after approval without linking, bundling or deploying anything. */
export async function verifyBackendEvidence({ environment, record, fetchImpl = fetch }) {
  const projectRef = Object.hasOwn(PROJECTS, environment) ? PROJECTS[environment] : undefined;
  const evidence = record?.backendEvidence;
  if (!projectRef || !evidence || evidence.environment !== environment || evidence.projectRef !== projectRef || evidence.state !== 'complete' || !SHA.test(record.sha ?? '') || !SHA.test(record.base ?? '') || evidence.head !== record.sha || evidence.base !== record.base || !Array.isArray(evidence.migrationVersions) || !Array.isArray(evidence.functionInventory)) {
    throw new Error('Complete backend evidence for this source and environment is required.');
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Missing protected Supabase read-only credentials.');
  const api = managementApi(projectRef, token, fetchImpl);
  const identity = await api('');
  if (identity.ref !== projectRef || identity.status !== 'ACTIVE_HEALTHY') throw new Error('Supabase project identity or health does not match the target.');
  const rows = await api('/database/query', { query: 'select version from supabase_migrations.schema_migrations order by version', read_only: true });
  const validVersions = (values) => Array.isArray(values) && values.every((value) => typeof value === 'string' && /^\d{14}$/.test(value)) && new Set(values).size === values.length;
  const currentVersions = Array.isArray(rows) ? rows.map((row) => row.version) : null;
  if (!validVersions(currentVersions) || !validVersions(evidence.migrationVersions) || JSON.stringify([...currentVersions].sort()) !== JSON.stringify([...evidence.migrationVersions].sort())) {
    throw new Error('Hosted migrations changed after staging acceptance.');
  }
  const inventory = await api('/functions');
  if (!Array.isArray(inventory) || inventory.some((item) => !item || item.status !== 'ACTIVE') || (environment === 'production' && inventory.some((item) => LOCAL_FUNCTIONS.has(item.slug)))) {
    throw new Error('Hosted function status changed after staging acceptance.');
  }
  const canonical = (values) => {
    if (values.some((item) => typeof item.slug !== 'string' || !Number.isSafeInteger(item.version) || item.version < 1 || typeof item.verifyJwt !== 'boolean' || !/^[a-f0-9]{64}$/.test(item.bundleSha256 ?? '')) || new Set(values.map((item) => item.slug)).size !== values.length) {
      throw new Error('Invalid function evidence during hosted recheck.');
    }
    return values.map(({ slug, version, verifyJwt, bundleSha256 }) => ({ slug, version, verifyJwt, bundleSha256 })).sort((left, right) => left.slug.localeCompare(right.slug));
  };
  const current = inventory.filter((item) => !LOCAL_FUNCTIONS.has(item.slug)).map((item) => ({ slug: item.slug, version: item.version, verifyJwt: item.verify_jwt, bundleSha256: item.ezbr_sha256 }));
  if (JSON.stringify(canonical(current)) !== JSON.stringify(canonical(evidence.functionInventory))) throw new Error('Hosted functions changed after staging acceptance.');
  return { ...record, backendRecheckedAt: new Date().toISOString() };
}

/** Deploy from an exact checkout. The caller owns protected environment approval and release serialization. */
export async function deployBackend({ environment, base, head, reconciliationRefs = [], cwd = process.cwd(), execute = defaultExecute, fetchImpl = fetch, onEvidence = async () => {} }) {
  const requireEvidence = process.env.REQUIRE_BACKEND_EVIDENCE === 'true';
  const projectRef = Object.hasOwn(PROJECTS, environment) ? PROJECTS[environment] : undefined;
  if (!projectRef || !SHA.test(base ?? '') || !SHA.test(head ?? '')) throw new Error('Expected staging or production and full base/head commit SHAs.');
  if (!Array.isArray(reconciliationRefs) || reconciliationRefs.some((ref) => typeof ref !== 'string' || !SHA.test(ref))) throw new Error('Reconciliation refs must be an array of full commit SHAs.');
  const reconciledRefs = [...new Set(reconciliationRefs)];
  const command = async (binary, args) => {
    try {
      const result = await execute(binary, args, { cwd, env: process.env });
      return typeof result === 'string' ? result : result.stdout;
    } catch {
      // CLI errors can contain passwords, database URLs and provider responses. Never forward them.
      throw new Error(binary === 'git' ? 'Pinned Git source check failed.' : 'Supabase command failed; inspect protected logs without publishing credentials.');
    }
  };
  const git = (...args) => command('git', args);
  if ((await git('rev-parse', 'HEAD')).trim() !== head) throw new Error('Checkout does not match the pinned candidate.');
  await git('merge-base', '--is-ancestor', base, head);
  const changed = splitNull(await git('diff', '--name-only', '--no-renames', '-z', base, head));
  const functionChanges = new Set(changed.filter((path) => path.startsWith('supabase/functions/')));
  for (const ref of reconciledRefs) {
    try { await git('merge-base', '--is-ancestor', ref, head); }
    catch { throw new Error('Reconciliation refs must be ancestors of the pinned candidate.'); }
    for (const path of splitNull(await git('diff', '--name-only', '--no-renames', '-z', ref, head, '--', 'supabase/functions'))) functionChanges.add(path);
  }
  // A rejected or partial attempt may leave functions ahead of the production baseline.
  // Reconcile every attempted source, including changes subsequently reverted on main.
  const backendChanges = [...new Set([...changed.filter((path) => path.startsWith('supabase/')), ...functionChanges])];
  const manual = backendChanges.filter((path) => !path.startsWith('supabase/migrations/') && !path.startsWith('supabase/functions/') && !path.startsWith('supabase/tests/') && !/\/(?:README|AGENTS)\.md$/.test(path));
  if (manual.length || backendChanges.some((path) => /(?:^|\/)\.env(?:\.|$)/.test(path))) {
    throw new Error('Backend config, Auth templates, secrets, seeds or provider files changed. Complete a reviewed environment-specific manual operation and reconcile baseline evidence before retrying.');
  }
  const evidence = { environment, projectRef, base, head, reconciliationRefs: reconciledRefs, skipped: true, migrations: [], functions: [], excludedFunctions: [], state: 'skipped' };
  const persist = async () => {
    evidence.updatedAt = new Date().toISOString();
    await onEvidence(structuredClone(evidence));
  };
  if (!requireEvidence && !backendChanges.some((path) => /^supabase\/(migrations|functions)\//.test(path))) { await persist(); return evidence; }
  if ((await git('status', '--porcelain', '--untracked-files=all', '--', 'supabase')).trim()) {
    throw new Error('Backend checkout contains uncommitted inputs; use the exact clean candidate.');
  }
  const list = async (revision) => {
    const entries = splitNull(await git('ls-tree', '-r', '-z', revision, '--', 'supabase'));
    if (entries.some((entry) => !entry.startsWith('100644 ') && !entry.startsWith('100755 '))) throw new Error('Backend symlinks or submodules require manual review.');
    return entries.map((entry) => entry.slice(entry.indexOf('\t') + 1));
  };
  const before = await list(base);
  const after = await list(head);
  const oldMigrations = migrationPaths(before);
  const allMigrations = migrationPaths(after);
  if (oldMigrations.some((path) => changed.includes(path))) throw new Error('Existing migration edited, renamed or removed; create a new forward migration.');
  const newMigrations = allMigrations.filter((path) => !oldMigrations.includes(path));
  if (newMigrations.some((path) => path <= (oldMigrations.at(-1) ?? ''))) throw new Error('New migration versions must follow the baseline history.');
  const oldFunctions = functionSlugs(before);
  const allFunctions = functionSlugs(after);
  if (oldFunctions.some((slug) => !allFunctions.includes(slug))) throw new Error('Function removal requires an explicit manual retirement plan.');
  for (const ref of reconciledRefs) {
    if (functionSlugs(await list(ref)).some((slug) => !allFunctions.includes(slug))) throw new Error('Function removal from a previous attempt requires an explicit manual retirement plan.');
  }
  const sharedChanged = backendChanges.some((path) => path.startsWith('supabase/functions/') && !allFunctions.some((slug) => path.startsWith(`supabase/functions/${slug}/`)));
  const selected = allFunctions.filter((slug) => sharedChanged || backendChanges.some((path) => path.startsWith(`supabase/functions/${slug}/`)));
  evidence.excludedFunctions = selected.filter((slug) => LOCAL_FUNCTIONS.has(slug));
  const deploySlugs = selected.filter((slug) => !LOCAL_FUNCTIONS.has(slug));
  const hasChanges = newMigrations.length > 0 || deploySlugs.length > 0;
  if (!requireEvidence && !hasChanges) { await persist(); return evidence; }

  const sources = new Map();
  for (const path of after.filter((path) => path.startsWith('supabase/functions/') || path === 'supabase/config.toml' || allMigrations.includes(path))) {
    sources.set(path, await readFile(resolve(cwd, path), 'utf8'));
  }
  const config = sources.get('supabase/config.toml');
  if (!config) throw new Error('Missing pinned Supabase configuration.');
  const settings = deploySlugs.length || requireEvidence ? jwtSettings(config) : new Map();
  const sourceDigest = (slug) => {
    const entries = [...sources].filter(([path]) => path === 'supabase/config.toml' || path.startsWith('supabase/functions/_shared/') || path.startsWith(`supabase/functions/${slug}/`) || /^supabase\/functions\/[^/]+$/.test(path)).sort(([a], [b]) => a.localeCompare(b));
    return hash(JSON.stringify(entries));
  };
  if (deploySlugs.length) {
    if (!sources.has('supabase/functions/deno.json')) throw new Error('Missing pinned function import map.');
    const importMap = JSON.parse(sources.get('supabase/functions/deno.json'));
    if (Object.values(importMap.imports ?? {}).some((value) => typeof value !== 'string' || /^(https?:|jsr:)/.test(value))) throw new Error('Function import map needs immutable dependency review.');
    assertPinnedImports([...sources].filter(([path]) => path.startsWith('supabase/functions/')).map(([, source]) => source));
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token || (newMigrations.length && !process.env.SUPABASE_DB_PASSWORD)) throw new Error('Missing protected Supabase credentials for this environment.');
  if (hasChanges && (await command('pnpm', ['exec', 'supabase', '--version'])).trim() !== '2.109.1') throw new Error('Expected Supabase CLI 2.109.1.');

  const api = managementApi(projectRef, token, fetchImpl);
  const identity = await api('');
  if (identity.ref !== projectRef || identity.status !== 'ACTIVE_HEALTHY') throw new Error('Supabase project identity or health does not match the target.');
  const history = async () => {
    const rows = await api('/database/query', { query: 'select version from supabase_migrations.schema_migrations order by version', read_only: true });
    if (!Array.isArray(rows) || rows.some((row) => typeof row.version !== 'string' || !/^\d{14}$/.test(row.version))) throw new Error('Malformed hosted migration history.');
    const versions = rows.map((row) => row.version).sort();
    if (new Set(versions).size !== versions.length) throw new Error('Duplicate hosted migration versions.');
    return versions;
  };
  const expectedVersions = allMigrations.map((path) => path.split('/').at(-1).slice(0, 14));
  const existingVersions = await history();
  if (existingVersions.length < oldMigrations.length || existingVersions.some((version, index) => expectedVersions[index] !== version)) {
    throw new Error('Hosted migration history differs from the reviewed candidate or lacks baseline migrations. Reconcile manually.');
  }
  if (!newMigrations.length && existingVersions.length !== expectedVersions.length) throw new Error('Hosted migrations are incomplete.');
  evidence.migrations = allMigrations.map((path) => ({ path, version: path.split('/').at(-1).slice(0, 14), sha256: hash(sources.get(path)) }));
  evidence.newMigrationVersions = newMigrations.map((path) => path.split('/').at(-1).slice(0, 14));
  const deployedBefore = deploySlugs.length || requireEvidence ? await api('/functions') : [];
  if (!Array.isArray(deployedBefore) || deployedBefore.some((item) => typeof item.slug !== 'string' || !Number.isSafeInteger(item.version) || item.version < 1) || new Set(deployedBefore.map((item) => item.slug)).size !== deployedBefore.length) {
    throw new Error('Malformed hosted function list.');
  }
  evidence.skipped = !hasChanges;
  evidence.migrationVersionsBefore = existingVersions;
  evidence.state = 'prepared';
  await persist();
  try {
    if (newMigrations.length && existingVersions.length < expectedVersions.length) {
      await command('pnpm', ['exec', 'supabase', 'link', '--project-ref', projectRef, '--yes']);
      const linked = (await readFile(resolve(cwd, 'supabase/.temp/project-ref'), 'utf8')).trim();
      if (linked !== projectRef) throw new Error('Linked database project does not match the target.');
      evidence.state = 'applying-migrations';
      evidence.migrationPushStartedAt = new Date().toISOString();
      await persist();
      await command('pnpm', ['exec', 'supabase', 'db', 'push', '--linked', '--yes']);
      evidence.migrationPushCompletedAt = new Date().toISOString();
    }
    evidence.state = 'verifying-migrations';
    await persist();
    if (JSON.stringify(await history()) !== JSON.stringify(expectedVersions)) throw new Error('Hosted migration readback does not match the complete candidate history.');
    evidence.migrationVersions = expectedVersions;
    evidence.migrationsVerifiedAt = new Date().toISOString();
    await persist();
    for (const slug of deploySlugs) {
      const verifyJwt = settings.get(slug) ?? true;
      const sourceSha256 = sourceDigest(slug);
      const previous = deployedBefore.find((item) => item.slug === slug);
      evidence.state = 'deploying-function';
      evidence.activeFunction = { slug, sourceSha256, verifyJwt, previousVersion: previous?.version ?? null, startedAt: new Date().toISOString() };
      await persist();
      const args = ['exec', 'supabase', 'functions', 'deploy', slug, '--project-ref', projectRef, '--use-api', '--import-map', 'supabase/functions/deno.json'];
      if (!verifyJwt) args.push('--no-verify-jwt');
      await command('pnpm', args);
      evidence.state = 'verifying-function';
      evidence.activeFunction.commandCompletedAt = new Date().toISOString();
      await persist();
      const deployed = await api(`/functions/${slug}`);
      if (deployed.slug !== slug || deployed.status !== 'ACTIVE' || deployed.verify_jwt !== verifyJwt || !Number.isSafeInteger(deployed.version) || deployed.version < 1 || (previous && deployed.version <= previous.version)) {
        throw new Error('Function version, status or JWT readback failed; stop promotion and inspect the target.');
      }
      if (!/^[a-f0-9]{64}$/.test(deployed.ezbr_sha256 ?? '')) throw new Error('Function bundle digest is missing from hosted readback.');
      evidence.functions.push({ slug, sourceSha256, version: deployed.version, verifyJwt, bundleSha256: deployed.ezbr_sha256, verifiedAt: new Date().toISOString() });
      delete evidence.activeFunction;
      evidence.state = 'function-verified';
      await persist();
    }
    if (requireEvidence) {
      evidence.state = 'verifying-function-inventory';
      await persist();
      const inventory = await api('/functions');
      const expectedSlugs = allFunctions.filter((slug) => !LOCAL_FUNCTIONS.has(slug));
      if (!Array.isArray(inventory) || new Set(inventory.map((item) => item.slug)).size !== inventory.length || inventory.some((item) => !expectedSlugs.includes(item.slug) && (!LOCAL_FUNCTIONS.has(item.slug) || environment === 'production'))) {
        throw new Error('Hosted function inventory differs from the candidate; reconcile unknown or duplicate functions manually.');
      }
      evidence.functionInventory = expectedSlugs.map((slug) => {
        const item = inventory.find((entry) => entry.slug === slug);
        if (!item || item.status !== 'ACTIVE' || item.verify_jwt !== (settings.get(slug) ?? true) || !Number.isSafeInteger(item.version) || item.version < 1 || !/^[a-f0-9]{64}$/.test(item.ezbr_sha256 ?? '')) {
          throw new Error('Hosted function inventory is missing a function or its expected status, JWT setting or bundle digest.');
        }
        const deployed = evidence.functions.find((entry) => entry.slug === slug);
        if (deployed && (deployed.version !== item.version || deployed.bundleSha256 !== item.ezbr_sha256)) throw new Error('Function changed after deployment verification.');
        // This source hash describes candidate inputs, not proof that an unchanged hosted bundle came from them.
        return { slug, version: item.version, verifyJwt: item.verify_jwt, bundleSha256: item.ezbr_sha256, candidateSourceSha256: sourceDigest(slug), deployedThisRelease: Boolean(deployed) };
      });
      evidence.inventoryVerifiedAt = new Date().toISOString();
    }
    evidence.state = 'complete';
    evidence.completedAt = new Date().toISOString();
    await persist();
    return evidence;
  } catch (error) {
    evidence.failedPhase = evidence.state;
    evidence.state = 'failed';
    evidence.failedAt = new Date().toISOString();
    await persist();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const output = args.at(-1);
    const persist = async (evidence) => {
      const destination = resolve(output);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await writeFile(`${destination}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      await rename(`${destination}.tmp`, destination);
    };
    if (!output || args.length !== 4) throw new Error('Usage: backend.mjs staging|production BASE HEAD OUTPUT | verify ENV RECORD OUTPUT');
    if (args[0] === 'verify') {
      const [, environment, input] = args;
      await persist(await verifyBackendEvidence({ environment, record: JSON.parse(await readFile(input, 'utf8')) }));
    } else {
      const [environment, base, head] = args;
      let reconciliationRefs;
      try { reconciliationRefs = JSON.parse(process.env.RELEASE_RECONCILIATION_REFS ?? '[]'); }
      catch { throw new Error('RELEASE_RECONCILIATION_REFS must be a JSON array of full commit SHAs.'); }
      await deployBackend({ environment, base, head, reconciliationRefs, onEvidence: persist });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
