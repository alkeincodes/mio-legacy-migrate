import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCTION_DEFAULTS, initProfile, loadProfile, profileSecrets, type Profile } from '../../src/config/profile.js';
import { withProfileLogins, type Env } from '../../src/config/env.js';

describe('loadProfile', () => {
  it('loads a profile written by initProfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    initProfile('mantalks-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir });
    const profile = loadProfile('mantalks-prod', dir);
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

  it('carries the per-hub logins and lists their passwords as secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const { profile } = initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir, logins: { legacyHubLoginEmail: 'a@acme.com', legacyHubLoginPassword: 'pw-a', v3VerifyLoginEmail: 'b@acme.com', v3VerifyLoginPassword: 'pw-b' } });
    expect(profile).toMatchObject({ legacyHubLoginEmail: 'a@acme.com', v3VerifyLoginEmail: 'b@acme.com' });
    expect(profile).not.toHaveProperty('v3PlatformLoginEmail');
    expect(profileSecrets(profile)).toEqual(['pw-a', 'pw-b']);
  });
});

describe('withProfileLogins', () => {
  const env = { legacyHubLoginEmail: 'env-a@x', legacyHubLoginPassword: 'env-pa', v3VerifyLoginEmail: 'env-b@x', v3VerifyLoginPassword: 'env-pb', v3PlatformLoginEmail: '', v3PlatformLoginPassword: '' } as unknown as Env;
  const profile = (over: Partial<Profile>): Profile => ({ ...PRODUCTION_DEFAULTS, name: 'p', teamId: 't', ...over });

  it('takes the profile values when set and the .env values otherwise', () => {
    const out = withProfileLogins(env, profile({ v3VerifyLoginEmail: 'p-b@x', v3VerifyLoginPassword: 'p-pb' }));
    expect(out).toMatchObject({ legacyHubLoginEmail: 'env-a@x', legacyHubLoginPassword: 'env-pa', v3VerifyLoginEmail: 'p-b@x', v3VerifyLoginPassword: 'p-pb' });
  });

  it('refuses to run with a login that resolves to nothing, naming both places to set it', () => {
    const bare = { ...env, v3VerifyLoginEmail: '', v3VerifyLoginPassword: '' } as Env;
    expect(() => withProfileLogins(bare, profile({}))).toThrow(/v3VerifyLoginEmail.*V3_VERIFY_LOGIN_EMAIL/);
  });

});
