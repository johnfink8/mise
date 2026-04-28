import { useState } from "react";
import clsx from "clsx";

import type {
  FeedbackStatus,
  Recommendation,
  SessionDetail,
  StreamEvent,
} from "@/types";
import { RecommendationsList } from "./RecommendationsList";
import {
  ToolLogList,
  eventsToToolEntries,
  toolCallsToEntries,
  type ToolLogEntry,
} from "./ToolLogList";
import css from "./Conversation.module.less";

interface Props {
  session: SessionDetail;
  liveEvents: StreamEvent[];
  liveCycle: number | null;
  inProgress: boolean;
  onFeedback: (rec: Recommendation, next: FeedbackStatus) => void;
  feedbackPending: boolean;
}

export function Conversation({
  session,
  liveEvents,
  liveCycle,
  inProgress,
  onFeedback,
  feedbackPending,
}: Props) {
  const prompts = session.prompts ?? [session.user_prompt];
  const cycleErrorMessage =
    session.status === "error" ? session.error_message : null;

  return (
    <div className={css.root}>
      {prompts.map((prompt, cycle) => {
        const isLatest = cycle === prompts.length - 1;
        const isLive = isLatest && liveCycle === cycle && inProgress;
        const recs = session.recommendations.filter((r) => r.cycle === cycle);
        const persistedToolEntries = toolCallsToEntries(
          session.tool_calls.filter((tc) => tc.cycle === cycle),
        );
        const liveToolEntries = isLive
          ? eventsToToolEntries(liveEvents, cycle)
          : [];
        const entries = mergeEntries(persistedToolEntries, liveToolEntries);
        return (
          <CycleBlock
            key={cycle}
            cycle={cycle}
            prompt={prompt}
            entries={entries}
            recs={recs}
            inProgress={isLive}
            errorMessage={isLatest ? cycleErrorMessage : null}
            onFeedback={onFeedback}
            feedbackPending={feedbackPending}
          />
        );
      })}
    </div>
  );
}

function mergeEntries(
  persisted: ToolLogEntry[],
  live: ToolLogEntry[],
): ToolLogEntry[] {
  if (live.length === 0) return persisted;
  if (persisted.length === 0) return live;
  const seen = new Set<string>();
  const out: ToolLogEntry[] = [];
  for (const e of persisted) {
    const sig = `${e.cycle}:${e.turn}:${e.toolName}:${JSON.stringify(e.toolInput)}`;
    seen.add(sig);
    out.push(e);
  }
  for (const e of live) {
    const sig = `${e.cycle}:${e.turn}:${e.toolName}:${JSON.stringify(e.toolInput)}`;
    if (!seen.has(sig)) out.push(e);
  }
  return out;
}

interface CycleProps {
  cycle: number;
  prompt: string;
  entries: ToolLogEntry[];
  recs: Recommendation[];
  inProgress: boolean;
  errorMessage: string | null;
  onFeedback: (rec: Recommendation, next: FeedbackStatus) => void;
  feedbackPending: boolean;
}

function CycleBlock({
  cycle,
  prompt,
  entries,
  recs,
  inProgress,
  errorMessage,
  onFeedback,
  feedbackPending,
}: CycleProps) {
  // Reasoning panel always starts collapsed; user opens it on demand.
  const [open, setOpen] = useState(false);

  return (
    <div className={css.cycle}>
      <div className={css.queryRow}>
        <div className={css.queryLabel}>
          {cycle === 0
            ? "REQUEST →"
            : `FOLLOW-UP ${String(cycle).padStart(2, "0")} →`}
        </div>
        <div className={css.queryText}>“{prompt}”</div>
      </div>

      {(entries.length > 0 || inProgress) && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={css.reasoningBtn}
          >
            <span className={css.reasoningLabel}>REASONING</span>
            <span className={css.reasoningCount}>
              {entries.length} tool call{entries.length === 1 ? "" : "s"}
              {inProgress && " · running"}
            </span>
            <span
              className={clsx(
                css.reasoningChevron,
                open && css.reasoningChevronOpen,
              )}
            >
              ▾
            </span>
          </button>

          {open && (
            <div className={css.reasoningBody}>
              <ToolLogList
                entries={entries}
                inProgress={inProgress}
                defaultOpenIdx={inProgress ? entries.length - 1 : -1}
              />
            </div>
          )}
        </>
      )}

      {errorMessage && <div className={css.errorAlert}>{errorMessage}</div>}

      {recs.length > 0 && (
        <RecommendationsList
          recommendations={recs}
          onFeedback={onFeedback}
          feedbackPending={feedbackPending}
        />
      )}

      <div className={css.cycleSpacer} />
    </div>
  );
}
