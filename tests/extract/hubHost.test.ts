import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultHostFor, hubIdFromHost, normaliseHubHost } from '../../src/extract/hubHost.js';

describe('normaliseHubHost', () => {
  it('takes what a migrator pastes down to the bare host', () => {
    expect(normaliseHubHost('https://hub-abcdefghij.membership.io')).toBe('hub-abcdefghij.membership.io');
    expect(normaliseHubHost('HTTPS://Alliance.MANTALKS.com/login?x=1')).toBe('alliance.mantalks.com');
    expect(normaliseHubHost(' alliance.mantalks.com:443/ ')).toBe('alliance.mantalks.com');
  });
});

describe('hubIdFromHost', () => {
  // The real salt is a legacy production secret and stays in .env; a test salt proves the round trip.
  const saved = process.env['LEGACY_HASHIDS_SALT'];
  beforeEach(() => { process.env['LEGACY_HASHIDS_SALT'] = 'test-salt-not-the-real-one'; });
  afterEach(() => { if (saved === undefined) delete process.env['LEGACY_HASHIDS_SALT']; else process.env['LEGACY_HASHIDS_SALT'] = saved; });

  it('round-trips a hub id through the default host with the hub.subdomain hashids connection', () => {
    const host = defaultHostFor(38827);
    expect(host).toMatch(/^hub-[a-z0-9]{10}\.membership\.io$/);
    expect(hubIdFromHost(host)).toBe(38827);
    expect(hubIdFromHost(defaultHostFor(12607))).toBe(12607);
  });

  it('is null for any other host', () => {
    expect(hubIdFromHost('alliance.mantalks.com')).toBeNull();
    expect(hubIdFromHost('hub-notahash1.membership.io')).toBeNull();
  });

  it('names the missing salt instead of decoding to garbage when .env has none', () => {
    delete process.env['LEGACY_HASHIDS_SALT'];
    expect(() => hubIdFromHost('hub-abcdefghij.membership.io')).toThrow(/LEGACY_HASHIDS_SALT/);
    expect(hubIdFromHost('alliance.mantalks.com')).toBeNull();
    expect(() => defaultHostFor(1)).toThrow(/LEGACY_HASHIDS_SALT/);
  });
});
