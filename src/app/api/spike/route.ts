import { NextResponse } from 'next/server';
import {
  dataAgeSeconds,
  embeddedCount,
  getCollections,
  getLoadingState,
  movieCount,
  refreshFromPlex,
  search,
  similarTo,
} from '@/lib/catalog';
import { runAgentOnce } from '@/lib/agent/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'status';

  if (action === 'refresh') {
    const result = await refreshFromPlex({ force: searchParams.get('force') === '1' });
    return NextResponse.json({
      ok: true,
      result,
      embedded: await embeddedCount(),
      ageSeconds: await dataAgeSeconds(),
    });
  }

  if (action === 'search') {
    const query = searchParams.get('q') ?? undefined;
    return NextResponse.json(await search({ query, limit: 5 }));
  }

  if (action === 'similar') {
    const ratingKey = searchParams.get('rating_key');
    if (!ratingKey) return NextResponse.json({ error: 'rating_key required' }, { status: 400 });
    return NextResponse.json(await similarTo(ratingKey, 5));
  }

  if (action === 'agent') {
    const prompt = searchParams.get('prompt');
    if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    const t0 = performance.now();
    try {
      const r = await runAgentOnce(prompt);
      return NextResponse.json({ ...r, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      return NextResponse.json(
        {
          error: e?.message ?? String(err),
          diag: e?.diag ?? null,
          ms: Math.round(performance.now() - t0),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    movies: await movieCount(),
    embedded: await embeddedCount(),
    ageSeconds: await dataAgeSeconds(),
    collections: (await getCollections()).length,
    loading: getLoadingState(),
  });
}
