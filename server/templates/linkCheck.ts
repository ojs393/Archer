import { promises as dns } from "node:dns";
import { isIP, isIPv4 } from "node:net";

export interface LinkProbe {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  error: string | null;
}

export interface LinkResult extends LinkProbe {
  acknowledged: boolean;
}

export interface LinkCheck {
  version: number;
  checkedAt: string;
  links: LinkResult[];
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

export interface CheckLinksOptions {
  fetchImpl?: FetchLike;
  lookup?: LookupFn;
  timeoutMs?: number;
  concurrency?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_REDIRECTS = 5;
const MAX_ERROR_LENGTH = 200;
const USER_AGENT = "MamaDirect-LinkCheck/1.0";
const PRIVATE = "private address";
const NOT_CHECKABLE = "contains a template variable; it cannot be checked";
const FALLBACK_TO_GET: ReadonlySet<number> = new Set([403, 405, 501]);
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const ATTRIBUTE = /(?:^|[\s"'/])(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const BARE_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const HTTP_SCHEME = /^https?:\/\//i;
const UNSUBSCRIBE_TAG = /^\{\{\s*unsubscribe_url\s*\}\}$/;
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt));/gi;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()];
    const code = dec ? Number(dec) : parseInt(hex ?? "", 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function isAbsoluteHttp(value: string): boolean {
  if (!HTTP_SCHEME.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function extractLinks(html: string, text: string | null): { urls: string[]; variableLinks: string[] } {
  const urls = new Set<string>();
  const variableLinks = new Set<string>();
  const consider = (raw: string) => {
    const value = raw.trim();
    if (UNSUBSCRIBE_TAG.test(value)) return;
    if (value.includes("{{")) variableLinks.add(value);
    else if (isAbsoluteHttp(value)) urls.add(value);
  };
  for (const m of html.matchAll(ATTRIBUTE)) consider(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ""));
  for (const m of (text ?? "").matchAll(BARE_URL)) consider(m[0].replace(TRAILING_PUNCTUATION, ""));
  return { urls: [...urls], variableLinks: [...variableLinks] };
}

function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%", 1)[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (!isIPv4(dotted[1])) return null;
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (s: string | undefined) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const groups = tail === undefined ? left : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) return ipv4Private(ip);
  const g = ipv6Groups(ip);
  if (!g) return true;
  const leadingZeros = g.slice(0, 5).every((x) => x === 0);
  if (leadingZeros && g[5] === 0xffff) return ipv4Private(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  if (leadingZeros && g[5] === 0) return true;
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
}

function describeError(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  const message = typeof e?.cause?.message === "string" ? e.cause.message : typeof e?.message === "string" ? e.message : String(err);
  return oneLine(typeof code === "string" ? `network error: ${code}` : `network error: ${message}`);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const defaultLookup: LookupFn = (host) => dns.lookup(host, { all: true, verbatim: true });

async function hostProblem(hostname: string, lookup: LookupFn, timeoutMs: number): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return PRIVATE;
  if (isIP(host)) return isPrivateAddress(host) ? PRIVATE : null;
  let addresses: { address: string }[] | "timeout";
  try {
    addresses = await withTimeout(lookup(host), timeoutMs);
  } catch {
    return `could not resolve ${host}`;
  }
  if (addresses === "timeout") return `could not resolve ${host} (timed out)`;
  if (addresses.length === 0) return `could not resolve ${host}`;
  return addresses.some((a) => isPrivateAddress(a.address)) ? PRIVATE : null;
}

type Reply = { status: number; location: string | null } | { error: string };

async function request(url: string, method: "HEAD" | "GET", fetchImpl: FetchLike, timeoutMs: number): Promise<Reply> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: ctl.signal,
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
    });
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    return { status: res.status, location };
  } catch (err) {
    return { error: ctl.signal.aborted ? `timed out after ${Math.round(timeoutMs / 1000)}s` : describeError(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url: string, fetchImpl: FetchLike, lookup: LookupFn, timeoutMs: number): Promise<LinkProbe> {
  const fail = (finalUrl: string | null, error: string, status: number | null = null): LinkProbe => ({
    url,
    ok: false,
    status,
    finalUrl,
    error,
  });
  let current = url;
  for (let redirects = 0; ; redirects++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return fail(current, "not a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail(current, redirects > 0 ? "redirected to a non-http(s) URL" : "not an http(s) link");
    }
    const problem = await hostProblem(parsed.hostname, lookup, timeoutMs);
    if (problem) return fail(current, problem);
    let reply = await request(current, "HEAD", fetchImpl, timeoutMs);
    if ("error" in reply || FALLBACK_TO_GET.has(reply.status)) reply = await request(current, "GET", fetchImpl, timeoutMs);
    if ("error" in reply) return fail(current, reply.error);
    if (REDIRECTS.has(reply.status) && reply.location) {
      if (redirects >= MAX_REDIRECTS) return fail(current, `too many redirects (more than ${MAX_REDIRECTS})`, reply.status);
      try {
        current = new URL(reply.location, current).href;
      } catch {
        return fail(current, "the redirect location is not a valid URL", reply.status);
      }
      continue;
    }
    const ok = reply.status >= 200 && reply.status < 300;
    return { url, ok, status: reply.status, finalUrl: current, error: ok ? null : `HTTP ${reply.status}` };
  }
}

export async function checkLinks(urls: string[], opts: CheckLinksOptions = {}): Promise<LinkProbe[]> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const lookup = opts.lookup ?? defaultLookup;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: LinkProbe[] = new Array(urls.length);
  let next = 0;
  const lane = async () => {
    while (next < urls.length) {
      const i = next++;
      try {
        results[i] = await probe(urls[i], fetchImpl, lookup, timeoutMs);
      } catch (err) {
        results[i] = { url: urls[i], ok: false, status: null, finalUrl: null, error: describeError(err) };
      }
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, urls.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

export function buildLinkCheck(
  version: number,
  probes: LinkProbe[],
  variableLinks: string[],
  previous: LinkCheck | null,
  now: Date,
): LinkCheck {
  const acked = new Set(previous?.version === version ? previous.links.filter((l) => l.acknowledged).map((l) => l.url) : []);
  const links: LinkResult[] = [
    ...probes.map((p) => ({ ...p, acknowledged: acked.has(p.url) })),
    ...variableLinks.map((url) => ({ url, ok: false, status: null, finalUrl: null, error: NOT_CHECKABLE, acknowledged: acked.has(url) })),
  ];
  return { version, checkedAt: now.toISOString(), links };
}

export function acknowledgeLink(check: LinkCheck, url: string): LinkCheck | null {
  if (!check.links.some((l) => l.url === url)) return null;
  return { ...check, links: check.links.map((l) => (l.url === url ? { ...l, acknowledged: true } : l)) };
}

export function linksPass(check: LinkCheck | null, version: number): boolean {
  return check !== null && check.version === version && check.links.every((l) => l.ok || l.acknowledged);
}
