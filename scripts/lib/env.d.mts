import type { AppPaths } from "./paths.mjs";

export const SECRET_KEYS: readonly string[];

/** Parses `envPath` and copies each value into `target` unless the key is already set there. */
export function loadEnv(
  envPath: string,
  target?: Record<string, string | undefined>,
): Record<string, string>;

/** Generates any missing secret into `envPath` (mode 0600). Returns the keys it generated. */
export function ensureSecrets(envPath: string): string[];

/** Creates the data tree. Returns the directories it had to create. */
export function ensureDataDirs(paths?: AppPaths): string[];
