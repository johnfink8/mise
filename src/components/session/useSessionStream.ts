'use client';

import { useEffect, useRef } from 'react';
import {
  SessionEventSchema,
  type SessionEvent,
} from '@/lib/sessions/events';
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

function parseEvent(type: string, raw: string): SessionEvent | null {
  try {
    const data: unknown = JSON.parse(raw);
    const parsed = SessionEventSchema.safeParse({ type, data });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

    const dispatch = (ev: SessionEvent) => {
      const h = handlersRef.current;
      switch (ev.type) {
        case 'assistant_text':
          h.onAssistantText(ev.data);
          break;
        case 'tool_call_started':
          h.onToolCallStarted(ev.data);
          break;
        case 'tool_call_completed':
          h.onToolCallCompleted(ev.data);
          break;
        case 'recommendations_ready':
          h.onRecommendationsReady(ev.data);
          break;
        case 'error':
          h.onError(ev.data.message);
          break;
        case 'done':
          sawDone = true;
          es.close();
          h.onDone();
          break;
        case 'started':
          // No-op: existence implied by other events.
          break;
      }
    };

    const named = [
      'started',
      'assistant_text',
      'tool_call_started',
      'tool_call_completed',
      'recommendations_ready',
    ] as const;
    for (const type of named) {
      es.addEventListener(type, (ev) => {
        const parsed = parseEvent(type, (ev as MessageEvent).data);
        if (parsed) dispatch(parsed);
      });
    }
    es.addEventListener('done', () => dispatch({ type: 'done', data: {} }));

    es.addEventListener('error', (ev) => {
      // SSE 'error' events come in two flavors: server-emitted (with a JSON
      // payload) and the native EventSource transport error (no data). Only
      // the first should surface as a session error.
      const data = (ev as MessageEvent).data;
      if (typeof data === 'string' && data.length > 0) {
        const parsed = parseEvent('error', data);
        if (parsed && parsed.type === 'error') dispatch(parsed);
        return;
      }
      if (sawDone) es.close();
    });

    return () => es.close();
  }, [sessionId, enabled]);
}
