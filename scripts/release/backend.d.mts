export type Environment = 'staging' | 'production';
export interface FunctionEvidence {
  slug: string;
  sourceSha256: string;
  version: number;
  verifyJwt: boolean;
  bundleSha256: string;
  verifiedAt: string;
}
export interface FunctionInventory {
  slug: string;
  version: number;
  verifyJwt: boolean;
  bundleSha256: string;
  candidateSourceSha256: string;
  deployedThisRelease: boolean;
}
export interface BackendEvidence {
  environment: Environment;
  projectRef: string;
  base: string;
  head: string;
  reconciliationRefs: string[];
  skipped: boolean;
  state: string;
  migrations: { path: string; version: string; sha256: string }[];
  functions: FunctionEvidence[];
  excludedFunctions: string[];
  migrationVersions?: string[];
  migrationVersionsBefore?: string[];
  newMigrationVersions?: string[];
  functionInventory?: FunctionInventory[];
  updatedAt?: string;
  completedAt?: string;
  failedAt?: string;
  failedPhase?: string;
  inventoryVerifiedAt?: string;
  [key: string]: unknown;
}
export type Execute = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<string | { stdout: string }>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export interface BackendOptions {
  environment: string;
  base: string;
  head: string;
  reconciliationRefs?: string[];
  cwd?: string;
  execute?: Execute;
  fetchImpl?: Fetch;
  onEvidence?: (evidence: BackendEvidence) => Promise<void>;
}
export function deployBackend(options: BackendOptions): Promise<BackendEvidence>;
export function verifyBackendEvidence<T extends Record<string, unknown>>(options: { environment: string; record: T; fetchImpl?: Fetch }): Promise<T & { backendRecheckedAt: string }>;
