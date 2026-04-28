import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type {
  FeedbackStatus,
  Recommendation,
  Session,
  SessionContinueBody,
  SessionCreateBody,
  SessionCreated,
  SessionDetail,
  SessionList,
} from "@/types";

const keys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["sessions", id] as const,
  catalog: ["catalog"] as const,
};

export function useSessions(limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...keys.sessions, { limit, offset }],
    queryFn: () =>
      api.get<SessionList>(`/api/sessions?limit=${limit}&offset=${offset}`),
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: id ? keys.session(id) : ["sessions", "pending"],
    queryFn: () => api.get<SessionDetail>(`/api/sessions/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as SessionDetail | undefined;
      if (!data) return false;
      if (data.status === "pending" || data.status === "running") return 2000;
      return false;
    },
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SessionCreateBody) =>
      api.post<SessionCreated>("/api/sessions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.sessions });
    },
  });
}

export function useContinueSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      body,
    }: {
      sessionId: string;
      body: SessionContinueBody;
    }) => api.post<SessionCreated>(`/api/sessions/${sessionId}/messages`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.session(vars.sessionId) });
    },
  });
}

export function useSubmitFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      feedback,
    }: {
      id: string;
      feedback: FeedbackStatus;
      sessionId: string;
    }) =>
      api.patch<Recommendation>(`/api/recommendations/${id}/feedback`, {
        feedback,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: keys.session(vars.sessionId) });
    },
  });
}

export type CatalogLoadingPhase =
  | "fetching_movies"
  | "fetching_collections"
  | "persisting"
  | "embedding";

export interface CatalogLoading {
  phase: CatalogLoadingPhase;
  elapsed_seconds: number | null;
  /**
   * Per-phase determinate progress, when the active phase can report it.
   * Null means "this phase is indeterminate — render a sweeping bar".
   */
  progress: { done: number; total: number } | null;
}

export interface CatalogStatus {
  count: number;
  embedded: number;
  age_seconds: number | null;
  collections: Array<{ name: string; size: number }>;
  loading: CatalogLoading | null;
}

export function useCatalog() {
  return useQuery({
    queryKey: keys.catalog,
    queryFn: () => api.get<CatalogStatus>("/api/catalog"),
    // Poll while a refresh is in flight or the library is empty (cold boot
    // window before the warm task has set the phase). Once the catalog is
    // populated and idle, stop polling to avoid noise.
    refetchInterval: (query) => {
      const data = query.state.data as CatalogStatus | undefined;
      if (!data) return 1500;
      if (data.loading) return 1500;
      if (data.count === 0) return 2500;
      return false;
    },
  });
}

export type { Session };
