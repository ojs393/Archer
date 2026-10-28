import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AnalyticsBucket,
  AnalyticsErrors,
  AnalyticsFeedback,
  AnalyticsRuns,
  AnalyticsSummary,
  AnalyticsTimeseries,
} from "@/lib/types";

export type CampaignScope = number | null;

export type TimeseriesParams = {
  bucket: AnalyticsBucket;
  days?: number;
  hours?: number;
};

export function analyticsSummaryKey(campaignId: CampaignScope = null) {
  return ["analytics", "summary", campaignId] as const;
}

export function analyticsTimeseriesKey(params: TimeseriesParams, campaignId: CampaignScope = null) {
  return ["analytics", "timeseries", params.bucket, params.days ?? null, params.hours ?? null, campaignId] as const;
}

export function analyticsErrorsKey(campaignId: CampaignScope = null) {
  return ["analytics", "errors", campaignId] as const;
}

export function analyticsRunsKey() {
  return ["analytics", "runs"] as const;
}

export function analyticsFeedbackKey() {
  return ["analytics", "feedback"] as const;
}

function scopeQuery(campaignId: CampaignScope): Record<string, number> | undefined {
  return campaignId === null ? undefined : { campaignId };
}

export function useAnalyticsSummary(campaignId: CampaignScope = null, enabled = true) {
  return useQuery({
    queryKey: analyticsSummaryKey(campaignId),
    queryFn: ({ signal }) =>
      api.get<AnalyticsSummary>("/api/analytics/summary", { signal, query: scopeQuery(campaignId) }),
    enabled,
  });
}

export function useAnalyticsTimeseries(
  params: TimeseriesParams,
  campaignId: CampaignScope = null,
  enabled = true,
) {
  return useQuery({
    queryKey: analyticsTimeseriesKey(params, campaignId),
    queryFn: ({ signal }) =>
      api.get<AnalyticsTimeseries>("/api/analytics/timeseries", {
        signal,
        query: {
          bucket: params.bucket,
          ...(params.days !== undefined ? { days: params.days } : {}),
          ...(params.hours !== undefined ? { hours: params.hours } : {}),
          ...scopeQuery(campaignId),
        },
      }),
    enabled,
  });
}

export function useAnalyticsErrors(campaignId: CampaignScope = null, enabled = true) {
  return useQuery({
    queryKey: analyticsErrorsKey(campaignId),
    queryFn: ({ signal }) =>
      api.get<AnalyticsErrors>("/api/analytics/errors", { signal, query: scopeQuery(campaignId) }),
    enabled,
  });
}

export function useAnalyticsRuns(enabled = true) {
  return useQuery({
    queryKey: analyticsRunsKey(),
    queryFn: ({ signal }) => api.get<AnalyticsRuns>("/api/analytics/runs", { signal }),
    enabled,
  });
}

export function useAnalyticsFeedback(enabled = true) {
  return useQuery({
    queryKey: analyticsFeedbackKey(),
    queryFn: ({ signal }) => api.get<AnalyticsFeedback>("/api/analytics/feedback", { signal }),
    enabled,
  });
}
