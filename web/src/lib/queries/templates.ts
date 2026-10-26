import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { TemplatePreview, TemplateSummary, TemplateView } from "@/lib/types";

export function templatesKey() {
  return queryKeys.templates;
}

export function templateKey(id: number) {
  return [...queryKeys.templates, id] as const;
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templatesKey(),
    queryFn: ({ signal }) => api.get<TemplateSummary[]>("/api/templates", { signal }),
    enabled,
  });
}

export function useTemplate(id: number | null, enabled = true) {
  return useQuery({
    queryKey: templateKey(id ?? 0),
    queryFn: ({ signal }) => api.get<TemplateView>(`/api/templates/${id}`, { signal }),
    enabled: enabled && id !== null,
  });
}

export async function previewTemplate(
  id: number,
  body: { listId?: number; pick?: "first" | "next" | "random" } = {},
  signal?: AbortSignal,
): Promise<TemplatePreview> {
  return api.post<TemplatePreview>(`/api/templates/${id}/preview`, body, { signal });
}

export function useTemplatePreview(id: number | null, listId?: number | null, enabled = true) {
  return useQuery({
    queryKey: [...templateKey(id ?? 0), "preview", listId ?? null] as const,
    queryFn: ({ signal }) => previewTemplate(id!, listId ? { listId } : {}, signal),
    enabled: enabled && id !== null,
  });
}

function invalidateTemplates(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.templates });
}

export type TemplateWrite = {
  name: string;
  subject: string;
  html?: string;
  text?: string;
};

export function useCreateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateWrite) => api.post<TemplateView>("/api/templates", body),
    onSuccess: () => invalidateTemplates(client),
  });
}

export function useUpdateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<TemplateWrite> & { variableMap?: TemplateView["variableMap"] } }) =>
      api.put<TemplateView>(`/api/templates/${id}`, body),
    onSuccess: (_data, vars) => {
      invalidateTemplates(client);
      void client.invalidateQueries({ queryKey: templateKey(vars.id) });
    },
  });
}

export function useDeleteTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/templates/${id}`),
    onSuccess: () => invalidateTemplates(client),
  });
}

export function useDuplicateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const src = await api.get<TemplateView>(`/api/templates/${id}`);
      return api.post<TemplateView>("/api/templates", {
        name: `${src.name} (copy)`,
        subject: src.subject,
        html: src.html,
        ...(src.text ? { text: src.text } : {}),
      });
    },
    onSuccess: () => invalidateTemplates(client),
  });
}
