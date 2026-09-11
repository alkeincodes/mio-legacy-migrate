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
  env: Pick<Env, 'v3VerifyLoginEmail' | 'v3VerifyLoginPassword'> & Partial<Pick<Env, 'v3PlatformLoginEmail' | 'v3PlatformLoginPassword'>>,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiAuth> {
  const key = apiKeyForProfileOrNull(profile.name);
  if (key) return { token: key, budgetSubject: key, kind: 'api-key' };

  // The API login is the platform (team user) login. The verify login is a hub
  // member, which the platform route does not know, so it is only a fallback.
  let email = env.v3PlatformLoginEmail ?? '';
  let password = env.v3PlatformLoginPassword ?? '';
  if (!email) {
    email = env.v3VerifyLoginEmail;
    password = env.v3VerifyLoginPassword;
    logger.warn('V3_PLATFORM_LOGIN_EMAIL is empty; using V3_VERIFY_LOGIN_EMAIL for the API login, which only works while that is a platform user');
  }
  if (!email || email === 'unset') {
    throw new Error(
      `profile "${profile.name}" has no static API key and neither V3_PLATFORM_LOGIN_EMAIL nor V3_VERIFY_LOGIN_EMAIL is set in .env`,
    );
  }
  const response = await fetchImpl(`${profile.apiBase.replace(/\/$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`login as ${email} at ${profile.apiBase} returned ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('the login response carried no access_token');
  logger.info('authenticated with a user login instead of a static API key', {
    email,
    expiresInSeconds: body.expires_in ?? null,
  });
  return { token: body.access_token, budgetSubject: email, kind: 'jwt' };
}
