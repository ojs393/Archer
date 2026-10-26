import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "md_session";
export const UNSUBSCRIBE_ROUTE = "/u/:token";
const SESSION_ROUTE = "/api/session";
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export interface GuardConfig {
  port: number;
  sessionToken: string;
  devOrigin?: string | null;
  checkHost?: boolean;
}

export interface GuardInput {
  method: string;
  url: string;
  route: string | undefined;
  headers: IncomingHttpHeaders;
}

export type GuardCode = "bad_host" | "bad_origin" | "missing_header" | "no_session";
export type GuardVerdict = { ok: true } | { ok: false; status: 401 | 403; code: GuardCode; message: string };

const REJECTIONS: Record<GuardCode, { status: 401 | 403; message: string }> = {
  bad_host: { status: 403, message: "Open MamaDirect at the address it printed (http://127.0.0.1:<port>)" },
  bad_origin: { status: 403, message: "Cross-site requests are not allowed" },
  missing_header: { status: 403, message: "Missing X-MamaDirect request header" },
  no_session: { status: 401, message: "Session expired; reload the page" },
};

function reject(code: GuardCode): GuardVerdict {
  return { ok: false, code, ...REJECTIONS[code] };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathOf(url: string): string {
  const q = url.search(/[?#]/);
  return safeDecode(q < 0 ? url : url.slice(0, q)).toLowerCase();
}

function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function tokensEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b) && given.length === expected.length && expected.length > 0;
}

export function readCookies(header: string | undefined, name: string): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0 || pair.slice(0, eq).trim() !== name) continue;
    values.push(safeDecode(pair.slice(eq + 1).trim()));
  }
  return values;
}

export function checkRequest(req: GuardInput, cfg: GuardConfig): GuardVerdict {
  const method = req.method.toUpperCase();
  const isUnsubscribe = req.route === UNSUBSCRIBE_ROUTE;

  if (cfg.checkHost !== false) {
    const host = single(req.headers.host)?.toLowerCase();
    if (!host || !LOOPBACK_HOSTS.some((h) => host === `${h}:${cfg.port}`)) return reject("bad_host");
  }

  if (!SAFE_METHODS.has(method) && !isUnsubscribe) {
    const origin = single(req.headers.origin);
    if (origin !== undefined) {
      const allowed = LOOPBACK_HOSTS.map((h) => `http://${h}:${cfg.port}`);
      const dev = normalizedOrigin(cfg.devOrigin);
      if (dev) allowed.push(dev);
      if (!allowed.includes(origin.toLowerCase())) return reject("bad_origin");
    }
    if (single(req.headers["x-mamadirect"]) !== "1") return reject("missing_header");
  }

  const isApi = (req.route ?? "").startsWith("/api") || pathOf(req.url).startsWith("/api");
  const exempt = req.route === SESSION_ROUTE && SAFE_METHODS.has(method);
  if (isApi && !exempt) {
    const presented = readCookies(single(req.headers.cookie), SESSION_COOKIE);
    if (!presented.some((value) => tokensEqual(value, cfg.sessionToken))) return reject("no_session");
  }
  return { ok: true };
}

export function securityHook(cfg: GuardConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const verdict = checkRequest(
      { method: request.method, url: request.url, route: request.routeOptions.url, headers: request.headers },
      cfg,
    );
    if (verdict.ok) return;
    reply.header("connection", "close");
    await reply.code(verdict.status).send({ error: { code: verdict.code, message: verdict.message } });
  };
}
