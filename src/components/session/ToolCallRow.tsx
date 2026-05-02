export function ToolCallRow({
  toolName,
  toolInput,
  durationMs,
  done,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  durationMs: number | null;
  done: boolean;
}) {
  const summary = Object.entries(toolInput)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`)
    .join(' ');
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        padding: '4px 0',
        color: done ? 'var(--text-dim)' : 'var(--accent)',
      }}
    >
      <span style={{ width: 14 }}>{done ? '✓' : '…'}</span>
      <span style={{ minWidth: 140, color: 'var(--text)' }}>{toolName}</span>
      <span style={{ flex: 1, color: 'var(--text-faint)' }}>{summary}</span>
      {durationMs != null && durationMs > 0 && (
        <span className="faint">{durationMs}ms</span>
      )}
    </div>
  );
}
