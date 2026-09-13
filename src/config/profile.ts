import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const ProfileSchema = z.object({
  name: z.string().min(1),
  apiBase: z.string().url(),
  teamId: z.string().min(1),
  bucket: z.string().min(1),
  region: z.string().min(1),
  cdnBase: z.string().url(),
  /** False until someone has confirmed cdnBase against a real V3 media URL; check-access prints it. */
  cdnBaseConfirmed: z.boolean().default(true),
  /** Where the hub is served; the hub lives at `${hubBase}/${slug}`. */
  hubBase: z.string().url().default('https://hub.member.dev'),
  /** An audience member of the LEGACY hub; verify logs into the legacy site with it. */
  legacyHubLoginEmail: z.string().optional(),
  legacyHubLoginPassword: z.string().optional(),
  /** A member of the V3 hub; verify logs into the hub with it. */
  v3VerifyLoginEmail: z.string().optional(),
  v3VerifyLoginPassword: z.string().optional(),
  /** A platform (team) user; apply and verify call the API with it when no V3_API_KEY_<PROFILE> is set. */
  v3PlatformLoginEmail: z.string().optional(),
  v3PlatformLoginPassword: z.string().optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

/** Every production hub shares these; a profile only names the team it writes into. */
export const PRODUCTION_DEFAULTS = {
  apiBase: 'https://api.member.dev',
  bucket: 'mio-backend-assets-production',
  region: 'us-east-1',
  cdnBase: 'https://miocdn.membership.io',
  cdnBaseConfirmed: false,
  hubBase: 'https://hub.member.dev',
} as const;

const PROFILE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writes `profiles/<name>.json` for a new target team with the production
 * defaults and the per-hub logins. Profiles hold credentials and are not
 * committed (`profiles/*.json` is gitignored). Refuses to overwrite an
 * existing profile unless `force`, because a profile name is also the key of
 * that hub's ledger directory.
 */
export interface ProfileLogins {
  legacyHubLoginEmail?: string; legacyHubLoginPassword?: string;
  v3VerifyLoginEmail?: string; v3VerifyLoginPassword?: string;
  v3PlatformLoginEmail?: string; v3PlatformLoginPassword?: string;
}

/** The passwords a profile carries, for the logger's redaction list. */
export function profileSecrets(profile: Profile): string[] {
  return [profile.legacyHubLoginPassword, profile.v3VerifyLoginPassword, profile.v3PlatformLoginPassword].filter((s): s is string => typeof s === 'string' && s.length > 0);
}

export function initProfile(name: string, teamId: string, opts: { dir?: string; force?: boolean; logins?: ProfileLogins } = {}): { path: string; profile: Profile } {
  if (!PROFILE_NAME.test(name)) throw new Error(`profile name "${name}" must be lowercase letters, digits and dashes`);
  if (!UUID.test(teamId)) throw new Error(`team id "${teamId}" is not a UUID; \`mio teams list\` prints the team's id`);
  const dir = opts.dir ?? 'profiles';
  const path = resolve(join(dir, `${name}.json`));
  if (existsSync(path) && !opts.force) throw new Error(`profile ${path} already exists; pass --force to overwrite it`);
  const logins = Object.fromEntries(Object.entries(opts.logins ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0));
  const profile = ProfileSchema.parse({ name, teamId, ...PRODUCTION_DEFAULTS, ...logins });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
  return { path, profile };
}

export function loadProfile(name: string, dir = 'profiles'): Profile {
  const path = resolve(join(dir, `${name}.json`));
  if (!existsSync(path)) {
    throw new Error(`no profile "${name}"; expected ${path}`);
  }
  const profile = ProfileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (profile.name !== name) {
    throw new Error(
      `profile file ${path} declares name "${profile.name}" but was loaded as "${name}"`,
    );
  }
  return profile;
}
