import { describe, expect, it } from 'vitest';
import { renderDryRun } from '../../src/apply/dryRun.js';

describe('renderDryRun', () => {
  it('lists operations in order with their kind and summary', () => {
    const text = renderDryRun([
      { order: 0, kind: 'hub.create', summary: 'create hub "ManTalks Alliance"', detail: { slug: 'alliance' } },
      { order: 1, kind: 'page.create', summary: 'create page /about', detail: { slug: 'about' } },
    ]);
    expect(text).toContain('0  hub.create              create hub "ManTalks Alliance"');
    expect(text).toContain('1  page.create             create page /about');
  });

  it('prints a totals line per kind so the operator can sanity-check the shape', () => {
    const text = renderDryRun([
      { order: 0, kind: 'page.create', summary: 'a', detail: {} },
      { order: 1, kind: 'page.create', summary: 'b', detail: {} },
      { order: 2, kind: 'page.publish', summary: 'c', detail: {} },
    ]);
    expect(text).toContain('page.create: 2');
    expect(text).toContain('page.publish: 1');
  });

  it('says plainly that nothing was mutated', () => {
    expect(renderDryRun([])).toContain('dry run: nothing was mutated');
  });
});
