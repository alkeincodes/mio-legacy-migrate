import { describe, expect, it } from 'vitest';
import { pageTypeFor, privacyFor, slugFor } from '../../src/map/pages.js';
import type { LegacyHub, LegacyPage } from '../../src/extract/queries.js';

function page(overrides: Partial<LegacyPage> = {}): LegacyPage {
  return {
    id: 100, hub_id: 7, title: 'Home', settings: null, type: 'page',
    slug: 'home', is_homepage: 0, parent_id: null, privacy: 'members',
    ...overrides,
  };
}

const hub = { id: 7, auth: 1 } as LegacyHub;

describe('slugFor', () => {
  it('preserves the legacy slug', () => {
    expect(slugFor(page({ slug: 'about-us' }), new Set())).toBe('about-us');
  });

  it('derives a slug from the title when the legacy slug is null', () => {
    expect(slugFor(page({ slug: null, title: 'Our Story & Mission' }), new Set())).toBe('our-story-mission');
  });

  it('conforms to the V3 slug pattern of lowercase alphanumerics, dashes and underscores', () => {
    expect(slugFor(page({ slug: null, title: '  Héllo  World!! ' }), new Set())).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });

  it('renames "home", which V3 reserves, rather than failing the create', () => {
    expect(slugFor(page({ slug: 'home' }), new Set())).toBe('home-page');
  });

  it.each([
    'access-denied', 'account', 'align', 'banned', 'discussions', 'editor-fixture', 'forgot', 'forgot-password', 'history', 'home', 'legal', 'login', 'members', 'messages', 'moderation', 'my-list', 'notifications', 'onboarding', 'payment', 'playlists', 'register', 'reset-password', 'search',
  ])('renames the reserved slug "%s", which the backend 422s as page_slug_reserved', (reserved) => {
    expect(slugFor(page({ slug: reserved }), new Set())).toBe(`${reserved}-page`);
  });

  it('de-duplicates against slugs already taken', () => {
    expect(slugFor(page({ slug: 'about' }), new Set(['about']))).toBe('about-2');
  });

  it('falls back to the legacy page id when there is no slug and no title', () => {
    expect(slugFor(page({ slug: null, title: null, id: 412 }), new Set())).toBe('page-412');
  });
});

describe('pageTypeFor', () => {
  it('maps the legacy page types onto V3 page types', () => {
    expect(pageTypeFor('page')).toBe('generic');
    expect(pageTypeFor('dashboard')).toBe('homepage');
    expect(pageTypeFor('login')).toBe('login');
    expect(pageTypeFor('register')).toBe('register');
    expect(pageTypeFor('onboarding')).toBe('onboarding');
    expect(pageTypeFor('discussions')).toBe('discussions-index');
  });

  it('falls back to generic for an unknown legacy type', () => {
    expect(pageTypeFor('wormhole')).toBe('generic');
  });
});

describe('privacyFor', () => {
  it('carries the legacy page privacy through', () => {
    expect(privacyFor(page({ privacy: 'public' }), hub)).toBe('public');
    expect(privacyFor(page({ privacy: 'private' }), hub)).toBe('private');
  });

  it('defaults a null privacy to members on a gated hub', () => {
    expect(privacyFor(page({ privacy: null }), hub)).toBe('members');
  });

  it('defaults a null privacy to public on an open hub, because hubs.auth is hub privacy', () => {
    expect(privacyFor(page({ privacy: null }), { ...hub, auth: 0 })).toBe('public');
  });
});

describe('hubSlugFor', () => {
  it('prefers the legacy custom subdomain, then the first label of the domain', async () => {
    const { hubSlugFor } = await import('../../src/cli/map.js');
    expect(hubSlugFor(null, 'alliance.mantalks.com', 7)).toBe('alliance');
    expect(hubSlugFor('The Club', 'x.example.com', 7)).toBe('the-club');
    expect(hubSlugFor(null, '', 7)).toBe('hub-7');
  });
});

describe('mapPages renames', () => {
  it('reports every reserved slug it renamed so the report can list them', async () => {
    const { mapPages } = await import('../../src/map/pages.js');
    const bundle = {
      header: { legacyHubId: 7, legacyHubDomain: 'x.example.com' },
      hub: { id: 7, auth: 1 },
      pages: [page({ id: 1, slug: 'onboarding' }), page({ id: 2, slug: 'about' }), page({ id: 3, slug: null, title: 'Login' })],
      sections: [], media: [], segmentables: [], segments: [], assets: [],
    } as unknown as Parameters<typeof mapPages>[0];
    const { renames, pages } = mapPages(bundle);
    expect(renames).toEqual([
      { legacySlug: 'login', slug: 'login-page', legacyPageId: 3 },
      { legacySlug: 'onboarding', slug: 'onboarding-page', legacyPageId: 1 },
    ]);
    expect(pages.map((p) => p.slug)).toEqual(['login-page', 'about', 'onboarding-page']);
  });
});
