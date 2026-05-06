import { z } from 'zod';

export const CatalogSnapshotSchema = z.object({
  count: z.number().int(),
  embedded: z.number().int(),
  age_seconds: z.number().int().nullable(),
  collections: z.array(z.object({ name: z.string(), size: z.number().int() })),
  loading: z
    .object({
      phase: z.enum([
        'fetching_movies',
        'fetching_collections',
        'persisting',
        'embedding',
      ]),
      elapsed_seconds: z.number().int(),
      progress: z
        .object({ done: z.number().int(), total: z.number().int() })
        .nullable(),
    })
    .nullable(),
  last_refresh: z
    .object({
      attempted_seconds_ago: z.number().int(),
      error: z.string().nullable(),
    })
    .nullable(),
});

export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

export const CatalogStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), data: CatalogSnapshotSchema }),
]);

export type CatalogStreamEvent = z.infer<typeof CatalogStreamEventSchema>;
