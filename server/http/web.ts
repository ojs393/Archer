import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "./errors.ts";
import { setSessionCookie } from "./routes/session.ts";

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Archer</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;color:#0f172a">
<h1>Archer is running</h1>
<p>Dashboard not built yet &mdash; run <code>npm run build:web</code>, then reload this page.</p>
</body></html>
`;

function isAppPath(url: string): boolean {
  const p = url.split(/[?#]/, 1)[0].toLowerCase();
  if (p === "/api" || p.startsWith("/api/") || p.startsWith("/u/")) return false;
  // A missing file must 404: answering a stale script chunk with index.html breaks module loading.
  if (p.startsWith("/assets/")) return false;
  return !p.slice(p.lastIndexOf("/") + 1).includes(".");
}

export function registerWeb(app: FastifyInstance, opts: { webDir: string; sessionToken: string }): void {
  const indexPath = path.join(opts.webDir, "index.html");
  const built = fs.existsSync(indexPath);

  const sendIndex = async (reply: FastifyReply) => {
    setSessionCookie(reply, opts.sessionToken);
    reply.header("cache-control", "no-store").type("text/html; charset=utf-8");
    if (!built) return reply.send(PLACEHOLDER);
    return reply.send(await fs.promises.readFile(indexPath));
  };

  if (built) {
    app.register(fastifyStatic, { root: opts.webDir, prefix: "/", index: false, wildcard: true, dotfiles: "deny" });
  }

  app.get("/", (_request, reply) => sendIndex(reply));
  app.get("/index.html", (_request, reply) => sendIndex(reply));

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if ((request.method === "GET" || request.method === "HEAD") && isAppPath(request.url)) return sendIndex(reply);
    throw notFound("Route");
  });
}
