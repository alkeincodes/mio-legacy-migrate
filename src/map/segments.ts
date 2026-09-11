/**
 * Legacy audience segments to V3 condition trees.
 *
 * A legacy segment is groups joined by `segments.logic`, each group its
 * conditions joined by `segment_groups.logic`, either side and/or. V3 stores
 * only an OR of AND groups (app/segments/schemas.py ConditionTreeIn), so the
 * legacy tree is flattened to disjunctive normal form here. Only the condition
 * types this hub uses have a V3 equivalent so far; anything else leaves the
 * segment unmapped with a reason the report prints.
 */
import type { LegacySegment, LegacySegmentCondition, LegacySegmentGroup } from '../extract/queries.js';
import type { PlanSegmentCondition, PlanSegmentTree, PlanTag } from './plan.js';

/** Placeholder the apply stage swaps for the target hub id. */
export const HUB_REF = 'ledger://hub';

/** V3 caps a tree at 50 groups. */
const MAX_GROUPS = 50;

/** V3 tag slugs are `^[a-z0-9][a-z0-9_-]*$`. */
export function tagSlugFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.replace(/^[^a-z0-9]+/, '') || 'tag';
}

export interface MappedSegment {
  tree: PlanSegmentTree | null;
  tags: PlanTag[];
  unmappedReason: string | null;
}

type ConditionResult = { condition: PlanSegmentCondition; tag: PlanTag | null } | { reason: string };

/**
 * Legacy `date_registered more_than N` is "registered before N days ago" and
 * `less_than N` is "registered within the last N days" (searchie
 * CreatedAtResolver). V3's date_registered has no rolling "older than" form, so
 * both sides use hub_time_since_joining, which counts days since the contact
 * joined this hub and takes the hub id at apply time.
 */
function mapCondition(c: LegacySegmentCondition): ConditionResult {
  const label = `${c.condition} (${c.type}, ${c.operator})`;
  if (c.type === 'standard' && c.condition === 'date_registered') {
    const days = Number(c.value);
    if (!Number.isInteger(days) || days < 0) return { reason: `${label}: value "${c.value}" is not a day count` };
    if (c.operator === 'less_than') return { condition: { type: 'hub_time_since_joining', operator: 'lte_days', value: { hub_id: HUB_REF, days } }, tag: null };
    if (c.operator === 'more_than') return { condition: { type: 'hub_time_since_joining', operator: 'gte_days', value: { hub_id: HUB_REF, days } }, tag: null };
    return { reason: `${label}: only less_than and more_than have a V3 equivalent` };
  }
  if (c.type === 'standard' && c.condition === 'tags') {
    if (c.tag_id === null || !c.value) return { reason: `${label}: the condition names no tag` };
    const positive = c.operator === 'equals' || c.operator === 'contains';
    const negative = c.operator === 'not_equals' || c.operator === 'not_contains';
    if (!positive && !negative) return { reason: `${label}: operator has no V3 equivalent` };
    const tag: PlanTag = { legacyTagId: c.tag_id, name: c.value, slug: tagSlugFor(c.value) };
    return { condition: { type: 'has_tag', operator: positive ? 'has' : 'has_not', value: { tag_slug: tag.slug } }, tag };
  }
  return { reason: `${label} has no V3 condition mapping` };
}

export function mapSegment(
  segment: LegacySegment,
  groups: LegacySegmentGroup[],
  conditions: LegacySegmentCondition[],
): MappedSegment {
  if (conditions.length === 0) return { tree: null, tags: [], unmappedReason: 'the segment has no conditions' };

  const tags = new Map<string, PlanTag>();
  const groupLogic = new Map(groups.map((g) => [g.id, g.logic]));
  const byGroup = new Map<number, PlanSegmentCondition[]>();
  for (const c of conditions) {
    const mapped = mapCondition(c);
    if ('reason' in mapped) return { tree: null, tags: [], unmappedReason: mapped.reason };
    if (mapped.tag) tags.set(mapped.tag.slug, mapped.tag);
    byGroup.set(c.segment_group_id, [...(byGroup.get(c.segment_group_id) ?? []), mapped.condition]);
  }

  // Each legacy group becomes a list of AND-groups: one per condition under or, one for all under and.
  const perGroup: PlanSegmentCondition[][][] = [...byGroup.entries()].map(([groupId, list]) =>
    (groupLogic.get(groupId) ?? 'and') === 'or' ? list.map((c) => [c]) : [list],
  );

  // Segment logic joins the groups: or concatenates, and takes the cross product.
  let dnf: PlanSegmentCondition[][] = segment.logic === 'or' ? perGroup.flat() : [[]];
  if (segment.logic !== 'or') {
    for (const alternatives of perGroup) {
      dnf = dnf.flatMap((prefix) => alternatives.map((alt) => [...prefix, ...alt]));
      if (dnf.length > MAX_GROUPS) return { tree: null, tags: [], unmappedReason: `the and-of-or tree expands to more than ${MAX_GROUPS} groups` };
    }
  }
  if (dnf.length > MAX_GROUPS) return { tree: null, tags: [], unmappedReason: `the tree has more than ${MAX_GROUPS} groups` };

  return {
    tree: { version: 1, groups: dnf.map((list) => ({ logic: 'AND', conditions: list })) },
    tags: [...tags.values()],
    unmappedReason: null,
  };
}

/** The tree with the hub placeholder replaced, for the create call. */
export function resolveHubRef(tree: PlanSegmentTree, hubId: string): PlanSegmentTree {
  return {
    version: 1,
    groups: tree.groups.map((g) => ({
      logic: 'AND',
      conditions: g.conditions.map((c) => ({
        ...c,
        value: c.value['hub_id'] === HUB_REF ? { ...c.value, hub_id: hubId } : c.value,
      })),
    })),
  };
}
