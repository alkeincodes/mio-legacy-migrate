import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget, BUDGET_LIMITS, BudgetExhaustedError, budgetIdentity } from '../../src/apply/budget.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'budget-'));
}

describe('BUDGET_LIMITS', () => {
  it('matches the limiters registered in mio-backend', () => {
    expect(BUDGET_LIMITS['pages.tree_write']).toBe(120);
    expect(BUDGET_LIMITS['pages.create']).toBe(60);
    expect(BUDGET_LIMITS['pages.publish']).toBe(60);
    expect(BUDGET_LIMITS['pages.update']).toBe(60);
    expect(BUDGET_LIMITS['hubs.create']).toBe(60);
    expect(BUDGET_LIMITS['hubs.update']).toBe(60);
  });
});

describe('budgetIdentity', () => {
  it('combines the team with a fingerprint of the key and never contains the key', () => {
    const identity = budgetIdentity('team-1', 'mio_sk_supersecret');
    expect(identity).toContain('team-1');
    expect(identity).not.toContain('supersecret');
  });
});

describe('Budget', () => {
  it('counts writes inside the sliding hour', () => {
    const budget = Budget.open('team-1:abcd', dir());
    budget.record('pages.publish');
    expect(budget.remaining('pages.publish')).toBe(59);
  });

  it('refuses to start a pass that would exceed the remaining window', () => {
    const now = new Date('2026-09-12T10:00:00.000Z');
    const budget = Budget.open('team-1:abcd', dir(), () => now);
    for (let i = 0; i < 58; i += 1) budget.record('pages.publish');
    expect(() => budget.assertCanSpend('pages.publish', 5)).toThrow(BudgetExhaustedError);
    expect(() => budget.assertCanSpend('pages.publish', 2)).not.toThrow();
  });

  it('names the earliest time it can continue', () => {
    const now = new Date('2026-09-12T10:00:00.000Z');
    const budget = Budget.open('team-1:abcd', dir(), () => now);
    for (let i = 0; i < 60; i += 1) budget.record('pages.publish');
    try {
      budget.assertCanSpend('pages.publish', 1);
      throw new Error('expected the budget to refuse');
    } catch (error) {
      expect((error as BudgetExhaustedError).availableAt.toISOString()).toBe('2026-09-12T11:00:00.000Z');
    }
  });

  it('drops writes older than an hour out of the window', () => {
    let now = new Date('2026-09-12T10:00:00.000Z');
    const budget = Budget.open('team-1:abcd', dir(), () => now);
    for (let i = 0; i < 60; i += 1) budget.record('pages.publish');
    now = new Date('2026-09-12T11:00:01.000Z');
    expect(budget.remaining('pages.publish')).toBe(60);
  });

  it('keeps separate windows per operation', () => {
    const budget = Budget.open('team-1:abcd', dir());
    for (let i = 0; i < 60; i += 1) budget.record('pages.publish');
    expect(budget.remaining('pages.tree_write')).toBe(120);
  });

  it('persists across processes so every run on this machine shares the window', () => {
    const d = dir();
    Budget.open('team-1:abcd', d).record('pages.publish');
    expect(Budget.open('team-1:abcd', d).remaining('pages.publish')).toBe(59);
  });

  it('honours a 429 by marking the window exhausted until Retry-After', () => {
    let now = new Date('2026-09-12T10:00:00.000Z');
    const budget = Budget.open('team-1:abcd', dir(), () => now);
    budget.exhaustUntil('pages.publish', new Date('2026-09-12T10:10:00.000Z'));
    expect(() => budget.assertCanSpend('pages.publish', 1)).toThrow(BudgetExhaustedError);
    now = new Date('2026-09-12T10:10:01.000Z');
    expect(() => budget.assertCanSpend('pages.publish', 1)).not.toThrow();
  });
});
