import { readFileSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import type { ProfileFile } from './profile.js';

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
  // The V3 target every hub shares; the per-hub values (team, logins) live in profiles/<name>.json.
  V3_API_BASE: z.string().url().default('https://api.member.dev'),
  V3_ASSETS_BUCKET: z.string().min(1).default('mio-backend-assets-production'),
  V3_ASSETS_REGION: z.string().min(1).default('us-east-1'),
  V3_CDN_BASE: z.string().url().default('https://miocdn.membership.io'),
  V3_CDN_BASE_CONFIRMED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  V3_HUB_BASE: z.string().url().default('https://hub.member.dev'),
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
  v3ApiBase: string;
  v3AssetsBucket: string;
  v3AssetsRegion: string;
  v3CdnBase: string;
  v3CdnBaseConfirmed: boolean;
  v3HubBase: string;
  /** Filled from the profile by withProfileLogins; loadEnv leaves them empty. */
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
  V3_API_BASE: 'https://api.member.dev',
  V3_ASSETS_BUCKET: 'mio-backend-assets-production',
  V3_ASSETS_REGION: 'us-east-1',
  V3_CDN_BASE: 'https://miocdn.membership.io',
  V3_CDN_BASE_CONFIRMED: 'false',
  V3_HUB_BASE: 'https://hub.member.dev',
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
    v3ApiBase: e.V3_API_BASE,
    v3AssetsBucket: e.V3_ASSETS_BUCKET,
    v3AssetsRegion: e.V3_ASSETS_REGION,
    v3CdnBase: e.V3_CDN_BASE,
    v3CdnBaseConfirmed: e.V3_CDN_BASE_CONFIRMED,
    v3HubBase: e.V3_HUB_BASE,
    legacyHubLoginEmail: '',
    legacyHubLoginPassword: '',
    v3VerifyLoginEmail: '',
    v3VerifyLoginPassword: '',
    v3PlatformLoginEmail: '',
    v3PlatformLoginPassword: '',
  };
}

/** The logins a run uses come from the profile; loadEnv leaves them empty. */
export function withProfileLogins(env: Env, profile: ProfileFile): Env {
  return {
    ...env,
    legacyHubLoginEmail: profile.legacyHubLoginEmail,
    legacyHubLoginPassword: profile.legacyHubLoginPassword,
    v3VerifyLoginEmail: profile.v3VerifyLoginEmail,
    v3VerifyLoginPassword: profile.v3VerifyLoginPassword,
    v3PlatformLoginEmail: profile.v3PlatformLoginEmail,
    v3PlatformLoginPassword: profile.v3PlatformLoginPassword,
  };
}

/**
 * verify logs into both sites, so it needs both hub members. Each legacy hub
 * has its own audience account and each V3 hub its own member; a blank one is
 * refused rather than silently verifying the wrong hub. apply does not need
 * them (its API identity is the platform login or V3_API_KEY_<PROFILE>).
 */
export function requireHubLogins(env: Env, profileName: string): void {
  const missing: string[] = [];
  if (!env.legacyHubLoginEmail || !env.legacyHubLoginPassword) missing.push('legacyHubLoginEmail/legacyHubLoginPassword');
  if (!env.v3VerifyLoginEmail || !env.v3VerifyLoginPassword) missing.push('v3VerifyLoginEmail/v3VerifyLoginPassword');
  if (missing.length > 0) throw new Error(`profile "${profileName}" has a blank login: ${missing.join('; ')}. Fill it in profiles/${profileName}.json`);
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
