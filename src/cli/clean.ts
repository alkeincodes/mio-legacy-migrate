import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../log/logger.js';

const UNITS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseOlderThan(spec: string): number {
  const match = /^(\d+)([mhd])$/.exec(spec.trim());
  const unit = match ? UNITS[match[2] as string] : undefined;
  if (!match || unit === undefined) {
    throw new Error(`could not parse "${spec}"; expected a number followed by m, h or d, for example 30d`);
  }
  return Number(match[1]) * unit;
}

export function filesOlderThan(dirs: string[], cutoffMs: number, now = new Date()): string[] {
  const cutoff = now.getTime() - cutoffMs;
  const selected: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).mtime.getTime() < cutoff) selected.push(path);
    }
  }
  return selected;
}

/**
 * Bundles, plans and run artifacts are customer content: raw legacy settings
 * JSON can carry an email in a segment condition or a name in a testimonial.
 * They stay local and are deleted on a cutoff.
 */
export function runClean(opts: { olderThan: string; confirm: boolean }): string[] {
  const targets = filesOlderThan(['bundles', 'plans', 'runs'], parseOlderThan(opts.olderThan));
  if (!opts.confirm) {
    logger.info('clean would delete these paths; rerun with --confirm', { count: targets.length, targets });
    return targets;
  }
  for (const path of targets) rmSync(path, { recursive: true, force: true });
  logger.info('clean deleted local artifacts', { count: targets.length });
  return targets;
}
