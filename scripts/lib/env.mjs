import crypto from "node:crypto";
import fs from "node:fs";
import { parseEnv } from "node:util";
import { projectRoot, resolvePaths } from "./paths.mjs";

export const SECRET_KEYS = ["UNSUB_SECRET"];

function readEnvFile(envPath) {
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null;
}

export function loadEnv(envPath, target = process.env) {
  const text = readEnvFile(envPath);
  if (text === null) return {};
  const parsed = { ...parseEnv(text) };
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value;
  }
  return parsed;
}

export function ensureSecrets(envPath) {
  const existing = readEnvFile(envPath);
  const parsed = existing === null ? {} : parseEnv(existing);
  const missing = SECRET_KEYS.filter((key) => !parsed[key]);
  if (missing.length === 0) return [];

  let text = existing ?? "";
  for (const key of missing) {
    const line = `${key}=${crypto.randomBytes(32).toString("hex")}`;
    const emptyAssignment = new RegExp(`^[ \\t]*(export[ \\t]+)?${key}[ \\t]*=[ \\t]*(""|'')?[ \\t]*$`, "m");
    if (emptyAssignment.test(text)) {
      text = text.replace(emptyAssignment, line);
    } else {
      text += (text && !text.endsWith("\n") ? "\n" : "") + line + "\n";
    }
  }

  // Write-then-rename: a torn write must never lose UNSUB_SECRET, or every sent unsubscribe link breaks.
  const staging = `${envPath}.${process.pid}.tmp`;
  fs.writeFileSync(staging, text, { mode: 0o600 });
  try {
    fs.chmodSync(staging, 0o600);
  } catch (err) {
    // Windows has no POSIX modes; the file inherits the user profile's ACL instead.
    if (process.platform !== "win32") throw err;
  }
  fs.renameSync(staging, envPath);
  return missing;
}

export function ensureDataDirs(paths = resolvePaths({ root: projectRoot(), env: process.env })) {
  const created = [];
  for (const dir of [paths.dataDir, paths.uploadsDir, paths.logsDir, paths.backupsDir]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }
  return created;
}
