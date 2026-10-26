import { describe, expect, it } from "vitest";
import { checkDomainAuth, type AuthResolver } from "../../server/dns/check.ts";

function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed ${code}`), { code });
}

function fakeResolver(txt: Record<string, string[][]>, cname: Record<string, string[]> = {}): AuthResolver & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async resolveTxt(name) {
      asked.push(`TXT ${name}`);
      if (txt[name]) return txt[name];
      throw dnsError("ENOTFOUND");
    },
    async resolveCname(name) {
      asked.push(`CNAME ${name}`);
      if (cname[name]) return cname[name];
      throw dnsError("ENODATA");
    },
  };
}

const GOOD = {
  "example.com": [["v=spf1 include:_spf.provider.com ~all"], ["google-site-verification=abc"]],
  "_dmarc.example.com": [["v=DMARC1; p=none; rua=mailto:d@example.com"]],
  "s1._domainkey.example.com": [["v=DKIM1; k=rsa; p=MIIBIjAN", "BgkqhkiG9w0B"]],
};

describe("checkDomainAuth", () => {
  it("passes when SPF, DKIM and DMARC are all present", async () => {
    const r = await checkDomainAuth("example.com", "s1", fakeResolver(GOOD));
    expect(r.ok).toBe(true);
    expect(r.domain).toBe("example.com");
    expect(r.spf).toEqual({ ok: true, record: "v=spf1 include:_spf.provider.com ~all", detail: expect.any(String) });
    expect(r.dmarc.ok).toBe(true);
    expect(r.dmarc.record).toBe("v=DMARC1; p=none; rua=mailto:d@example.com");
    expect(r.dkim).toEqual({ ok: true, selector: "s1", detail: expect.any(String) });
  });

  it("fails DMARC when the record is missing", async () => {
    const { "_dmarc.example.com": _omit, ...rest } = GOOD;
    const r = await checkDomainAuth("example.com", "s1", fakeResolver(rest));
    expect(r.ok).toBe(false);
    expect(r.dmarc.ok).toBe(false);
    expect(r.dmarc.record).toBeNull();
    expect(r.dmarc.detail).toMatch(/_dmarc\.example\.com/);
    expect(r.spf.ok).toBe(true);
  });

  it("asks for a selector when none is configured, without querying DKIM", async () => {
    const resolver = fakeResolver(GOOD);
    const r = await checkDomainAuth("example.com", null, resolver);
    expect(r.dkim).toEqual({ ok: false, selector: null, detail: "Enter your email provider's DKIM selector" });
    expect(r.ok).toBe(false);
    expect(resolver.asked.some((q) => q.includes("_domainkey"))).toBe(false);
  });

  it("fails SPF when there is more than one v=spf1 record", async () => {
    const r = await checkDomainAuth(
      "example.com",
      "s1",
      fakeResolver({ ...GOOD, "example.com": [["v=spf1 -all"], ["v=spf1 include:x.com ~all"]] }),
    );
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/exactly one|more than one/i);
  });

  it("does not mistake v=spf10 or a DMARC lookalike for a record", async () => {
    const r = await checkDomainAuth(
      "example.com",
      "s1",
      fakeResolver({ ...GOOD, "example.com": [["v=spf10 nope"]], "_dmarc.example.com": [["v=DMARC10"]] }),
    );
    expect(r.spf.ok).toBe(false);
    expect(r.dmarc.ok).toBe(false);
  });

  it("accepts a DKIM CNAME delegation", async () => {
    const { "s1._domainkey.example.com": _omit, ...rest } = GOOD;
    const r = await checkDomainAuth(
      "example.com",
      "s1",
      fakeResolver(rest, { "s1._domainkey.example.com": ["s1.dkim.provider.net"] }),
    );
    expect(r.dkim.ok).toBe(true);
    expect(r.dkim.detail).toContain("s1.dkim.provider.net");
  });

  it("reports a missing DKIM record at the selector", async () => {
    const { "s1._domainkey.example.com": _omit, ...rest } = GOOD;
    const r = await checkDomainAuth("example.com", "s1", fakeResolver(rest));
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.detail).toContain("s1._domainkey.example.com");
  });

  it("times out a hung lookup instead of waiting forever", async () => {
    const hung: AuthResolver = {
      resolveTxt: () => new Promise(() => {}),
      resolveCname: () => new Promise(() => {}),
    };
    const started = Date.now();
    const r = await checkDomainAuth("example.com", "s1", hung, { timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.ok).toBe(false);
    expect(r.spf.detail).toMatch(/timed out/i);
  });

  it("rejects a malformed domain or selector without querying", async () => {
    const resolver = fakeResolver(GOOD);
    const r = await checkDomainAuth("exa mple.com", "bad selector", resolver);
    expect(r.ok).toBe(false);
    expect(resolver.asked).toEqual([]);
  });

  it("reports a resolver failure with its code but no stack", async () => {
    const broken: AuthResolver = {
      resolveTxt: async () => {
        throw dnsError("ESERVFAIL");
      },
      resolveCname: async () => {
        throw dnsError("ESERVFAIL");
      },
    };
    const r = await checkDomainAuth("example.com", "s1", broken);
    expect(r.spf.detail).toContain("ESERVFAIL");
    expect(JSON.stringify(r)).not.toMatch(/\bat \S+:\d+/);
  });
});
