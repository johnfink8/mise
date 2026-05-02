import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { recommendation } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ feedback: z.enum(['up', 'down', 'watched', 'none']) });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const now = new Date();
  const [updated] = await db
    .update(recommendation)
    .set({
      feedback: parsed.data.feedback,
      feedbackAt: parsed.data.feedback === 'none' ? null : now,
    })
    .where(eq(recommendation.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    id: updated.id,
    feedback: updated.feedback,
    feedback_at: updated.feedbackAt,
  });
}
