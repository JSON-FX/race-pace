import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'JSON-FX/race-pace';
export const ENVIRONMENTS = { staging: 'release-staging', production: 'release-production' };
export const VERCEL_TEAM = 'team_Qe3LT6XuLJTBQwgGPExcP0iY';
export const PROJECTS = { site: 'prj_Si8MyVid5X7zxDGQyjrqc2YOlMtJ', web: 'prj_ADA1ewsz8MXpJptnOnKLxfAWkOTa' };
const shaPattern = /^[a-f0-9]{40}$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export const requireSha = value => { requireValue(shaPattern.test(value ?? ''), 'Expected a full Git commit SHA.'); return value; };

export function classifyRelease(paths) {
  const apps = new Set();
  let backend = false;
  const manual = [];
  for (const path of paths) {
    if (path.startsWith('apps/site/')) apps.add('site');
    else if (path.startsWith('apps/web/')) apps.add('web');
    else if (path.startsWith('supabase/')) {
      if (path.startsWith('supabase/functions/') || path.startsWith('supabase/migrations/')) backend = true;
      else if (!path.startsWith('supabase/tests/')) manual.push(path);
      // Schema/functions can change contracts and rendered pages in both applications.
      if (backend || manual.length) { apps.add('site'); apps.add('web'); }
    } else if (/^(docs\/|\.claude\/|README\.md$|AGENTS\.md$|apps\/mobile\/)/.test(path)) {
      // These paths have no deployable hosted app output. CI owns their validation rules.
    } else if (/^(test\/|vitest\.config\.|scripts\/ci-)/.test(path)) {
      // Validation-only changes do not require new application deployments.
    } else {
      // Unknown build inputs fail conservatively, including packages, lockfiles and workflows.
      apps.add('site'); apps.add('web');
    }
  }
  return { apps: [...apps].sort(), backend, manual, deploy: apps.size > 0 || backend || manual.length > 0 };
}

/** Include every possibly mutated revision until the last proven complete environment. */
export function selectReconciliationRefs(records, ignoreContext) {
  const refs = [];
  let hasBaseline = false;
  for (const item of records) {
    const record = item.payload.record;
    if (ignoreContext && String(record.runId) === String(ignoreContext.runId) && String(record.attempt) === String(ignoreContext.attempt)) continue;
    const sha = requireSha(record.sha);
    if (!refs.includes(sha)) refs.push(sha);
    if (item.payload.phase === 'complete' && item.successful === true) {
      hasBaseline = true;
      break;
    }
  }
  return { refs, hasBaseline };
}

export function classifyReconciledRelease(productionPaths, reconciliationPaths, stagingHasBaseline) {
  const paths = [...new Set([...productionPaths, ...reconciliationPaths])].sort();
  const scope = classifyRelease(paths);
  if (!stagingHasBaseline) { scope.apps = ['site', 'web']; scope.deploy = true; }
  return { ...scope, paths };
}

export function assertTrustedRun(run, sha, workflowId) {
  requireSha(sha);
  requireValue(run.head_sha === sha && run.head_branch === 'main', 'CI must validate this exact main revision.');
  requireValue(run.event === 'push' && run.conclusion === 'success' && run.status === 'completed', 'A successful completed main-push CI run is required.');
  requireValue(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, 'Foreign or fork CI results cannot authorize releases.');
  requireValue(run.workflow_id === workflowId, 'CI run belongs to the wrong workflow.');
}

export function assertApprovalEnvironment(value, branchPolicies) {
  const rules = value.protection_rules ?? [];
  const reviewers = rules.find(rule => rule.type === 'required_reviewers')?.reviewers ?? [];
  requireValue(reviewers.length > 0 && reviewers.every(item => item.type === 'User' && item.reviewer?.login === 'JSON-FX'), 'Release approval must be restricted to the owner JSON-FX.');
  requireValue(value.can_admins_bypass === false, 'Disable administrator bypass for release approvals.');
  requireValue(value.deployment_branch_policy?.custom_branch_policies === true, 'Release environments require an exact main branch policy.');
  requireValue(branchPolicies.length === 1 && branchPolicies[0].name === 'main' && branchPolicies[0].type === 'branch', 'Only the main branch may use protected release environments.');
}

export function assertManifest(record, context) {
  requireValue(record.schema === 1 && record.repository === REPOSITORY, 'Unknown release record.');
  requireSha(record.sha); requireSha(record.base);
  requireValue(record.sha === context.sha, 'Artifact does not match the checked-out candidate.');
  requireValue(String(record.runId) === String(context.runId) && String(record.attempt) === String(context.attempt), 'Artifact is from another workflow run or attempt.');
  requireValue(record.tree === context.tree, 'Candidate source tree changed.');
  requireValue(Array.isArray(record.apps) && record.apps.every(app => Object.hasOwn(PROJECTS, app)), 'Invalid application scope.');
}

export function assertCompletedEvidence(environment, record) {
  const backend = record.backendEvidence;
  const project = environment === 'staging' ? 'pepbmqomiailnnvvwupz' : 'whaqarofxdlzxrelbcrq';
  requireValue(backend?.state === 'complete' && backend.environment === environment && backend.projectRef === project && backend.head === record.sha && backend.base === record.base, 'Backend completion evidence is missing or mismatched.');
  requireValue(Array.isArray(backend.migrationVersions) && Array.isArray(backend.functionInventory) && backend.inventoryVerifiedAt, 'Live backend inventory is required.');
  for (const app of Object.keys(PROJECTS)) {
    const item = record.deployments?.[app];
    requireValue(item?.aliasVerifiedAt && item.projectId === PROJECTS[app] && item.environment === environment && /^dpl_[a-zA-Z0-9]+$/.test(item.id ?? ''), 'Both app aliases must have matching deployment evidence.');
    if (record.apps.includes(app)) {
      requireValue(item.verifiedAt && item.sha === record.sha, 'Candidate deployment evidence is missing or mismatched.');
      if (environment === 'production') requireValue(item.promotedAt && !item.rolledBackAt, 'Production app has not been promoted successfully.');
    } else requireValue(item.skipped === true, 'Missing unchanged-app evidence.');
  }
}

async function github(path, { method = 'GET', body } = {}) {
  requireValue(process.env.GH_TOKEN, 'GH_TOKEN is required.');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  requireValue(response.ok, `GitHub ${method} ${path.split('?')[0]} failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}

export async function protectionCheck() {
  for (const name of [ENVIRONMENTS.production]) {
    const value = await github(`environments/${name}`);
    const policies = await github(`environments/${name}/deployment-branch-policies?per_page=100`);
    assertApprovalEnvironment(value, policies.branch_policies ?? []);
  }
}

async function ledger(environment) {
  const records = [];
  for (let page = 1; ; page++) {
    const values = await github(`deployments?environment=${ENVIRONMENTS[environment]}&task=release%3Aoption-b&per_page=100&page=${page}`);
    records.push(...values.filter(value => value.payload?.schema === 1 && value.payload?.record?.repository === REPOSITORY));
    if (values.length < 100) break;
    requireValue(page < 100, 'Release ledger is too large; archive or paginate with an audited baseline.');
  }
  return records;
}

async function reconciliationState(ignoreContext) {
  const refs = {};
  const trusted = {};
  for (const environment of ['staging', 'production']) {
    const considered = [];
    for (const item of await ledger(environment)) {
      const record = item.payload.record;
      if (ignoreContext && String(record.runId) === String(ignoreContext.runId) && String(record.attempt) === String(ignoreContext.attempt)) continue;
      let successful = false;
      if (item.payload.phase === 'complete') {
        const statuses = await github(`deployments/${item.id}/statuses?per_page=100`);
        successful = statuses.some(status => status.state === 'success');
      }
      considered.push({ ...item, successful });
      if (successful) break;
    }
    const result = selectReconciliationRefs(considered);
    refs[environment] = result.refs;
    trusted[environment] = result.hasBaseline;
  }
  return { refs, trusted };
}

function ancestor(base, head) {
  requireSha(base); requireSha(head);
  try { execFileSync('git', ['merge-base', '--is-ancestor', base, head], { stdio: 'ignore' }); }
  catch { throw new Error('Release candidate predates or diverges from deployed source.'); }
}

async function productionBaseline() {
  const records = await ledger('production');
  for (const item of records) {
    const statuses = await github(`deployments/${item.id}/statuses?per_page=100`);
    // A completed success may later be marked inactive by GitHub; it remains a valid baseline.
    if (statuses.some(status => status.state === 'success') && item.payload.phase === 'complete') return item.payload.record;
  }
  const bootstrap = requireSha(process.env.RELEASE_BOOTSTRAP_SHA);
  requireValue(records.every(item => item.payload.record.base === bootstrap), 'Bootstrap baseline changed after a production attempt. Recover the existing release first.');
  return { sha: bootstrap, bootstrap: true };
}

async function assertMonotonic(sha) {
  for (const environment of ['staging', 'production']) {
    const records = await ledger(environment);
    if (records[0]) ancestor(records[0].payload.record.sha, sha);
  }
}

export async function prepare(sha, ciRunId) {
  requireValue(process.env.OPTION_B_ENABLED === 'true', 'Option B is not activated.');
  requireValue(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main', 'Release orchestration must run from main in the owning repository.');
  requireSha(sha);
  requireValue(/^\d+$/.test(String(ciRunId)), 'Expected a CI run ID.');
  const workflow = await github('actions/workflows/ci.yml');
  assertTrustedRun(await github(`actions/runs/${ciRunId}`), sha, workflow.id);
  requireValue(git('rev-parse', 'HEAD') === sha, 'Checkout must match the successful CI source.');
  ancestor(sha, git('rev-parse', 'origin/main'));
  // workflow_run executes the default-branch definition, not necessarily the candidate definition.
  const workflowSha = requireSha(process.env.GITHUB_WORKFLOW_SHA);
  requireValue(git('diff', '--name-only', sha, workflowSha, '--', '.github/workflows/release.yml', 'scripts/release') === '', 'Release controller changed since candidate validation; validate a current main candidate.');
  await protectionCheck();
  const previous = await productionBaseline();
  ancestor(previous.sha, sha);
  await assertMonotonic(sha);
  const reconciliation = await reconciliationState();
  const changedSince = revision => git('diff', '--name-only', '--no-renames', '-z', revision, sha).split('\0').filter(Boolean);
  const productionPaths = changedSince(previous.sha);
  const reconciliationPaths = [];
  for (const revision of new Set(Object.values(reconciliation.refs).flat())) {
    ancestor(revision, sha);
    reconciliationPaths.push(...changedSince(revision));
  }
  const scope = classifyReconciledRelease(productionPaths, reconciliationPaths, reconciliation.trusted.staging);
  // Bootstrap establishes deployment markers for both apps even if only workflow/docs changed.
  if (previous.bootstrap) { scope.apps = ['site', 'web']; scope.deploy = true; }
  requireValue(scope.manual.length === 0, `Hosted configuration requires an explicit release procedure: ${scope.manual.join(', ')}`);
  return {
    schema: 1, repository: REPOSITORY, sha, tree: git('rev-parse', 'HEAD^{tree}'), base: previous.sha,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, ciRunId: String(ciRunId),
    lockfileSha256: digest(readFileSync('pnpm-lock.yaml')), controllerSha: workflowSha,
    ...scope, productionPaths, reconciliationRefs: reconciliation.refs,
    reconciliationTrusted: reconciliation.trusted, previous, createdAt: new Date().toISOString(),
  };
}

export async function guard(record) {
  assertManifest(record, { sha: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
  requireValue(process.env.OPTION_B_ENABLED === 'true', 'Option B was deactivated.');
  requireValue(record.lockfileSha256 === digest(readFileSync('pnpm-lock.yaml')), 'Candidate dependencies changed.');
  await protectionCheck();
  await assertMonotonic(record.sha);
  const baseline = await productionBaseline();
  requireValue(baseline.sha === record.base, 'Production changed since planning. Start a fresh release.');
  const reconciliation = await reconciliationState({ runId: record.runId, attempt: record.attempt });
  requireValue(JSON.stringify(reconciliation.refs) === JSON.stringify(record.reconciliationRefs) &&
    JSON.stringify(reconciliation.trusted) === JSON.stringify(record.reconciliationTrusted),
  'Environment release history changed since planning. Start a fresh release.');
}

export async function assertVercelCutover() {
  requireValue(process.env.VERCEL_TOKEN, 'VERCEL_TOKEN is required.');
  for (const [app, id] of Object.entries(PROJECTS)) {
    const response = await fetch(`https://api.vercel.com/v9/projects/${id}?teamId=${VERCEL_TEAM}`, {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    requireValue(response.ok, `Cannot inspect Vercel project ${app} (${response.status}).`);
    const project = await response.json();
    requireValue(project.id === id && project.accountId === VERCEL_TEAM && project.rootDirectory === `apps/${app}`, 'Vercel project identity/root mismatch.');
    // Disconnecting Git is the smallest verifiable cutover. PR previews may later use a separate job.
    requireValue(!project.link, `Disconnect Vercel Git auto-deploys for ${app} before activating Option B.`);
  }
}

export async function recordDeployment(environment, record, phase) {
  requireValue(['staging', 'production'].includes(environment), 'Unknown release environment.');
  requireValue(['started', 'complete', 'failed'].includes(phase), 'Unknown release phase.');
  if (phase === 'complete') assertCompletedEvidence(environment, record);
  // Summarize the previous baseline rather than nesting every historical record in the payload.
  const compact = { ...record, previous: { sha: record.previous?.sha, deployments: record.previous?.deployments } };
  const deployment = await github('deployments', { method: 'POST', body: {
    ref: record.sha, task: 'release:option-b', auto_merge: false, required_contexts: [],
    environment: ENVIRONMENTS[environment], production_environment: environment === 'production',
    description: `Option B ${environment} ${phase}`, payload: { schema: 1, phase, record: compact },
  } });
  await github(`deployments/${deployment.id}/statuses`, { method: 'POST', body: {
    state: phase === 'complete' ? 'success' : phase === 'failed' ? 'failure' : 'in_progress', auto_inactive: false,
    log_url: `https://github.com/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  } });
  return deployment.id;
}

function summary(record) {
  return `## Candidate ${record.sha}\n\n- CI run: ${record.ciRunId}\n- Production baseline: ${record.base}\n- Apps: ${record.apps.join(', ') || 'unchanged'}\n- Backend changes: ${record.backend}\n- Workflow run/attempt: ${record.runId}/${record.attempt}\n\nInspect the JSON evidence artifact before approval. Hosted smoke checks do not replace affected business-flow acceptance. Production checks must not create data or perform payments.\n`;
}

async function main([command, ...args]) {
  if (command === 'prepare') {
    const record = await prepare(args[0], args[1]); writeFileSync(args[2], JSON.stringify(record, null, 2));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${record.sha}\nbase=${record.base}\ndeploy=${record.deploy}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(record));
  } else if (command === 'guard') await guard(JSON.parse(readFileSync(args[0], 'utf8')));
  else if (command === 'cutover') await assertVercelCutover();
  else if (command === 'record') await recordDeployment(args[0], JSON.parse(readFileSync(args[1], 'utf8')), args[2]);
  else if (command === 'record-failure') {
    const [environment, directory] = args;
    const names = environment === 'production'
      ? ['production-checked.json', 'production-promoted.json', 'production-verified.json', 'production-apps.json', 'plan.json']
      : ['verified.json', 'apps.json', 'plan.json'];
    const input = names.map(name => join(directory, name)).find(existsSync);
    requireValue(input, 'No candidate evidence exists for the failed attempt.');
    const record = JSON.parse(readFileSync(input, 'utf8'));
    const backend = join(directory, environment === 'production' ? 'production-backend.json' : 'backend.json');
    if (existsSync(backend)) record.backendEvidence = JSON.parse(readFileSync(backend, 'utf8'));
    writeFileSync(join(directory, `${environment}-failure.json`), JSON.stringify(record, null, 2));
    await recordDeployment(environment, record, 'failed');
  }
  else if (command === 'assemble') {
    const [plan, backend, apps, output] = args;
    const record = { ...JSON.parse(readFileSync(plan, 'utf8')), ...JSON.parse(readFileSync(apps, 'utf8')), backendEvidence: JSON.parse(readFileSync(backend, 'utf8')) };
    writeFileSync(output, JSON.stringify(record, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(record));
  } else throw new Error('Usage: control.mjs prepare SHA CI_RUN OUTPUT | guard FILE | cutover | record ENV FILE PHASE | assemble PLAN BACKEND APPS OUTPUT');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
