import { describe, expect, it } from 'vitest';
import { runApply } from '../../src/apply/orchestrator.js';

describe('runApply, scope guards', () => {
  it('refuses --mode upsert, which is M3', async () => {
    await expect(
      runApply({
        planPath: 'plans/x.json', profileName: 'test', mode: 'upsert', dryRun: true,
        resumeRunId: null, checkAccess: false, assetsOnly: false, breakLock: false,
        allowCatalogDrift: false,
      }),
    ).rejects.toThrow('--mode upsert is M3; only --mode fresh is implemented');
  });

  it('refuses --assets-only, which needs the backend import endpoint', async () => {
    await expect(
      runApply({
        planPath: 'plans/x.json', profileName: 'test', mode: 'fresh', dryRun: true,
        resumeRunId: null, checkAccess: false, assetsOnly: true, breakLock: false,
        allowCatalogDrift: false,
      }),
    ).rejects.toThrow('--assets-only requires the backend import endpoint (spec section 9); not available in M1');
  });
});
