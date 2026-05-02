import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { session } from '@/lib/db/schema';
import { continueSession } from '@/lib/recommender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ prompt: z.string().min(1) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const [s] = await db.select().from(session).where(eq(session.id, id));
  if (!s) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (s.status === 'pending' || s.status === 'running') {
    return NextResponse.json({ error: 'session is still running' }, { status: 409 });
  }

  await continueSession(id, parsed.data.prompt);
  return NextResponse.json({ session_id: id }, { status: 202 });
}
