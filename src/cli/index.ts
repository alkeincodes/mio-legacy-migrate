#!/usr/bin/env node
import { Command } from 'commander';
import { TOOL_VERSION } from '../version.js';
import { runExtract } from './extract.js';

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

await program.parseAsync(process.argv);
