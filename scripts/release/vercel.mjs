import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export const TEAM_ID = 'team_Qe3LT6XuLJTBQwgGPExcP0iY';
export const PROJECTS = {
  site: 'prj_Si8MyVid5X7zxDGQyjrqc2YOlMtJ',
  web: 'prj_ADA1ewsz8MXpJptnOnKLxfAWkOTa',
};
export const ENVIRONMENTS = {
  staging: { project: 'pepbmqomiailnnvvwupz', site: 'staging.racepace.com.ph', web: 'staging-admin.racepace.com.ph' },
  production: { project: 'whaqarofxdlzxrelbcrq', site: 'www.racepace.com.ph', web: 'admin.racepace.com.ph' },
};
const runFile = promisify(execFile);

async function execute(command, args, options) {
  try {
    const result = await runFile(command, args, { ...options, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout;
  } catch {
    // CLI output can contain pulled configuration or credentials. Never serialize it.
    throw new Error(`${command} failed during release; inspect the provider dashboard`);
  }
}

function validate(manifest, environment) {
  if (!ENVIRONMENTS[environment]) throw new Error('Unknown release environment');
  if (!/^[a-f0-9]{40}$/.test(manifest.sha ?? '')) throw new Error('A full source SHA is required');
  if (!Array.isArray(manifest.apps) || new Set(manifest.apps).size !== manifest.apps.length ||
      manifest.apps.some(app => !Object.hasOwn(PROJECTS, app))) throw new Error('Invalid app selection');
}

export function validateEnvironment(text, environment) {
  const expected = ENVIRONMENTS[environment];
  if (!expected) throw new Error('Unknown release environment');
  const env = parseEnv(text);
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${expected.project}.supabase.co` ||
      env.NEXT_PUBLIC_SITE_URL !== `https://${expected.site}` ||
      !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || Object.hasOwn(env, 'SUPABASE_INTERNAL_URL')) {
    throw new Error('Vercel build configuration does not match the release environment');
  }
  // A digest binds configuration without publishing values. Deployment-specific values
  // cannot distinguish a config change from a different build of identical settings.
  const stable = Object.entries(env).filter(([key]) => !key.startsWith('VERCEL_') && key !== 'NEXT_PUBLIC_RELEASE_SHA');
  stable.sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function context(options) {
  const { environment, execute: run = execute, fetchImpl = fetch, cwd = process.cwd(),
    onEvidence = async () => {}, prepareSource = archiveSource, ...manifest } = options;
  validate(manifest, environment);
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is required');
  return { environment, run, fetchImpl, cwd, onEvidence, prepareSource, token,
    manifest: structuredClone(manifest), customEnvironmentIds: {} };
}

async function api(ctx, path) {
  const response = await ctx.fetchImpl(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM_ID}`, {
    headers: { Authorization: `Bearer ${ctx.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Vercel readback failed (${response.status})`);
  return response.json();
}

async function customEnvironmentId(ctx, app) {
  if (ctx.environment !== 'staging') return undefined;
  if (!ctx.customEnvironmentIds[app]) {
    const response = await api(ctx, `/v9/projects/${PROJECTS[app]}/custom-environments`);
    const matches = Array.isArray(response.environments)
      ? response.environments.filter(value => value?.slug === 'staging') : [];
    if (matches.length !== 1 || typeof matches[0].id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(matches[0].id)) {
      throw new Error(`Missing or ambiguous staging environment for ${app}`);
    }
    ctx.customEnvironmentIds[app] = matches[0].id;
  }
  return ctx.customEnvironmentIds[app];
}

export function assertDeployment(deployment, { app, environment, sha, id, customEnvironmentId: expectedEnvironmentId }) {
  // GetDeployment may include only the custom environment ID. Resolve its slug
  // through the owning project's API; a missing slug must not mean production.
  const matchesEnvironment = environment === 'staging'
    ? typeof expectedEnvironmentId === 'string' && deployment.customEnvironment?.id === expectedEnvironmentId &&
      (deployment.customEnvironment.slug === undefined || deployment.customEnvironment.slug === 'staging') && deployment.target !== 'production'
    : environment === 'production' && deployment.target === 'production' && deployment.customEnvironment == null;
  if (deployment.id !== id || deployment.projectId !== PROJECTS[app] || deployment.readyState !== 'READY' ||
      !matchesEnvironment || deployment.meta?.releaseSha !== sha ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? '')) {
    throw new Error(`Deployment identity mismatch for ${app}`);
  }
  return deployment;
}

async function lookup(ctx, app, id, sha) {
  if (!/^dpl_[a-zA-Z0-9]+$/.test(id ?? '')) throw new Error('Invalid deployment ID');
  const deployment = await api(ctx, `/v13/deployments/${id}`);
  return assertDeployment(deployment, { app, environment: ctx.environment, sha, id,
    customEnvironmentId: await customEnvironmentId(ctx, app) });
}

async function aliasId(ctx, app) {
  const alias = await api(ctx, `/v4/aliases/${ENVIRONMENTS[ctx.environment][app]}`);
  const id = alias.deploymentId ?? alias.deployment?.id;
  if (alias.projectId !== PROJECTS[app] || !/^dpl_[a-zA-Z0-9]+$/.test(id ?? '')) {
    throw new Error(`Alias ownership mismatch for ${app}`);
  }
  return id;
}

export async function smokeApp({ app, environment, sha, url, fetchImpl = fetch }) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      !(parsed.hostname === ENVIRONMENTS[environment]?.[app] || /^[a-z0-9-]+\.vercel\.app$/.test(parsed.hostname))) {
    throw new Error('Invalid smoke-check origin');
  }
  const secret = process.env[`VERCEL_AUTOMATION_BYPASS_SECRET_${app.toUpperCase()}`];
  const headers = secret ? { 'x-vercel-protection-bypass': secret } : {};
  for (const path of ['/api/release', app === 'site' ? '/sign-in' : '/login']) {
    const response = await fetchImpl(new URL(path, url), {
      headers, redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store',
    });
    if (response.status !== 200) throw new Error(`HTTP smoke check failed for ${app} ${path}`);
    if (path === '/api/release') {
      const release = await response.json();
      if (release.sha !== sha || release.app !== app || release.supabaseProject !== ENVIRONMENTS[environment].project) {
        throw new Error(`HTTP release identity mismatch for ${app}`);
      }
    }
  }
}

async function archiveSource(ctx, directory) {
  const archive = join(directory, 'source.tar');
  await ctx.run('git', ['archive', '--format=tar', `--output=${archive}`, ctx.manifest.sha], { cwd: ctx.cwd });
  await ctx.run('tar', ['-xf', archive, '-C', directory], { cwd: ctx.cwd });
  await rm(archive);
}

async function cli(ctx, app, args, cwd = ctx.cwd, buildEnv = {}) {
  const env = { ...process.env, ...buildEnv };
  // A caller's public env must never override the pulled target configuration.
  for (const key of Object.keys(env)) {
    if ((key.startsWith('NEXT_PUBLIC_') || key === 'SUPABASE_INTERNAL_URL') && !Object.hasOwn(buildEnv, key)) delete env[key];
  }
  return ctx.run('pnpm', ['dlx', 'vercel@59.3.0', ...args, '--token', ctx.token], {
    cwd, env: { ...env, VERCEL_ORG_ID: TEAM_ID, VERCEL_PROJECT_ID: PROJECTS[app], NEXT_PUBLIC_RELEASE_SHA: ctx.manifest.sha },
  });
}

async function persist(ctx) {
  await ctx.onEvidence(structuredClone(ctx.manifest));
}

export async function deployApps(options) {
  const ctx = context(options);
  ctx.manifest.deployments ??= {};
  const priorIds = {};
  for (const app of Object.keys(PROJECTS)) {
    const targetId = await customEnvironmentId(ctx, app);
    priorIds[app] = await aliasId(ctx, app);
    const expected = ctx.manifest.previous?.deployments?.[app];
    if (expected?.environment === ctx.environment && expected.id !== priorIds[app]) {
      throw new Error(`Live alias differs from the previous release record for ${app}`);
    }
    if (!ctx.manifest.apps.includes(app)) {
      const current = await api(ctx, `/v13/deployments/${priorIds[app]}`);
      const oldSha = current.meta?.releaseSha;
      assertDeployment(current, { app, environment: ctx.environment, sha: oldSha, id: priorIds[app], customEnvironmentId: targetId });
      ctx.manifest.deployments[app] = { id: current.id, url: `https://${current.url}`,
        projectId: PROJECTS[app], environment: ctx.environment, sha: oldSha ?? null,
        ...(targetId ? { customEnvironmentId: targetId } : {}),
        previousId: current.id, skipped: true, state: 'unchanged' };
    }
  }
  await persist(ctx);
  for (const app of ctx.manifest.apps) {
    const previousId = priorIds[app];
    const directory = await mkdtemp(join(tmpdir(), `race-pace-${app}-`));
    try {
      // Separate full archives keep monorepo resolution and project roots while
      // preventing one project's .vercel output from being deployed to the other.
      await ctx.prepareSource(ctx, directory);
      await cli(ctx, app, ['pull', '--yes', `--environment=${ctx.environment}`], directory);
      const project = JSON.parse(await readFile(join(directory, '.vercel', 'project.json'), 'utf8'));
      if (project.projectId !== PROJECTS[app] || project.orgId !== TEAM_ID ||
          project.settings?.rootDirectory !== `apps/${app}` || project.settings?.framework !== 'nextjs') {
        throw new Error(`Vercel project build settings mismatch for ${app}`);
      }
      const settingsDigest = createHash('sha256').update(JSON.stringify(project.settings)).digest('hex');
      const envPath = join(directory, '.vercel', `.env.${ctx.environment}.local`);
      const text = await readFile(envPath, 'utf8');
      const configDigest = validateEnvironment(text, ctx.environment);
      await writeFile(envPath, `${text}\nNEXT_PUBLIC_RELEASE_SHA="${ctx.manifest.sha}"\n`, { mode: 0o600 });
      ctx.manifest.deployments[app] = { environment: ctx.environment, sha: ctx.manifest.sha,
        ...(ctx.environment === 'staging' ? { customEnvironmentId: await customEnvironmentId(ctx, app) } : {}),
        projectId: PROJECTS[app], configDigest, settingsDigest, previousId, state: 'building' };
      await persist(ctx);
      await cli(ctx, app, ['build', ...(ctx.environment === 'production' ? ['--prod'] : ['--target=staging'])], directory, parseEnv(text));
      ctx.manifest.deployments[app].state = 'deploying';
      await persist(ctx);
      const output = await cli(ctx, app, ['deploy', '--prebuilt', '--yes', '--json', '--meta', `releaseSha=${ctx.manifest.sha}`,
        ...(ctx.environment === 'production' ? ['--prod', '--skip-domain'] : ['--target=staging'])], directory);
      const parsed = JSON.parse(output);
      const result = parsed.deployment ?? parsed;
      const url = result.url;
      if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(url)) throw new Error('Unexpected deployment URL');
      // Persist the returned URL before readback, so failed inspection is recoverable.
      Object.assign(ctx.manifest.deployments[app], { url, id: result.id, state: 'inspecting' });
      await persist(ctx);
      const deployment = await lookup(ctx, app, result.id, ctx.manifest.sha);
      if (deployment.url !== new URL(url).hostname) throw new Error('Deployment URL readback mismatch');
      Object.assign(ctx.manifest.deployments[app], { id: deployment.id, state: 'deployed' });
      await persist(ctx);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  await persist(ctx);
  return ctx.manifest;
}

function entryFor(ctx, app) {
  const entry = ctx.manifest.deployments?.[app];
  if (!entry || entry.environment !== ctx.environment || entry.sha !== ctx.manifest.sha || entry.projectId !== PROJECTS[app]) {
    throw new Error(`Missing matching deployment evidence for ${app}`);
  }
  return entry;
}

async function verifyCandidate(ctx, app, entry) {
  if (ctx.environment === 'staging' && entry.customEnvironmentId !== await customEnvironmentId(ctx, app)) {
    throw new Error(`Staging environment changed since deployment for ${app}`);
  }
  const deployment = await lookup(ctx, app, entry.id, ctx.manifest.sha);
  if (entry.url !== `https://${deployment.url}`) throw new Error('Candidate URL mismatch');
  await smokeApp({ app, environment: ctx.environment, sha: ctx.manifest.sha, url: entry.url, fetchImpl: ctx.fetchImpl });
}

export async function verifyApps(options) {
  const ctx = context(options);
  for (const app of Object.keys(PROJECTS).filter(app => !ctx.manifest.apps.includes(app))) {
    const entry = ctx.manifest.deployments?.[app];
    if (!entry?.skipped || entry.environment !== ctx.environment || entry.projectId !== PROJECTS[app]) {
      throw new Error(`Missing unchanged app evidence for ${app}`);
    }
    const deployment = await api(ctx, `/v13/deployments/${entry.id}`);
    const targetId = await customEnvironmentId(ctx, app);
    if (ctx.environment === 'staging' && entry.customEnvironmentId !== targetId) throw new Error(`Staging environment changed for ${app}`);
    assertDeployment(deployment, { app, environment: ctx.environment, sha: entry.sha ?? undefined, id: entry.id, customEnvironmentId: targetId });
    if (await aliasId(ctx, app) !== entry.id) throw new Error(`Unchanged alias drift for ${app}`);
    entry.aliasVerifiedAt = new Date().toISOString();
    await persist(ctx);
  }
  for (const app of ctx.manifest.apps) {
    const entry = entryFor(ctx, app);
    await verifyCandidate(ctx, app, entry);
    if (ctx.environment === 'staging' || entry.promotedAt) {
      if (await aliasId(ctx, app) !== entry.id) throw new Error(`Alias does not point to candidate for ${app}`);
      await smokeApp({ app, environment: ctx.environment, sha: ctx.manifest.sha,
        url: `https://${ENVIRONMENTS[ctx.environment][app]}`, fetchImpl: ctx.fetchImpl });
      entry.aliasVerifiedAt = new Date().toISOString();
    }
    entry.verifiedAt = new Date().toISOString();
    await persist(ctx);
  }
  await persist(ctx);
  return ctx.manifest;
}

export async function promoteApps(options) {
  const ctx = context(options);
  if (ctx.environment !== 'production') throw new Error('Only production candidates need promotion');
  // Check every candidate before touching either project's public domains.
  for (const app of ctx.manifest.apps) {
    const entry = entryFor(ctx, app);
    if (!entry.verifiedAt) throw new Error('Candidate verification is required before promotion');
    await verifyCandidate(ctx, app, entry);
    if (await aliasId(ctx, app) !== entry.previousId) throw new Error('Production alias changed since candidate creation');
  }
  for (const app of ctx.manifest.apps) {
    const entry = entryFor(ctx, app);
    entry.state = 'promoting';
    await persist(ctx);
    await cli(ctx, app, ['promote', entry.id, '--yes']);
    entry.promotedAt = new Date().toISOString();
    entry.state = 'promoted';
    await persist(ctx);
    if (await aliasId(ctx, app) !== entry.id) throw new Error(`Promotion alias mismatch for ${app}`);
  }
  await persist(ctx);
  return ctx.manifest;
}

export async function rollbackApps(options) {
  const ctx = context(options);
  if (ctx.environment !== 'production') throw new Error('Rollback requires production evidence');
  for (const app of ctx.manifest.apps) {
    const entry = entryFor(ctx, app);
    const currentId = await aliasId(ctx, app);
    if (currentId === entry.previousId) continue;
    if (currentId !== entry.id) throw new Error('Refusing rollback over an unrelated release');
    const previous = await api(ctx, `/v13/deployments/${entry.previousId}`);
    // Older bootstrap deployments may have no releaseSha metadata. Their exact
    // IDs and ownership still must match the evidence captured before rollout.
    if (previous.id !== entry.previousId || previous.projectId !== PROJECTS[app] ||
        previous.target !== 'production' || previous.customEnvironment != null || previous.readyState !== 'READY') throw new Error('Invalid rollback deployment');
    entry.state = 'rolling-back';
    await persist(ctx);
    await cli(ctx, app, ['rollback', entry.previousId, '--yes']);
    if (await aliasId(ctx, app) !== entry.previousId) throw new Error(`Rollback alias mismatch for ${app}`);
    entry.state = 'rolled-back';
    entry.rolledBackAt = new Date().toISOString();
    await persist(ctx);
  }
  await persist(ctx);
  return ctx.manifest;
}

async function main() {
  const [command, environment, input, output] = process.argv.slice(2);
  const commands = { deploy: deployApps, verify: verifyApps, promote: promoteApps, rollback: rollbackApps };
  if (!commands[command] || !input || !output) throw new Error('Usage: vercel.mjs deploy|verify|promote|rollback ENV MANIFEST OUTPUT');
  const manifest = JSON.parse(await readFile(input, 'utf8'));
  await commands[command]({ ...manifest, environment, onEvidence: async evidence => {
    const path = resolve(output);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(`${path}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
