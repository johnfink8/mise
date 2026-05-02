import {
  dataAgeSeconds,
  embeddedCount,
  getLoadingState,
  movieCount,
} from '@/lib/catalog';
import { HomeStart } from '@/components/session/HomeStart';
import { LobbyTitle } from '@/components/session/LobbyTitle';
import { LobbyTopBar } from '@/components/session/LobbyTopBar';

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
    <div className="flex min-h-screen flex-col">
      <LobbyTopBar status="initial" />

      <div className="mx-auto w-full max-w-[980px] flex-1 px-5 sm:px-7">
        <LobbyTitle size="hero" />

        <div className="max-w-[560px] px-7 pb-7">
          <p className="m-0 font-serif text-[18px] italic leading-[1.5] text-mise-fg-dim">
            Tell me what you&rsquo;re in the mood for. I&rsquo;ll comb through your Plex
            library and pull a programme together. Send a follow-up to refine.
          </p>
        </div>

        <div className="space-y-3 px-7 pb-3">
          {movies === 0 && (
            <div className="rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-sm text-mise-down">
              Catalog is empty. Run a refresh from your terminal, or wait for the first cron
              tick.
            </div>
          )}
          {stillIndexing && (
            <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
              Indexing in progress: {embedded.toLocaleString()} / {movies.toLocaleString()}{' '}
              movies embedded.
            </div>
          )}
          {loading && (
            <div className="rounded-sm border border-mise-border bg-mise-bg-elev px-4 py-3 text-sm text-mise-fg-dim">
              Catalog refreshing — phase: <strong>{loading.phase}</strong>
              {loading.progress &&
                ` (${loading.progress.done}/${loading.progress.total})`}
            </div>
          )}
        </div>

        <div className="eyebrow px-7 pb-3 pt-6">
          {movies.toLocaleString()} films catalogued
          {age !== null && ` · refreshed ${Math.round(age / 3600)}h ago`}
        </div>
      </div>

      <HomeStart />
    </div>
  );
}
