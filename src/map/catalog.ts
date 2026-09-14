import { readFileSync } from 'node:fs';

export interface CatalogNode {
  id?: string;
  kind: string;
  template?: string;
  settings?: Record<string, unknown>;
  value?: unknown;
  children?: CatalogNode[];
  dataSource?: { type: string; id?: string };
  repeat?: { over: 'dataSource'; limit?: number };
  system?: boolean;
  /** Apply-time only: the V3 access rule (target_type node) gating this node; app/pages/converter.py GATE_KEY. */
  access_rule_id?: string;
}

export interface Catalog {
  meta: { catalogVersion: string; digest: string; schemaVersion: string };
  templates: Array<{ id: string; label: string; category: string; compiledSectionType?: string }>;
  sectionTypes: Array<{ id: string; writable: boolean }>;
  nodeKinds: Record<string, { childRules: 'many' | 'none' }>;
  nestingRules: { maxNodes: number };
}

/** The only kind whose content legitimately lives at settings.value. */
const SETTINGS_VALUE_KINDS = new Set(['progress-ring']);

export async function fetchCatalog(
  apiBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ catalog: Catalog; digest: string }> {
  const url = `${apiBase.replace(/\/$/, '')}/api/v1/page-builder/catalog`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`catalog fetch from ${url} returned ${response.status}`);
  }
  const catalog = (await response.json()) as Catalog;
  const etag = response.headers.get('ETag');
  const digest = etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') : catalog.meta.digest;
  return { catalog, digest };
}

export function loadVendoredCatalog(path: string): Catalog {
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

export function validateTree(catalog: Catalog, root: CatalogNode): string[] {
  const violations: string[] = [];
  const templateIds = new Set(catalog.templates.map((t) => t.id));
  let count = 0;
  let levelOneHeadlines = 0;

  const walk = (node: CatalogNode, depth: number): void => {
    count += 1;
    const label = node.id ?? '(no id)';

    if (depth > 0 && !node.id) violations.push('a node below root has no id');
    if (!(node.kind in catalog.nodeKinds)) {
      violations.push(`node ${label}: unknown kind "${node.kind}"`);
    }
    if (node.template !== undefined && !templateIds.has(node.template) && depth > 0) {
      violations.push(`node ${label}: unknown template "${node.template}"`);
    }
    // A root child tagged `settings.slot` is a named region (the auth brand
    // panel), not a section; it carries no template by design.
    if (depth === 1 && node.template === undefined && node.settings?.['slot'] === undefined) {
      violations.push(`node ${label}: top-level section node carries no template`);
    }
    if (node.value !== undefined && node.children !== undefined) {
      violations.push(`node ${label}: value and children are mutually exclusive`);
    }
    if (
      node.settings &&
      'value' in node.settings &&
      node.settings['value'] !== undefined &&
      !SETTINGS_VALUE_KINDS.has(node.kind)
    ) {
      violations.push(
        `node ${label}: settings.value holds content but kind "${node.kind}" reads the top-level value`,
      );
    }
    if (node.kind === 'headline' && node.settings?.['level'] === 1) {
      levelOneHeadlines += 1;
      if (levelOneHeadlines > 1) {
        violations.push(`node ${label}: a page may carry only one level 1 headline`);
      }
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };

  walk(root, 0);
  if (count > catalog.nestingRules.maxNodes) {
    violations.push(`tree has ${count} nodes and exceeds the ${catalog.nestingRules.maxNodes} node cap`);
  }
  return violations;
}
