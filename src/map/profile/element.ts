import type { LegacySection } from '../../extract/queries.js';
import { parseJsonObject } from '../../extract/json.js';
import { buttonChromeFrom, imageChromeFrom, px } from './hub.js';
import type { Align, ElementProfile, HubStyleProfile } from './types.js';

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : undefined;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Item.vue:56-79: every element wrapper carries inline margin-top (default 30)
 * and an align-{left|center|right} class (default left). Bottom margins come
 * from the tag (_typography.scss): h2/h3/p 20, h4 10, image and button 0.
 */
export function elementProfile(section: LegacySection, hub: HubStyleProfile): ElementProfile {
  const settings = parseJsonObject(section.settings);
  const styles = obj(settings['styles']);
  const rawAlign = settings['align'];
  const align: Align = rawAlign === 'center' || rawAlign === 'right' ? rawAlign : 'left';
  const marginTop = px(obj(settings['margins'])?.['top'], 30);
  const overwrite = obj(settings['appearance'])?.['overwrite'] === true;

  switch (section.type) {
    case 'headline': {
      // Create.vue:239-245 writes large for Headline and medium for Subheadline; the
      // label is the only trace when size is missing.
      const size = settings['size'] ?? (/^subheadline/i.test(section.label ?? '') ? 'medium' : 'large');
      const level = size === 'medium' ? 3 : size === 'small' ? 4 : 2;
      const fontSize = level === 2 ? hub.headingFontSize : level === 3 ? hub.headingFontSize * 0.75 : 18;
      return { kind: 'headline', level, fontSize, align, marginTop, bottomMargin: level === 4 ? 10 : 20 };
    }
    case 'text':
      return { kind: 'text', align, marginTop, bottomMargin: 20 };
    case 'image': {
      const width = obj(styles?.['width']);
      const type = width?.['type'];
      return {
        kind: 'image',
        align,
        marginTop,
        bottomMargin: 0,
        maxWidth: type === 'custom' ? px(width?.['value'], 400) : null,
        fill: type === 'full',
        chrome: overwrite ? imageChromeFrom(styles) : hub.thumbnail,
        transparent: obj(settings['thumbnail'])?.['is_thumbnail_transparent'] === true,
      };
    }
    case 'button': {
      const theme = obj(styles?.['theme']);
      const colours = obj(theme?.['colors']);
      const background = colours?.['background'];
      const text = colours?.['text'];
      const own = theme?.['show'] === true && typeof background === 'string' && HEX6.test(background) && typeof text === 'string' && HEX6.test(text)
        ? { background, text }
        : null;
      return {
        kind: 'button',
        align,
        marginTop,
        bottomMargin: 0,
        chrome: overwrite ? buttonChromeFrom(styles) : hub.button,
        fullWidth: obj(styles?.['width'])?.['type'] === 'full' || (settings['fullSize'] === true && !styles?.['width']),
        colours: own,
      };
    }
    default:
      return { kind: 'other', align, marginTop, bottomMargin: 0 };
  }
}
