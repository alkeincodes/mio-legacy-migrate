import type { LegacySection } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import type { PlanWarning } from './plan.js';
import { assetRef } from './sections.js';

export interface ElementContext {
  legacyHubId: number;
  legacyPageId: number;
  pageSlug: string;
  warn(warning: PlanWarning): void;
  /** The legacy media id backing a section that references a File, or null. */
  mediaIdForSection(section: LegacySection): number | null;
  /** Origins that count as this hub, so a link to them becomes a page action. */
  hubOrigins?: string[];
}

function parseSettings(raw: unknown): Record<string, unknown> {
  return parseJsonObject(raw);
}

/** Legacy headline sizes; the editor collapses subHeadline into headline + size medium. */
function headlineLevel(size: unknown): number {
  if (size === 'medium') return 3;
  if (size === 'small') return 4;
  return 2;
}

/**
 * A link that points at this hub's own origin becomes a page action with a
 * root-relative path, which V3 passes through unscoped. Everything else stays a
 * url action.
 */
function actionFor(url: string, hubOrigins: string[]): { type: string; value: string } {
  for (const origin of hubOrigins) {
    if (url.startsWith(origin)) {
      const path = url.slice(origin.length) || '/';
      return { type: 'page', value: path.startsWith('/') ? path : `/${path}` };
    }
  }
  return { type: 'url', value: url };
}

const HUB_ORIGINS = ['https://alliance.mantalks.com', 'http://alliance.mantalks.com'];

export function mapElement(
  section: LegacySection,
  ordinal: number,
  ctx: ElementContext,
): CatalogNode | null {
  if (section.hidden === 1) return null;

  const id = nodeId(ctx.legacyHubId, ctx.legacyPageId, section.id, ordinal);
  const settings = parseSettings(section.settings);
  const content = section.label ?? section.title ?? '';

  switch (section.type) {
    case 'headline': {
      const out: Record<string, unknown> = { level: headlineLevel(settings['size']) };
      if (typeof settings['align'] === 'string') out['align'] = settings['align'];
      return { id, kind: 'headline', value: content, settings: out };
    }

    case 'text': {
      const out: Record<string, unknown> = {};
      if (typeof settings['align'] === 'string') out['align'] = settings['align'];
      return { id, kind: 'text', value: content, settings: out };
    }

    case 'image': {
      const mediaId = ctx.mediaIdForSection(section);
      const out: Record<string, unknown> = { alt: section.title ?? '' };
      if (settings['align'] === 'center') out['alignX'] = 'center';
      return {
        id,
        kind: 'image',
        value: mediaId === null ? '' : assetRef(mediaId, 'original'),
        settings: out,
      };
    }

    case 'video': {
      const mediaId = ctx.mediaIdForSection(section);
      return {
        id,
        kind: 'video',
        value: mediaId === null ? '' : assetRef(mediaId, 'original'),
        settings: { embed_type: 'native', controls: true },
      };
    }

    case 'icon': {
      const size = Number(settings['size']);
      const out: Record<string, unknown> = {};
      if (Number.isFinite(size)) out['size'] = size;
      return { id, kind: 'icon', value: content, settings: out };
    }

    case 'button': {
      const link = settings['link'] as Record<string, unknown> | undefined;
      const url = typeof link?.['url'] === 'string' ? link['url'] : '';
      return {
        id,
        kind: 'button',
        value: content || 'Open',
        settings: {
          action: actionFor(url, ctx.hubOrigins ?? HUB_ORIGINS),
          variant: 'primary',
          newTab: link?.['newTab'] === true,
        },
      };
    }

    case 'line-break':
      return { id, kind: 'divider', settings: {} };

    case 'input': {
      ctx.warn({
        pageSlug: ctx.pageSlug,
        legacySectionId: section.id,
        type: 'approximated',
        reason:
          'legacy element type "input" has no catalog node kind; emitted its label as text. V3 renders login and register forms itself',
      });
      return { id, kind: 'text', value: content, settings: {} };
    }

    case 'embed-code': {
      const src = (settings['embed'] as Record<string, unknown> | undefined)?.['src'];
      if (typeof src === 'string' && /^https:\/\//.test(src)) {
        ctx.warn({
          pageSlug: ctx.pageSlug,
          legacySectionId: section.id,
          type: 'approximated',
          reason: `legacy embed-code became an iframe video node; V3 only renders allowlisted embed hosts, so verify ${src} renders`,
        });
        return { id, kind: 'video', value: src, settings: { embed_type: 'iframe' } };
      }
      ctx.warn({
        pageSlug: ctx.pageSlug,
        legacySectionId: section.id,
        type: 'approximated',
        reason: 'legacy embed-code held raw markup with no https URL; emitted it as text',
      });
      return { id, kind: 'text', value: typeof src === 'string' ? src : content, settings: {} };
    }

    default: {
      ctx.warn({
        pageSlug: ctx.pageSlug,
        legacySectionId: section.id,
        type: 'approximated',
        reason: `no mapping for legacy element type "${section.type}"; emitted its content as text`,
      });
      return { id, kind: 'text', value: content, settings: {} };
    }
  }
}
