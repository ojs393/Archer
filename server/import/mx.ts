import { promises as dnsPromises } from "node:dns";
import { domainToASCII } from "node:url";

export type DomainStatus = "ok" | "invalid" | "unknown";

export interface DnsLike {
  resolveMx(d: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(d: string): Promise<string[]>;
  resolve6(d: string): Promise<string[]>;
}

const DEFAULT_TIMEOUT_MS = 5000;
const TRIES = 2;
const DEFAULT_CONCURRENCY = 10;
const BREAKER_THRESHOLD = 20;
const DOES_NOT_EXIST = new Set(["ENOTFOUND", "ENODATA"]);

type Lookup<T> = { ok: true; value: T } | { ok: false; missing: boolean };

function lookup<T extends unknown[]>(query: () => Promise<T>, deadlineMs: number): Promise<Lookup<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, missing: false }), deadlineMs);
    const settle = (result: Lookup<T>) => {
      clearTimeout(timer);
      resolve(result);
    };
    Promise.resolve()
      .then(query)
      .then(
        (value) => settle(value.length > 0 ? { ok: true, value } : { ok: false, missing: true }),
        (err: unknown) => settle({ ok: false, missing: DOES_NOT_EXIST.has((err as { code?: unknown })?.code as string) }),
      );
  });
}

async function resolveStatus(dns: DnsLike, domain: string, deadlineMs: number): Promise<DomainStatus> {
  const name = domainToASCII(domain);
  if (!name) return "unknown";
  const [mx, a, aaaa] = await Promise.all([
    lookup(() => dns.resolveMx(name), deadlineMs),
    lookup(() => dns.resolve4(name), deadlineMs),
    lookup(() => dns.resolve6(name), deadlineMs),
  ]);
  if (mx.ok) return mx.value.some((r) => r.exchange && r.exchange !== ".") ? "ok" : "invalid";
  if (a.ok || aaaa.ok) return "ok";
  return mx.missing && !a.ok && a.missing && !aaaa.ok && aaaa.missing ? "invalid" : "unknown";
}

export function createDomainChecker(opts: { dns?: DnsLike; timeoutMs?: number } = {}): (domain: string) => Promise<DomainStatus> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dns = opts.dns ?? new dnsPromises.Resolver({ timeout: timeoutMs, tries: TRIES });
  const deadlineMs = timeoutMs * TRIES;
  const cache = new Map<string, Promise<DomainStatus>>();
  return (domain) => {
    const key = domain.trim().toLowerCase();
    let status = cache.get(key);
    if (!status) {
      status = resolveStatus(dns, key, deadlineMs).catch(() => "unknown" as const);
      cache.set(key, status);
    }
    return status;
  };
}

export async function checkDomains(
  domains: string[],
  check: (d: string) => Promise<DomainStatus>,
  concurrency: number = DEFAULT_CONCURRENCY,
  onProgress?: (done: number, total: number, info?: { breakerTripped: boolean }) => void,
): Promise<Map<string, DomainStatus>> {
  const unique = [...new Set(domains)];
  const results = new Map<string, DomainStatus>();
  let next = 0;
  let done = 0;
  let consecutiveUnknown = 0;
  let breakerTripped = false;
  const worker = async () => {
    while (!breakerTripped && next < unique.length) {
      const domain = unique[next++];
      let status: DomainStatus;
      try {
        status = await check(domain);
      } catch {
        status = "unknown";
      }
      consecutiveUnknown = status === "unknown" ? consecutiveUnknown + 1 : 0;
      if (consecutiveUnknown >= BREAKER_THRESHOLD) breakerTripped = true;
      results.set(domain, status);
      onProgress?.(++done, unique.length, { breakerTripped });
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(concurrency) || 1), unique.length);
  await Promise.all(Array.from({ length: workers }, worker));
  if (done < unique.length) {
    for (const domain of unique) if (!results.has(domain)) results.set(domain, "unknown");
    onProgress?.(unique.length, unique.length, { breakerTripped });
  }
  return results;
}
