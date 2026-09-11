import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_VERSION } from '../src/version.js';

describe('TOOL_VERSION', () => {
  it('matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(TOOL_VERSION).toBe(pkg.version);
  });

  it('is a semver triple', () => {
    expect(TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
