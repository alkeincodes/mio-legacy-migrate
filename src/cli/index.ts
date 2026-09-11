#!/usr/bin/env node
import { Command } from 'commander';
import { TOOL_VERSION } from '../version.js';
import { runExtract } from './extract.js';
import { runMap } from './map.js';

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

await program.parseAsync(process.argv);
