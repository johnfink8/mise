import { EventEmitter } from 'node:events';
import type { SessionEvent } from './sessions/events';

export type { SessionEvent, SessionEventType, RecommendationsReadyRec } from './sessions/events';

class SessionBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, SessionEvent[]>();
  private closed = new Set<string>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();

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
    // Publishing on a previously-closed session means a new cycle is starting.
    // Reset buffered state so subscribers don't replay the prior cycle and
    // bail out at its `done` event.
    if (this.closed.has(sessionId)) {
      this.closed.delete(sessionId);
      this.buffers.set(sessionId, []);
      const t = this.cleanupTimers.get(sessionId);
      if (t) {
        clearTimeout(t);
        this.cleanupTimers.delete(sessionId);
      }
    }
    const em = this.getOrCreate(sessionId);
    this.buffers.get(sessionId)!.push(ev);
    em.emit('event', ev);
    if (ev.type === 'done' || ev.type === 'error') {
      this.closed.add(sessionId);
      // Keep buffer/emitter around briefly so late subscribers can drain.
      const t = setTimeout(() => {
        this.emitters.delete(sessionId);
        this.buffers.delete(sessionId);
        this.closed.delete(sessionId);
        this.cleanupTimers.delete(sessionId);
      }, 30_000);
      this.cleanupTimers.set(sessionId, t);
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

globalThis.__miseBus ??= new SessionBus();
export const bus: SessionBus = globalThis.__miseBus;
