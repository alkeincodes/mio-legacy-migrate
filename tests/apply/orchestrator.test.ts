import { describe, expect, it } from 'vitest';
import { runApply } from '../../src/apply/orchestrator.js';

describe('runApply, scope guards', () => {
  it('refuses --mode upsert, which is M3', async () => {
    await expect(
      runApply({
        planPath: 'plans/x.json', profileName: 'test', mode: 'upsert', dryRun: true,
        resumeRunId: null, checkAccess: false, assetsOnly: false, breakLock: false,
        allowCatalogDrift: false, cleanupOrphans: false, confirm: false, skipAssets: false, hubSlug: null, publishHeld: false, acceptPlanChange: false,
      }),
    ).rejects.toThrow('--mode upsert is M3; only --mode fresh is implemented');
  });

  it('refuses --assets-only without --resume, because it copies what an earlier run left pending', async () => {
    await expect(
      runApply({
        planPath: 'plans/x.json', profileName: 'test', mode: 'fresh', dryRun: true,
        resumeRunId: null, checkAccess: false, assetsOnly: true, breakLock: false,
        allowCatalogDrift: false, cleanupOrphans: false, confirm: false, skipAssets: false, hubSlug: null, publishHeld: false, acceptPlanChange: false,
      }),
    ).rejects.toThrow('--assets-only needs --resume');
  });

  it('refuses --assets-only together with --skip-assets', async () => {
    await expect(
      runApply({
        planPath: 'plans/x.json', profileName: 'test', mode: 'fresh', dryRun: true,
        resumeRunId: 'run-1', checkAccess: false, assetsOnly: true, breakLock: false,
        allowCatalogDrift: false, cleanupOrphans: false, confirm: false, skipAssets: true, hubSlug: null, publishHeld: false, acceptPlanChange: false,
      }),
    ).rejects.toThrow('contradict');
  });
});
