import { describe, expect, it, vi } from 'vitest';
import {
  adoptOrCreate, NeedsHumanResolution, settleAndList, UncertainOutcome,
} from '../../src/apply/inflight.js';

const noSleep = async (): Promise<void> => {};

describe('adoptOrCreate', () => {
  it('creates when nothing carries the marker', async () => {
    const onCreated = vi.fn();
    const id = await adoptOrCreate({
      marker: 'm1', list: async () => [], create: async () => 'pg_new',
      onIntent: vi.fn(), onAdopted: vi.fn(), onCreated,
    });
    expect(id).toBe('pg_new');
    expect(onCreated).toHaveBeenCalledWith('pg_new');
  });

  it('adopts without creating when exactly one target carries the marker', async () => {
    const create = vi.fn(async () => 'pg_new');
    const onAdopted = vi.fn();
    const id = await adoptOrCreate({
      marker: 'm1', list: async () => ['pg_existing'], create,
      onIntent: vi.fn(), onAdopted, onCreated: vi.fn(),
    });
    expect(id).toBe('pg_existing');
    expect(create).not.toHaveBeenCalled();
    expect(onAdopted).toHaveBeenCalledWith('pg_existing');
  });

  it('stops for a human when two targets carry the marker', async () => {
    await expect(
      adoptOrCreate({
        marker: 'm1', list: async () => ['a', 'b'], create: async () => 'c',
        onIntent: vi.fn(), onAdopted: vi.fn(), onCreated: vi.fn(),
      }),
    ).rejects.toThrow(NeedsHumanResolution);
  });

  it('records the intent before touching the target', async () => {
    const order: string[] = [];
    await adoptOrCreate({
      marker: 'm1',
      list: async () => { order.push('list'); return []; },
      create: async () => { order.push('create'); return 'x'; },
      onIntent: () => order.push('intent'),
      onAdopted: vi.fn(), onCreated: vi.fn(),
    });
    expect(order).toEqual(['intent', 'list', 'create']);
  });

  it('turns an uncertain create into a NeedsHumanResolution with the candidates it saw', async () => {
    let calls = 0;
    const error = await adoptOrCreate({
      marker: 'm1', list: async () => (calls++ === 0 ? [] : ['maybe_created']),
      create: async () => { throw new UncertainOutcome('socket hang up'); },
      onIntent: vi.fn(), onAdopted: vi.fn(), onCreated: vi.fn(), sleep: noSleep,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NeedsHumanResolution);
    expect((error as NeedsHumanResolution).candidates).toEqual(['maybe_created']);
    expect((error as Error).message).toContain('ledger resolve');
  });

  it('lets a definite error through untouched, so a 422 is not mistaken for an in-flight create', async () => {
    await expect(
      adoptOrCreate({
        marker: 'm1', list: async () => [],
        create: async () => { throw new Error('422 invalid_tree'); },
        onIntent: vi.fn(), onAdopted: vi.fn(), onCreated: vi.fn(),
      }),
    ).rejects.toThrow(/422 invalid_tree/);
  });
});

describe('settleAndList', () => {
  it('waits the settle window and polls three times', async () => {
    const sleeps: number[] = [];
    const list = vi.fn(async () => []);
    await settleAndList({ marker: 'm1', list, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps[0]).toBe(60_000);
    expect(sleeps.slice(1)).toEqual([30_000, 30_000]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('returns as soon as a poll finds a match', async () => {
    const list = vi.fn(async () => ['found']);
    expect(await settleAndList({ marker: 'm1', list, sleep: noSleep })).toEqual(['found']);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
