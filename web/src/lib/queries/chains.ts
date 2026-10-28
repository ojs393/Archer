import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { CampaignView, ChainRecord, ChainSummary, Schedule } from "@/lib/types";

export function chainsKey() {
  return [...queryKeys.campaigns, "chains"] as const;
}

export function chainKey(id: number) {
  return [...chainsKey(), id] as const;
}

export function useChains(enabled = true) {
  return useQuery({
    queryKey: chainsKey(),
    queryFn: ({ signal }) => api.get<ChainSummary[]>("/api/chains", { signal }),
    enabled,
  });
}

export function useChain(id: number | null, enabled = true) {
  return useQuery({
    queryKey: chainKey(id ?? 0),
    queryFn: ({ signal }) => api.get<ChainRecord>(`/api/chains/${id}`, { signal }),
    enabled: enabled && id !== null,
  });
}

export function useCreateChain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      listId: number;
      schedule: Schedule;
      steps: { templateId: number; delayHours: number }[];
    }) => api.post<ChainRecord>("/api/chains", body),
    onSuccess: () => void client.invalidateQueries({ queryKey: chainsKey() }),
  });
}

export function useDeleteChain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/chains/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: chainsKey() }),
  });
}

export function useStartChain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, autoStart = true }: { id: number; autoStart?: boolean }) =>
      api.post<CampaignView>(`/api/chains/${id}/start`, { autoStart }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.campaigns });
      void client.invalidateQueries({ queryKey: chainsKey() });
    },
  });
}
