import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '@/test/db';

let testDb: TestDb;

vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb;
  },
}));

import { userMemory } from '@/lib/db/schema';
import { addMemory, deleteMemory, listMemories, MEMORY_CAP } from './store';

beforeAll(async () => {
  const { db } = await makeTestDb();
  testDb = db;
});

beforeEach(async () => {
  await testDb.delete(userMemory);
});

describe('memory store', () => {
  it('round-trips a memory', async () => {
    const saved = await addMemory({ text: '  likes ensemble heists  ' });
    expect(saved.text).toBe('likes ensemble heists');
    const list = await listMemories();
    expect(list.map((m) => m.text)).toEqual(['likes ensemble heists']);
  });

  it('rejects empty text', async () => {
    await expect(addMemory({ text: '   ' })).rejects.toThrow();
  });

  it('returns memories newest-first', async () => {
    await addMemory({ text: 'old' });
    // Force a measurable createdAt gap; pglite uses now() which has μs resolution
    await new Promise((r) => setTimeout(r, 5));
    await addMemory({ text: 'new' });
    const list = await listMemories();
    expect(list.map((m) => m.text)).toEqual(['new', 'old']);
  });

  it('trims oldest entries beyond MEMORY_CAP', async () => {
    for (let i = 0; i < MEMORY_CAP + 3; i++) {
      await addMemory({ text: `memory ${i}` });
      await new Promise((r) => setTimeout(r, 1));
    }
    const list = await listMemories(undefined, 1000);
    expect(list.length).toBeLessThanOrEqual(MEMORY_CAP);
    // The very-first ones should be gone; the most recent should remain.
    const texts = list.map((m) => m.text);
    expect(texts).toContain(`memory ${MEMORY_CAP + 2}`);
    expect(texts).not.toContain('memory 0');
  });

  it('deletes by id', async () => {
    const a = await addMemory({ text: 'a' });
    await addMemory({ text: 'b' });
    await deleteMemory(a.id);
    const list = await listMemories();
    expect(list.map((m) => m.text)).toEqual(['b']);
  });
});
