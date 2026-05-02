import { z } from 'zod';

export const RecommendationItem = z.object({
  rating_key: z
    .string()
    .describe('rating_key from a previous tool result. Never invent these.'),
  reasoning: z
    .string()
    .describe('One or two sentences tying back to the user request.'),
  group: z
    .string()
    .nullable()
    .optional()
    .describe(
      'OPTIONAL thematic group label (e.g. "Cerebral sci-fi"). If used, reuse exactly across picks in the same bucket. Omit for focused requests where a flat list reads better.',
    ),
});

export type RecommendationItemT = z.infer<typeof RecommendationItem>;

export const RecommendationOutput = z.object({
  recommendations: z.array(RecommendationItem).min(1).max(25),
  follow_up_suggestion: z
    .string()
    .nullable()
    .optional()
    .describe(
      "OPTIONAL one-line refinement written in the user's voice (lowercase, casual, no period, ≤60 chars). Used as the chat-input placeholder for the next prompt.",
    ),
});

export type RecommendationOutputT = z.infer<typeof RecommendationOutput>;
