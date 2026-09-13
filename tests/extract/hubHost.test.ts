import { describe, expect, it } from 'vitest';
import { defaultHostFor, hubIdFromHost, normaliseHubHost } from '../../src/extract/hubHost.js';

describe('normaliseHubHost', () => {
  it('takes what a migrator pastes down to the bare host', () => {
    expect(normaliseHubHost('https://hub-edxg119xn8.membership.io')).toBe('hub-edxg119xn8.membership.io');
    expect(normaliseHubHost('HTTPS://Alliance.MANTALKS.com/login?x=1')).toBe('alliance.mantalks.com');
    expect(normaliseHubHost(' alliance.mantalks.com:443/ ')).toBe('alliance.mantalks.com');
  });
});

describe('hubIdFromHost', () => {
  it('decodes the default host with the legacy hub.subdomain hashids connection', () => {
    // Real rows: hub 12607 "Web Developments" and hub 38827 ManTalks.
    expect(hubIdFromHost('hub-edxg119xn8.membership.io')).toBe(12607);
    expect(defaultHostFor(38827)).toBe('hub-lkx8yq8q08.membership.io');
    expect(hubIdFromHost(defaultHostFor(38827))).toBe(38827);
  });

  it('is null for any other host', () => {
    expect(hubIdFromHost('alliance.mantalks.com')).toBeNull();
    expect(hubIdFromHost('hub-notahash1.membership.io')).toBeNull();
  });
});
