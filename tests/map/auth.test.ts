import { describe, expect, it } from 'vitest';
import { mapAuthPages, panelTint } from '../../src/map/auth.js';
import type { Bundle } from '../../src/extract/bundle.js';
import type { LegacyPage } from '../../src/extract/queries.js';

function page(id: number, type: string, settings: unknown = null): LegacyPage {
  return { id, hub_id: 7, title: type[0]!.toUpperCase() + type.slice(1), settings: settings === null ? null : JSON.stringify(settings), type, slug: null, is_homepage: 0, parent_id: null, privacy: null };
}

function bundle(opts: { theme?: Record<string, unknown>; meta?: Record<string, unknown>; pages?: LegacyPage[] } = {}): Bundle {
  return {
    header: { legacyHubId: 7 },
    hub: { id: 7, auth: 1, meta: opts.meta ? JSON.stringify(opts.meta) : null },
    theme: { settings: JSON.stringify(opts.theme ?? { colors: { primary: '#5F7FEC', secondary: '#A31C1C' } }) },
    pages: opts.pages ?? [page(1, 'login'), page(2, 'register'), page(3, 'onboarding')],
    sections: [],
  } as unknown as Bundle;
}

const brandPanel = (p: { tree: { children?: Array<{ settings?: Record<string, unknown>; template?: string }> } }) => p.tree.children?.[0];
const reasons = (w: Array<{ reason: string }>) => w.map((x) => x.reason);

describe('panelTint', () => {
  it('is the 5% wash of the text colour over the page background, as legacy .variant-default paints it', () => {
    expect(panelTint('#A31C1C', '#FFFFFF')).toBe('#FAF4F4');
    expect(panelTint('#000000', '#FFFFFF')).toBe('#F2F2F2');
  });
});

describe('mapAuthPages', () => {
  it('authors a login and a register page whose brand panel carries the legacy default look: tinted panel, ink recorded, panel on the left, 150px logo', () => {
    const { pages, warnings } = mapAuthPages(bundle(), new Set());
    expect(pages.map((p) => [p.pageType, p.slug, p.privacy])).toEqual([['login', 'sign-in', 'public'], ['register', 'sign-up', 'public']]);
    const login = pages[0]!;
    expect(login.tree.template).toBe('page-login');
    const panel = brandPanel(login)!;
    // No template annotation: the backend's anonymous prune drops a templated panel.
    expect(panel.template).toBeUndefined();
    expect(panel.settings).toEqual({ slot: 'brand-panel', side: 'left', gap: 6, logoSize: 150, surface: { background: { type: 'custom-color', value: '#FAF4F4' }, ink: 'dark' } });
    expect(reasons(warnings)).toContain('auth.panel.ink: #A31C1C -> dark');
  });

  it('carries a legacy image background without a scrim and with white ink, keeps blur, and records the position V3 cannot take', () => {
    const image = { type: 'image', image: { url: 'https://cdn.example.com/1/bg.png' }, position: 'center bottom', blur: true };
    const { pages, warnings } = mapAuthPages(bundle({ pages: [page(1, 'login', { background: image })] }), new Set());
    expect(brandPanel(pages[0]!)!.settings!['surface']).toEqual({ background: { type: 'image', url: 'https://cdn.example.com/1/bg.png', scrim: false, blur: true }, ink: 'light' });
    expect(reasons(warnings)).toContain('auth.panel.position: center bottom -> center');
  });

  it('reads the theme-level login background when the page has no settings, and lets register fall back to login', () => {
    const theme = { colors: { primary: '#5F7FEC', secondary: '#A31C1C' }, pages: { login: { background: { type: 'custom-color', color: '#123456' }, logoSize: 200 } } };
    const { pages } = mapAuthPages(bundle({ theme }), new Set());
    for (const p of pages.slice(0, 2)) {
      const s = brandPanel(p)!.settings!;
      expect(s['surface']).toEqual({ background: { type: 'custom-color', value: '#123456' }, ink: 'light' });
      expect(s['logoSize']).toBe(200);
    }
  });

  it('paints a dark-mode default panel in the secondary colour with light ink', () => {
    const theme = { darkMode: true, colors: { primary: '#F7F2E8', secondary: '#333333', background: '#333333', text: '#fafafa' } };
    const { pages, warnings } = mapAuthPages(bundle({ theme }), new Set());
    expect(brandPanel(pages[0]!)!.settings!['surface']).toEqual({ background: { type: 'custom-color', value: '#333333' }, ink: 'light' });
    expect(reasons(warnings).some((r) => r.startsWith('auth.panel.ink'))).toBe(false);
  });

  it('puts the panel on the right when legacy orders the form first, per page', () => {
    const meta = { login: { sections: ['right', 'left'] }, registration: { sections: ['left', 'right'] } };
    const { pages } = mapAuthPages(bundle({ meta }), new Set());
    expect(brandPanel(pages[0]!)!.settings!['side']).toBe('right');
    expect(brandPanel(pages[1]!)!.settings!['side']).toBe('left');
  });

  it('records what V3 has no setting for: a hidden logo, register copy, an onboarding background that differs from login', () => {
    const pages = [
      page(1, 'login', { logo: true, background: { type: 'image', image: { url: 'https://cdn.example.com/1/a.png' } } }),
      page(2, 'register', { logo: false, partials: { 'account-description': { value: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Which email?"}]}]}' } } }),
      page(3, 'onboarding', { background: { type: 'image', image: { url: 'https://cdn.example.com/1/b.png' } } }),
    ];
    const { warnings } = mapAuthPages(bundle({ pages }), new Set());
    const r = reasons(warnings);
    expect(r).toContain('auth.panel.logo: hidden -> shown');
    expect(r).toContain('auth.register.copy: "Which email?" -> V3 register form copy');
    expect(r).toContain('auth.onboarding.background: https://cdn.example.com/1/b.png -> the login panel');
  });

  it('clamps the logo size to what V3 accepts and avoids a taken slug', () => {
    const theme = { colors: {}, pages: { login: { logoSize: 900 } } };
    const { pages } = mapAuthPages(bundle({ theme }), new Set(['sign-in']));
    expect(pages[0]!.slug).toBe('sign-in-2');
    expect(brandPanel(pages[0]!)!.settings!['logoSize']).toBe(320);
  });

  it('authors nothing when the hub has no legacy login page', () => {
    expect(mapAuthPages(bundle({ pages: [] }), new Set()).pages).toEqual([]);
  });
});
