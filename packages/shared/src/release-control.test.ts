import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Release tooling uses Node ESM without adding a second test runner.
import { assertApprovalEnvironment, assertCompletedEvidence, assertManifest, assertTrustedRun, classifyRelease, classifyReconciledRelease, selectReconciliationRefs, requireSha } from '../../../scripts/release/control.mjs';

const sha = 'a'.repeat(40);
describe('release scope', () => {
  it('deploys only admin for admin UI edits', () => expect(classifyRelease(['apps/web/components/Sidebar.tsx']).apps).toEqual(['web']));
  it('selects both apps for shared and unknown inputs', () => {
    for (const path of ['packages/ui/button.tsx', 'pnpm-lock.yaml', 'new-build-input.json', '.github/workflows/release.yml']) expect(classifyRelease([path]).apps).toEqual(['site', 'web']);
  });
  it('skips documentation-only releases', () => expect(classifyRelease(['docs/README.md', 'AGENTS.md']).deploy).toBe(false));
  it('includes backend changes and forces manual configuration review', () => {
    expect(classifyRelease(['supabase/functions/payments-webhook/index.ts'])).toMatchObject({ backend: true, apps: ['site','web'] });
    expect(classifyRelease(['supabase/config.toml']).manual).toEqual(['supabase/config.toml']);
  });
  it('does not confuse backend validation with deployment', () => expect(classifyRelease(['apps/site/lib/payment.ts'])).toMatchObject({ apps: ['site'], backend: false }));
});

describe('environment reconciliation scope', () => {
  const entry = (revision: string, phase = 'failed', successful = false, runId = 'old', attempt = '1') =>
    ({ payload: { phase, record: { sha: revision, runId, attempt } }, successful });

  it('retains every intervening attempt through the complete successful baseline', () => {
    const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
    expect(selectReconciliationRefs([
      entry(c), entry(c, 'started'), entry(b), entry(a, 'complete', true), entry('d'.repeat(40)),
    ])).toEqual({ refs: [c, b, a], hasBaseline: true });
    expect(selectReconciliationRefs([entry(c, 'complete', false), entry(b)]))
      .toEqual({ refs: [c, b], hasBaseline: false });
  });

  it('ignores only records produced by the guarded run and attempt', () => {
    const a = 'a'.repeat(40), b = 'b'.repeat(40);
    expect(selectReconciliationRefs([
      entry(b, 'complete', true, 'current', '2'), entry(b, 'failed', false, 'current', '1'),
      entry(a, 'complete', true),
    ], { runId: 'current', attempt: '2' })).toEqual({ refs: [b, a], hasBaseline: true });
  });

  it('requires both app identities when no staging baseline can be proven', () => {
    expect(classifyReconciledRelease([], [], false)).toMatchObject({ apps: ['site', 'web'], deploy: true });
    expect(classifyReconciledRelease(['apps/web/page.tsx'], [], true).apps).toEqual(['web']);
  });

  it('repairs a rejected UI/function change after a revert, including a failed repair retry', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'option-b-reconciliation-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const put = (path: string, value: string) => {
      mkdirSync(join(cwd, path, '..'), { recursive: true });
      writeFileSync(join(cwd, path), value);
    };
    const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
    try {
      git('init', '-q'); git('config', 'user.name', 'Release test'); git('config', 'user.email', 'release@example.invalid');
      put('apps/site/page.tsx', 'production runner');
      put('apps/web/page.tsx', 'production admin');
      put('supabase/functions/example/index.ts', 'production function');
      const a = commit();
      put('apps/site/page.tsx', 'rejected runner');
      put('supabase/functions/example/index.ts', 'rejected function');
      const b = commit();
      put('apps/site/page.tsx', 'production runner');
      put('apps/web/page.tsx', 'new admin');
      put('supabase/functions/example/index.ts', 'production function');
      const c = commit();
      const diff = (base: string) => git('diff', '--name-only', '--no-renames', base, c).split('\n').filter(Boolean);
      expect(classifyRelease(diff(a))).toMatchObject({ apps: ['web'], backend: false });
      for (const records of [
        [entry(b, 'complete', true)],
        [entry(c), entry(c, 'started'), entry(b), entry(a, 'complete', true)],
      ]) {
        const reconciliation = selectReconciliationRefs(records);
        expect(classifyReconciledRelease(diff(a), reconciliation.refs.flatMap(diff), reconciliation.hasBaseline))
          .toMatchObject({ apps: ['site', 'web'], backend: true });
      }
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('release trust boundaries', () => {
  const run = { head_sha: sha, head_branch:'main', event:'push', conclusion:'success', status:'completed', repository:{full_name:'JSON-FX/race-pace'}, head_repository:{full_name:'JSON-FX/race-pace'}, workflow_id:1 };
  it('requires exact successful integrated CI', () => {
    expect(() => assertTrustedRun(run,sha,1)).not.toThrow();
    for (const change of [{head_sha:'b'.repeat(40)},{head_branch:'staging'},{event:'pull_request'},{conclusion:'failure'},{workflow_id:2},{head_repository:{full_name:'attacker/race-pace'}}]) expect(() => assertTrustedRun({...run,...change},sha,1)).toThrow();
  });
  it('rejects short or injected refs', () => { for (const input of ['main','--upload-pack=evil','abc123','a'.repeat(39)]) expect(()=>requireSha(input)).toThrow(); });
  const environment = { can_admins_bypass:false, deployment_branch_policy:{custom_branch_policies:true}, protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'JSON-FX'}}]}] };
  const branches = [{name:'main',type:'branch'}];
  it('requires owner approval with no admin bypass and exact main policy', () => {
    expect(()=>assertApprovalEnvironment(environment,branches)).not.toThrow();
    expect(()=>assertApprovalEnvironment({...environment,protection_rules:[]},branches)).toThrow();
    expect(()=>assertApprovalEnvironment({...environment,can_admins_bypass:true},branches)).toThrow();
    expect(()=>assertApprovalEnvironment(environment,[{name:'*',type:'branch'}])).toThrow();
    expect(()=>assertApprovalEnvironment(environment,[{name:'main',type:'tag'}])).toThrow();
  });
  it('binds evidence to source, run and retry attempt', () => {
    const record={schema:1,repository:'JSON-FX/race-pace',sha,base:sha,tree:'tree',runId:'12',attempt:'1',apps:['web']};
    const context={sha,tree:'tree',runId:'12',attempt:'1'};
    expect(()=>assertManifest(record,context)).not.toThrow();
    for (const change of [{sha:'b'.repeat(40)},{tree:'other'},{runId:'13'},{attempt:'2'}]) expect(()=>assertManifest(record,{...context,...change})).toThrow();
  });
  it('does not record partial or foreign backend state as a completed release', () => {
    const record = { sha, base:sha, apps:['web'], backendEvidence:{state:'complete',environment:'production',projectRef:'whaqarofxdlzxrelbcrq',head:sha,base:sha,migrationVersions:[],functionInventory:[],inventoryVerifiedAt:'now'}, deployments:{
      site:{id:'dpl_site',projectId:'prj_Si8MyVid5X7zxDGQyjrqc2YOlMtJ',environment:'production',aliasVerifiedAt:'now',skipped:true},
      web:{id:'dpl_web',projectId:'prj_ADA1ewsz8MXpJptnOnKLxfAWkOTa',environment:'production',aliasVerifiedAt:'now',verifiedAt:'now',promotedAt:'now',sha},
    }};
    expect(()=>assertCompletedEvidence('production',record)).not.toThrow();
    for (const delta of [{state:'failed'},{environment:'staging'},{head:'b'.repeat(40)},{projectRef:'pepbmqomiailnnvvwupz'},{inventoryVerifiedAt:null}]) expect(()=>assertCompletedEvidence('production',{...record,backendEvidence:{...record.backendEvidence,...delta}})).toThrow();
    expect(()=>assertCompletedEvidence('production',{...record,deployments:{web:record.deployments.web}})).toThrow();
    expect(()=>assertCompletedEvidence('production',{...record,deployments:{...record.deployments,web:{...record.deployments.web,rolledBackAt:'now'}}})).toThrow();
  });
});
