import { readBundle } from '../extract/bundle.js';
import { logger } from '../log/logger.js';
import { TOOL_VERSION } from '../version.js';
import { fetchCatalog, validateTree } from '../map/catalog.js';
import { mapBranding } from '../map/branding.js';
import { dominantButtonColour } from '../map/style.js';
import { homeMenuLabel, mapNavigation } from '../map/navigation.js';
import { mapPages } from '../map/pages.js';
import { mapSegment } from '../map/segments.js';
import { SECTION_TABLE } from '../map/sectionTable.js';
import { writePlan, type Plan, type PlanSegment, type PlanTag, type PlanWarning } from '../map/plan.js';
import { MORPH_HUB } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';

/** The V3 slug: the legacy custom subdomain when set, else the first label of the legacy domain. */
export function hubSlugFor(customSubdomain: string | null, domain: string, legacyHubId: number): string {
  const raw = (customSubdomain ?? domain.split('.')[0] ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw.length > 0 ? raw : `hub-${legacyHubId}`;
}

export interface MapOptions {
  bundlePath: string;
  outDir: string;
  apiBase: string;
  /** Legacy page types to leave out; undefined means the mapper's default list. */
  excludePageTypes?: string[];
}

export async function runMap(options: MapOptions): Promise<string> {
  const bundle = readBundle(options.bundlePath);
  const { catalog, digest } = await fetchCatalog(options.apiBase);

  const warnings: PlanWarning[] = [];
  const { pages, excluded, accessRules, warnings: pageWarnings, renames } = mapPages(bundle, { excludePageTypes: options.excludePageTypes });
  warnings.push(...pageWarnings);

  const slugByPageId = new Map(pages.map((p) => [p.legacyPageId, p.slug]));
  const homePage = pages.find((p) => p.isHomepage);
  const homeLabel = homeMenuLabel(parseJsonObject(bundle.theme?.settings));
  const { navigation, warnings: navWarnings } = mapNavigation(
    bundle, slugByPageId, new Map(bundle.pages.map((pg) => [pg.id, pg.type])), new Set(excluded.map((e) => e.legacyPageId)),
    homePage && homeLabel ? { label: homeLabel, pageSlug: homePage.slug } : null,
  );
  warnings.push(...navWarnings);

  const { branding, hubSettings, warnings: brandingWarnings } = mapBranding(
    bundle.theme,
    bundle.media.filter((m) => m.model_type === MORPH_HUB),
    bundle.header.legacyCdnUrl ?? process.env['LEGACY_CDN_URL'] ?? '',
    bundle.header.legacyS3Url ?? process.env['LEGACY_S3_URL'] ?? '',
    { dominantButton: dominantButtonColour(bundle.sections) },
  );
  warnings.push(...brandingWarnings);

  for (const page of pages) {
    for (const violation of validateTree(catalog, page.tree)) {
      warnings.push({
        pageSlug: page.slug,
        legacySectionId: null,
        type: 'approximated',
        reason: `catalog validation: ${violation}`,
      });
    }
  }

  const conditionsBySegment = new Map<number, typeof bundle.segmentConditions>();
  for (const condition of bundle.segmentConditions) {
    conditionsBySegment.set(condition.segment_id, [
      ...(conditionsBySegment.get(condition.segment_id) ?? []),
      condition,
    ]);
  }
  const tags = new Map<string, PlanTag>();
  const segments: PlanSegment[] = bundle.segments.map((s) => {
    const mapped = mapSegment(s, bundle.segmentGroups.filter((g) => g.segment_id === s.id), conditionsBySegment.get(s.id) ?? []);
    for (const tag of mapped.tags) tags.set(tag.slug, tag);
    if (mapped.unmappedReason) {
      warnings.push({ pageSlug: null, legacySectionId: null, type: 'access-unmapped', reason: `segment ${s.id} "${s.title}" is not created: ${mapped.unmappedReason}` });
    }
    return {
      legacySegmentId: s.id,
      name: s.title,
      tree: mapped.tree,
      tagSlugs: mapped.tags.map((t) => t.slug),
      mappable: mapped.tree !== null,
      unmappedReason: mapped.unmappedReason,
    };
  });

  const plan: Plan = {
    planVersion: 1,
    toolVersion: TOOL_VERSION,
    catalogVersion: catalog.meta.catalogVersion,
    catalogDigest: digest,
    legacyHubId: bundle.header.legacyHubId,
    sourceHost: bundle.header.sourceHost,
    legacyHubDomain: bundle.header.legacyHubDomain,
    assetsPinned: bundle.header.manifestPinned !== false,
    pageSlugRenames: renames,
    excludedPages: excluded,
    hub: {
      title: bundle.hub.title,
      slug: hubSlugFor(bundle.hub.custom_subdomain, bundle.header.legacyHubDomain, bundle.hub.id),
      description: bundle.hub.description,
      isPrivate: bundle.hub.auth === 1,
    },
    branding,
    hubSettings,
    pages,
    playlists: bundle.playlists.map((p) => ({
      legacyPlaylistId: p.id,
      title: p.title,
      description: p.description,
      visibility: p.privacy === 'public' ? 'public' : p.privacy === 'unlisted' ? 'unlisted' : 'private',
      items: bundle.playlistItems
        .filter((i) => i.playlist_id === p.id)
        .map((i) => ({ legacyFileId: i.file_id, position: i.position })),
    })),
    folders: bundle.folders.map((f) => ({ legacyFolderId: f.id, name: f.title })),
    assets: bundle.assets.map((a) => ({
      legacyFileId: a.legacyFileId,
      legacyMediaId: a.legacyMediaId,
      variant: a.variant,
      sourceBucket: a.sourceBucket,
      sourceKey: a.sourceKey,
      sizeBytes: a.sizeBytes,
      etag: a.etag,
      versionId: a.versionId,
      checksumCrc64Nvme: a.checksumCrc64Nvme,
      mimeType: a.mimeType,
      cdnUrl: a.cdnUrl,
      title: bundle.files.find((f) => f.id === a.legacyFileId)?.title
        ?? (a.legacyOwner ? `${a.legacyOwner.type.replace(/^App\\\\/, '').toLowerCase()}-${a.legacyOwner.id}-${a.variant}` : `file-${a.legacyFileId}`),
      visibility: a.visibility,
      isVideo: (a.mimeType ?? '').startsWith('video/'),
      folderLegacyIds: a.folderIds,
      playlistLegacyIds: a.playlistIds,
    })),
    spaces: bundle.discussionCategories.map((c) => ({
      legacyCategoryId: c.id,
      name: c.name,
      slug: c.slug ?? `space-${c.id}`,
      description: null,
      accessLevel: c.access_level === 'public' ? 'public' : 'restricted',
      legacySegmentId: c.segment_id,
      position: c.order_id ?? 0,
    })),
    achievements: bundle.achievements.map((a) => ({
      legacyAchievementId: a.id,
      title: a.title,
      description: a.description,
      isActive: a.enabled === 1,
    })),
    segments,
    tags: [...tags.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    accessRules,
    navigation,
    warnings,
  };

  const unreviewed = SECTION_TABLE.filter((m) => m.reviewed === 'no').map((m) => m.legacyType);
  if (unreviewed.length > 0) {
    logger.warn('section mapping rows still awaiting human review', { types: [...new Set(unreviewed)] });
  }

  const path = writePlan(plan, options.outDir);
  logger.info('plan written', {
    path,
    pages: plan.pages.length,
    excludedPages: plan.excludedPages.length,
    assets: plan.assets.length,
    warnings: plan.warnings.length,
    dropped: plan.warnings.filter((w) => w.type === 'dropped').length,
  });
  return path;
}
