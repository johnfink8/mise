'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { StreamingText } from './StreamingText';
import type { LiveToolCall, StepText, ToolCallOut } from './types';

/**
 * Loading-state UI for an in-flight cycle.
 *
 *   - User request quoted
 *   - MISE → narration: latest turn's text typing out, with a blinking caret
 *   - Indeterminate progress bar
 *   - Collapsible REASONING with per-tool-call list (✓ done | pulse running)
 */
export function ThinkingBlock({
  userRequest,
  stepTexts,
  liveCalls,
  persistedCalls = [],
}: {
  userRequest: string;
  stepTexts: StepText[];
  liveCalls: LiveToolCall[];
  persistedCalls?: ToolCallOut[];
}) {
  const [open, setOpen] = useState(false);

  const sortedTexts = [...stepTexts].sort((a, b) => a.turn - b.turn);
  const current = sortedTexts[sortedTexts.length - 1] ?? null;

  const totalCalls = liveCalls.length + persistedCalls.length;
  const doneCalls =
    liveCalls.filter((c) => c.done).length + persistedCalls.length;
  const status = totalCalls === 0 ? 'starting' : doneCalls < totalCalls ? 'running' : 'composing';
  const label = totalCalls
    ? `${totalCalls} tool call${totalCalls === 1 ? '' : 's'} · ${status}`
    : 'starting…';

  return (
    <div className="animate-mise-fade-up">
      <UserRequest text={userRequest} />

      {/* MISE narration */}
      <div className="flex items-start gap-4 pt-5 pb-1">
        <div className="eyebrow-accent min-w-[70px] pt-1.5">MISE →</div>
        <div className="flex flex-1 flex-col gap-2">
          {current ? (
            <div
              key={`turn-${current.turn}`}
              className="font-serif text-[20px] italic leading-[1.45] text-mise-fg"
            >
              <StreamingText text={current.text} />
              <span className="caret" />
            </div>
          ) : (
            <div className="font-serif text-[20px] italic leading-[1.45] text-mise-fg-dim">
              <span className="caret" />
            </div>
          )}
        </div>
      </div>

      {/* Indeterminate emerald progress bar */}
      <div className="mt-3.5 h-0.5 w-full overflow-hidden rounded-sm bg-mise-border">
        <div className="h-full w-2/5 animate-mise-indeterminate rounded-sm bg-mise-accent" />
      </div>

      {/* REASONING collapsible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3.5 flex w-full cursor-pointer items-center gap-3 rounded-sm border border-mise-border bg-transparent px-3.5 py-2.5 text-left text-mise-fg hover:border-mise-accent"
      >
        <span className="eyebrow-accent">REASONING</span>
        <span className="flex-1 font-mono text-xs text-mise-fg-dim">{label}</span>
        <span
          className="text-mise-fg-faint transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-1.5">
          {persistedCalls.map((c) => (
            <ToolRow
              key={`p-${c.id}`}
              done
              toolName={c.toolName}
              toolInput={c.toolInput}
              durationMs={c.durationMs > 0 ? c.durationMs : null}
            />
          ))}
          {liveCalls.map((c, i) => (
            <ToolRow
              key={`l-${c.cycle}-${c.turn}-${i}`}
              done={c.done}
              toolName={c.toolName}
              toolInput={c.toolInput}
              durationMs={null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function UserRequest({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-4 border-y border-mise-border py-4">
      <div className="eyebrow min-w-[70px] pt-1.5">REQUEST →</div>
      <div className="flex-1 font-serif text-[22px] italic leading-[1.3] text-mise-fg">
        &ldquo;{text}&rdquo;
      </div>
    </div>
  );
}

function ToolRow({
  done,
  toolName,
  toolInput,
  durationMs,
}: {
  done: boolean;
  toolName: string;
  toolInput: Record<string, unknown>;
  durationMs: number | null;
}) {
  const summary = Object.entries(toolInput)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 36)}`)
    .join(' ');
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-1 font-mono text-xs ${
        done ? 'text-mise-fg-dim' : 'text-mise-fg'
      }`}
    >
      <span className="inline-flex w-3.5 justify-center">
        {done ? (
          <span className="text-[13px] text-mise-accent">✓</span>
        ) : (
          <span className="size-1.5 animate-mise-pulse rounded-full bg-mise-accent" />
        )}
      </span>
      <span className="min-w-[140px] tracking-[0.04em]">
        {toolName}
        {!done && <span className="caret" />}
      </span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-mise-fg-faint">
        {summary}
      </span>
      {done && durationMs != null && (
        <span className="text-[10px] tracking-[0.1em] text-mise-fg-faint">{durationMs}ms</span>
      )}
    </div>
  );
}
