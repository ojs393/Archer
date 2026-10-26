export interface AppPaths {
  root: string;
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  logsDir: string;
  backupsDir: string;
  envPath: string;
}

export function projectRoot(): string;

export function resolvePaths(opts: {
  root: string;
  env: Record<string, string | undefined>;
}): AppPaths;
