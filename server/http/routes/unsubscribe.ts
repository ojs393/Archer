import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { addSuppression } from "../../db/suppression.ts";
import { resolveToken } from "../../domain/unsubscribe.ts";
import type { Logger } from "../../logger.ts";
import type { Env } from "../context.ts";
import { UNSUBSCRIBE_ROUTE } from "../security.ts";

export const UNSUBSCRIBE_BODY_LIMIT = 16 * 1024;
/** Cap POST /u/:token when the public listener is tunnelled (per client IP). */
const POST_RATE_WINDOW_MS = 60_000;
const POST_RATE_MAX = 30;

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const postHits = new Map<string, number[]>();

function clientKey(request: FastifyRequest): string {
  return request.ip || "unknown";
}

function tooManyPosts(request: FastifyRequest): boolean {
  const key = clientKey(request);
  const now = Date.now();
  const recent = (postHits.get(key) ?? []).filter((at) => now - at < POST_RATE_WINDOW_MS);
  if (recent.length >= POST_RATE_MAX) {
    postHits.set(key, recent);
    return true;
  }
  recent.push(now);
  postHits.set(key, recent);
  return false;
}

const STYLE = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8fafc;color:#0f172a;margin:0}
main{max-width:32rem;margin:4rem auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;box-shadow:0 1px 2px rgba(0,0,0,.05)}
h1{font-size:1.25rem;margin:0 0 1rem}p{line-height:1.5}
button{background:#10b981;color:#fff;border:0;border-radius:.5rem;padding:.625rem 1.25rem;font-size:1rem;cursor:pointer}
button:hover{background:#059669}`;

export interface UnsubscribeOptions {
  db: DatabaseSync;
  env: Env;
  log: Logger;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>
`;
}

const INVALID_PAGE = page(
  "This unsubscribe link is not valid",
  "<p>The link may have been cut off or changed. Copy the full link from the email, or reply to the email asking to be removed.</p>",
);

function sendPage(reply: FastifyReply, status: number, html: string) {
  return reply
    .code(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("content-security-policy", PAGE_CSP)
    .send(html);
}

export async function unsubscribePlugin(app: FastifyInstance, opts: UnsubscribeOptions): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: UNSUBSCRIBE_BODY_LIMIT }, (_request, _body, done) => done(null, undefined));

  const emailFor = (request: FastifyRequest) => {
    const { token } = request.params as { token?: unknown };
    return resolveToken(opts.db, typeof token === "string" ? token : "", opts.env.UNSUB_SECRET ?? "");
  };

  app.get(UNSUBSCRIBE_ROUTE, async (request, reply) => {
    const email = emailFor(request);
    if (!email) return sendPage(reply, 400, INVALID_PAGE);
    return sendPage(
      reply,
      200,
      page(
        "Unsubscribe",
        `<p>Stop sending email to <strong>${escapeHtml(email)}</strong>?</p>
<form method="post"><input type="hidden" name="confirm" value="1"><button type="submit">Confirm unsubscribe</button></form>`,
      ),
    );
  });

  app.post(UNSUBSCRIBE_ROUTE, async (request, reply) => {
    if (tooManyPosts(request)) {
      return sendPage(
        reply,
        429,
        page("Please try again shortly", "<p>Too many unsubscribe attempts from this network. Wait a minute and try once more.</p>"),
      );
    }
    const email = emailFor(request);
    if (!email) return sendPage(reply, 400, INVALID_PAGE);
    const added = addSuppression(opts.db, email, "unsubscribe");
    if (added) opts.log.info("Unsubscribe link used; address added to the suppression list");
    return sendPage(
      reply,
      200,
      page("You have been unsubscribed", `<p><strong>${escapeHtml(email)}</strong> will not receive any more email from us.</p>`),
    );
  });
}
