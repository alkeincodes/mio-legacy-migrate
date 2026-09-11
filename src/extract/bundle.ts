import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetManifestEntry } from './manifest.js';
import type {
  LegacyAchievement, LegacyDiscussionCategory, LegacyFile, LegacyFolder, LegacyHub,
  LegacyHubFile, LegacyHubTheme, LegacyMedia, LegacyMenuItem, LegacyPage,
  LegacyPlaylist, LegacyPlaylistItem, LegacySection, LegacySegment,
  LegacySegmentCondition, LegacySegmentGroup, LegacySegmentable,
} from './queries.js';

export const BUNDLE_SCHEMA_VERSION = 1 as const;

export interface BundleHeader {
  bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  toolVersion: string;
  legacyHubId: number;
  legacyHubDomain: string;
  sourceHost: string;
  captureStartedAt: string;
  captureEndedAt: string;
  replicaLagSeconds: number | 'unavailable';
  distinctSectionTypes: string[];
  /** False after `extract --skip-s3` until `extract --s3-only` pins the manifest. Absent means pinned. */
  manifestPinned?: boolean;
}

export interface Bundle {
  header: BundleHeader;
  hub: LegacyHub;
  theme: LegacyHubTheme | null;
  pages: LegacyPage[];
  sections: LegacySection[];
  menuItems: LegacyMenuItem[];
  playlists: LegacyPlaylist[];
  playlistItems: LegacyPlaylistItem[];
  files: LegacyFile[];
  hubFiles: LegacyHubFile[];
  folders: LegacyFolder[];
  media: LegacyMedia[];
  discussionCategories: LegacyDiscussionCategory[];
  achievements: LegacyAchievement[];
  segments: LegacySegment[];
  segmentGroups: LegacySegmentGroup[];
  segmentConditions: LegacySegmentCondition[];
  segmentables: LegacySegmentable[];
  assets: AssetManifestEntry[];
  missingAssets: Array<{ legacyMediaId: number; variant: string; key: string }>;
}

export function writeBundle(bundle: Bundle, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const stamp = bundle.header.captureStartedAt.replace(/:/g, '-');
  const path = join(dir, `hub-${bundle.header.legacyHubId}-${stamp}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(bundle, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

export function readBundle(path: string): Bundle {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Bundle;
  if (parsed.header?.bundleSchemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(
      `bundle schema version ${String(parsed.header?.bundleSchemaVersion)} in ${path}, expected ${BUNDLE_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}
