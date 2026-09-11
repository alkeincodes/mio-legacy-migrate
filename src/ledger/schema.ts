import type { EntityKind } from '../apply/contracts.js';

export const LEDGER_VERSION = 1 as const;

export type RecordState = 'intent' | 'done' | 'target-edited';
export type AssetState =
  | 'intent' | 'allocated' | 'copied' | 'verified' | 'legacy-linked' | 'pending-import';

export interface AssetLedgerFields {
  sourceBucket: string;
  sourceKey: string;
  sourceEtag: string;
  sourceVersionId: string | null;
  sourceSizeBytes: number;
  sourceChecksumCrc64Nvme: string | null;
  v3MediaId: string | null;
  v3FileId: string | null;
  destinationKey: string | null;
  destinationSizeBytes: number | null;
  destinationChecksumCrc64Nvme: string | null;
  visibility: 'public' | 'restricted';
  legacyCdnUrl: string;
  /** Written by M2 when the backend import endpoint exists. Always null in M1. */
  importJobId: string | null;
}

export interface LedgerEntry {
  legacyTable: string;
  legacyId: number;
  kind: EntityKind;
  variant: string | null;
  marker: string;
  v3Id: string | null;
  state: RecordState | AssetState;
  runId: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  /** Hash over the resolved V3 ids this entry points at. Read by M3 upsert. */
  referenceHash: string | null;
  /** The target's revision token at the last successful write. Read by M3 upsert. */
  revisionToken: string | null;
  asset: AssetLedgerFields | null;
}

export interface LedgerHeader {
  ledgerVersion: typeof LEDGER_VERSION;
  toolVersion: string;
  sourceHost: string;
  legacyHubId: number;
  profileName: string;
  targetApiBase: string;
  targetTeamId: string;
  targetHubId: string | null;
  runId: string;
  planHash: string;
}

export interface LedgerFile {
  header: LedgerHeader;
  entries: LedgerEntry[];
}
