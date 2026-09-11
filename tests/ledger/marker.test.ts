import { describe, expect, it } from 'vitest';
import { assetMarker, generationHash, parseMarker, recordMarker, sourceHash } from '../../src/ledger/marker.js';

describe('sourceHash', () => {
  it('is short, stable and host-specific', () => {
    expect(sourceHash('replica.example.com')).toHaveLength(8);
    expect(sourceHash('replica.example.com')).toBe(sourceHash('replica.example.com'));
    expect(sourceHash('other.example.com')).not.toBe(sourceHash('replica.example.com'));
  });
});

describe('recordMarker', () => {
  it('carries the run id so a fresh run never adopts an earlier run record', () => {
    expect(recordMarker('replica.example.com', 100, 'run-1')).not.toBe(
      recordMarker('replica.example.com', 100, 'run-2'),
    );
  });

  it('has the documented shape', () => {
    expect(recordMarker('replica.example.com', 100, 'run-1')).toBe(
      `lgc:${sourceHash('replica.example.com')}:100:run:run-1`,
    );
  });
});

describe('assetMarker', () => {
  it('omits the run id so assets are reused across fresh runs', () => {
    const gen = generationHash('b', 'k', 'v1');
    expect(assetMarker('replica.example.com', 91234, 'original', gen)).toBe(
      `lgc:${sourceHash('replica.example.com')}:91234:original:g:${gen}`,
    );
  });

  it('changes when the source generation changes, so a stale allocation is never re-adopted', () => {
    expect(assetMarker('h', 1, 'original', generationHash('b', 'k', 'v1'))).not.toBe(
      assetMarker('h', 1, 'original', generationHash('b', 'k', 'v2')),
    );
  });

  it('distinguishes variants of the same legacy media', () => {
    const gen = generationHash('b', 'k', 'v1');
    expect(assetMarker('h', 1, 'original', gen)).not.toBe(assetMarker('h', 1, 'thumb', gen));
  });
});

describe('parseMarker', () => {
  it('round-trips a record marker', () => {
    expect(parseMarker(recordMarker('replica.example.com', 100, 'run-1'))).toEqual({
      kind: 'record', source: sourceHash('replica.example.com'), legacyId: 100, runId: 'run-1',
    });
  });

  it('round-trips an asset marker', () => {
    const gen = generationHash('b', 'k', 'v1');
    expect(parseMarker(assetMarker('h', 91234, 'original', gen))).toEqual({
      kind: 'asset', source: sourceHash('h'), legacyMediaId: 91234, variant: 'original', gen,
    });
  });

  it('returns null for a string that is not one of ours', () => {
    expect(parseMarker('a lovely description written by a human')).toBeNull();
  });
});
