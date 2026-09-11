import { readFileSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';

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
  LEGACY_S3_BUCKET: z.string().min(1),
  LEGACY_S3_URL: z.string().url(),
  LEGACY_CDN_URL: z.string().url(),
  LEGACY_HUB_LOGIN_EMAIL: z.string().min(1),
  LEGACY_HUB_LOGIN_PASSWORD: z.string().min(1),
  V3_VERIFY_LOGIN_EMAIL: z.string().min(1),
  V3_VERIFY_LOGIN_PASSWORD: z.string().min(1),
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
  legacyS3Bucket: string;
  legacyS3Url: string;
  legacyCdnUrl: string;
  legacyHubLoginEmail: string;
  legacyHubLoginPassword: string;
  v3VerifyLoginEmail: string;
  v3VerifyLoginPassword: string;
}

export function loadEnv(dotenvPath = '.env'): Env {
  // Validate the file on its own so a stale shell variable cannot mask a
  // missing entry; .env is the only source for these values.
  const fileVars = parseDotenv(readFileSync(dotenvPath, 'utf8'));
  const parsed = EnvSchema.safeParse(fileVars);
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
    legacyS3Bucket: e.LEGACY_S3_BUCKET,
    legacyS3Url: e.LEGACY_S3_URL,
    legacyCdnUrl: e.LEGACY_CDN_URL,
    legacyHubLoginEmail: e.LEGACY_HUB_LOGIN_EMAIL,
    legacyHubLoginPassword: e.LEGACY_HUB_LOGIN_PASSWORD,
    v3VerifyLoginEmail: e.V3_VERIFY_LOGIN_EMAIL,
    v3VerifyLoginPassword: e.V3_VERIFY_LOGIN_PASSWORD,
  };
}

export function apiKeyForProfile(profileName: string): string {
  const varName = `V3_API_KEY_${profileName.replace(/-/g, '_').toUpperCase()}`;
  const value = process.env[varName];
  if (!value) {
    throw new Error(`no API key for profile "${profileName}"; set ${varName} in .env`);
  }
  return value;
}

/** Every value the logger must never print. */
export function secretsOf(env: Env): string[] {
  return [
    env.legacyDbPassword,
    env.awsSecretAccessKey,
    env.awsAccessKeyId,
    env.legacyHubLoginPassword,
    env.v3VerifyLoginPassword,
    ...Object.entries(process.env)
      .filter(([k]) => k.startsWith('V3_API_KEY_'))
      .map(([, v]) => v ?? ''),
  ];
}
