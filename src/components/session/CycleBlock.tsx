import { RecommendationsGrid } from './RecommendationsGrid';
import { StepBlock } from './StepBlock';
import type { Feedback, RecOut, StepData } from './types';

export function CycleBlock({
  cycle,
  prompt,
  steps,
  recs,
  onFeedback,
}: {
  cycle: number;
  prompt: string | undefined;
  steps: StepData[];
  recs: RecOut[];
  onFeedback: (id: string, fb: Feedback) => void;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      {cycle > 0 && prompt && (
        <p
          className="muted"
          style={{
            fontSize: 14,
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            margin: '0 0 16px',
          }}
        >
          {prompt}
        </p>
      )}
      {steps.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {steps.map((s) => (
            <StepBlock key={`step-${cycle}-${s.turn}`} step={s} />
          ))}
        </div>
      )}
      <RecommendationsGrid recs={recs} onFeedback={onFeedback} />
    </section>
  );
}
