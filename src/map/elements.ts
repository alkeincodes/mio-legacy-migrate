import type { LegacySection } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import type { PlanWarning } from './plan.js';
import { assetRef, playlistRef } from './sections.js';
import { docToHtml, docToText, hasPersonalisation, parseDoc } from './tiptap.js';
import { buttonSettingsFor, headlineSettingsFor, imageSettingsFor, textSettingsFor } from './style.js';

export interface ElementContext {
  legacyHubId: number;
  legacyPageId: number;
  pageSlug: string;
  warn(warning: PlanWarning): void;
  /** The legacy media id backing a section that references a File, or null. */
  mediaIdForSection(section: LegacySection): number | null;
  /** Origins that count as this hub, so a link to them becomes a page action. */
  hubOrigins?: string[];
  /** The manifest entry behind a legacy CDN URL, for images stored as settings.thumbnail.url. */
  assetForUrl?(url: string): { legacyMediaId: number; variant: string } | null;
  /** The V3 slug for a legacy page slug, when the mapper renamed it (reserved or duplicate). */
  resolvePageSlug?(legacySlug: string): string;
  /** The V3 slug of a legacy page by id, for buttons whose target is a page row. */
  pageSlugById?(legacyPageId: number): string | null;
}

function parseSettings(raw: unknown): Record<string, unknown> {
  return parseJsonObject(raw);
}

/**
 * A link that points at this hub's own origin becomes a page action with a
 * root-relative path, which V3 passes through unscoped. Everything else stays a
 * url action.
 */
function actionFor(
  url: string,
  hubOrigins: string[],
  resolvePageSlug: (legacySlug: string) => string = (slug) => slug,
): { type: string; value: string } {
  for (const origin of hubOrigins) {
    if (url.startsWith(origin)) {
      const path = url.slice(origin.length) || '/';
      const normalised = path.startsWith('/') ? path : `/${path}`;
      // Rewrite the first segment when the mapper renamed that page's slug.
      const rewritten = normalised.replace(/^\/([a-z0-9][a-z0-9_-]*)/, (_m, slug: string) => `/${resolvePageSlug(slug)}`);
      return { type: 'page', value: rewritten };
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
  // On the real hub `label` is the element's display name ("Headline", "Paragraph",
  // "Button"); the text lives in a TipTap document in `title` (headline),
  // `settings.value` (paragraph) or `settings.link.label` (button). A row with no
  // document falls back to the label, which is what the fixtures carry.
  const content = section.label ?? section.title ?? '';
  const warnPersonalisation = (doc: ReturnType<typeof parseDoc>): void => {
    if (doc && hasPersonalisation(doc)) {
      ctx.warn({
        pageSlug: ctx.pageSlug,
        legacySectionId: section.id,
        type: 'approximated',
        reason: 'legacy text carries a personalisation token (for example {{ first_name }}); V3 renders it as literal text',
      });
    }
  };

  switch (section.type) {
    case 'headline': {
      const doc = parseDoc(section.title);
      warnPersonalisation(doc);
      const isSubheadline = /^subheadline/i.test(section.label ?? '') || settings['size'] === 'medium';
      return { id, kind: 'headline', value: doc ? docToText(doc) : content, settings: headlineSettingsFor(settings, isSubheadline) };
    }

    case 'text': {
      const doc = parseDoc(settings['value']);
      warnPersonalisation(doc);
      const out = textSettingsFor(settings);
      // The V3 text node renders its value as plain text (tags show literally), so
      // the document is flattened; bold, links and lists are lost and reported.
      if (doc && /<(strong|em|u|a |ul|ol)/.test(docToHtml(doc))) {
        ctx.warn({ pageSlug: ctx.pageSlug, legacySectionId: section.id, type: 'approximated', reason: 'legacy paragraph carries formatting (bold, links or a list) that the V3 text node cannot show; flattened to plain text' });
      }
      return { id, kind: 'text', value: doc ? docToText(doc) : content, settings: out };
    }

    case 'image': {
      const out = imageSettingsFor(settings, section.title ?? '');
      // The legacy image element shows settings.thumbnail.url (a Hub-owned media
      // conversion), even when it also links a File, and that File may be a video.
      // So the thumbnail comes first and the linked File's original is the fallback.
      let value = '';
      const url = (settings['thumbnail'] as Record<string, unknown> | undefined)?.['url'];
      if (typeof url === 'string' && url.length > 0) {
        const asset = ctx.assetForUrl?.(url) ?? null;
        if (asset) {
          value = assetRef(asset.legacyMediaId, asset.variant);
        } else {
          value = url;
          ctx.warn({
            pageSlug: ctx.pageSlug,
            legacySectionId: section.id,
            type: 'approximated',
            reason: `image element points at ${url}, which is not in the asset manifest; the URL is used as-is`,
          });
        }
      }
      if (!value) {
        const mediaId = ctx.mediaIdForSection(section);
        value = mediaId === null ? '' : assetRef(mediaId, 'original');
      }
      return { id, kind: 'image', value, settings: out };
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
      const label = typeof link?.['label'] === 'string' && link['label'].trim() ? link['label'].trim() : content || 'Open';
      const urlDoc = parseDoc(link?.['url']);
      const url = urlDoc ? docToText(urlDoc) : typeof link?.['url'] === 'string' ? link['url'].trim() : '';
      const linkType = typeof settings['type'] === 'string' ? settings['type'] : 'custom';
      let action: { type: string; value: string };
      if (linkType === 'page' && section.model_id !== null) {
        const slug = ctx.pageSlugById?.(section.model_id) ?? null;
        if (slug) action = { type: 'page', value: `/${slug}` };
        else {
          action = { type: 'url', value: '' };
          ctx.warn({ pageSlug: ctx.pageSlug, legacySectionId: section.id, type: 'approximated', reason: `button "${label}" points at legacy page ${section.model_id}, which is not in the plan; it has no target` });
        }
      } else if (linkType === 'playlist' && section.model_id !== null) {
        action = { type: 'page', value: playlistRef(section.model_id) };
      } else if (linkType === 'file' && section.model_id !== null) {
        const mediaId = ctx.mediaIdForSection(section);
        action = { type: 'url', value: mediaId === null ? '' : assetRef(mediaId, 'original') };
        if (mediaId === null) ctx.warn({ pageSlug: ctx.pageSlug, legacySectionId: section.id, type: 'approximated', reason: `button "${label}" points at legacy file ${section.model_id}, which has no media in the bundle` });
      } else {
        action = actionFor(url, ctx.hubOrigins ?? HUB_ORIGINS, ctx.resolvePageSlug);
      }
      return { id, kind: 'button', value: label, settings: buttonSettingsFor(settings, action, link?.['newTab'] === true) };
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
