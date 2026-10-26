import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ListDetail, ListPreview, ListRow } from "@/lib/types";

export function listsKey() {
  return queryKeys.lists;
}

export function listKey(id: number) {
  return [...queryKeys.lists, id] as const;
}

export function useLists(enabled = true) {
  return useQuery({
    queryKey: listsKey(),
    queryFn: ({ signal }) => api.get<ListRow[]>("/api/lists", { signal }),
    enabled,
  });
}

export function useList(id: number | null, enabled = true) {
  return useQuery({
    queryKey: listKey(id ?? 0),
    queryFn: ({ signal }) => api.get<ListDetail>(`/api/lists/${id}`, { signal }),
    enabled: enabled && id !== null,
  });
}

export async function previewListCsv(file: File, signal?: AbortSignal): Promise<ListPreview> {
  const form = new FormData();
  form.append("file", file.slice(0, 65536), file.name);
  return api.upload<ListPreview>("/api/lists/preview", form, { signal });
}

export type ListImportFields = {
  name: string;
  sourceLabel: string;
  consentText: string;
  consentConfirmed: true;
  excludeRoles?: boolean;
  emailColumn?: string;
  checkDomains?: boolean;
};

export async function importList(file: File, fields: ListImportFields, signal?: AbortSignal): Promise<{ listId: number }> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("name", fields.name);
  form.append("sourceLabel", fields.sourceLabel);
  form.append("consentText", fields.consentText);
  form.append("consentConfirmed", "true");
  form.append("excludeRoles", fields.excludeRoles === false ? "false" : "true");
  form.append("checkDomains", fields.checkDomains === false ? "false" : "true");
  if (fields.emailColumn !== undefined) form.append("emailColumn", fields.emailColumn);
  return api.upload<{ listId: number }>("/api/lists", form, { signal });
}

export function useDeleteList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/lists/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.lists });
    },
  });
}
