export interface SectionMapping {
  legacyType: string;
  level: 'section' | 'block';
  /** The catalog template a level-1 section node carries. Null for blocks. */
  template: string | null;
  rootKind: string;
  /** True when the mapping loses fidelity and must raise an `approximated` warning. */
  approximated: boolean;
  reviewed: 'yes' | 'no';
  reviewer: string;
  notes: string;
}

/**
 * Legacy types come from the Vue renderer registries in searchie:
 *   level 1  resources/modules/hub/js/Components/Section/List.vue:121,184-195
 *   level 2  resources/2.0/js/modules/Hubs/Editor/Pages/Sidebar/Blocks/Type.vue:72-95
 * `extract` records the real list in bundle.header.distinctSectionTypes; any type
 * present there and absent here falls through to the row+text fallback with an
 * `approximated` warning, and should then be added to this table and reviewed.
 */
export const SECTION_TABLE: SectionMapping[] = [
  { legacyType: 'featured', level: 'section', template: 'hero', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'legacy featured is the hero band; catalog hero compiles to section type feature' },
  { legacyType: 'row', level: 'section', template: 'row', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match; column children become stack children with a width setting' },
  { legacyType: 'grid', level: 'section', template: 'grid', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match' },
  { legacyType: 'carousel', level: 'section', template: 'carousel', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match' },
  { legacyType: 'content-grid', level: 'section', template: 'content-grid', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match' },
  { legacyType: 'search', level: 'section', template: 'search-bar', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match' },
  { legacyType: 'compact', level: 'section', template: 'compact', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'direct match' },
  { legacyType: 'scroll', level: 'section', template: 'compact', rootKind: 'container', approximated: false, reviewed: 'no', reviewer: '', notes: 'catalog labels the compact template "Scroll"; same horizontal strip' },
  { legacyType: 'playlist', level: 'section', template: 'compact', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'legacy type retired by ConvertPlaylistSectionIntoScrollSection; old rows may survive' },
  { legacyType: 'cta', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'no cta template; row with the cta-band variant is the nearest shape' },
  { legacyType: 'cta-grid', level: 'section', template: 'grid', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'grid of cta cards; buttons survive, the cta chrome does not' },
  { legacyType: 'recently-watched', level: 'section', template: 'compact', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'needs a content dataSource V3 resolves at runtime; the legacy list is not portable' },
  { legacyType: 'text', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'v1-only legacy section; wraps its content in a row' },
  { legacyType: 'image', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'v1-only legacy section; wraps its content in a row' },
  { legacyType: 'onboarding-step', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'V3 onboarding is a page type with its own template; content is carried, chrome is not' },
  { legacyType: 'login', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'V3 renders the login form itself; only surrounding copy is carried' },
  { legacyType: 'register', level: 'section', template: 'row', rootKind: 'container', approximated: true, reviewed: 'no', reviewer: '', notes: 'V3 renders the register form itself; only surrounding copy is carried' },

  { legacyType: 'column', level: 'block', template: null, rootKind: 'stack', approximated: false, reviewed: 'no', reviewer: '', notes: 'row children; legacy settings.size becomes stack settings.width' },
  { legacyType: 'grid-playlist', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to a playlist dataSource, repeated' },
  { legacyType: 'carousel-playlist', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to a playlist dataSource, repeated' },
  { legacyType: 'content-grid-playlist', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to a playlist dataSource, repeated' },
  { legacyType: 'search-playlist', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to a playlist dataSource, repeated' },
  { legacyType: 'grid-file', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to one file' },
  { legacyType: 'carousel-file', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card bound to one file' },
  { legacyType: 'grid-page', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card whose button action is a page action' },
  { legacyType: 'carousel-page', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card whose button action is a page action' },
  { legacyType: 'grid-url', level: 'block', template: null, rootKind: 'content-card', approximated: false, reviewed: 'no', reviewer: '', notes: 'content-card whose button action is a url action' },
  { legacyType: 'carousel-cta', level: 'block', template: null, rootKind: 'content-card', approximated: true, reviewed: 'no', reviewer: '', notes: 'cta card; the button survives, the cta styling does not' },
];

export function lookupMapping(
  legacyType: string,
  level: 'section' | 'block',
): SectionMapping | null {
  return SECTION_TABLE.find((m) => m.legacyType === legacyType && m.level === level) ?? null;
}
