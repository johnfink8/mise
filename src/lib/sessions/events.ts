import { z } from 'zod';

const RecommendationsReadyRecSchema = z.object({
  id: z.string(),
  cycle: z.number().int(),
  position: z.number().int(),
  ratingKey: z.string(),
  title: z.string(),
  year: z.number().int().nullable(),
  genres: z.array(z.string()),
  runtimeMin: z.number().nullable(),
  audienceRating: z.number().nullable(),
  directors: z.array(z.string()),
  topCast: z.array(z.string()),
  reasoning: z.string(),
  group: z.string().nullable(),
  feedback: z.enum(['none', 'up', 'down', 'watched']),
  playUrl: z.string().nullable(),
});

export type RecommendationsReadyRec = z.infer<typeof RecommendationsReadyRecSchema>;

export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('started'),
    data: z.object({ sessionId: z.string(), cycle: z.number().int() }),
  }),
  z.object({
    type: z.literal('assistant_text'),
    data: z.object({
      cycle: z.number().int(),
      turn: z.number().int(),
      text: z.string(),
    }),
  }),
  z.object({
    type: z.literal('tool_call_started'),
    data: z.object({
      cycle: z.number().int(),
      turn: z.number().int(),
      toolName: z.string(),
      toolInput: z.record(z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('tool_call_completed'),
    data: z.object({
      cycle: z.number().int(),
      turn: z.number().int(),
      toolName: z.string(),
      toolInput: z.record(z.unknown()),
      toolOutput: z.unknown(),
      durationMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal('recommendations_ready'),
    data: z.object({
      cycle: z.number().int(),
      recommendations: z.array(RecommendationsReadyRecSchema),
      followUpSuggestion: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal('error'),
    data: z.object({ cycle: z.number().int(), message: z.string() }),
  }),
  z.object({
    type: z.literal('done'),
    data: z.object({}).strict(),
  }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type SessionEventType = SessionEvent['type'];
