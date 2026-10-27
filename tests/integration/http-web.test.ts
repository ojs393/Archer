import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectRoot } from "../../scripts/lib/paths.mjs";
import { authed, makeHarness, type Harness } from "./httpHarness.ts";

let h: Harness | undefined;
let tmp: string | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const builtWeb = path.join(projectRoot(), "dist", "web");
const isBuilt = fs.existsSync(path.join(builtWeb, "index.html"));

describe("web app serving", () => {
  it("answers a missing asset with 404 instead of the app page", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "archer-web-"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html><title>Archer</title>");
    fs.mkdirSync(path.join(tmp, "assets"));
    h = await makeHarness({ webDir: tmp });
    for (const url of ["/assets/Gone-abc123.js", "/assets/nested/x", "/favicon-999.png", "/old.css?v=1"]) {
      const res = await h.app.inject({ method: "GET", url, headers: { host: authed.host } });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).not.toMatch(/text\/html/);
    }
    const deep = await h.app.inject({ method: "GET", url: "/runs/7", headers: { host: authed.host } });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>Archer</title>");
  });

  it.skipIf(!isBuilt)("serves the built dashboard from dist/web", async () => {
    h = await makeHarness({ webDir: builtWeb });
    const root = await h.app.inject({ method: "GET", url: "/", headers: { host: authed.host } });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>Archer</title>");
    expect(root.body).toContain('rel="manifest"');

    const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(root.body)?.[1];
    expect(script).toBeDefined();
    const asset = await h.app.inject({ method: "GET", url: script!, headers: { host: authed.host } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toMatch(/javascript/);

    for (const url of ["/favicon.svg", "/favicon.ico", "/site.webmanifest", "/icon-512.png"]) {
      const res = await h.app.inject({ method: "GET", url, headers: { host: authed.host } });
      expect(res.statusCode, url).toBe(200);
    }
  });
});
