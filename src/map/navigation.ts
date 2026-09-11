import type { Bundle } from '../extract/bundle.js';
import { MORPH_PAGE } from '../extract/queries.js';
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
): { navigation: PlanNavigation; warnings: PlanWarning[] } {
  const warnings: PlanWarning[] = [];
  const navigation: PlanNavigation = { header: [], footer: [], mobile: [] };

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
