import { useEffect, useRef, useState } from "react";
import { CircularProgress, LinearProgress } from "@mui/material";
import { useParams } from "react-router-dom";
import clsx from "clsx";

import { ChatPanel } from "@/components/ChatPanel";
import { LobbyTitle } from "@/components/LobbyTitle";
import { RecommendationsList } from "@/components/RecommendationsList";
import {
  ToolLogList,
  eventsToToolEntries,
  toolCallsToEntries,
  type ToolLogEntry,
} from "@/components/ToolLogList";
import { useContinueSession, useSession, useSubmitFeedback } from "@/api/hooks";
import { openSessionStream } from "@/api/sse";
import type {
  FeedbackStatus,
  Recommendation,
  SessionStatus,
  StreamEvent,
} from "@/types";

import css from "./SessionDetailPage.module.less";

const STATUS_CLASS: Record<SessionStatus, string> = {
  pending: css.statusPending,
  running: css.statusRunning,
  complete: css.statusComplete,
  error: css.statusError,
};

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useSession(id);
  const feedback = useSubmitFeedback();
  const cont = useContinueSession();

  // SSE wiring (same shape as HomePage) — lets the user resume the session
  // right here on the detail page.
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [activeCycle, setActiveCycle] = useState<number | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    setEvents([]);
    setStreamDone(false);
    const close = openSessionStream(id, (evt) => {
      setEvents((prev) => [...prev, evt]);
      if (typeof evt.data.cycle === "number") {
        setActiveCycle(evt.data.cycle as number);
      }
      if (evt.type === "recommendations_ready" || evt.type === "error") {
        setStreamDone(true);
      }
    });
    return close;
  }, [id]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [events.length, data?.recommendations.length, data?.prompts?.length]);

  if (isLoading) {
    return (
      <div className={css.spinnerWrap}>
        <CircularProgress sx={{ color: "var(--lobby-accent)" }} />
      </div>
    );
  }
  if (error || !data) {
    return <div className={css.errorPanel}>Session not found.</div>;
  }

  const handleFeedback = (rec: Recommendation, next: FeedbackStatus) => {
    if (!id) return;
    feedback.mutate({ id: rec.id, feedback: next, sessionId: id });
  };

  const handleContinue = async (text: string) => {
    if (!id) return;
    setStreamDone(false);
    const nextCycle = data.prompts?.length ?? 1;
    setActiveCycle(nextCycle);
    await cont.mutateAsync({ sessionId: id, body: { prompt: text } });
  };

  const status = data.status;
  const inProgress =
    !streamDone && (status === "pending" || status === "running");

  const prompts = data.prompts ?? [data.user_prompt];
  const cycles = Array.from(
    new Set([
      ...prompts.map((_, i) => i),
      ...data.recommendations.map((r) => r.cycle),
      ...data.tool_calls.map((tc) => tc.cycle),
    ]),
  ).sort((a, b) => a - b);

  // Latest follow-up suggestion drives the placeholder when continuing.
  const liveSuggestion = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i];
      if (
        evt.type === "recommendations_ready" &&
        typeof evt.data.follow_up_suggestion === "string" &&
        evt.data.follow_up_suggestion.trim()
      ) {
        return evt.data.follow_up_suggestion as string;
      }
    }
    return null;
  })();
  const persistedSuggestion =
    [...(data.follow_up_suggestions ?? [])]
      .reverse()
      .find((s): s is string => typeof s === "string" && s.trim().length > 0) ??
    null;
  const placeholder =
    liveSuggestion ?? persistedSuggestion ?? "something a little weirder…";

  return (
    <div className={css.root}>
      <div className={css.body}>
        <LobbyTitle
          eyebrow={`SESSION · ${formatDate(data.created_at)}`}
          eyebrowPulsing={inProgress}
          staticTagline="From the archive."
          rightLinks={[
            { to: "/", label: "Home" },
            { to: "/history", label: "History" },
          ]}
        />

        <div className={css.statusBand}>
          <div className={css.statusInner}>
            <span className={STATUS_CLASS[status]}>{status.toUpperCase()}</span>
            <span className={css.statusSep}>·</span>
            <span>{data.model}</span>
            {data.latency_ms != null && (
              <>
                <span className={css.statusSep}>·</span>
                <span>{Math.round((data.latency_ms / 1000) * 10) / 10}s</span>
              </>
            )}
            {data.tool_calls_n != null && (
              <>
                <span className={css.statusSep}>·</span>
                <span>{data.tool_calls_n} TOOL CALLS</span>
              </>
            )}
          </div>
        </div>

        <div className={css.cycles}>
          {cycles.map((cycle) => {
            const prompt = prompts[cycle] ?? "(no prompt recorded)";
            const isLatest = cycle === cycles[cycles.length - 1];
            const isLive = isLatest && activeCycle === cycle && inProgress;
            const persisted = toolCallsToEntries(
              data.tool_calls.filter((tc) => tc.cycle === cycle),
            );
            const live = isLive ? eventsToToolEntries(events, cycle) : [];
            const entries = mergeEntries(persisted, live);
            const recs = data.recommendations.filter((r) => r.cycle === cycle);
            return (
              <CycleSection
                key={cycle}
                cycle={cycle}
                prompt={prompt}
                entries={entries}
                recs={recs}
                inProgress={isLive}
                onFeedback={handleFeedback}
                feedbackPending={feedback.isPending}
              />
            );
          })}

          {inProgress && (
            <div className={css.statusBlock}>
              <LinearProgress
                aria-label="working"
                sx={{
                  bgcolor: "var(--lobby-border)",
                  "& .MuiLinearProgress-bar": {
                    bgcolor: "var(--lobby-accent)",
                  },
                }}
              />
            </div>
          )}
          {data.error_message && !inProgress && (
            <div className={css.statusBlock}>
              <div className={css.errorAlert}>{data.error_message}</div>
            </div>
          )}
          <div ref={conversationEndRef} />
        </div>
      </div>

      <ChatPanel
        onSubmit={handleContinue}
        isPending={cont.isPending || inProgress}
        isFollowUp={true}
        placeholder={placeholder}
      />
    </div>
  );
}

interface CycleProps {
  cycle: number;
  prompt: string;
  entries: ToolLogEntry[];
  recs: Recommendation[];
  inProgress: boolean;
  onFeedback: (rec: Recommendation, next: FeedbackStatus) => void;
  feedbackPending: boolean;
}

function CycleSection({
  cycle,
  prompt,
  entries,
  recs,
  inProgress,
  onFeedback,
  feedbackPending,
}: CycleProps) {
  // Default-collapsed reasoning, just like the live conversation view.
  const [open, setOpen] = useState(false);

  return (
    <div className={css.cycleBlock}>
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

      {recs.length > 0 && (
        <div className={css.recsWrap}>
          <RecommendationsList
            recommendations={recs}
            onFeedback={onFeedback}
            feedbackPending={feedbackPending}
          />
        </div>
      )}
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}
