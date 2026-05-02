import { EventEmitter } from 'node:events';

interface StartedData {
  sessionId: string;
  cycle: number;
}

interface AssistantTextData {
  cycle: number;
  turn: number;
  text: string;
}

interface ToolCallStartedData {
  cycle: number;
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
}

interface ToolCallCompletedData extends ToolCallStartedData {
  toolOutput: unknown;
  durationMs: number;
}

export interface RecommendationsReadyRec {
  id: string;
  cycle: number;
  position: number;
  ratingKey: string;
  title: string;
  year: number | null;
  genres: string[];
  runtimeMin: number | null;
  audienceRating: number | null;
  directors: string[];
  topCast: string[];
  reasoning: string;
  group: string | null;
  feedback: 'none' | 'up' | 'down' | 'watched';
  playUrl: string | null;
}

interface RecommendationsReadyData {
  cycle: number;
  recommendations: RecommendationsReadyRec[];
  followUpSuggestion: string | null;
}

interface ErrorData {
  cycle: number;
  message: string;
}

type DoneData = Record<string, never>;

export type SessionEvent =
  | { type: 'started'; data: StartedData }
  | { type: 'assistant_text'; data: AssistantTextData }
  | { type: 'tool_call_started'; data: ToolCallStartedData }
  | { type: 'tool_call_completed'; data: ToolCallCompletedData }
  | { type: 'recommendations_ready'; data: RecommendationsReadyData }
  | { type: 'error'; data: ErrorData }
  | { type: 'done'; data: DoneData };

export type SessionEventType = SessionEvent['type'];

class SessionBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, SessionEvent[]>();
  private closed = new Set<string>();

  private getOrCreate(sessionId: string): EventEmitter {
    let em = this.emitters.get(sessionId);
    if (!em) {
      em = new EventEmitter();
      em.setMaxListeners(0);
      this.emitters.set(sessionId, em);
      this.buffers.set(sessionId, []);
    }
    return em;
  }

  publish(sessionId: string, ev: SessionEvent): void {
    const em = this.getOrCreate(sessionId);
    this.buffers.get(sessionId)!.push(ev);
    em.emit('event', ev);
    if (ev.type === 'done' || ev.type === 'error') {
      this.closed.add(sessionId);
      // Keep buffer/emitter around briefly so late subscribers can drain.
      setTimeout(() => {
        this.emitters.delete(sessionId);
        this.buffers.delete(sessionId);
        this.closed.delete(sessionId);
      }, 30_000);
    }
  }

  isClosed(sessionId: string): boolean {
    return this.closed.has(sessionId);
  }

  hasActive(sessionId: string): boolean {
    return this.emitters.has(sessionId) && !this.closed.has(sessionId);
  }

  /** Async iterator yielding buffered events first, then live events until done. */
  async *subscribe(sessionId: string): AsyncIterableIterator<SessionEvent> {
    const em = this.getOrCreate(sessionId);
    const buffer = this.buffers.get(sessionId)!;
    for (let i = 0; i < buffer.length; i++) {
      yield buffer[i];
      if (buffer[i].type === 'done' || buffer[i].type === 'error') return;
    }

    if (this.closed.has(sessionId)) return;

    let resolveNext: ((ev: SessionEvent | null) => void) | null = null;
    const queue: SessionEvent[] = [];
    const onEvent = (ev: SessionEvent) => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(ev);
      } else {
        queue.push(ev);
      }
    };
    em.on('event', onEvent);

    try {
      while (true) {
        const ev =
          queue.shift() ??
          (await new Promise<SessionEvent | null>((resolve) => {
            resolveNext = resolve;
          }));
        if (!ev) return;
        yield ev;
        if (ev.type === 'done' || ev.type === 'error') return;
      }
    } finally {
      em.off('event', onEvent);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __miseBus: SessionBus | undefined;
}

export const bus: SessionBus = globalThis.__miseBus ?? new SessionBus();
if (process.env.NODE_ENV !== 'production') globalThis.__miseBus = bus;
