import { describe, expect, it } from 'vitest';
import {
  distinctSectionTypes,
  fetchAchievements,
  fetchMedia,
  fetchPlaylistItems,
  fetchReplicaLagSeconds,
  fetchSections,
  findHubByDomain,
  MORPH_FILE,
  MORPH_HUB,
  MORPH_PLAYLIST,
} from '../../src/extract/queries.js';
import type { SnapshotSession } from '../../src/extract/db.js';

function recorder(results: unknown[][] = []): SnapshotSession & { calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = [];
  let i = 0;
  return {
    calls,
    async query<T>(sql: string, params: unknown[]): Promise<T[]> {
      calls.push([sql, params]);
      return (results[i++] ?? []) as T[];
    },
    async end() {},
  };
}

describe('findHubByDomain', () => {
  it('selects from hubs on the domain column and excludes soft-deleted rows', async () => {
    const session = recorder([[{ id: 7, title: 'ManTalks' }]]);
    const hub = await findHubByDomain(session, 'alliance.mantalks.com');
    expect(hub?.id).toBe(7);
    const [sql, params] = session.calls[0]!;
    expect(sql).toMatch(/FROM hubs/);
    expect(sql).toMatch(/WHERE domain = \?/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual(['alliance.mantalks.com']);
  });

  it('returns null rather than throwing when the domain is unknown', async () => {
    expect(await findHubByDomain(recorder([[]]), 'nope.example.com')).toBeNull();
  });
});

describe('fetchSections', () => {
  it('pulls every level of the tree ordered by parent then position', async () => {
    const session = recorder([[]]);
    await fetchSections(session, 7);
    const [sql] = session.calls[0]!;
    expect(sql).toMatch(/FROM sections t/);
    expect(sql).toMatch(/t\.hub_id = \?/);
    expect(sql).toMatch(/t\.deleted_at IS NULL/);
    expect(sql).toContain('t.permissions');
    expect(sql).toContain('t.segment_id');
    expect(sql).toContain('AND t.id > ? ORDER BY t.id ASC LIMIT ?');
  });
});

describe('fetchPlaylistItems', () => {
  it('reads the file_playlist pivot ordered by position', async () => {
    const session = recorder([[]]);
    await fetchPlaylistItems(session, [3, 4]);
    const [sql, params] = session.calls[0]!;
    expect(sql).toMatch(/FROM file_playlist/);
    expect(sql).toMatch(/ORDER BY playlist_id ASC, position ASC/);
    expect(params).toEqual([[3, 4]]);
  });

  it('short-circuits on an empty id list instead of emitting IN ()', async () => {
    const session = recorder();
    expect(await fetchPlaylistItems(session, [])).toEqual([]);
    expect(session.calls.length).toBe(0);
  });
});

describe('fetchMedia', () => {
  it('queries the Spatie media table by the old-namespace morph aliases', async () => {
    const session = recorder([[]]);
    await fetchMedia(session, [
      { modelType: MORPH_HUB, modelId: 7 },
      { modelType: MORPH_FILE, modelId: 11 },
    ]);
    const [sql, params] = session.calls[0]!;
    expect(sql).toMatch(/FROM media t/);
    expect(sql).toContain('t.generated_conversions');
    expect(sql).toContain('t.conversions_disk');
    expect(params[0]).toEqual([
      ['App\\Hub', 7],
      ['App\\File', 11],
    ]);
  });
});

describe('fetchAchievements', () => {
  it('joins through achievement_hub because achievements are team-scoped', async () => {
    const session = recorder([[]]);
    await fetchAchievements(session, 7);
    const [sql, params] = session.calls[0]!;
    expect(sql).toMatch(/FROM achievements t/);
    expect(sql).toMatch(/JOIN achievement_hub ah ON ah\.achievement_id = t\.id/);
    expect(sql).toMatch(/ah\.hub_id = \?/);
    expect(params[0]).toBe(7);
  });
});

describe('fetchReplicaLagSeconds', () => {
  it('reads Seconds_Behind_Source from SHOW REPLICA STATUS', async () => {
    const session = recorder([[{ Seconds_Behind_Source: 4 }]]);
    expect(await fetchReplicaLagSeconds(session)).toBe(4);
  });

  it('reports unavailable when the statement is not permitted', async () => {
    const session: SnapshotSession = {
      async query() { throw new Error('Access denied; you need REPLICATION CLIENT'); },
      async end() {},
    };
    expect(await fetchReplicaLagSeconds(session)).toBe('unavailable');
  });
});

describe('distinctSectionTypes', () => {
  it('lists the real section types present on the hub, which closes the enum', async () => {
    const session = recorder([[{ type: 'row' }, { type: 'scroll' }]]);
    expect(await distinctSectionTypes(session, 7)).toEqual(['row', 'scroll']);
    expect(session.calls[0]![0]).toMatch(/SELECT DISTINCT type FROM sections/);
  });
});

describe('morph aliases', () => {
  it('uses the old App\\ namespace, not App\\Models\\', () => {
    expect(MORPH_PLAYLIST).toBe('App\\Playlist');
    expect(MORPH_FILE).toBe('App\\File');
    expect(MORPH_HUB).toBe('App\\Hub');
  });
});
