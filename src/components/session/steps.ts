import type { LiveToolCall, StepData, StepText, ToolCallOut } from './types';

export function buildSteps(texts: StepText[], calls: ToolCallOut[]): StepData[] {
  const byTurn = new Map<number, StepData>();
  for (const t of texts) {
    if (!byTurn.has(t.turn)) byTurn.set(t.turn, { turn: t.turn, text: null, calls: [] });
    const s = byTurn.get(t.turn)!;
    s.text = s.text ? `${s.text} ${t.text}` : t.text;
  }
  for (const c of calls) {
    if (!byTurn.has(c.turn)) byTurn.set(c.turn, { turn: c.turn, text: null, calls: [] });
    byTurn.get(c.turn)!.calls.push({
      id: c.id,
      toolName: c.toolName,
      toolInput: c.toolInput,
      durationMs: c.durationMs > 0 ? c.durationMs : null,
      done: true,
    });
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

export function buildLiveSteps(
  texts: { cycle: number; turn: number; text: string }[],
  calls: LiveToolCall[],
): StepData[] {
  const byTurn = new Map<number, StepData>();
  for (const t of texts) {
    if (!byTurn.has(t.turn)) byTurn.set(t.turn, { turn: t.turn, text: null, calls: [] });
    const s = byTurn.get(t.turn)!;
    s.text = s.text ? `${s.text} ${t.text}` : t.text;
  }
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (!byTurn.has(c.turn)) byTurn.set(c.turn, { turn: c.turn, text: null, calls: [] });
    byTurn.get(c.turn)!.calls.push({
      id: `live-${c.cycle}-${c.turn}-${i}`,
      toolName: c.toolName,
      toolInput: c.toolInput,
      durationMs: null,
      done: c.done,
    });
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

/** Persisted wins over live for any turn that exists in both. */
export function mergeSteps(persisted: StepData[], live: StepData[]): StepData[] {
  const persistedTurns = new Set(persisted.map((s) => s.turn));
  return [...persisted, ...live.filter((s) => !persistedTurns.has(s.turn))].sort(
    (a, b) => a.turn - b.turn,
  );
}
