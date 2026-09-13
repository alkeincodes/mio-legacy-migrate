import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogNode } from './catalog.js';

export const PLAN_VERSION = 1 as const;

export interface PlanWarning {
  pageSlug: string | null;
  legacySectionId: number | null;
  type: 'approximated' | 'dropped' | 'access-unmapped' | 'asset-pending' | 'excluded' | 'fidelity';
  reason: string;
  /** fidelity only: the styling property, e.g. 'button.chrome', 'section.ink', 'image.maxWidth'. */
  property?: string;
  /** fidelity only: what legacy paints. */
  legacy?: string;
  /** fidelity only: what V3 will paint. */
  v3?: string;
  /** fidelity only: how many nodes share this entry after collapse. */
  count?: number;
}

export interface PlanHub { title: string; slug: string; description: string | null; isPrivate: boolean }

export interface PlanPage {
  legacyPageId: number;
  slug: string;
  title: string;
  pageType: string;
  privacy: 'public' | 'members' | 'private';
  isHomepage: boolean;
  tree: CatalogNode;
  /** Node ids of sections that carry a legacy gate. */
  restrictedSectionNodeIds: string[];
}

export interface PlanPlaylist {
  legacyPlaylistId: number;
  title: string;
  description: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  items: Array<{ legacyFileId: number; position: number }>;
}

export interface PlanFolder { legacyFolderId: number; name: string }

export interface PlanAsset {
  legacyFileId: number;
  legacyMediaId: number;
  variant: string;
  sourceBucket: string;
  sourceKey: string;
  sizeBytes: number;
  etag: string;
  versionId: string | null;
  checksumCrc64Nvme: string | null;
  mimeType: string | null;
  cdnUrl: string;
  title: string;
  visibility: 'public' | 'restricted';
  isVideo: boolean;
  folderLegacyIds: number[];
  playlistLegacyIds: number[];
}

export interface PlanSpace {
  legacyCategoryId: number;
  name: string;
  slug: string;
  description: string | null;
  accessLevel: 'public' | 'restricted';
  legacySegmentId: number | null;
  position: number;
}

export interface PlanAchievement {
  legacyAchievementId: number;
  title: string;
  description: string | null;
  isActive: boolean;
}

/** A V3 segment condition tree: OR of AND groups (app/segments/schemas.py ConditionTreeIn). */
export interface PlanSegmentCondition { type: string; operator: string; value: Record<string, unknown> }
export interface PlanSegmentTree { version: 1; groups: Array<{ logic: 'AND'; conditions: PlanSegmentCondition[] }> }

export interface PlanSegment {
  legacySegmentId: number;
  name: string;
  /** The V3 condition tree, or null when a legacy condition has no V3 equivalent. `ledger://hub` inside it is the target hub id. */
  tree: PlanSegmentTree | null;
  /** V3 tag slugs the tree's has_tag conditions need; the tags stage creates them first. */
  tagSlugs: string[];
  mappable: boolean;
  unmappedReason: string | null;
}

/** A legacy page the migration leaves out because V3 serves that surface itself; links to it go to `route`. */
export interface PlanExcludedPage { legacyPageId: number; title: string; legacyType: string; route: string }

/** A team tag a segment condition names; created by slug before the segment. */
export interface PlanTag { legacyTagId: number; name: string; slug: string }

export interface PlanAccessRule {
  /** `node` gates a page-tree node: the rule is created with target_type node and its id rides on the node as access_rule_id. */
  targetKind: 'node' | 'content_node';
  legacySectionId: number;
  targetRef: string;
  logicOperator: 'any' | 'all';
  conditions: Array<{ condition_type: 'has_entitlement' | 'in_segment' | 'past_drip_date'; condition_data: Record<string, unknown>; position: number }>;
}

export interface PlanNavigationItem {
  type: 'url' | 'page' | 'discussions';
  label: string;
  href?: string;
  pageSlugRef?: string;
  /** A url item that opens a migrated playlist; apply resolves it to /playlists/<v3 id>. */
  playlistRef?: number;
  position: number;
}

export interface PlanNavigation {
  header: PlanNavigationItem[];
  footer: PlanNavigationItem[];
  mobile: PlanNavigationItem[];
}

export interface Plan {
  planVersion: typeof PLAN_VERSION;
  toolVersion: string;
  catalogVersion: string;
  catalogDigest: string;
  legacyHubId: number;
  sourceHost: string;
  /** Set by map from the bundle header; older plans may lack it. */
  legacyHubDomain?: string;
  /** False when the bundle came from `extract --skip-s3`; apply refuses a real run until it is pinned. */
  assetsPinned?: boolean;
  /** Legacy page slugs the mapper renamed (reserved on V3, or duplicates). */
  pageSlugRenames?: Array<{ legacySlug: string; slug: string; legacyPageId: number }>;
  hub: PlanHub;
  branding: Record<string, string | boolean | number>;
  /** Hub settings apply merges over the target (theme mode); absent on older plans. */
  hubSettings?: Record<string, unknown>;
  pages: PlanPage[];
  excludedPages: PlanExcludedPage[];
  playlists: PlanPlaylist[];
  folders: PlanFolder[];
  assets: PlanAsset[];
  spaces: PlanSpace[];
  achievements: PlanAchievement[];
  segments: PlanSegment[];
  tags: PlanTag[];
  accessRules: PlanAccessRule[];
  navigation: PlanNavigation;
  warnings: PlanWarning[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function contentHash(entry: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(entry))).digest('hex');
}

/** Warnings are advisory; excluding them keeps a resume valid after a re-run that only changed advice. */
export function planHash(plan: Plan): string {
  const { warnings: _warnings, ...rest } = plan;
  return contentHash(rest);
}

export function writePlan(plan: Plan, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `hub-${plan.legacyHubId}-${planHash(plan).slice(0, 12)}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(plan, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

export function readPlan(path: string): Plan {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Plan;
  if (parsed.planVersion !== PLAN_VERSION) {
    throw new Error(`plan version ${String(parsed.planVersion)} in ${path}, expected ${PLAN_VERSION}`);
  }
  return parsed;
}
