export type App = 'site' | 'web';
export type Environment = 'staging' | 'production';
export const TEAM_ID: string;
export const PROJECTS: Record<App, string>;
export const ENVIRONMENTS: Record<Environment, { project: string; site: string; web: string }>;
export interface DeploymentEvidence {
  id?: string;
  url?: string;
  sha: string | null;
  environment: Environment;
  customEnvironmentId?: string;
  projectId: string;
  previousId: string;
  state?: string;
  configDigest?: string;
  settingsDigest?: string;
  verifiedAt?: string;
  promotedAt?: string;
  aliasVerifiedAt?: string;
  rolledBackAt?: string;
  skipped?: boolean;
}
export interface Manifest {
  sha: string;
  apps: App[];
  deployments?: Partial<Record<App, DeploymentEvidence>>;
  previous?: { deployments?: Partial<Record<App, DeploymentEvidence>> };
  [key: string]: unknown;
}
export type Execute = (command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) => Promise<string>;
export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface Options extends Manifest {
  environment: Environment;
  cwd?: string;
  execute?: Execute;
  fetchImpl?: Fetch;
  onEvidence?: (manifest: Manifest) => Promise<void>;
  prepareSource?: (context: unknown, directory: string) => Promise<void>;
}
export function validateEnvironment(text: string, environment: Environment): string;
export function assertDeployment<T>(deployment: T, identity: { app: App; environment: Environment; sha: string | undefined; id: string; customEnvironmentId?: string }): T;
export function smokeApp(options: { app: App; environment: Environment; sha: string; url: string; fetchImpl?: Fetch }): Promise<void>;
export function deployApps(options: Options): Promise<Manifest>;
export function verifyApps(options: Options): Promise<Manifest>;
export function promoteApps(options: Options): Promise<Manifest>;
export function rollbackApps(options: Options): Promise<Manifest>;
