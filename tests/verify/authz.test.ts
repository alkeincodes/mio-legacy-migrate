import { describe, expect, it, vi } from 'vitest';
import { expectedOutcomes, isRefusal, runAuthorizationChecks, type AuthzTarget } from '../../src/verify/authz.js';

describe('expectedOutcomes', () => {
  it('expects a members-only rule to refuse anonymous and allow both members', () => {
    expect(expectedOutcomes('members')).toEqual({
      anonymous: 'refused', memberNoEntitlement: 'allowed', memberEntitled: 'allowed',
    });
  });

  it('expects an entitlement or segment rule to refuse the first two', () => {
    expect(expectedOutcomes('entitlement-or-segment')).toEqual({
      anonymous: 'refused', memberNoEntitlement: 'refused', memberEntitled: 'allowed',
    });
  });

  it('expects a public item to allow all three', () => {
    expect(expectedOutcomes('public')).toEqual({
      anonymous: 'allowed', memberNoEntitlement: 'allowed', memberEntitled: 'allowed',
    });
  });
});

describe('isRefusal', () => {
  it('treats 401, 403 and 404 as refusals, 404 because a target may hide existence', () => {
    expect(isRefusal(401, null)).toBe(true);
    expect(isRefusal(403, null)).toBe(true);
    expect(isRefusal(404, null)).toBe(true);
  });

  it('treats a redirect to login as a refusal', () => {
    expect(isRefusal(302, 'https://hub.member.dev/alliance/login?next=/x')).toBe(true);
  });

  it('does not treat a redirect elsewhere as a refusal', () => {
    expect(isRefusal(302, 'https://hub.member.dev/alliance/about')).toBe(false);
  });

  it('does not treat 200 as a refusal', () => {
    expect(isRefusal(200, null)).toBe(false);
  });
});

const target: AuthzTarget = {
  kind: 'asset', ref: 'file_1',
  url: 'https://hub.member.dev/alliance/media/file_1', rule: 'entitlement-or-segment',
};

describe('runAuthorizationChecks', () => {
  it('passes when every principal matches the expectation', async () => {
    const request = vi.fn(async (_url: string, principal: string) =>
      principal === 'memberEntitled' ? { status: 200, location: null } : { status: 403, location: null },
    );
    const [result] = await runAuthorizationChecks([target], request);
    expect(result?.pass).toBe(true);
  });

  it('fails when a restricted asset returns 200 anonymously', async () => {
    const request = vi.fn(async () => ({ status: 200, location: null }));
    const [result] = await runAuthorizationChecks([target], request);
    expect(result?.pass).toBe(false);
    expect(result?.reason).toContain('anonymous');
  });

  it('fails when the entitled member is refused', async () => {
    const request = vi.fn(async () => ({ status: 403, location: null }));
    const [result] = await runAuthorizationChecks([target], request);
    expect(result?.pass).toBe(false);
    expect(result?.reason).toContain('memberEntitled');
  });

  it('issues exactly three requests per target', async () => {
    const request = vi.fn(async () => ({ status: 403, location: null }));
    await runAuthorizationChecks([target], request);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('checks a public sample too, and fails it if anyone is refused', async () => {
    const request = vi.fn(async (_url: string, principal: string) =>
      principal === 'anonymous' ? { status: 403, location: null } : { status: 200, location: null },
    );
    const [result] = await runAuthorizationChecks([{ ...target, rule: 'public' }], request);
    expect(result?.pass).toBe(false);
  });
});
