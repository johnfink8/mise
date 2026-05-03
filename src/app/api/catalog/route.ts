import { NextResponse } from 'next/server';
import {
  dataAgeSeconds,
  embeddedCount,
  getCollections,
  getLastRefreshInfo,
  getLoadingState,
  movieCount,
  refreshFromPlex,
} from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET() {
  const [movies, embedded, age, collections] = await Promise.all([
    movieCount(),
    embeddedCount(),
    dataAgeSeconds(),
    getCollections(),
  ]);
  const loading = getLoadingState();
  const lastRefresh = getLastRefreshInfo();
  return NextResponse.json({
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
          attempted_seconds_ago: Math.floor((Date.now() - lastRefresh.attemptedAt) / 1000),
          error: lastRefresh.error,
        }
      : null,
  });
}

export async function POST() {
  // Fire-and-forget: refreshFromPlex() sets loadingState synchronously, so the
  // next GET will immediately reflect the in-flight refresh. We don't await
  // here because a full refresh takes minutes and the client just wants to
  // know the kickoff happened so it can start polling.
  void refreshFromPlex({ force: true }).catch(() => undefined);
  return NextResponse.json({ kicked_off: true });
}
