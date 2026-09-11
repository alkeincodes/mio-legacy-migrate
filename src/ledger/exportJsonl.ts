import type { LedgerStore } from './store.js';

/**
 * One JSON object per entry, with every header field flattened onto it so each
 * row stands alone. This file is the interface to the backend lane until
 * MIO-3824 question 11 defines a target schema; when it does, add a --format.
 */
export function exportJsonl(store: LedgerStore): string {
  const header = store.header;
  return store
    .all()
    .map((entry) => JSON.stringify({ ...header, ...entry, asset: entry.asset ?? null }))
    .join('\n')
    .concat('\n');
}
