import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installArgs, missingDependencies } from "../../../scripts/lib/deps.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "archer-deps-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { a: "1.0.0" }, devDependencies: { "@s/b": "^2.0.0" } }),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function installFake(name: string, version: string) {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
}

describe("missingDependencies", () => {
  it("lists every dependency when node_modules is absent", () => {
    expect(missingDependencies(root)).toEqual(["a", "@s/b"]);
  });

  it("returns nothing when all dependencies are installed", () => {
    installFake("a", "1.0.0");
    installFake("@s/b", "2.5.0");
    expect(missingDependencies(root)).toEqual([]);
  });

  it("flags an installed version that differs from an exact pin", () => {
    installFake("a", "0.9.0");
    installFake("@s/b", "2.5.0");
    expect(missingDependencies(root)).toEqual(["a@0.9.0 (want 1.0.0)"]);
  });
});

describe("installArgs", () => {
  it("uses npm ci when a lockfile exists", () => {
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
    expect(installArgs(root)).toEqual(["ci"]);
  });

  it("falls back to npm install without a lockfile", () => {
    expect(installArgs(root)).toEqual(["install"]);
  });
});
