import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiAuth } from '../../src/apply/auth.js';
import type { Profile } from '../../src/config/profile.js';

const profile: Profile = {
  name: 'mantalks-prod', apiBase: 'https://api.example.com', teamId: 'team-1',
  bucket: 'b', region: 'us-east-1', cdnBase: 'https://cdn.example.com', cdnBaseConfirmed: true, hubBase: 'https://hub.example.com', legacyHubLoginEmail: '', legacyHubLoginPassword: '', v3VerifyLoginEmail: '', v3VerifyLoginPassword: '', v3PlatformLoginEmail: '', v3PlatformLoginPassword: '',
};

afterEach(() => { delete process.env.V3_API_KEY_MANTALKS_PROD; });

describe('resolveApiAuth', () => {
  it('prefers the static API key when the profile has one', async () => {
    process.env.V3_API_KEY_MANTALKS_PROD = 'mio_sk_static';
    const fetchImpl = vi.fn();
    const auth = await resolveApiAuth(profile, { v3VerifyLoginEmail: 'a@b.c', v3VerifyLoginPassword: 'pw' }, fetchImpl as unknown as typeof fetch);
    expect(auth).toEqual({ token: 'mio_sk_static', budgetSubject: 'mio_sk_static', kind: 'api-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs in through the backend login route when no key is set and keys the budget by email', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.example.com/api/v1/auth/login');
      expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.c', password: 'pw' });
      return new Response(JSON.stringify({ access_token: 'jwt-1', refresh_token: 'r', token_type: 'Bearer', expires_in: 900 }), { status: 200 });
    }) as unknown as typeof fetch;
    const auth = await resolveApiAuth(profile, { v3VerifyLoginEmail: 'a@b.c', v3VerifyLoginPassword: 'pw' }, fetchImpl);
    expect(auth).toEqual({ token: 'jwt-1', budgetSubject: 'a@b.c', kind: 'jwt' });
  });

  it('fails clearly when neither a key nor a login is configured', async () => {
    await expect(
      resolveApiAuth(profile, { v3VerifyLoginEmail: 'unset', v3VerifyLoginPassword: 'unset' }, vi.fn() as unknown as typeof fetch),
    ).rejects.toThrow(/neither V3_PLATFORM_LOGIN_EMAIL nor V3_VERIFY_LOGIN_EMAIL/);
  });

  it('surfaces a refused login with its status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(
      resolveApiAuth(profile, { v3VerifyLoginEmail: 'a@b.c', v3VerifyLoginPassword: 'bad' }, fetchImpl),
    ).rejects.toThrow(/returned 401/);
  });
});
