import type { Bundle } from '../extract/bundle.js';
import { MORPH_FILE, type LegacyHub, type LegacyPage, type LegacySection } from '../extract/queries.js';
import type { CatalogNode } from './catalog.js';
import { parseJsonObject } from '../extract/json.js';
import { mapElement } from './elements.js';
import { nodeId } from './nodeId.js';
import type { PlanAccessRule, PlanPage, PlanWarning } from './plan.js';
import { mapSection, type MapContext } from './sections.js';
import { resolveGate } from './visibility.js';

/**
 * Page slugs the backend refuses with 422 page_slug_reserved because they
 * collide with built-in routes (mio-backend app/pages/service.py RESERVED_SLUGS).
 * Everything else must match ^[a-z0-9][a-z0-9_-]*$.
 */
const RESERVED_SLUGS = new Set([
  'access-denied', 'account', 'align', 'banned', 'discussions', 'editor-fixture', 'forgot', 'forgot-password', 'history', 'home', 'legal', 'login', 'members', 'messages', 'moderation', 'my-list', 'notifications', 'onboarding', 'payment', 'playlists', 'register', 'reset-password', 'search',
]);

export function slugFor(page: LegacyPage, taken: Set<string>): string {
  let base = (page.slug ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!base && page.title) {
    base = page.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if (!base) base = `page-${page.id}`;
  if (!/^[a-z0-9]/.test(base)) base = `page-${base}`;
  if (RESERVED_SLUGS.has(base)) base = `${base}-page`;

  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}-${n++}`;
  taken.add(candidate);
  return candidate;
}

const PAGE_TYPES: Record<string, string> = {
  page: 'generic',
  dashboard: 'homepage',
  login: 'login',
  register: 'register',
  onboarding: 'onboarding',
  discussions: 'discussions-index',
  // V3 has a content page type whose slug must be exactly "content" (content_page_slug_type_mismatch).
  content: 'content',
};

export function pageTypeFor(legacyType: string): string {
  return PAGE_TYPES[legacyType] ?? 'generic';
}

export function privacyFor(page: LegacyPage, hub: LegacyHub): 'public' | 'members' | 'private' {
  if (page.privacy === 'public' || page.privacy === 'members' || page.privacy === 'private') {
    return page.privacy;
  }
  return hub.auth === 1 ? 'members' : 'public';
}

export function mapPages(bundle: Bundle): {
  pages: PlanPage[];
  accessRules: PlanAccessRule[];
  warnings: PlanWarning[];
  renames: Array<{ legacySlug: string; slug: string; legacyPageId: number }>;
} {
  const warnings: PlanWarning[] = [];
  const accessRules: PlanAccessRule[] = [];
  const taken = new Set<string>();

  const mediaByFileId = new Map<number, number>();
  for (const media of bundle.media) {
    if (media.model_type === MORPH_FILE && !mediaByFileId.has(media.model_id)) {
      mediaByFileId.set(media.model_id, media.id);
    }
  }

  const themeSettings = parseJsonObject(bundle.theme?.settings);
  const themeColours = (themeSettings['colors'] ?? {}) as { primary?: string; secondary?: string };
  const assetByUrl = new Map(bundle.assets.map((a) => [a.cdnUrl, { legacyMediaId: a.legacyMediaId, variant: a.variant }]));

  const sectionsByParent = new Map<number, LegacySection[]>();
  const topLevelByPage = new Map<number, LegacySection[]>();
  for (const section of bundle.sections) {
    if (section.parent_id !== null) {
      sectionsByParent.set(section.parent_id, [...(sectionsByParent.get(section.parent_id) ?? []), section]);
    } else if (section.page_id !== null) {
      topLevelByPage.set(section.page_id, [...(topLevelByPage.get(section.page_id) ?? []), section]);
    }
  }
  const byPosition = (a: LegacySection, b: LegacySection): number => a.position - b.position;

  // Slug order, because legacy pages carry no ordering column.
  const ordered = [...bundle.pages].sort((a, b) => (a.slug ?? '') < (b.slug ?? '') ? -1 : 1);
  const pages: PlanPage[] = [];

  // Assign every slug first so a link to a renamed page can resolve while its tree is mapped.
  const slugByPage = new Map<number, string>();
  const slugByLegacySlug = new Map<string, string>();
  const renames: Array<{ legacySlug: string; slug: string; legacyPageId: number }> = [];
  for (const page of ordered) {
    let slug: string;
    if (pageTypeFor(page.type) === 'content') {
      // The backend pins the content page type to the slug "content" and vice versa.
      slug = 'content';
      taken.add(slug);
    } else {
      const wantsContent = page.slug === 'content' || (!page.slug && (page.title ?? '').trim().toLowerCase() === 'content');
      slug = slugFor(wantsContent ? { ...page, slug: 'content-page' } : page, taken);
    }
    slugByPage.set(page.id, slug);
    // A legacy page with no slug is addressed by its derived slug (title or type), so a
    // reserved name reached that way is a rename too.
    const legacySlug = page.slug ?? (slug.endsWith('-page') && RESERVED_SLUGS.has(slug.slice(0, -5)) ? slug.slice(0, -5) : slug);
    slugByLegacySlug.set(legacySlug, slug);
    if (legacySlug !== slug) renames.push({ legacySlug, slug, legacyPageId: page.id });
  }
  // A link to a slug V3 reserves for a built-in route (discussions, login, ...)
  // should reach that route, not the renamed legacy copy of the page.
  const resolvePageSlug = (legacySlug: string): string =>
    RESERVED_SLUGS.has(legacySlug) ? legacySlug : (slugByLegacySlug.get(legacySlug) ?? legacySlug);
  // By id: the built-in route for a page V3 replaces (discussions, login, register), else the migrated slug.
  const legacySlugByPage = new Map<number, string>();
  for (const [legacySlug, slug] of slugByLegacySlug) { const page = ordered.find((pg) => slugByPage.get(pg.id) === slug); if (page) legacySlugByPage.set(page.id, legacySlug); }
  const routeSlugById = (legacyPageId: number): string | null => {
    const legacySlug = legacySlugByPage.get(legacyPageId);
    if (legacySlug && RESERVED_SLUGS.has(legacySlug)) return legacySlug;
    return slugByPage.get(legacyPageId) ?? null;
  };

  for (const page of ordered) {
    const slug = slugByPage.get(page.id) ?? slugFor(page, taken);
    const restrictedSectionNodeIds: string[] = [];

    const ctx: MapContext = {
      legacyHubId: bundle.header.legacyHubId,
      legacyPageId: page.id,
      pageSlug: slug,
      childrenOf: (id) => (sectionsByParent.get(id) ?? []).slice().sort(byPosition),
      warn: (w) => warnings.push(w),
      resolvePageSlug,
      pageSlugById: routeSlugById,
      mediaIdForSection: (s) => (s.model_type === MORPH_FILE && s.model_id !== null ? mediaByFileId.get(s.model_id) ?? null : null),
      assetForUrl: (url) => assetByUrl.get(url) ?? null,
      themeColours,
      mapElement: (section, ordinal) =>
        mapElement(section, ordinal, {
          legacyHubId: bundle.header.legacyHubId,
          legacyPageId: page.id,
          pageSlug: slug,
          warn: (w) => warnings.push(w),
          hubOrigins: [
            `https://${bundle.header.legacyHubDomain}`,
            `http://${bundle.header.legacyHubDomain}`,
          ],
          assetForUrl: (url) => assetByUrl.get(url) ?? null,
          resolvePageSlug,
          pageSlugById: routeSlugById,
          mediaIdForSection: (s) =>
            s.model_type === MORPH_FILE && s.model_id !== null
              ? mediaByFileId.get(s.model_id) ?? null
              : null,
        }),
    };

    const children: CatalogNode[] = [];
    const tops = (topLevelByPage.get(page.id) ?? []).slice().sort(byPosition);
    tops.forEach((section, ordinal) => {
      const node = mapSection(section, ordinal, ctx);
      children.push(node);
      const gate = resolveGate({
        section,
        segmentables: bundle.segmentables,
        segments: bundle.segments,
        sectionNodeId: node.id ?? '',
      });
      if (gate.restricted) restrictedSectionNodeIds.push(node.id ?? '');
      if (gate.rule) accessRules.push(gate.rule);
      if (gate.unmappedReason) {
        warnings.push({
          pageSlug: slug,
          legacySectionId: section.id,
          type: 'access-unmapped',
          reason: gate.unmappedReason,
        });
      }
    });

    pages.push({
      legacyPageId: page.id,
      slug,
      title: page.title ?? slug,
      pageType: pageTypeFor(page.type),
      privacy: privacyFor(page, bundle.hub),
      isHomepage: page.is_homepage === 1,
      tree: {
        id: nodeId(bundle.header.legacyHubId, page.id, 0, 0),
        kind: 'stack',
        template: `page-${pageTypeFor(page.type)}`,
        children,
      },
      restrictedSectionNodeIds,
    });
  }

  return { pages, accessRules, warnings, renames };
}
