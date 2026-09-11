import { paginateByPk, type SnapshotSession } from './db.js';

/**
 * searchie generates its morph map from app/Models/*.php as
 * "App\{Model}" => "App\Models\{Model}" (AppServiceProvider.php:24-56), so every
 * stored model_type is the OLD namespace. Never write App\Models\ here.
 */
export const MORPH_HUB = 'App\\Hub';
export const MORPH_FILE = 'App\\File';
export const MORPH_PAGE = 'App\\Page';
export const MORPH_PLAYLIST = 'App\\Playlist';
export const MORPH_ACHIEVEMENT = 'App\\Achievement';
export const MORPH_SECTION = 'App\\Section';
export const MORPH_MENU_ITEM = 'App\\MenuItem';

export interface LegacyHub {
  id: number; team_id: number; user_id: number; current_theme_id: number | null;
  title: string; description: string | null; meta: string | null;
  domain: string | null; custom_subdomain: string | null; auth: number;
  contact_email: string | null;
}
export interface LegacyHubTheme { id: number; theme_id: number; hub_id: number; settings: string | null }
export interface LegacyPage {
  id: number; hub_id: number; title: string | null; settings: string | null;
  type: string; slug: string | null; is_homepage: number; parent_id: number | null;
  privacy: string | null;
}
export interface LegacySection {
  id: number; hub_id: number; page_id: number | null; parent_id: number | null;
  model_type: string | null; model_id: number | null; hidden: number | null;
  type: string; title: string | null; label: string | null; settings: string | null;
  permissions: string | null; meta: string | null; position: number;
  segment_id: number | null;
}
export interface LegacyMenuItem {
  id: number; hub_id: number; menu: string; title: string | null; hidden: number | null;
  type: string; model_type: string | null; model_id: number | null;
  settings: string | null; position: number; segment_id: number | null;
}
export interface LegacyPlaylist {
  id: number; team_id: number; hub_id: number | null; title: string;
  description: string | null; privacy: string | null; sort: string | null;
  meta: string | null; scheduled_at: string | null;
}
export interface LegacyPlaylistItem { file_id: number; playlist_id: number; position: number; published_at: string | null }
export interface LegacyFile {
  id: number; team_id: number; folder_id: number | null; title: string | null;
  description: string | null; content_type: string; privacy: string | null;
  current_media_id: number | null; meta: string | null; thumb_url: string | null;
  source_url: string | null;
}
export interface LegacyHubFile { hub_id: number; file_id: number; privacy: string | null; published_at: string | null }
export interface LegacyFolder { id: number; team_id: number | null; title: string; is_default: number; meta: string | null }
export interface LegacyMedia {
  id: number; model_type: string; model_id: number; uuid: string | null;
  collection_name: string; name: string; file_name: string; mime_type: string | null;
  disk: string; conversions_disk: string | null; size: number;
  generated_conversions: string | null; custom_properties: string | null;
  responsive_images: string | null; order_column: number | null;
}
export interface LegacyDiscussionCategory {
  id: number; hub_id: number; name: string; slug: string | null; is_default: number;
  order_id: number | null; access_level: string; segment_id: number | null;
  settings: string | null;
}
export interface LegacyAchievement {
  id: number; team_id: number; title: string; description: string | null;
  type: string; criteria: string | null; enabled: number; settings: string | null;
}
export interface LegacySegment {
  id: number; team_id: number; title: string; type: string | null;
  logic: 'and' | 'or'; hidden: number | null; achievement_id: number | null;
}
export interface LegacySegmentGroup { id: number; segment_id: number; logic: 'and' | 'or' }
export interface LegacySegmentCondition {
  id: number; segment_id: number; segment_group_id: number; condition: string;
  operator: string; value: string | null; type: string; tag_id: number | null;
}
export interface LegacySegmentable { id: number; segment_id: number; segmentable_id: number; segmentable_type: string }

export async function findHubByDomain(
  session: SnapshotSession,
  domain: string,
): Promise<LegacyHub | null> {
  const rows = await session.query<LegacyHub>(
    `SELECT id, team_id, user_id, current_theme_id, title, description, meta,
            domain, custom_subdomain, auth, contact_email
       FROM hubs
      WHERE domain = ? AND deleted_at IS NULL
      LIMIT 1`,
    [domain],
  );
  return rows[0] ?? null;
}

export async function fetchHubTheme(
  session: SnapshotSession,
  hub: LegacyHub,
): Promise<LegacyHubTheme | null> {
  const rows = await session.query<LegacyHubTheme>(
    `SELECT id, theme_id, hub_id, settings
       FROM hub_theme
      WHERE hub_id = ? AND theme_id = ?
      LIMIT 1`,
    [hub.id, hub.current_theme_id],
  );
  return rows[0] ?? null;
}

export function fetchPages(session: SnapshotSession, hubId: number): Promise<LegacyPage[]> {
  return paginateByPk<LegacyPage>(
    session,
    `SELECT t.id, t.hub_id, t.title, t.settings, t.type, t.slug, t.is_homepage,
            t.parent_id, t.privacy
       FROM pages t
      WHERE t.hub_id = ? AND t.deleted_at IS NULL /*KEYSET*/`,
    [hubId],
  );
}

/** Every level of the section tree in one pass; the caller rebuilds parent_id links. */
export function fetchSections(session: SnapshotSession, hubId: number): Promise<LegacySection[]> {
  return paginateByPk<LegacySection>(
    session,
    `SELECT t.id, t.hub_id, t.page_id, t.parent_id, t.model_type, t.model_id,
            t.hidden, t.type, t.title, t.label, t.settings, t.permissions,
            t.meta, t.position, t.segment_id
       FROM sections t
      WHERE t.hub_id = ? AND t.deleted_at IS NULL /*KEYSET*/`,
    [hubId],
  );
}

export function fetchMenuItems(session: SnapshotSession, hubId: number): Promise<LegacyMenuItem[]> {
  return paginateByPk<LegacyMenuItem>(
    session,
    `SELECT t.id, t.hub_id, t.menu, t.title, t.hidden, t.type, t.model_type,
            t.model_id, t.settings, t.position, t.segment_id
       FROM menu_items t
      WHERE t.hub_id = ? AND t.deleted_at IS NULL AND t.menu IN ('header','footer') /*KEYSET*/`,
    [hubId],
  );
}

/**
 * playlists.hub_id is nullable and carries no foreign key, so a hub also owns
 * playlists only reachable through sections.model_type = 'App\Playlist'. Pass
 * those ids in extraPlaylistIds.
 */
export async function fetchPlaylists(
  session: SnapshotSession,
  hubId: number,
  extraPlaylistIds: number[],
): Promise<LegacyPlaylist[]> {
  const ids = [...new Set(extraPlaylistIds)];
  return session.query<LegacyPlaylist>(
    `SELECT id, team_id, hub_id, title, description, privacy, sort, meta, scheduled_at
       FROM playlists
      WHERE deleted_at IS NULL AND (hub_id = ? ${ids.length ? 'OR id IN (?)' : ''})
      ORDER BY id ASC`,
    ids.length ? [hubId, ids] : [hubId],
  );
}

export async function fetchPlaylistItems(
  session: SnapshotSession,
  playlistIds: number[],
): Promise<LegacyPlaylistItem[]> {
  if (playlistIds.length === 0) return [];
  return session.query<LegacyPlaylistItem>(
    `SELECT file_id, playlist_id, position, published_at
       FROM file_playlist
      WHERE playlist_id IN (?)
      ORDER BY playlist_id ASC, position ASC`,
    [playlistIds],
  );
}

export async function fetchFiles(
  session: SnapshotSession,
  fileIds: number[],
): Promise<LegacyFile[]> {
  if (fileIds.length === 0) return [];
  return session.query<LegacyFile>(
    `SELECT id, team_id, folder_id, title, description, content_type, privacy,
            current_media_id, meta, thumb_url, source_url
       FROM files
      WHERE id IN (?) AND deleted_at IS NULL
      ORDER BY id ASC`,
    [fileIds],
  );
}

export async function fetchHubFiles(
  session: SnapshotSession,
  hubId: number,
): Promise<LegacyHubFile[]> {
  return session.query<LegacyHubFile>(
    `SELECT hub_id, file_id, privacy, published_at
       FROM hub_file
      WHERE hub_id = ?`,
    [hubId],
  );
}

export async function fetchFolders(
  session: SnapshotSession,
  folderIds: number[],
): Promise<LegacyFolder[]> {
  if (folderIds.length === 0) return [];
  return session.query<LegacyFolder>(
    `SELECT id, team_id, title, is_default, meta
       FROM folders
      WHERE id IN (?) AND deleted_at IS NULL
      ORDER BY id ASC`,
    [folderIds],
  );
}

/**
 * Spatie media rows for a set of owners. media has no deleted_at: it is
 * hard-deleted, so there is nothing to exclude.
 */
export async function fetchMedia(
  session: SnapshotSession,
  owners: Array<{ modelType: string; modelId: number }>,
): Promise<LegacyMedia[]> {
  if (owners.length === 0) return [];
  return session.query<LegacyMedia>(
    `SELECT t.id, t.model_type, t.model_id, t.uuid, t.collection_name, t.name,
            t.file_name, t.mime_type, t.disk, t.conversions_disk, t.size,
            t.generated_conversions, t.custom_properties, t.responsive_images,
            t.order_column
       FROM media t
      WHERE (t.model_type, t.model_id) IN (?)
      ORDER BY t.id ASC`,
    [owners.map((o) => [o.modelType, o.modelId])],
  );
}

export function fetchDiscussionCategories(
  session: SnapshotSession,
  hubId: number,
): Promise<LegacyDiscussionCategory[]> {
  return paginateByPk<LegacyDiscussionCategory>(
    session,
    `SELECT t.id, t.hub_id, t.name, t.slug, t.is_default, t.order_id,
            t.access_level, t.segment_id, t.settings
       FROM discussion_categories t
      WHERE t.hub_id = ? AND t.deleted_at IS NULL /*KEYSET*/`,
    [hubId],
  );
}

/** Achievements are team-scoped and reach a hub only through achievement_hub. */
export function fetchAchievements(
  session: SnapshotSession,
  hubId: number,
): Promise<LegacyAchievement[]> {
  return paginateByPk<LegacyAchievement>(
    session,
    `SELECT t.id, t.team_id, t.title, t.description, t.type, t.criteria,
            t.enabled, t.settings
       FROM achievements t
       JOIN achievement_hub ah ON ah.achievement_id = t.id
      WHERE ah.hub_id = ? AND t.deleted_at IS NULL /*KEYSET*/`,
    [hubId],
  );
}

export async function fetchSegments(
  session: SnapshotSession,
  segmentIds: number[],
): Promise<{
  segments: LegacySegment[];
  groups: LegacySegmentGroup[];
  conditions: LegacySegmentCondition[];
}> {
  const ids = [...new Set(segmentIds)];
  if (ids.length === 0) return { segments: [], groups: [], conditions: [] };
  const segments = await session.query<LegacySegment>(
    `SELECT id, team_id, title, type, logic, hidden, achievement_id
       FROM segments
      WHERE id IN (?) AND deleted_at IS NULL
      ORDER BY id ASC`,
    [ids],
  );
  const groups = await session.query<LegacySegmentGroup>(
    `SELECT id, segment_id, logic FROM segment_groups WHERE segment_id IN (?) ORDER BY id ASC`,
    [ids],
  );
  const conditions = await session.query<LegacySegmentCondition>(
    `SELECT id, segment_id, segment_group_id, \`condition\`, operator, value, type, tag_id
       FROM segment_conditions
      WHERE segment_id IN (?)
      ORDER BY id ASC`,
    [ids],
  );
  return { segments, groups, conditions };
}

/** The modern polymorphic gate attachment used by sections, playlists and menu items. */
export async function fetchSegmentables(
  session: SnapshotSession,
  hubId: number,
): Promise<LegacySegmentable[]> {
  return session.query<LegacySegmentable>(
    `SELECT sg.id, sg.segment_id, sg.segmentable_id, sg.segmentable_type
       FROM segmentables sg
      WHERE (sg.segmentable_type = ? AND sg.segmentable_id IN (
              SELECT id FROM sections WHERE hub_id = ? AND deleted_at IS NULL))
         OR (sg.segmentable_type = ? AND sg.segmentable_id IN (
              SELECT id FROM menu_items WHERE hub_id = ? AND deleted_at IS NULL))
         OR (sg.segmentable_type = ? AND sg.segmentable_id IN (
              SELECT id FROM playlists WHERE hub_id = ? AND deleted_at IS NULL))
      ORDER BY sg.id ASC`,
    [MORPH_SECTION, hubId, MORPH_MENU_ITEM, hubId, MORPH_PLAYLIST, hubId],
  );
}

export async function fetchReplicaLagSeconds(
  session: SnapshotSession,
): Promise<number | 'unavailable'> {
  try {
    const rows = await session.query<Record<string, unknown>>('SHOW REPLICA STATUS', []);
    const row = rows[0];
    if (!row) return 'unavailable';
    const value = row['Seconds_Behind_Source'] ?? row['Seconds_Behind_Master'];
    return typeof value === 'number' ? value : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * sections.type is validated server-side as `required|string` with no enum, so
 * the only way to close the list is to ask the replica. The extract command
 * records this and the mapper warns on any type the table does not cover.
 */
export async function distinctSectionTypes(
  session: SnapshotSession,
  hubId: number,
): Promise<string[]> {
  const rows = await session.query<{ type: string }>(
    `SELECT DISTINCT type FROM sections WHERE hub_id = ? AND deleted_at IS NULL ORDER BY type ASC`,
    [hubId],
  );
  return rows.map((r) => r.type);
}
