import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Env } from './env.js';

/**
 * profiles/<name>.json: what differs per hub. The V3 team the hub is created in
 * and the logins for that hub. Every field is always present so a migrator can
 * fill a blank one in by hand. Profiles hold credentials and are not committed.
 */
const ProfileFileSchema = z.object({
  name: z.string().min(1),
  teamId: z.string().min(1),
  /** An audience member of the LEGACY hub; verify logs into the legacy site with it. */
  legacyHubLoginEmail: z.string().default(''),
  legacyHubLoginPassword: z.string().default(''),
  /** A member of the V3 hub; verify logs into the hub with it. */
  v3VerifyLoginEmail: z.string().default(''),
  v3VerifyLoginPassword: z.string().default(''),
  /** A platform (team) user; apply and verify call the API with it when no V3_API_KEY_<PROFILE> is set. */
  v3PlatformLoginEmail: z.string().default(''),
  v3PlatformLoginPassword: z.string().default(''),
});
export type ProfileFile = z.infer<typeof ProfileFileSchema>;

/** What every hub shares: the V3 target. Comes from .env (V3_* keys), not the profile. */
export interface Target {
  apiBase: string;
  bucket: string;
  region: string;
  cdnBase: string;
  /** False until someone has confirmed cdnBase against a real V3 media URL; check-access prints it. */
  cdnBaseConfirmed: boolean;
  /** Where the hub is served; the hub lives at `${hubBase}/${slug}`. */
  hubBase: string;
}

/** The profile a run works with: the file's per-hub values plus the shared target. */
export type Profile = ProfileFile & Target;

export function targetOf(env: Pick<Env, 'v3ApiBase' | 'v3AssetsBucket' | 'v3AssetsRegion' | 'v3CdnBase' | 'v3CdnBaseConfirmed' | 'v3HubBase'>): Target {
  return {
    apiBase: env.v3ApiBase,
    bucket: env.v3AssetsBucket,
    region: env.v3AssetsRegion,
    cdnBase: env.v3CdnBase,
    cdnBaseConfirmed: env.v3CdnBaseConfirmed,
    hubBase: env.v3HubBase,
  };
}

export function loadProfile(name: string, target: Target, dir = 'profiles'): Profile {
  const path = resolve(join(dir, `${name}.json`));
  if (!existsSync(path)) {
    throw new Error(`no profile "${name}"; expected ${path} (profile init ${name} --team-id <uuid> writes it)`);
  }
  const file = ProfileFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (file.name !== name) {
    throw new Error(`profile file ${path} declares name "${file.name}" but was loaded as "${name}"`);
  }
  return { ...file, ...target };
}

/** The passwords a profile carries, for the logger's redaction list. */
export function profileSecrets(profile: ProfileFile): string[] {
  return [profile.legacyHubLoginPassword, profile.v3VerifyLoginPassword, profile.v3PlatformLoginPassword].filter((s) => s.length > 0);
}

export type ProfileLogins = Partial<Omit<ProfileFile, 'name' | 'teamId'>>;

const PROFILE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writes `profiles/<name>.json` for a new hub: the team id and the six login
 * fields, blank unless given, so the migrator sees exactly what to fill in.
 * Refuses to overwrite an existing profile unless `force`, because a profile
 * name is also the key of that hub's ledger directory.
 */
export function initProfile(name: string, teamId: string, opts: { dir?: string; force?: boolean; logins?: ProfileLogins } = {}): { path: string; profile: ProfileFile } {
  if (!PROFILE_NAME.test(name)) throw new Error(`profile name "${name}" must be lowercase letters, digits and dashes`);
  if (!UUID.test(teamId)) throw new Error(`team id "${teamId}" is not a UUID; \`mio teams list\` prints the team's id`);
  const dir = opts.dir ?? 'profiles';
  const path = resolve(join(dir, `${name}.json`));
  if (existsSync(path) && !opts.force) throw new Error(`profile ${path} already exists; pass --force to overwrite it`);
  const profile = ProfileFileSchema.parse({ name, teamId, ...(opts.logins ?? {}) });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
  return { path, profile };
}
