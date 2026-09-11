import { createHash } from 'node:crypto';

function short(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

export function sourceHash(host: string): string {
  return short(host);
}

/**
 * The generation component of an asset marker: a changed source object produces
 * a different marker, so a stale allocation is never re-adopted and a lookup
 * never returns two generations for one legacy media.
 */
export function generationHash(bucket: string, key: string, versionIdOrEtag: string): string {
  return short(`${bucket} ${key} ${versionIdOrEtag}`);
}

export function recordMarker(host: string, legacyId: number, runId: string): string {
  return `lgc:${sourceHash(host)}:${legacyId}:run:${runId}`;
}

export function assetMarker(
  host: string,
  legacyMediaId: number,
  variant: string,
  gen: string,
): string {
  return `lgc:${sourceHash(host)}:${legacyMediaId}:${variant}:g:${gen}`;
}

export type ParsedMarker =
  | { kind: 'record'; source: string; legacyId: number; runId: string }
  | { kind: 'asset'; source: string; legacyMediaId: number; variant: string; gen: string };

export function parseMarker(marker: string): ParsedMarker | null {
  const record = /^lgc:([0-9a-f]{8}):(\d+):run:(.+)$/.exec(marker);
  if (record) {
    return {
      kind: 'record',
      source: record[1] ?? '',
      legacyId: Number(record[2]),
      runId: record[3] ?? '',
    };
  }
  const asset = /^lgc:([0-9a-f]{8}):(\d+):([^:]+):g:([0-9a-f]{8})$/.exec(marker);
  if (asset) {
    return {
      kind: 'asset',
      source: asset[1] ?? '',
      legacyMediaId: Number(asset[2]),
      variant: asset[3] ?? '',
      gen: asset[4] ?? '',
    };
  }
  return null;
}
