import type { Env } from '../config/env.js';
import { apiKeyForProfileOrNull } from '../config/env.js';
import type { Profile } from '../config/profile.js';
import { logger } from '../log/logger.js';

export interface ApiAuth {
  /** Sent as `Authorization: Bearer`, whether a static key or a user JWT. */
  token: string;
  /** Stable per identity so the budget window survives across runs. */
  budgetSubject: string;
  kind: 'api-key' | 'jwt';
}

/**
 * A static `V3_API_KEY_<PROFILE>` wins. Without one, log in as the verify user
 * through the backend's own login route (app/auth/router.py:185) and use the
 * access token, so nobody has to mint a key for a one-off run.
 */
export async function resolveApiAuth(
  profile: Profile,
  env: Pick<Env, 'v3VerifyLoginEmail' | 'v3VerifyLoginPassword'>,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiAuth> {
  const key = apiKeyForProfileOrNull(profile.name);
  if (key) return { token: key, budgetSubject: key, kind: 'api-key' };

  if (!env.v3VerifyLoginEmail || env.v3VerifyLoginEmail === 'unset') {
    throw new Error(
      `profile "${profile.name}" has no static API key and V3_VERIFY_LOGIN_EMAIL is empty; set one of them in .env`,
    );
  }
  const response = await fetchImpl(`${profile.apiBase.replace(/\/$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: env.v3VerifyLoginEmail, password: env.v3VerifyLoginPassword }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`login as ${env.v3VerifyLoginEmail} at ${profile.apiBase} returned ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('the login response carried no access_token');
  logger.info('authenticated with a user login instead of a static API key', {
    email: env.v3VerifyLoginEmail,
    expiresInSeconds: body.expires_in ?? null,
  });
  return { token: body.access_token, budgetSubject: env.v3VerifyLoginEmail, kind: 'jwt' };
}
