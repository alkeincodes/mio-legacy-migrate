import { describe, expect, it, vi } from 'vitest';
import { preflight, PreflightError } from '../../src/apply/preflight.js';
import type { Profile } from '../../src/config/profile.js';

const profile: Profile = {
  name: 'mantalks-prod', apiBase: 'https://api.member.dev',
  teamId: '01a090ff-5ac3-7402-b686-66fd46af67bc', bucket: 'b',
  region: 'us-east-1', cdnBase: 'https://cdn.example.com',
};

function cliWith(whoami: Record<string, unknown>) {
  return { json: vi.fn(() => whoami) } as unknown as Parameters<typeof preflight>[0]['cli'];
}

function apiWith(team: string) {
  return {
    get: vi.fn(async () => ({ body: { data: { id: team } }, etag: null })),
  } as unknown as Parameters<typeof preflight>[0]['api'];
}

describe('preflight', () => {
  it('passes when the CLI session and the API key both resolve to the profile', async () => {
    await expect(
      preflight({
        profile, apiKey: 'mio_sk_test',
        cli: cliWith({ team_id: profile.teamId, api_base: profile.apiBase }),
        api: apiWith(profile.teamId),
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses when the CLI session points at a different team', async () => {
    await expect(
      preflight({
        profile, apiKey: 'mio_sk_test',
        cli: cliWith({ team_id: 'some-other-team', api_base: profile.apiBase }),
        api: apiWith(profile.teamId),
      }),
    ).rejects.toThrow(PreflightError);
  });

  it('refuses when the CLI session points at a different API base', async () => {
    await expect(
      preflight({
        profile, apiKey: 'mio_sk_test',
        cli: cliWith({ team_id: profile.teamId, api_base: 'https://api.staging.example.com' }),
        api: apiWith(profile.teamId),
      }),
    ).rejects.toThrow(/api base/i);
  });

  it('refuses when the API key resolves to a different team', async () => {
    await expect(
      preflight({
        profile, apiKey: 'mio_sk_test',
        cli: cliWith({ team_id: profile.teamId, api_base: profile.apiBase }),
        api: apiWith('some-other-team'),
      }),
    ).rejects.toThrow(/api key/i);
  });
});
