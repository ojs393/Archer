import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type {
  CampaignEventsPage,
  CampaignSendsPage,
  CampaignView,
  Estimate,
  GatesResult,
  Schedule,
  SendRowState,
} from "@/lib/types";

export type CampaignFilters = {
  q?: string;
  status?: string;
  tag?: string;
  sort?: "id" | "created_at" | "status" | "title";
  order?: "asc" | "desc";
};

function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function campaignsKey(filters: CampaignFilters = {}) {
  return [...queryKeys.campaigns, filters] as const;
}

export function campaignKey(id: number) {
  return [...queryKeys.campaigns, id] as const;
}

export function useCampaigns(
  filters: CampaignFilters = {},
  enabled = true,
  options?: { refetchInterval?: false | number | ((query: { state: { data: CampaignView[] | undefined } }) => false | number) },
) {
  return useQuery({
    queryKey: campaignsKey(filters),
    queryFn: ({ signal }) =>
      api.get<CampaignView[]>(
        `/api/campaigns${toQuery({
          q: filters.q,
          status: filters.status,
          tag: filters.tag,
          sort: filters.sort,
          order: filters.order,
        })}`,
        { signal },
      ),
    enabled,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCampaign(
  id: number | null,
  enabled = true,
  options?: { refetchInterval?: false | number | ((query: { state: { data: CampaignView | undefined } }) => false | number) },
) {
  return useQuery({
    queryKey: campaignKey(id ?? 0),
    queryFn: ({ signal }) => api.get<CampaignView>(`/api/campaigns/${id}`, { signal }),
    enabled: enabled && id !== null,
    refetchInterval: options?.refetchInterval,
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
  void client.invalidateQueries({ queryKey: queryKeys.tags });
}

export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { listId: number; templateId: number; schedule: Schedule }) =>
      api.post<CampaignView>("/api/campaigns", body),
    onSuccess: () => invalidateCampaigns(client),
  });
}

export type CampaignUpdateBody = {
  id: number;
  title?: string;
  tags?: string[];
  listId?: number;
  templateId?: number;
};

export function campaignSendsKey(id: number, filters: { state?: SendRowState; q?: string; limit?: number; offset?: number } = {}) {
  return [...queryKeys.campaigns, id, "sends", filters] as const;
}

export function campaignEventsKey(id: number) {
  return [...queryKeys.campaigns, id, "events"] as const;
}

export function useCampaignSends(
  id: number | null,
  filters: { state?: SendRowState; q?: string; limit?: number; offset?: number } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: campaignSendsKey(id ?? 0, filters),
    queryFn: ({ signal }) =>
      api.get<CampaignSendsPage>(
        `/api/campaigns/${id}/sends${toQuery({
          state: filters.state,
          q: filters.q,
          limit: filters.limit !== undefined ? String(filters.limit) : undefined,
          offset: filters.offset !== undefined ? String(filters.offset) : undefined,
        })}`,
        { signal },
      ),
    enabled: enabled && id !== null,
  });
}

export function useCampaignEvents(id: number | null, enabled = true) {
  return useQuery({
    queryKey: campaignEventsKey(id ?? 0),
    queryFn: ({ signal }) =>
      api.get<CampaignEventsPage>(`/api/campaigns/${id}/events${toQuery({ limit: "100" })}`, { signal }),
    enabled: enabled && id !== null,
  });
}

export function useUpdateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CampaignUpdateBody) => api.patch<CampaignView>(`/api/campaigns/${id}`, body),
    onSuccess: () => invalidateCampaigns(client),
  });
}

export function useRequeueUncertain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contactIds }: { id: number; contactIds?: number[] }) =>
      api.post<{ requeued: number }>(`/api/campaigns/${id}/requeue`, contactIds ? { contactIds } : {}),
    onSuccess: (_data, vars) => {
      invalidateCampaigns(client);
      void client.invalidateQueries({ queryKey: [...queryKeys.campaigns, vars.id] });
    },
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

export type { GatesResult };
