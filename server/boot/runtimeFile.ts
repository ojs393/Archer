import fs from "node:fs";
import path from "node:path";

export interface ServerInfo {
  pid: number;
  port: number;
  url: string;
}

export function writeServerInfo(filePath: string, info: ServerInfo): void {
  const staging = `${filePath}.${info.pid}.tmp`;
  fs.writeFileSync(staging, `${JSON.stringify(info)}\n`);
  fs.renameSync(staging, filePath);
}

export function removeServerInfo(filePath: string, pid: number): void {
  try {
    const current = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ServerInfo>;
    if (current.pid === pid) fs.rmSync(filePath, { force: true });
  } catch {
    // Missing or unreadable: nothing of ours to remove.
  }
}

export function clearDirectory(dir: string): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // A file another process still holds open is retried on the next start.
    }
  }
  return removed;
}
