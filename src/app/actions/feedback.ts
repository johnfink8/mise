'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { recommendation } from '@/lib/db/schema';

const Input = z.object({
  recommendationId: z.string().min(1),
  feedback: z.enum(['up', 'down', 'watched', 'none']),
});

export async function recordFeedbackAction(
  input: z.input<typeof Input>,
): Promise<void> {
  const { recommendationId, feedback } = Input.parse(input);
  const now = new Date();
  await db
    .update(recommendation)
    .set({
      feedback,
      feedbackAt: feedback === 'none' ? null : now,
    })
    .where(eq(recommendation.id, recommendationId));
}
