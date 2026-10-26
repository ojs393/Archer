import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import { logger, type Logger } from "../logger.ts";
import type { Env } from "./context.ts";
import { errorHandler, notFound } from "./errors.ts";
import { UNSUBSCRIBE_BODY_LIMIT, unsubscribePlugin } from "./routes/unsubscribe.ts";
import { MAX_PARAM_LENGTH, applySecurityHeaders } from "./server.ts";

export function buildPublicServer(deps: { db: DatabaseSync; env: Env; log?: Logger }): FastifyInstance {
  const log = deps.log ?? logger;
  const app = Fastify({ logger: false, bodyLimit: UNSUBSCRIBE_BODY_LIMIT, routerOptions: { maxParamLength: MAX_PARAM_LENGTH } });
  applySecurityHeaders(app);
  app.setErrorHandler(errorHandler(log));
  app.register(unsubscribePlugin, { db: deps.db, env: deps.env, log });
  app.setNotFoundHandler(() => {
    throw notFound("Page");
  });
  return app;
}
