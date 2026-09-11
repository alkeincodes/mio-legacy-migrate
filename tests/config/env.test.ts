import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiKeyForProfile, envFileWarnings, loadEnv } from '../../src/config/env.js';

const COMPLETE = [
  'LEGACY_DB_HOST=searchie-production.cluster-ro.example.rds.amazonaws.com',
  'LEGACY_DB_PORT=3306',
  'LEGACY_DB_USER=reader',
  'LEGACY_DB_PASSWORD=secret',
  'LEGACY_DB_NAME=searchie',
  'SSH_BOX_HOST=box.example.com',
  'SSH_BOX_USER=ubuntu',
  'SSH_KNOWN_HOSTS_FILE=/tmp/known_hosts',
  'AWS_ACCESS_KEY_ID=AKIA_TEST',
  'AWS_SECRET_ACCESS_KEY=aws_secret',
  'AWS_REGION=us-east-1',
  'LEGACY_S3_BUCKET=legacy-bucket',
  'LEGACY_S3_URL=https://legacy-bucket.s3.amazonaws.com',
  'LEGACY_CDN_URL=https://cdn.legacy.example.com',
  'LEGACY_HUB_LOGIN_EMAIL=a@example.com',
  'LEGACY_HUB_LOGIN_PASSWORD=pw1',
  'V3_VERIFY_LOGIN_EMAIL=b@example.com',
  'V3_VERIFY_LOGIN_PASSWORD=pw2',
].join('\n');

function writeEnv(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'env-'));
  const path = join(dir, '.env');
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('loadEnv', () => {
  it('loads and coerces every required variable', () => {
    const env = loadEnv(writeEnv(COMPLETE));
    expect(env.legacyDbPort).toBe(3306);
    expect(env.legacyDbHost).toBe('searchie-production.cluster-ro.example.rds.amazonaws.com');
    expect(env.legacyCdnUrl).toBe('https://cdn.legacy.example.com');
  });

  it('names every missing variable in one error rather than failing on the first', () => {
    const path = writeEnv('LEGACY_DB_HOST=h\nLEGACY_DB_PORT=3306');
    expect(() => loadEnv(path)).toThrow(/LEGACY_DB_USER/);
    expect(() => loadEnv(path)).toThrow(/AWS_REGION/);
  });
});

describe('loadEnv with replicaOnly', () => {
  it('accepts a file that only carries the replica and SSH values', () => {
    const path = writeEnv(COMPLETE.split('\n').filter((l) => /^(LEGACY_DB|SSH_)/.test(l)).join('\n'));
    const env = loadEnv(path, { replicaOnly: true });
    expect(env.legacyDbUser).toBe('reader');
    expect(env.awsAccessKeyId).toBe('unset');
  });

  it('still names a missing replica value', () => {
    const path = writeEnv('LEGACY_DB_HOST=h');
    expect(() => loadEnv(path, { replicaOnly: true })).toThrow(/LEGACY_DB_USER/);
  });
});

describe('loadEnv with require groups', () => {
  it('needs only the replica, SSH and CDN values for a --skip-s3 extract', () => {
    const path = writeEnv(COMPLETE.split('\n').filter((l) => /^(LEGACY_DB|SSH_|LEGACY_CDN)/.test(l)).join('\n'));
    expect(loadEnv(path, { require: ['cdn'] }).legacyCdnUrl).toBe('https://cdn.legacy.example.com');
    expect(() => loadEnv(path, { require: ['s3'] })).toThrow(/AWS_ACCESS_KEY_ID/);
  });
});

describe('env file warnings', () => {
  it('flags an unquoted value containing #, which dotenv would truncate', () => {
    expect(envFileWarnings("LEGACY_DB_PASSWORD=abc#def\nOTHER='a#b'\nX=\"c#d\"")).toEqual([
      expect.stringContaining('LEGACY_DB_PASSWORD has an unquoted value'),
    ]);
  });

  it('warns when the replica password is suspiciously short', () => {
    const warnings: string[] = [];
    loadEnv(writeEnv(COMPLETE.replace('LEGACY_DB_PASSWORD=secret', "LEGACY_DB_PASSWORD='short'")), { warn: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes('only 5 characters'))).toBe(true);
  });
});

describe('apiKeyForProfile', () => {
  it('reads the per-profile key from the environment', () => {
    process.env.V3_API_KEY_MANTALKS_PROD = 'mio_sk_test';
    expect(apiKeyForProfile('mantalks-prod')).toBe('mio_sk_test');
    delete process.env.V3_API_KEY_MANTALKS_PROD;
  });

  it('throws naming the variable it expected', () => {
    expect(() => apiKeyForProfile('dev-box')).toThrow(/V3_API_KEY_DEV_BOX/);
  });
});
