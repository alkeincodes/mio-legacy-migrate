import { logger } from '../log/logger.js';
import type { ListByMarker } from '../apply/inflight.js';
import type { LedgerStore } from './store.js';

/**
 * The human half of the in-flight protocol. Shows the candidates and the entry,
 * then either adopts a chosen id or records that nothing was created, which lets
 * the next resume create again.
 */
export async function resolveEntry(opts: {
  store: LedgerStore;
  marker: string;
  list: ListByMarker;
  adopt?: string;
  confirmAbsent?: boolean;
}): Promise<'pending' | 'adopted' | 'absent'> {
  const entry = opts.store.find(opts.marker);
  if (!entry) throw new Error(`no ledger entry carries marker ${opts.marker}`);

  const candidates = await opts.list(opts.marker);

  if (!opts.adopt && !opts.confirmAbsent) {
    logger.info('ledger resolve: nothing chosen yet', {
      marker: opts.marker,
      entryState: entry.state,
      entryKind: entry.kind,
      legacyId: entry.legacyId,
      candidates,
    });
    return 'pending';
  }

  if (opts.adopt) {
    if (!candidates.includes(opts.adopt)) {
      throw new Error(
        `${opts.adopt} does not carry marker ${opts.marker}; candidates are ${candidates.join(', ') || 'none'}`,
      );
    }
    opts.store.upsert({
      ...entry,
      v3Id: opts.adopt,
      state: entry.asset ? 'allocated' : 'done',
      updatedAt: new Date().toISOString(),
    });
    logger.info('ledger resolve: adopted', { marker: opts.marker, v3Id: opts.adopt });
    return 'adopted';
  }

  if (candidates.length > 0) {
    throw new Error(
      `refusing --confirm-absent: ${candidates.length} target(s) still carry marker ${opts.marker} (${candidates.join(', ')})`,
    );
  }
  opts.store.upsert({ ...entry, v3Id: null, state: 'intent', updatedAt: new Date().toISOString() });
  logger.info('ledger resolve: confirmed absent, the next resume will create', { marker: opts.marker });
  return 'absent';
}
