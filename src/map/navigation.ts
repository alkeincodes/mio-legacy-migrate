import type { Bundle } from '../extract/bundle.js';
import { MORPH_PAGE, MORPH_PLAYLIST } from '../extract/queries.js';
import type { PlanNavigation, PlanNavigationItem, PlanWarning } from './plan.js';
import { parseJsonObject } from '../extract/json.js';

const MAX_LABEL = 120;

/** Text nodes of a TipTap/ProseMirror document, joined; the legacy menu editor stores a url this way. */
function docText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  return (n.content ?? []).map(docText).join('');
}

/**
 * Legacy stores a menu link as settings.url, which is either a plain URL or a
 * TipTap document whose text is the URL; older rows use settings.link.url.
 */
export function menuItemHref(settings: Record<string, unknown>): string {
  const link = settings['link'] as Record<string, unknown> | undefined;
  if (typeof link?.['url'] === 'string') return link['url'].trim();
  const url = settings['url'];
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    return docText(JSON.parse(trimmed)).trim();
  } catch {
    return '';
  }
}

export function mapNavigation(
  bundle: Bundle,
  slugByPageId: Map<number, string>,
  /** Legacy page types by id; a discussions page becomes V3's typed discussions item. */
  pageTypeById: Map<number, string> = new Map(),
  /** Pages the plan leaves out; a menu item pointing at one is dropped (the discussions item stays, as V3's own). */
  excludedPageIds: Set<number> = new Set(),
  /**
   * The legacy header's built-in home entry (theme sections.header.menuWelcome),
   * which is not a menu row. Emitted first as a page item for the homepage; the
   * hub resolves a page item whose page is the homepage to the hub root.
   */
  home: { label: string; pageSlug: string } | null = null,
): { navigation: PlanNavigation; warnings: PlanWarning[] } {
  const warnings: PlanWarning[] = [];
  const navigation: PlanNavigation = { header: [], footer: [], mobile: [] };
  if (home) navigation.header.push({ type: 'page', label: home.label.slice(0, MAX_LABEL), pageSlugRef: home.pageSlug, position: 0 });

  const items = [...bundle.menuItems].sort((a, b) => a.position - b.position);
  for (const item of items) {
    if (item.hidden === 1) continue;
    const bucket = item.menu === 'footer' ? navigation.footer : navigation.header;

    let label = item.title ?? '';
    if (label.length > MAX_LABEL) {
      warnings.push({
        pageSlug: null,
        legacySectionId: null,
        type: 'approximated',
        reason: `navigation label for menu item ${item.id} was truncated to ${MAX_LABEL} characters, the V3 limit`,
      });
      label = label.slice(0, MAX_LABEL);
    }

    if (item.type === 'page' || item.model_type === MORPH_PAGE) {
      if (item.model_id !== null && pageTypeById.get(item.model_id) === 'discussions') {
        bucket.push({ type: 'discussions', label, position: bucket.length });
        continue;
      }
      if (item.model_id !== null && excludedPageIds.has(item.model_id)) {
        warnings.push({
          pageSlug: null,
          legacySectionId: null,
          type: 'excluded',
          reason: `navigation item "${label}" (menu item ${item.id}) points at excluded legacy page ${item.model_id}, a ${pageTypeById.get(item.model_id) ?? 'built-in'} surface V3 serves itself; dropped from navigation`,
        });
        continue;
      }
      const slug = item.model_id === null ? undefined : slugByPageId.get(item.model_id);
      if (!slug) {
        warnings.push({
          pageSlug: null,
          legacySectionId: null,
          type: 'approximated',
          reason: `navigation item ${item.id} points at legacy page ${String(item.model_id)}, which is not in the plan; dropped from navigation`,
        });
        continue;
      }
      bucket.push({ type: 'page', label, pageSlugRef: slug, position: bucket.length });
      continue;
    }

    // A playlist menu item: V3 navigation has page, url and discussions items only,
    // so it becomes a url item whose target apply resolves once the playlist exists.
    if (item.type === 'playlist' || item.model_type === MORPH_PLAYLIST) {
      const playlist = item.model_id === null ? undefined : bundle.playlists.find((p) => p.id === item.model_id);
      if (!playlist) {
        warnings.push({ pageSlug: null, legacySectionId: null, type: 'approximated', reason: `navigation item ${item.id} points at legacy playlist ${String(item.model_id)}, which is not in the bundle; dropped from navigation` });
        continue;
      }
      bucket.push({ type: 'url', label: (label || playlist.title).slice(0, MAX_LABEL), playlistRef: playlist.id, position: bucket.length });
      continue;
    }

    const href = menuItemHref(parseJsonObject(item.settings));
    if (!href) {
      warnings.push({
        pageSlug: null,
        legacySectionId: null,
        type: 'approximated',
        reason: `navigation item ${item.id} of type "${item.type}" carries no resolvable link; dropped from navigation`,
      });
      continue;
    }
    bucket.push({ type: 'url', label, href, position: bucket.length });
  }

  const renumber = (list: PlanNavigationItem[]): void => {
    list.forEach((entry, index) => { entry.position = index; });
  };
  renumber(navigation.header);
  renumber(navigation.footer);

  return { navigation, warnings };
}

/** The legacy header's home entry label (theme sections.header.menuWelcome.title), or "Home" when the theme has the entry without a title. */
export function homeMenuLabel(themeSettings: Record<string, unknown>): string | null {
  const header = ((themeSettings['sections'] as Record<string, unknown> | undefined)?.['header'] ?? {}) as Record<string, unknown>;
  const welcome = header['menuWelcome'];
  if (!welcome || typeof welcome !== 'object') return null;
  const title = (welcome as Record<string, unknown>)['title'];
  return typeof title === 'string' && title.trim() ? title.trim() : 'Home';
}
