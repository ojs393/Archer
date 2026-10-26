import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { CampaignView, Estimate, GatesResult, Schedule } from "@/lib/types";

export function campaignsKey() {
  return queryKeys.campaigns;
}

export function campaignKey(id: number) {
  return [...queryKeys.campaigns, id] as const;
}

export function campaignGatesKey(id: number) {
  return [...queryKeys.campaigns, id, "gates"] as const;
}

export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: campaignsKey(),
    queryFn: ({ signal }) => api.get<CampaignView[]>("/api/campaigns", { signal }),
    enabled,
  });
}

export function useCampaign(id: number | null, enabled = true) {
  return useQuery({
    queryKey: campaignKey(id ?? 0),
    queryFn: ({ signal }) => api.get<CampaignView>(`/api/campaigns/${id}`, { signal }),
    enabled: enabled && id !== null,
  });
}

export function useCampaignGates(id: number | null, enabled = true) {
  return useQuery({
    queryKey: campaignGatesKey(id ?? 0),
    queryFn: ({ signal }) => api.get<GatesResult>(`/api/campaigns/${id}/gates`, { signal }),
    enabled: enabled && id !== null,
  });
}

export async function estimateCampaign(remaining: number, schedule: Schedule, signal?: AbortSignal): Promise<Estimate> {
  return api.post<Estimate>("/api/estimate", { remaining, schedule }, { signal });
}

export function useEstimate(remaining: number | null, schedule: Schedule | null, enabled = true) {
  return useQuery({
    queryKey: ["estimate", remaining, schedule] as const,
    queryFn: ({ signal }) => estimateCampaign(remaining!, schedule!, signal),
    enabled: enabled && remaining !== null && schedule !== null && remaining >= 0,
  });
}

function invalidateCampaigns(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.campaigns });
  void client.invalidateQueries({ queryKey: queryKeys.status });
  void client.invalidateQueries({ queryKey: queryKeys.analytics });
}

export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { listId: number; templateId: number; schedule: Schedule }) =>
      api.post<CampaignView>("/api/campaigns", body),
    onSuccess: () => invalidateCampaigns(client),
  });
}

export function useStartCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CampaignView>(`/api/campaigns/${id}/start`),
    onSuccess: () => invalidateCampaigns(client),
  });
}

export function usePauseCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CampaignView>(`/api/campaigns/${id}/pause`),
    onSuccess: () => invalidateCampaigns(client),
  });
}

export function useResumeCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CampaignView>(`/api/campaigns/${id}/resume`),
    onSuccess: () => invalidateCampaigns(client),
  });
}

/** API path is `/stop`; UI labels it Cancel. */
export function useStopCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CampaignView>(`/api/campaigns/${id}/stop`),
    onSuccess: () => invalidateCampaigns(client),
  });
}
