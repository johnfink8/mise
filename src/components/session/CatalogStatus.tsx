'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CatalogStreamEventSchema,
  type CatalogSnapshot,
} from '@/lib/catalog/snapshot';
import { kickoffCatalogRefreshAction } from '@/app/actions/catalog';

function isActive(s: CatalogSnapshot): boolean {
  return s.loading !== null || s.count === 0 || s.embedded < s.count;
}

export function CatalogStatus() {
  const [state, setState] = useState<CatalogSnapshot | null>(null);
  // Guard so we kick off the auto-refresh at most once per mount even if the
  // first few snapshots all observe an empty catalog before the server flips
  // loadingState in response to our action.
  const kickedOff = useRef(false);

  // Subscribe to the catalog SSE stream while the catalog is "active"
  // (refreshing, empty, or partially embedded). When everything settles, the
  // effect tears the connection down; if state ever returns to active the
  // effect re-runs and re-subscribes.
  const active = state === null || isActive(state);
  useEffect(() => {
    if (!active) return;
    const es = new EventSource('/api/catalog/stream');
    es.addEventListener('snapshot', (ev) => {
      try {
        const data: unknown = JSON.parse((ev as MessageEvent).data);
        const parsed = CatalogStreamEventSchema.safeParse({
          type: 'snapshot',
          data,
        });
        if (parsed.success) setState(parsed.data.data);
      } catch {
        // transient — keep streaming
      }
    });
    return () => es.close();
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
      void kickoffCatalogRefreshAction();
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
