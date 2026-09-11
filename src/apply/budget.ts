import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type BudgetOp =
  | 'pages.create' | 'pages.tree_write' | 'pages.publish' | 'pages.update'
  | 'hubs.create' | 'hubs.update';

/**
 * From the limiters registered in mio-backend:
 *   app/pages/router.py:137-172   create 60, update 60, publish 60, tree_write 120
 *   app/hubs/router.py:101-106    create 60, update 60
 * All are one-hour windows, and all are keyed on client IP server-side, so these
 * counts are a lower bound on true usage. A 429 is the only reliable signal.
 */
export const BUDGET_LIMITS: Record<BudgetOp, number> = {
  'pages.create': 60,
  'pages.update': 60,
  'pages.publish': 60,
  'pages.tree_write': 120,
  'hubs.create': 60,
  'hubs.update': 60,
};

const WINDOW_MS = 60 * 60 * 1000;

export class BudgetExhaustedError extends Error {
  constructor(message: string, readonly availableAt: Date) {
    super(message);
    this.name = 'BudgetExhaustedError';
  }
}

export function budgetIdentity(teamId: string, apiKey: string): string {
  return `${teamId}:${createHash('sha256').update(apiKey).digest('hex').slice(0, 8)}`;
}

interface BudgetFile {
  writes: Partial<Record<BudgetOp, number[]>>;
  exhaustedUntil: Partial<Record<BudgetOp, number>>;
}

export class Budget {
  private constructor(
    private readonly path: string,
    private readonly file: BudgetFile,
    private readonly now: () => Date,
  ) {}

  static open(identity: string, dir = 'state/budget', now: () => Date = () => new Date()): Budget {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${identity.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
    const file: BudgetFile = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as BudgetFile)
      : { writes: {}, exhaustedUntil: {} };
    return new Budget(path, file, now);
  }

  private window(op: BudgetOp): number[] {
    const cutoff = this.now().getTime() - WINDOW_MS;
    const kept = (this.file.writes[op] ?? []).filter((t) => t > cutoff);
    this.file.writes[op] = kept;
    return kept;
  }

  remaining(op: BudgetOp): number {
    return Math.max(0, BUDGET_LIMITS[op] - this.window(op).length);
  }

  earliestAvailable(op: BudgetOp): Date {
    const blocked = this.file.exhaustedUntil[op];
    if (blocked && blocked > this.now().getTime()) return new Date(blocked);
    const oldest = this.window(op)[0];
    return oldest === undefined ? this.now() : new Date(oldest + WINDOW_MS);
  }

  assertCanSpend(op: BudgetOp, count: number): void {
    const blocked = this.file.exhaustedUntil[op];
    if (blocked && blocked > this.now().getTime()) {
      throw new BudgetExhaustedError(
        `${op} is rate limited until ${new Date(blocked).toISOString()} (a 429 with Retry-After)`,
        new Date(blocked),
      );
    }
    if (this.remaining(op) < count) {
      const availableAt = this.earliestAvailable(op);
      throw new BudgetExhaustedError(
        `${op} has ${this.remaining(op)} of ${BUDGET_LIMITS[op]} writes left in the hour and this pass needs ${count}; the earliest it can continue is ${availableAt.toISOString()}`,
        availableAt,
      );
    }
  }

  record(op: BudgetOp): void {
    this.window(op).push(this.now().getTime());
    this.flush();
  }

  exhaustUntil(op: BudgetOp, until: Date): void {
    this.file.exhaustedUntil[op] = until.getTime();
    this.flush();
  }

  private flush(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.file), 'utf8');
    renameSync(tmp, this.path);
  }
}
