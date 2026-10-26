/** Names of dependencies that are not installed, or that differ from an exact version pin. */
export function missingDependencies(root: string): string[];

/** `["ci"]` when package-lock.json exists, otherwise `["install"]`. */
export function installArgs(root: string): string[];
