import { desc, lt, sql } from 'drizzle-orm';
import { db as defaultDb } from '@/lib/db/client';
import { userMemory } from '@/lib/db/schema';

export interface UserMemory {
  id: string;
  text: string;
  createdAt: Date;
}

export const MEMORY_CAP = 50;

type DbLike = Pick<typeof defaultDb, 'select' | 'insert' | 'delete'>;

export async function listMemories(
  db: DbLike = defaultDb,
  limit = MEMORY_CAP,
): Promise<UserMemory[]> {
  const rows = await db
    .select({
      id: userMemory.id,
      text: userMemory.text,
      createdAt: userMemory.createdAt,
    })
    .from(userMemory)
    .orderBy(desc(userMemory.createdAt))
    .limit(limit);
  return rows;
}

export async function addMemory(
  args: { text: string; sourceSessionId?: string | null; sourceCycle?: number | null },
  db: DbLike = defaultDb,
): Promise<UserMemory> {
  const text = args.text.trim();
  if (!text) throw new Error('memory text is empty');
  const [row] = await db
    .insert(userMemory)
    .values({
      text,
      sourceSessionId: args.sourceSessionId ?? null,
      sourceCycle: args.sourceCycle ?? null,
    })
    .returning({
      id: userMemory.id,
      text: userMemory.text,
      createdAt: userMemory.createdAt,
    });

  // Trim oldest beyond MEMORY_CAP so the table can't grow unbounded.
  const all = await db
    .select({ id: userMemory.id, createdAt: userMemory.createdAt })
    .from(userMemory)
    .orderBy(desc(userMemory.createdAt))
    .limit(MEMORY_CAP + 1);
  if (all.length > MEMORY_CAP) {
    const cutoff = all[MEMORY_CAP - 1].createdAt;
    await db.delete(userMemory).where(lt(userMemory.createdAt, cutoff));
  }

  return row;
}

export async function deleteMemory(id: string, db: DbLike = defaultDb): Promise<void> {
  await db.delete(userMemory).where(sql`${userMemory.id} = ${id}`);
}
