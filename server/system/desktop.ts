import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DesktopDirOptions {
  platform?: NodeJS.Platform;
  homedir?: string;
  env?: Record<string, string | undefined>;
  exists?: (p: string) => boolean;
}

export interface LauncherOptions {
  projectRoot: string;
  iconPath: string;
  platform?: NodeJS.Platform;
  desktopDir?: string;
  /** Prepended to PATH: a double-clicked launcher does not read the shell profile that puts node/npm on PATH. */
  nodeBinDir?: string;
  runPowerShell?: (script: string) => Promise<void>;
}

export interface LauncherResult {
  path: string;
  platform: NodeJS.Platform;
}

const NAME = "MamaDirect";
const EXECUTABLE = 0o755;
const POWERSHELL_TIMEOUT_MS = 20_000;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function desktopDir(opts: DesktopDirOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? os.homedir();
  if (platform !== "win32") return path.posix.join(home, "Desktop");
  const profile = (opts.env ?? process.env).USERPROFILE;
  const oneDrive = profile ? path.win32.join(profile, "OneDrive", "Desktop") : null;
  if (oneDrive && (opts.exists ?? fs.existsSync)(oneDrive)) return oneDrive;
  return path.win32.join(home, "Desktop");
}

function checkPath(label: string, value: string): void {
  if (CONTROL.test(value)) throw new Error(`The ${label} contains a line break or control character; move MamaDirect to a simpler folder`);
}

/** Escapes for the inside of a POSIX shell double-quoted string. */
function shDouble(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&");
}

/** Escapes for the inside of a cmd.exe double-quoted string in a batch file. */
function cmdDouble(value: string): string {
  if (value.includes('"')) throw new Error("Windows paths cannot contain a double quote");
  return value.replace(/%/g, "%%");
}

function psSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function macScript(root: string, bin: string): string {
  return ["#!/bin/bash", `export PATH="${shDouble(bin)}:$PATH"`, `cd "${shDouble(root)}" && npm start`, ""].join("\n");
}

/** Desktop Entry Exec: quote the argument, then apply the string-value escape (backslashes) and field-code escape (%). */
function linuxEntry(root: string, bin: string, icon: string | null): string {
  const script = `export PATH="${shDouble(bin)}:$PATH"; cd "${shDouble(root)}" && npm start`;
  const exec = `bash -lc "${script.replace(/[\\"$`]/g, "\\$&")}"`.replace(/\\/g, "\\\\").replace(/%/g, "%%");
  const lines = ["[Desktop Entry]", "Type=Application", `Name=${NAME}`, "Comment=Start MamaDirect and open the dashboard", `Exec=${exec}`];
  if (icon) lines.push(`Icon=${icon.replace(/\\/g, "\\\\")}`);
  lines.push("Terminal=true", "Categories=Network;Email;", "");
  return lines.join("\n");
}

function windowsCmd(root: string, bin: string): string {
  return ["@echo off", `set "PATH=${cmdDouble(bin)};%PATH%"`, `cd /d "${cmdDouble(root)}" && npm start`, ""].join("\r\n");
}

function shortcutScript(lnk: string, target: string, root: string, icon: string | null): string {
  const lines = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$link = $shell.CreateShortcut(${psSingle(lnk)})`,
    `$link.TargetPath = ${psSingle(target)}`,
    `$link.WorkingDirectory = ${psSingle(root)}`,
  ];
  if (icon) lines.push(`$link.IconLocation = ${psSingle(icon)}`);
  lines.push("$link.Save()");
  return lines.join("\n");
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

function writeExecutable(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: EXECUTABLE });
  fs.chmodSync(file, EXECUTABLE);
}

export async function createDesktopLauncher(opts: LauncherOptions): Promise<LauncherResult> {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new Error(`Desktop launchers are not supported on ${platform}`);
  }
  const root = opts.projectRoot;
  const bin = opts.nodeBinDir ?? path.dirname(process.execPath);
  const icon = opts.iconPath && fs.existsSync(opts.iconPath) ? opts.iconPath : null;
  checkPath("project folder path", root);
  checkPath("Node.js folder path", bin);
  if (icon) checkPath("icon path", icon);
  const content = platform === "darwin" ? macScript(root, bin) : platform === "linux" ? linuxEntry(root, bin, icon) : windowsCmd(root, bin);

  const dir = opts.desktopDir ?? desktopDir({ platform });
  fs.mkdirSync(dir, { recursive: true });
  if (platform === "darwin") {
    const file = path.join(dir, `${NAME}.command`);
    writeExecutable(file, content);
    return { path: file, platform };
  }
  if (platform === "linux") {
    const file = path.join(dir, `${NAME}.desktop`);
    writeExecutable(file, content);
    return { path: file, platform };
  }
  const file = path.join(dir, `${NAME}.cmd`);
  fs.writeFileSync(file, content);
  try {
    await (opts.runPowerShell ?? runPowerShell)(shortcutScript(path.join(dir, `${NAME}.lnk`), file, root, icon));
  } catch {
    // The .cmd launcher works on its own; the shortcut only adds the icon.
  }
  return { path: file, platform };
}
