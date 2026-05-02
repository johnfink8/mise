'use client';

import { useEffect, useRef } from 'react';
import type { LiveToolCall, RecOut, StepText } from './types';

interface StreamHandlers {
  onAssistantText: (t: StepText) => void;
  onToolCallStarted: (c: Omit<LiveToolCall, 'done'>) => void;
  onToolCallCompleted: (c: Omit<LiveToolCall, 'done'>) => void;
  onRecommendationsReady: (r: {
    cycle: number;
    recommendations: RecOut[];
    followUpSuggestion: string | null;
  }) => void;
  onError: (message: string) => void;
  onDone: () => void;
  /** Called once each time the connection (re)opens. */
  onOpen?: () => void;
}

interface Options extends StreamHandlers {
  sessionId: string;
  enabled: boolean;
}

/**
 * Subscribes to a session's SSE stream while `enabled` is true. Auto-reconnects
 * if the connection closes for any reason other than a `done` event we already
 * received.
 */
export function useSessionStream({
  sessionId,
  enabled,
  onAssistantText,
  onToolCallStarted,
  onToolCallCompleted,
  onRecommendationsReady,
  onError,
  onDone,
  onOpen,
}: Options): void {
  const handlersRef = useRef<StreamHandlers>({
    onAssistantText,
    onToolCallStarted,
    onToolCallCompleted,
    onRecommendationsReady,
    onError,
    onDone,
    onOpen,
  });
  handlersRef.current = {
    onAssistantText,
    onToolCallStarted,
    onToolCallCompleted,
    onRecommendationsReady,
    onError,
    onDone,
    onOpen,
  };

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    let sawDone = false;
    handlersRef.current.onOpen?.();

    es.addEventListener('assistant_text', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as StepText;
      handlersRef.current.onAssistantText(d);
    });
    es.addEventListener('tool_call_started', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as Omit<LiveToolCall, 'done'>;
      handlersRef.current.onToolCallStarted(d);
    });
    es.addEventListener('tool_call_completed', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as Omit<LiveToolCall, 'done'>;
      handlersRef.current.onToolCallCompleted(d);
    });
    es.addEventListener('recommendations_ready', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as {
        cycle: number;
        recommendations: RecOut[];
        followUpSuggestion: string | null;
      };
      handlersRef.current.onRecommendationsReady(d);
    });
    es.addEventListener('error', (ev) => {
      try {
        const d = JSON.parse((ev as MessageEvent).data) as { message: string };
        handlersRef.current.onError(d.message);
      } catch {
        // Native browser onerror also fires here without a data payload — ignore
        // unless we already saw `done`, in which case close the now-stale conn.
        if (sawDone) es.close();
      }
    });
    es.addEventListener('done', () => {
      sawDone = true;
      es.close();
      handlersRef.current.onDone();
    });

    return () => es.close();
  }, [sessionId, enabled]);
}
