import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiIdentity, latestRun, planApply } from '../../src/cli/migrate.js';
import type { Profile } from '../../src/config/profile.js';

describe('latestRun', () => {
  it('is null before the first apply and the newest run id afterwards', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'p', '38827');
    expect(latestRun(dir)).toBeNull();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run-2026-09-11T19-49-29-036Z-b3f055c6.json'), '{}');
    writeFileSync(join(dir, 'run-2026-09-12T10-00-00-000Z-aaaaaaaa.json'), '{}');
    writeFileSync(join(dir, 'lock'), '');
    expect(latestRun(dir)).toBe('run-2026-09-12T10-00-00-000Z-aaaaaaaa');
  });
});

describe('planApply', () => {
  it('a first run needs a slug and creates; a rerun resumes with the plan-change flags and the slug the hub already has', () => {
    expect(planApply({ existingRun: null, hubSlug: 'web-dev', existingSlug: null, assets: false, v3KeysPresent: false })).toEqual({ resumeRunId: null, hubSlug: 'web-dev', skipAssets: true, acceptPlanChange: false, rewritePages: false });
    expect(planApply({ existingRun: 'run-1', hubSlug: 'other', existingSlug: 'test2', assets: false, v3KeysPresent: false })).toEqual({ resumeRunId: 'run-1', hubSlug: 'test2', skipAssets: true, acceptPlanChange: true, rewritePages: true });
    expect(() => planApply({ existingRun: 'run-1', hubSlug: null, existingSlug: null, assets: false, v3KeysPresent: false })).toThrow(/slug could not be read/);
    expect(() => planApply({ existingRun: null, hubSlug: null, existingSlug: null, assets: false, v3KeysPresent: false })).toThrow(/--hub-slug/);
  });

  it('copies assets only when asked and the V3 keys exist', () => {
    expect(planApply({ existingRun: 'run-1', hubSlug: null, existingSlug: 's', assets: true, v3KeysPresent: true }).skipAssets).toBe(false);
    expect(() => planApply({ existingRun: 'run-1', hubSlug: null, existingSlug: 's', assets: true, v3KeysPresent: false })).toThrow(/V3_AWS_ACCESS_KEY_ID/);
  });
});

describe('apiIdentity', () => {
  const base: Profile = { name: 'p', teamId: 't', apiBase: 'https://api', bucket: 'b', region: 'r', cdnBase: 'https://cdn', cdnBaseConfirmed: false, hubBase: 'https://hub', legacyHubLoginEmail: '', legacyHubLoginPassword: '', v3VerifyLoginEmail: '', v3VerifyLoginPassword: '', v3PlatformLoginEmail: '', v3PlatformLoginPassword: '' };

  it('prefers the platform login, falls back to the verify login, and names the fix when neither exists', () => {
    expect(apiIdentity({ ...base, v3PlatformLoginEmail: 'o@x', v3PlatformLoginPassword: 'pw' })).toEqual({ ok: true, label: 'platform login o@x' });
    expect(apiIdentity({ ...base, v3VerifyLoginEmail: 'm@x', v3VerifyLoginPassword: 'pw' })).toMatchObject({ ok: true });
    expect(apiIdentity(base)).toMatchObject({ ok: false, reason: expect.stringContaining('profiles/p.json') });
  });
});
