import { describe, expect, it, vi } from 'vitest';
import { ApiClient, PreconditionRequiredError, StaleRevisionError } from '../../src/apply/api.js';
import { UncertainOutcome } from '../../src/apply/inflight.js';
import { Budget } from '../../src/apply/budget.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Profile } from '../../src/config/profile.js';

const profile: Profile = {
  name: 'test', apiBase: 'https://api.example.com', teamId: 'team-1',
  bucket: 'b', region: 'us-east-1', cdnBase: 'https://cdn.example.com', cdnBaseConfirmed: true,
};

function client(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({
    profile, apiKey: 'mio_sk_test',
    budget: Budget.open('team-1:test', mkdtempSync(join(tmpdir(), 'budget-'))),
    fetchImpl,
  });
}

describe('ApiClient', () => {
  it('sends the API key as a bearer token', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mio_sk_test');
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await client(fetchImpl).get('/api/v1/teams/team-1/hubs/');
  });

  it('returns the ETag alongside the body, because the hub revision token lives there', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: 'hub_1' } }), {
        status: 200, headers: { ETag: '"tok-abc"' },
      }),
    ) as unknown as typeof fetch;
    const result = await client(fetchImpl).get('/api/v1/teams/team-1/hubs/hub_1');
    expect(result.etag).toBe('tok-abc');
  });

  it('sends If-Match unquoted on a page tree write and raises StaleRevisionError on 409', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['If-Match']).toBe('7');
      return new Response(JSON.stringify({ errors: [{ code: 'stale_draft' }] }), { status: 409 });
    }) as unknown as typeof fetch;
    await expect(
      client(fetchImpl).put('/api/v1/teams/team-1/hubs/h/pages/p/tree', { data: {} }, { ifMatch: '7' }),
    ).rejects.toThrow(StaleRevisionError);
  });

  it('raises PreconditionRequiredError on 428 rather than a generic failure', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ code: 'precondition_required' }] }), { status: 428 }),
    ) as unknown as typeof fetch;
    await expect(
      client(fetchImpl).put('/api/v1/x', { data: {} }),
    ).rejects.toThrow(PreconditionRequiredError);
  });

  it('treats a network abort on a mutation as an uncertain outcome, never a retryable failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(client(fetchImpl).post('/api/v1/x', { data: {} })).rejects.toThrow(UncertainOutcome);
  });

  it('honours Retry-After on a 429 by marking the budget exhausted', async () => {
    const budgetDir = mkdtempSync(join(tmpdir(), 'budget-'));
    const budget = Budget.open('team-1:test', budgetDir);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ code: 'rate_limited' }] }), {
        status: 429, headers: { 'Retry-After': '120' },
      }),
    ) as unknown as typeof fetch;
    const api = new ApiClient({ profile, apiKey: 'mio_sk_test', budget, fetchImpl });
    await expect(api.post('/api/v1/x', { data: {} }, 'pages.create')).rejects.toThrow(/rate limited/);
    expect(budget.earliestAvailable('pages.create').getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it('pages a list all the way through, since no list endpoint has a filter parameter', async () => {
    const pages = [
      { data: [{ id: 'a' }, { id: 'b' }], links: { next: '/api/teams/team-1/files?page[after]=b' } },
      { data: [{ id: 'c' }], links: {} },
    ];
    let i = 0;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(pages[i++]), { status: 200 })) as unknown as typeof fetch;
    const seen: string[] = [];
    for await (const row of client(fetchImpl).listAll<{ id: string }>('/api/v1/teams/team-1/files')) {
      seen.push(row.id);
    }
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
