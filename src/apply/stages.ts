import type { Profile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { recordMarker } from '../ledger/marker.js';
import type { LedgerEntry } from '../ledger/schema.js';
import type { LedgerStore } from '../ledger/store.js';
import { contentHash, type Plan, type PlanNavigationItem } from '../map/plan.js';
import type { ApiClient } from './api.js';
import type { EntityKind } from './contracts.js';
import { adoptOrCreate } from './inflight.js';
import { resolveRefs, shouldPublish, type RefResolver } from './order.js';

/**
 * Everything a stage needs. `hubId` is empty until the hub stage has run, and
 * every later stage reads it. `warn` collects run-level warnings that the plan
 * could not know about, such as a navigation link V3 refuses to store.
 */
export interface StageContext {
  plan: Plan;
  store: LedgerStore;
  api: ApiClient;
  profile: Profile;
  runId: string;
  hubId: string;
  /** Legacy CDN URLs that passed the playback prefilter, keyed by asset cdnUrl. */
  playbackOk: Set<string>;
  warn(reason: string): void;
}

type JsonApiRow = { id: string; attributes?: Record<string, unknown> };

export function upsertRecord(
  store: LedgerStore,
  legacyTable: string,
  legacyId: number,
  kind: EntityKind,
  marker: string,
  v3Id: string | null,
  state: 'intent' | 'done',
  runId: string,
  hash: string,
  patch: Partial<Pick<LedgerEntry, 'referenceHash' | 'revisionToken'>> = {},
): void {
  const existing = store.find(marker);
  store.upsert({
    legacyTable, legacyId, kind, variant: null, marker, v3Id, state, runId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contentHash: hash,
    referenceHash: patch.referenceHash ?? existing?.referenceHash ?? null,
    revisionToken: patch.revisionToken ?? existing?.revisionToken ?? null,
    asset: null,
  });
}

/**
 * The adopt-or-create step every markered record goes through. A ledger entry
 * already `done` with an id short-circuits, which is what makes --resume cheap.
 */
async function ensureRecord(
  ctx: StageContext,
  opts: {
    legacyTable: string;
    legacyId: number;
    kind: EntityKind;
    hash: string;
    list: (marker: string) => Promise<string[]>;
    create: (marker: string) => Promise<string>;
  },
): Promise<{ id: string; marker: string }> {
  const marker = recordMarker(ctx.plan.sourceHost, opts.legacyId, ctx.runId);
  const existing = ctx.store.find(marker);
  if (existing?.state === 'done' && existing.v3Id) {
    return { id: existing.v3Id, marker };
  }
  const id = await adoptOrCreate({
    marker,
    list: () => opts.list(marker),
    create: () => opts.create(marker),
    onIntent: () => upsertRecord(ctx.store, opts.legacyTable, opts.legacyId, opts.kind, marker, null, 'intent', ctx.runId, opts.hash),
    onAdopted: (v3Id) => { upsertRecord(ctx.store, opts.legacyTable, opts.legacyId, opts.kind, marker, v3Id, 'done', ctx.runId, opts.hash); },
    onCreated: (v3Id) => upsertRecord(ctx.store, opts.legacyTable, opts.legacyId, opts.kind, marker, v3Id, 'done', ctx.runId, opts.hash),
  });
  return { id, marker };
}

async function listByDescription(ctx: StageContext, path: string, marker: string): Promise<string[]> {
  const found: string[] = [];
  for await (const row of ctx.api.listAll<JsonApiRow>(path)) {
    if (row.attributes?.['description'] === marker) found.push(row.id);
  }
  return found;
}

async function listByMeta(ctx: StageContext, path: string, marker: string): Promise<string[]> {
  const found: string[] = [];
  for await (const row of ctx.api.listAll<JsonApiRow>(path)) {
    const meta = row.attributes?.['meta'] as Record<string, unknown> | undefined;
    if (meta?.['lgcMarker'] === marker) found.push(row.id);
  }
  return found;
}

function v3IdOf(ctx: StageContext, legacyId: number): string | null {
  const entry = ctx.store.find(recordMarker(ctx.plan.sourceHost, legacyId, ctx.runId));
  return entry?.state === 'done' ? entry.v3Id : null;
}

/** The verified V3 file id for a legacy file's original variant, or null. */
function verifiedAsset(ctx: StageContext, legacyFileId: number): LedgerEntry | null {
  const media = ctx.plan.assets.find((a) => a.legacyFileId === legacyFileId && a.variant === 'original');
  if (!media) return null;
  return ctx.store.all().find(
    (e) => e.kind === 'asset' && e.legacyId === media.legacyMediaId && e.variant === 'original' && e.state === 'verified',
  ) ?? null;
}

function team(ctx: StageContext): string {
  return `/api/v1/teams/${ctx.profile.teamId}`;
}

// ---------------------------------------------------------------- hub

export async function hubStage(ctx: StageContext): Promise<string> {
  const { id } = await ensureRecord(ctx, {
    legacyTable: 'hubs',
    legacyId: ctx.plan.legacyHubId,
    kind: 'hub',
    hash: contentHash(ctx.plan.hub),
    list: (marker) => listByMeta(ctx, `${team(ctx)}/hubs/`, marker),
    create: async (marker) => {
      const response = await ctx.api.post<{ data: { id: string } }>(
        `${team(ctx)}/hubs/`,
        {
          data: {
            type: 'hubs',
            attributes: {
              title: ctx.plan.hub.title,
              slug: ctx.plan.hub.slug,
              description: ctx.plan.hub.description,
              is_private: true,
              // Fail-closed by default in app/hubs/registration.py; stated anyway.
              settings: { registration: { enabled: false } },
              meta: { lgcMarker: marker },
            },
          },
        },
        'hubs.create',
      );
      return response.data.id;
    },
  });
  ctx.store.setTargetHubId(id);
  return id;
}

// ---------------------------------------------------------------- branding

export async function brandingStage(ctx: StageContext): Promise<void> {
  const keys = Object.keys(ctx.plan.branding);
  if (keys.length === 0) return;
  const hub = await ctx.api.get<unknown>(`${team(ctx)}/hubs/${ctx.hubId}`);
  await ctx.api.patch(
    `${team(ctx)}/hubs/${ctx.hubId}`,
    { data: { type: 'hubs', attributes: { branding: ctx.plan.branding } } },
    { ifMatch: hub.etag ?? undefined, op: 'hubs.update' },
  );
  logger.info('branding written', { keys: keys.length });
}

// ---------------------------------------------------------------- segments

/**
 * V3 segments need a typed condition tree (app/segments/schemas.py:801-805)
 * and no legacy-to-V3 condition mapping exists yet. M1 records every segment
 * as unmapped; each access rule that depends on one is then skipped and its
 * page stays unpublished, which is the spec's fail-closed rule.
 */
export async function segmentsStage(ctx: StageContext): Promise<void> {
  for (const segment of ctx.plan.segments) {
    ctx.warn(
      `segment ${segment.legacySegmentId} "${segment.name}" was not created: legacy conditions have no V3 condition mapping in M1${segment.mappable ? '' : ' (and its conditions depend on legacy activity)'}`,
    );
  }
}

// ---------------------------------------------------------------- access rules

const SEGMENT_REF = /^ledger:\/\/segment\/(\d+)$/;

export async function accessRulesStage(ctx: StageContext): Promise<Set<string>> {
  const mapped = new Set<string>();
  for (const rule of ctx.plan.accessRules) {
    const conditions: Array<{ condition_type: string; condition_data: Record<string, unknown>; position: number }> = [];
    let unresolved: string | null = null;
    for (const condition of rule.conditions) {
      const ref = String(condition.condition_data['segment_id'] ?? '');
      const match = SEGMENT_REF.exec(ref);
      const segmentId = match ? v3IdOf(ctx, Number(match[1])) : null;
      if (!segmentId) { unresolved = ref; break; }
      conditions.push({ condition_type: condition.condition_type, condition_data: { segment_id: segmentId }, position: condition.position });
    }
    if (unresolved) {
      ctx.warn(`access rule for ${rule.targetKind} ${rule.targetRef} skipped: ${unresolved} has no V3 segment; the page stays unpublished`);
      continue;
    }
    await ctx.api.post(
      `${team(ctx)}/hubs/${ctx.hubId}/access-rules`,
      {
        data: {
          type: 'access_rules',
          attributes: {
            target_type: rule.targetKind,
            target_id: rule.targetRef,
            logic_operator: rule.logicOperator,
            conditions,
          },
        },
      },
    );
    mapped.add(rule.targetRef);
  }
  return mapped;
}

// ---------------------------------------------------------------- folders

/** Folders have no free-text column, so the marker rides in the name (docs/contracts.md). */
export async function foldersStage(ctx: StageContext): Promise<void> {
  for (const folder of ctx.plan.folders) {
    await ensureRecord(ctx, {
      legacyTable: 'folders',
      legacyId: folder.legacyFolderId,
      kind: 'folder',
      hash: contentHash(folder),
      list: async (marker) => {
        const found: string[] = [];
        for await (const row of ctx.api.listAll<JsonApiRow>(`${team(ctx)}/folders`)) {
          if (String(row.attributes?.['name'] ?? '').endsWith(`[${marker}]`)) found.push(row.id);
        }
        return found;
      },
      create: async (marker) => {
        const response = await ctx.api.post<{ data: { id: string } }>(`${team(ctx)}/folders`, {
          data: { type: 'folders', attributes: { name: `${folder.name} [${marker}]`.slice(0, 255), parent_id: null } },
        });
        return response.data.id;
      },
    });
  }
}

/** After the asset stage: place each verified file into its legacy folder. */
export async function attachFoldersStage(ctx: StageContext): Promise<void> {
  for (const asset of ctx.plan.assets) {
    if (asset.variant !== 'original' || asset.folderLegacyIds.length === 0) continue;
    const entry = verifiedAsset(ctx, asset.legacyFileId);
    const folderId = asset.folderLegacyIds[0] === undefined ? null : v3IdOf(ctx, asset.folderLegacyIds[0]);
    if (!entry?.v3Id || !folderId) continue;
    if (entry.referenceHash === folderId) continue;
    await ctx.api.patch(`${team(ctx)}/files/${entry.v3Id}`, {
      data: { type: 'files', attributes: { folder_id: folderId } },
    });
    ctx.store.upsert({ ...entry, referenceHash: folderId, updatedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------- playlists

export async function playlistsStage(ctx: StageContext): Promise<void> {
  for (const playlist of ctx.plan.playlists) {
    const { id, marker } = await ensureRecord(ctx, {
      legacyTable: 'playlists',
      legacyId: playlist.legacyPlaylistId,
      kind: 'playlist',
      hash: contentHash(playlist),
      list: (m) => listByDescription(ctx, `${team(ctx)}/playlists`, m),
      create: async (m) => {
        const response = await ctx.api.post<{ data: { id: string } }>(`${team(ctx)}/playlists`, {
          data: {
            type: 'playlists',
            attributes: { title: playlist.title, description: m, visibility: playlist.visibility, hub_id: ctx.hubId },
          },
        });
        return response.data.id;
      },
    });

    const entry = ctx.store.find(marker);
    const wanted: Array<{ file_id: string; position: number }> = [];
    for (const item of [...playlist.items].sort((a, b) => a.position - b.position)) {
      const asset = verifiedAsset(ctx, item.legacyFileId);
      if (!asset?.v3Id) {
        ctx.warn(`playlist "${playlist.title}" item for legacy file ${item.legacyFileId} skipped: no verified V3 file (video waits for the import endpoint)`);
        continue;
      }
      wanted.push({ file_id: asset.v3Id, position: item.position });
    }
    const itemsHash = contentHash(wanted);
    if (entry?.referenceHash === itemsHash) continue;

    const present = new Set<string>();
    try {
      for await (const row of ctx.api.listAll<JsonApiRow>(`${team(ctx)}/playlists/${id}/items`)) {
        const fileId = row.attributes?.['file_id'];
        if (typeof fileId === 'string') present.add(fileId);
      }
    } catch {
      // No item listing on this target: attach and let the server refuse duplicates.
    }
    for (const item of wanted) {
      if (present.has(item.file_id)) continue;
      await ctx.api.post(`${team(ctx)}/playlists/${id}/items`, {
        data: { type: 'playlist_items', attributes: item },
      });
    }
    if (entry) ctx.store.upsert({ ...entry, referenceHash: itemsHash, updatedAt: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------- pages

export async function pageDraftsStage(ctx: StageContext): Promise<void> {
  for (const page of ctx.plan.pages) {
    await ensureRecord(ctx, {
      legacyTable: 'pages',
      legacyId: page.legacyPageId,
      kind: 'page',
      hash: contentHash(page.tree),
      list: (marker) => listByMeta(ctx, `${team(ctx)}/hubs/${ctx.hubId}/pages/`, marker),
      create: async (marker) => {
        const response = await ctx.api.post<{ data: { id: string } }>(
          `${team(ctx)}/hubs/${ctx.hubId}/pages/`,
          {
            data: {
              type: 'pages',
              attributes: {
                title: page.title,
                slug: page.slug,
                type: page.pageType,
                privacy: page.privacy,
                is_homepage: page.isHomepage,
                meta: { lgcMarker: marker },
              },
            },
          },
          'pages.create',
        );
        return response.data.id;
      },
    });
  }
}

/** Turns ledger:// placeholders into V3 values; a public video that passed the prefilter goes legacy-linked. */
export function refResolverFor(ctx: StageContext): RefResolver {
  return {
    asset: (legacyMediaId, variant) => {
      const entry = ctx.store
        .all()
        .find((e) => e.kind === 'asset' && e.legacyId === legacyMediaId && e.variant === variant);
      if (!entry?.asset) return { pending: true };
      if (entry.state === 'verified' && entry.asset.destinationKey) {
        return { url: `${ctx.profile.cdnBase.replace(/\/$/, '')}/${entry.asset.destinationKey}` };
      }
      if (entry.state === 'legacy-linked') return { url: entry.asset.legacyCdnUrl };
      if (
        entry.state === 'pending-import' &&
        entry.asset.visibility === 'public' &&
        ctx.playbackOk.has(entry.asset.legacyCdnUrl)
      ) {
        ctx.store.upsert({ ...entry, state: 'legacy-linked', updatedAt: new Date().toISOString() });
        return { url: entry.asset.legacyCdnUrl };
      }
      return { pending: true };
    },
    playlist: (legacyPlaylistId) => v3IdOf(ctx, legacyPlaylistId),
  };
}

export async function pageTreesStage(ctx: StageContext, mappedRuleTargets: Set<string>): Promise<void> {
  const resolver = refResolverFor(ctx);
  for (const page of ctx.plan.pages) {
    const marker = recordMarker(ctx.plan.sourceHost, page.legacyPageId, ctx.runId);
    const entry = ctx.store.find(marker);
    const pageId = entry?.v3Id;
    if (!pageId) throw new Error(`page /${page.slug} has no V3 id in the ledger; the draft stage did not finish`);

    const resolved = resolveRefs(page.tree, resolver);
    const hash = contentHash(resolved);
    const publish = shouldPublish(page, mappedRuleTargets);
    if (entry?.contentHash === hash && entry.revisionToken !== null && entry.referenceHash === (publish ? 'published' : 'draft')) {
      continue;
    }

    const current = await ctx.api.get<{ data: { attributes: { draft_version: number } } }>(
      `${team(ctx)}/hubs/${ctx.hubId}/pages/${pageId}`,
    );
    const written = await ctx.api.put<{ data: { attributes: { draft_version: number } } }>(
      `${team(ctx)}/hubs/${ctx.hubId}/pages/${pageId}/tree`,
      { data: { type: 'page_draft_trees', attributes: { tree: { root: resolved } } } },
      { ifMatch: String(current.body.data.attributes.draft_version), op: 'pages.tree_write' },
    );
    const draftVersion = String(written.body.data.attributes.draft_version);
    upsertRecord(ctx.store, 'pages', page.legacyPageId, 'page', marker, pageId, 'done', ctx.runId, hash, {
      revisionToken: draftVersion,
      referenceHash: 'draft',
    });

    if (!publish) {
      ctx.warn(`page /${page.slug} left unpublished: a restricted section has no mapped access rule`);
      continue;
    }
    await ctx.api.post(
      `${team(ctx)}/hubs/${ctx.hubId}/pages/${pageId}/publish`,
      undefined,
      'pages.publish',
      { ifMatch: draftVersion },
    );
    upsertRecord(ctx.store, 'pages', page.legacyPageId, 'page', marker, pageId, 'done', ctx.runId, hash, {
      revisionToken: draftVersion,
      referenceHash: 'published',
    });
  }
}

// ---------------------------------------------------------------- navigation

/** V3 stores url items as root-relative paths only (app/hubs/validation.py:329-354). */
export function navigationItemFor(
  ctx: StageContext,
  item: PlanNavigationItem,
  hubOrigins: string[],
): Record<string, unknown> | null {
  if (item.type === 'page') {
    const page = ctx.plan.pages.find((p) => p.slug === item.pageSlugRef);
    const pageId = page ? v3IdOf(ctx, page.legacyPageId) : null;
    if (!pageId) {
      ctx.warn(`navigation item "${item.label}" dropped: page ${item.pageSlugRef ?? '?'} has no V3 id`);
      return null;
    }
    return { type: 'page', label: item.label, page_id: pageId, position: item.position };
  }
  if (item.type === 'discussions') {
    return { type: 'discussions', label: item.label, position: item.position };
  }
  let href = item.href ?? '';
  for (const origin of hubOrigins) {
    if (href.startsWith(origin)) href = href.slice(origin.length) || '/';
  }
  if (!href.startsWith('/') || href.startsWith('//')) {
    ctx.warn(`navigation item "${item.label}" dropped: V3 only stores root-relative links and this one points at ${item.href ?? 'nothing'}`);
    return null;
  }
  return { type: 'url', label: item.label, href, position: item.position };
}

export async function navigationStage(ctx: StageContext, hubOrigins: string[]): Promise<void> {
  const build = (items: PlanNavigationItem[]): Record<string, unknown>[] =>
    items
      .map((item) => navigationItemFor(ctx, item, hubOrigins))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item, position) => ({ ...item, position }));
  const navigation = {
    header: build(ctx.plan.navigation.header),
    footer: build(ctx.plan.navigation.footer),
    mobile: build(ctx.plan.navigation.mobile),
  };
  const hub = await ctx.api.get<unknown>(`${team(ctx)}/hubs/${ctx.hubId}`);
  await ctx.api.patch(
    `${team(ctx)}/hubs/${ctx.hubId}`,
    { data: { type: 'hubs', attributes: { navigation } } },
    { ifMatch: hub.etag ?? undefined, op: 'hubs.update' },
  );
  logger.info('navigation written', { header: navigation.header.length, footer: navigation.footer.length });
}

// ---------------------------------------------------------------- spaces

export async function spacesStage(ctx: StageContext): Promise<void> {
  const base = `/api/v1/admin/teams/${ctx.profile.teamId}/hubs/${ctx.hubId}/spaces/`;
  for (const space of ctx.plan.spaces) {
    await ensureRecord(ctx, {
      legacyTable: 'discussion_categories',
      legacyId: space.legacyCategoryId,
      kind: 'space',
      hash: contentHash(space),
      list: (marker) => listByDescription(ctx, base, marker),
      create: async (marker) => {
        const segmentId = space.legacySegmentId === null ? null : v3IdOf(ctx, space.legacySegmentId);
        if (space.legacySegmentId !== null && !segmentId) {
          ctx.warn(`space "${space.name}" is restricted by legacy segment ${space.legacySegmentId}, which has no V3 segment; created restricted with no segment`);
        }
        const response = await ctx.api.post<{ data: { id: string } }>(base, {
          data: {
            type: 'spaces',
            attributes: {
              name: space.name.slice(0, 120),
              slug: space.slug,
              description: marker,
              position: space.position,
              access_level: space.accessLevel,
              ...(segmentId ? { segment_id: segmentId } : {}),
            },
          },
        });
        return response.data.id;
      },
    });
  }
}

// ---------------------------------------------------------------- achievements

export async function achievementsStage(ctx: StageContext): Promise<void> {
  for (const achievement of ctx.plan.achievements) {
    const { id, marker } = await ensureRecord(ctx, {
      legacyTable: 'achievements',
      legacyId: achievement.legacyAchievementId,
      kind: 'achievement',
      hash: contentHash(achievement),
      list: (m) => listByDescription(ctx, `${team(ctx)}/achievements`, m),
      create: async (m) => {
        const response = await ctx.api.post<{ data: { id: string } }>(`${team(ctx)}/achievements`, {
          data: {
            type: 'achievements',
            attributes: { title: achievement.title, description: m, is_active: achievement.isActive, award_mode: 'manual' },
          },
        });
        return response.data.id;
      },
    });
    const entry = ctx.store.find(marker);
    if (entry?.referenceHash === ctx.hubId) continue;
    // Offering an achievement to a hub is idempotent server-side.
    await ctx.api.post(`${team(ctx)}/hubs/${ctx.hubId}/achievements`, {
      data: { type: 'achievement_hubs', attributes: { achievement_id: id } },
    });
    if (entry) ctx.store.upsert({ ...entry, referenceHash: ctx.hubId, updatedAt: new Date().toISOString() });
  }
}
