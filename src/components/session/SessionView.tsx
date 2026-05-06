'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LobbyInput } from './LobbyInput';
import { LobbyTopBar } from './LobbyTopBar';
import { LobbyTurn } from './LobbyTurn';
import { SaveToPlex } from './SaveToPlex';
import { ThinkingBlock } from './ThinkingBlock';
import { useSessionStream } from './useSessionStream';
import { continueSessionAction } from '@/app/actions/sessions';
import { recordFeedbackAction } from '@/app/actions/feedback';
import type {
  Feedback,
  LiveToolCall,
  RecOut,
  SessionStatus,
  SessionViewData,
  StepText,
} from './types';

export default function SessionView({ initial }: { initial: SessionViewData }) {
  const router = useRouter();
  const [streamRecs, setStreamRecs] = useState<RecOut[]>([]);
  const [liveCalls, setLiveCalls] = useState<LiveToolCall[]>([]);
  const [liveText, setLiveText] = useState<StepText[]>([]);
  const [streamFollowUps, setStreamFollowUps] = useState<Record<number, string | null>>({});
  const [streamDone, setStreamDone] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [feedbackOverrides, setFeedbackOverrides] = useState<Record<string, Feedback>>({});
  const [followUpBusy, setFollowUpBusy] = useState(false);

  const status: SessionStatus = streamError
    ? 'error'
    : streamDone
    ? 'complete'
    : initial.status;
  const isLive = status === 'pending' || status === 'running';

  const recommendations = useMemo(() => {
    const known = new Set(initial.recommendations.map((r) => r.id));
    const merged = [...initial.recommendations, ...streamRecs.filter((r) => !known.has(r.id))];
    return merged.map((r) =>
      feedbackOverrides[r.id] !== undefined
        ? { ...r, feedback: feedbackOverrides[r.id] }
        : r,
    );
  }, [initial.recommendations, streamRecs, feedbackOverrides]);

  const followUpSuggestions = useMemo(() => {
    const out = [...initial.followUpSuggestions];
    for (const [c, s] of Object.entries(streamFollowUps)) {
      const idx = Number(c);
      while (out.length <= idx) out.push(null);
      if (out[idx] == null) out[idx] = s;
    }
    return out;
  }, [initial.followUpSuggestions, streamFollowUps]);

  useSessionStream({
    sessionId: initial.id,
    enabled: isLive,
    onOpen: () => {
      setStreamDone(false);
      setStreamError(null);
    },
    onAssistantText: (t) =>
      setLiveText((prev) => {
        // Streaming sends cumulative text per (cycle, turn) — replace the
        // existing entry rather than appending.
        const idx = prev.findIndex((x) => x.cycle === t.cycle && x.turn === t.turn);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = t;
          return next;
        }
        return [...prev, t];
      }),
    onToolCallStarted: (c) =>
      setLiveCalls((prev) => [...prev, { ...c, done: false }]),
    onToolCallCompleted: (c) =>
      setLiveCalls((prev) =>
        prev.map((x) =>
          !x.done &&
          x.cycle === c.cycle &&
          x.turn === c.turn &&
          x.toolName === c.toolName &&
          JSON.stringify(x.toolInput) === JSON.stringify(c.toolInput)
            ? { ...x, done: true }
            : x,
        ),
      ),
    onRecommendationsReady: (r) => {
      setStreamRecs((prev) => [...prev, ...r.recommendations]);
      setStreamFollowUps((prev) => ({ ...prev, [r.cycle]: r.followUpSuggestion }));
    },
    onError: (msg) => setStreamError(msg),
    onDone: () => setStreamDone(true),
  });

  // Only the latest cycle is rendered — follow-ups replace prior turns.
  const latestCycle = Math.max(0, initial.prompts.length - 1);
  const cycles = [latestCycle];

  const onFeedback = (recId: string, fb: Feedback) => {
    setFeedbackOverrides((prev) => ({ ...prev, [recId]: fb }));
    void recordFeedbackAction({ recommendationId: recId, feedback: fb });
  };

  const onFollowUp = async (text: string) => {
    setFollowUpBusy(true);
    try {
      await continueSessionAction({ sessionId: initial.id, prompt: text });
      // Reset stream state so isLive can flip back to true once the refreshed
      // server data arrives with the new pending status, re-enabling the SSE
      // subscription for the new cycle.
      setStreamRecs([]);
      setLiveCalls([]);
      setLiveText([]);
      setStreamFollowUps({});
      setStreamDone(false);
      setStreamError(null);
      router.refresh();
    } finally {
      setFollowUpBusy(false);
    }
  };

  const liveCycle = isLive ? latestCycle : null;
  const visibleRecCount = recommendations.filter((r) => r.cycle === latestCycle).length;

  return (
    <div className="flex min-h-screen flex-col">
      <LobbyTopBar
        status={status}
        resultCount={visibleRecCount}
        showNew
        showPlaylistShortcut={status === 'complete' && visibleRecCount > 0}
      />

      <div className="mx-auto w-full max-w-[980px] flex-1 px-5 pb-7 sm:px-7">
        {(streamError ?? initial.errorMessage) && (
          <div className="my-4 rounded-sm border border-mise-down bg-mise-down/10 px-4 py-3 text-sm text-mise-down">
            {streamError ?? initial.errorMessage}
          </div>
        )}

        {cycles.map((c) => {
          const isThisLive = c === liveCycle;
          const cyclePrompt = c === 0 ? initial.userPrompt : initial.prompts[c] ?? initial.userPrompt;
          const cycleRecs = recommendations.filter((r) => r.cycle === c);
          const cycleToolCalls = initial.toolCalls.filter((t) => t.cycle === c);
          const cycleStepTexts = initial.stepTexts.filter((t) => t.cycle === c);

          if (isThisLive && cycleRecs.length === 0) {
            // Live thinking state — no recs yet for this cycle.
            return (
              <ThinkingBlock
                key={c}
                userRequest={cyclePrompt}
                stepTexts={liveText.filter((t) => t.cycle === c)}
                liveCalls={liveCalls.filter((t) => t.cycle === c)}
                persistedCalls={cycleToolCalls}
              />
            );
          }

          return (
            <LobbyTurn
              key={c}
              request={cyclePrompt}
              recs={cycleRecs}
              toolCalls={cycleToolCalls}
              stepTexts={cycleStepTexts}
              startIdx={0}
              onFeedback={onFeedback}
            />
          );
        })}

        {status === 'complete' && visibleRecCount > 0 && (
          <SaveToPlex sessionId={initial.id} count={visibleRecCount} />
        )}
      </div>

      <LobbyInput
        variant="follow-up"
        placeholder={followUpSuggestions[followUpSuggestions.length - 1] ?? undefined}
        disabled={isLive || followUpBusy}
        onSubmit={onFollowUp}
      />
    </div>
  );
}
