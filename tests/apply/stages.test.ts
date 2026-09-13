import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accessRulesStage, achievementsStage, attachFoldersStage, foldersStage, hubStage,
  navigationItemFor, navigationStage, pageDraftsStage, pageTreesStage, playlistsStage, refResolverFor, removalsStage,
  segmentsStage, spacesStage, tagsStage, assetReferences, type StageContext,
} from '../../src/apply/stages.js';
import type { ApiClient } from '../../src/apply/api.js';
import { LedgerStore } from '../../src/ledger/store.js';
import { recordMarker } from '../../src/ledger/marker.js';
import type { LedgerHeader } from '../../src/ledger/schema.js';
import type { Plan } from '../../src/map/plan.js';
import type { Profile } from '../../src/config/profile.js';

const profile: Profile = {
  name: 'test', apiBase: 'https://api.example.com', teamId: 'team-1',
  bucket: 'v3-bucket', region: 'us-east-1', cdnBase: 'https://cdn.member.dev', cdnBaseConfirmed: true, hubBase: 'https://hub.example.com', legacyHubLoginEmail: '', legacyHubLoginPassword: '', v3VerifyLoginEmail: '', v3VerifyLoginPassword: '', v3PlatformLoginEmail: '', v3PlatformLoginPassword: '',
};

const header: LedgerHeader = {
  ledgerVersion: 1, toolVersion: '0.1.0', sourceHost: 'replica.example.com',
  legacyHubId: 7, profileName: 'test', targetApiBase: profile.apiBase,
  targetTeamId: 'team-1', targetHubId: null, runId: 'run-1', planHash: 'h',
};

interface Call { method: string; path: string; body?: unknown; opts?: unknown }

/** A recording API double. `lists` maps a path prefix to the rows listAll yields. */
function fakeApi(opts: {
  lists?: Record<string, unknown[]>;
  gets?: Record<string, { body: unknown; etag?: string }>;
  postId?: string;
} = {}): ApiClient & { calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  const api = {
    calls,
    async get(path: string) {
      calls.push({ method: 'GET', path });
      const hit = Object.entries(opts.gets ?? {}).find(([k]) => path.startsWith(k));
      return hit ? { body: hit[1].body, etag: hit[1].etag ?? null } : { body: { data: {} }, etag: null };
    },
    async post(path: string, body: unknown, op?: string, o?: unknown) {
      calls.push({ method: 'POST', path, body, opts: { op, ...(o as object) } });
      return { data: { id: opts.postId ?? `new_${++n}`, attributes: { media_id: 'med_1' } } };
    },
    async patch(path: string, body: unknown, o?: unknown) {
      calls.push({ method: 'PATCH', path, body, opts: o });
      return {};
    },
    async put(path: string, body: unknown, o?: unknown) {
      calls.push({ method: 'PUT', path, body, opts: o });
      return { body: { data: { attributes: { draft_version: 2 } } }, etag: '2' };
    },
    async delete(path: string) { calls.push({ method: 'DELETE', path }); },
    async *listAll<T>(path: string): AsyncGenerator<T> {
      calls.push({ method: 'LIST', path });
      const hit = Object.entries(opts.lists ?? {}).find(([k]) => path.startsWith(k));
      if (!hit) return;
      for (const row of hit[1]) yield row as T;
    },
  };
  return api as unknown as ApiClient & { calls: Call[] };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1, toolVersion: '0.1.0', catalogVersion: '0.23.6', catalogDigest: 'd',
    legacyHubId: 7, sourceHost: 'replica.example.com',
    hub: { title: 'ManTalks', slug: 'alliance', description: null, isPrivate: true },
    branding: {}, pages: [], playlists: [], folders: [], assets: [], spaces: [],
    achievements: [], segments: [], tags: [], accessRules: [], excludedPages: [],
    navigation: { header: [], footer: [], mobile: [] }, warnings: [],
    ...overrides,
  };
}

function ctxFor(p: Plan, api: ApiClient, playbackOk = new Set<string>()): StageContext & { warnings: string[] } {
  const store = LedgerStore.create(mkdtempSync(join(tmpdir(), 'ledger-')), header);
  const warnings: string[] = [];
  return { plan: p, store, api, profile, runId: 'run-1', hubId: 'hub_1', playbackOk, warnings, warn: (r) => warnings.push(r) };
}

const marker = (legacyId: number): string => recordMarker('replica.example.com', legacyId, 'run-1');

describe('hubStage', () => {
  it('creates the hub with the marker in meta, registration off, and records the target hub id', async () => {
    const api = fakeApi({ postId: 'hub_new' });
    const ctx = ctxFor(plan(), api);
    const id = await hubStage(ctx);
    expect(id).toBe('hub_new');
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/teams/team-1/hubs/');
    const attrs = (create.body as { data: { attributes: Record<string, unknown> } }).data.attributes;
    expect(attrs['meta']).toEqual({ lgcMarker: marker(7) });
    expect(attrs['settings']).toEqual({ registration: { enabled: false } });
    expect(attrs['is_private']).toBe(true);
    expect(ctx.store.header.targetHubId).toBe('hub_new');
    expect(ctx.store.find(marker(7))?.state).toBe('done');
  });

  it('adopts an existing hub carrying the marker instead of creating a second one', async () => {
    const api = fakeApi({ lists: { '/api/v1/teams/team-1/hubs/': [{ id: 'hub_old', attributes: { meta: { lgcMarker: marker(7) } } }] } });
    const ctx = ctxFor(plan(), api);
    expect(await hubStage(ctx)).toBe('hub_old');
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('short-circuits on resume when the ledger already has the hub as done', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan(), api);
    await hubStage(ctx);
    const before = api.calls.length;
    await hubStage(ctx);
    expect(api.calls.length).toBe(before);
  });
});

describe('pageDraftsStage and pageTreesStage', () => {
  const page = {
    legacyPageId: 100, slug: 'about', title: 'About', pageType: 'generic',
    privacy: 'members' as const, isHomepage: false, restrictedSectionNodeIds: [] as string[],
    tree: { id: 'root', kind: 'stack', children: [{ id: 'a', kind: 'headline', value: 'Hi' }] },
  };

  it('creates the draft with the marker in meta and the legacy privacy', async () => {
    const api = fakeApi({ postId: 'pg_1' });
    const ctx = ctxFor(plan({ pages: [page] }), api);
    await pageDraftsStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/teams/team-1/hubs/hub_1/pages/');
    expect(create.opts).toMatchObject({ op: 'pages.create' });
    const attrs = (create.body as { data: { type: string; attributes: Record<string, unknown> } }).data;
    expect(attrs.type).toBe('pages');
    expect(attrs.attributes).toMatchObject({ slug: 'about', privacy: 'members', type: 'generic', meta: { lgcMarker: marker(100) } });
  });

  it('writes the tree with If-Match from the draft version, stores its digest, then publishes with the new version', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(plan({ pages: [page] }), api);
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set());
    const put = api.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/api/v1/teams/team-1/hubs/hub_1/pages/pg_1/tree');
    expect(put.opts).toMatchObject({ ifMatch: '1', op: 'pages.tree_write' });
    expect((put.body as { data: { type: string; attributes: { tree: { root: unknown } } } }).data.type).toBe('page_draft_trees');
    const publish = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/publish'))!;
    expect(publish.opts).toMatchObject({ ifMatch: '2', op: 'pages.publish' });
    const entry = ctx.store.find(marker(100))!;
    expect(entry.revisionToken).toBe('2');
    expect(entry.referenceHash).toBe('published');
    expect(entry.contentHash).toHaveLength(64);
  });

  it('holds a page whose restricted section has no mapped rule, and says so', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(plan({ pages: [{ ...page, restrictedSectionNodeIds: ['a'] }] }), api);
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set());
    expect(api.calls.some((c) => c.path.endsWith('/publish'))).toBe(false);
    expect(ctx.warnings[0]).toContain('unpublished');
    expect(ctx.store.find(marker(100))?.referenceHash).toBe('draft');
  });

  it('does not rewrite a tree the ledger already shows as written and published', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(plan({ pages: [page] }), api);
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set());
    const before = api.calls.length;
    await pageTreesStage(ctx, new Set());
    expect(api.calls.length).toBe(before);
  });
});

describe('refResolverFor', () => {
  const assetEntry = (state: 'verified' | 'pending-import', visibility: 'public' | 'restricted') => ({
    legacyTable: 'media', legacyId: 91234, kind: 'asset' as const, variant: 'original',
    marker: 'am', v3Id: 'file_1', state, runId: 'run-1', createdAt: 'x', updatedAt: 'x',
    contentHash: 'c', referenceHash: null, revisionToken: null,
    asset: {
      sourceBucket: 'b', sourceKey: 'k', sourceEtag: 'e', sourceVersionId: null, sourceSizeBytes: 1,
      sourceChecksumCrc64Nvme: null, v3MediaId: 'med_1', v3FileId: 'file_1',
      destinationKey: 'team-1/media/med_1/original', destinationSizeBytes: 1,
      destinationChecksumCrc64Nvme: null, visibility, legacyCdnUrl: 'https://cdn.legacy.example.com/91234/x.mp4', importJobId: null,
    },
  });

  it('resolves a verified asset to its V3 CDN URL', () => {
    const ctx = ctxFor(plan(), fakeApi());
    ctx.store.upsert(assetEntry('verified', 'public'));
    expect(refResolverFor(ctx).asset(91234, 'original')).toEqual({ url: 'https://cdn.member.dev/team-1/media/med_1/original' });
  });

  it('links a public pending video to its legacy URL only when the prefilter passed, and records legacy-linked', () => {
    const ctx = ctxFor(plan(), fakeApi(), new Set(['https://cdn.legacy.example.com/91234/x.mp4']));
    ctx.store.upsert(assetEntry('pending-import', 'public'));
    expect(refResolverFor(ctx).asset(91234, 'original')).toEqual({ url: 'https://cdn.legacy.example.com/91234/x.mp4' });
    expect(ctx.store.find('am')?.state).toBe('legacy-linked');
  });

  it('never emits a legacy URL for restricted video, or for one that failed the prefilter', () => {
    const ctx = ctxFor(plan(), fakeApi(), new Set(['https://cdn.legacy.example.com/91234/x.mp4']));
    ctx.store.upsert(assetEntry('pending-import', 'restricted'));
    expect(refResolverFor(ctx).asset(91234, 'original')).toEqual({ pending: true });
    const ctx2 = ctxFor(plan(), fakeApi());
    ctx2.store.upsert(assetEntry('pending-import', 'public'));
    expect(refResolverFor(ctx2).asset(91234, 'original')).toEqual({ pending: true });
  });
});

describe('navigationItemFor', () => {
  it('turns a page item into a page_id reference from the ledger', async () => {
    const p = plan({ pages: [{ legacyPageId: 100, slug: 'about', title: 'About', pageType: 'generic', privacy: 'members', isHomepage: false, restrictedSectionNodeIds: [], tree: { id: 'r', kind: 'stack', children: [] } }] });
    const ctx = ctxFor(p, fakeApi({ postId: 'pg_1' }));
    await pageDraftsStage(ctx);
    expect(navigationItemFor(ctx, { type: 'page', label: 'About', pageSlugRef: 'about', position: 0 }, [])).toEqual({ type: 'page', label: 'About', page_id: 'pg_1', position: 0 });
  });

  it('rewrites a same-origin absolute link to a root-relative path', () => {
    const ctx = ctxFor(plan(), fakeApi());
    expect(navigationItemFor(ctx, { type: 'url', label: 'Courses', href: 'https://alliance.mantalks.com/courses', position: 0 }, ['https://alliance.mantalks.com'])).toEqual({ type: 'url', label: 'Courses', href: '/courses', position: 0 });
  });

  it('drops an off-site link with a warning, because V3 stores root-relative hrefs only', () => {
    const ctx = ctxFor(plan(), fakeApi());
    expect(navigationItemFor(ctx, { type: 'url', label: 'Blog', href: 'https://blog.example.com', position: 0 }, [])).toBeNull();
    expect(ctx.warnings[0]).toContain('root-relative');
  });
});

describe('playlistsStage', () => {
  it('creates the playlist on the hub with the marker as description and attaches verified items in position order', async () => {
    const p = plan({
      playlists: [{ legacyPlaylistId: 42, title: 'Course', description: null, visibility: 'private', items: [{ legacyFileId: 6, position: 1 }, { legacyFileId: 5, position: 0 }] }],
      assets: [
        { legacyFileId: 5, legacyMediaId: 91234, variant: 'original', sourceBucket: 'b', sourceKey: 'k', sizeBytes: 1, etag: 'e', versionId: null, checksumCrc64Nvme: null, mimeType: 'image/png', cdnUrl: 'u', title: 't', visibility: 'public', isVideo: false, folderLegacyIds: [], playlistLegacyIds: [42] },
        { legacyFileId: 6, legacyMediaId: 91235, variant: 'original', sourceBucket: 'b', sourceKey: 'k2', sizeBytes: 1, etag: 'e', versionId: null, checksumCrc64Nvme: null, mimeType: 'video/mp4', cdnUrl: 'u2', title: 't2', visibility: 'public', isVideo: true, folderLegacyIds: [], playlistLegacyIds: [42] },
      ],
    });
    const api = fakeApi({ postId: 'pl_1' });
    const ctx = ctxFor(p, api);
    ctx.store.upsert({ legacyTable: 'media', legacyId: 91234, kind: 'asset', variant: 'original', marker: 'am', v3Id: 'file_5', state: 'verified', runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null, revisionToken: null, asset: null });
    await playlistsStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/teams/team-1/playlists')!;
    expect((create.body as { data: { attributes: Record<string, unknown> } }).data.attributes).toMatchObject({ description: marker(42), hub_id: 'hub_1', visibility: 'private' });
    const items = api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/items'));
    expect(items).toHaveLength(1);
    expect((items[0]!.body as { data: { attributes: unknown } }).data.attributes).toEqual({ file_id: 'file_5', position: 0 });
    expect(ctx.warnings[0]).toContain('legacy file 6');
  });
});

describe('foldersStage and attachFoldersStage', () => {
  it('carries the marker as a name suffix and moves each verified file into its folder', async () => {
    const p = plan({
      folders: [{ legacyFolderId: 9, name: 'Talks' }],
      assets: [{ legacyFileId: 5, legacyMediaId: 91234, variant: 'original', sourceBucket: 'b', sourceKey: 'k', sizeBytes: 1, etag: 'e', versionId: null, checksumCrc64Nvme: null, mimeType: 'image/png', cdnUrl: 'u', title: 't', visibility: 'public', isVideo: false, folderLegacyIds: [9], playlistLegacyIds: [] }],
    });
    const api = fakeApi({ postId: 'fld_1' });
    const ctx = ctxFor(p, api);
    ctx.store.upsert({ legacyTable: 'media', legacyId: 91234, kind: 'asset', variant: 'original', marker: 'am', v3Id: 'file_5', state: 'verified', runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null, revisionToken: null, asset: null });
    await foldersStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect((create.body as { data: { attributes: { name: string } } }).data.attributes.name).toBe(`Talks [${marker(9)}]`);
    await attachFoldersStage(ctx);
    const move = api.calls.find((c) => c.method === 'PATCH')!;
    expect(move.path).toBe('/api/v1/teams/team-1/files/file_5');
    expect((move.body as { data: { attributes: unknown } }).data.attributes).toEqual({ folder_id: 'fld_1' });
  });
});

describe('spacesStage and achievementsStage', () => {
  it('creates a space with the marker in description and the mapped access level', async () => {
    const api = fakeApi({ postId: 'sp_1' });
    const ctx = ctxFor(plan({ spaces: [{ legacyCategoryId: 3, name: 'General', slug: 'general', description: null, accessLevel: 'public', legacySegmentId: null, position: 0 }] }), api);
    await spacesStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/admin/teams/team-1/hubs/hub_1/spaces/');
    expect((create.body as { data: { type: string; attributes: Record<string, unknown> } }).data).toMatchObject({ type: 'spaces', attributes: { name: 'General', slug: 'general', description: marker(3), access_level: 'public' } });
  });

  it('creates an achievement then offers it to the hub, once', async () => {
    const api = fakeApi({ postId: 'ach_1' });
    const ctx = ctxFor(plan({ achievements: [{ legacyAchievementId: 4, title: 'First call', description: null, isActive: true }] }), api);
    await achievementsStage(ctx);
    await achievementsStage(ctx);
    const posts = api.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.path)).toEqual(['/api/v1/teams/team-1/achievements', '/api/v1/teams/team-1/hubs/hub_1/achievements']);
    expect((posts[1]!.body as { data: { type: string; attributes: unknown } }).data).toEqual({ type: 'achievement_hubs', attributes: { achievement_id: 'ach_1' } });
  });
});

describe('accessRulesStage', () => {
  it('skips a rule whose segment was never created and reports it, so the page stays unpublished', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan({ accessRules: [{ targetKind: 'node', legacySectionId: 5, targetRef: 'n1', logicOperator: 'any', conditions: [{ condition_type: 'in_segment', condition_data: { segment_id: 'ledger://segment/77' }, position: 0 }] }] }), api);
    const mapped = await accessRulesStage(ctx);
    expect(mapped.size).toBe(0);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.warnings[0]).toContain('segment/77');
  });

  it('creates a rule with the resolved V3 segment id when the segment exists', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan({ accessRules: [{ targetKind: 'node', legacySectionId: 5, targetRef: 'n1', logicOperator: 'any', conditions: [{ condition_type: 'in_segment', condition_data: { segment_id: 'ledger://segment/77' }, position: 0 }] }] }), api);
    ctx.store.upsert({ legacyTable: 'segments', legacyId: 77, kind: 'segment', variant: null, marker: marker(77), v3Id: 'seg_1', state: 'done', runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null, revisionToken: null, asset: null });
    const mapped = await accessRulesStage(ctx);
    expect([...mapped]).toEqual(['n1']);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/teams/team-1/hubs/hub_1/access-rules');
    expect((create.body as { data: { type: string; attributes: Record<string, unknown> } }).data).toMatchObject({
      type: 'access_rules',
      attributes: { target_type: 'node', target_id: 'n1', logic_operator: 'any', conditions: [{ condition_type: 'in_segment', condition_data: { segment_id: 'seg_1' }, position: 0 }] },
    });
    // The rule has no marker field, so the ledger keys it by the node it gates.
    expect(ctx.store.find('n1')).toMatchObject({ kind: 'accessRule', legacyId: 5, v3Id: 'new_1', state: 'done' });
  });

  it('adopts the rule already on the hub for the same node instead of creating a second one', async () => {
    const api = fakeApi({ lists: { '/api/v1/teams/team-1/hubs/hub_1/access-rules': [{ id: 'rule_old', attributes: { target_type: 'node', target_id: 'n1' } }] } });
    const ctx = ctxFor(plan({ accessRules: [{ targetKind: 'node', legacySectionId: 5, targetRef: 'n1', logicOperator: 'any', conditions: [{ condition_type: 'in_segment', condition_data: { segment_id: 'ledger://segment/77' }, position: 0 }] }] }), api);
    ctx.store.upsert({ legacyTable: 'segments', legacyId: 77, kind: 'segment', variant: null, marker: marker(77), v3Id: 'seg_1', state: 'done', runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null, revisionToken: null, asset: null });
    const mapped = await accessRulesStage(ctx);
    expect([...mapped]).toEqual(['n1']);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.store.find('n1')?.v3Id).toBe('rule_old');
  });
});

describe('tagsStage', () => {
  it('creates a missing tag by slug with the marker in its description', async () => {
    const api = fakeApi({ postId: 'tag_1' });
    const ctx = ctxFor(plan({ tags: [{ legacyTagId: 125221, name: 'ManTalks Team', slug: 'mantalks-team' }] }), api);
    await tagsStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/teams/team-1/tags');
    expect((create.body as { data: { attributes: Record<string, unknown> } }).data.attributes).toEqual({ name: 'ManTalks Team', slug: 'mantalks-team', description: marker(125221) });
    expect(ctx.store.find(marker(125221))).toMatchObject({ kind: 'tag', v3Id: 'tag_1', state: 'done' });
  });

  it('adopts a tag the team already has under that slug', async () => {
    const api = fakeApi({ lists: { '/api/v1/teams/team-1/tags': [{ id: 'tag_old', attributes: { slug: 'mantalks-team', description: null } }] } });
    const ctx = ctxFor(plan({ tags: [{ legacyTagId: 125221, name: 'ManTalks Team', slug: 'mantalks-team' }] }), api);
    await tagsStage(ctx);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.store.find(marker(125221))?.v3Id).toBe('tag_old');
  });
});

describe('segmentsStage', () => {
  const tree = { version: 1 as const, groups: [{ logic: 'AND' as const, conditions: [{ type: 'hub_time_since_joining', operator: 'gte_days', value: { hub_id: 'ledger://hub', days: 30 } }] }] };

  it('creates a mapped segment with the hub id filled in and the marker in its description', async () => {
    const api = fakeApi({ postId: 'seg_1' });
    const ctx = ctxFor(plan({ segments: [{ legacySegmentId: 35073, name: 'Post 30 Days', tree, tagSlugs: [], mappable: true, unmappedReason: null }] }), api);
    await segmentsStage(ctx);
    const create = api.calls.find((c) => c.method === 'POST')!;
    expect(create.path).toBe('/api/v1/teams/team-1/segments');
    expect((create.body as { data: { type: string; attributes: Record<string, unknown> } }).data).toEqual({
      type: 'segment',
      attributes: {
        name: 'Post 30 Days', description: marker(35073), is_active: true,
        conditions: { version: 1, groups: [{ logic: 'AND', conditions: [{ type: 'hub_time_since_joining', operator: 'gte_days', value: { hub_id: 'hub_1', days: 30 } }] }] },
      },
    });
    expect(ctx.store.find(marker(35073))).toMatchObject({ kind: 'segment', v3Id: 'seg_1', state: 'done' });
  });

  it('skips an unmapped segment and says why', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan({ segments: [{ legacySegmentId: 34756, name: 'Leading Yourself', tree: null, tagSlugs: [], mappable: false, unmappedReason: '31986 (attribute_multiple, equals) has no V3 condition mapping' }] }), api);
    await segmentsStage(ctx);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.warnings[0]).toContain('attribute_multiple');
  });
});

describe('assetReferences', () => {
  it('lists every page node and playlist item that points at each asset', () => {
    const p = plan({
      pages: [{ legacyPageId: 100, slug: 'home', title: 'Home', pageType: 'generic', privacy: 'public', isHomepage: true, restrictedSectionNodeIds: [],
        tree: { id: 'r', kind: 'stack', children: [{ id: 'img', kind: 'image', value: 'ledger://asset/91234/original' }] } }],
      playlists: [{ legacyPlaylistId: 42, title: 'C', description: null, visibility: 'public', items: [{ legacyFileId: 5, position: 3 }] }],
      assets: [{ legacyFileId: 5, legacyMediaId: 91234, variant: 'original', sourceBucket: 'b', sourceKey: 'k', sizeBytes: 1, etag: 'e', versionId: null, checksumCrc64Nvme: null, mimeType: 'image/png', cdnUrl: 'u', title: 't', visibility: 'public', isVideo: false, folderLegacyIds: [], playlistLegacyIds: [42] }],
    });
    expect(assetReferences(p).get('91234/original')).toEqual([
      { kind: 'page-node', legacyPageId: 100, pageSlug: 'home', nodeId: 'img' },
      { kind: 'playlist-item', legacyPlaylistId: 42, position: 3 },
    ]);
  });
});

describe('hubStage slug check', () => {
  it('stops when the backend auto-suffixed a taken slug, after recording the hub it created', async () => {
    const api = fakeApi({ postId: 'hub_x' });
    (api as unknown as { post: unknown }).post = async () => ({ data: { id: 'hub_x', attributes: { slug: 'alliance-a1b2c3' } } });
    const ctx = ctxFor(plan(), api);
    await expect(hubStage(ctx)).rejects.toThrow(/taken globally.*alliance-a1b2c3/);
    expect(ctx.store.header.targetHubId).toBe('hub_x');
  });
});

describe('pageTreesStage with --publish-held', () => {
  const gatedPage = {
    legacyPageId: 100, slug: 'training', title: 'Training', pageType: 'generic',
    privacy: 'members' as const, isHomepage: false, restrictedSectionNodeIds: ['n1'],
    tree: { id: 'root', kind: 'stack', children: [{ id: 'n1', kind: 'container', template: 'row', children: [] }] },
  };
  const p = plan({
    pages: [gatedPage],
    segments: [{ legacySegmentId: 77, name: 'Paid members', tree: null, tagSlugs: [], mappable: false, unmappedReason: 'test' }],
    accessRules: [{ targetKind: 'node', legacySectionId: 5, targetRef: 'n1', logicOperator: 'any', conditions: [{ condition_type: 'in_segment', condition_data: { segment_id: 'ledger://segment/77' }, position: 0 }] }],
  });

  it('publishes the held page, records published-ungated with the legacy segment names, and warns', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(p, api);
    ctx.publishedUngated = [];
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set(), true);
    expect(api.calls.some((c) => c.path.endsWith('/publish'))).toBe(true);
    expect(ctx.publishedUngated).toEqual([{ slug: 'training', legacySegments: ['Paid members'] }]);
    expect(ctx.store.find(marker(100))?.referenceHash).toBe('published-ungated');
    expect(ctx.warnings.some((w) => w.includes('UNGATED') && w.includes('Paid members'))).toBe(true);
  });

  it('stamps the mapped rule id on the gated section and publishes the page gated, not held open', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(p, api);
    ctx.publishedUngated = [];
    ctx.store.upsert({ legacyTable: 'sections', legacyId: 5, kind: 'accessRule', variant: null, marker: 'n1', v3Id: 'rule_1', state: 'done', runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: null, revisionToken: null, asset: null });
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set(['n1']), true);
    const put = api.calls.find((c) => c.method === 'PUT')!;
    const root = (put.body as { data: { attributes: { tree: { root: { children: Array<{ id: string; access_rule_id?: string }> } } } } }).data.attributes.tree.root;
    expect(root.children[0]).toMatchObject({ id: 'n1', access_rule_id: 'rule_1' });
    expect(api.calls.some((c) => c.path.endsWith('/publish'))).toBe(true);
    expect(ctx.publishedUngated).toEqual([]);
    expect(ctx.store.find(marker(100))?.referenceHash).toBe('published');
  });

  it('still holds the page without the flag', async () => {
    const api = fakeApi({ postId: 'pg_1', gets: { '/api/v1/teams/team-1/hubs/hub_1/pages/pg_1': { body: { data: { attributes: { draft_version: 1 } } } } } });
    const ctx = ctxFor(p, api);
    await pageDraftsStage(ctx);
    await pageTreesStage(ctx, new Set(), false);
    expect(api.calls.some((c) => c.path.endsWith('/publish'))).toBe(false);
  });
});

describe('removalsStage', () => {
  const pageEntry = (legacyId: number, v3Id: string) => ({
    legacyTable: 'pages', legacyId, kind: 'page' as const, variant: null, marker: marker(legacyId), v3Id, state: 'done' as const,
    runId: 'run-1', createdAt: 'x', updatedAt: 'x', contentHash: 'c', referenceHash: 'published', revisionToken: '1', asset: null,
  });

  it('deletes the copy of an excluded page an earlier run created and marks the entry removed with the reason', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan({ excludedPages: [{ legacyPageId: 280340, title: 'Login', legacyType: 'login', route: 'login' }] }), api);
    ctx.store.upsert(pageEntry(280340, 'pg_login'));
    const removed = await removalsStage(ctx);
    expect(api.calls).toEqual([{ method: 'DELETE', path: '/api/v1/teams/team-1/hubs/hub_1/pages/pg_login' }]);
    expect(removed).toEqual([{ legacyPageId: 280340, v3Id: 'pg_login', reason: 'excluded: legacy login page "Login"; V3 serves /login itself' }]);
    expect(ctx.store.find(marker(280340))).toMatchObject({ state: 'removed', reason: expect.stringContaining('/login') });
  });

  it('leaves a page that is merely missing from the plan alone, and says so', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan(), api);
    ctx.store.upsert(pageEntry(555, 'pg_stray'));
    expect(await removalsStage(ctx)).toEqual([]);
    expect(api.calls).toEqual([]);
    expect(ctx.store.find(marker(555))?.state).toBe('done');
    expect(ctx.warnings[0]).toContain('no longer in the plan');
  });

  it('treats an already deleted page as removed', async () => {
    const api = fakeApi();
    (api as unknown as { delete: unknown }).delete = async () => { throw new Error('DELETE .../pages/pg_login answered 404'); };
    const ctx = ctxFor(plan({ excludedPages: [{ legacyPageId: 280340, title: 'Login', legacyType: 'login', route: 'login' }] }), api);
    ctx.store.upsert(pageEntry(280340, 'pg_login'));
    expect(await removalsStage(ctx)).toHaveLength(1);
    expect(ctx.store.find(marker(280340))?.state).toBe('removed');
  });
});

describe('navigationStage homepage', () => {
  it('points the hub homepage descriptor at the migrated legacy homepage in the same PATCH as the navigation', async () => {
    const api = fakeApi({ postId: 'pg_home' });
    const ctx = ctxFor(plan({ pages: [{ legacyPageId: 386957, slug: 'home-page', title: 'Home', pageType: 'generic', privacy: 'members', isHomepage: true, restrictedSectionNodeIds: [], tree: { id: 'r', kind: 'stack', children: [] } }] }), api);
    await pageDraftsStage(ctx);
    await navigationStage(ctx, []);
    const patch = api.calls.find((c) => c.method === 'PATCH')!;
    expect((patch.body as { data: { attributes: Record<string, unknown> } }).data.attributes).toEqual({
      navigation: { header: [], footer: [], mobile: [] },
      homepage: { kind: 'custom', page_id: 'pg_home' },
    });
  });

  it('writes no descriptor when the plan has no homepage', async () => {
    const api = fakeApi();
    const ctx = ctxFor(plan(), api);
    await navigationStage(ctx, []);
    const patch = api.calls.find((c) => c.method === 'PATCH')!;
    expect((patch.body as { data: { attributes: Record<string, unknown> } }).data.attributes).not.toHaveProperty('homepage');
  });
});
