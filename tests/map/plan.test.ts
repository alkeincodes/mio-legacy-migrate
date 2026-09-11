import { describe, expect, it } from 'vitest';
import { contentHash, planHash } from '../../src/map/plan.js';
import type { Plan } from '../../src/map/plan.js';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1, toolVersion: '0.1.0', catalogVersion: '0.23.6',
    catalogDigest: 'sha256:abc', legacyHubId: 7, sourceHost: 'replica.example.com',
    hub: { title: 'ManTalks', slug: 'mantalks', description: null, isPrivate: true },
    branding: {}, pages: [], playlists: [], folders: [], assets: [], spaces: [],
    achievements: [], segments: [], tags: [], accessRules: [], excludedPages: [],
    navigation: { header: [], footer: [], mobile: [] }, warnings: [],
    ...overrides,
  } as Plan;
}

describe('planHash', () => {
  it('is stable across key ordering', () => {
    const a = plan({ hub: { title: 'ManTalks', slug: 'mantalks', description: null, isPrivate: true } });
    const b = plan();
    (b as unknown as Record<string, unknown>).hub = { slug: 'mantalks', isPrivate: true, title: 'ManTalks', description: null };
    expect(planHash(a)).toBe(planHash(b));
  });

  it('changes when any planned content changes', () => {
    expect(planHash(plan())).not.toBe(planHash(plan({ legacyHubId: 8 })));
  });

  it('ignores warnings, which are advisory and must not invalidate a resume', () => {
    const withWarning = plan({
      warnings: [{ pageSlug: 'home', legacySectionId: 1, type: 'approximated', reason: 'cta' }],
    });
    expect(planHash(withWarning)).toBe(planHash(plan()));
  });
});

describe('contentHash', () => {
  it('hashes an entry with sorted keys', () => {
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
  });

  it('distinguishes different entries', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
