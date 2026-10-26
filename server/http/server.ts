import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { createDomainChecker } from "../import/mx.ts";
import { logger, registerSecret } from "../logger.ts";
import { verifyTransport } from "../send/transport.ts";
import type { AppContext, ServerDeps } from "./context.ts";
import { errorHandler } from "./errors.ts";
import { ImportJobs } from "./importJobs.ts";
import { healthRoutes } from "./routes/health.ts";
import { sessionRoutes } from "./routes/session.ts";
import { suppressionRoutes } from "./routes/suppression.ts";
import { securityHook } from "./security.ts";
import { registerWeb } from "./web.ts";

export type { ServerDeps } from "./context.ts";

export const JSON_BODY_LIMIT = 1024 * 1024;
export const UPLOAD_LIMIT = 2 * 1024 * 1024 * 1024;

export function resolveContext(deps: ServerDeps): AppContext {
  const log = deps.log ?? logger;
  const createChecker = deps.createDomainChecker ?? (() => createDomainChecker());
  return {
    ...deps,
    webDir: deps.webDir ?? path.join(deps.paths.root, "dist", "web"),
    verifySmtp: deps.verifySmtp ?? verifyTransport,
    createDomainChecker: createChecker,
    registerSecret: deps.registerSecret ?? registerSecret,
    log,
    imports: deps.imports ?? new ImportJobs({ db: deps.db, events: deps.events, createDomainChecker: createChecker, log }),
  };
}

export function applySecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    if (!reply.hasHeader("content-security-policy")) reply.header("content-security-policy", "frame-ancestors 'none'");
    if (request.url.toLowerCase().startsWith("/api")) reply.header("cache-control", "no-store");
    return payload;
  });
}

export function installJsonParser(app: FastifyInstance): void {
  const strict = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: JSON_BODY_LIMIT }, (request, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text === "") return done(null, undefined);
    strict(request, text, done);
  });
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const ctx = resolveContext(deps);
  const app = Fastify({ logger: false, bodyLimit: JSON_BODY_LIMIT, return503OnClosing: true });

  installJsonParser(app);
  app.register(fastifyCookie);
  app.register(fastifyMultipart, { limits: { fileSize: UPLOAD_LIMIT, files: 1, fields: 20, fieldSize: 64 * 1024, parts: 21 } });
  app.addHook("onRequest", securityHook({ port: ctx.port, sessionToken: ctx.sessionToken, devOrigin: ctx.env.MAMADIRECT_DEV_ORIGIN }));
  applySecurityHeaders(app);
  app.setErrorHandler(errorHandler(ctx.log));

  sessionRoutes(app, ctx);
  healthRoutes(app, ctx);
  suppressionRoutes(app, ctx);
  registerWeb(app, { webDir: ctx.webDir, sessionToken: ctx.sessionToken });
  return app;
}
