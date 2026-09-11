import type { Bundle } from '../extract/bundle.js';
import { MORPH_PAGE } from '../extract/queries.js';
import type { PlanNavigation, PlanNavigationItem, PlanWarning } from './plan.js';

const MAX_LABEL = 120;

export function mapNavigation(
  bundle: Bundle,
  slugByPageId: Map<number, string>,
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

    let href = '';
    try {
      const settings = JSON.parse(item.settings ?? '{}') as { link?: { url?: unknown } };
      if (typeof settings.link?.url === 'string') href = settings.link.url;
    } catch {
      href = '';
    }
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
