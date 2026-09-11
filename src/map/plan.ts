import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogNode } from './catalog.js';

export const PLAN_VERSION = 1 as const;

export interface PlanWarning {
  pageSlug: string | null;
  legacySectionId: number | null;
  type: 'approximated' | 'dropped' | 'access-unmapped' | 'asset-pending';
  reason: string;
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

export interface PlanSegment {
  legacySegmentId: number;
  name: string;
  conditions: unknown;
  mappable: boolean;
}

export interface PlanAccessRule {
  targetKind: 'section' | 'content_node';
  targetRef: string;
  logicOperator: 'any' | 'all';
  conditions: Array<{ condition_type: 'has_entitlement' | 'in_segment' | 'past_drip_date'; condition_data: Record<string, unknown>; position: number }>;
}

export interface PlanNavigationItem {
  type: 'url' | 'page' | 'discussions';
  label: string;
  href?: string;
  pageSlugRef?: string;
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
  hub: PlanHub;
  branding: Record<string, string>;
  pages: PlanPage[];
  playlists: PlanPlaylist[];
  folders: PlanFolder[];
  assets: PlanAsset[];
  spaces: PlanSpace[];
  achievements: PlanAchievement[];
  segments: PlanSegment[];
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
