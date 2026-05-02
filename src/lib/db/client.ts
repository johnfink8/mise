import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL ?? 'postgres://mise:mise@localhost:5433/mise';

declare global {
  var __miseSql: ReturnType<typeof postgres> | undefined;
}

const sql = globalThis.__miseSql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalThis.__miseSql = sql;

export const db = drizzle(sql, { schema });
export { sql };
