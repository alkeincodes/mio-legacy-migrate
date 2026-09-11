import type { Profile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { recordMarker } from '../ledger/marker.js';
import type { AssetReference, LedgerEntry } from '../ledger/schema.js';
import type { LedgerStore } from '../ledger/store.js';
import { contentHash, type Plan, type PlanNavigationItem, type PlanPage, type PlanWarning } from '../map/plan.js';
import { resolveHubRef } from '../map/segments.js';
import type { CatalogNode } from '../map/catalog.js';
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
  warn(reason: string, type?: PlanWarning['type']): void;
  /** Pages published by --publish-held although legacy gated them; the report lists these plainly. */
  publishedUngated?: Array<{ slug: string; legacySegments: string[] }>;
}

/** The legacy segment names behind a page's restricted sections, from the plan's rules; unmapped gates are named as such. */
export function legacySegmentsGating(plan: Plan, page: { restrictedSectionNodeIds: string[] }): string[] {
  const names = new Set<string>();
  const byId = new Map(plan.segments.map((s) => [s.legacySegmentId, s.name]));
  for (const nodeId of page.restrictedSectionNodeIds) {
    const rule = plan.accessRules.find((r) => r.targetRef === nodeId);
    if (!rule) { names.add('unmapped legacy gate (deprecated permissions column or unknown segment)'); continue; }
    for (const condition of rule.conditions) {
      const match = /^ledger:\/\/segment\/(\d+)$/.exec(String(condition.condition_data['segment_id'] ?? ''));
      const id = match ? Number(match[1]) : null;
      names.add(id === null ? 'unmapped legacy gate' : (byId.get(id) ?? `legacy segment ${id}`));
    }
  }
  return [...names];
}

type JsonApiRow = { id: string; attributes?: Record<string, unknown> };

const ASSET_REF = /^ledger:\/\/asset\/(\d+)\/(.+)$/;

/** Every page node and playlist item that points at each asset, keyed `mediaId/variant`. */
export function assetReferences(plan: Plan): Map<string, AssetReference[]> {
  const refs = new Map<string, AssetReference[]>();
  const add = (key: string, ref: AssetReference): void => { refs.set(key, [...(refs.get(key) ?? []), ref]); };
  for (const page of plan.pages) {
    const walk = (node: CatalogNode): void => {
      const match = typeof node.value === 'string' ? ASSET_REF.exec(node.value) : null;
      if (match) add(`${match[1]}/${match[2]}`, { kind: 'page-node', legacyPageId: page.legacyPageId, pageSlug: page.slug, nodeId: node.id ?? '' });
      for (const child of node.children ?? []) walk(child);
    };
    walk(page.tree);
  }
  const originalByFile = new Map(plan.assets.filter((a) => a.variant === 'original').map((a) => [a.legacyFileId, a.legacyMediaId]));
  for (const playlist of plan.playlists) {
    for (const item of playlist.items) {
      const mediaId = originalByFile.get(item.legacyFileId);
      if (mediaId !== undefined) add(`${mediaId}/original`, { kind: 'playlist-item', legacyPlaylistId: playlist.legacyPlaylistId, position: item.position });
    }
  }
  return refs;
}

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
      const response = await ctx.api.post<{ data: { id: string; attributes?: { slug?: string } } }>(
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
      const assigned = response.data.attributes?.slug;
      if (assigned !== undefined && assigned !== ctx.plan.hub.slug) {
        // The backend auto-suffixes a globally taken slug and answers 200
        // (app/hubs/slug_generator.py). The hub exists now, so record it, then stop.
        ctx.store.setTargetHubId(response.data.id);
        throw new Error(
          `the slug "${ctx.plan.hub.slug}" is taken globally; the backend created hub ${response.data.id} at slug "${assigned}" instead. Rename it (PATCH attributes.slug) or delete it, then resume; the ledger already records the hub.`,
        );
      }
      return response.data.id;
    },
  });
  ctx.store.setTargetHubId(id);
  return id;
}

// ---------------------------------------------------------------- branding

export async function brandingStage(ctx: StageContext): Promise<void> {
  const keys = Object.keys(ctx.plan.branding);
  const settingsKeys = Object.keys(ctx.plan.hubSettings ?? {});
  if (keys.length === 0 && settingsKeys.length === 0) return;
  const hub = await ctx.api.get<{ data?: { attributes?: { settings?: Record<string, unknown> } } }>(`${team(ctx)}/hubs/${ctx.hubId}`);
  // The hub PATCH replaces the settings blob, so merge over what is there (registration stays as apply set it).
  const current = hub.body?.data?.attributes?.settings ?? {};
  const attributes: Record<string, unknown> = {};
  if (keys.length > 0) attributes['branding'] = ctx.plan.branding;
  if (settingsKeys.length > 0) attributes['settings'] = { ...current, ...ctx.plan.hubSettings };
  await ctx.api.patch(
    `${team(ctx)}/hubs/${ctx.hubId}`,
    { data: { type: 'hubs', attributes } },
    { ifMatch: hub.etag ?? undefined, op: 'hubs.update' },
  );
  logger.info('branding written', { keys: keys.length, settingsKeys });
}

// ---------------------------------------------------------------- tags

/**
 * A has_tag condition is compiled by slug when the segment is created, so the
 * team tags it names must exist first. A tag whose slug is already on the team
 * is adopted as is; one this run creates carries the marker in its description.
 */
export async function tagsStage(ctx: StageContext): Promise<void> {
  for (const tag of ctx.plan.tags) {
    await ensureRecord(ctx, {
      legacyTable: 'tags',
      legacyId: tag.legacyTagId,
      kind: 'tag',
      hash: contentHash(tag),
      list: async (marker) => {
        const found: string[] = [];
        for await (const row of ctx.api.listAll<JsonApiRow>(`${team(ctx)}/tags`)) {
          if (row.attributes?.['slug'] === tag.slug || row.attributes?.['description'] === marker) found.push(row.id);
        }
        return found;
      },
      create: async (marker) => {
        const response = await ctx.api.post<{ data: { id: string } }>(`${team(ctx)}/tags`, {
          data: { type: 'tags', attributes: { name: tag.name, slug: tag.slug, description: marker } },
        });
        return response.data.id;
      },
    });
  }
}

// ---------------------------------------------------------------- segments

/**
 * A segment whose legacy conditions all have a V3 form is created with the
 * mapped tree (src/map/segments.ts); the hub placeholder inside it becomes the
 * target hub id here. One with no V3 form is reported and skipped, and every
 * access rule that depends on it is then skipped too, which is the spec's
 * fail-closed rule.
 */
export async function segmentsStage(ctx: StageContext): Promise<void> {
  for (const segment of ctx.plan.segments) {
    if (!segment.tree) {
      ctx.warn(`segment ${segment.legacySegmentId} "${segment.name}" was not created: ${segment.unmappedReason ?? 'no V3 condition mapping'}`, 'access-unmapped');
      continue;
    }
    const tree = segment.tree;
    await ensureRecord(ctx, {
      legacyTable: 'segments',
      legacyId: segment.legacySegmentId,
      kind: 'segment',
      hash: contentHash(segment),
      list: (m) => listByDescription(ctx, `${team(ctx)}/segments`, m),
      create: async (m) => {
        const response = await ctx.api.post<{ data: { id: string } }>(`${team(ctx)}/segments`, {
          data: {
            type: 'segment',
            attributes: { name: segment.name, description: m, conditions: resolveHubRef(tree, ctx.hubId), is_active: true },
          },
        });
        return response.data.id;
      },
    });
  }
}

// ---------------------------------------------------------------- access rules

const SEGMENT_REF = /^ledger:\/\/segment\/(\d+)$/;

/**
 * V3 gates a page-tree node by the rule's id on the node (`access_rule_id`,
 * app/pages/converter.py GATE_KEY) and resolves it at render by
 * (hub, target_type node, node id). The rule has no marker field, so the ledger
 * entry keys it by the node id it targets; adoption on resume matches the same
 * pair on the hub's rule list. Returns the node ids that now have a rule.
 */
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
      ctx.warn(`access rule for ${rule.targetKind} ${rule.targetRef} skipped: ${unresolved} has no V3 segment; the section it gates is published only under --publish-held`, 'access-unmapped');
      continue;
    }
    const hash = contentHash({ target: rule.targetRef, conditions });
    const existing = ctx.store.find(rule.targetRef);
    if (existing?.state === 'done' && existing.v3Id) { mapped.add(rule.targetRef); continue; }

    let ruleId: string | null = null;
    for await (const row of ctx.api.listAll<JsonApiRow>(`${team(ctx)}/hubs/${ctx.hubId}/access-rules`)) {
      if (row.attributes?.['target_type'] === rule.targetKind && row.attributes?.['target_id'] === rule.targetRef) { ruleId = row.id; break; }
    }
    if (!ruleId) {
      upsertRecord(ctx.store, 'sections', rule.legacySectionId, 'accessRule', rule.targetRef, null, 'intent', ctx.runId, hash);
      const response = await ctx.api.post<{ data: { id: string } }>(
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
      ruleId = response.data.id;
    }
    upsertRecord(ctx.store, 'sections', rule.legacySectionId, 'accessRule', rule.targetRef, ruleId, 'done', ctx.runId, hash);
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
        ctx.warn(`playlist "${playlist.title}" item for legacy file ${item.legacyFileId} skipped: no verified V3 file yet`, 'asset-pending');
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
        (entry.state === 'pending-import' || entry.state === 'pending-copy') &&
        entry.asset.visibility === 'public' &&
        ctx.playbackOk.has(entry.asset.legacyCdnUrl)
      ) {
        ctx.store.upsert({ ...entry, state: 'legacy-linked', updatedAt: new Date().toISOString() });
        return { url: entry.asset.legacyCdnUrl };
      }
      return { pending: true };
    },
    playlist: (legacyPlaylistId) => v3IdOf(ctx, legacyPlaylistId),
    file: (legacyMediaId) => {
      const entry = ctx.store.all().find((e) => e.kind === 'asset' && e.legacyId === legacyMediaId && e.variant === 'original' && e.state === 'verified');
      return entry?.v3Id ?? null;
    },
  };
}

/** The tree with each restricted section carrying the id of the rule the access rules stage created for it. */
export function withGates(ctx: StageContext, page: PlanPage, tree: CatalogNode): CatalogNode {
  const ruleIds = new Map<string, string>();
  for (const nodeId of page.restrictedSectionNodeIds) {
    const entry = ctx.store.find(nodeId);
    if (entry?.kind === 'accessRule' && entry.state === 'done' && entry.v3Id) ruleIds.set(nodeId, entry.v3Id);
  }
  if (ruleIds.size === 0) return tree;
  const walk = (node: CatalogNode): CatalogNode => {
    const ruleId = node.id ? ruleIds.get(node.id) : undefined;
    const next: CatalogNode = ruleId ? { ...node, access_rule_id: ruleId } : { ...node };
    if (node.children) next.children = node.children.map(walk);
    return next;
  };
  return walk(tree);
}

export async function pageTreesStage(ctx: StageContext, mappedRuleTargets: Set<string>, publishHeld = false): Promise<void> {
  const resolver = refResolverFor(ctx);
  for (const page of ctx.plan.pages) {
    const marker = recordMarker(ctx.plan.sourceHost, page.legacyPageId, ctx.runId);
    const entry = ctx.store.find(marker);
    const pageId = entry?.v3Id;
    if (!pageId) throw new Error(`page /${page.slug} has no V3 id in the ledger; the draft stage did not finish`);

    const resolved = withGates(ctx, page, resolveRefs(page.tree, resolver));
    const hash = contentHash(resolved);
    const gated = !shouldPublish(page, mappedRuleTargets);
    const publish = !gated || publishHeld;
    const finalState = gated && publishHeld ? 'published-ungated' : publish ? 'published' : 'draft';
    if (entry?.contentHash === hash && entry.revisionToken !== null && entry.referenceHash === finalState) {
      if (finalState === 'published-ungated') ctx.publishedUngated?.push({ slug: page.slug, legacySegments: legacySegmentsGating(ctx.plan, page) });
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
    if (gated) {
      const legacySegments = legacySegmentsGating(ctx.plan, page);
      ctx.publishedUngated?.push({ slug: page.slug, legacySegments });
      ctx.warn(`page /${page.slug} published UNGATED by --publish-held; legacy gated it by: ${legacySegments.join('; ')}`, 'access-unmapped');
    }
    await ctx.api.post(
      `${team(ctx)}/hubs/${ctx.hubId}/pages/${pageId}/publish`,
      undefined,
      'pages.publish',
      { ifMatch: draftVersion },
    );
    upsertRecord(ctx.store, 'pages', page.legacyPageId, 'page', marker, pageId, 'done', ctx.runId, hash, {
      revisionToken: draftVersion,
      referenceHash: finalState,
    });
  }
}

// ---------------------------------------------------------------- navigation

// ---------------------------------------------------------------- removals

/**
 * A page this run created earlier but the plan now excludes (a legacy login,
 * register, onboarding or discussions page V3 serves itself) is deleted from the
 * hub and its ledger entry marked removed with the reason. Nothing else is ever
 * deleted: a page merely missing from the plan is left alone and reported.
 */
export async function removalsStage(ctx: StageContext): Promise<Array<{ legacyPageId: number; v3Id: string; reason: string }>> {
  const removed: Array<{ legacyPageId: number; v3Id: string; reason: string }> = [];
  const planned = new Set(ctx.plan.pages.map((p) => p.legacyPageId));
  const excludedById = new Map(ctx.plan.excludedPages.map((e) => [e.legacyPageId, e]));
  for (const entry of ctx.store.all()) {
    if (entry.kind !== 'page' || entry.state !== 'done' || !entry.v3Id || planned.has(entry.legacyId)) continue;
    const excluded = excludedById.get(entry.legacyId);
    if (!excluded) {
      ctx.warn(`page ${entry.legacyId} (${entry.v3Id}) is on the hub but no longer in the plan; left in place, delete it by hand if it should go`);
      continue;
    }
    const reason = `excluded: legacy ${excluded.legacyType} page "${excluded.title}"; V3 serves /${excluded.route} itself`;
    try {
      await ctx.api.delete(`${team(ctx)}/hubs/${ctx.hubId}/pages/${entry.v3Id}`);
    } catch (error) {
      if (!/\b404\b/.test(error instanceof Error ? error.message : String(error))) throw error;
    }
    ctx.store.upsert({ ...entry, state: 'removed', reason, updatedAt: new Date().toISOString() });
    removed.push({ legacyPageId: entry.legacyId, v3Id: entry.v3Id, reason });
    logger.info('page removed from the hub', { legacyPageId: entry.legacyId, v3Id: entry.v3Id, reason });
  }
  return removed;
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
  // The legacy homepage is the hub's built-in homepage: the typed descriptor
  // (app/hubs/schemas.py HomepageCustom) points the hub root at that page, so
  // /<slug> renders it and no menu item needs to.
  const home = ctx.plan.pages.find((p) => p.isHomepage);
  const homePageId = home ? v3IdOf(ctx, home.legacyPageId) : null;
  if (home && !homePageId) ctx.warn(`homepage /${home.slug} has no V3 id; the hub homepage descriptor was not set`);
  const attributes: Record<string, unknown> = { navigation };
  if (homePageId) attributes['homepage'] = { kind: 'custom', page_id: homePageId };
  const hub = await ctx.api.get<unknown>(`${team(ctx)}/hubs/${ctx.hubId}`);
  await ctx.api.patch(
    `${team(ctx)}/hubs/${ctx.hubId}`,
    { data: { type: 'hubs', attributes } },
    { ifMatch: hub.etag ?? undefined, op: 'hubs.update' },
  );
  logger.info('navigation written', { header: navigation.header.length, footer: navigation.footer.length, homepage: homePageId });
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

/**
 * What every ledger entry's hashes would be under the current plan, for the
 * kinds the run creates by marker. --accept-plan-change refuses if any entry
 * already done differs, so a run never ends up half on one plan.
 */
export function expectedHashesFor(ctx: StageContext): Map<string, { contentHash: string; referenceHash: string | null | undefined }> {
  const out = new Map<string, { contentHash: string; referenceHash: string | null | undefined }>();
  const m = (legacyId: number): string => recordMarker(ctx.plan.sourceHost, legacyId, ctx.runId);
  out.set(m(ctx.plan.legacyHubId), { contentHash: contentHash(ctx.plan.hub), referenceHash: undefined });
  for (const f of ctx.plan.folders) out.set(m(f.legacyFolderId), { contentHash: contentHash(f), referenceHash: undefined });
  for (const p of ctx.plan.playlists) out.set(m(p.legacyPlaylistId), { contentHash: contentHash(p), referenceHash: undefined });
  for (const sp of ctx.plan.spaces) out.set(m(sp.legacyCategoryId), { contentHash: contentHash(sp), referenceHash: undefined });
  for (const a of ctx.plan.achievements) out.set(m(a.legacyAchievementId), { contentHash: contentHash(a), referenceHash: undefined });
  const resolver = refResolverFor(ctx);
  for (const page of ctx.plan.pages) {
    const entry = ctx.store.find(m(page.legacyPageId));
    // A draft-only entry carries the plan tree hash; a written tree carries the resolved tree hash.
    const written = entry?.referenceHash !== null && entry?.referenceHash !== undefined;
    out.set(m(page.legacyPageId), {
      contentHash: written ? contentHash(withGates(ctx, page, resolveRefs(page.tree, resolver))) : contentHash(page.tree),
      referenceHash: undefined,
    });
  }
  return out;
}

/** Done entries whose hashes the current plan would not reproduce. */
export function doneEntriesDiffering(ctx: StageContext): Array<{ marker: string; kind: string; legacyId: number; field: 'contentHash' | 'referenceHash' }> {
  const expected = expectedHashesFor(ctx);
  const differing: Array<{ marker: string; kind: string; legacyId: number; field: 'contentHash' | 'referenceHash' }> = [];
  for (const entry of ctx.store.all()) {
    if (entry.state !== 'done') continue;
    const want = expected.get(entry.marker);
    if (!want) continue;
    if (want.contentHash !== entry.contentHash) differing.push({ marker: entry.marker, kind: entry.kind, legacyId: entry.legacyId, field: 'contentHash' });
    else if (want.referenceHash !== undefined && want.referenceHash !== entry.referenceHash) differing.push({ marker: entry.marker, kind: entry.kind, legacyId: entry.legacyId, field: 'referenceHash' });
  }
  return differing;
}
