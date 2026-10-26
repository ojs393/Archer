import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "./api";

function retryOnce(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, retry: retryOnce, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
