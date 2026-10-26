import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getFreePort } from "../../server/config.ts";
import { EventHub, formatEvent } from "../../server/http/events.ts";
import { buildServer } from "../../server/http/server.ts";
import { TOKEN, authed, makeHarness, waitFor, type Harness } from "./httpHarness.ts";

let h: Harness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

function parseStream(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.includes("event: "))
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))!.slice(7);
      const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
      expect(data).toHaveLength(1);
      return { event, data: JSON.parse(data[0]) };
    });
}

describe("formatEvent", () => {
  it("frames JSON on one data line, even when strings contain newlines", () => {
    const text = formatEvent("import", { msg: "line1\nline2\r\nline3", n: 1 });
    expect(text).toBe('event: import\ndata: {"msg":"line1\\nline2\\r\\nline3","n":1}\n\n');
  });

  it("refuses event names that could break framing", () => {
    expect(() => formatEvent("bad\nname", {})).toThrow();
    expect(() => formatEvent("", {})).toThrow();
  });

  it("escapes U+2028/U+2029 so data stays on one line", () => {
    expect(formatEvent("x", { s: "a\u2028b\u2029c" })).not.toMatch(/[\u2028\u2029]/);
  });
});

describe("GET /api/events", () => {
  it("streams published events with correct framing, and closeAll ends the stream", async () => {
    h = await makeHarness();
    const pending = h.app.inject({ method: "GET", url: "/api/events", headers: authed });
    await waitFor(() => h!.events.size === 1);
    h.events.publish("import", { listId: 7, phase: "parsing", rowsProcessed: 1000 });
    h.events.publish("worker", { type: "sent", campaignId: 1, message: "Sent to a@example.com", at: "2026-10-26T00:00:00Z" });
    h.events.closeAll();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const events = parseStream(res.body);
    expect(events[0].event).toBe("status");
    expect(events[0].data).toMatchObject({ campaign: null, worker: { loopRunning: false, inFlight: false } });
    expect(events).toContainEqual({ event: "import", data: { listId: 7, phase: "parsing", rowsProcessed: 1000 } });
    expect(events.map((e) => e.event)).toContain("worker");
    expect(h.events.size).toBe(0);
  });

  it("answers HEAD promptly without leaving a subscriber in the hub", async () => {
    h = await makeHarness();
    const res = await Promise.race([
      h.app.inject({ method: "HEAD", url: "/api/events", headers: authed }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2000)),
    ]);
    expect(res).not.toBe("hung");
    if (res !== "hung") expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(h.events.size).toBe(0);
  });

  it("sends a comment ping on the interval", async () => {
    const hub = new EventHub({ pingMs: 20 });
    const server = http.createServer((_req, res) => hub.subscribe(res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const text = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.includes(": ping")) {
              res.destroy();
              resolve(body);
            }
          });
        })
        .on("error", reject);
    });
    expect(text).toContain(": ping\n\n");
    await waitFor(() => hub.size === 0);
    hub.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("drops a client that disconnects", async () => {
    const port = await getFreePort(20_000 + Math.floor(Math.random() * 20_000));
    h = await makeHarness({ build: (deps) => buildServer({ ...deps, port }) });
    await h.app.listen({ host: "127.0.0.1", port });
    const received = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, cookie: `md_session=${TOKEN}` } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (!body.includes("event: status")) return;
            req.destroy();
            resolve(body);
          });
        },
      );
      req.on("error", () => {});
      req.setTimeout(5000, () => reject(new Error("no data")));
    });
    expect(received).toContain("event: status");
    await waitFor(() => h!.events.size === 0);
    h.events.publish("import", { listId: 1, phase: "done" });
  });

  it("closeAll lets app.close() finish while a real stream is open", async () => {
    const port = await getFreePort(20_000 + Math.floor(Math.random() * 20_000));
    h = await makeHarness({ build: (deps) => buildServer({ ...deps, port }) });
    await h.app.listen({ host: "127.0.0.1", port });
    const ended = new Promise<void>((resolve) => {
      http.get(
        { host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, cookie: `md_session=${TOKEN}` } },
        (res) => {
          res.resume();
          res.on("end", () => resolve());
        },
      );
    });
    await waitFor(() => h!.events.size === 1);
    h.events.closeAll();
    await ended;
    const started = Date.now();
    await h.app.close();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
