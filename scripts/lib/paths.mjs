import path from "node:path";
import { fileURLToPath } from "node:url";

export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function resolvePaths({ root, env }) {
  const dataDir = env.MAMADIRECT_DATA_DIR
    ? path.resolve(root, env.MAMADIRECT_DATA_DIR)
    : path.join(root, "data");
  return {
    root,
    dataDir,
    dbPath: path.join(dataDir, "mamadirect.db"),
    uploadsDir: path.join(dataDir, "uploads"),
    logsDir: path.join(dataDir, "logs"),
    backupsDir: path.join(dataDir, "backups"),
    envPath: env.MAMADIRECT_ENV_FILE ? path.resolve(root, env.MAMADIRECT_ENV_FILE) : path.join(root, ".env"),
  };
}
