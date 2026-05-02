import { NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await sql`SELECT 1`;
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  try {
    const url = process.env.PLEX_BASE_URL;
    const token = process.env.PLEX_TOKEN;
    if (!url || !token) {
      checks.plex = { ok: false, detail: 'PLEX_BASE_URL or PLEX_TOKEN not set' };
    } else {
      const res = await fetch(`${url.replace(/\/+$/, '')}/identity`, {
        headers: { Accept: 'application/json', 'X-Plex-Token': token },
        signal: AbortSignal.timeout(3000),
      });
      checks.plex = { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
    }
  } catch (err) {
    checks.plex = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ status: allOk ? 'ok' : 'degraded', checks }, { status: allOk ? 200 : 503 });
}
