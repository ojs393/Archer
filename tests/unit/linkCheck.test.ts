import { describe, expect, it } from "vitest";
import {
  acknowledgeLink,
  buildLinkCheck,
  checkLinks,
  extractLinks,
  isPrivateAddress,
  linksPass,
  type FetchLike,
  type LookupFn,
} from "../../server/templates/linkCheck.ts";

const PUBLIC_LOOKUP: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

type Route = { status: number; location?: string } | "network" | "hang";

function fakeFetch(routes: Record<string, Route | Partial<Record<"HEAD" | "GET", Route>>>) {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const method = init.method ?? "GET";
    calls.push({ url, method });
    const entry = routes[url];
    const route: Route | undefined =
      entry === undefined || typeof entry === "string" || "status" in entry ? (entry as Route | undefined) : entry[method as "HEAD" | "GET"];
    if (route === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    if (route === "network") return Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    if (route === "hang") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    const headers = route.location ? { location: route.location } : undefined;
    return Promise.resolve(new Response(null, { status: route.status, headers }));
  };
  return { fetchImpl, calls };
}

describe("extractLinks", () => {
  it("finds unique absolute http(s) links in href/src attributes and bare text URLs", () => {
    const html = `
      <a href="https://a.example/x?p=1&amp;q=2">A</a>
      <a href='http://b.example/'>B</a>
      <img src=https://img.example/logo.png alt="">
      <a HREF = "https://a.example/x?p=1&q=2">dupe</a>
      <a href="/relative">rel</a><a href="#top">top</a>
      <a href="mailto:hi@example.com">mail</a><a href="tel:+1">tel</a>
      <a href="https://c.example/?e={{email}}">var</a>
      <a href="{{ website | https://d.example }}">var2</a>
      <a href="{{unsubscribe_url}}">Unsubscribe</a>
      <a href=" {{ unsubscribe_url }} ">Unsubscribe</a>`;
    const text = "Visit https://e.example/page. Or (https://f.example/a) and https://a.example/x?p=1&q=2, mailto:x@y.example";
    expect(extractLinks(html, text)).toEqual({
      urls: [
        "https://a.example/x?p=1&q=2",
        "http://b.example/",
        "https://img.example/logo.png",
        "https://e.example/page",
        "https://f.example/a",
      ],
      variableLinks: ["https://c.example/?e={{email}}", "{{ website | https://d.example }}"],
    });
  });

  it("handles a null text part", () => {
    expect(extractLinks('<a href="https://a.example">x</a>', null)).toEqual({ urls: ["https://a.example"], variableLinks: [] });
  });
});

describe("isPrivateAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.255.0.9", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.0.10", true],
    ["169.254.169.254", true],
    ["0.0.0.0", true],
    ["8.8.8.8", false],
    ["::1", true],
    ["::", true],
    ["::127.0.0.1", true],
    ["fc00::1", true],
    ["fdff::1", true],
    ["fe80::1", true],
    ["::ffff:192.168.1.1", true],
    ["::ffff:8.8.8.8", false],
    ["2606:4700::1111", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("checkLinks", () => {
  it("reports a 200 as ok and a 404 as broken", async () => {
    const { fetchImpl } = fakeFetch({
      "https://ok.example/": { status: 200 },
      "https://missing.example/": { status: 404 },
    });
    const results = await checkLinks(["https://ok.example/", "https://missing.example/"], { fetchImpl, lookup: PUBLIC_LOOKUP });
    expect(results).toEqual([
      { url: "https://ok.example/", ok: true, status: 200, finalUrl: "https://ok.example/", error: null },
      { url: "https://missing.example/", ok: false, status: 404, finalUrl: "https://missing.example/", error: "HTTP 404" },
    ]);
  });

  it("follows a redirect chain and reports the final URL", async () => {
    const { fetchImpl } = fakeFetch({
      "http://old.example/": { status: 301, location: "https://old.example/" },
      "https://old.example/": { status: 302, location: "/new" },
      "https://old.example/new": { status: 200 },
    });
    const [r] = await checkLinks(["http://old.example/"], { fetchImpl, lookup: PUBLIC_LOOKUP });
    expect(r).toEqual({ url: "http://old.example/", ok: true, status: 200, finalUrl: "https://old.example/new", error: null });
  });

  it("falls back to GET when HEAD is refused or fails", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://nohead.example/": { HEAD: { status: 405 }, GET: { status: 200 } },
      "https://forbidden.example/": { HEAD: { status: 403 }, GET: { status: 200 } },
      "https://flaky.example/": { HEAD: "network", GET: { status: 204 } },
    });
    const results = await checkLinks(["https://nohead.example/", "https://forbidden.example/", "https://flaky.example/"], {
      fetchImpl,
      lookup: PUBLIC_LOOKUP,
    });
    expect(results.map((r) => [r.ok, r.status])).toEqual([
      [true, 200],
      [true, 200],
      [true, 204],
    ]);
    expect(calls.filter((c) => c.url === "https://nohead.example/").map((c) => c.method)).toEqual(["HEAD", "GET"]);
  });

  it("reports a network error on both HEAD and GET", async () => {
    const { fetchImpl } = fakeFetch({ "https://down.example/": "network" });
    const [r] = await checkLinks(["https://down.example/"], { fetchImpl, lookup: PUBLIC_LOOKUP });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/ECONNREFUSED/);
    expect(r.error).not.toMatch(/\n/);
  });

  it("stops after 5 redirects", async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 7; i++) routes[`https://loop.example/${i}`] = { status: 302, location: `https://loop.example/${i + 1}` };
    const { fetchImpl, calls } = fakeFetch(routes);
    const [r] = await checkLinks(["https://loop.example/0"], { fetchImpl, lookup: PUBLIC_LOOKUP });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too many redirects/i);
    expect(calls).toHaveLength(6);
  });

  it("times out a link that never answers", async () => {
    const { fetchImpl } = fakeFetch({ "https://slow.example/": "hang" });
    const [r] = await checkLinks(["https://slow.example/"], { fetchImpl, lookup: PUBLIC_LOOKUP, timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  });

  it("refuses private, loopback and link-local targets without fetching them", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const lookup: LookupFn = async (host) => {
      if (host === "intranet.example") return [{ address: "10.0.0.5", family: 4 }];
      if (host === "mixed.example") return [{ address: "93.184.216.34", family: 4 }, { address: "fd00::1", family: 6 }];
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const urls = [
      "http://127.0.0.1:5199/api/settings",
      "http://localhost/",
      "http://app.localhost/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data",
      "https://intranet.example/",
      "https://mixed.example/",
    ];
    const results = await checkLinks(urls, { fetchImpl, lookup });
    expect(results).toHaveLength(urls.length);
    for (const r of results) expect(r).toMatchObject({ ok: false, status: null, error: "private address" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a redirect into a private address or a non-http scheme", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://evil.example/": { status: 302, location: "http://127.0.0.1:5199/api/session" },
      "https://ftp.example/": { status: 302, location: "ftp://files.example/x" },
    });
    const [priv, ftp] = await checkLinks(["https://evil.example/", "https://ftp.example/"], { fetchImpl, lookup: PUBLIC_LOOKUP });
    expect(priv).toMatchObject({ ok: false, error: "private address", finalUrl: "http://127.0.0.1:5199/api/session" });
    expect(ftp).toMatchObject({ ok: false, error: "redirected to a non-http(s) URL" });
    expect(calls.map((c) => c.url)).not.toContain("http://127.0.0.1:5199/api/session");
  });

  it("reports a host that does not resolve", async () => {
    const { fetchImpl } = fakeFetch({});
    const lookup: LookupFn = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.example"), { code: "ENOTFOUND" });
    };
    const [r] = await checkLinks(["https://nowhere.example/"], { fetchImpl, lookup });
    expect(r).toMatchObject({ ok: false, status: null, error: "could not resolve nowhere.example" });
  });

  it("checks at most `concurrency` links at a time", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return new Response(null, { status: 200 });
    };
    const urls = Array.from({ length: 10 }, (_, i) => `https://n${i}.example/`);
    const results = await checkLinks(urls, { fetchImpl, lookup: PUBLIC_LOOKUP, concurrency: 3 });
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(peak).toBe(3);
  });
});

describe("buildLinkCheck / acknowledgeLink / linksPass", () => {
  const probes = [
    { url: "https://ok.example/", ok: true, status: 200, finalUrl: "https://ok.example/", error: null },
    { url: "https://bad.example/", ok: false, status: 404, finalUrl: "https://bad.example/", error: "HTTP 404" },
  ];

  it("adds variable links as not checkable and keeps acknowledgements only for the same version", () => {
    const first = buildLinkCheck(3, probes, ["https://x.example/?e={{email}}"], null, new Date("2026-10-26T00:00:00Z"));
    expect(first).toEqual({
      version: 3,
      checkedAt: "2026-10-26T00:00:00.000Z",
      links: [
        { ...probes[0], acknowledged: false },
        { ...probes[1], acknowledged: false },
        {
          url: "https://x.example/?e={{email}}",
          ok: false,
          status: null,
          finalUrl: null,
          error: "contains a template variable; it cannot be checked",
          acknowledged: false,
        },
      ],
    });
    expect(linksPass(first, 3)).toBe(false);

    const acked = acknowledgeLink(acknowledgeLink(first, "https://bad.example/")!, "https://x.example/?e={{email}}")!;
    expect(linksPass(acked, 3)).toBe(true);
    expect(linksPass(acked, 4)).toBe(false);
    expect(acknowledgeLink(first, "https://unknown.example/")).toBeNull();

    const rerunSameVersion = buildLinkCheck(3, probes, ["https://x.example/?e={{email}}"], acked, new Date());
    expect(rerunSameVersion.links.every((l) => l.ok || l.acknowledged)).toBe(true);
    const rerunNewVersion = buildLinkCheck(4, probes, [], acked, new Date());
    expect(rerunNewVersion.links.find((l) => l.url === "https://bad.example/")?.acknowledged).toBe(false);
  });

  it("passes an empty link check", () => {
    expect(linksPass(buildLinkCheck(1, [], [], null, new Date()), 1)).toBe(true);
    expect(linksPass(null, 1)).toBe(false);
  });
});
