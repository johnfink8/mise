import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '@/lib/db/schema';

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * Spin up a fresh in-memory pgvector-enabled Postgres for a test file. Each
 * call returns a brand-new database — no cross-file leakage. Migrations are
 * applied by reading the SQL files from `drizzle/` and executing them.
 */
export async function makeTestDb(): Promise<{
  db: TestDb;
  pg: PGlite;
}> {
  const pg = await PGlite.create({ extensions: { vector } });
  const db = drizzle(pg, { schema });
  await applyMigrations(pg);
  return { db, pg };
}

async function applyMigrations(pg: PGlite): Promise<void> {
  const dir = path.resolve(import.meta.dirname, '../../drizzle');
  // The drizzle migrator writes a journal; we don't need it in-memory. Run
  // the .sql files in order, splitting on the `--> statement-breakpoint`
  // marker drizzle-kit emits.
  const journal = JSON.parse(
    await readFile(path.join(dir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  for (const entry of ordered) {
    const sql = await readFile(path.join(dir, `${entry.tag}.sql`), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

/**
 * Deterministic vector for tests — we don't want to load the Transformers.js
 * model in unit tests. Same string in → same vector out, with enough variation
 * across calls to keep cosine distances meaningful for ordering tests.
 */
export function fakeEmbed(text: string): number[] {
  const v = new Array(384).fill(0);
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < 384; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    v[i] = (h / 0xffffffff) * 2 - 1;
  }
  // Normalize for cosine distance to be well-behaved.
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag) || 1;
  return v.map((x) => x / mag);
}
