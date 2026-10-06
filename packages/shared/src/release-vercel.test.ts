import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROJECTS, TEAM_ID, ENVIRONMENTS, assertDeployment, validateEnvironment, deployApps,
  verifyApps, promoteApps, rollbackApps, smokeApp,
} from '../../../scripts/release/vercel.mjs';
import type { App, Environment, Execute, Fetch, Manifest } from '../../../scripts/release/vercel.mjs';

const sha = 'a'.repeat(40);
const config = (environment: Environment = 'production') =>
  `NEXT_PUBLIC_SUPABASE_URL=https://${ENVIRONMENTS[environment].project}.supabase.co\nNEXT_PUBLIC_SITE_URL=https://${ENVIRONMENTS[environment].site}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=public-test-key\n`;
const deployment = (app: App = 'web', environment: Environment = 'production') => ({
  id: `dpl_${app}New`, projectId: PROJECTS[app], readyState: 'READY',
  target: environment === 'production' ? 'production' : null,
  customEnvironment: environment === 'staging' ? { id: `env_${app}Staging` } : undefined,
  meta: { releaseSha: sha }, url: `${app}-new.vercel.app`,
});
const entry = (app: App = 'web', environment: Environment = 'production') => ({
  id: `dpl_${app}New`, url: `https://${app}-new.vercel.app`, sha, environment,
  ...(environment === 'staging' ? { customEnvironmentId: `env_${app}Staging` } : {}),
  projectId: PROJECTS[app], previousId: `dpl_${app}Old`, verifiedAt: '2026-10-06T00:00:00Z',
});

afterEach(() => { vi.unstubAllEnvs(); });

function fixture(environment: Environment = 'production') {
  vi.stubEnv('VERCEL_TOKEN', 'private-test-token');
  const aliases = { site: 'dpl_siteOld', web: 'dpl_webOld' };
  const fetchImpl = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input);
    const app = url.href.includes('site') || url.pathname.includes(PROJECTS.site) || url.hostname === ENVIRONMENTS[environment].site ? 'site' : 'web';
    if (url.hostname === 'api.vercel.com') {
      expect(init?.redirect).toBe('error');
      if (url.pathname.endsWith('/custom-environments')) {
        return Response.json({ environments: [{ id: `env_${app}Staging`, slug: 'staging', type: 'preview' }] });
      }
      if (url.pathname.includes('/aliases/')) {
        const aliasApp = url.pathname.endsWith(ENVIRONMENTS[environment].site) ? 'site' : 'web';
        return Response.json({ projectId: PROJECTS[aliasApp], deploymentId: aliases[aliasApp] });
      }
      if (url.pathname.endsWith('Old')) return Response.json({ ...deployment(app, environment), id: `dpl_${app}Old` });
      return Response.json(deployment(app, environment));
    }
    expect(init?.redirect).toBe('error');
    return url.pathname === '/api/release'
      ? Response.json({ app, sha, supabaseProject: ENVIRONMENTS[environment].project })
      : new Response('Sign in');
  });
  const execute = vi.fn<Execute>(async (_command, args, options) => {
    const app = options.env?.VERCEL_PROJECT_ID === PROJECTS.site ? 'site' : 'web';
    if (args.includes('pull')) {
      await mkdir(join(options.cwd, '.vercel'), { recursive: true });
      await writeFile(join(options.cwd, '.vercel', `.env.${environment}.local`), config(environment));
      await writeFile(join(options.cwd, '.vercel', 'project.json'), JSON.stringify({
        projectId: PROJECTS[app], orgId: TEAM_ID, settings: { rootDirectory: `apps/${app}`, framework: 'nextjs' },
      }));
    }
    if (args.includes('deploy')) return JSON.stringify({ status: 'ok', deployment: { url: `https://${app}-new.vercel.app`, id: `dpl_${app}New` } });
    if (args.includes('promote')) aliases[app] = `dpl_${app}New`;
    if (args.includes('rollback')) aliases[app] = `dpl_${app}Old`;
    return '';
  });
  return { aliases, execute, fetchImpl, environment, sha };
}

describe('release configuration identity', () => {
  it('rejects cross-environment URLs and even an empty local Docker override', () => {
    expect(() => validateEnvironment(config('staging'), 'production')).toThrow('configuration');
    expect(() => validateEnvironment(`${config()}SUPABASE_INTERNAL_URL=\n`, 'production')).toThrow('configuration');
    expect(() => validateEnvironment(config().replace('https://www.racepace.com.ph', 'https://staging.racepace.com.ph'), 'production')).toThrow('configuration');
  });

  it('fingerprints values without emitting them, independent of ephemeral Vercel values', () => {
    const first = validateEnvironment(config(), 'production');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(validateEnvironment(`${config()}VERCEL_DEPLOYMENT_ID=another\n`, 'production')).toBe(first);
    expect(validateEnvironment(config().replace('public-test-key', 'rotated-key'), 'production')).not.toBe(first);
  });

  it.each(['projectId', 'readyState', 'target', 'meta'])('rejects mismatched %s from provider readback', field => {
    expect(() => assertDeployment({ ...deployment(), [field]: 'wrong' }, {
      app: 'web', environment: 'production', sha, id: 'dpl_webNew',
    })).toThrow('identity');
  });

  it('accepts an ID-only custom environment only when it matches the resolved staging ID', () => {
    const value = deployment('web', 'staging');
    const identity = { app: 'web' as const, environment: 'staging' as const, sha, id: value.id, customEnvironmentId: 'env_webStaging' };
    expect(() => assertDeployment(value, identity)).not.toThrow();
    expect(() => assertDeployment(value, { ...identity, customEnvironmentId: undefined })).toThrow('identity');
    expect(() => assertDeployment(value, { ...identity, customEnvironmentId: 'env_otherProjectStaging' })).toThrow('identity');
    expect(() => assertDeployment({ ...value, customEnvironment: { slug: 'staging' } }, identity)).toThrow('identity');
    expect(() => assertDeployment({ ...value, customEnvironment: { id: 'env_webStaging', slug: 'qa' } }, identity)).toThrow('identity');
    expect(() => assertDeployment({ ...value, target: 'production' }, identity)).toThrow('identity');
    expect(() => assertDeployment({ ...deployment(), customEnvironment: { id: 'env_webStaging' } }, {
      app: 'web', environment: 'production', sha, id: 'dpl_webNew',
    })).toThrow('identity');
  });
});

describe('environment builds', () => {
  it('isolates full source per project and never assigns production domains during deploy', async () => {
    const fx = fixture();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://wrong.supabase.co');
    const directories: string[] = [];
    const evidence: Manifest[] = [];
    const result = await deployApps({ ...fx, apps: ['site', 'web'], candidateId: 'retain-me',
      prepareSource: async (_ctx: unknown, directory: string) => { directories.push(directory); },
      onEvidence: async value => { evidence.push(value); },
    });
    expect(new Set(directories).size).toBe(2);
    expect(result.candidateId).toBe('retain-me');
    const deployCalls = fx.execute.mock.calls.filter(([, args]) => args.includes('deploy'));
    expect(deployCalls).toHaveLength(2);
    for (const [, args] of deployCalls) expect(args).toEqual(expect.arrayContaining(['--prebuilt', '--prod', '--skip-domain']));
    for (const [, args, options] of fx.execute.mock.calls) {
      if (args.includes('build')) expect(options.env?.NEXT_PUBLIC_SUPABASE_URL).toBe(`https://${ENVIRONMENTS.production.project}.supabase.co`);
    }
    expect(fx.execute.mock.calls.some(([, args]) => args.includes('promote'))).toBe(false);
    expect(evidence.some(value => value.deployments?.site?.state === 'deploying' && value.deployments.site?.previousId === 'dpl_siteOld')).toBe(true);
    expect(result.deployments?.web?.id).toBe('dpl_webNew');
  });

  it('uses the custom staging environment and deploys only the selected app', async () => {
    const fx = fixture('staging');
    const result = await deployApps({ ...fx, apps: ['web'], prepareSource: async () => {} });
    expect(fx.execute.mock.calls.filter(([, args]) => args.includes('deploy'))).toHaveLength(1);
    expect(fx.execute.mock.calls.find(([, args]) => args.includes('build'))?.[1]).toContain('--target=staging');
    expect(fx.execute.mock.calls.find(([, args]) => args.includes('pull'))?.[1]).toContain('--environment=staging');
    expect(result.deployments?.web?.customEnvironmentId).toBe('env_webStaging');
    expect(result.deployments?.site?.customEnvironmentId).toBe('env_siteStaging');
    fx.aliases.web = 'dpl_webNew';
    const verified = await verifyApps({ ...fx, ...result });
    expect(verified.deployments?.web?.aliasVerifiedAt).toBeTruthy();
    expect(verified.deployments?.site?.aliasVerifiedAt).toBeTruthy();
  });

  it.each([
    { environments: [] },
    { environments: [{ slug: 'staging' }] },
    { environments: [{ slug: 'staging', id: 'env_one' }, { slug: 'staging', id: 'env_two' }] },
  ])(
    'rejects missing or ambiguous staging configuration before build', async ({ environments }) => {
      const fx = fixture('staging');
      const original = fx.fetchImpl;
      const fetchImpl: Fetch = async (url, init) => String(url).includes('/custom-environments')
        ? Response.json({ environments }) : original(url, init);
      await expect(deployApps({ ...fx, fetchImpl, apps: ['web'], prepareSource: async () => {} })).rejects.toThrow('staging environment');
      expect(fx.execute).not.toHaveBeenCalled();
    },
  );

  it('rejects a recreated staging environment after deployment', async () => {
    const fx = fixture('staging');
    const original = fx.fetchImpl;
    const fetchImpl: Fetch = async (url, init) => String(url).includes('/custom-environments')
      ? Response.json({ environments: [{ slug: 'staging', id: 'env_recreated' }] }) : original(url, init);
    await expect(verifyApps({ ...fx, fetchImpl, apps: ['site', 'web'], deployments: {
      site: entry('site', 'staging'), web: entry('web', 'staging'),
    } })).rejects.toThrow('changed since deployment');
  });

  it('blocks build and upload when pulled configuration belongs to another environment', async () => {
    const fx = fixture();
    const original = fx.execute;
    const execute: Execute = async (command, args, options) => {
      const result = await original(command, args, options);
      if (args.includes('pull')) await writeFile(join(options.cwd, '.vercel', '.env.production.local'), config('staging'));
      return result;
    };
    await expect(deployApps({ ...fx, execute, apps: ['web'], prepareSource: async () => {} })).rejects.toThrow('configuration');
    expect(fx.execute.mock.calls.some(([, args]) => args.includes('build') || args.includes('deploy'))).toBe(false);
  });

  it('preserves unchanged app IDs and blocks an out-of-band change since the baseline', async () => {
    const fx = fixture();
    const result = await deployApps({ ...fx, apps: ['web'], prepareSource: async () => {} });
    expect(result.deployments?.site).toMatchObject({ id: 'dpl_siteOld', skipped: true });
    await expect(deployApps({ ...fx, apps: ['web'], previous: { deployments: {
      site: { ...entry('site'), id: 'dpl_someOtherRelease' },
    } }, prepareSource: async () => {} })).rejects.toThrow('previous release record');
  });
});

describe('verified promotion and recovery', () => {
  it('rejects approval evidence without successful candidate verification', async () => {
    const fx = fixture();
    await expect(promoteApps({ ...fx, apps: ['web'], deployments: { web: { ...entry(), verifiedAt: undefined } } })).rejects.toThrow('verification');
    expect(fx.execute).not.toHaveBeenCalled();
  });

  it('rechecks candidate HTTP identity before any promotion', async () => {
    const fx = fixture();
    const original = fx.fetchImpl;
    const fetchImpl: Fetch = async (url, init) => String(url).includes('/api/release')
      ? Response.json({ app: 'web', sha: 'b'.repeat(40), supabaseProject: ENVIRONMENTS.production.project })
      : original(url, init);
    await expect(promoteApps({ ...fx, fetchImpl, apps: ['web'], deployments: { web: entry() } })).rejects.toThrow('identity');
    expect(fx.execute).not.toHaveBeenCalled();
  });

  it('records partial promotion before a second project fails and permits explicit rollback', async () => {
    const fx = fixture();
    let last: Manifest = { sha, apps: ['site', 'web'] };
    const original = fx.execute;
    const execute: Execute = async (cmd, args, options) => {
      if (args.includes('promote') && options.env?.VERCEL_PROJECT_ID === PROJECTS.web) throw new Error('provider failure');
      return original(cmd, args, options);
    };
    await expect(promoteApps({ ...fx, execute, apps: ['site', 'web'], deployments: { site: entry('site'), web: entry() },
      onEvidence: async value => { last = value; },
    })).rejects.toThrow('provider failure');
    expect(last.deployments?.site?.promotedAt).toBeTruthy();
    expect(last.deployments?.web?.state).toBe('promoting');
    const rolledBack = await rollbackApps({ ...fx, ...last });
    expect(rolledBack.deployments?.site?.state).toBe('rolled-back');
    expect(fx.aliases.site).toBe('dpl_siteOld');
  });

  it('requires alias readback after promotion', async () => {
    const fx = fixture();
    await expect(verifyApps({ ...fx, apps: ['web'], deployments: {
      site: { ...entry('site'), id: 'dpl_siteOld', skipped: true },
      web: { ...entry(), promotedAt: 'now' },
    } })).rejects.toThrow('Alias');
  });

  it('refuses rollback over a later unrelated release', async () => {
    const fx = fixture();
    fx.aliases.web = 'dpl_laterRelease';
    await expect(rollbackApps({ ...fx, apps: ['web'], deployments: { web: entry() } })).rejects.toThrow('unrelated release');
    expect(fx.execute).not.toHaveBeenCalled();
  });

  it('does not follow redirects with bypass credentials or allow unrelated origins', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET_WEB', 'private-bypass');
    const fetchImpl = vi.fn<Fetch>(async (_url, options) => {
      expect(options?.redirect).toBe('error');
      expect(new Headers(options?.headers).get('x-vercel-protection-bypass')).toBe('private-bypass');
      return new Response(null, { status: 302, headers: { Location: 'https://evil.example' } });
    });
    await expect(smokeApp({ app: 'web', environment: 'production', sha, url: 'https://web-new.vercel.app', fetchImpl })).rejects.toThrow('smoke');
    await expect(smokeApp({ app: 'web', environment: 'production', sha, url: 'https://evil.example', fetchImpl })).rejects.toThrow('origin');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
