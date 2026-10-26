import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { parseEnv } from "node:util";

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSTORABLE = /[\r\n\u0000]/;

function assignmentOf(key: string): RegExp {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=`);
}

function encode(key: string, value: string): string {
  for (const quote of ["'", "`", '"', ""]) {
    const line = `${key}=${quote}${value}${quote}`;
    if (parseEnv(line)[key] === value) return line;
  }
  throw new Error(`${key} contains a combination of quotes that cannot be stored in .env`);
}

function writeAtomically(envPath: string, text: string): void {
  const staging = `${envPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(staging, text, { mode: 0o600 });
    try {
      fs.chmodSync(staging, 0o600);
    } catch (err) {
      // Windows has no POSIX modes; the file inherits the user profile's ACL instead.
      if (process.platform !== "win32") throw err;
    }
    fs.renameSync(staging, envPath);
  } catch (err) {
    fs.rmSync(staging, { force: true });
    throw err;
  }
}

export function setEnvValue(
  envPath: string,
  key: string,
  value: string | null,
  target: Record<string, string | undefined> = process.env,
): void {
  if (!KEY.test(key)) throw new Error(`Invalid .env key "${key}"`);
  if (value !== null && UNSTORABLE.test(value)) throw new Error(`${key} must not contain line breaks or NUL characters`);

  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const matcher = assignmentOf(key);
  const lines = existing === "" ? [] : existing.replace(/\r?\n$/, "").split(/\r?\n/);
  const kept: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (!matcher.test(line)) kept.push(line);
    else if (value !== null && !replaced) {
      kept.push(encode(key, value));
      replaced = true;
    }
  }
  if (value !== null && !replaced) kept.push(encode(key, value));

  writeAtomically(envPath, kept.length > 0 ? `${kept.join("\n")}\n` : "");
  if (value === null) delete target[key];
  else target[key] = value;
}
