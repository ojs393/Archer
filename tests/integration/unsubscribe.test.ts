import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { addSuppression, listSuppression } from "../../server/db/suppression.ts";
import { issueToken, signToken } from "../../server/domain/unsubscribe.ts";
import { buildPublicServer } from "../../server/http/publicServer.ts";
import { UNSUB_SECRET, authed, makeHarness, multipart, type Harness } from "./httpHarness.ts";

let h: Harness;
let pub: FastifyInstance | undefined;

afterEach(async () => {
  await pub?.close();
  pub = undefined;
  await h?.close();
});

const host = authed.host;
const suppressed = () => listSuppression(h.db, { limit: 100, offset: 0 }).rows;

describe("unsubscribe on the main listener", () => {
  it("GET shows a confirmation form and does not suppress (link scanners prefetch GETs)", async () => {
    h = await makeHarness();
    const token = signToken("ann@example.com", UNSUB_SECRET);
    const res = await h.app.inject({ method: "GET", url: `/u/${token}`, headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toMatch(/<form[^>]*method="post"/i);
    expect(res.body).toContain("Confirm unsubscribe");
    expect(res.body).toContain("ann@example.com");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(suppressed()).toEqual([]);
  });

  it("POST from the form adds the address to suppression with reason unsubscribe", async () => {
    h = await makeHarness();
    const token = signToken("ann@example.com", UNSUB_SECRET);
    const res = await h.app.inject({
      method: "POST",
      url: `/u/${token}`,
      headers: { host, "content-type": "application/x-www-form-urlencoded" },
      payload: "confirm=1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toMatch(/unsubscribed/i);
    expect(suppressed()).toEqual([{ email: "ann@example.com", reason: "unsubscribe", created_at: expect.any(String) }]);
  });

  it("accepts opaque tokens that never embed the email", async () => {
    h = await makeHarness();
    const token = issueToken(h.db, "opaque@example.com", UNSUB_SECRET);
    expect(token.startsWith(Buffer.from("opaque@example.com", "utf8").toString("base64url") + ".")).toBe(false);
    const res = await h.app.inject({ method: "POST", url: `/u/${token}`, headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(suppressed()).toEqual([{ email: "opaque@example.com", reason: "unsubscribe", created_at: expect.any(String) }]);
  });

  it("accepts an RFC 8058 one-click POST (urlencoded, multipart, or no body), with no Origin or custom header", async () => {
    h = await makeHarness();
    const one = signToken("one@example.com", UNSUB_SECRET);
    const r1 = await h.app.inject({
      method: "POST",
      url: `/u/${one}`,
      headers: { host, "content-type": "application/x-www-form-urlencoded", origin: "https://mail.provider.example" },
      payload: "List-Unsubscribe=One-Click",
    });
    expect(r1.statusCode).toBe(200);

    const two = signToken("two@example.com", UNSUB_SECRET);
    const form = multipart({ "List-Unsubscribe": "One-Click" });
    const r2 = await h.app.inject({ method: "POST", url: `/u/${two}`, headers: { host, ...form.headers }, payload: form.payload });
    expect(r2.statusCode).toBe(200);

    const three = signToken("three@example.com", UNSUB_SECRET);
    const r3 = await h.app.inject({ method: "POST", url: `/u/${three}`, headers: { host } });
    expect(r3.statusCode).toBe(200);

    expect(suppressed().map((r) => r.email).sort()).toEqual(["one@example.com", "three@example.com", "two@example.com"]);
  });

  it("keeps an existing suppression reason and still confirms", async () => {
    h = await makeHarness();
    addSuppression(h.db, "ann@example.com", "hard_bounce");
    const res = await h.app.inject({ method: "POST", url: `/u/${signToken("ann@example.com", UNSUB_SECRET)}`, headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(suppressed()).toEqual([{ email: "ann@example.com", reason: "hard_bounce", created_at: expect.any(String) }]);
  });

  it("rejects an invalid or tampered token with a 400 page", async () => {
    h = await makeHarness();
    const good = signToken("ann@example.com", UNSUB_SECRET);
    const tampered = `${Buffer.from("eve@example.com").toString("base64url")}.${good.split(".")[1]}`;
    for (const token of ["garbage", tampered, signToken("ann@example.com", "x".repeat(64)), "a".repeat(1100)]) {
      for (const method of ["GET", "POST"] as const) {
        const res = await h.app.inject({ method, url: `/u/${token}`, headers: { host } });
        expect(res.statusCode, `${method} ${token.slice(0, 20)}`).toBe(400);
        expect(res.headers["content-type"]).toMatch(/^text\/html/);
        expect(res.body).toMatch(/not valid|invalid/i);
      }
    }
    expect(suppressed()).toEqual([]);
  });

  it("handles long addresses whose token exceeds the default route parameter length", async () => {
    h = await makeHarness();
    const email = `${"a".repeat(60)}.${"b".repeat(3)}@${"sub".repeat(20)}.example.com`;
    const token = signToken(email, UNSUB_SECRET);
    expect(token.length).toBeGreaterThan(150);
    const res = await h.app.inject({ method: "POST", url: `/u/${token}`, headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(suppressed()[0].email).toBe(email);
  });

  it("escapes the address in the page", async () => {
    h = await makeHarness();
    const res = await h.app.inject({ method: "GET", url: `/u/${signToken('"<b>x</b>"@example.com', UNSUB_SECRET)}`, headers: { host } });
    expect(res.body).not.toContain("<b>x</b>");
    expect(res.body).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("rejects an oversized POST body", async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: "POST",
      url: `/u/${signToken("ann@example.com", UNSUB_SECRET)}`,
      headers: { host, "content-type": "application/x-www-form-urlencoded" },
      payload: `x=${"y".repeat(100_000)}`,
    });
    expect(res.statusCode).toBe(413);
    expect(suppressed()).toEqual([]);
  });
});

describe("public listener", () => {
  it("serves /u/:token and /sns for any Host and exposes nothing else", async () => {
    h = await makeHarness();
    pub = buildPublicServer({ db: h.db, env: h.env, log: { info() {}, warn() {}, error() {} } });
    await pub.ready();
    const token = signToken("ann@example.com", UNSUB_SECRET);
    const tunnelHost = { host: "unsub.example.org" };

    const page = await pub.inject({ method: "GET", url: `/u/${token}`, headers: tunnelHost });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Confirm unsubscribe");

    const done = await pub.inject({
      method: "POST",
      url: `/u/${token}`,
      headers: { ...tunnelHost, "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });
    expect(done.statusCode).toBe(200);
    expect(suppressed().map((r) => r.email)).toEqual(["ann@example.com"]);

    expect((await pub.inject({ method: "POST", url: "/sns", headers: tunnelHost, payload: "{" })).statusCode).toBeGreaterThanOrEqual(400);

    for (const [method, url] of [
      ["GET", "/api/settings"],
      ["GET", "/api/session"],
      ["GET", "/api/health"],
      ["GET", "/"],
      ["POST", "/api/suppression"],
      ["GET", "/index.html"],
    ] as const) {
      const res = await pub.inject({ method, url, headers: { ...tunnelHost, cookie: authed.cookie, "x-archer": "1" } });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.body).not.toContain("archer_session");
    }
  });
});
