import { readFileSync } from 'node:fs';
import type { LegacySection } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import type { PlanWarning } from './plan.js';
import { lookupMapping } from './sectionTable.js';
import { docToText, parseDoc } from './tiptap.js';
import {
  buttonSettingsFor, columnSurfaceFor, instantiateRecipe, layoutRowSettings, sectionSurfaceFor, stackWidthFor,
} from './style.js';

export interface MapContext {
  legacyHubId: number;
  legacyPageId: number;
  pageSlug: string;
  childrenOf(sectionId: number): LegacySection[];
  warn(warning: PlanWarning): void;
  mapElement(section: LegacySection, ordinal: number): CatalogNode | null;
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

function blockNode(block: LegacySection, ordinal: number, ctx: MapContext): CatalogNode {
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
    const children = ctx
      .childrenOf(block.id)
      .map((child, i) => ctx.mapElement(child, i))
      .filter((n): n is CatalogNode => n !== null);
    const styles = settings['styles'] as Record<string, unknown> | undefined;
    const nodeSettings: Record<string, unknown> = { gap: 4, width: stackWidthFor(settings['size']) };
    if (styles?.['align'] === 'center') nodeSettings['align'] = 'center';
    const surface = columnSurfaceFor(settings, ctx.themeColours ?? {});
    if (surface) nodeSettings['surface'] = surface;
    return { id, kind: 'stack', settings: nodeSettings, children };
  }

  if (block.type.endsWith('-playlist')) {
    // Playlist cards are data-bound at the section level (see mapSection); a lone block still binds a card.
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
    children.push({
      id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + EXTRA_ORDINAL_BASE + 1),
      kind: 'button',
      value: label,
      settings: buttonSettingsFor(settings, action, link?.['newTab'] === true),
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
    { id: mint(1), kind: 'headline', value: titleDoc ? docToText(titleDoc) : section.title ?? '', settings: { level: 2, weight: 700, size: 'large-title' } },
  ];
  if (descriptionDoc) stack.push({ id: mint(2), kind: 'text', value: docToText(descriptionDoc), settings: { marginBottom: 4 } });
  if (buttonLabel) {
    const action = section.model_type?.endsWith('Playlist') && section.model_id !== null
      ? { type: 'page', value: playlistRef(section.model_id) }
      : section.model_type?.endsWith('Page') && section.model_id !== null
        ? { type: 'page', value: `/${ctx.pageSlugById?.(section.model_id) ?? ''}` }
        : { type: 'url', value: '' };
    stack.push({ id: mint(3), kind: 'button', value: buttonLabel, settings: { action, variant: 'primary', size: 'lg' } });
  }
  const image = cardImage(settings, ctx);
  const rowChildren: CatalogNode[] = [];
  if (image) rowChildren.push({ id: mint(4), kind: 'image', value: image, settings: { alt: '', aspectRatio: 'auto', objectFit: 'contain', radius: 'm' } });
  rowChildren.push({ id: mint(5), kind: 'stack', settings: { align: 'start', gap: 2 }, children: stack });
  return sectionContainer(id, 'hero', surface, [
    { id: mint(0), kind: 'row', settings: { gap: 'section', responsive: true, split: image !== null }, children: rowChildren },
  ]);
}

export function mapSection(section: LegacySection, ordinal: number, ctx: MapContext): CatalogNode {
  const id = nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, ordinal);
  const settings = parseSettings(section.settings);
  const mapping = lookupMapping(section.type, 'section');
  const surface = sectionSurfaceFor(settings, section.hidden === 1, ctx.themeColours ?? {});
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

  // A grid or strip of playlists takes the catalog's own data-bound recipe, one per playlist.
  if (playlistBlocks.length > 0 && (mapping.template === 'grid' || mapping.template === 'compact' || mapping.template === 'carousel' || mapping.template === 'content-grid')) {
    const recipeName = mapping.template === 'compact' ? 'compact-playlist' : 'grid-playlist';
    const titleDoc = parseDoc(section.title);
    const titleShown = (settings['title'] as Record<string, unknown> | undefined)?.['show'] !== false;
    const titleText = titleDoc ? docToText(titleDoc) : (section.title ?? '');
    const titleNode: CatalogNode | null = titleShown && titleText
      ? { id: mint(9), kind: 'headline', value: titleText, settings: { level: 2, weight: 700 } }
      : null;
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

  const cardBlocks = legacyChildren.filter((c) => /-(url|page|file|cta)$/.test(c.type));
  if (cardBlocks.length > 0 && (mapping.template === 'grid' || mapping.template === 'compact' || mapping.template === 'carousel' || mapping.template === 'content-grid')) {
    const cards = cardBlocks.map((block, i) => blockNode(block, i, ctx));
    const wrap: CatalogNode = mapping.template === 'compact'
      ? { id: mint(0), kind: 'horizontal-scroll', settings: { itemWidth: 'card' }, children: cards }
      : { id: mint(0), kind: 'grid', settings: { variant: 'responsive' }, children: cards };
    return sectionContainer(id, mapping.template, surface, [wrap]);
  }

  // Everything else is columns of elements: the catalog's row recipe.
  const columns = legacyChildren
    .map((child, i) =>
      lookupMapping(child.type, 'block') || child.type === 'column'
        ? blockNode(child, i, ctx)
        : ctx.mapElement(child, i),
    )
    .filter((n): n is CatalogNode => n !== null);
  const layout: CatalogNode = { id: mint(0), kind: 'row', settings: layoutRowSettings(columns.length), children: columns };
  return sectionContainer(id, mapping.template ?? 'row', surface, [layout]);
}
