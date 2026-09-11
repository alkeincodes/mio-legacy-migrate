import { createConnection, type Connection } from 'mysql2/promise';
import type { Env } from '../config/env.js';

const QUERY_TIMEOUT_MS = 60_000;
const KEYSET_TOKEN = '/*KEYSET*/';

export interface SnapshotSession {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  end(): Promise<void>;
}

/**
 * Opens one connection, puts it in REPEATABLE READ and starts a consistent
 * snapshot so every read in the capture sees the same point in time. The
 * session is read-only: nothing in this tool ever issues a write statement.
 */
export async function openSnapshot(env: Env, localPort: number): Promise<SnapshotSession> {
  const conn: Connection = await createConnection({
    host: '127.0.0.1',
    port: localPort,
    user: env.legacyDbUser,
    password: env.legacyDbPassword,
    database: env.legacyDbName,
    connectTimeout: 20_000,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  return {
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      const [rows] = await conn.query({ sql, values: params, timeout: QUERY_TIMEOUT_MS });
      return rows as T[];
    },
    async end(): Promise<void> {
      await conn.query('COMMIT');
      await conn.end();
    },
  };
}

/**
 * Pages a SELECT by primary key in batches. The SQL must carry the literal
 * token `/*KEYSET*\/` where the cursor clause belongs, and must alias the
 * paged table as `t`.
 */
export async function paginateByPk<T extends { id: number }>(
  session: SnapshotSession,
  sql: string,
  params: unknown[],
  batch = 500,
): Promise<T[]> {
  if (!sql.includes(KEYSET_TOKEN)) {
    throw new Error(`paginateByPk was given SQL missing the /*KEYSET*/ token: ${sql}`);
  }
  const paged = sql.replace(KEYSET_TOKEN, 'AND t.id > ? ORDER BY t.id ASC LIMIT ?');
  const out: T[] = [];
  let cursor = 0;
  for (;;) {
    const rows = await session.query<T>(paged, [...params, cursor, batch]);
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    if (!last || last.id <= cursor) break;
    out.push(...rows);
    cursor = last.id;
    if (rows.length < batch) break;
  }
  return out;
}
