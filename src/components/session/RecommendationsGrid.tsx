import { RecommendationCard } from './RecommendationCard';
import type { Feedback, RecOut } from './types';

export function RecommendationsGrid({
  recs,
  onFeedback,
}: {
  recs: RecOut[];
  onFeedback: (id: string, fb: Feedback) => void;
}) {
  // Bucket by group label, preserving order. Recs without a group share an
  // "ungrouped" bucket. If the agent only emits one group OR none at all,
  // fall back to a flat grid (no headers).
  const groups: { name: string | null; items: RecOut[] }[] = [];
  for (const r of recs) {
    const name = r.group?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) {
      last.items.push(r);
    } else {
      groups.push({ name, items: [r] });
    }
  }

  const hasNamedGroups = groups.some((g) => g.name !== null);
  const showHeaders = hasNamedGroups && groups.length > 1;

  if (!showHeaders) {
    return <FlatGrid recs={recs} onFeedback={onFeedback} hideGroupLabel={false} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {groups.map((g, i) => (
        <div key={`${g.name ?? 'ungrouped'}-${i}`}>
          {g.name && (
            <h4
              style={{
                margin: '0 0 12px',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: 0.04,
                textTransform: 'uppercase',
                color: 'var(--accent)',
              }}
            >
              {g.name}
            </h4>
          )}
          <FlatGrid recs={g.items} onFeedback={onFeedback} hideGroupLabel />
        </div>
      ))}
    </div>
  );
}

function FlatGrid({
  recs,
  onFeedback,
  hideGroupLabel,
}: {
  recs: RecOut[];
  onFeedback: (id: string, fb: Feedback) => void;
  hideGroupLabel: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {recs.map((r) => (
        <RecommendationCard
          key={r.id}
          rec={r}
          onFeedback={(fb) => onFeedback(r.id, fb)}
          hideGroupLabel={hideGroupLabel}
        />
      ))}
    </div>
  );
}
