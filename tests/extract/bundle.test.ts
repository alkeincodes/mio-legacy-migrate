import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBundle, writeBundle, type Bundle } from '../../src/extract/bundle.js';

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    header: {
      bundleSchemaVersion: 1,
      toolVersion: '0.1.0',
      legacyHubId: 7,
      legacyHubDomain: 'alliance.mantalks.com',
      sourceHost: 'replica.rds.amazonaws.com',
      captureStartedAt: '2026-09-12T09:00:00.000Z',
      captureEndedAt: '2026-09-12T09:04:11.000Z',
      replicaLagSeconds: 3,
      distinctSectionTypes: ['row', 'column', 'headline'],
    },
    hub: { id: 7 } as Bundle['hub'],
    theme: null,
    pages: [], sections: [], menuItems: [], playlists: [], playlistItems: [],
    files: [], hubFiles: [], folders: [], media: [], discussionCategories: [],
    achievements: [], segments: [], segmentGroups: [], segmentConditions: [],
    segmentables: [], assets: [], missingAssets: [],
    ...overrides,
  };
}

describe('writeBundle', () => {
  it('writes a deterministic file name keyed by hub id and capture start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    const path = writeBundle(bundle(), dir);
    expect(path.endsWith('hub-7-2026-09-12T09-00-00.000Z.json')).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('leaves no temp file behind after the atomic rename', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    writeBundle(bundle(), dir);
    expect(readdirSync(dir).some((f) => f.includes('.tmp'))).toBe(false);
  });

  it('records the replica lag and the distinct section types in the header', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    const path = writeBundle(bundle(), dir);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Bundle;
    expect(parsed.header.replicaLagSeconds).toBe(3);
    expect(parsed.header.distinctSectionTypes).toEqual(['row', 'column', 'headline']);
  });
});

describe('readBundle', () => {
  it('round-trips a bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    const path = writeBundle(bundle(), dir);
    expect(readBundle(path).header.legacyHubId).toBe(7);
  });

  it('refuses a bundle written by a different schema version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    const b = bundle();
    (b.header as unknown as { bundleSchemaVersion: number }).bundleSchemaVersion = 2;
    const path = writeBundle(b, dir);
    expect(() => readBundle(path)).toThrow(/bundle schema version 2 .* expected 1/);
  });
});
