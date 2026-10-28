import type { FastifyInstance } from "fastify";
import { analyticsErrors } from "../../analytics/errors.ts";
import { getFeedback } from "../../analytics/feedback.ts";
import { analyticsRuns } from "../../analytics/runs.ts";
import { analyticsSummary } from "../../analytics/summary.ts";
import { analyticsTimeseries } from "../../analytics/timeseries.ts";
import { getCampaign } from "../../campaigns/store.ts";
import type { AppContext } from "../context.ts";
import {
  analyticsErrorsQuerySchema,
  analyticsScopeSchema,
  analyticsTimeseriesQuerySchema,
  type AnalyticsErrors,
  type AnalyticsFeedback,
  type AnalyticsRuns,
  type AnalyticsSummary,
  type AnalyticsTimeseries,
} from "../contract.ts";
import { notFound } from "../errors.ts";

export function analyticsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const scope = (campaignId: number | undefined): number | null => {
    if (campaignId === undefined) return null;
    if (!getCampaign(ctx.db, campaignId)) throw notFound("Campaign");
    return campaignId;
  };

  app.get("/api/analytics/summary", async (request): Promise<AnalyticsSummary> => {
    const q = analyticsScopeSchema.parse(request.query ?? {});
    return analyticsSummary(ctx.db, scope(q.campaignId));
  });

  app.get("/api/analytics/timeseries", async (request): Promise<AnalyticsTimeseries> => {
    const q = analyticsTimeseriesQuerySchema.parse(request.query ?? {});
    return analyticsTimeseries(ctx.db, {
      bucket: q.bucket,
      days: q.days,
      hours: q.hours,
      campaignId: scope(q.campaignId),
    });
  });

  app.get("/api/analytics/errors", async (request): Promise<AnalyticsErrors> => {
    const q = analyticsErrorsQuerySchema.parse(request.query ?? {});
    return analyticsErrors(ctx.db, { campaignId: scope(q.campaignId), limit: q.limit });
  });

  app.get("/api/analytics/runs", async (request): Promise<AnalyticsRuns> => {
    const q = analyticsScopeSchema.parse(request.query ?? {});
    return analyticsRuns(ctx.db, scope(q.campaignId));
  });

  app.get("/api/analytics/feedback", async (): Promise<AnalyticsFeedback> => getFeedback(ctx.db));
}
