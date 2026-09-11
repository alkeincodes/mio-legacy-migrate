import { readFileSync } from 'node:fs';

export type EntityKind =
  | 'hub'
  | 'page'
  | 'playlist'
  | 'folder'
  | 'asset'
  | 'space'
  | 'achievement'
  | 'segment'
  | 'accessRule'
  | 'navigation';

const ENTITY_KINDS = new Set<string>([
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
]);

export type MarkerStrategy = 'field' | 'name-suffix' | 'none';

export interface EntityContract {
  entity: EntityKind;
  createCall: string;
  markerField: string | null;
  markerStrategy: MarkerStrategy;
  listByMarkerCall: string;
  revisionTokenField: string | null;
  idempotencyHeader: string | null;
  verified: boolean;
  notes: string;
}

export class MissingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingContractError';
  }
}

/** Strips markdown backticks and trims; maps the literal "none" to null. */
function cell(raw: string): string {
  return raw.trim().replace(/^`+|`+$/g, '').trim();
}

function nullableCell(raw: string): string | null {
  const value = cell(raw);
  return value === '' || value.toLowerCase() === 'none' ? null : value;
}

export function loadContracts(markdownPath: string): Map<EntityKind, EntityContract> {
  const contracts = new Map<EntityKind, EntityContract>();
  for (const line of readFileSync(markdownPath, 'utf8').split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.length < 8) continue;
    const entity = cell(cells[0] ?? '');
    if (!ENTITY_KINDS.has(entity)) continue;
    contracts.set(entity as EntityKind, {
      entity: entity as EntityKind,
      createCall: cell(cells[1] ?? ''),
      markerField: nullableCell(cells[2] ?? ''),
      markerStrategy: (cell(cells[3] ?? '') || 'none') as MarkerStrategy,
      listByMarkerCall: cell(cells[4] ?? ''),
      revisionTokenField: nullableCell(cells[5] ?? ''),
      idempotencyHeader: nullableCell(cells[6] ?? ''),
      verified: cell(cells[7] ?? '').toLowerCase() === 'yes',
      notes: cells.length > 8 ? cell(cells[8] ?? '') : '',
    });
  }
  return contracts;
}

export function assertContract(
  contracts: Map<EntityKind, EntityContract>,
  entity: EntityKind,
): EntityContract {
  const contract = contracts.get(entity);
  if (!contract) {
    throw new MissingContractError(
      `docs/contracts.md has no contract for entity "${entity}"; apply refuses to mutate it`,
    );
  }
  if (!contract.verified) {
    throw new MissingContractError(
      `the contract for entity "${entity}" is not verified; apply refuses to mutate it`,
    );
  }
  return contract;
}
