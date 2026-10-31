import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ContactView, ContactsPage, ListDetail, ListPreview, ListView } from "@/lib/types";

export type ListFilters = {
  q?: string;
  status?: "importing" | "ready" | "failed" | "";
  tag?: string;
  sort?: "id" | "name" | "created_at" | "valid_count";
  order?: "asc" | "desc";
};

export type ContactFilters = {
  q?: string;
  sort?: "id" | "email" | "domain";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function toQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function listsKey(filters: ListFilters = {}) {
  return [...queryKeys.lists, filters] as const;
}

export function listKey(id: number) {
  return [...queryKeys.lists, id] as const;
}

export function contactsKey(listId: number, filters: ContactFilters = {}) {
  return [...queryKeys.lists, listId, "contacts", filters] as const;
}

export function useLists(filters: ListFilters = {}, enabled = true) {
  return useQuery({
    queryKey: listsKey(filters),
    queryFn: ({ signal }) =>
      api.get<ListView[]>(
        `/api/lists${toQuery({
          q: filters.q,
          status: filters.status || undefined,
          tag: filters.tag,
          sort: filters.sort,
          order: filters.order,
        })}`,
        { signal },
      ),
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

export function useListContacts(listId: number | null, filters: ContactFilters = {}, enabled = true) {
  return useQuery({
    queryKey: contactsKey(listId ?? 0, filters),
    queryFn: ({ signal }) =>
      api.get<ContactsPage>(
        `/api/lists/${listId}/contacts${toQuery({
          q: filters.q,
          sort: filters.sort,
          order: filters.order,
          limit: filters.limit,
          offset: filters.offset,
        })}`,
        { signal },
      ),
    enabled: enabled && listId !== null,
  });
}

export async function previewListCsv(file: File, signal?: AbortSignal): Promise<ListPreview> {
  const form = new FormData();
  form.append("file", file.slice(0, 65536), file.name);
  return api.upload<ListPreview>("/api/lists/preview", form, { signal });
}

/** Must match server/http/server.ts `UPLOAD_LIMIT`. */
export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

export type ListImportFields = {
  name: string;
  sourceLabel: string;
  consentText: string;
  consentConfirmed: true;
  excludeRoles?: boolean;
  emailColumn?: string;
  checkDomains?: boolean;
};

export function assertUploadSize(file: File): void {
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new Error(`File is larger than ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB`);
  }
}

export async function importList(file: File, fields: ListImportFields, signal?: AbortSignal): Promise<{ listId: number }> {
  assertUploadSize(file);
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

export function useUpdateList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; source_label?: string; tags?: string[] }) =>
      api.patch<ListDetail>(`/api/lists/${id}`, body),
    onSuccess: (_data, vars) => {
      void client.invalidateQueries({ queryKey: queryKeys.lists });
      void client.invalidateQueries({ queryKey: listKey(vars.id) });
      void client.invalidateQueries({ queryKey: queryKeys.tags });
    },
  });
}

export function useUpdateContact(listId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      ...body
    }: {
      contactId: number;
      email?: string;
      fields?: Record<string, string>;
    }) => api.patch<ContactView>(`/api/lists/${listId}/contacts/${contactId}`, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...queryKeys.lists, listId, "contacts"] });
      void client.invalidateQueries({ queryKey: listKey(listId) });
    },
  });
}

export function useDeleteContact(listId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (contactId: number) => api.del(`/api/lists/${listId}/contacts/${contactId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...queryKeys.lists, listId, "contacts"] });
      void client.invalidateQueries({ queryKey: listKey(listId) });
      void client.invalidateQueries({ queryKey: queryKeys.lists });
    },
  });
}

export function useSuppressContact(listId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (contactId: number) => api.post(`/api/lists/${listId}/contacts/${contactId}/suppress`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...queryKeys.lists, listId, "contacts"] });
    },
  });
}
