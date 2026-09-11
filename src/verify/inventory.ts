import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerFile } from '../ledger/schema.js';

export interface InventoryRow {
  legacyHubId: number;
  runId: string;
  legacyMediaId: number;
  variant: string;
  state: 'legacy-linked' | 'pending-import' | 'pending-copy';
  legacyCdnUrl: string;
}

export function buildInventory(profileName: string, ledgerRoot = 'ledger'): InventoryRow[] {
  const profileDir = join(ledgerRoot, profileName);
  if (!existsSync(profileDir)) return [];

  const rows: InventoryRow[] = [];
  for (const hubDir of readdirSync(profileDir)) {
    const dir = join(profileDir, hubDir);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const ledger = JSON.parse(readFileSync(join(dir, file), 'utf8')) as LedgerFile;
      for (const entry of ledger.entries) {
        if (entry.state !== 'legacy-linked' && entry.state !== 'pending-import' && entry.state !== 'pending-copy') continue;
        rows.push({
          legacyHubId: ledger.header.legacyHubId,
          runId: ledger.header.runId,
          legacyMediaId: entry.legacyId,
          variant: entry.variant ?? 'original',
          state: entry.state,
          legacyCdnUrl: entry.asset?.legacyCdnUrl ?? '',
        });
      }
    }
  }
  return rows;
}

export function renderInventory(rows: InventoryRow[]): string {
  if (rows.length === 0) {
    return 'No legacy-linked or pending-import assets remain, so legacy serving can be switched off for every hub under this profile. That is the M2 exit condition.';
  }
  const lines: string[] = [
    `${rows.length} asset(s) still depend on legacy serving, so legacy serving cannot be switched off:`,
    '',
    'hub    run                  media      variant     state           url',
  ];
  for (const row of rows) {
    lines.push(
      `${String(row.legacyHubId).padEnd(7)}${row.runId.padEnd(21)}${String(row.legacyMediaId).padEnd(11)}${row.variant.padEnd(12)}${row.state.padEnd(16)}${row.legacyCdnUrl}`,
    );
  }
  return lines.join('\n');
}
