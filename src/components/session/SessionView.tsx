'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LobbyInput } from './LobbyInput';
import { LobbyTopBar } from './LobbyTopBar';
import { LobbyTurn } from './LobbyTurn';
import { ThinkingBlock } from './ThinkingBlock';
import { useSessionStream } from './useSessionStream';
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
    onAssistantText: (t) => setLiveText((prev) => [...prev, t]),
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

  // Cycles include initial, persisted, and live so a fresh in-flight cycle still renders.
  const cycles = useMemo(() => {
    const set = new Set<number>([
      ...recommendations.map((r) => r.cycle),
      ...initial.toolCalls.map((t) => t.cycle),
      ...initial.stepTexts.map((t) => t.cycle),
      ...liveCalls.map((c) => c.cycle),
      ...liveText.map((t) => t.cycle),
    ]);
    if (set.size === 0) set.add(0);
    return [...set].sort((a, b) => a - b);
  }, [recommendations, initial.toolCalls, initial.stepTexts, liveCalls, liveText]);

  const onFeedback = (recId: string, fb: Feedback) => {
    setFeedbackOverrides((prev) => ({ ...prev, [recId]: fb }));
    void fetch(`/api/recommendations/${recId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: fb }),
    });
  };

  const onFollowUp = async (text: string) => {
    setFollowUpBusy(true);
    try {
      const res = await fetch(`/api/sessions/${initial.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      if (!res.ok) throw new Error(`failed (${res.status})`);
      router.refresh();
    } finally {
      setFollowUpBusy(false);
    }
  };

  const liveCycle = isLive ? Math.max(...cycles) : null;
  const totalRecCount = recommendations.length;

  // PICK numbering offset per cycle — picks number consecutively across cycles.
  const startIdxByCycle = new Map<number, number>();
  let running = 0;
  for (const c of cycles) {
    startIdxByCycle.set(c, running);
    running += recommendations.filter((r) => r.cycle === c).length;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <LobbyTopBar status={status} resultCount={totalRecCount} showNew />

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
              startIdx={startIdxByCycle.get(c) ?? 0}
              onFeedback={onFeedback}
            />
          );
        })}
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
