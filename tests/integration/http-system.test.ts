import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../server/http/server.ts";
import { authed, makeHarness, mutating, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

const harnessWithDesktop = (pick: (dir: string) => string) => {
  let desktop = "";
  return {
    get desktop() {
      return desktop;
    },
    build: (deps: Parameters<typeof buildServer>[0]) => {
      desktop = pick(deps.paths.root);
      return buildServer({ ...deps, desktopDir: desktop });
    },
  };
};

describe("POST /api/system/desktop-launcher", () => {
  it("writes a launcher for this platform that starts Archer from the project root", async () => {
    const target = harnessWithDesktop((root) => path.join(root, "Desktop"));
    h = await makeHarness({ build: target.build });
    const res = await h.app.inject({ method: "POST", url: "/api/system/desktop-launcher", headers: mutating });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ok: true, path: expect.stringMatching(/Archer\.(command|desktop|cmd)$/) });
    expect(path.dirname(body.path)).toBe(target.desktop);
    const text = fs.readFileSync(body.path, "utf8");
    expect(text).toContain(h.paths.root);
    expect(text).toContain("npm start");
  });

  it("answers 500 with a clear message when the desktop folder cannot be written", async () => {
    const target = harnessWithDesktop((root) => {
      const file = path.join(root, "not-a-folder");
      fs.writeFileSync(file, "x");
      return file;
    });
    h = await makeHarness({ build: target.build });
    const res = await h.app.inject({ method: "POST", url: "/api/system/desktop-launcher", headers: mutating });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ code: "launcher_failed", message: expect.stringMatching(/^Could not create the desktop launcher: /) });
  });

  it("keeps the header and session checks", async () => {
    h = await makeHarness();
    expect((await h.app.inject({ method: "POST", url: "/api/system/desktop-launcher", headers: authed })).statusCode).toBe(403);
    const noSession = { host: mutating.host, origin: mutating.origin, "x-archer": "1" };
    expect((await h.app.inject({ method: "POST", url: "/api/system/desktop-launcher", headers: noSession })).statusCode).toBe(401);
  });
});
