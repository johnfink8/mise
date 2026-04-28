import { Fragment, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import clsx from "clsx";

import css from "./ToolLogList.module.less";
import type { StreamEvent, ToolCall } from "@/types";

export interface ToolLogEntry {
  id: string;
  cycle: number;
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
  durationMs?: number;
  state: "pending" | "done" | "error";
}

export function eventsToToolEntries(
  events: StreamEvent[],
  cycle?: number,
): ToolLogEntry[] {
  const byKey = new Map<string, ToolLogEntry>();
  for (const evt of events) {
    const evtCycle = (evt.data.cycle as number | undefined) ?? 0;
    if (cycle !== undefined && evtCycle !== cycle) continue;
    if (evt.type === "tool_call_started") {
      const turn = evt.data.turn as number;
      const tool = evt.data.tool_name as string;
      const input = (evt.data.tool_input as Record<string, unknown>) ?? {};
      const key = `${evtCycle}:${turn}:${tool}:${JSON.stringify(input)}`;
      byKey.set(key, {
        id: key,
        cycle: evtCycle,
        turn,
        toolName: tool,
        toolInput: input,
        state: "pending",
      });
    } else if (evt.type === "tool_call_completed") {
      const turn = evt.data.turn as number;
      const tool = evt.data.tool_name as string;
      const summary = evt.data.summary as Record<string, unknown> | undefined;
      const duration = evt.data.duration_ms as number | undefined;
      const output = evt.data.tool_output as
        | Record<string, unknown>
        | null
        | undefined;
      const input = (evt.data.tool_input as Record<string, unknown>) ?? {};
      let matchedKey: string | undefined;
      for (const [k, v] of byKey.entries()) {
        if (
          v.cycle === evtCycle &&
          v.turn === turn &&
          v.toolName === tool &&
          v.state === "pending"
        ) {
          matchedKey = k;
          break;
        }
      }
      const key =
        matchedKey ??
        `${evtCycle}:${turn}:${tool}:${JSON.stringify(input)}:done`;
      const existing = byKey.get(key);
      byKey.set(key, {
        id: key,
        cycle: evtCycle,
        turn,
        toolName: tool,
        toolInput: existing?.toolInput ?? input,
        toolOutput: output ?? null,
        summary,
        durationMs: duration,
        state: "done",
      });
    }
  }
  return Array.from(byKey.values());
}

export function toolCallsToEntries(toolCalls: ToolCall[]): ToolLogEntry[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    cycle: tc.cycle,
    turn: tc.turn,
    toolName: tc.tool_name,
    toolInput: tc.tool_input ?? {},
    toolOutput: tc.tool_output,
    summary: deriveSummary(tc.tool_output),
    durationMs: tc.duration_ms ?? undefined,
    state: "done",
  }));
}

function deriveSummary(
  output: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!output) return undefined;
  const summary: Record<string, unknown> = {};
  if (typeof output.total_matches === "number")
    summary.total_matches = output.total_matches;
  if (typeof output.count === "number") summary.count = output.count;
  if (typeof output.ranked_by === "string")
    summary.ranked_by = output.ranked_by;
  if (Array.isArray(output.results) && summary.count == null)
    summary.count = output.results.length;
  return Object.keys(summary).length ? summary : undefined;
}

interface Props {
  entries: ToolLogEntry[];
  inProgress?: boolean;
  defaultOpenIdx?: number;
}

export function ToolLogList({
  entries,
  inProgress,
  defaultOpenIdx = -1,
}: Props) {
  if (entries.length === 0 && !inProgress) return null;
  const sorted = [...entries].sort((a, b) => {
    if (a.cycle !== b.cycle) return a.cycle - b.cycle;
    if (a.turn !== b.turn) return a.turn - b.turn;
    return a.id.localeCompare(b.id);
  });
  return (
    <div className={css.list}>
      {sorted.map((e, i) => (
        <ToolCallCard key={e.id} entry={e} defaultOpen={i === defaultOpenIdx} />
      ))}
      {inProgress && sorted.every((e) => e.state !== "pending") && (
        <div className={css.thinkingRow}>↳ thinking…</div>
      )}
    </div>
  );
}

function formatArgs(input: Record<string, unknown>): JSX.Element {
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  const visible = entries.slice(0, 2);
  return (
    <>
      {visible.map(([k, v], i) => (
        <span key={k}>
          {k}=
          <span className={css.argsHi}>
            {Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)}
          </span>
          {i < visible.length - 1 ? ", " : ""}
        </span>
      ))}
      {entries.length > 2 && <span>, …</span>}
    </>
  );
}

function summaryPills(
  summary: Record<string, unknown>,
): Array<[string, string]> {
  return Object.entries(summary)
    .slice(0, 3)
    .map(
      ([k, v]) =>
        [k, Array.isArray(v) ? String(v.length) : String(v)] as [
          string,
          string,
        ],
    );
}

interface CardProps {
  entry: ToolLogEntry;
  defaultOpen?: boolean;
}

function ToolCallCard({ entry, defaultOpen }: CardProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [tab, setTab] = useState<"input" | "output">("output");
  const expandable = entry.state !== "pending";
  const pills = entry.summary ? summaryPills(entry.summary) : [];
  const took = entry.durationMs != null ? `${entry.durationMs}ms` : "—";
  const outputCounts =
    entry.toolOutput && typeof entry.toolOutput === "object"
      ? deriveCounts(entry.toolOutput)
      : null;

  return (
    <div className={css.card}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={css.cardHeader}
      >
        <span className={css.cardSummary}>
          <span className={css.toolName}>{entry.toolName}</span>
          <span className={css.parens}>(</span>
          <span className={css.argsLine}>{formatArgs(entry.toolInput)}</span>
          <span className={css.parens}>)</span>
          {pills.map(([k, v]) => (
            <span key={k} className={css.pill}>
              {k} <span className={css.pillHi}>{v}</span>
            </span>
          ))}
          <span className={css.took}>· {took}</span>
        </span>
        {expandable && (
          <span className={css.expandIcon}>
            {open ? (
              <ExpandLessIcon sx={{ fontSize: 16 }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 16 }} />
            )}
          </span>
        )}
      </button>

      {open && (
        <div className={css.cardBody}>
          <div className={css.tabs}>
            {(["input", "output"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={clsx(css.tab, tab === t && css.tabActive)}
              >
                {t}
              </button>
            ))}
            <span className={css.tabSpacer} />
            {tab === "output" && outputCounts && (
              <span className={css.tabCounts}>{outputCounts}</span>
            )}
          </div>
          <div className={css.cardJson}>
            <JsonView
              value={tab === "input" ? entry.toolInput : entry.toolOutput}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function deriveCounts(output: Record<string, unknown>): string | null {
  const results = output.results;
  if (Array.isArray(results)) {
    const total = output.total_matches ?? output.count ?? results.length;
    return `${results.length} of ${total}`;
  }
  if (typeof output.count === "number") return `${output.count}`;
  return null;
}

// --- JsonView ---------------------------------------------------------------

interface JsonViewProps {
  value: unknown;
}

export function JsonView({ value }: JsonViewProps) {
  return (
    <div className={css.jsonView}>
      <JNode v={value} k={null} depth={0} defaultOpen isLast />
    </div>
  );
}

interface JNodeProps {
  v: unknown;
  k: string | null;
  depth: number;
  defaultOpen: boolean;
  isLast: boolean;
}

function JNode({ v, k, depth, defaultOpen, isLast }: JNodeProps) {
  const isObj = v && typeof v === "object" && !Array.isArray(v);
  const isArr = Array.isArray(v);
  const pad = { paddingLeft: depth * 14 };
  const keyEl =
    k != null ? (
      <Fragment>
        <span className={css.jKey}>"{k}"</span>
        <span className={css.jPunct}>: </span>
      </Fragment>
    ) : null;
  const trail = isLast ? "" : ",";

  if (isObj) {
    return (
      <JObject
        v={v as Record<string, unknown>}
        keyEl={keyEl}
        pad={pad}
        depth={depth}
        defaultOpen={defaultOpen}
        trail={trail}
      />
    );
  }
  if (isArr) {
    return (
      <JArray
        v={v as unknown[]}
        keyEl={keyEl}
        pad={pad}
        depth={depth}
        defaultOpen={defaultOpen}
        trail={trail}
      />
    );
  }
  return (
    <div style={pad}>
      {keyEl}
      <JPrim v={v} />
      <span className={css.jPunct}>{trail}</span>
    </div>
  );
}

interface JObjectProps {
  v: Record<string, unknown>;
  keyEl: React.ReactNode;
  pad: { paddingLeft: number };
  depth: number;
  defaultOpen: boolean;
  trail: string;
}

function JObject({ v, keyEl, pad, depth, defaultOpen, trail }: JObjectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = Object.entries(v);
  if (entries.length === 0) {
    return (
      <div style={pad}>
        {keyEl}
        <span className={css.jPunct}>
          {`{}`}
          {trail}
        </span>
      </div>
    );
  }
  return (
    <>
      <div style={pad}>
        {keyEl}
        <Toggle open={open} setOpen={setOpen} />
        <span className={css.jPunct}>{`{`}</span>
        {!open && (
          <span className={css.jPunct}>
            {" "}
            {entries.length} keys {`}`}
            {trail}
          </span>
        )}
      </div>
      {open &&
        entries.map(([ck, cv], i) => (
          <JNode
            key={ck}
            v={cv}
            k={ck}
            depth={depth + 1}
            defaultOpen={depth + 1 < 1}
            isLast={i === entries.length - 1}
          />
        ))}
      {open && (
        <div style={pad}>
          <span className={css.jPunct}>
            {`}`}
            {trail}
          </span>
        </div>
      )}
    </>
  );
}

interface JArrayProps {
  v: unknown[];
  keyEl: React.ReactNode;
  pad: { paddingLeft: number };
  depth: number;
  defaultOpen: boolean;
  trail: string;
}

function JArray({ v, keyEl, pad, depth, defaultOpen, trail }: JArrayProps) {
  const [open, setOpen] = useState(defaultOpen && depth < 1);
  const [showAll, setShowAll] = useState(false);
  if (v.length === 0) {
    return (
      <div style={pad}>
        {keyEl}
        <span className={css.jPunct}>[]{trail}</span>
      </div>
    );
  }
  const allPrim = v.every((x) => x === null || typeof x !== "object");
  if (allPrim && v.length <= 6) {
    return (
      <div style={pad}>
        {keyEl}
        <span className={css.jPunct}>[</span>
        {v.map((x, i) => (
          <Fragment key={i}>
            <JPrim v={x} />
            {i < v.length - 1 && <span className={css.jPunct}>, </span>}
          </Fragment>
        ))}
        <span className={css.jPunct}>]{trail}</span>
      </div>
    );
  }
  const visible = showAll ? v : v.slice(0, 3);
  const hidden = v.length - visible.length;
  return (
    <>
      <div style={pad}>
        {keyEl}
        <Toggle open={open} setOpen={setOpen} />
        <span className={css.jPunct}>[</span>
        {!open && (
          <span className={css.jPunct}>
            {" "}
            {v.length} items ]{trail}
          </span>
        )}
      </div>
      {open &&
        visible.map((cv, i) => (
          <JNode
            key={i}
            v={cv}
            k={null}
            depth={depth + 1}
            defaultOpen={depth + 1 < 2}
            isLast={i === visible.length - 1 && hidden === 0}
          />
        ))}
      {open && hidden > 0 && (
        <div style={{ paddingLeft: (depth + 1) * 14 }}>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={css.jMore}
          >
            +{hidden} more →
          </button>
        </div>
      )}
      {open && (
        <div style={pad}>
          <span className={css.jPunct}>]{trail}</span>
        </div>
      )}
    </>
  );
}

function JPrim({ v }: { v: unknown }) {
  if (v === null || v === undefined)
    return <span className={css.jNull}>null</span>;
  if (typeof v === "string") return <span className={css.jString}>"{v}"</span>;
  if (typeof v === "number") return <span className={css.jNumber}>{v}</span>;
  if (typeof v === "boolean")
    return <span className={css.jBool}>{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function Toggle({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={css.jToggle}
    >
      {open ? "▾" : "▸"}
    </button>
  );
}
