#!/usr/bin/env node
import { Command } from 'commander';
import { TOOL_VERSION } from '../version.js';
import { runExtract } from './extract.js';
import { runMap } from './map.js';
import { runApply } from '../apply/orchestrator.js';

const program = new Command();
program.name('mio-legacy-migrate').version(TOOL_VERSION);

program
  .command('extract')
  .description('capture one legacy hub from the read replica into a bundle')
  .argument('<domain>', 'the legacy hub domain, for example alliance.mantalks.com')
  .option('--out <dir>', 'bundle output directory', 'bundles')
  .option('--check-access', 'prove the replica credentials and exit without capturing', false)
  .action(async (domain: string, opts: { out: string; checkAccess: boolean }) => {
    await runExtract({ domain, outDir: opts.out, checkAccess: opts.checkAccess });
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
  .action(async (opts: {
    profile: string; plan: string; mode: string; dryRun: boolean; resume?: string;
    checkAccess: boolean; assetsOnly: boolean; breakLock: boolean; allowCatalogDrift: boolean;
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
    });
  });

await program.parseAsync(process.argv);
