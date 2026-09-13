import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCTION_DEFAULTS, initProfile, loadProfile } from '../../src/config/profile.js';

describe('loadProfile', () => {
  it('loads the committed mantalks-prod profile', () => {
    const profile = loadProfile('mantalks-prod');
    expect(profile.name).toBe('mantalks-prod');
    expect(profile.apiBase).toBe('https://api.member.dev');
    expect(profile.teamId).toBe('01a090ff-5ac3-7402-b686-66fd46af67bc');
    expect(profile.region).toBe('us-east-1');
  });

  it('throws a clear error for an unknown profile', () => {
    expect(() => loadProfile('nope')).toThrow(/no profile "nope"/);
  });

});

describe('initProfile', () => {
  it('writes a profile with the production defaults, varying only name and team', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const { path, profile } = initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir });
    expect(profile).toEqual({ name: 'acme-prod', teamId: '01a090ff-5ac3-7402-b686-66fd46af67bc', ...PRODUCTION_DEFAULTS });
    expect(loadProfile('acme-prod', dir)).toEqual(profile);
    expect(path.endsWith('/acme-prod.json')).toBe(true);
  });

  it('refuses a bad name, a non-UUID team id, and an existing file without --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    expect(() => initProfile('Acme Prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir })).toThrow(/lowercase/);
    expect(() => initProfile('acme-prod', 'team-42', { dir })).toThrow(/UUID/);
    initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir });
    expect(() => initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir })).toThrow(/--force/);
    expect(() => initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir, force: true })).not.toThrow();
  });
});
