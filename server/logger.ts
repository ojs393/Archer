import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { config } from "./config.ts";

export type Level = "info" | "warn" | "error";

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const REDACTED = "***";
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value) secrets.add(value);
}

export function redact(text: string): string {
  // Longest first, so a secret that contains another is not left half-masked.
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  return ordered.reduce((out, secret) => out.split(secret).join(REDACTED), text);
}

// Redaction must happen on raw values: once serialized, JSON/inspect escape quotes and
// backslashes, so a secret containing them would no longer match.
function redactDeep(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) return redact(value.stack ?? `${value.name}: ${value.message}`);
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const known = seen.get(value);
  if (known) return known;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactDeep(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[redact(key)] = redactDeep(item, seen);
  return copy;
}

function formatArg(arg: unknown): string {
  const value = redactDeep(arg, new WeakMap());
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return inspect(value, { depth: 4 });
  }
}

function defaultWrite(line: string, level: Level): void {
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

/** Rotate when the active log reaches this size. Overwrites a previous `app.log.1`. */
export const LOG_ROTATE_BYTES = 10 * 1024 * 1024;

export function createLogger({
  logFile,
  write = defaultWrite,
  rotateBytes = LOG_ROTATE_BYTES,
}: {
  logFile?: string;
  write?: (line: string, level: Level) => void;
  /** Override for tests; production uses LOG_ROTATE_BYTES. */
  rotateBytes?: number;
}): Logger {
  let dirReady = false;

  const emit = (level: Level, args: unknown[]) => {
    const line = redact(`${new Date().toISOString()} ${level.toUpperCase()} ${args.map(formatArg).join(" ")}`);
    write(line, level);
    if (!logFile) return;
    try {
      if (!dirReady) {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        dirReady = true;
      }
      if (rotateBytes > 0) {
        try {
          if (fs.statSync(logFile).size >= rotateBytes) {
            const rotated = `${logFile}.1`;
            fs.rmSync(rotated, { force: true });
            fs.renameSync(logFile, rotated);
          }
        } catch {
          // Missing file or I/O error: leave logging alone; append still tried below.
        }
      }
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      // A full disk or locked log file must never take the server down; stdout still has the line.
    }
  };

  return {
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),
  };
}

export const logger = createLogger({ logFile: path.join(config.logsDir, "app.log") });
