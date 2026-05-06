/**
 * Format a typed `{ type, data }` event as one SSE message frame. Constraining
 * the input to a discriminated-union shape forces the producer to keep the
 * event name and payload type bound together — same shape the zod consumer
 * uses to parse on the other side.
 */
export function formatSSE<T extends { type: string; data: unknown }>(
  ev: T,
): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
