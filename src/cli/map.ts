import { readBundle } from '../extract/bundle.js';
import { logger } from '../log/logger.js';
import { TOOL_VERSION } from '../version.js';
import { fetchCatalog, validateTree } from '../map/catalog.js';
import { mapBranding } from '../map/branding.js';
import { mapNavigation } from '../map/navigation.js';
import { mapPages } from '../map/pages.js';
import { isSegmentMappable } from '../map/visibility.js';
import { SECTION_TABLE } from '../map/sectionTable.js';
import { writePlan, type Plan, type PlanWarning } from '../map/plan.js';
import { MORPH_HUB } from '../extract/queries.js';

/** The V3 slug: the legacy custom subdomain when set, else the first label of the legacy domain. */
export function hubSlugFor(customSubdomain: string | null, domain: string, legacyHubId: number): string {
  const raw = (customSubdomain ?? domain.split('.')[0] ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return raw.length > 0 ? raw : `hub-${legacyHubId}`;
}

export interface MapOptions {
  bundlePath: string;
  outDir: string;
  apiBase: string;
}

export async function runMap(options: MapOptions): Promise<string> {
  const bundle = readBundle(options.bundlePath);
  const { catalog, digest } = await fetchCatalog(options.apiBase);

  const warnings: PlanWarning[] = [];
  const { pages, accessRules, warnings: pageWarnings } = mapPages(bundle);
  warnings.push(...pageWarnings);

  const slugByPageId = new Map(pages.map((p) => [p.legacyPageId, p.slug]));
  const { navigation, warnings: navWarnings } = mapNavigation(bundle, slugByPageId);
  warnings.push(...navWarnings);

  const { branding, warnings: brandingWarnings } = mapBranding(
    bundle.theme,
    bundle.media.filter((m) => m.model_type === MORPH_HUB),
    bundle.header.legacyCdnUrl ?? process.env['LEGACY_CDN_URL'] ?? '',
    bundle.header.legacyS3Url ?? process.env['LEGACY_S3_URL'] ?? '',
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

  const plan: Plan = {
    planVersion: 1,
    toolVersion: TOOL_VERSION,
    catalogVersion: catalog.meta.catalogVersion,
    catalogDigest: digest,
    legacyHubId: bundle.header.legacyHubId,
    sourceHost: bundle.header.sourceHost,
    legacyHubDomain: bundle.header.legacyHubDomain,
    assetsPinned: bundle.header.manifestPinned !== false,
    hub: {
      title: bundle.hub.title,
      slug: hubSlugFor(bundle.hub.custom_subdomain, bundle.header.legacyHubDomain, bundle.hub.id),
      description: bundle.hub.description,
      isPrivate: bundle.hub.auth === 1,
    },
    branding,
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
      title: bundle.files.find((f) => f.id === a.legacyFileId)?.title ?? `file-${a.legacyFileId}`,
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
    segments: bundle.segments.map((s) => ({
      legacySegmentId: s.id,
      name: s.title,
      conditions: conditionsBySegment.get(s.id) ?? [],
      mappable: isSegmentMappable(s, conditionsBySegment.get(s.id) ?? []),
    })),
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
    assets: plan.assets.length,
    warnings: plan.warnings.length,
    dropped: plan.warnings.filter((w) => w.type === 'dropped').length,
  });
  return path;
}
