import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import { SNS_BODY_LIMIT } from "../domain/snsFeedback.ts";
import { logger, type Logger } from "../logger.ts";
import type { Env } from "./context.ts";
import { errorHandler, notFound } from "./errors.ts";
import { snsPlugin, type SnsOptions } from "./routes/sns.ts";
import { unsubscribePlugin } from "./routes/unsubscribe.ts";
import { MAX_PARAM_LENGTH, applySecurityHeaders } from "./server.ts";

export interface PublicServerDeps {
  db: DatabaseSync;
  env: Env;
  log?: Logger;
  /** Test hooks for SNS signature / subscription confirm. */
  sns?: Pick<SnsOptions, "verify" | "confirm">;
}

function addSnsBodyParsers(app: FastifyInstance): void {
  // SNS posts JSON as text/plain; accept both.
  const parseJson = (raw: string, done: (err: Error | null, body?: unknown) => void) => {
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error);
    }
  };
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: SNS_BODY_LIMIT }, (_req, body, done) =>
    parseJson(body as string, done),
  );
  app.addContentTypeParser("text/plain", { parseAs: "string", bodyLimit: SNS_BODY_LIMIT }, (_req, body, done) => {
    const raw = body as string;
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(null, raw);
    }
  });
}

export function buildPublicServer(deps: PublicServerDeps): FastifyInstance {
  const log = deps.log ?? logger;
  const app = Fastify({
    logger: false,
    bodyLimit: SNS_BODY_LIMIT,
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  });
  applySecurityHeaders(app);
  app.setErrorHandler(errorHandler(log));
  addSnsBodyParsers(app);
  app.register(snsPlugin, { db: deps.db, log, verify: deps.sns?.verify, confirm: deps.sns?.confirm });
  // Encapsulated: unsubscribe discards bodies without wiping SNS parsers on the parent.
  app.register(unsubscribePlugin, { db: deps.db, env: deps.env, log });
  app.setNotFoundHandler(() => {
    throw notFound("Page");
  });
  return app;
}
