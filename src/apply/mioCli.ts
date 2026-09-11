import { spawnSync } from 'node:child_process';
import type { Profile } from '../config/profile.js';

export type CliRunner = (args: string[]) => { status: number; stdout: string; stderr: string };

const realRunner: CliRunner = (args) => {
  const result = spawnSync('mio', args, { encoding: 'utf8', timeout: 120_000 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/**
 * A typed wrapper around the mio binary. Notes that cost time if forgotten:
 *   - the getter verb is `retrieve`, never `get`
 *   - playlists live under `mio media playlists`
 *   - there is no `mio branding`; branding is `mio hubs update --branding-json`
 *   - `pages tree set` reads the tree from --file only, never stdin
 *   - `pages publish` requires --if-match
 *   - exit 3 is auth, 4 is not found, 6 is rate limited
 */
export class MioCli {
  constructor(
    private readonly profile: Profile,
    private readonly run: CliRunner = realRunner,
  ) {}

  private base(): string[] {
    return ['--team', this.profile.teamId, '--api-base', this.profile.apiBase];
  }

  json<T>(args: string[]): T {
    const result = this.run([...this.base(), ...args, '-o', 'json']);
    if (result.status !== 0) {
      throw new Error(`mio ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
    }
    return JSON.parse(result.stdout) as T;
  }

  plain(args: string[]): string {
    const result = this.run([...this.base(), ...args, '-o', 'plain']);
    if (result.status !== 0) {
      throw new Error(`mio ${args.join(' ')} exited ${result.status}: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }
}
