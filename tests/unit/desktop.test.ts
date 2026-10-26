import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesktopLauncher, desktopDir } from "../../server/system/desktop.ts";

let dir: string;
let desktop: string;
let root: string;
let bin: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-desktop-"));
  desktop = path.join(dir, "Desktop");
  root = path.join(dir, `Mama "Direct" it's $HOME 100%`);
  bin = path.join(dir, "node bin");
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const posixOnly = process.platform === "win32" ? it.skip : it;

function fakeNpm(): string {
  const out = path.join(dir, "npm-ran.txt");
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\nprintf '%s|%s' "$(pwd -P)" "$*" > '${out}'\n`, { mode: 0o755 });
  return out;
}

/** Reverses Desktop Entry escaping for a single `bash -lc "<script>"` Exec line and returns the script. */
function execScript(execLine: string): string {
  const value = execLine.replace(/\\(.)/g, (_m, c: string) => (c === "\\" ? "\\" : `\\${c}`)).replace(/%%/g, "%");
  const match = /^bash -lc "((?:[^"\\]|\\.)*)"$/.exec(value);
  if (!match) throw new Error(`unexpected Exec line: ${execLine}`);
  return match[1].replace(/\\([$`"\\])/g, "$1");
}

describe("desktopDir", () => {
  it("uses ~/Desktop on macOS and Linux", () => {
    expect(desktopDir({ platform: "darwin", homedir: "/Users/olive" })).toBe("/Users/olive/Desktop");
    expect(desktopDir({ platform: "linux", homedir: "/home/olive" })).toBe("/home/olive/Desktop");
  });

  it("prefers the OneDrive desktop on Windows when it exists", () => {
    const env = { USERPROFILE: "C:\\Users\\Olive" };
    const onedrive = "C:\\Users\\Olive\\OneDrive\\Desktop";
    expect(desktopDir({ platform: "win32", homedir: "C:\\Users\\Olive", env, exists: (p) => p === onedrive })).toBe(onedrive);
    expect(desktopDir({ platform: "win32", homedir: "C:\\Users\\Olive", env, exists: () => false })).toBe("C:\\Users\\Olive\\Desktop");
    expect(desktopDir({ platform: "win32", homedir: "C:\\Users\\Olive", env: {}, exists: () => true })).toBe("C:\\Users\\Olive\\Desktop");
  });
});

describe("createDesktopLauncher on macOS", () => {
  it("writes an executable MamaDirect.command that starts MamaDirect in the project root", async () => {
    const result = await createDesktopLauncher({ projectRoot: root, iconPath: path.join(dir, "missing.icns"), platform: "darwin", desktopDir: desktop, nodeBinDir: bin });
    expect(result).toEqual({ path: path.join(desktop, "MamaDirect.command"), platform: "darwin" });
    const text = fs.readFileSync(result.path, "utf8");
    expect(text).toBe(
      [
        "#!/bin/bash",
        `export PATH="${bin}:$PATH"`,
        `cd "${dir}/Mama \\"Direct\\" it's \\$HOME 100%" && npm start`,
        "",
      ].join("\n"),
    );
    if (process.platform !== "win32") expect(fs.statSync(result.path).mode & 0o777).toBe(0o755);
  });

  posixOnly("runs npm start from the exact project path despite spaces and quotes", async () => {
    const out = fakeNpm();
    const { path: file } = await createDesktopLauncher({ projectRoot: root, iconPath: "", platform: "darwin", desktopDir: desktop, nodeBinDir: bin });
    execFileSync("/bin/bash", [file], { env: { PATH: "/usr/bin:/bin", HOME: dir } });
    expect(fs.readFileSync(out, "utf8")).toBe(`${fs.realpathSync(root)}|start`);
  });

  it("overwrites an existing launcher and keeps it executable", async () => {
    fs.mkdirSync(desktop);
    fs.writeFileSync(path.join(desktop, "MamaDirect.command"), "old", { mode: 0o600 });
    const { path: file } = await createDesktopLauncher({ projectRoot: root, iconPath: "", platform: "darwin", desktopDir: desktop, nodeBinDir: bin });
    expect(fs.readFileSync(file, "utf8")).toContain("npm start");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o755);
  });
});

describe("createDesktopLauncher on Linux", () => {
  it("writes an executable MamaDirect.desktop with an escaped Exec line and the icon", async () => {
    const icon = path.join(root, "icon 512.png");
    fs.writeFileSync(icon, "png");
    const result = await createDesktopLauncher({ projectRoot: root, iconPath: icon, platform: "linux", desktopDir: desktop, nodeBinDir: bin });
    expect(result).toEqual({ path: path.join(desktop, "MamaDirect.desktop"), platform: "linux" });
    const lines = fs.readFileSync(result.path, "utf8").split("\n");
    expect(lines).toContain("[Desktop Entry]");
    expect(lines).toContain("Type=Application");
    expect(lines).toContain("Name=MamaDirect");
    expect(lines).toContain("Terminal=true");
    expect(lines).toContain(`Icon=${icon}`);
    const exec = lines.find((l) => l.startsWith("Exec="))!.slice("Exec=".length);
    expect(exec).toContain("100%%");
    expect(execScript(exec)).toBe(`export PATH="${bin}:$PATH"; cd "${dir}/Mama \\"Direct\\" it's \\$HOME 100%" && npm start`);
    if (process.platform !== "win32") expect(fs.statSync(result.path).mode & 0o777).toBe(0o755);
  });

  it("leaves out the icon when the file does not exist", async () => {
    const { path: file } = await createDesktopLauncher({ projectRoot: root, iconPath: path.join(dir, "nope.png"), platform: "linux", desktopDir: desktop, nodeBinDir: bin });
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/^Icon=/m);
  });

  posixOnly("runs npm start from the exact project path when the Exec line is parsed", async () => {
    const out = fakeNpm();
    const { path: file } = await createDesktopLauncher({ projectRoot: root, iconPath: "", platform: "linux", desktopDir: desktop, nodeBinDir: bin });
    const exec = fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("Exec="))!.slice("Exec=".length);
    execFileSync("/bin/bash", ["-c", execScript(exec)], { env: { PATH: "/usr/bin:/bin", HOME: dir } });
    expect(fs.readFileSync(out, "utf8")).toBe(`${fs.realpathSync(root)}|start`);
  });
});

describe("createDesktopLauncher on Windows", () => {
  const winRoot = "C:\\Users\\Olive Smith\\Mama Direct 100%";
  const winBin = "C:\\Program Files\\nodejs";

  it("writes MamaDirect.cmd and asks PowerShell for a shortcut with the icon", async () => {
    const scripts: string[] = [];
    const icon = path.join(dir, "o'brien.ico");
    fs.writeFileSync(icon, "ico");
    const result = await createDesktopLauncher({
      projectRoot: winRoot,
      iconPath: icon,
      platform: "win32",
      desktopDir: desktop,
      nodeBinDir: winBin,
      runPowerShell: async (script) => void scripts.push(script),
    });
    const cmd = path.join(desktop, "MamaDirect.cmd");
    expect(result).toEqual({ path: cmd, platform: "win32" });
    expect(fs.readFileSync(cmd, "utf8")).toBe(
      ["@echo off", 'set "PATH=C:\\Program Files\\nodejs;%PATH%"', 'cd /d "C:\\Users\\Olive Smith\\Mama Direct 100%%" && npm start', ""].join("\r\n"),
    );
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("WScript.Shell");
    expect(scripts[0]).toContain(`CreateShortcut('${path.join(desktop, "MamaDirect.lnk").replace(/'/g, "''")}')`);
    expect(scripts[0]).toContain(`TargetPath = '${cmd.replace(/'/g, "''")}'`);
    expect(scripts[0]).toContain("WorkingDirectory = 'C:\\Users\\Olive Smith\\Mama Direct 100%'");
    expect(scripts[0]).toContain(`IconLocation = '${icon.replace(/'/g, "''")}'`);
    expect(scripts[0]).toMatch(/\.Save\(\)/);
  });

  it("still succeeds when the shortcut cannot be made", async () => {
    const result = await createDesktopLauncher({
      projectRoot: winRoot,
      iconPath: "C:\\icon.ico",
      platform: "win32",
      desktopDir: desktop,
      nodeBinDir: winBin,
      runPowerShell: async () => {
        throw new Error("powershell missing");
      },
    });
    expect(result.path).toBe(path.join(desktop, "MamaDirect.cmd"));
    expect(fs.existsSync(result.path)).toBe(true);
  });
});

describe("createDesktopLauncher input checks", () => {
  it.each(["darwin", "linux", "win32"] as const)("refuses a project path with a line break on %s", async (platform) => {
    await expect(
      createDesktopLauncher({ projectRoot: "/tmp/a\nrm -rf ~", iconPath: "", platform, desktopDir: desktop, nodeBinDir: bin, runPowerShell: async () => {} }),
    ).rejects.toThrow(/line break|control/i);
    expect(fs.existsSync(desktop)).toBe(false);
  });

  it("refuses a double quote in a Windows path", async () => {
    await expect(
      createDesktopLauncher({ projectRoot: 'C:\\a"b', iconPath: "", platform: "win32", desktopDir: desktop, nodeBinDir: "C:\\nodejs", runPowerShell: async () => {} }),
    ).rejects.toThrow(/quote/i);
  });

  it("refuses an unsupported platform", async () => {
    await expect(createDesktopLauncher({ projectRoot: root, iconPath: "", platform: "aix", desktopDir: desktop })).rejects.toThrow(/not supported/i);
  });
});
