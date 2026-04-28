import type { FeedbackStatus, Recommendation } from '@/types'
import { MovieCard } from './MovieCard'
import css from './RecommendationsList.module.less'

interface Props {
  recommendations: Recommendation[]
  onFeedback?: (rec: Recommendation, next: FeedbackStatus) => void
  feedbackPending?: boolean
  emptyMessage?: string
}

export function RecommendationsList({
  recommendations,
  onFeedback,
  feedbackPending,
  emptyMessage,
}: Props) {
  if (!recommendations.length) {
    return <p className={css.empty}>{emptyMessage ?? 'No recommendations yet.'}</p>
  }

  const grouped = groupRecommendations(recommendations)

  if (grouped.length === 1 && grouped[0].label === null) {
    return (
      <div className={css.flat}>
        {grouped[0].items.map((rec) => (
          <MovieCard
            key={rec.id}
            rec={rec}
            onFeedback={onFeedback ? (next) => onFeedback(rec, next) : undefined}
            feedbackPending={feedbackPending}
          />
        ))}
        <div className={css.flatBottom} />
      </div>
    )
  }

  return (
    <div className={css.grouped}>
      {grouped.map((g, idx) => (
        <div key={g.label ?? `__ungrouped__${idx}`}>
          {g.label !== null && (
            <div className={css.groupHeader}>
              ━━━ {g.label.toUpperCase()} · {g.items.length}
            </div>
          )}
          {g.items.map((rec) => (
            <MovieCard
              key={rec.id}
              rec={rec}
              onFeedback={onFeedback ? (next) => onFeedback(rec, next) : undefined}
              feedbackPending={feedbackPending}
            />
          ))}
          <div className={css.flatBottom} />
        </div>
      ))}
    </div>
  )
}

interface Group {
  label: string | null
  items: Recommendation[]
}

function groupRecommendations(recs: Recommendation[]): Group[] {
  const anyGroup = recs.some((r) => r.group && r.group.trim())
  if (!anyGroup) return [{ label: null, items: recs }]
  const order: string[] = []
  const buckets = new Map<string, Recommendation[]>()
  const ungrouped: Recommendation[] = []
  for (const r of recs) {
    const label = r.group?.trim() || null
    if (label === null) {
      ungrouped.push(r)
      continue
    }
    if (!buckets.has(label)) {
      buckets.set(label, [])
      order.push(label)
    }
    buckets.get(label)!.push(r)
  }
  const out: Group[] = order.map((label) => ({ label, items: buckets.get(label)! }))
  if (ungrouped.length > 0) out.push({ label: 'Other picks', items: ungrouped })
  return out
}
