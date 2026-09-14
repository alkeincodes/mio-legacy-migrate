import type { Bundle } from '../extract/bundle.js';
import type { LegacyPage } from '../extract/queries.js';
import { parseJsonObject } from '../extract/json.js';
import type { CatalogNode } from './catalog.js';
import { nodeId } from './nodeId.js';
import { slugFor } from './pages.js';
import type { PlanPage, PlanWarning } from './plan.js';
import { docToText, parseDoc } from './tiptap.js';
import { fidelityWarning, type FidelityEntry } from './translate/fidelity.js';
import { luminance } from './translate/surface.js';

/**
 * Legacy auth pages onto V3's login and register pages.
 *
 * Legacy paints login, register and onboarding with one split layout
 * (Pages/Login.vue, Register.vue, Onboarding.vue): a brand panel (logo, footer)
 * beside the form. The panel's background is the page's `settings.background`
 * (else the theme's `pages.<type>.background`, register and onboarding falling
 * back to login's); `variant-default` is a 5% wash of the text colour
 * (sass/_common.scss:116-135); the panel side comes from `hub.meta.<type>.sections`;
 * the logo size from `theme.settings.pages.<type>.logoSize`, 150 by default.
 *
 * V3 renders every auth screen and onboarding through `BrandedAuthShell` from
 * the hub's `login` page (and register from the `register` page): the first
 * root child tagged `settings.slot: 'brand-panel'` gives the panel its
 * `surface`, `side` and `logoSize` (mio-hub src/lib/auth/prepare-panel-region.ts).
 * Those are the settings that exist, so those are what is carried. The rest
 * (a brand ink colour on the panel, image position, a hidden logo, register
 * copy, an onboarding background of its own) has no setting and is recorded.
 */

type Obj = Record<string, unknown>;

const AUTH_TYPES = ['login', 'register'] as const;
const DEFAULT_LOGO_SIZE = 150;
const LOGO_SIZE_MIN = 16;
const LOGO_SIZE_MAX = 320;
const AUTH_SLUGS: Record<string, string> = { login: 'sign-in', register: 'sign-up' };
const META_KEYS: Record<string, string> = { login: 'login', register: 'registration', onboarding: 'onboarding' };

interface LegacyBackground {
  type: string;
  url: string | null;
  color: string | null;
  position: string | null;
  blur: boolean;
  raw: Obj;
}

function obj(value: unknown): Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function hex(value: unknown, fallback: string): string {
  const s = str(value);
  return s && HEX6.test(s) ? s.toUpperCase() : fallback;
}

/** Legacy `.variant-default`: the text colour at 5% over the page background. */
export function panelTint(ink: string, background: string): string {
  const channel = (i: number): string => {
    const over = parseInt(ink.slice(i, i + 2), 16);
    const under = parseInt(background.slice(i, i + 2), 16);
    return Math.round(under * 0.95 + over * 0.05).toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function readBackground(raw: unknown): LegacyBackground | null {
  const b = obj(raw);
  if (Object.keys(b).length === 0) return null;
  const image = obj(b['image']);
  return {
    type: str(b['type']) ?? 'default',
    url: str(image['url']) ?? str(b['url']),
    color: str(b['color']),
    position: str(b['position']),
    blur: b['blur'] === true,
    raw: b,
  };
}

/** Page settings first, then the theme's per-page block, register and onboarding falling back to login (Login.vue:96-99, Register.vue:196-199, Onboarding.vue:123-143). */
function backgroundFor(type: string, page: LegacyPage | undefined, themePages: Obj): LegacyBackground {
  const own = readBackground(obj(parseJsonObject(page?.settings))['background']);
  if (own) return own;
  const themeOwn = readBackground(obj(themePages[type])['background']);
  if (themeOwn) return themeOwn;
  if (type !== 'login') {
    const login = readBackground(obj(themePages['login'])['background']);
    if (login) return login;
  }
  return { type: 'default', url: null, color: null, position: null, blur: false, raw: {} };
}

/** Legacy `hub.meta.<key>.sections`, `['left','right']` by default: the panel is the `left` entry. */
function sideFor(meta: Obj, type: string): 'left' | 'right' {
  const order = obj(meta[META_KEYS[type] ?? type])['sections'];
  if (Array.isArray(order) && order.indexOf('right') < order.indexOf('left') && order.includes('right')) return 'right';
  return 'left';
}

interface ThemeFacts {
  darkMode: boolean;
  custom: boolean;
  primary: string;
  secondary: string;
  background: string;
  text: string;
  pages: Obj;
}

/** The CSS variables legacy derives in hub/js/app.js:52-68 and the App.vue:169-170 body classes. */
function themeFacts(settings: Obj): ThemeFacts {
  const colours = obj(settings['colors']);
  const darkMode = settings['darkMode'] === true;
  const secondary = hex(colours['secondary'], '#2F2521');
  return {
    darkMode,
    custom: str(obj(settings['background'])['type']) === 'custom',
    primary: hex(colours['primary'], '#F7B01E'),
    secondary,
    background: hex(colours['background'], darkMode ? secondary : '#FFFFFF'),
    text: hex(colours['text'], darkMode ? '#FFFFFF' : secondary),
    pages: obj(settings['pages']),
  };
}

function inkValue(inkHex: string): 'light' | 'dark' {
  return luminance(inkHex) >= 0.5 ? 'light' : 'dark';
}

/** The panel surface V3 can take for the legacy look, plus what it cannot. */
function panelSurface(bg: LegacyBackground, theme: ThemeFacts): { surface: Obj; fidelity: FidelityEntry[] } {
  const fidelity: FidelityEntry[] = [];
  let background: Obj;
  let inkHex: string;
  switch (bg.type) {
    case 'image': {
      // `.variant-image`: white text, no tint over the picture (_common.scss:262-276).
      background = { type: 'image', url: bg.url ?? '', scrim: false, ...(bg.blur ? { blur: true } : {}) };
      inkHex = '#FFFFFF';
      if (bg.position && bg.position !== 'center') fidelity.push({ property: 'auth.panel.position', legacy: bg.position, v3: 'center' });
      break;
    }
    case 'custom-color': {
      const value = hex(bg.color, theme.primary);
      background = { type: 'custom-color', value };
      inkHex = luminance(value) >= 0.5 ? '#000000' : '#FFFFFF';
      break;
    }
    case 'gradient': {
      background = { type: 'gradient' };
      inkHex = '#FFFFFF';
      fidelity.push({ property: 'auth.panel.gradient', legacy: JSON.stringify(bg.raw['gradient'] ?? bg.raw), v3: "V3's own gradient" });
      break;
    }
    default: {
      // `.variant-default` (_common.scss:116-135): dark hubs fill with the secondary
      // colour under white text; light and custom hubs wash the page colour
      // with 5% of the text colour, which is also the text.
      if (theme.darkMode) {
        background = { type: 'custom-color', value: theme.secondary };
        inkHex = '#FFFFFF';
      } else {
        const ink = theme.custom ? theme.text : theme.secondary;
        background = { type: 'custom-color', value: panelTint(ink, theme.background) };
        inkHex = ink;
      }
    }
  }
  const ink = inkValue(inkHex);
  if (inkHex !== '#FFFFFF' && inkHex !== '#000000') fidelity.push({ property: 'auth.panel.ink', legacy: inkHex, v3: ink });
  return { surface: { background, ink }, fidelity };
}

function logoSizeFor(type: string, themePages: Obj): { value: number; fidelity: FidelityEntry | null } {
  const own = obj(themePages[type])['logoSize'];
  const login = obj(themePages['login'])['logoSize'];
  const raw = Number(own ?? login ?? DEFAULT_LOGO_SIZE);
  const px = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_LOGO_SIZE;
  const value = Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, px));
  return { value, fidelity: value === px ? null : { property: 'auth.panel.logoSize', legacy: `${px}px`, v3: `${value}px` } };
}

function describe(bg: LegacyBackground): string {
  return bg.url ?? bg.color ?? bg.type;
}

/** `types` limits which auth pages are authored; a type mapped as an ordinary page elsewhere must not be authored twice. */
export function mapAuthPages(bundle: Bundle, taken: Set<string>, types: ReadonlySet<string> = new Set(AUTH_TYPES)): { pages: PlanPage[]; warnings: PlanWarning[] } {
  const pages: PlanPage[] = [];
  const warnings: PlanWarning[] = [];
  const byType = new Map(bundle.pages.map((p) => [p.type, p]));
  const login = byType.get('login');
  if (!login) return { pages, warnings };

  const theme = themeFacts(parseJsonObject(bundle.theme?.settings));
  const meta = parseJsonObject(bundle.hub.meta);

  for (const type of AUTH_TYPES) {
    const page = byType.get(type);
    if (!page || !types.has(type)) continue;
    const slug = slugFor({ ...page, slug: AUTH_SLUGS[type] ?? type, title: page.title ?? type }, taken);
    const settings = obj(parseJsonObject(page.settings));
    const bg = backgroundFor(type, page, theme.pages);
    const { surface, fidelity } = panelSurface(bg, theme);
    const logo = logoSizeFor(type, theme.pages);
    if (logo.fidelity) fidelity.push(logo.fidelity);
    if (settings['logo'] === false) fidelity.push({ property: 'auth.panel.logo', legacy: 'hidden', v3: 'shown' });
    if (type === 'register') {
      const copy = obj(obj(settings['partials'])['account-description'])['value'];
      const doc = parseDoc(copy);
      const text = doc ? docToText(doc).trim() : str(copy);
      if (text) fidelity.push({ property: 'auth.register.copy', legacy: JSON.stringify(text), v3: 'V3 register form copy' });
    }
    const authored = bundle.sections.filter((s) => s.page_id === page.id && s.parent_id === null);
    if (authored.length > 0) {
      warnings.push({ pageSlug: slug, legacySectionId: null, type: 'approximated', reason: `legacy ${type} page carries ${authored.length} authored section(s) beside the form; V3's ${type} form takes no sections, only the brand panel` });
    }
    for (const entry of fidelity) warnings.push(fidelityWarning(entry, slug, null));

    const hubId = bundle.header.legacyHubId;
    const tree: CatalogNode = {
      id: nodeId(hubId, page.id, 0, 0),
      kind: 'stack',
      template: `page-${type}`,
      settings: { gap: 0 },
      children: [
        // The region is tagged by `settings.slot` alone, as the spec and the hub's
        // own fixtures write it. The catalog starter's `template: 'auth-brand-panel'`
        // annotation has no compiled section type, and the backend's anonymous
        // prune (app/pages/anon_tree_safety.py) drops any templated node it cannot
        // classify, panel and all; an untemplated stack is a passthrough kind.
        {
          id: nodeId(hubId, page.id, 0, 1),
          kind: 'stack',
          settings: { slot: 'brand-panel', side: sideFor(meta, type), gap: 6, logoSize: logo.value, surface },
          children: [],
        },
      ],
    };
    pages.push({ legacyPageId: page.id, slug, title: page.title ?? (type === 'login' ? 'Login' : 'Register'), pageType: type, privacy: 'public', isHomepage: false, tree, restrictedSectionNodeIds: [] });
  }

  // V3 onboarding renders through the login page; legacy lets onboarding carry its own background.
  const onboarding = byType.get('onboarding');
  if (onboarding) {
    const own = backgroundFor('onboarding', onboarding, theme.pages);
    const loginBg = backgroundFor('login', login, theme.pages);
    if (JSON.stringify(own.raw) !== JSON.stringify(loginBg.raw)) {
      warnings.push(fidelityWarning({ property: 'auth.onboarding.background', legacy: describe(own), v3: 'the login panel' }, pages[0]?.slug ?? null, null));
    }
  }
  return { pages, warnings };
}
