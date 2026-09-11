import { ApiClient } from '../apply/api.js';
import { Budget, budgetIdentity } from '../apply/budget.js';
import type { ListByMarker } from '../apply/inflight.js';
import { apiKeyForProfile, loadEnv, secretsOf } from '../config/env.js';
import { loadProfile } from '../config/profile.js';
import { logger } from '../log/logger.js';
import { parseMarker } from '../ledger/marker.js';
import type { LedgerStore } from '../ledger/store.js';

/**
 * The same marker scan apply uses, so `ledger resolve --adopt <id>` can check
 * the id it is handed. Assets carry the marker in `description`; hubs and
 * pages carry it in `meta.lgcMarker`; every other kind uses `description`.
 */
export function markerScanner(store: LedgerStore, profileName: string): ListByMarker {
  return async (marker) => {
    const env = loadEnv();
    logger.setSecrets(secretsOf(env));
    const profile = loadProfile(profileName);
    const apiKey = apiKeyForProfile(profileName);
    const api = new ApiClient({ profile, apiKey, budget: Budget.open(budgetIdentity(profile.teamId, apiKey)) });
    const team = `/api/v1/teams/${profile.teamId}`;
    const entry = store.find(marker);
    const parsed = parseMarker(marker);

    const byDescription = async (path: string): Promise<string[]> => {
      const found: string[] = [];
      for await (const row of api.listAll<{ id: string; attributes?: { description?: string | null } }>(path)) {
        if (row.attributes?.description === marker) found.push(row.id);
      }
      return found;
    };
    const byMeta = async (path: string): Promise<string[]> => {
      const found: string[] = [];
      for await (const row of api.listAll<{ id: string; attributes?: { meta?: Record<string, unknown> } }>(path)) {
        if (row.attributes?.meta?.['lgcMarker'] === marker) found.push(row.id);
      }
      return found;
    };

    if (parsed?.kind === 'asset' || entry?.kind === 'asset') return byDescription(`${team}/files`);
    switch (entry?.kind) {
      case 'hub': return byMeta(`${team}/hubs/`);
      case 'page': {
        const hubId = store.header.targetHubId;
        return hubId ? byMeta(`${team}/hubs/${hubId}/pages/`) : [];
      }
      case 'playlist': return byDescription(`${team}/playlists`);
      case 'folder': return byDescription(`${team}/folders`);
      case 'achievement': return byDescription(`${team}/achievements`);
      case 'segment': return byDescription(`${team}/segments`);
      case 'space': {
        const hubId = store.header.targetHubId;
        return hubId ? byDescription(`/api/v1/admin/teams/${profile.teamId}/hubs/${hubId}/spaces/`) : [];
      }
      default: return [];
    }
  };
}
