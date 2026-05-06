import {
  dataAgeSeconds,
  embeddedCount,
  getCollections,
  getLastRefreshInfo,
  getLoadingState,
  movieCount,
} from '@/lib/catalog';
import {
  CatalogSnapshotSchema,
  type CatalogSnapshot,
  type CatalogStreamEvent,
} from '@/lib/catalog/snapshot';
import { formatSSE, SSE_HEADERS } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICK_MS = 1500;

async function buildSnapshot(): Promise<CatalogSnapshot> {
  const [movies, embedded, age, collections] = await Promise.all([
    movieCount(),
    embeddedCount(),
    dataAgeSeconds(),
    getCollections(),
  ]);
  const loading = getLoadingState();
  const lastRefresh = getLastRefreshInfo();
  return CatalogSnapshotSchema.parse({
    count: movies,
    embedded,
    age_seconds: age,
    collections: collections.map((c) => ({ name: c.name, size: c.size })),
    loading: loading
      ? {
          phase: loading.phase,
          elapsed_seconds: Math.floor((Date.now() - loading.startedAt) / 1000),
          progress: loading.progress,
        }
      : null,
    last_refresh: lastRefresh
      ? {
          attempted_seconds_ago: Math.floor(
            (Date.now() - lastRefresh.attemptedAt) / 1000,
          ),
          error: lastRefresh.error,
        }
      : null,
  });
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener('abort', close);

      // Heartbeat keeps the connection alive through proxies.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 15_000);

      try {
        while (!closed) {
          const ev: CatalogStreamEvent = {
            type: 'snapshot',
            data: await buildSnapshot(),
          };
          if (closed) break;
          controller.enqueue(encoder.encode(formatSSE(ev)));
          await new Promise<void>((resolve) => setTimeout(resolve, TICK_MS));
        }
      } catch {
        // client disconnected or DB hiccup — fall through to cleanup
      } finally {
        clearInterval(heartbeat);
        close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
