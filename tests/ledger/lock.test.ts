import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertLedgerClean, Lock, LockHeldError, LedgerDirtyError, readLock, STALE_AFTER_MS,
} from '../../src/ledger/lock.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'lock-'));
}

describe('Lock.acquire', () => {
  it('writes a lock file carrying operator, host, run id and a heartbeat', () => {
    const d = dir();
    const lock = Lock.acquire(d, 'run-1');
    const contents = readLock(d);
    expect(contents?.runId).toBe('run-1');
    expect(contents?.operator.length).toBeGreaterThan(0);
    expect(contents?.host.length).toBeGreaterThan(0);
    expect(Date.parse(contents?.heartbeatAt ?? '')).not.toBeNaN();
    lock.release();
  });

  it('refuses while another lock heartbeat is fresh, and names the owner', () => {
    const d = dir();
    Lock.acquire(d, 'run-1');
    expect(() => Lock.acquire(d, 'run-2')).toThrow(LockHeldError);
    try {
      Lock.acquire(d, 'run-2');
    } catch (error) {
      expect((error as LockHeldError).lock.runId).toBe('run-1');
      expect((error as Error).message).toContain('--break-lock');
    }
  });

  it('still refuses a stale lock without --break-lock, so staleness alone is never enough', () => {
    const d = dir();
    const stale = new Date(Date.now() - STALE_AFTER_MS - 1_000).toISOString();
    writeFileSync(
      join(d, '.lock'),
      JSON.stringify({ operator: 'other', host: 'other-mac', runId: 'run-0', heartbeatAt: stale }),
      'utf8',
    );
    expect(() => Lock.acquire(d, 'run-2')).toThrow(LockHeldError);
  });

  it('clears a stale lock with --break-lock', () => {
    const d = dir();
    const stale = new Date(Date.now() - STALE_AFTER_MS - 1_000).toISOString();
    writeFileSync(
      join(d, '.lock'),
      JSON.stringify({ operator: 'other', host: 'other-mac', runId: 'run-0', heartbeatAt: stale }),
      'utf8',
    );
    const lock = Lock.acquire(d, 'run-2', { breakLock: true });
    expect(readLock(d)?.runId).toBe('run-2');
    lock.release();
  });

  it('refuses to break a lock whose heartbeat is still fresh, even with --break-lock', () => {
    const d = dir();
    Lock.acquire(d, 'run-1');
    expect(() => Lock.acquire(d, 'run-2', { breakLock: true })).toThrow(/heartbeat is still fresh/);
  });

  it('removes the lock file on release', () => {
    const d = dir();
    Lock.acquire(d, 'run-1').release();
    expect(existsSync(join(d, '.lock'))).toBe(false);
  });

  it('moves the heartbeat forward', () => {
    const d = dir();
    let now = new Date('2026-09-12T10:00:00.000Z');
    const lock = Lock.acquire(d, 'run-1', { now: () => now });
    now = new Date('2026-09-12T10:00:30.000Z');
    lock.heartbeat();
    expect(readLock(d)?.heartbeatAt).toBe('2026-09-12T10:00:30.000Z');
    lock.release();
  });
});

describe('assertLedgerClean', () => {
  it('passes when the ledger directory has no changes and no unpushed commits', () => {
    const git = vi.fn(() => ({ status: 0, stdout: '' }));
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).not.toThrow();
  });

  it('refuses when the ledger directory has uncommitted changes', () => {
    const git = vi.fn((args: string[]) =>
      args[0] === 'status'
        ? { status: 0, stdout: ' M ledger/mantalks-prod/7/run-1.json' }
        : { status: 0, stdout: '' },
    );
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).toThrow(LedgerDirtyError);
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).toThrow(/uncommitted/);
  });

  it('passes a clean clone with no upstream, warning instead of failing the fetch', () => {
    const git = vi.fn((args: string[]) =>
      args[0] === 'rev-parse' ? { status: 128, stdout: 'fatal: no upstream configured' } : { status: 0, stdout: '' },
    );
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).not.toThrow();
    expect(git).not.toHaveBeenCalledWith(['fetch', '--quiet']);
  });

  it('refuses when the branch is behind the remote, so another operator run is invisible', () => {
    const git = vi.fn((args: string[]) => {
      if (args[0] === 'rev-list') return { status: 0, stdout: '0 3' };
      return { status: 0, stdout: '' };
    });
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).toThrow(/behind the remote by 3/);
  });

  it('refuses when git itself fails rather than assuming the tree is clean', () => {
    const git = vi.fn(() => ({ status: 128, stdout: 'fatal: not a git repository' }));
    expect(() => assertLedgerClean('ledger/mantalks-prod/7', git)).toThrow(/git status failed/);
  });
});
