'use server';

import { z } from 'zod';
import {
  startSession as startSessionImpl,
  continueSession as continueSessionImpl,
} from '@/lib/sessions/run';

const StartInput = z.object({
  prompt: z.string().min(1),
  count: z.number().int().min(1).max(25).optional(),
  filters: z
    .object({
      genres: z.array(z.string()).optional(),
      year_min: z.number().int().optional(),
      year_max: z.number().int().optional(),
      watched_status: z.enum(['watched', 'unwatched', 'any']).optional(),
    })
    .optional(),
});

export async function startSessionAction(
  input: z.input<typeof StartInput>,
): Promise<{ sessionId: string }> {
  const { prompt, count, filters } = StartInput.parse(input);
  return startSessionImpl({
    prompt,
    formPayload: { count, filters },
  });
}

const ContinueInput = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
});

export async function continueSessionAction(
  input: z.input<typeof ContinueInput>,
): Promise<void> {
  const { sessionId, prompt } = ContinueInput.parse(input);
  await continueSessionImpl(sessionId, prompt);
}
