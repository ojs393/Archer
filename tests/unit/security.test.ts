import { describe, expect, it } from "vitest";
import { checkRequest, readCookies, tokensEqual, type GuardConfig, type GuardInput } from "../../server/http/security.ts";

const TOKEN = "f".repeat(64);
const cfg: GuardConfig = { port: 5199, sessionToken: TOKEN, devOrigin: null };

function req(over: Partial<GuardInput> & { headers?: GuardInput["headers"] } = {}): GuardInput {
  return {
    method: "GET",
    url: "/api/health",
    route: "/api/health",
    ...over,
    headers: { host: "127.0.0.1:5199", cookie: `archer_session=${TOKEN}`, ...over.headers },
  };
}

const post = (headers: GuardInput["headers"] = {}, url = "/api/suppression") =>
  req({ method: "POST", url, route: url, headers: { origin: "http://127.0.0.1:5199", "x-archer": "1", ...headers } });

describe("Host guard (DNS rebinding)", () => {
  it.each(["127.0.0.1:5199", "localhost:5199", "LOCALHOST:5199", "[::1]:5199"])("allows %s", (host) => {
    expect(checkRequest(req({ headers: { host } }), cfg)).toEqual({ ok: true });
  });

  it.each(["evil.example:5199", "127.0.0.1:5200", "127.0.0.1", "localhost", "127.0.0.1:5199.evil.example", "", "127.0.0.2:5199"])(
    "rejects %j",
    (host) => {
      expect(checkRequest(req({ headers: { host } }), cfg)).toMatchObject({ ok: false, status: 403, code: "bad_host" });
    },
  );

  it("rejects a missing Host header", () => {
    expect(checkRequest(req({ headers: { host: undefined } }), cfg)).toMatchObject({ code: "bad_host" });
  });

  it("checks Host before anything else, even for the unsubscribe page", () => {
    const r = checkRequest(req({ url: "/u/abc", route: "/u/:token", headers: { host: "evil.example:5199", cookie: undefined } }), cfg);
    expect(r).toMatchObject({ code: "bad_host" });
  });

  it("skips the Host check only when configured for the public listener", () => {
    const r = checkRequest(
      req({ method: "POST", url: "/u/abc", route: "/u/:token", headers: { host: "unsub.example.org", cookie: undefined } }),
      { ...cfg, checkHost: false },
    );
    expect(r).toEqual({ ok: true });
  });
});

describe("Origin + header guard (localhost CSRF)", () => {
  it("allows a same-origin POST with the header", () => {
    expect(checkRequest(post(), cfg)).toEqual({ ok: true });
  });

  it("allows a POST without Origin when the header is present", () => {
    expect(checkRequest(post({ origin: undefined }), cfg)).toEqual({ ok: true });
  });

  it.each(["http://evil.example", "null", "http://127.0.0.1:5200", "https://127.0.0.1:5199", "http://localhost:5199.evil.example"])(
    "rejects Origin %j",
    (origin) => {
      expect(checkRequest(post({ origin }), cfg)).toMatchObject({ ok: false, status: 403, code: "bad_origin" });
    },
  );

  it("accepts each loopback origin", () => {
    for (const origin of ["http://localhost:5199", "http://[::1]:5199"]) expect(checkRequest(post({ origin }), cfg)).toEqual({ ok: true });
  });

  it("accepts the dev origin only when configured", () => {
    const origin = "http://localhost:5173";
    expect(checkRequest(post({ origin }), cfg)).toMatchObject({ code: "bad_origin" });
    expect(checkRequest(post({ origin }), { ...cfg, devOrigin: "http://localhost:5173/" })).toEqual({ ok: true });
  });

  it.each([undefined, "0", "true", ""])("requires X-Archer: 1 (got %j)", (value) => {
    expect(checkRequest(post({ "x-archer": value }), cfg)).toMatchObject({ ok: false, status: 403, code: "missing_header" });
  });

  it.each(["PUT", "DELETE", "PATCH", "OPTIONS"])("applies to %s", (method) => {
    expect(checkRequest(req({ method, headers: { origin: "http://evil.example", "x-archer": "1" } }), cfg)).toMatchObject({
      code: "bad_origin",
    });
  });

  it("does not require the header or Origin for an unsubscribe POST", () => {
    const r = checkRequest(req({ method: "POST", url: "/u/tok", route: "/u/:token", headers: { cookie: undefined } }), cfg);
    expect(r).toEqual({ ok: true });
  });
});

describe("session guard", () => {
  it("requires the session cookie on /api routes", () => {
    expect(checkRequest(req({ headers: { cookie: undefined } }), cfg)).toMatchObject({ ok: false, status: 401, code: "no_session" });
  });

  it.each([`archer_session=${"e".repeat(64)}`, "archer_session=short", "archer_session=", "other=1", `archer_session_x=${TOKEN}`])(
    "rejects cookie %j",
    (cookie) => {
      expect(checkRequest(req({ headers: { cookie } }), cfg)).toMatchObject({ code: "no_session" });
    },
  );

  it("accepts the cookie among others", () => {
    expect(checkRequest(req({ headers: { cookie: `a=1; archer_session=${TOKEN}; b=2` } }), cfg)).toEqual({ ok: true });
  });

  it("exempts only GET /api/session", () => {
    expect(checkRequest(req({ url: "/api/session", route: "/api/session", headers: { cookie: undefined } }), cfg)).toEqual({ ok: true });
    expect(
      checkRequest(req({ method: "POST", url: "/api/session", route: "/api/session", headers: { cookie: undefined, "x-archer": "1" } }), cfg),
    ).toMatchObject({ code: "no_session" });
  });

  it("requires a session for unmatched /api paths and case or encoding tricks", () => {
    for (const url of ["/api/nope", "/API/settings", "/%61pi/settings", "/api"]) {
      expect(checkRequest(req({ url, route: undefined, headers: { cookie: undefined } }), cfg)).toMatchObject({ code: "no_session" });
    }
  });

  it("does not exempt a /u-looking URL that did not match the unsubscribe route", () => {
    const r = checkRequest(req({ method: "POST", url: "/u/../api/settings", route: undefined, headers: { cookie: undefined } }), cfg);
    expect(r.ok).toBe(false);
  });

  it("lets static GETs through without a cookie", () => {
    expect(checkRequest(req({ url: "/assets/app.js", route: "/*", headers: { cookie: undefined } }), cfg)).toEqual({ ok: true });
  });
});

describe("helpers", () => {
  it("compares tokens in constant time regardless of length", () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(TOKEN, TOKEN.slice(1))).toBe(false);
    expect(tokensEqual("", TOKEN)).toBe(false);
  });

  it("reads every value of a repeated cookie and tolerates bad encoding", () => {
    expect(readCookies("a=1; archer_session=x; archer_session=%E0%A4%A", "archer_session")).toEqual(["x", "%E0%A4%A"]);
    expect(readCookies(undefined, "archer_session")).toEqual([]);
  });
});
