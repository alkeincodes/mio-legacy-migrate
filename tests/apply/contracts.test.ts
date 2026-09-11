import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertContract,
  loadContracts,
  MissingContractError,
} from '../../src/apply/contracts.js';

function writeTable(rows: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'contracts-'));
  const path = join(dir, 'contracts.md');
  writeFileSync(
    path,
    [
      '# V3 entity contracts',
      '',
      '| entity | create | marker field | marker strategy | list by marker | revision token | idempotency | verified |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      '## Known limits',
      'prose that is not a row',
    ].join('\n'),
    'utf8',
  );
  return path;
}

describe('loadContracts', () => {
  it('parses a row into an EntityContract', () => {
    const path = writeTable([
      '| page | `POST /pages/` | `meta.lgcMarker` | field | `GET /pages/` | `draft_version` | none | yes |',
    ]);
    const contracts = loadContracts(path);
    const page = contracts.get('page');
    expect(page).toEqual({
      entity: 'page',
      createCall: 'POST /pages/',
      markerField: 'meta.lgcMarker',
      markerStrategy: 'field',
      listByMarkerCall: 'GET /pages/',
      revisionTokenField: 'draft_version',
      idempotencyHeader: null,
      verified: true,
      notes: '',
    });
  });

  it('reads "none" as null for the nullable columns', () => {
    const path = writeTable([
      '| folder | `POST /folders` | `name` | name-suffix | `GET /folders` | none | none | yes |',
    ]);
    const folder = loadContracts(path).get('folder');
    expect(folder?.revisionTokenField).toBeNull();
    expect(folder?.idempotencyHeader).toBeNull();
    expect(folder?.markerStrategy).toBe('name-suffix');
  });

  it('ignores rows whose entity is not a known EntityKind', () => {
    const path = writeTable([
      '| wombat | `POST /wombats` | `x` | field | `GET /wombats` | none | none | yes |',
    ]);
    expect(loadContracts(path).size).toBe(0);
  });
});

describe('assertContract', () => {
  it('returns the contract when the row is present and verified', () => {
    const path = writeTable([
      '| hub | `POST /hubs/` | `meta.lgcMarker` | field | `GET /hubs/` | `ETag` | none | yes |',
    ]);
    const contracts = loadContracts(path);
    expect(assertContract(contracts, 'hub').entity).toBe('hub');
  });

  it('throws MissingContractError when the row is absent', () => {
    const contracts = loadContracts(writeTable([]));
    expect(() => assertContract(contracts, 'segment')).toThrow(MissingContractError);
    expect(() => assertContract(contracts, 'segment')).toThrow(
      /no contract for entity "segment"/,
    );
  });

  it('throws MissingContractError when the row is present but unverified', () => {
    const path = writeTable([
      '| segment | `POST /segments` | UNVERIFIED | field | `GET /segments` | none | none | no |',
    ]);
    const contracts = loadContracts(path);
    expect(() => assertContract(contracts, 'segment')).toThrow(
      /contract for entity "segment" is not verified/,
    );
  });
});

describe('the committed contracts.md', () => {
  it('covers every entity kind apply can mutate, all verified', () => {
    const contracts = loadContracts(
      new URL('../../docs/contracts.md', import.meta.url).pathname,
    );
    for (const entity of [
      'hub',
      'page',
      'playlist',
      'folder',
      'asset',
      'space',
      'achievement',
      'segment',
      'accessRule',
      'navigation',
    ] as const) {
      expect(() => assertContract(contracts, entity)).not.toThrow();
    }
  });
});
