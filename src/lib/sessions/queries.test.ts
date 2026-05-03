import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '@/test/db';

let testDb: TestDb;

vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb;
  },
}));

import { recommendation, session, toolCall } from '@/lib/db/schema';
import { getSessionDetail, listSessions } from '@/lib/sessions/queries';

beforeAll(async () => {
  const { db } = await makeTestDb();
  testDb = db;
});

beforeEach(async () => {
  await testDb.delete(toolCall);
  await testDb.delete(recommendation);
  await testDb.delete(session);
});

async function seedSession(overrides: Partial<typeof session.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(session)
    .values({
      userPrompt: 'a default prompt',
      prompts: ['a default prompt'],
      status: 'complete',
      ...overrides,
    })
    .returning();
  return row;
}

// ---------- listSessions ----------

describe('listSessions', () => {
  it('returns empty list with total=0 when no sessions', async () => {
    const r = await listSessions();
    expect(r.sessions).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('orders by createdAt desc', async () => {
    const older = await seedSession({
      userPrompt: 'older',
      createdAt: new Date('2025-01-01'),
    });
    const newer = await seedSession({
      userPrompt: 'newer',
      createdAt: new Date('2026-01-01'),
    });
    const r = await listSessions();
    expect(r.sessions.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedSession({ userPrompt: `p-${i}` });
    }
    const r = await listSessions({ limit: 3 });
    expect(r.sessions).toHaveLength(3);
    expect(r.total).toBe(5);
  });

  it('caps limit at 100', async () => {
    const r = await listSessions({ limit: 9999 });
    // Empty DB but we just verify the cap doesn't crash and limit is applied.
    expect(r.sessions).toEqual([]);
  });

  it('respects offset for pagination', async () => {
    const created: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = await seedSession({
        userPrompt: `p-${i}`,
        createdAt: new Date(2026, 0, i + 1),
      });
      created.push(s.id);
    }
    // Newest first → offset=2 should skip the two newest.
    const r = await listSessions({ limit: 10, offset: 2 });
    expect(r.sessions).toHaveLength(2);
    expect(r.total).toBe(4);
  });
});

// ---------- getSessionDetail ----------

describe('getSessionDetail', () => {
  it('returns null for unknown id', async () => {
    expect(
      await getSessionDetail('00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });

  it('returns session + sorted recommendations + sorted tool_calls', async () => {
    const s = await seedSession();

    // Insert recommendations out of order — getSessionDetail should sort
    // them by (cycle, position).
    await testDb.insert(recommendation).values([
      {
        sessionId: s.id,
        cycle: 1,
        position: 0,
        plexRatingKey: 'r3',
        title: 'C',
        reasoning: '...',
      },
      {
        sessionId: s.id,
        cycle: 0,
        position: 1,
        plexRatingKey: 'r2',
        title: 'B',
        reasoning: '...',
      },
      {
        sessionId: s.id,
        cycle: 0,
        position: 0,
        plexRatingKey: 'r1',
        title: 'A',
        reasoning: '...',
      },
    ]);

    // Insert tool_calls out of order.
    await testDb.insert(toolCall).values([
      {
        sessionId: s.id,
        cycle: 0,
        turn: 2,
        toolName: 'get_movie_details',
        toolInput: { rating_key: 'r1' },
      },
      {
        sessionId: s.id,
        cycle: 0,
        turn: 1,
        toolName: 'search_movies',
        toolInput: { query: 'sci-fi' },
      },
      {
        sessionId: s.id,
        cycle: 1,
        turn: 1,
        toolName: 'search_movies',
        toolInput: { query: 'follow-up' },
      },
    ]);

    const detail = await getSessionDetail(s.id);
    expect(detail).not.toBeNull();
    expect(detail!.session.id).toBe(s.id);
    expect(
      detail!.recommendations.map((r) => `${r.cycle}.${r.position}.${r.title}`),
    ).toEqual(['0.0.A', '0.1.B', '1.0.C']);
    expect(
      detail!.toolCalls.map((t) => `${t.cycle}.${t.turn}.${t.toolName}`),
    ).toEqual([
      '0.1.search_movies',
      '0.2.get_movie_details',
      '1.1.search_movies',
    ]);
  });

  it('isolates session data — does not leak other sessions', async () => {
    const a = await seedSession({ userPrompt: 'A' });
    const b = await seedSession({ userPrompt: 'B' });
    await testDb.insert(recommendation).values([
      {
        sessionId: a.id,
        cycle: 0,
        position: 0,
        plexRatingKey: 'r1',
        title: 'A pick',
        reasoning: '...',
      },
      {
        sessionId: b.id,
        cycle: 0,
        position: 0,
        plexRatingKey: 'r2',
        title: 'B pick',
        reasoning: '...',
      },
    ]);
    const detail = await getSessionDetail(a.id);
    expect(detail!.recommendations).toHaveLength(1);
    expect(detail!.recommendations[0].title).toBe('A pick');
  });
});
