import { describe, expect, it } from 'vitest';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesOlderThan, parseOlderThan } from '../../src/cli/clean.js';

describe('parseOlderThan', () => {
  it('parses days, hours and minutes', () => {
    expect(parseOlderThan('30d')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseOlderThan('12h')).toBe(12 * 60 * 60 * 1000);
    expect(parseOlderThan('45m')).toBe(45 * 60 * 1000);
  });

  it('rejects a spec it does not understand rather than deleting the wrong set', () => {
    expect(() => parseOlderThan('soon')).toThrow(/could not parse "soon"/);
  });
});

describe('filesOlderThan', () => {
  it('selects only files older than the cutoff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-'));
    const old = join(dir, 'old.json');
    const fresh = join(dir, 'fresh.json');
    writeFileSync(old, '{}', 'utf8');
    writeFileSync(fresh, '{}', 'utf8');
    const ancient = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(old, ancient, ancient);
    const selected = filesOlderThan([dir], parseOlderThan('30d'));
    expect(selected).toEqual([old]);
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(filesOlderThan(['/definitely/not/here'], parseOlderThan('30d'))).toEqual([]);
  });
});
