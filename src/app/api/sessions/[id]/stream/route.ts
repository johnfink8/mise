import { bus } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Heartbeat every 15s to keep connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        for await (const ev of bus.subscribe(id)) {
          controller.enqueue(encoder.encode(sseLine(ev.type, ev.data)));
          if (ev.type === 'done' || ev.type === 'error') break;
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
