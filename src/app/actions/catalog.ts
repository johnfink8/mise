'use server';

import { z } from 'zod';
import { refreshFromPlex } from '@/lib/catalog';

const Input = z
  .object({ force: z.boolean().optional() })
  .optional();

/**
 * Kick off a catalog refresh. Fire-and-forget: refreshFromPlex sets
 * loadingState synchronously, so the next snapshot reflects the in-flight
 * refresh. force=false picks the cheapest path (resume embeddings, skip if
 * fresh, otherwise full refresh); force=true bypasses both checks.
 */
export async function kickoffCatalogRefreshAction(
  input?: z.input<typeof Input>,
): Promise<void> {
  const { force } = Input.parse(input) ?? {};
  void refreshFromPlex({ force }).catch(() => undefined);
}
