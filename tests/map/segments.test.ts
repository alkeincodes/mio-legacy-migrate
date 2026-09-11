import { describe, expect, it } from 'vitest';
import { HUB_REF, mapSegment, resolveHubRef, tagSlugFor } from '../../src/map/segments.js';
import type { LegacySegment, LegacySegmentCondition, LegacySegmentGroup } from '../../src/extract/queries.js';

const segment = (logic: 'and' | 'or' = 'and'): LegacySegment => ({
  id: 35073, team_id: 1, title: 'Post 30 Days', type: 'audience', logic, hidden: 0, achievement_id: null,
});
const group = (id: number, logic: 'and' | 'or'): LegacySegmentGroup => ({ id, segment_id: 35073, logic });
const cond = (
  id: number, groupId: number, condition: string, operator: string, value: string | null, type = 'standard', tagId: number | null = null,
): LegacySegmentCondition => ({ id, segment_id: 35073, segment_group_id: groupId, condition, operator, value, type, tag_id: tagId });

describe('tagSlugFor', () => {
  it('lowercases and dashes a legacy tag name into a V3 slug', () => {
    expect(tagSlugFor('ManTalks Team')).toBe('mantalks-team');
    expect(tagSlugFor("Alliance Member Sept 2025 Migration List")).toBe('alliance-member-sept-2025-migration-list');
    expect(tagSlugFor('  --Weird__ name!  ')).toBe('weird-name');
  });
});

describe('mapSegment', () => {
  it('turns "registered more than 30 days ago OR tagged" into two V3 groups joined by or', () => {
    const mapped = mapSegment(segment('and'), [group(1, 'or')], [
      cond(1, 1, 'date_registered', 'more_than', '30'),
      cond(2, 1, 'tags', 'equals', 'ManTalks Team', 'standard', 125221),
    ]);
    expect(mapped.unmappedReason).toBeNull();
    expect(mapped.tree).toEqual({
      version: 1,
      groups: [
        { logic: 'AND', conditions: [{ type: 'hub_time_since_joining', operator: 'gte_days', value: { hub_id: HUB_REF, days: 30 } }] },
        { logic: 'AND', conditions: [{ type: 'has_tag', operator: 'has', value: { tag_slug: 'mantalks-team' } }] },
      ],
    });
    expect(mapped.tags).toEqual([{ legacyTagId: 125221, name: 'ManTalks Team', slug: 'mantalks-team' }]);
  });

  it('maps "registered less than 30 days ago" to lte_days and a not_equals tag to has_not', () => {
    const mapped = mapSegment(segment('and'), [group(1, 'and')], [
      cond(1, 1, 'date_registered', 'less_than', '30'),
      cond(2, 1, 'tags', 'not_equals', 'December 2025 Cohort', 'standard', 134005),
    ]);
    expect(mapped.tree?.groups).toEqual([{
      logic: 'AND',
      conditions: [
        { type: 'hub_time_since_joining', operator: 'lte_days', value: { hub_id: HUB_REF, days: 30 } },
        { type: 'has_tag', operator: 'has_not', value: { tag_slug: 'december-2025-cohort' } },
      ],
    }]);
  });

  it('expands and-joined or-groups into the cross product', () => {
    const mapped = mapSegment(segment('and'), [group(1, 'or'), group(2, 'or')], [
      cond(1, 1, 'tags', 'equals', 'A', 'standard', 1),
      cond(2, 1, 'tags', 'equals', 'B', 'standard', 2),
      cond(3, 2, 'date_registered', 'less_than', '7'),
      cond(4, 2, 'date_registered', 'more_than', '60'),
    ]);
    expect(mapped.tree?.groups.map((g) => g.conditions.map((c) => `${c.type}:${c.operator}:${JSON.stringify(c.value)}`))).toEqual([
      ['has_tag:has:{"tag_slug":"a"}', 'hub_time_since_joining:lte_days:{"hub_id":"ledger://hub","days":7}'],
      ['has_tag:has:{"tag_slug":"a"}', 'hub_time_since_joining:gte_days:{"hub_id":"ledger://hub","days":60}'],
      ['has_tag:has:{"tag_slug":"b"}', 'hub_time_since_joining:lte_days:{"hub_id":"ledger://hub","days":7}'],
      ['has_tag:has:{"tag_slug":"b"}', 'hub_time_since_joining:gte_days:{"hub_id":"ledger://hub","days":60}'],
    ]);
  });

  it('leaves a segment unmapped, with the reason, when a condition has no V3 equivalent', () => {
    const mapped = mapSegment(segment('and'), [group(1, 'and')], [
      cond(1, 1, '31986', 'equals', '32313', 'attribute_multiple'),
    ]);
    expect(mapped.tree).toBeNull();
    expect(mapped.unmappedReason).toContain('31986 (attribute_multiple, equals)');
  });

  it('leaves a segment unmapped when it has no conditions or a bad day count', () => {
    expect(mapSegment(segment(), [], []).unmappedReason).toContain('no conditions');
    expect(mapSegment(segment(), [group(1, 'and')], [cond(1, 1, 'date_registered', 'more_than', 'soon')]).unmappedReason).toContain('day count');
    expect(mapSegment(segment(), [group(1, 'and')], [cond(1, 1, 'date_registered', 'exactly', '30')]).unmappedReason).toContain('less_than and more_than');
  });

  it('lists each needed tag once', () => {
    const mapped = mapSegment(segment('or'), [group(1, 'and'), group(2, 'and')], [
      cond(1, 1, 'tags', 'equals', 'ManTalks Team', 'standard', 125221),
      cond(2, 2, 'tags', 'equals', 'ManTalks Team', 'standard', 125221),
    ]);
    expect(mapped.tags).toHaveLength(1);
    expect(mapped.tree?.groups).toHaveLength(2);
  });
});

describe('resolveHubRef', () => {
  it('swaps the hub placeholder for the target hub id and leaves other values alone', () => {
    const tree = mapSegment(segment('and'), [group(1, 'or')], [
      cond(1, 1, 'date_registered', 'more_than', '30'),
      cond(2, 1, 'tags', 'equals', 'ManTalks Team', 'standard', 125221),
    ]).tree!;
    const resolved = resolveHubRef(tree, 'hub_9');
    expect(resolved.groups[0]?.conditions[0]?.value).toEqual({ hub_id: 'hub_9', days: 30 });
    expect(resolved.groups[1]?.conditions[0]?.value).toEqual({ tag_slug: 'mantalks-team' });
    expect(tree.groups[0]?.conditions[0]?.value['hub_id']).toBe(HUB_REF);
  });
});
