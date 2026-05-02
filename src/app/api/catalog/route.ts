import { NextResponse } from 'next/server';
import {
  dataAgeSeconds,
  embeddedCount,
  getCollections,
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
  });
}

export async function POST() {
  const result = await refreshFromPlex({ force: true });
  return NextResponse.json({ count: result.count });
}
