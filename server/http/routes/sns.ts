import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import {
  SNS_BODY_LIMIT,
  SNS_ROUTE,
  handleSnsEnvelope,
  type ConfirmSubscription,
  type SnsEnvelope,
} from "../../domain/snsFeedback.ts";
import type { Logger } from "../../logger.ts";

export interface SnsOptions {
  db: DatabaseSync;
  log: Logger;
  /** Override signature check (tests). Default verifies against Amazon cert URL. */
  verify?: (envelope: SnsEnvelope) => Promise<boolean>;
  confirm?: ConfirmSubscription;
}

export async function snsPlugin(app: FastifyInstance, opts: SnsOptions): Promise<void> {
  app.post(
    SNS_ROUTE,
    {
      bodyLimit: SNS_BODY_LIMIT,
      config: { rawBody: true },
    },
    async (request, reply) => {
      const result = await handleSnsEnvelope(opts.db, request.body, opts.log, {
        verify: opts.verify,
        confirm: opts.confirm,
      });
      return reply.code(result.status).type("text/plain; charset=utf-8").send(result.body);
    },
  );
}
