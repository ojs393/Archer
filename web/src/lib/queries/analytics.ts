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

export function analyticsSummaryKey() {
  return ["analytics", "summary"] as const;
}

export function analyticsTimeseriesKey(bucket: AnalyticsBucket, days: number, campaignId: CampaignScope = null) {
  return ["analytics", "timeseries", bucket, days, campaignId] as const;
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

export function useAnalyticsSummary(enabled = true) {
  return useQuery({
    queryKey: analyticsSummaryKey(),
    queryFn: ({ signal }) => api.get<AnalyticsSummary>("/api/analytics/summary", { signal }),
    enabled,
  });
}

export function useAnalyticsTimeseries(
  bucket: AnalyticsBucket,
  days: number,
  campaignId: CampaignScope = null,
  enabled = true,
) {
  return useQuery({
    queryKey: analyticsTimeseriesKey(bucket, days, campaignId),
    queryFn: ({ signal }) =>
      api.get<AnalyticsTimeseries>("/api/analytics/timeseries", {
        signal,
        query: { bucket, days, ...scopeQuery(campaignId) },
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
