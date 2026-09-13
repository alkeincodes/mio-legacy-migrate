import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProfile, loadProfile, profileSecrets, targetOf, type ProfileFile, type Target } from '../../src/config/profile.js';
import { requireHubLogins, withProfileLogins, type Env } from '../../src/config/env.js';

const TARGET: Target = { apiBase: 'https://api.member.dev', bucket: 'b', region: 'us-east-1', cdnBase: 'https://cdn.example', cdnBaseConfirmed: false, hubBase: 'https://hub.member.dev' };
const BLANK = { legacyHubLoginEmail: '', legacyHubLoginPassword: '', v3VerifyLoginEmail: '', v3VerifyLoginPassword: '', v3PlatformLoginEmail: '', v3PlatformLoginPassword: '' };

describe('loadProfile', () => {
  it('loads a profile written by initProfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    initProfile('mantalks-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir });
    const profile = loadProfile('mantalks-prod', TARGET, dir);
    expect(profile.name).toBe('mantalks-prod');
    expect(profile.apiBase).toBe('https://api.member.dev');
    expect(profile.teamId).toBe('01a090ff-5ac3-7402-b686-66fd46af67bc');
    expect(profile.region).toBe('us-east-1');
  });

  it('throws a clear error for an unknown profile', () => {
    expect(() => loadProfile('nope', TARGET)).toThrow(/no profile "nope"/);
  });

});

describe('initProfile', () => {
  it('writes the per-hub template: name, team and six blank login fields; loading merges the .env target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiles-'));
    const { path, profile } = initProfile('acme-prod', '01a090ff-5ac3-7402-b686-66fd46af67bc', { dir });
    expect(profile).toEqual({ name: 'acme-prod', teamId: '01a090ff-5ac3-7402-b686-66fd46af67bc', ...BLANK });
    expect(loadProfile('acme-prod', TARGET, dir)).toEqual({ ...profile, ...TARGET });
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
    expect(profile).toMatchObject({ legacyHubLoginEmail: 'a@acme.com', v3VerifyLoginEmail: 'b@acme.com', v3PlatformLoginEmail: '' });
    expect(profileSecrets(profile)).toEqual(['pw-a', 'pw-b']);
  });
});

describe('withProfileLogins', () => {
  const env = { ...BLANK } as unknown as Env;
  const profile = (over: Partial<ProfileFile>): ProfileFile => ({ name: 'p', teamId: 't', ...BLANK, ...over });

  it('copies the profile logins onto the env the browser and API code read', () => {
    const out = withProfileLogins(env, profile({ legacyHubLoginEmail: 'a@x', legacyHubLoginPassword: 'pa', v3VerifyLoginEmail: 'b@x', v3VerifyLoginPassword: 'pb' }));
    expect(out).toMatchObject({ legacyHubLoginEmail: 'a@x', legacyHubLoginPassword: 'pa', v3VerifyLoginEmail: 'b@x', v3VerifyLoginPassword: 'pb', v3PlatformLoginEmail: '' });
  });

  it('copies blanks through for apply; verify refuses a blank hub login and names the profile file', () => {
    const out = withProfileLogins(env, profile({ legacyHubLoginEmail: 'a@x', legacyHubLoginPassword: 'pa' }));
    expect(out.v3VerifyLoginEmail).toBe('');
    expect(() => requireHubLogins(out, 'p')).toThrow(/v3VerifyLoginEmail.*profiles\/p\.json/);
  });

  it('targetOf lifts the shared V3 values out of the env', () => {
    expect(targetOf({ v3ApiBase: 'https://api', v3AssetsBucket: 'b', v3AssetsRegion: 'r', v3CdnBase: 'https://cdn', v3CdnBaseConfirmed: true, v3HubBase: 'https://hub' })).toEqual({ apiBase: 'https://api', bucket: 'b', region: 'r', cdnBase: 'https://cdn', cdnBaseConfirmed: true, hubBase: 'https://hub' });
  });

});
