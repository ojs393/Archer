import fs from "node:fs";
import path from "node:path";
import type { InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ORIGIN, PORT, TOKEN, authed, makeHarness, mutating, type Harness } from "./httpHarness.ts";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
}

describe("HTTP security", () => {
  it("rejects a foreign Host with 403 bad_host on every kind of route", async () => {
    h = await makeHarness();
    for (const url of ["/api/session", "/api/health", "/", "/u/whatever", "/nope"]) {
      const res = await h.app.inject({ method: "GET", url, headers: { ...authed, host: `evil.example:${PORT}` } });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: { code: "bad_host", message: expect.any(String) } });
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("rejects a POST with a mismatched Origin (403 bad_origin)", async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/suppression",
      headers: { ...mutating, origin: "http://evil.example" },
      payload: { email: "a@example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("bad_origin");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM suppression").get()).toEqual({ n: 0 });
  });

  it("rejects a POST without X-MamaDirect (403 missing_header)", async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/suppression",
      headers: { ...authed, origin: ORIGIN },
      payload: { email: "a@example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("missing_header");
  });

  it("rejects /api requests without the session cookie (401 no_session)", async () => {
    h = await makeHarness();
    for (const url of ["/api/health", "/api/status", "/api/settings", "/api/lists", "/api/suppression", "/api/events", "/api/nope"]) {
      const res = await h.app.inject({ method: "GET", url, headers: { host: authed.host } });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe("no_session");
    }
  });

  it("rejects a wrong cookie", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: "/api/health", headers: { host: authed.host, cookie: `md_session=${"b".repeat(64)}` } });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/session sets an HttpOnly SameSite=Strict cookie that then works", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: "/api/session", headers: { host: authed.host } });
    expect(res.statusCode).toBe(204);
    const cookie = cookieOf(res);
    expect(cookie).toContain(`md_session=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    expect(res.body).toBe("");

    const value = /md_session=([^;]+)/.exec(cookie)![1];
    const health = await h.app.inject({ method: "GET", url: "/api/health", headers: { host: authed.host, cookie: `md_session=${value}` } });
    expect(health.statusCode).toBe(200);
  });

  it("never answers CORS, and preflights fail", async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: "OPTIONS",
      url: "/api/suppression",
      headers: { host: authed.host, origin: "http://evil.example", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends anti-framing and no-sniff headers, and no-store on the API", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: "/api/health", headers: authed });
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(String(res.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("error bodies never include stack traces or internal messages", async () => {
    h = await makeHarness({
      extend: (app) => {
        app.get("/api/boom", () => {
          throw new Error("database exploded at /secret/internal/path.ts:42");
        });
      },
    });
    const boom = await h.app.inject({ method: "GET", url: "/api/boom", headers: authed });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: { code: "internal", message: expect.any(String) } });
    expect(boom.body).not.toContain("exploded");
    expect(boom.body).not.toMatch(/\bat \S+:\d+/);

    const badJson = await h.app.inject({
      method: "POST",
      url: "/api/suppression",
      headers: { ...mutating, "content-type": "application/json" },
      payload: '{"email": "hunter2-secret',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json().error.code).toBe("invalid_request");
    expect(badJson.body).not.toContain("hunter2");
    expect(badJson.body).not.toMatch(/\bat \S+:\d+/);

    const missing = await h.app.inject({ method: "GET", url: "/api/nope", headers: authed });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("never returns the SMTP password, the unsubscribe secret, or the session token in a body", async () => {
    const pass = "Very-Secret-SMTP-Pass-42";
    h = await makeHarness({ verifySmtp: async () => Promise.reject(new Error(`535 auth failed for ${pass}`)) });
    const bodies: string[] = [];
    const record = async (opts: InjectOptions) => {
      const res = await h.app.inject(opts);
      bodies.push(res.body);
      return res;
    };
    await record({ method: "PUT", url: "/api/settings", headers: mutating, payload: { smtp: { host: "smtp.example.com", user: "u", pass } } });
    await record({ method: "GET", url: "/api/settings", headers: authed });
    await record({ method: "POST", url: "/api/settings/smtp/test", headers: mutating });
    await record({ method: "GET", url: "/api/health", headers: authed });
    await record({ method: "GET", url: "/api/status", headers: authed });
    await record({ method: "PUT", url: "/api/settings", headers: mutating, payload: { smtp: { pass, port: 0 } } });
    await record({ method: "GET", url: "/", headers: authed });
    const all = bodies.join("\n");
    expect(all).not.toContain(pass);
    expect(all).not.toContain(h.env.UNSUB_SECRET!);
    expect(all).not.toContain(TOKEN);
  });

  it("rejects an oversized JSON body", async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: "POST",
      url: "/api/suppression",
      headers: { ...mutating, "content-type": "application/json" },
      payload: JSON.stringify({ email: "a@example.com", pad: "x".repeat(1_100_000) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("body_too_large");
  });

  it("returns validation errors as 400 invalid_request with zod issues", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "POST", url: "/api/suppression", headers: mutating, payload: { email: "not-an-email" } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("invalid_request");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it("serves a placeholder page with the session cookie when the dashboard is not built", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: "/", headers: { host: authed.host } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("npm run build:web");
    expect(cookieOf(res)).toContain(`md_session=${TOKEN}`);
  });

  it("serves the built dashboard with SPA fallback and sets the cookie on index.html", async () => {
    const webDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "mamadirect-web-"));
    fs.writeFileSync(path.join(webDir, "index.html"), "<!doctype html><title>MamaDirect</title>");
    fs.mkdirSync(path.join(webDir, "assets"));
    fs.writeFileSync(path.join(webDir, "assets", "app.js"), "console.log(1)");
    try {
      h = await makeHarness({ webDir });
      const root = await h.app.inject({ method: "GET", url: "/", headers: { host: authed.host } });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain("<title>MamaDirect</title>");
      expect(cookieOf(root)).toContain(`md_session=${TOKEN}`);

      const deep = await h.app.inject({ method: "GET", url: "/campaigns/3", headers: { host: authed.host } });
      expect(deep.body).toContain("<title>MamaDirect</title>");
      expect(cookieOf(deep)).toContain("md_session=");

      const direct = await h.app.inject({ method: "GET", url: "/index.html", headers: { host: authed.host } });
      expect(cookieOf(direct)).toContain("md_session=");

      const asset = await h.app.inject({ method: "GET", url: "/assets/app.js", headers: { host: authed.host } });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe("console.log(1)");

      const traversal = await h.app.inject({ method: "GET", url: "/assets/../../../etc/passwd", headers: { host: authed.host } });
      expect(traversal.body).not.toContain("root:");
    } finally {
      fs.rmSync(webDir, { recursive: true, force: true });
    }
  });
});
