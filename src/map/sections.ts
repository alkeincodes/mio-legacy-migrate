import type { LegacySection } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import type { PlanWarning } from './plan.js';
import { lookupMapping } from './sectionTable.js';

export interface MapContext {
  legacyHubId: number;
  legacyPageId: number;
  pageSlug: string;
  childrenOf(sectionId: number): LegacySection[];
  warn(warning: PlanWarning): void;
  mapElement(section: LegacySection, ordinal: number): CatalogNode | null;
  /** The V3 slug for a legacy page slug, when the mapper renamed it. */
  resolvePageSlug?(legacySlug: string): string;
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

function sixDigitHex(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function surfaceFor(section: LegacySection, settings: Record<string, unknown>): Record<string, unknown> {
  const surface: Record<string, unknown> = {};
  const background = settings['background'] as Record<string, unknown> | undefined;
  if (background) {
    const colour = sixDigitHex(background['color']);
    const image = background['image'];
    const imageUrl = typeof image === 'string' ? image : (image as Record<string, unknown> | undefined)?.['url'];
    if (background['type'] === 'color' && colour) {
      surface['background'] = { type: 'custom-color', value: colour };
    } else if (background['type'] === 'image' && typeof imageUrl === 'string') {
      surface['background'] = { type: 'image', url: imageUrl, blur: background['blur'] === true };
    }
  }
  if (section.hidden === 1) surface['visibility'] = { hidden: true };
  return surface;
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
    const nodeSettings: Record<string, unknown> = {};
    if (typeof settings['size'] === 'string') nodeSettings['width'] = settings['size'];
    return { id, kind: 'stack', settings: nodeSettings, children };
  }

  if (block.type.endsWith('-playlist')) {
    return {
      id,
      kind: 'content-card',
      settings: { actionFromScope: 'action' },
      dataSource: { type: 'playlist', id: playlistRef(block.model_id ?? 0) },
      repeat: { over: 'dataSource' },
      children: [],
    };
  }

  if (block.type.endsWith('-file')) {
    return {
      id,
      kind: 'content-card',
      settings: { actionFromScope: 'action' },
      dataSource: { type: 'file', id: String(block.model_id ?? '') },
      children: [],
    };
  }

  if (block.type.endsWith('-page') || block.type.endsWith('-url') || block.type === 'carousel-cta') {
    const href = (settings['link'] as Record<string, unknown> | undefined)?.['url'];
    const action =
      block.type.endsWith('-page')
        ? { type: 'page', value: pageRef((ctx.resolvePageSlug ?? ((x: string) => x))(String(settings['slug'] ?? ''))) }
        : { type: 'url', value: typeof href === 'string' ? href : '' };
    return {
      id,
      kind: 'content-card',
      settings: {},
      children: [
        {
          id: nodeId(ctx.legacyHubId, ctx.legacyPageId, block.id, ordinal + 1000),
          kind: 'button',
          value: block.title ?? 'Open',
          settings: { action, variant: 'primary' },
        },
      ],
    };
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
  return { id, kind: 'stack', settings: {}, children };
}

export function mapSection(section: LegacySection, ordinal: number, ctx: MapContext): CatalogNode {
  const id = nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, ordinal);
  const settings = parseSettings(section.settings);
  const mapping = lookupMapping(section.type, 'section');

  if (!mapping) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: section.id,
      type: 'approximated',
      reason: `no mapping for legacy section type "${section.type}"; emitted a row holding its title as text`,
    });
    return {
      id,
      kind: 'container',
      template: 'row',
      settings: { surface: surfaceFor(section, settings) },
      children: [
        {
          id: nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, ordinal + 1),
          kind: 'text',
          value: section.title ?? section.label ?? '',
        },
      ],
    };
  }

  if (mapping.approximated) {
    ctx.warn({
      pageSlug: ctx.pageSlug,
      legacySectionId: section.id,
      type: 'approximated',
      reason: `legacy section type "${section.type}": ${mapping.notes}`,
    });
  }

  const children = ctx
    .childrenOf(section.id)
    .map((child, i) =>
      lookupMapping(child.type, 'block') || child.type === 'column'
        ? blockNode(child, i, ctx)
        : ctx.mapElement(child, i),
    )
    .filter((n): n is CatalogNode => n !== null);

  const nodeSettings: Record<string, unknown> = { surface: surfaceFor(section, settings) };
  if (mapping.template === 'row' && section.type === 'cta') nodeSettings['variant'] = 'cta-band';

  return { id, kind: mapping.rootKind, template: mapping.template ?? undefined, settings: nodeSettings, children };
}
