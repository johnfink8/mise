import {
  dataAgeSeconds,
  embeddedCount,
  getLoadingState,
  movieCount,
} from '@/lib/catalog';

/**
 * Async Server Component — fetches catalog stats. Wrapped in <Suspense> by the
 * page so the rest of the home shell renders immediately while these counts
 * stream in. All three queries run in parallel.
 */
export async function CatalogStatus() {
  const [movies, embedded, age] = await Promise.all([
    movieCount(),
    embeddedCount(),
    dataAgeSeconds(),
  ]);
  const loading = getLoadingState();
  const stillIndexing = embedded < movies;

  return (
    <>
      <div className="space-y-3 px-7 pb-3">
        {movies === 0 && (
          <div className="rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-sm text-mise-down">
            Catalog is empty. Run a refresh from your terminal, or wait for the first cron tick.
          </div>
        )}
        {stillIndexing && (
          <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
            Indexing in progress: {embedded.toLocaleString()} / {movies.toLocaleString()} movies
            embedded.
          </div>
        )}
        {loading && (
          <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
            Catalog refreshing — phase: <strong>{loading.phase}</strong>
            {loading.progress && ` (${loading.progress.done}/${loading.progress.total})`}
          </div>
        )}
      </div>

      <div className="eyebrow px-7 pb-3 pt-6">
        {movies.toLocaleString()} films catalogued
        {age !== null && ` · refreshed ${Math.round(age / 3600)}h ago`}
      </div>
    </>
  );
}
