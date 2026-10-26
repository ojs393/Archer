import { useQuery } from "@tanstack/react-query";
import { api, ensureSession } from "./api";
import { queryKeys } from "./queryKeys";
import type { Health, StatusSnapshot } from "./types";

const HEALTH_REFRESH_MS = 60_000;

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      await ensureSession();
      return true;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

export function useStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: ({ signal }) => api.get<StatusSnapshot>("/api/status", { signal }),
    enabled,
  });
}

export function useHealth(enabled = true) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.get<Health>("/api/health", { signal }),
    refetchInterval: HEALTH_REFRESH_MS,
    enabled,
  });
}

export function useCollection<T>(key: readonly string[], path: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<T[]>(path, { signal }),
    enabled,
  });
}
