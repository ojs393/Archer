import type { FastifyInstance } from "fastify";
import { estimateSchedule, type Estimate } from "../../domain/schedule.ts";
import { estimateSchema } from "../contract.ts";

export function estimateRoutes(app: FastifyInstance): void {
  app.post("/api/estimate", async (request): Promise<Estimate> => {
    const { remaining, schedule } = estimateSchema.parse(request.body ?? {});
    return estimateSchedule({ remaining, schedule, now: new Date() });
  });
}
