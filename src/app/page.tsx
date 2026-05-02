import {
  dataAgeSeconds,
  embeddedCount,
  getLoadingState,
  movieCount,
} from '@/lib/catalog';
import NewSessionForm from '@/components/NewSessionForm';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [movies, embedded, age] = await Promise.all([
    movieCount(),
    embeddedCount(),
    dataAgeSeconds(),
  ]);
  const loading = getLoadingState();
  const stillIndexing = embedded < movies;

  return (
    <main>
      {movies === 0 && (
        <div className="banner warn">
          Catalog is empty. Run a refresh from your terminal, or wait for the first cron tick.
        </div>
      )}
      {stillIndexing && (
        <div className="banner warn">
          Indexing in progress: {embedded.toLocaleString()} / {movies.toLocaleString()}{' '}
          movies embedded.
        </div>
      )}
      {loading && (
        <div className="banner">
          Catalog refreshing — phase: <strong>{loading.phase}</strong>
          {loading.progress &&
            ` (${loading.progress.done}/${loading.progress.total})`}
        </div>
      )}
      <NewSessionForm />
      <p className="muted" style={{ fontSize: 13, marginTop: 24 }}>
        {movies.toLocaleString()} movies indexed
        {age !== null && (
          <>
            {' · '}refreshed {Math.round(age / 3600)}h ago
          </>
        )}
      </p>
    </main>
  );
}
