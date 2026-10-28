import type { FastifyInstance } from "fastify";
import { listAllTags } from "../../tags/store.ts";
import type { AppContext } from "../context.ts";
import type { TagSummary } from "../contract.ts";

export function tagRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/tags", async (): Promise<{ tags: TagSummary[] }> => ({ tags: listAllTags(ctx.db) }));
}
