'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { LobbyMovieCard } from './LobbyMovieCard';
import { UserRequest } from './ThinkingBlock';
import type { Feedback, RecOut, StepText, ToolCallOut } from './types';

/**
 * Completed-cycle view: quoted request, collapsible REASONING (per-step text +
 * tool calls), then the recommendation cards. Recs are bucketed by `group`
 * label when present.
 */
export function LobbyTurn({
  request,
  recs,
  toolCalls,
  stepTexts,
  startIdx,
  onFeedback,
}: {
  request: string;
  recs: RecOut[];
  toolCalls: ToolCallOut[];
  stepTexts: StepText[];
  /** Position offset for "PICK NN" numbering across cycles. */
  startIdx: number;
  onFeedback: (id: string, fb: Feedback) => void;
}) {
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

  return (
    <section className="pb-7 pt-2">
      <UserRequest text={request} />

      {(toolCalls.length > 0 || stepTexts.length > 0) && (
        <ReasoningCollapsible toolCalls={toolCalls} stepTexts={stepTexts} />
      )}

      {showHeaders ? (
        <div className="mt-3">
          {groups.map((g, gi) => (
            <div key={`${g.name ?? 'ungrouped'}-${gi}`} className={gi > 0 ? 'mt-6' : ''}>
              {g.name && (
                <h4 className="mt-6 mb-1 font-mono text-[11px] font-medium uppercase tracking-pill text-mise-accent">
                  ✦ {g.name}
                </h4>
              )}
              {g.items.map((r) => {
                const idx = recs.indexOf(r);
                return (
                  <LobbyMovieCard
                    key={r.id}
                    rec={r}
                    idx={startIdx + idx}
                    onFeedback={(fb) => onFeedback(r.id, fb)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          {recs.map((r, i) => (
            <LobbyMovieCard
              key={r.id}
              rec={r}
              idx={startIdx + i}
              onFeedback={(fb) => onFeedback(r.id, fb)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReasoningCollapsible({
  toolCalls,
  stepTexts,
}: {
  toolCalls: ToolCallOut[];
  stepTexts: StepText[];
}) {
  const [open, setOpen] = useState(false);
  const turns = collectTurns(toolCalls, stepTexts);
  const totalCalls = toolCalls.length;
  return (
    <div className="mt-3.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-sm border border-mise-border bg-transparent px-3.5 py-2.5 text-left text-mise-fg hover:border-mise-accent"
      >
        <span className="eyebrow-accent">REASONING</span>
        <span className="flex-1 font-mono text-xs text-mise-fg-dim">
          {turns.length} turn{turns.length === 1 ? '' : 's'}
          {totalCalls > 0 && ` · ${totalCalls} tool call${totalCalls === 1 ? '' : 's'}`}
        </span>
        <span
          className="text-mise-fg-faint transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-4">
          {turns.map((t) => (
            <div key={t.turn}>
              <div className="eyebrow mb-1.5">STEP {t.turn}</div>
              {t.text && (
                <p className="m-0 mb-2 font-serif text-[16px] italic leading-[1.45] text-mise-fg-dim">
                  {t.text}
                </p>
              )}
              {t.calls.map((c) => {
                const summary = Object.entries(c.toolInput)
                  .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 36)}`)
                  .join(' ');
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-3.5 py-1 font-mono text-xs text-mise-fg-dim"
                  >
                    <span className="w-3.5 text-mise-accent">✓</span>
                    <span className="min-w-[140px] text-mise-fg">{c.toolName}</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-mise-fg-faint">
                      {summary}
                    </span>
                    {c.durationMs > 0 && (
                      <span className="text-[10px] text-mise-fg-faint">{c.durationMs}ms</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TurnView {
  turn: number;
  text: string | null;
  calls: ToolCallOut[];
}

function collectTurns(toolCalls: ToolCallOut[], stepTexts: StepText[]): TurnView[] {
  const byTurn = new Map<number, TurnView>();
  for (const t of stepTexts) {
    if (!byTurn.has(t.turn)) byTurn.set(t.turn, { turn: t.turn, text: null, calls: [] });
    const tv = byTurn.get(t.turn)!;
    tv.text = tv.text ? `${tv.text} ${t.text}` : t.text;
  }
  for (const c of toolCalls) {
    if (!byTurn.has(c.turn)) byTurn.set(c.turn, { turn: c.turn, text: null, calls: [] });
    byTurn.get(c.turn)!.calls.push(c);
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}
