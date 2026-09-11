import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const STALE_AFTER_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export interface LockContents {
  operator: string;
  host: string;
  runId: string;
  heartbeatAt: string;
}

export class LockHeldError extends Error {
  constructor(message: string, readonly lock: LockContents) {
    super(message);
    this.name = 'LockHeldError';
  }
}

export class LedgerDirtyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerDirtyError';
  }
}

export function readLock(dir: string): LockContents | null {
  const path = join(dir, '.lock');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockContents;
  } catch {
    return null;
  }
}

export class Lock {
  private constructor(
    readonly path: string,
    private contents: LockContents,
    private readonly now: () => Date,
  ) {}

  static acquire(
    dir: string,
    runId: string,
    opts: { breakLock?: boolean; now?: () => Date } = {},
  ): Lock {
    const now = opts.now ?? (() => new Date());
    mkdirSync(dir, { recursive: true });
    const existing = readLock(dir);
    if (existing) {
      const age = now().getTime() - Date.parse(existing.heartbeatAt);
      const fresh = Number.isFinite(age) && age < STALE_AFTER_MS;
      if (fresh) {
        throw new LockHeldError(
          `a run is in progress: operator ${existing.operator} on ${existing.host}, run ${existing.runId}, heartbeat ${existing.heartbeatAt}. Its heartbeat is still fresh, so --break-lock will not clear it. Wait, or ask them to stop.`,
          existing,
        );
      }
      if (!opts.breakLock) {
        throw new LockHeldError(
          `a stale lock is present: operator ${existing.operator} on ${existing.host}, run ${existing.runId}, heartbeat ${existing.heartbeatAt}. Confirm nobody is running, then rerun with --break-lock.`,
          existing,
        );
      }
    }
    const contents: LockContents = {
      operator: userInfo().username,
      host: hostname(),
      runId,
      heartbeatAt: now().toISOString(),
    };
    const path = join(dir, '.lock');
    writeFileSync(path, JSON.stringify(contents, null, 2), { encoding: 'utf8', mode: 0o600 });
    return new Lock(path, contents, now);
  }

  heartbeat(): void {
    this.contents = { ...this.contents, heartbeatAt: this.now().toISOString() };
    writeFileSync(this.path, JSON.stringify(this.contents, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  release(): void {
    rmSync(this.path, { force: true });
  }
}

export type GitRunner = (args: string[]) => { status: number; stdout: string };

export const realGit: GitRunner = (args) => {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 30_000 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

/**
 * Ledgers are committed, so two operators on different clones only see each
 * other's runs when the directory is clean and current. This refuses to start
 * otherwise.
 */
export function assertLedgerClean(dir: string, git: GitRunner = realGit): void {
  const status = git(['status', '--porcelain', '--', dir]);
  if (status.status !== 0) {
    throw new LedgerDirtyError(`git status failed for ${dir}: ${status.stdout.trim()}`);
  }
  if (status.stdout.trim().length > 0) {
    throw new LedgerDirtyError(
      `the ledger directory ${dir} has uncommitted changes: ${status.stdout.trim()}. Commit or stash them before applying.`,
    );
  }

  const fetch = git(['fetch', '--quiet']);
  if (fetch.status !== 0) {
    throw new LedgerDirtyError(`git fetch failed: ${fetch.stdout.trim()}`);
  }
  const counts = git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (counts.status !== 0) {
    throw new LedgerDirtyError(`git rev-list failed: ${counts.stdout.trim()}`);
  }
  const [, behind = '0'] = counts.stdout.trim().split(/\s+/);
  if (Number(behind) > 0) {
    throw new LedgerDirtyError(
      `this clone is behind the remote by ${behind} commit(s); pull before applying so you can see other operators' ledgers`,
    );
  }
}
