import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { statusSnapshot } from "../status.ts";

export function healthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/health", async () => ctx.health.refresh());

  app.get("/api/status", async () => statusSnapshot(ctx.db, ctx.worker));

  app.get("/api/events", { exposeHeadRoute: false }, (_request, reply) => {
    const initial = [
      { name: "status", data: statusSnapshot(ctx.db, ctx.worker) },
      { name: "health", data: ctx.health.get() },
    ];
    reply.hijack();
    try {
      ctx.events.subscribe(reply.raw, initial);
    } catch (err) {
      ctx.log.error("Could not open the event stream:", err);
      reply.raw.destroy();
    }
  });
}
