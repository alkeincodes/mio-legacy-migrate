import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEDGER_VERSION, type LedgerEntry, type LedgerFile, type LedgerHeader,
} from './schema.js';

export class LedgerMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerMismatchError';
  }
}

export function ledgerDir(profileName: string, legacyHubId: number): string {
  return `ledger/${profileName}/${legacyHubId}`;
}

const COMPARED_HEADER_FIELDS = [
  'sourceHost', 'legacyHubId', 'profileName', 'targetApiBase', 'targetTeamId', 'planHash',
] as const;

export class LedgerStore {
  private constructor(
    readonly path: string,
    private file: LedgerFile,
  ) {}

  static create(dir: string, header: LedgerHeader): LedgerStore {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${header.runId}.json`);
    const store = new LedgerStore(path, { header, entries: [] });
    store.flush();
    return store;
  }

  static open(dir: string, runId: string): LedgerStore {
    const path = join(dir, `${runId}.json`);
    if (!existsSync(path)) throw new LedgerMismatchError(`no ledger at ${path}`);
    let parsed: LedgerFile;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as LedgerFile;
    } catch {
      throw new LedgerMismatchError(`${path} is not valid JSON; restore it from git or start a new run`);
    }
    if (parsed.header?.ledgerVersion !== LEDGER_VERSION) {
      throw new LedgerMismatchError(
        `${path} has ledger version ${String(parsed.header?.ledgerVersion)}, expected ${LEDGER_VERSION}`,
      );
    }
    return new LedgerStore(path, parsed);
  }

  static openForResume(
    dir: string,
    runId: string,
    expected: LedgerHeader,
    opts: { acceptPlanChange?: boolean } = {},
  ): LedgerStore {
    const store = LedgerStore.open(dir, runId);
    const actual = store.header;
    for (const field of COMPARED_HEADER_FIELDS) {
      if (field === 'planHash' && opts.acceptPlanChange) continue;
      if (actual[field] !== expected[field]) {
        throw new LedgerMismatchError(
          `cannot resume run ${runId}: ledger ${field} is ${JSON.stringify(actual[field])} but the current inputs give ${JSON.stringify(expected[field])}. Restore the original plan (its hash is in the header) to finish this run, or start a new one.`,
        );
      }
    }
    if (
      actual.targetHubId !== null &&
      expected.targetHubId !== null &&
      actual.targetHubId !== expected.targetHubId
    ) {
      throw new LedgerMismatchError(
        `cannot resume run ${runId}: ledger targetHubId is ${actual.targetHubId} but ${expected.targetHubId} was supplied`,
      );
    }
    return store;
  }

  get header(): LedgerHeader {
    return this.file.header;
  }

  /** Moves the header to a new plan hash, keeping the old one; call only after every done entry was checked. */
  acceptPlanChange(newPlanHash: string): void {
    if (this.file.header.planHash === newPlanHash) return;
    this.file.header.previousPlanHash = this.file.header.planHash;
    this.file.header.planHash = newPlanHash;
    this.flush();
  }

  setTargetHubId(id: string): void {
    this.file.header.targetHubId = id;
    this.flush();
  }

  upsert(entry: LedgerEntry): void {
    const index = this.file.entries.findIndex((e) => e.marker === entry.marker);
    if (index >= 0) this.file.entries[index] = entry;
    else this.file.entries.push(entry);
    this.flush();
  }

  find(marker: string): LedgerEntry | null {
    return this.file.entries.find((e) => e.marker === marker) ?? null;
  }

  byState(state: LedgerEntry['state']): LedgerEntry[] {
    return this.file.entries.filter((e) => e.state === state);
  }

  all(): LedgerEntry[] {
    return [...this.file.entries];
  }

  /** Write to a temp file in the same directory, fsync, rename. */
  flush(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.file, null, 2), { encoding: 'utf8', mode: 0o600 });
    const fd = openSync(tmp, 'r');
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, this.path);
  }
}
