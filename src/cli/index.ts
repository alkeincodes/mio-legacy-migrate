#!/usr/bin/env node
import { Command } from 'commander';
import { TOOL_VERSION } from '../version.js';
import { runExtract, runPinBundle } from './extract.js';
import { runMap } from './map.js';
import { runApply } from '../apply/orchestrator.js';
import { runVerify } from './verify.js';
import { buildInventory, renderInventory } from '../verify/inventory.js';
import { exportJsonl } from '../ledger/exportJsonl.js';
import { resolveEntry } from '../ledger/resolve.js';
import { runClean } from './clean.js';
import { LedgerStore, ledgerDir } from '../ledger/store.js';
import { markerScanner } from './markerScan.js';

const program = new Command();
program.name('mio-legacy-migrate').version(TOOL_VERSION);

program
  .command('extract')
  .description('capture one legacy hub from the read replica into a bundle')
  .argument('[domain]', 'the legacy hub domain, for example alliance.mantalks.com (not needed with --s3-only)')
  .option('--out <dir>', 'bundle output directory', 'bundles')
  .option('--check-access', 'prove the replica credentials and exit without capturing', false)
  .option('--skip-s3', 'capture without AWS values; the manifest stays unpinned until --s3-only', false)
  .option('--s3-only <bundle>', 'pin the S3 identity of an existing bundle in place, no replica access')
  .action(async (domain: string, opts: { out: string; checkAccess: boolean; skipS3: boolean; s3Only?: string }) => {
    if (opts.s3Only) {
      await runPinBundle(opts.s3Only);
      return;
    }
    await runExtract({ domain, outDir: opts.out, checkAccess: opts.checkAccess, skipS3: opts.skipS3 });
  });

program
  .command('map')
  .description('turn a bundle into a V3-shaped plan')
  .requiredOption('--bundle <path>', 'path to the bundle JSON')
  .option('--out <dir>', 'plan output directory', 'plans')
  .option('--api-base <url>', 'API base to read the catalog from', 'https://api.member.dev')
  .action(async (opts: { bundle: string; out: string; apiBase: string }) => {
    await runMap({ bundlePath: opts.bundle, outDir: opts.out, apiBase: opts.apiBase });
  });

program
  .command('apply')
  .description('create the V3 hub from a plan, writing a ledger as it goes')
  .requiredOption('--profile <name>', 'target profile name')
  .requiredOption('--plan <path>', 'path to the plan JSON')
  .option('--mode <mode>', 'fresh (M1) or upsert (M3)', 'fresh')
  .option('--dry-run', 'print every operation and mutate nothing', false)
  .option('--resume <runId>', 'continue an interrupted run')
  .option('--check-access', 'prove the S3 and member prerequisites, then exit', false)
  .option('--assets-only', 'M2 only: import pending video and rewrite references', false)
  .option('--break-lock', 'clear a stale lock after printing its owner', false)
  .option('--allow-catalog-drift', 'apply a plan mapped against a different catalog version', false)
  .option('--cleanup-orphans', 'list allocated-but-unverified asset rows older than a day', false)
  .option('--confirm', 'with --cleanup-orphans, actually delete them', false)
  .action(async (opts: {
    profile: string; plan: string; mode: string; dryRun: boolean; resume?: string;
    checkAccess: boolean; assetsOnly: boolean; breakLock: boolean; allowCatalogDrift: boolean;
    cleanupOrphans: boolean; confirm: boolean;
  }) => {
    await runApply({
      planPath: opts.plan,
      profileName: opts.profile,
      mode: opts.mode === 'upsert' ? 'upsert' : 'fresh',
      dryRun: opts.dryRun,
      resumeRunId: opts.resume ?? null,
      checkAccess: opts.checkAccess,
      assetsOnly: opts.assetsOnly,
      breakLock: opts.breakLock,
      allowCatalogDrift: opts.allowCatalogDrift,
      cleanupOrphans: opts.cleanupOrphans,
      confirm: opts.confirm,
    });
  });

program
  .command('verify')
  .description('report on a run, capture a contact sheet and decide acceptance')
  .requiredOption('--run <runId>', 'the run to verify')
  .requiredOption('--profile <name>', 'target profile name')
  .requiredOption('--plan <path>', 'the plan that run applied')
  .option('--milestone <m>', 'M1 or M2 acceptance rules', 'M1')
  .action(async (opts: { run: string; profile: string; plan: string; milestone: string }) => {
    const verdict = await runVerify({
      runId: opts.run,
      profileName: opts.profile,
      planPath: opts.plan,
      milestone: opts.milestone === 'M2' ? 'M2' : 'M1',
    });
    if (!verdict.accepted) process.exitCode = 1;
  });

program
  .command('inventory')
  .description('list every asset that still depends on legacy serving')
  .requiredOption('--profile <name>', 'target profile name')
  .action((opts: { profile: string }) => {
    process.stdout.write(`${renderInventory(buildInventory(opts.profile))}\n`);
  });

const ledger = program.command('ledger').description('ledger maintenance');

ledger
  .command('resolve')
  .description('resolve an entry left uncertain by an in-flight create')
  .argument('<marker>')
  .requiredOption('--profile <name>')
  .requiredOption('--legacy-hub <id>')
  .requiredOption('--run <runId>')
  .option('--adopt <id>', 'adopt this target as the entry V3 id')
  .option('--confirm-absent', 'record that nothing was created, letting the next resume create', false)
  .action(async (marker: string, opts: { profile: string; legacyHub: string; run: string; adopt?: string; confirmAbsent: boolean }) => {
    const store = LedgerStore.open(ledgerDir(opts.profile, Number(opts.legacyHub)), opts.run);
    await resolveEntry({
      store, marker,
      list: markerScanner(store, opts.profile),
      adopt: opts.adopt,
      confirmAbsent: opts.confirmAbsent,
    });
  });

ledger
  .command('export')
  .description('emit the ledger as JSONL, one row per entry')
  .requiredOption('--profile <name>')
  .requiredOption('--legacy-hub <id>')
  .requiredOption('--run <runId>')
  .action((opts: { profile: string; legacyHub: string; run: string }) => {
    const store = LedgerStore.open(ledgerDir(opts.profile, Number(opts.legacyHub)), opts.run);
    process.stdout.write(exportJsonl(store));
  });

program
  .command('clean')
  .description('delete local bundles, plans and run artifacts older than a cutoff')
  .requiredOption('--older-than <spec>', 'for example 30d')
  .option('--confirm', 'actually delete; without it, only list', false)
  .action((opts: { olderThan: string; confirm: boolean }) => {
    runClean({ olderThan: opts.olderThan, confirm: opts.confirm });
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
