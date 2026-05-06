'use client';

import { useEffect, useRef, useState } from 'react';
import type { LoadingPhase } from '@/lib/catalog';

interface CatalogSnapshot {
  count: number;
  embedded: number;
  age_seconds: number | null;
  loading: {
    phase: LoadingPhase;
    elapsed_seconds: number;
    progress: { done: number; total: number } | null;
  } | null;
  last_refresh: {
    attempted_seconds_ago: number;
    error: string | null;
  } | null;
}

function isActive(s: CatalogSnapshot): boolean {
  return s.loading !== null || s.count === 0 || s.embedded < s.count;
}

export function CatalogStatus() {
  const [state, setState] = useState<CatalogSnapshot | null>(null);
  // Guard so we POST the auto-kickoff at most once per mount even if the
  // first few polls all observe an empty catalog before the server flips
  // loadingState in response to our POST.
  const kickedOff = useRef(false);

  // Single source of truth for the catalog status: poll /api/catalog. Stop
  // polling once everything is settled (count > 0 and fully embedded with
  // no in-flight refresh) — useEffect re-runs and re-arms the interval if
  // we ever go back to active.
  const active = state === null || isActive(state);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch('/api/catalog', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as CatalogSnapshot;
        setState(data);
      } catch {
        // transient — keep polling
      }
    }
    fetchOnce();
    const id = window.setInterval(fetchOnce, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  // Auto-kickoff fires in two cases:
  //   1. Empty catalog with no prior attempt — first-run.
  //   2. Partial embedding state with no in-flight refresh — usually means
  //      the server was killed mid-embedding and the boot-time resume in
  //      instrumentation.ts didn't fire (e.g. process restarted *after*
  //      the route handlers loaded). Belt-and-suspenders.
  useEffect(() => {
    if (state === null || kickedOff.current) return;
    const empty = state.count === 0 && !state.loading && !state.last_refresh;
    const stalledIndexing =
      state.count > 0 && state.embedded < state.count && !state.loading;
    if (empty || stalledIndexing) {
      kickedOff.current = true;
      fetch('/api/catalog', { method: 'POST' }).catch(() => undefined);
    }
  }, [state]);

  if (state === null) {
    return (
      <div className="eyebrow px-7 pb-3 pt-6 opacity-50">Checking catalog…</div>
    );
  }

  const stillIndexing = state.count > 0 && state.embedded < state.count;

  return (
    <>
      <div className="space-y-3 px-7 pb-3">
        {state.loading && (
          <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
            Catalog refreshing — phase: <strong>{state.loading.phase}</strong>
            {state.loading.progress &&
              ` (${state.loading.progress.done.toLocaleString()}/${state.loading.progress.total.toLocaleString()})`}
          </div>
        )}
        {!state.loading && state.count === 0 && state.last_refresh?.error && (
          <div className="rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-sm text-mise-down">
            Refresh failed: {state.last_refresh.error}
          </div>
        )}
        {!state.loading &&
          state.count === 0 &&
          state.last_refresh !== null &&
          state.last_refresh.error === null && (
            <div className="rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-sm text-mise-down">
              Refresh completed but Plex returned no movies. Check
              <code className="mx-1 font-mono">PLEX_BASE_URL</code> and
              <code className="mx-1 font-mono">PLEX_TOKEN</code>.
            </div>
          )}
        {!state.loading && state.count === 0 && state.last_refresh === null && (
          <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
            Catalog is empty — kicking off the first refresh now.
          </div>
        )}
        {!state.loading && stillIndexing && (
          <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
            Indexing in progress: {state.embedded.toLocaleString()} /{' '}
            {state.count.toLocaleString()} movies embedded.
          </div>
        )}
      </div>

      <div className="eyebrow px-7 pb-3 pt-6">
        {state.count.toLocaleString()} films catalogued
        {state.age_seconds !== null &&
          ` · refreshed ${Math.round(state.age_seconds / 3600)}h ago`}
      </div>
    </>
  );
}
