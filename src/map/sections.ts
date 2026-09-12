import { readFileSync } from 'node:fs';
import type { LegacySection } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import type { PlanWarning } from './plan.js';
import { lookupMapping } from './sectionTable.js';
import { docToText, parseDoc } from './tiptap.js';
import { instantiateRecipe } from './style.js';
import { columnProfile, sectionProfile } from './profile/section.js';
import { elementProfile } from './profile/element.js';
import { DEFAULT_HUB_PROFILE } from './profile/hub.js';
import type { ButtonProfile, HubStyleProfile } from './profile/types.js';
import { fidelityWarning } from './translate/fidelity.js';
import { buttonSettings } from './translate/leaf.js';
import { columnStack, type PlacedElement } from './translate/stack.js';
import { LAYOUT_ROW_SETTINGS, columnSurface, sectionSurface } from './translate/surface.js';

/** A card or featured-band button is catalog chrome; it takes the hub's button profile with no legacy overrides. */
function hubButtonProfile(hub: HubStyleProfile): ButtonProfile {
  return { kind: 'button', align: 'left', marginTop: 0, bottomMargin: 0, chrome: hub.button, fullWidth: false, colours: null };
}

export interface MapContext {
  legacyHubId: number;
  legacyPageId: number;
  pageSlug: string;
  childrenOf(sectionId: number): LegacySection[];
  warn(warning: PlanWarning): void;
  mapElement(section: LegacySection, ordinal: number, extra?: { columnContentWidth?: number }): CatalogNode | null;
  /** The hub theme's style profile; defaults to the SCSS base. */
  hubProfile?: HubStyleProfile;
  /** The button background the hub primary was set to. */
  dominantButtonBackground?: string | null;
  /** The V3 slug for a legacy page slug, when the mapper renamed it. */
  resolvePageSlug?(legacySlug: string): string;
  /** The V3 slug of a legacy page by id, for cards whose target is a page row. */
  pageSlugById?(legacyPageId: number): string | null;
  /** The legacy media id behind a section that links a File. */
  mediaIdForSection?(section: LegacySection): number | null;
  /** The manifest entry behind a legacy CDN URL, for card and section images. */
  assetForUrl?(url: string): { legacyMediaId: number; variant: string } | null;
  /** The legacy theme colours, so a 'secondary-color' background carries the real hex. */
  themeColours?: { primary?: string; secondary?: string };
}

export function assetRef(legacyMediaId: number, variant: string): string {
  return `ledger://asset/${legacyMediaId}/${variant}`;
}

export function playlistRef(legacyPlaylistId: number): string {
  return `ledger://playlist/${legacyPlaylistId}`;
}

export function pageRef(slug: string): string {
  return slug;
}

function parseSettings(raw: unknown): Record<string, unknown> {
  return parseJsonObject(raw);
}

/** The catalog's own section recipes (mio pages catalog scaffold), ids stripped; ids are minted per section. */
const RECIPES: Record<string, CatalogNode> = Object.fromEntries(
  ['grid-playlist', 'compact-playlist', 'hero-file', 'hero-playlist'].map((name) => [
    name,
    JSON.parse(readFileSync(new URL(`./recipes/${name}.json`, import.meta.url), 'utf8')) as CatalogNode,
  ]),
);

/** Ordinals above this are recipe-minted node ids, so they never collide with child ordinals. */
const RECIPE_ORDINAL_BASE = 5000;
const EXTRA_ORDINAL_BASE = 1000;

function recipe(name: string, ctx: MapContext, sectionId: number): CatalogNode {
  const template = RECIPES[name];
  if (!template) throw new Error(`no vendored recipe named ${name}`);
  return instantiateRecipe(template, (ordinal) => nodeId(ctx.legacyHubId, ctx.legacyPageId, sectionId, RECIPE_ORDINAL_BASE + ordinal));
}

/** Binds every dataSource in a recipe to one playlist reference. */
function bindPlaylist(node: CatalogNode, ref: string): CatalogNode {
  if (node.dataSource?.type === 'playlist') node.dataSource = { ...node.dataSource, id: ref };
  for (const child of node.children ?? []) bindPlaylist(child, ref);
  return node;
}

function cardLink(block: LegacySection, settings: Record<string, unknown>, ctx: MapContext): { label: string; action: { type: string; value: string } } {
  const link = settings['link'] as Record<string, unknown> | undefined;
  const urlDoc = parseDoc(link?.['url']);
  const href = urlDoc ? docToText(urlDoc) : typeof link?.['url'] === 'string' ? link['url'].trim() : '';
  const label = typeof link?.['label'] === 'string' && link['label'].trim() ? link['label'].trim() : block.title ?? 'Open';
  if (block.type.endsWith('-page')) {
    const byId = block.model_id === null ? null : (ctx.pageSlugById?.(block.model_id) ?? null);
    const bySlug = typeof settings['slug'] === 'string' && settings['slug'] ? (ctx.resolvePageSlug ?? ((x: string) => x))(settings['slug']) : '';
    const slug = byId ?? bySlug;
    if (!slug) ctx.warn({ pageSlug: ctx.pageSlug, legacySectionId: block.id, type: 'approximated', reason: `page card "${label}" has no resolvable page target` });
    return { label, action: { type: 'page', value: slug ? `/${pageRef(slug)}` : '' } };
  }
  return { label, action: { type: 'url', value: href } };
}

/** The picture a legacy card shows: its own thumbnail, else its background image. */
function cardImage(settings: Record<string, unknown>, ctx: MapContext): string | null {
  const thumb = (settings['thumbnail'] as Record<string, unknown> | undefined)?.['url'];
  const background = settings['background'] as Record<string, unknown> | undefined;
  const image = background?.['image'];
  const bgUrl = typeof image === 'string' ? image : (image as Record<string, unknown> | undefined)?.['url'];
  const url = typeof thumb === 'string' && thumb ? thumb : typeof bgUrl === 'string' ? bgUrl : null;
  if (!url) return null;
  const asset = ctx.assetForUrl?.(url) ?? null;
  return asset ? assetRef(asset.legacyMediaId, asset.variant) : url;
}

function blockNode(block: LegacySection, ordinal: number, ctx: MapContext, siblingCount = 1): CatalogNode {
  const id = nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal);
  const settings = parseSettings(block.settings);
  const mapping = lookupMapping(block.type, 'block');

  if (mapping?.approximated) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: block.id,
      type: 'approximated',
      reason: `legacy block type "${block.type}": ${mapping.notes}`,
    });
  }

  if (block.type === 'column') {
    const hub = ctx.hubProfile ?? DEFAULT_HUB_PROFILE;
    const profile = columnProfile(settings, siblingCount);
    // Content width of this column at V3's 1240px cap, less the 20px gutter.
    const columnContentWidth = Math.round((1240 * profile.widthPct) / 100) - 20;
    const elements: PlacedElement[] = [];
    ctx.childrenOf(block.id).forEach((child, i) => {
      const node = ctx.mapElement(child, i, { columnContentWidth });
      if (node) elements.push({ node, profile: elementProfile(child, hub), legacyId: child.id });
    });
    return columnStack({
      id,
      profile,
      elements,
      surface: columnSurface(profile, settings, ctx.themeColours ?? {}),
      mintId: (legacyId, n) => nodeId(ctx.legacyHubId, ctx.legacyPageId, legacyId, EXTRA_ORDINAL_BASE + n),
    });
  }

  if (block.type.endsWith('-playlist')) {
    // Legacy carousel and search list a playlist's files (Carousel.vue, Search.vue);
    // every other playlist block is a tile for the playlist itself.
    if (block.type !== 'carousel-playlist' && block.type !== 'search-playlist') return playlistTile(block, ordinal, ctx);
    return {
      id,
      kind: 'content-card',
      template: 'content-card',
      settings: { actionFromScope: 'action' },
      dataSource: { type: 'playlist', id: playlistRef(block.model_id ?? 0) },
      repeat: { over: 'dataSource' },
      children: [
        { id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE), kind: 'media-slot', settings: { aspectRatio: '16:9', name: 'cover', outline: true, radius: 'm' } },
        { id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE + 1), kind: 'field', settings: { name: 'title', role: 'title', size: 'body', weight: 700 } },
      ],
    };
  }

  if (block.type.endsWith('-file')) {
    const mediaId = ctx.mediaIdForSection?.(block) ?? null;
    if (mediaId === null) {
      ctx.warn({ pageSlug: ctx.pageSlug, legacySectionId: block.id, type: 'asset-pending', reason: `file card for legacy file ${String(block.model_id)} has no media in the bundle; emitted without a data source` });
    }
    return {
      id,
      kind: 'content-card',
      template: 'content-card',
      settings: { actionFromScope: 'action' },
      ...(mediaId === null ? {} : { dataSource: { type: 'file', id: assetRef(mediaId, 'original') } }),
      children: [
        { id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE), kind: 'media-slot', settings: { aspectRatio: '16:9', name: 'cover', outline: true, radius: 'm' } },
        { id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE + 1), kind: 'field', settings: { name: 'title', role: 'title', size: 'body', weight: 700 } },
      ],
    };
  }

  if (block.type.endsWith('-page') || block.type.endsWith('-url') || block.type === 'carousel-cta') {
    // A legacy card is a picture with a link over it; the title is usually hidden.
    const { label, action } = cardLink(block, settings, ctx);
    const image = cardImage(settings, ctx);
    const link = settings['link'] as Record<string, unknown> | undefined;
    const children: CatalogNode[] = [];
    if (image) {
      children.push({
        id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE),
        kind: 'image',
        value: image,
        settings: { alt: label, aspectRatio: '16:9', objectFit: 'cover', radius: 'm' },
      });
    }
    // Card buttons are catalog chrome, not legacy buttons; their chrome entry would double-count, so it is not reported.
    const cardButton = buttonSettings(hubButtonProfile(ctx.hubProfile ?? DEFAULT_HUB_PROFILE), settings, action, link?.['newTab'] === true);
    children.push({
      id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE + 1),
      kind: 'button',
      value: label,
      settings: cardButton.settings,
    });
    return { id, kind: 'content-card', template: 'content-card', settings: { surface: { borderRadius: 'md' } }, children };
  }

  if (!mapping) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: block.id,
      type: 'approximated',
      reason: `no mapping for legacy block type "${block.type}"; emitted a stack with its children`,
    });
  }
  const children = ctx
    .childrenOf(block.id)
    .map((child, i) => ctx.mapElement(child, i))
    .filter((n): n is CatalogNode => n !== null);
  return { id, kind: 'stack', settings: { gap: 4, width: 'full' }, children };
}

/**
 * One legacy playlist tile (CustomGridBlock.vue: thumbnail and title linking to
 * the playlist) in the catalog's scroll/grid card shape. The card binds the
 * playlist WITHOUT repeat, so V3 resolves the collection scope (the playlist's
 * own title, cover and click-through, mio-hub renderer.tsx DataBoundContainer).
 */
function playlistTile(block: LegacySection, ordinal: number, ctx: MapContext): CatalogNode {
  const mint = (n: number): string => nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE + n);
  return {
    id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal),
    kind: 'content-card',
    template: 'content-card',
    settings: { actionFromScope: 'action' },
    dataSource: { type: 'playlist', id: playlistRef(block.model_id ?? 0) },
    children: [
      { id: mint(0), kind: 'media-slot', settings: { name: 'cover', aspectRatio: '16:9', radius: 'm', outline: true } },
      { id: mint(1), kind: 'stack', settings: { gap: 0.5 }, children: [
        { id: mint(2), kind: 'field', settings: { name: 'title', role: 'title', size: 'body', weight: 700 } },
      ] },
    ],
  };
}

/** The section container every catalog recipe starts with. */
function sectionContainer(id: string, template: string, surface: Record<string, unknown>, children: CatalogNode[], extra: Partial<CatalogNode> = {}): CatalogNode {
  return {
    id,
    kind: 'container',
    template,
    settings: { maxWidth: 'content', padding: 0, surface },
    ...extra,
    children,
  };
}

/** The legacy "featured" band: a title, a rich description and one button, in the catalog's hero shape. */
function featuredSection(section: LegacySection, id: string, settings: Record<string, unknown>, surface: Record<string, unknown>, ctx: MapContext): CatalogNode {
  const mint = (n: number): string => nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, EXTRA_ORDINAL_BASE + n);
  const titleDoc = parseDoc(section.title);
  const descriptionDoc = parseDoc(settings['description']);
  const buttonLabel = typeof settings['buttonLabel'] === 'string' ? settings['buttonLabel'].trim() : '';
  const stack: CatalogNode[] = [
    { id: mint(1), kind: 'headline', value: titleDoc ? docToText(titleDoc) : section.title ?? '', settings: { level: 2, weight: 700, align: 'left' } },
  ];
  if (descriptionDoc) stack.push({ id: mint(2), kind: 'text', value: docToText(descriptionDoc), settings: { align: 'left', marginBottom: 0 } });
  if (buttonLabel) {
    const action = section.model_type?.endsWith('Playlist') && section.model_id !== null
      ? { type: 'page', value: playlistRef(section.model_id) }
      : section.model_type?.endsWith('Page') && section.model_id !== null
        ? { type: 'page', value: `/${ctx.pageSlugById?.(section.model_id) ?? ''}` }
        : { type: 'url', value: '' };
    const featuredButton = buttonSettings(hubButtonProfile(ctx.hubProfile ?? DEFAULT_HUB_PROFILE), settings, action, false);
    for (const entry of featuredButton.fidelity) ctx.warn(fidelityWarning(entry, ctx.pageSlug, section.id));
    stack.push({ id: mint(3), kind: 'button', value: buttonLabel, settings: featuredButton.settings });
  }
  const image = cardImage(settings, ctx);
  const rowChildren: CatalogNode[] = [];
  if (image) rowChildren.push({ id: mint(4), kind: 'image', value: image, settings: { alt: '', aspectRatio: 'auto', objectFit: 'contain', radius: 'm' } });
  // Legacy stacks the featured title, description and button 20px apart; 5 is 20px.
  rowChildren.push({ id: mint(5), kind: 'stack', settings: { align: 'start', gap: 5 }, children: stack });
  return sectionContainer(id, 'hero', surface, [
    { id: mint(0), kind: 'row', settings: { gap: 'section', responsive: true, split: image !== null }, children: rowChildren },
  ]);
}

export function mapSection(section: LegacySection, ordinal: number, ctx: MapContext): CatalogNode {
  const id = nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, ordinal);
  const settings = parseSettings(section.settings);
  const mapping = lookupMapping(section.type, 'section');
  const { surface, fidelity } = sectionSurface(sectionProfile(settings, ctx.themeColours?.secondary), settings, section.hidden === 1, ctx.themeColours ?? {});
  for (const entry of fidelity) ctx.warn(fidelityWarning(entry, ctx.pageSlug, section.id));
  const mint = (n: number): string => nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, EXTRA_ORDINAL_BASE + n);

  if (!mapping) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: section.id,
      type: 'approximated',
      reason: `no mapping for legacy section type "${section.type}"; emitted a row holding its title as text`,
    });
    return sectionContainer(id, 'row', surface, [
      { id: mint(0), kind: 'text', value: section.title ?? section.label ?? '' },
    ]);
  }

  if (mapping.approximated) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: section.id,
      type: 'approximated',
      reason: `legacy section type "${section.type}": ${mapping.notes}`,
    });
  }

  if (section.type === 'featured') return featuredSection(section, id, settings, surface, ctx);

  const legacyChildren = ctx.childrenOf(section.id);
  const playlistBlocks = legacyChildren.filter((c) => c.type.endsWith('-playlist') && c.model_id !== null);
  const titleDoc = parseDoc(section.title);
  const titleShown = (settings['title'] as Record<string, unknown> | undefined)?.['show'] !== false;
  const titleText = titleDoc ? docToText(titleDoc) : (section.title ?? '');
  const titleNode: CatalogNode | null = titleShown && titleText
    ? { id: mint(9), kind: 'headline', value: titleText, settings: { level: 2, weight: 700 } }
    : null;
  // Legacy grid, scroll and content-grid sections draw one tile per block
  // (Grid.vue, Scroll.vue, ContentGrid.vue via CustomGridBlock); compact,
  // playlist, recently-watched and carousel list one playlist's files.
  const drawsTiles = section.type === 'grid' || section.type === 'scroll' || section.type === 'content-grid';

  // A strip of one playlist's files takes the catalog's own data-bound recipe.
  if (playlistBlocks.length > 0 && !drawsTiles && (mapping.template === 'grid' || mapping.template === 'compact' || mapping.template === 'carousel' || mapping.template === 'content-grid')) {
    const recipeName = mapping.template === 'compact' ? 'compact-playlist' : 'grid-playlist';
    if (playlistBlocks.length === 1) {
      const node = bindPlaylist(recipe(recipeName, ctx, section.id), playlistRef(playlistBlocks[0]!.model_id!));
      node.id = id;
      node.settings = { ...(node.settings ?? {}), surface: { ...((node.settings?.['surface'] as Record<string, unknown>) ?? {}), ...surface } };
      if (titleNode) node.children = [titleNode, ...(node.children ?? [])];
      return node;
    }
    // Several playlists in one legacy grid: one card per playlist inside a responsive grid.
    const cards = playlistBlocks.map((block, i) => blockNode(block, i, ctx));
    return sectionContainer(id, mapping.template, surface, [
      ...(titleNode ? [titleNode] : []),
      { id: mint(0), kind: 'grid', settings: { variant: 'responsive' }, children: cards },
    ]);
  }

  // Tiles in legacy order: playlists, pages, urls, files and ctas side by side,
  // laid out as the catalog's Scroll (compact) and Grid starters do: a stack of
  // the title and the strip or grid.
  const cardBlocks = legacyChildren.filter((c) => /-(url|page|file|cta)$/.test(c.type) || (c.type.endsWith('-playlist') && c.model_id !== null));
  if (cardBlocks.length > 0 && (mapping.template === 'grid' || mapping.template === 'compact' || mapping.template === 'carousel' || mapping.template === 'content-grid')) {
    const cards = cardBlocks.map((block, i) => blockNode(block, i, ctx));
    const wrap: CatalogNode = mapping.template === 'compact'
      ? { id: mint(0), kind: 'horizontal-scroll', settings: { itemWidth: 'card' }, children: cards }
      : { id: mint(0), kind: 'grid', settings: { variant: 'responsive' }, children: cards };
    return sectionContainer(id, mapping.template, surface, [
      { id: mint(1), kind: 'stack', settings: { gap: 6 }, children: [...(titleNode ? [titleNode] : []), wrap] },
    ]);
  }

  // Everything else is columns of elements: the catalog's row recipe.
  const columns = legacyChildren
    .map((child, i) =>
      lookupMapping(child.type, 'block') || child.type === 'column'
        ? blockNode(child, i, ctx, legacyChildren.length)
        : ctx.mapElement(child, i),
    )
    .filter((n): n is CatalogNode => n !== null);
  const layout: CatalogNode = { id: mint(0), kind: 'row', settings: { ...LAYOUT_ROW_SETTINGS }, children: columns };
  return sectionContainer(id, mapping.template ?? 'row', surface, [layout]);
}
