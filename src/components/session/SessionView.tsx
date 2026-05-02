'use client';

import { useMemo, useState } from 'react';
import { CycleBlock } from './CycleBlock';
import { FollowUpForm } from './FollowUpForm';
import { buildLiveSteps, buildSteps, mergeSteps } from './steps';
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
  // Stream-only state. The `initial` prop is the authoritative source; these
  // hold things the server hasn't told us about yet.
  const [streamRecs, setStreamRecs] = useState<RecOut[]>([]);
  const [liveCalls, setLiveCalls] = useState<LiveToolCall[]>([]);
  const [liveText, setLiveText] = useState<StepText[]>([]);
  const [streamFollowUps, setStreamFollowUps] = useState<Record<number, string | null>>({});
  const [streamDone, setStreamDone] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [feedbackOverrides, setFeedbackOverrides] = useState<Record<string, Feedback>>({});

  // Derived state — recomputed from initial + stream additions.
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
      // Reset terminal flags from any previous cycle so we can flip back to
      // running cleanly on a follow-up.
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

  // Cycles include initial, persisted, and live data so a fresh in-flight
  // cycle (no persisted rows yet) still renders.
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

  return (
    <main>
      <h2 style={{ marginTop: 0, fontSize: 20, fontWeight: 500 }}>{initial.userPrompt}</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <span className={`pill ${status}`}>{status}</span>
        {isLive && (
          <span className="faint" style={{ fontSize: 12 }}>
            agent is working…
          </span>
        )}
      </div>

      {(streamError ?? initial.errorMessage) && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          {streamError ?? initial.errorMessage}
        </div>
      )}

      {cycles.map((c) => {
        const persistedSteps = buildSteps(
          initial.stepTexts.filter((t) => t.cycle === c),
          initial.toolCalls.filter((t) => t.cycle === c),
        );
        const liveSteps = buildLiveSteps(
          liveText.filter((t) => t.cycle === c),
          liveCalls.filter((t) => t.cycle === c),
        );
        const steps = mergeSteps(persistedSteps, liveSteps);
        return (
          <CycleBlock
            key={c}
            cycle={c}
            prompt={c === 0 ? initial.userPrompt : initial.prompts[c]}
            steps={steps}
            recs={recommendations.filter((r) => r.cycle === c)}
            onFeedback={onFeedback}
          />
        );
      })}

      {status === 'complete' && (
        <FollowUpForm
          sessionId={initial.id}
          placeholder={followUpSuggestions[followUpSuggestions.length - 1] ?? undefined}
        />
      )}
    </main>
  );
}
