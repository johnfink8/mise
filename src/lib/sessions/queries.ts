import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { recommendation, session, toolCall } from '@/lib/db/schema';

export async function listSessions(opts: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;
  const rows = await db
    .select()
    .from(session)
    .orderBy(desc(session.createdAt))
    .limit(limit)
    .offset(offset);
  const [totalRow] = await db.select({ n: count() }).from(session);
  return { sessions: rows, total: totalRow?.n ?? 0 };
}

export async function getSessionDetail(sessionId: string) {
  const [s] = await db.select().from(session).where(eq(session.id, sessionId));
  if (!s) return null;
  const recs = await db
    .select()
    .from(recommendation)
    .where(eq(recommendation.sessionId, sessionId))
    .orderBy(recommendation.cycle, recommendation.position);
  const toolCalls = await db
    .select()
    .from(toolCall)
    .where(eq(toolCall.sessionId, sessionId))
    .orderBy(toolCall.cycle, toolCall.turn, toolCall.createdAt);
  return { session: s, recommendations: recs, toolCalls };
}
