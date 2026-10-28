import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TagSummary } from "@/lib/types";

export function useTags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: async ({ signal }) => {
      const res = await api.get<{ tags: TagSummary[] }>("/api/tags", { signal });
      return res.tags;
    },
    enabled,
  });
}
