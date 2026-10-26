import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { notFound } from "./errors.ts";
import { setSessionCookie } from "./routes/session.ts";

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MamaDirect</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;color:#0f172a">
<h1>MamaDirect is running</h1>
<p>Dashboard not built yet &mdash; run <code>npm run build:web</code>, then reload this page.</p>
</body></html>
`;

function isAppPath(url: string): boolean {
  const p = url.split(/[?#]/, 1)[0].toLowerCase();
  return !(p === "/api" || p.startsWith("/api/") || p.startsWith("/u/"));
}

export function registerWeb(app: FastifyInstance, opts: { webDir: string; sessionToken: string }): void {
  const built = fs.existsSync(path.join(opts.webDir, "index.html"));

  const sendIndex = (reply: FastifyReply) => {
    setSessionCookie(reply, opts.sessionToken);
    reply.header("cache-control", "no-store");
    if (!built) return reply.type("text/html; charset=utf-8").send(PLACEHOLDER);
    return reply.sendFile("index.html", opts.webDir, { cacheControl: false });
  };

  if (built) {
    app.register(fastifyStatic, {
      root: opts.webDir,
      prefix: "/",
      index: false,
      wildcard: true,
      dotfiles: "deny",
      allowedPath: (pathName) => pathName !== "/index.html",
    });
  }

  app.get("/", (_request, reply) => sendIndex(reply));

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if ((request.method === "GET" || request.method === "HEAD") && isAppPath(request.url)) return sendIndex(reply);
    throw notFound("Route");
  });
}
