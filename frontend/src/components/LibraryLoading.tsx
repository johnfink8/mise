import type { CatalogLoading } from '@/api/hooks'

import css from './LibraryLoading.module.less'

interface Props {
  loading: CatalogLoading
  count: number
}

const PHASE_COPY: Record<CatalogLoading['phase'], string> = {
  fetching_movies: 'Reading movies from Plex',
  fetching_collections: 'Reading collections from Plex',
  persisting: 'Writing the catalog to Postgres',
  embedding: 'Indexing for similarity search',
}

const PHASE_UNIT: Record<CatalogLoading['phase'], string> = {
  fetching_movies: 'movies',
  fetching_collections: 'collections',
  persisting: 'movies',
  embedding: 'indexed',
}

/**
 * Cold-start / refresh status panel for the home page. Shown when the
 * catalog is empty or actively syncing — gives the user a "the system is
 * doing something" signal so they don't think it's hung. Renders a
 * determinate progress bar whenever the active phase reports `progress`,
 * and a sweeping indeterminate bar otherwise.
 */
export function LibraryLoading({ loading, count }: Props) {
  const copy = PHASE_COPY[loading.phase]
  const unit = PHASE_UNIT[loading.phase]
  const progress = loading.progress
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null

  return (
    <div className={css.root}>
      <div className={css.label}>LOADING LIBRARY</div>
      <div className={css.copy}>
        {copy}
        <span className={css.ellipsis}>…</span>
      </div>

      {pct !== null ? (
        <div className={css.barTrack} aria-label={`${pct}% complete`}>
          <div className={css.barFill} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className={css.barTrack} aria-label="working">
          <div className={css.barIndeterminate} />
        </div>
      )}

      <div className={css.meta}>
        {progress
          ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} ${unit}`
          : count > 0
            ? `${count.toLocaleString()} titles in catalog`
            : 'Connecting to Plex'}
      </div>
    </div>
  )
}
