import { readFileSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import type { Profile } from './profile.js';

const EnvSchema = z.object({
  LEGACY_DB_HOST: z.string().min(1),
  LEGACY_DB_PORT: z.coerce.number().int().positive(),
  LEGACY_DB_USER: z.string().min(1),
  LEGACY_DB_PASSWORD: z.string().min(1),
  LEGACY_DB_NAME: z.string().min(1),
  SSH_BOX_HOST: z.string().min(1),
  SSH_BOX_USER: z.string().min(1),
  SSH_KNOWN_HOSTS_FILE: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  V3_AWS_ACCESS_KEY_ID: z.string().default(''),
  V3_AWS_SECRET_ACCESS_KEY: z.string().default(''),
  LEGACY_S3_BUCKET: z.string().min(1),
  LEGACY_S3_URL: z.string().url(),
  LEGACY_CDN_URL: z.string().url(),
  // Logins normally come from the profile; these are the fallback for a profile that sets none.
  LEGACY_HUB_LOGIN_EMAIL: z.string().default(''),
  LEGACY_HUB_LOGIN_PASSWORD: z.string().default(''),
  V3_VERIFY_LOGIN_EMAIL: z.string().default(''),
  V3_VERIFY_LOGIN_PASSWORD: z.string().default(''),
  V3_PLATFORM_LOGIN_EMAIL: z.string().default(''),
  V3_PLATFORM_LOGIN_PASSWORD: z.string().default(''),
});

export interface Env {
  legacyDbHost: string;
  legacyDbPort: number;
  legacyDbUser: string;
  legacyDbPassword: string;
  legacyDbName: string;
  sshBoxHost: string;
  sshBoxUser: string;
  sshKnownHostsFile: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  /** A separate principal for the V3 bucket; empty means fall back to the legacy pair. */
  v3AwsAccessKeyId: string;
  v3AwsSecretAccessKey: string;
  legacyS3Bucket: string;
  legacyS3Url: string;
  legacyCdnUrl: string;
  legacyHubLoginEmail: string;
  legacyHubLoginPassword: string;
  v3VerifyLoginEmail: string;
  v3VerifyLoginPassword: string;
  /** A platform (team) user for the API when no static key is set; verify's hub member cannot use the platform login. */
  v3PlatformLoginEmail: string;
  v3PlatformLoginPassword: string;
}

export type EnvGroup = 's3' | 'cdn' | 'logins';

/** The replica and SSH values are always required; each group gates one kind of run. */
const GROUP_KEYS: Record<EnvGroup, string[]> = {
  s3: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'LEGACY_S3_BUCKET', 'LEGACY_S3_URL'],
  cdn: ['LEGACY_CDN_URL'],
  // Kept as a group name for callers; the values themselves are per profile (withProfileLogins) with .env as fallback.
  logins: [],
};
const ALWAYS_KEYS = [
  'LEGACY_DB_HOST', 'LEGACY_DB_PORT', 'LEGACY_DB_USER', 'LEGACY_DB_PASSWORD', 'LEGACY_DB_NAME',
  'SSH_BOX_HOST', 'SSH_BOX_USER', 'SSH_KNOWN_HOSTS_FILE',
];
const PLACEHOLDERS: Record<string, string> = {
  LEGACY_HUB_LOGIN_EMAIL: '',
  LEGACY_HUB_LOGIN_PASSWORD: '',
  V3_VERIFY_LOGIN_EMAIL: '',
  V3_VERIFY_LOGIN_PASSWORD: '',
  V3_PLATFORM_LOGIN_EMAIL: '',
  V3_PLATFORM_LOGIN_PASSWORD: '',
  V3_AWS_ACCESS_KEY_ID: '',
  V3_AWS_SECRET_ACCESS_KEY: '',
  AWS_REGION: 'us-east-1',
  LEGACY_S3_URL: 'https://unset.invalid',
  LEGACY_CDN_URL: 'https://unset.invalid',
};

/**
 * dotenv treats an unquoted `#` as the start of a comment, so a password
 * carrying one is silently cut short. This catches the two symptoms.
 */
export function envFileWarnings(raw: string): string[] {
  const warnings: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    const quoted = /^(['"`]).*\1$/.test(value);
    if (!quoted && value.includes('#')) {
      warnings.push(`${key} has an unquoted value containing '#'; dotenv cuts it there. Single-quote the whole value.`);
    }
  }
  return warnings;
}

export function loadEnv(
  dotenvPath = '.env',
  opts: { require?: EnvGroup[]; replicaOnly?: boolean; warn?: (message: string) => void } = {},
): Env {
  // Validate the file on its own so a stale shell variable cannot mask a
  // missing entry; .env is the only source for these values.
  const raw = readFileSync(dotenvPath, 'utf8');
  const fileVars = parseDotenv(raw);
  const warn = opts.warn ?? ((message: string) => process.stderr.write(`WARN ${message}\n`));
  for (const warning of envFileWarnings(raw)) warn(warning);
  const password = fileVars['LEGACY_DB_PASSWORD'] ?? '';
  if (password.length > 0 && password.length < 16) {
    warn(`LEGACY_DB_PASSWORD is only ${password.length} characters; a value containing '#', '$' or spaces must be single-quoted or dotenv truncates it`);
  }

  const groups: EnvGroup[] = opts.replicaOnly ? [] : (opts.require ?? ['s3', 'cdn', 'logins']);
  const required = new Set([...ALWAYS_KEYS, ...groups.flatMap((g) => GROUP_KEYS[g])]);
  const schema = EnvSchema.pick(
    Object.fromEntries([...required].map((k) => [k, true])) as Record<keyof typeof EnvSchema.shape, true>,
  )
    .transform((partial) => ({
      // Keys outside the required groups keep whatever the file holds (the optional
      // V3 pairs live here); only an absent key gets a placeholder.
      ...Object.fromEntries(Object.keys(EnvSchema.shape).map((k) => [k, fileVars[k] || (PLACEHOLDERS[k] ?? 'unset')])),
      ...partial,
    }))
    .pipe(EnvSchema);
  const parsed = schema.safeParse(fileVars);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).sort();
    throw new Error(
      `.env is incomplete. Fix these variables and retry: ${missing.join(', ')}`,
    );
  }
  Object.assign(process.env, fileVars);
  const e = parsed.data;
  return {
    legacyDbHost: e.LEGACY_DB_HOST,
    legacyDbPort: e.LEGACY_DB_PORT,
    legacyDbUser: e.LEGACY_DB_USER,
    legacyDbPassword: e.LEGACY_DB_PASSWORD,
    legacyDbName: e.LEGACY_DB_NAME,
    sshBoxHost: e.SSH_BOX_HOST,
    sshBoxUser: e.SSH_BOX_USER,
    sshKnownHostsFile: e.SSH_KNOWN_HOSTS_FILE,
    awsAccessKeyId: e.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: e.AWS_SECRET_ACCESS_KEY,
    awsRegion: e.AWS_REGION,
    v3AwsAccessKeyId: e.V3_AWS_ACCESS_KEY_ID,
    v3AwsSecretAccessKey: e.V3_AWS_SECRET_ACCESS_KEY,
    legacyS3Bucket: e.LEGACY_S3_BUCKET,
    legacyS3Url: e.LEGACY_S3_URL,
    legacyCdnUrl: e.LEGACY_CDN_URL,
    legacyHubLoginEmail: e.LEGACY_HUB_LOGIN_EMAIL,
    legacyHubLoginPassword: e.LEGACY_HUB_LOGIN_PASSWORD,
    v3VerifyLoginEmail: e.V3_VERIFY_LOGIN_EMAIL,
    v3VerifyLoginPassword: e.V3_VERIFY_LOGIN_PASSWORD,
    v3PlatformLoginEmail: e.V3_PLATFORM_LOGIN_EMAIL,
    v3PlatformLoginPassword: e.V3_PLATFORM_LOGIN_PASSWORD,
  };
}

/**
 * The logins a run uses: the profile's own when it sets them, else the .env
 * fallback. Each legacy hub has its own audience account and each V3 hub its
 * own member, so a profile without them would silently verify the wrong hub;
 * both are required to resolve to something.
 */
export function withProfileLogins(env: Env, profile: Pick<Profile, 'name' | 'legacyHubLoginEmail' | 'legacyHubLoginPassword' | 'v3VerifyLoginEmail' | 'v3VerifyLoginPassword' | 'v3PlatformLoginEmail' | 'v3PlatformLoginPassword'>): Env {
  const pick = (own: string | undefined, fallback: string): string => (own && own.length > 0 ? own : fallback);
  const out: Env = {
    ...env,
    legacyHubLoginEmail: pick(profile.legacyHubLoginEmail, env.legacyHubLoginEmail),
    legacyHubLoginPassword: pick(profile.legacyHubLoginPassword, env.legacyHubLoginPassword),
    v3VerifyLoginEmail: pick(profile.v3VerifyLoginEmail, env.v3VerifyLoginEmail),
    v3VerifyLoginPassword: pick(profile.v3VerifyLoginPassword, env.v3VerifyLoginPassword),
    v3PlatformLoginEmail: pick(profile.v3PlatformLoginEmail, env.v3PlatformLoginEmail),
    v3PlatformLoginPassword: pick(profile.v3PlatformLoginPassword, env.v3PlatformLoginPassword),
  };
  const missing: string[] = [];
  if (!out.legacyHubLoginEmail || !out.legacyHubLoginPassword) missing.push('legacyHubLoginEmail/legacyHubLoginPassword (or LEGACY_HUB_LOGIN_EMAIL/PASSWORD in .env)');
  if (!out.v3VerifyLoginEmail || !out.v3VerifyLoginPassword) missing.push('v3VerifyLoginEmail/v3VerifyLoginPassword (or V3_VERIFY_LOGIN_EMAIL/PASSWORD in .env)');
  if (missing.length > 0) throw new Error(`profile "${profile.name}" has no login for: ${missing.join('; ')}. Set them with profile init --legacy-login/--verify-login or edit profiles/${profile.name}.json`);
  return out;
}

export function apiKeyVarName(profileName: string): string {
  return `V3_API_KEY_${profileName.replace(/-/g, '_').toUpperCase()}`;
}

export function apiKeyForProfile(profileName: string): string {
  const varName = apiKeyVarName(profileName);
  const value = process.env[varName];
  if (!value) {
    throw new Error(`no API key for profile "${profileName}"; set ${varName} in .env`);
  }
  return value;
}

/** Null when the profile has no static key, which is when apply logs in with the verify user instead. */
export function apiKeyForProfileOrNull(profileName: string): string | null {
  return process.env[apiKeyVarName(profileName)] || null;
}

/** Every value the logger must never print. */
export function secretsOf(env: Env): string[] {
  return [
    env.legacyDbPassword,
    env.awsSecretAccessKey,
    env.awsAccessKeyId,
    env.v3AwsSecretAccessKey,
    env.v3AwsAccessKeyId,
    env.legacyHubLoginPassword,
    env.v3VerifyLoginPassword,
    env.v3PlatformLoginPassword,
    ...Object.entries(process.env)
      .filter(([k]) => k.startsWith('V3_API_KEY_'))
      .map(([, v]) => v ?? ''),
  ];
}
