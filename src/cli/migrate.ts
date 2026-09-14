import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { loadEnv, apiKeyForProfileOrNull, withProfileLogins, secretsOf, type Env } from '../config/env.js';
import { resolveApiAuth } from '../apply/auth.js';
import { ApiClient } from '../apply/api.js';
import { Budget, budgetIdentity } from '../apply/budget.js';
import { LedgerStore } from '../ledger/store.js';
import { logger } from '../log/logger.js';
import { loadProfile, targetOf, type Profile } from '../config/profile.js';
import { ledgerDir } from '../ledger/store.js';
import { readPlan } from '../map/plan.js';
import { runApply } from '../apply/orchestrator.js';
import { runExtract } from './extract.js';
import { runMap } from './map.js';
import { runVerify } from './verify.js';

/**
 * The whole migration after `profile init`: extract (pinned), map, apply,
 * verify, one command. A rerun for the same profile and legacy hub resumes
 * the run the ledger already holds, so the second-hub trap cannot happen.
 */
export interface MigrateOptions {
  /** What the migrator pastes: the legacy hub's URL or host. */
  address: string;
  profileName: string;
  /** Required on the first run; the V3 hub lives at `${hubBase}/${slug}`. Ignored on a resume. */
  hubSlug: string | null;
  /** Run extract, map and the apply dry run, then stop. */
  dryRun: boolean;
  /** Publish segment-gated pages the fail-closed rule would hold; the report lists them. */
  publishHeld: boolean;
  /** Copy media into the V3 bucket; needs V3_AWS_*. Off: images legacy-linked, media pending. */
  assets: boolean;
  bundlesDir?: string;
  plansDir?: string;
}

const STEPS = ['preflight', 'extract', 'map', 'apply', 'verify'] as const;

function step(n: number, detail: string): void {
  process.stdout.write(`[${n}/${STEPS.length}] ${STEPS[n - 1]}: ${detail}\n`);
}

function elapsed(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(1)}s`;
}

/** The newest run id recorded for this profile and legacy hub, or null before the first apply. */
export function latestRun(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((f) => /^run-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
  return runs[runs.length - 1] ?? null;
}

export interface ApplyPlanning {
  resumeRunId: string | null;
  hubSlug: string | null;
  skipAssets: boolean;
  acceptPlanChange: boolean;
  rewritePages: boolean;
}

/**
 * How this run applies: fresh (needs a slug) or resumed (slug fixed at
 * creation); assets copied only when asked for and the V3 keys exist.
 */
export function planApply(input: { existingRun: string | null; hubSlug: string | null; existingSlug: string | null; assets: boolean; v3KeysPresent: boolean }): ApplyPlanning {
  if (input.existingRun === null && !input.hubSlug) {
    throw new Error('the first run creates the hub, so --hub-slug <slug> is required (the V3 URL becomes <hubBase>/<slug>; global, auto-suffixed if taken, fixed for the life of the hub)');
  }
  if (input.existingRun !== null && !input.existingSlug) {
    throw new Error(`run ${input.existingRun} exists but its hub's slug could not be read; the resume must carry the slug the hub was created with`);
  }
  if (input.assets && !input.v3KeysPresent) {
    throw new Error('--assets needs V3_AWS_ACCESS_KEY_ID and V3_AWS_SECRET_ACCESS_KEY in .env; without them media stays legacy-linked or pending');
  }
  return {
    resumeRunId: input.existingRun,
    // A resume hashes the hub record with the slug it was created under (the ledger's
    // hub entry was); passing anything else reads as a second plan and is refused.
    hubSlug: input.existingRun === null ? input.hubSlug : input.existingSlug,
    skipAssets: !input.assets,
    acceptPlanChange: input.existingRun !== null,
    rewritePages: input.existingRun !== null,
  };
}

/** The slug the hub behind an existing run answers at, read from the API; null when the run never made a hub. */
async function existingHubSlug(profile: Profile, env: Env, dir: string, runId: string): Promise<string | null> {
  const store = LedgerStore.open(dir, runId);
  const hubId = store.header.targetHubId;
  if (!hubId) return null;
  const auth = await resolveApiAuth(profile, env);
  logger.setSecrets([...secretsOf(env), auth.token]);
  const api = new ApiClient({ profile, apiKey: auth.token, budget: Budget.open(budgetIdentity(profile.teamId, auth.budgetSubject)) });
  const { body } = await api.get<{ data: { attributes: { slug?: string } } }>(`/api/v1/teams/${profile.teamId}/hubs/${hubId}`);
  return body.data.attributes.slug ?? null;
}

/** Which identity apply will call the API as, or the reason it cannot. */
export function apiIdentity(profile: Profile): { ok: true; label: string } | { ok: false; reason: string } {
  if (apiKeyForProfileOrNull(profile.name)) return { ok: true, label: `static key V3_API_KEY_${profile.name.replace(/-/g, '_').toUpperCase()}` };
  if (profile.v3PlatformLoginEmail && profile.v3PlatformLoginPassword) return { ok: true, label: `platform login ${profile.v3PlatformLoginEmail}` };
  if (profile.v3VerifyLoginEmail && profile.v3VerifyLoginPassword) return { ok: true, label: `verify login ${profile.v3VerifyLoginEmail} (platform login preferred)` };
  return { ok: false, reason: `profile "${profile.name}" has no API identity: fill v3PlatformLoginEmail/Password in profiles/${profile.name}.json or set V3_API_KEY_<PROFILE> in .env` };
}

function hubLoginsBlank(env: Env): string[] {
  const blank: string[] = [];
  if (!env.legacyHubLoginEmail || !env.legacyHubLoginPassword) blank.push('legacyHubLoginEmail/Password');
  if (!env.v3VerifyLoginEmail || !env.v3VerifyLoginPassword) blank.push('v3VerifyLoginEmail/Password');
  return blank;
}

/**
 * The clean-ledger gate refuses an apply over uncommitted ledger changes. In a
 * repo that tracks the ledger this commits it around each run; in one that
 * ignores it (this repo since 2026-09-14: the ledger holds customer ids and
 * stays local) there is nothing to commit and the gate sees no changes.
 */
function commitLedger(dir: string, message: string): void {
  if (!existsSync(dir)) return;
  try {
    execFileSync('git', ['check-ignore', '-q', dir], { stdio: 'ignore' });
    return; // exit 0: the ledger is ignored, nothing to commit
  } catch {
    // exit 1: tracked, commit it below
  }
  try {
    execFileSync('git', ['add', dir], { stdio: 'ignore' });
    const status = execFileSync('git', ['status', '--porcelain', '--', dir]).toString();
    if (status.trim().length === 0) return;
    execFileSync('git', ['commit', '-q', '-m', message, '--', dir], { stdio: 'ignore' });
    process.stdout.write(`      ledger committed: ${message}\n`);
  } catch {
    process.stdout.write(`      WARN could not commit ${dir}; commit it by hand before the next run\n`);
  }
}

export async function runMigrate(opts: MigrateOptions): Promise<void> {
  const started = Date.now();
  const bundlesDir = opts.bundlesDir ?? 'bundles';
  const plansDir = opts.plansDir ?? 'plans';

  // 1. preflight
  let t = Date.now();
  const envBase = loadEnv('.env', { require: ['s3', 'cdn'] });
  const profile = loadProfile(opts.profileName, targetOf(envBase));
  const env = withProfileLogins(envBase, profile);
  const identity = apiIdentity(profile);
  if (!identity.ok) throw new Error(identity.reason);
  const blank = hubLoginsBlank(env);
  const v3KeysPresent = env.v3AwsAccessKeyId.length > 0 && env.v3AwsSecretAccessKey.length > 0;
  step(1, `profile ${profile.name}, team ${profile.teamId}, API as ${identity.label}, assets ${opts.assets ? 'copied' : 'skipped'}${blank.length ? `; verify will be skipped (blank: ${blank.join(', ')})` : ''} (${elapsed(t)})`);

  // 2. extract, pinned
  t = Date.now();
  const bundlePath = await runExtract({ domain: opts.address, outDir: bundlesDir, checkAccess: false, skipS3: false });
  step(2, `${bundlePath} (${elapsed(t)})`);

  // 3. map
  t = Date.now();
  const planPath = await runMap({ bundlePath, outDir: plansDir, apiBase: env.v3ApiBase });
  const plan = readPlan(planPath);
  const fidelity = plan.warnings.filter((w) => w.type === 'fidelity').reduce((n, w) => n + (w.count ?? 1), 0);
  step(3, `${planPath}: ${plan.pages.length} pages, ${plan.playlists.length} playlists, ${plan.assets.length} assets, ${fidelity} fidelity entries (${elapsed(t)})`);

  // 4. apply
  t = Date.now();
  const dir = ledgerDir(profile.name, plan.legacyHubId);
  const existingRun = latestRun(dir);
  const existingSlug = existingRun ? await existingHubSlug(profile, env, dir, existingRun) : null;
  if (existingRun && opts.hubSlug && existingSlug && opts.hubSlug !== existingSlug) {
    process.stdout.write(`      note: --hub-slug ${opts.hubSlug} ignored; the hub already lives at /${existingSlug} and a slug cannot change\n`);
  }
  const planning = planApply({ existingRun, hubSlug: opts.hubSlug, existingSlug, assets: opts.assets, v3KeysPresent });
  const slug = planning.hubSlug ?? plan.hub.slug;
  if (opts.dryRun) {
    await runApply({
      planPath, profileName: profile.name, mode: 'fresh', dryRun: true, resumeRunId: planning.resumeRunId,
      checkAccess: false, assetsOnly: false, breakLock: false, allowCatalogDrift: false, cleanupOrphans: false, confirm: false,
      skipAssets: planning.skipAssets, hubSlug: planning.hubSlug, publishHeld: opts.publishHeld,
      acceptPlanChange: planning.acceptPlanChange, rewritePages: planning.rewritePages,
    });
    step(4, `dry run only, nothing mutated${existingRun ? ` (would resume ${existingRun})` : ` (would create ${profile.hubBase}/${slug})`} (${elapsed(t)})`);
    step(5, 'skipped on a dry run');
    process.stdout.write(`done in ${elapsed(started)}; rerun without --dry-run to apply\n`);
    return;
  }
  commitLedger(dir, `ledger: ${profile.name} before migrate`);
  const runId = await runApply({
    planPath, profileName: profile.name, mode: 'fresh', dryRun: false, resumeRunId: planning.resumeRunId,
    checkAccess: false, assetsOnly: false, breakLock: false, allowCatalogDrift: false, cleanupOrphans: false, confirm: false,
    skipAssets: planning.skipAssets, hubSlug: planning.hubSlug, publishHeld: opts.publishHeld,
    acceptPlanChange: planning.acceptPlanChange, rewritePages: planning.rewritePages,
  }).finally(() => commitLedger(dir, `ledger: ${profile.name} after migrate`));
  step(4, `${existingRun ? `resumed ${runId}` : `created the hub, run ${runId}`} (${elapsed(t)})`);

  // 5. verify
  t = Date.now();
  if (blank.length > 0) {
    step(5, `skipped: fill ${blank.join(' and ')} in profiles/${profile.name}.json, then rerun this command`);
  } else {
    const verdict = await runVerify({ runId, profileName: profile.name, planPath, milestone: 'M1', shots: false });
    step(5, `${verdict.accepted ? 'accepted' : `NOT accepted: ${verdict.failures.join('; ')}`} (${elapsed(t)})`);
    if (!verdict.accepted) process.exitCode = 1;
  }

  process.stdout.write([
    '',
    `hub:        ${profile.hubBase}/${slug}`,
    `run:        ${runId}`,
    `plan:       ${planPath}`,
    `fidelity:   ${fidelity} entries (see the map output above; each is a V3 limitation, recorded)`,
    `next:       rerun the same command after changing the legacy hub or the mapper; it resumes ${runId}.`,
    `            ${opts.assets ? '' : 'add --assets once V3_AWS_* are in .env to copy the media.'}`,
    `done in ${elapsed(started)}`,
    '',
  ].join('\n'));
}
