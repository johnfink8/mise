import { ToolCallRow } from './ToolCallRow';
import type { StepData } from './types';

export function StepBlock({ step }: { step: StepData }) {
  const inFlight = step.calls.some((c) => !c.done);
  return (
    <div
      style={{
        padding: '12px 0',
        borderTop: '1px solid var(--border)',
      }}
    >
      <div
        className="faint"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 6 }}
      >
        step {step.turn} {inFlight && '· running'}
      </div>
      {step.text && (
        <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text)' }}>{step.text}</p>
      )}
      {step.calls.length > 0 && (
        <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
          {step.calls.map((c, i) => (
            <ToolCallRow
              key={c.id ?? `${step.turn}-${i}`}
              toolName={c.toolName}
              toolInput={c.toolInput}
              durationMs={c.durationMs}
              done={c.done}
            />
          ))}
        </div>
      )}
    </div>
  );
}
