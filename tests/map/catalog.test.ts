import { describe, expect, it, vi } from 'vitest';
import { fetchCatalog, validateTree, type Catalog, type CatalogNode } from '../../src/map/catalog.js';

const catalog: Catalog = {
  meta: { catalogVersion: '0.23.6', digest: 'sha256:abc', schemaVersion: '2.1.0' },
  templates: [
    { id: 'row', label: 'Row', category: 'section', compiledSectionType: 'row' },
    { id: 'hero', label: 'Hero', category: 'section', compiledSectionType: 'feature' },
    { id: 'content-card', label: 'Content Card', category: 'element' },
  ],
  sectionTypes: [{ id: 'row', writable: true }, { id: 'feature', writable: true }],
  nodeKinds: {
    stack: { childRules: 'many' },
    container: { childRules: 'many' },
    headline: { childRules: 'none' },
    text: { childRules: 'none' },
    'progress-ring': { childRules: 'none' },
  },
  nestingRules: { maxNodes: 500 },
};

function root(children: CatalogNode[]): CatalogNode {
  return { id: 'root', kind: 'stack', template: 'page-generic', children };
}

describe('fetchCatalog', () => {
  it('strips the weak ETag wrapper and returns the digest', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { ETag: 'W/"sha256:abc"' },
      }),
    ) as unknown as typeof fetch;
    const result = await fetchCatalog('https://api.member.dev', fetchImpl);
    expect(result.digest).toBe('sha256:abc');
    expect(result.catalog.meta.catalogVersion).toBe('0.23.6');
  });

  it('falls back to the body digest when the response carries no ETag', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })) as unknown as typeof fetch;
    expect((await fetchCatalog('https://api.member.dev', fetchImpl)).digest).toBe('sha256:abc');
  });

  it('throws on a non-200 rather than returning a partial catalog', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchCatalog('https://api.member.dev', fetchImpl)).rejects.toThrow(/503/);
  });
});

describe('validateTree', () => {
  it('accepts a well-formed tree', () => {
    const tree = root([
      { id: 'a', kind: 'container', template: 'row', children: [{ id: 'b', kind: 'headline', value: 'Hi', settings: { level: 2 } }] },
    ]);
    expect(validateTree(catalog, tree)).toEqual([]);
  });

  it('rejects an unknown node kind', () => {
    const tree = root([{ id: 'a', kind: 'subheadline', template: 'row', value: 'x' }]);
    expect(validateTree(catalog, tree)).toContain('node a: unknown kind "subheadline"');
  });

  it('rejects a top-level section node with no template, which would render without a section row', () => {
    const tree = root([{ id: 'a', kind: 'container', children: [] }]);
    expect(validateTree(catalog, tree)).toContain('node a: top-level section node carries no template');
  });

  it('accepts an untemplated root child tagged as a slot region, the shape the auth brand panel takes', () => {
    const tree = root([{ id: 'panel', kind: 'stack', settings: { slot: 'brand-panel' }, children: [] }]);
    expect(validateTree(catalog, tree)).toEqual([]);
  });

  it('rejects a template that is not in the catalog', () => {
    const tree = root([{ id: 'a', kind: 'container', template: 'mystery', children: [] }]);
    expect(validateTree(catalog, tree)).toContain('node a: unknown template "mystery"');
  });

  it('rejects a node carrying both value and children', () => {
    const tree = root([
      { id: 'a', kind: 'container', template: 'row', value: 'x', children: [{ id: 'b', kind: 'text', value: 'y' }] },
    ]);
    expect(validateTree(catalog, tree)).toContain('node a: value and children are mutually exclusive');
  });

  it('rejects content parked at settings.value, the silent-drop trap', () => {
    const tree = root([
      { id: 'a', kind: 'container', template: 'row', children: [{ id: 'b', kind: 'text', settings: { value: 'lost' } }] },
    ]);
    expect(validateTree(catalog, tree)).toContain(
      'node b: settings.value holds content but kind "text" reads the top-level value',
    );
  });

  it('allows settings.value on progress-ring, the one kind that reads it', () => {
    const tree = root([
      { id: 'a', kind: 'container', template: 'row', children: [{ id: 'b', kind: 'progress-ring', settings: { value: 42 } }] },
    ]);
    expect(validateTree(catalog, tree)).toEqual([]);
  });

  it('rejects a non-root node with no id', () => {
    const tree = root([{ kind: 'container', template: 'row', children: [] }]);
    expect(validateTree(catalog, tree)).toContain('a node below root has no id');
  });

  it('rejects a tree over the 500 node cap', () => {
    const many: CatalogNode[] = Array.from({ length: 501 }, (_, i) => ({
      id: `n${i}`, kind: 'text', value: 'x',
    }));
    const tree = root([{ id: 'a', kind: 'container', template: 'row', children: many }]);
    expect(validateTree(catalog, tree).some((v) => v.includes('exceeds the 500 node cap'))).toBe(true);
  });

  it('rejects a second level-1 headline, which the renderer silently demotes', () => {
    const tree = root([
      {
        id: 'a', kind: 'container', template: 'row',
        children: [
          { id: 'b', kind: 'headline', value: 'one', settings: { level: 1 } },
          { id: 'c', kind: 'headline', value: 'two', settings: { level: 1 } },
        ],
      },
    ]);
    expect(validateTree(catalog, tree)).toContain('node c: a page may carry only one level 1 headline');
  });
});
