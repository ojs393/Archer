import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webBuildCheck, webBuildState } from "../../../scripts/lib/webBuild.mjs";

let root: string;

function write(rel: string, at: number): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rel);
  fs.utimesSync(file, at, at);
}

const T0 = 1_700_000_000;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "archer-webbuild-"));
  write("web/index.html", T0);
  write("web/src/main.tsx", T0);
  write("vite.config.ts", T0);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const ok = { ok: true, code: 0, timedOut: false, attempts: 1 };

describe("webBuildState", () => {
  it("is missing when there is no build", () => {
    expect(webBuildState(root)).toEqual({ state: "missing" });
  });

  it("is fresh when the build is newer than every source", () => {
    write("dist/web/index.html", T0 + 10);
    expect(webBuildState(root)).toEqual({ state: "fresh" });
  });

  it("is stale when a nested web source changed after the build", () => {
    write("dist/web/index.html", T0 + 10);
    write("web/src/shell/Header.tsx", T0 + 20);
    expect(webBuildState(root)).toEqual({ state: "stale", newest: path.join("web", "src", "shell", "Header.tsx") });
  });

  it("is stale when the Vite config changed after the build", () => {
    write("dist/web/index.html", T0 + 10);
    write("vite.config.ts", T0 + 20);
    expect(webBuildState(root)).toMatchObject({ state: "stale", newest: "vite.config.ts" });
  });

  it("ignores dotfiles such as .DS_Store", () => {
    write("dist/web/index.html", T0 + 10);
    write("web/src/.DS_Store", T0 + 20);
    expect(webBuildState(root)).toEqual({ state: "fresh" });
  });

  it("has nothing to build without web sources", () => {
    fs.rmSync(path.join(root, "web"), { recursive: true });
    expect(webBuildState(root)).toEqual({ state: "no-source" });
  });
});

describe("webBuildCheck", () => {
  it("passes without building when fresh", async () => {
    write("dist/web/index.html", T0 + 10);
    const build = vi.fn();
    expect(await webBuildCheck(root, { build })).toEqual({ status: "PASS", name: "web app", detail: "build is current" });
    expect(build).not.toHaveBeenCalled();
  });

  it("builds a missing app and reports FIXED", async () => {
    const build = vi.fn(async () => {
      write("dist/web/index.html", T0 + 30);
      return ok;
    });
    expect(await webBuildCheck(root, { build })).toEqual({ status: "FIXED", name: "web app", detail: "not built; ran npm run build:web" });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a stale app and names the newer file", async () => {
    write("dist/web/index.html", T0 + 10);
    write("web/src/main.tsx", T0 + 20);
    const build = vi.fn(async () => {
      write("dist/web/index.html", T0 + 30);
      return ok;
    });
    const result = await webBuildCheck(root, { build });
    expect(result).toMatchObject({ status: "FIXED", name: "web app" });
    expect(result.detail).toContain(path.join("web", "src", "main.tsx"));
  });

  it("reports a failed build without stopping the start", async () => {
    const build = vi.fn(async () => ({ ok: false, code: 1, timedOut: false, attempts: 1 }));
    expect(await webBuildCheck(root, { build })).toEqual({
      status: "FAIL",
      name: "web app",
      detail: "npm run build:web failed (exit code 1)",
      hint: "run npm run build:web to see the error",
    });
  });

  it("reports a timed-out build", async () => {
    const build = vi.fn(async () => ({ ok: false, code: null, timedOut: true, attempts: 1 }));
    expect((await webBuildCheck(root, { build })).detail).toBe("npm run build:web failed (timed out)");
  });

  it("fails if the build claims success but leaves the app stale", async () => {
    const build = vi.fn(async () => ok);
    expect(await webBuildCheck(root, { build })).toMatchObject({ status: "FAIL", detail: "npm run build:web did not produce dist/web/index.html" });
  });

  it("skips when the project has no web sources", async () => {
    fs.rmSync(path.join(root, "web"), { recursive: true });
    expect(await webBuildCheck(root, { build: vi.fn() })).toEqual({ status: "SKIP", name: "web app", detail: "no web sources" });
  });
});
