import { describe, expect, it, vi } from 'vitest';
import { paginateByPk, type SnapshotSession } from '../../src/extract/db.js';

function fakeSession(pages: Array<Array<{ id: number }>>): SnapshotSession & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let page = 0;
  return {
    calls,
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      calls.push([sql, params]);
      return (pages[page++] ?? []) as T[];
    },
    async end() {},
  };
}

describe('paginateByPk', () => {
  it('walks pages until a short page and concatenates them', async () => {
    const session = fakeSession([
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
    ]);
    const rows = await paginateByPk<{ id: number }>(
      session,
      'SELECT t.id FROM pages t WHERE t.hub_id = ? /*KEYSET*/',
      [42],
      2,
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('replaces the KEYSET token with a cursor clause and carries the last id forward', async () => {
    const session = fakeSession([[{ id: 1 }, { id: 2 }], []]);
    await paginateByPk<{ id: number }>(
      session,
      'SELECT t.id FROM pages t WHERE t.hub_id = ? /*KEYSET*/',
      [42],
      2,
    );
    expect(session.calls[0]?.[0]).toBe(
      'SELECT t.id FROM pages t WHERE t.hub_id = ? AND t.id > ? ORDER BY t.id ASC LIMIT ?',
    );
    expect(session.calls[0]?.[1]).toEqual([42, 0, 2]);
    expect(session.calls[1]?.[1]).toEqual([42, 2, 2]);
  });

  it('refuses a query with no KEYSET token rather than silently reading one page', async () => {
    const session = fakeSession([[]]);
    await expect(
      paginateByPk(session, 'SELECT id FROM pages WHERE hub_id = ?', [1], 2),
    ).rejects.toThrow(/missing the \/\*KEYSET\*\/ token/);
  });

  it('stops after a full page that returns no new rows, so a bad cursor cannot loop forever', async () => {
    const session = fakeSession([[{ id: 5 }, { id: 5 }], [{ id: 5 }, { id: 5 }]]);
    const rows = await paginateByPk<{ id: number }>(
      session,
      'SELECT t.id FROM x t WHERE t.hub_id = ? /*KEYSET*/',
      [1],
      2,
    );
    expect(rows.length).toBe(2);
  });
});
