import { promises as dnsPromises } from "node:dns";
import { domainToASCII } from "node:url";

export interface AuthResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

export interface DnsAuthPart {
  ok: boolean;
  detail: string;
  /** Value operators should publish (TXT / host hint). Prefer this over `record` when copying. */
  expected: string | null;
}

export interface DnsTxtPart extends DnsAuthPart {
  record: string | null;
}

export interface DnsDkimPart extends DnsAuthPart {
  selector: string | null;
}

export interface DnsAuthResult {
  domain: string;
  ok: boolean;
  spf: DnsTxtPart;
  dkim: DnsDkimPart;
  dmarc: DnsTxtPart;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA"]);
const SELECTOR = /^[a-z0-9](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_-]{1,63})*$/i;
const NO_SELECTOR = "Enter your email provider's DKIM selector";
const DEFAULT_SPF_EXPECTED = "v=spf1 include:YOUR_PROVIDER ~all";
const DMARC_EXPECTED = "v=DMARC1; p=none;";

type Lookup<T> = { ok: true; value: T } | { ok: false; missing: boolean; detail: string };

function lookup<T>(query: () => Promise<T>, timeoutMs: number): Promise<Lookup<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, missing: false, detail: "DNS lookup timed out" }), timeoutMs);
    Promise.resolve()
      .then(query)
      .then(
        (value) => resolve({ ok: true, value }),
        (err: unknown) => {
          const code = String((err as { code?: unknown })?.code ?? "unknown error");
          resolve({ ok: false, missing: NOT_FOUND.has(code), detail: `DNS lookup failed (${code})` });
        },
      )
      .finally(() => clearTimeout(timer));
  });
}

function txtRecords(chunks: string[][]): string[] {
  return chunks.map((parts) => parts.join(""));
}

function startsWithTag(record: string, tag: string): boolean {
  const head = record.trimStart().slice(0, tag.length + 1);
  return head.slice(0, tag.length).toLowerCase() === tag.toLowerCase() && /^(?:[\s;]|$)/.test(head.slice(tag.length));
}

async function singleRecord(
  name: string,
  tag: string,
  label: string,
  resolver: AuthResolver,
  timeoutMs: number,
  expected: string | null,
): Promise<DnsTxtPart> {
  const r = await lookup(() => resolver.resolveTxt(name), timeoutMs);
  if (!r.ok && !r.missing) return { ok: false, record: null, detail: `${label}: ${r.detail} for ${name}`, expected };
  const found = r.ok ? txtRecords(r.value).filter((rec) => startsWithTag(rec, tag)) : [];
  if (found.length === 0) return { ok: false, record: null, detail: `No ${label} record (TXT starting "${tag}") found at ${name}`, expected };
  if (found.length > 1) {
    return { ok: false, record: found[0], detail: `${found.length} ${label} records at ${name}; there must be exactly one`, expected };
  }
  return { ok: true, record: found[0], detail: `${label} record found at ${name}`, expected };
}

async function dkimRecord(
  domain: string,
  selector: string | null,
  resolver: AuthResolver,
  timeoutMs: number,
): Promise<DnsDkimPart> {
  const expected = selector && SELECTOR.test(selector) ? `${selector}._domainkey.${domain}` : null;
  if (!selector) return { ok: false, selector: null, detail: NO_SELECTOR, expected: null };
  if (!SELECTOR.test(selector)) return { ok: false, selector, detail: `"${selector}" is not a valid DKIM selector`, expected: null };
  const name = `${selector}._domainkey.${domain}`;
  const txt = await lookup(() => resolver.resolveTxt(name), timeoutMs);
  if (txt.ok && txtRecords(txt.value).some((rec) => startsWithTag(rec, "v=DKIM1") || /(?:^|;)\s*p=/.test(rec))) {
    return { ok: true, selector, detail: `DKIM key found at ${name}`, expected };
  }
  const cname = await lookup(() => resolver.resolveCname(name), timeoutMs);
  if (cname.ok && cname.value.length > 0) return { ok: true, selector, detail: `DKIM delegated: ${name} is a CNAME to ${cname.value[0]}`, expected };
  if (!txt.ok && !txt.missing) return { ok: false, selector, detail: `DKIM: ${txt.detail} for ${name}`, expected };
  return { ok: false, selector, detail: `No DKIM record found at ${name}`, expected };
}

export async function checkDomainAuth(
  domain: string,
  dkimSelector: string | null,
  resolver: AuthResolver = new dnsPromises.Resolver({ timeout: DEFAULT_TIMEOUT_MS, tries: 1 }),
  opts: { timeoutMs?: number; spfExpected?: string | null } = {},
): Promise<DnsAuthResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spfExpected = opts.spfExpected === undefined ? DEFAULT_SPF_EXPECTED : opts.spfExpected;
  const name = domainToASCII(domain.trim().toLowerCase());
  if (!name || !name.includes(".")) {
    const detail = `"${domain}" is not a valid domain`;
    return {
      domain,
      ok: false,
      spf: { ok: false, record: null, detail, expected: null },
      dkim: { ok: false, selector: dkimSelector, detail, expected: null },
      dmarc: { ok: false, record: null, detail, expected: null },
    };
  }
  const [spf, dkim, dmarc] = await Promise.all([
    singleRecord(name, "v=spf1", "SPF", resolver, timeoutMs, spfExpected),
    dkimRecord(name, dkimSelector, resolver, timeoutMs),
    singleRecord(`_dmarc.${name}`, "v=DMARC1", "DMARC", resolver, timeoutMs, DMARC_EXPECTED),
  ]);
  return { domain: name, ok: spf.ok && dkim.ok && dmarc.ok, spf, dkim, dmarc };
}
