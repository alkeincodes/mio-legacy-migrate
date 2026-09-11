import type { Profile } from '../config/profile.js';
import type { ApiClient } from './api.js';
import type { MioCli } from './mioCli.js';
import { logger } from '../log/logger.js';

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

/**
 * Before any mutation, prove that the CLI session and the API key both resolve
 * to the selected profile's API base and team. A mismatch here is how a run
 * rebuilds a hub on the wrong team.
 */
export async function preflight(opts: {
  profile: Profile;
  apiKey: string;
  cli: MioCli;
  api: ApiClient;
}): Promise<void> {
  const whoami = opts.cli.json<{ team_id?: string; api_base?: string }>(['whoami']);
  if (whoami.team_id !== opts.profile.teamId) {
    throw new PreflightError(
      `the mio CLI session resolves to team ${String(whoami.team_id)} but profile "${opts.profile.name}" targets ${opts.profile.teamId}`,
    );
  }
  if (whoami.api_base !== undefined && whoami.api_base !== opts.profile.apiBase) {
    throw new PreflightError(
      `the mio CLI session resolves to api base ${whoami.api_base} but profile "${opts.profile.name}" targets ${opts.profile.apiBase}`,
    );
  }

  const team = await opts.api.get<{ data?: { id?: string } }>(`/api/v1/teams/${opts.profile.teamId}`);
  if (team.body.data?.id !== opts.profile.teamId) {
    throw new PreflightError(
      `the api key resolves to team ${String(team.body.data?.id)} but profile "${opts.profile.name}" targets ${opts.profile.teamId}`,
    );
  }

  logger.info('preflight passed', { profile: opts.profile.name, teamId: opts.profile.teamId });
}
