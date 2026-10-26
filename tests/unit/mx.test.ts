import { describe, expect, it } from "vitest";
import { checkDomains, createDomainChecker, type DnsLike, type DomainStatus } from "../../server/import/mx.ts";

type Answer<T> = T | { code: string } | "hang";

interface FakeZone {
  mx?: Answer<{ exchange: string; priority: number }[]>;
  a?: Answer<string[]>;
  aaaa?: Answer<string[]>;
}

function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed ${code}`), { code });
}

function answer<T>(value: Answer<T> | undefined): Promise<T> {
  if (value === undefined) return Promise.reject(dnsError("ENOTFOUND"));
  if (value === "hang") return new Promise<T>(() => {});
  if (typeof value === "object" && value !== null && "code" in value) return Promise.reject(dnsError(value.code));
  return Promise.resolve(value as T);
}

function fakeDns(zones: Record<string, FakeZone>) {
  const calls: string[] = [];
  const dns: DnsLike = {
    resolveMx: (d) => {
      calls.push(`mx:${d}`);
      return answer(zones[d]?.mx);
    },
    resolve4: (d) => {
      calls.push(`a:${d}`);
      return answer(zones[d]?.a);
    },
    resolve6: (d) => {
      calls.push(`aaaa:${d}`);
      return answer(zones[d]?.aaaa);
    },
  };
  return { dns, calls };
}

const NODATA = { code: "ENODATA" };

describe("createDomainChecker", () => {
  it("is ok when an MX record exists", async () => {
    const { dns } = fakeDns({ "good.com": { mx: [{ exchange: "mx.good.com", priority: 10 }] } });
    expect(await createDomainChecker({ dns })("good.com")).toBe("ok");
  });

  it("is ok when one of several MX records is real", async () => {
    const { dns } = fakeDns({
      "mixed.com": { mx: [{ exchange: ".", priority: 0 }, { exchange: "mx.mixed.com", priority: 10 }] },
    });
    expect(await createDomainChecker({ dns })("mixed.com")).toBe("ok");
  });

  it("is ok with no MX but an A record", async () => {
    const { dns } = fakeDns({ "a-only.com": { mx: NODATA, a: ["192.0.2.1"], aaaa: NODATA } });
    expect(await createDomainChecker({ dns })("a-only.com")).toBe("ok");
  });

  it("is ok with no MX but an AAAA record", async () => {
    const { dns } = fakeDns({ "v6.com": { mx: [], a: NODATA, aaaa: ["2001:db8::1"] } });
    expect(await createDomainChecker({ dns })("v6.com")).toBe("ok");
  });

  it("is invalid when MX, A and AAAA are all NXDOMAIN", async () => {
    const { dns } = fakeDns({});
    expect(await createDomainChecker({ dns })("nope.invalid-tld-example.com")).toBe("invalid");
  });

  it("is invalid when MX, A and AAAA are all NODATA", async () => {
    const { dns } = fakeDns({ "empty.com": { mx: NODATA, a: NODATA, aaaa: NODATA } });
    expect(await createDomainChecker({ dns })("empty.com")).toBe("invalid");
  });

  it.each([[[{ exchange: ".", priority: 0 }]], [[{ exchange: "", priority: 0 }]]])(
    "is invalid on a null MX %j even with an A record",
    async (mx) => {
      const { dns } = fakeDns({ "nullmx.com": { mx, a: ["192.0.2.1"] } });
      expect(await createDomainChecker({ dns })("nullmx.com")).toBe("invalid");
    },
  );

  it("is unknown when every lookup times out", async () => {
    const { dns } = fakeDns({ "slow.com": { mx: "hang", a: "hang", aaaa: "hang" } });
    const started = Date.now();
    expect(await createDomainChecker({ dns, timeoutMs: 20 })("slow.com")).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each(["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"])("is unknown when MX fails with %s and there is no A/AAAA", async (code) => {
    const { dns } = fakeDns({ "flaky.com": { mx: { code }, a: NODATA, aaaa: NODATA } });
    expect(await createDomainChecker({ dns })("flaky.com")).toBe("unknown");
  });

  it("is unknown when A fails with SERVFAIL after MX NODATA", async () => {
    const { dns } = fakeDns({ "flaky.com": { mx: NODATA, a: { code: "ESERVFAIL" }, aaaa: NODATA } });
    expect(await createDomainChecker({ dns })("flaky.com")).toBe("unknown");
  });

  it("is ok when MX fails transiently but an A record answers", async () => {
    const { dns } = fakeDns({ "half.com": { mx: { code: "ETIMEOUT" }, a: ["192.0.2.1"], aaaa: NODATA } });
    expect(await createDomainChecker({ dns })("half.com")).toBe("ok");
  });

  it("never rejects when the resolver throws synchronously", async () => {
    const dns: DnsLike = {
      resolveMx: () => {
        throw new Error("boom");
      },
      resolve4: () => Promise.reject(dnsError("ENOTFOUND")),
      resolve6: () => Promise.reject(dnsError("ENOTFOUND")),
    };
    expect(await createDomainChecker({ dns })("boom.com")).toBe("unknown");
  });

  it("caches per domain so the resolver is queried once", async () => {
    const { dns, calls } = fakeDns({ "good.com": { mx: [{ exchange: "mx.good.com", priority: 10 }] } });
    const check = createDomainChecker({ dns });
    const results = await Promise.all([check("good.com"), check("good.com"), check("GOOD.com")]);
    await check("good.com");
    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(calls.filter((c) => c.startsWith("mx:"))).toEqual(["mx:good.com"]);
  });

  it("queries internationalized domains in ASCII form", async () => {
    const { dns, calls } = fakeDns({ "xn--exmple-cua.com": { mx: [{ exchange: "mx.example.com", priority: 1 }] } });
    expect(await createDomainChecker({ dns })("exämple.com")).toBe("ok");
    expect(calls).toContain("mx:xn--exmple-cua.com");
  });
});

describe("checkDomains", () => {
  function deferredChecker(statuses: Record<string, DomainStatus>) {
    let inFlight = 0;
    let maxInFlight = 0;
    const check = async (d: string): Promise<DomainStatus> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1 + (d.length % 3)));
      inFlight--;
      return statuses[d] ?? "unknown";
    };
    return { check, maxInFlight: () => maxInFlight };
  }

  it("maps every domain to its status", async () => {
    const { check } = deferredChecker({ "a.com": "ok", "b.com": "invalid" });
    const result = await checkDomains(["a.com", "b.com", "c.com"], check);
    expect(Object.fromEntries(result)).toEqual({ "a.com": "ok", "b.com": "invalid", "c.com": "unknown" });
  });

  it("never exceeds the default concurrency of 10", async () => {
    const domains = Array.from({ length: 57 }, (_, i) => `d${i}.com`);
    const { check, maxInFlight } = deferredChecker({});
    await checkDomains(domains, check);
    expect(maxInFlight()).toBe(10);
  });

  it("never exceeds a custom concurrency", async () => {
    const domains = Array.from({ length: 20 }, (_, i) => `d${i}.com`);
    const { check, maxInFlight } = deferredChecker({});
    await checkDomains(domains, check, 3);
    expect(maxInFlight()).toBe(3);
  });

  it("reports progress after each domain, ending at total", async () => {
    const domains = ["a.com", "b.com", "c.com", "d.com"];
    const { check } = deferredChecker({});
    const seen: [number, number][] = [];
    await checkDomains(domains, check, 2, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });

  it("treats a rejecting checker as unknown", async () => {
    const result = await checkDomains(["x.com"], () => Promise.reject(new Error("dns down")));
    expect(result.get("x.com")).toBe("unknown");
  });

  it("returns an empty map for no domains", async () => {
    const result = await checkDomains([], () => Promise.resolve("ok"));
    expect(result.size).toBe(0);
  });
});
