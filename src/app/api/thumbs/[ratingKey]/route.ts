import { fetchThumb } from '@/lib/plex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ratingKey: string }> },
) {
  const { ratingKey } = await ctx.params;
  try {
    const { bytes, contentType } = await fetchThumb(ratingKey);
    return new Response(bytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 404 });
  }
}
