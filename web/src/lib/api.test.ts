import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Api = typeof import("./api");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });
const envelope = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } });

let fetchMock: ReturnType<typeof vi.fn>;
let mod: Api;

function call(i: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init };
}
const headersOf = (i: number) => new Headers(call(i).init.headers);
const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mod = await import("./api");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("GETs same-origin JSON without the CSRF header", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(mod.api.get("/api/status")).resolves.toEqual({ ok: true });
    expect(call(0).url).toBe("/api/status");
    expect(call(0).init.method).toBe("GET");
    expect(call(0).init.credentials).toBe("same-origin");
    expect(headersOf(0).has("x-archer")).toBe(false);
  });

  it("sends X-Archer: 1 and a JSON body on non-GET requests", async () => {
    fetchMock.mockImplementation(async () => json(200, { id: 1 }));
    await mod.api.post("/api/campaigns", { listId: 1 });
    await mod.api.put("/api/settings", { fromName: "A" });
    fetchMock.mockImplementation(async () => noContent());
    await mod.api.del("/api/lists/3");
    for (const i of [0, 1, 2]) expect(headersOf(i).get("x-archer")).toBe("1");
    expect(call(0).init.method).toBe("POST");
    expect(call(1).init.method).toBe("PUT");
    expect(call(2).init.method).toBe("DELETE");
    expect(headersOf(0).get("content-type")).toBe("application/json");
    expect(call(0).init.body).toBe(JSON.stringify({ listId: 1 }));
    expect(call(2).init.body).toBeUndefined();
  });

  it("uploads FormData without forcing a content type", async () => {
    fetchMock.mockResolvedValueOnce(json(202, { listId: 9 }));
    const form = new FormData();
    form.append("name", "Leads");
    await expect(mod.api.upload("/api/lists", form)).resolves.toEqual({ listId: 9 });
    expect(call(0).init.method).toBe("POST");
    expect(call(0).init.body).toBe(form);
    expect(headersOf(0).get("x-archer")).toBe("1");
    expect(headersOf(0).has("content-type")).toBe(false);
  });

  it("resolves 204 responses to undefined", async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await expect(mod.api.del("/api/suppression/a%40b.c")).resolves.toBeUndefined();
  });

  it("serialises query parameters and skips empty ones", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { rows: [] }));
    await mod.api.get("/api/suppression", { query: { search: "a b", limit: 10, offset: undefined, x: null } });
    expect(call(0).url).toBe("/api/suppression?search=a+b&limit=10");
  });

  it("turns the server error envelope into an ApiError", async () => {
    fetchMock.mockResolvedValueOnce(envelope(409, "gates_failed", "Launch checks failed", [{ key: "dns_ok" }]));
    const err = await mod.api.post("/api/campaigns/1/start").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mod.ApiError);
    expect(err).toMatchObject({ status: 409, code: "gates_failed", message: "Launch checks failed", details: [{ key: "dns_ok" }] });
    expect(mod.isApiError(err, "gates_failed")).toBe(true);
    expect(mod.isApiError(err, "other")).toBe(false);
  });

  it("maps a non-JSON error to a generic ApiError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(mod.api.get("/api/health")).rejects.toMatchObject({ status: 502, code: "http_error" });
  });

  it("maps a network failure to status 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(mod.api.get("/api/health")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("lets aborts through untouched", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(mod.api.get("/api/health")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("re-opens the session once on 401 and retries the request", async () => {
    fetchMock
      .mockResolvedValueOnce(envelope(401, "no_session", "Session expired"))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(200, { campaign: null }));
    await expect(mod.api.get("/api/status")).resolves.toEqual({ campaign: null });
    expect(urls()).toEqual(["/api/status", "/api/session", "/api/status"]);
  });

  it("gives up after one retry when the session cannot be restored", async () => {
    fetchMock
      .mockResolvedValueOnce(envelope(401, "no_session", "Session expired"))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(envelope(401, "no_session", "Session expired"));
    await expect(mod.api.post("/api/settings/smtp/test")).rejects.toMatchObject({ status: 401, code: "no_session" });
    expect(urls()).toEqual(["/api/settings/smtp/test", "/api/session", "/api/settings/smtp/test"]);
  });

  it("shares one session refresh between concurrent 401s", async () => {
    let statusCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/session") return noContent();
      statusCalls++;
      return statusCalls <= 2 ? envelope(401, "no_session", "x") : json(200, { url });
    });
    await Promise.all([mod.api.get("/api/status"), mod.api.get("/api/health")]);
    expect(urls().filter((u) => u === "/api/session")).toHaveLength(1);
  });

  it("opens the session once however often ensureSession is called", async () => {
    fetchMock.mockImplementation(async () => noContent());
    await Promise.all([mod.ensureSession(), mod.ensureSession()]);
    await mod.ensureSession();
    expect(urls()).toEqual(["/api/session"]);
    expect(call(0).init.credentials).toBe("same-origin");
  });

  it("retries opening the session after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("down")).mockResolvedValueOnce(noContent());
    await expect(mod.ensureSession()).rejects.toMatchObject({ code: "network_error" });
    await expect(mod.ensureSession()).resolves.toBeUndefined();
    expect(urls()).toEqual(["/api/session", "/api/session"]);
  });
});
