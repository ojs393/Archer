import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  // Duck-type so Vitest/HMR module duplicates still match ApiError instances.
  const ok =
    err instanceof ApiError ||
    (typeof err === "object" &&
      err !== null &&
      (err as Error).name === "ApiError" &&
      typeof (err as ApiError).status === "number" &&
      typeof (err as ApiError).code === "string");
  return ok && (code === undefined || (err as ApiError).code === code);
}

type Method = "GET" | "POST" | "PUT" | "DELETE";
type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

interface Call extends RequestOptions {
  body?: unknown;
}

const SESSION_PATH = "/api/session";
const NETWORK_MESSAGE = "Cannot reach Archer. Check that it is still running.";

let session: Promise<void> | null = null;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: "same-origin" });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, "network_error", NETWORK_MESSAGE);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    const error = body?.error;
    if (error && typeof error.code === "string" && typeof error.message === "string") {
      return new ApiError(res.status, error.code, error.message, error.details);
    }
  } catch {
    // Not a JSON error envelope (for example a proxy error page).
  }
  return new ApiError(res.status, "http_error", `Request failed (${res.status})`);
}

async function openSession(): Promise<void> {
  const res = await send(SESSION_PATH, { method: "GET", cache: "no-store" });
  if (!res.ok) throw await toApiError(res);
}

export function ensureSession(): Promise<void> {
  if (!session) {
    const attempt = openSession().catch((err: unknown) => {
      if (session === attempt) session = null;
      throw err;
    });
    session = attempt;
  }
  return session;
}

/** Opens a fresh session even if one is cached (the token changes when the server restarts). */
export function refreshSession(): Promise<void> {
  session = null;
  return ensureSession();
}

function renewSession(seen: Promise<void> | null): Promise<void> {
  if (session === seen) session = null;
  return ensureSession();
}

function withQuery(path: string, query: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? JSON.parse(text) : text) as T;
}

async function request<T>(method: Method, path: string, call: Call = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (method !== "GET") headers["X-Archer"] = "1";
  if (call.body instanceof FormData) {
    body = call.body;
  } else if (call.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(call.body);
  }

  const seen = session;
  const res = await send(withQuery(path, call.query), { method, headers, body, signal: call.signal });
  if (res.status === 401 && !retried && path !== SESSION_PATH) {
    await renewSession(seen);
    return request<T>(method, path, call, true);
  }
  if (!res.ok) throw await toApiError(res);
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>("PUT", path, { ...opts, body }),
  del: <T = void>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, opts),
  upload: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>("POST", path, { ...opts, body: form }),
};
