import { describe, expect, it } from 'vitest';
import { resolveGate } from '../../src/map/visibility.js';
import type { LegacySection, LegacySegment, LegacySegmentable } from '../../src/extract/queries.js';

const section: LegacySection = {
  id: 11100, hub_id: 7, page_id: 100, parent_id: null, model_type: null,
  model_id: null, hidden: 0, type: 'row', title: null, label: null,
  settings: null, permissions: null, meta: null, position: 0, segment_id: null,
};

const segment: LegacySegment = {
  id: 77, team_id: 1, title: 'Paid members', type: null, logic: 'and',
  hidden: 0, achievement_id: null,
};

describe('resolveGate', () => {
  it('reports a public section when nothing gates it', () => {
    expect(resolveGate({ section, segmentables: [], segments: [], sectionNodeId: 'n1' })).toEqual({
      restricted: false, rule: null, unmappedReason: null,
    });
  });

  it('maps a segment_id gate to an in_segment access rule against the section node, created as a node target', () => {
    const result = resolveGate({
      section: { ...section, segment_id: 77 },
      segmentables: [],
      segments: [segment],
      sectionNodeId: 'n1',
    });
    expect(result.restricted).toBe(true);
    expect(result.rule).toEqual({
      targetKind: 'node',
      legacySectionId: 11100,
      targetRef: 'n1',
      logicOperator: 'any',
      conditions: [
        { condition_type: 'in_segment', condition_data: { segment_id: 'ledger://segment/77' }, position: 0 },
      ],
    });
  });

  it('maps a segmentables attachment the same way', () => {
    const link: LegacySegmentable = { id: 1, segment_id: 77, segmentable_id: 11100, segmentable_type: 'App\\Section' };
    const result = resolveGate({ section, segmentables: [link], segments: [segment], sectionNodeId: 'n1' });
    expect(result.rule?.conditions[0]?.condition_data).toEqual({ segment_id: 'ledger://segment/77' });
  });

  it('combines two gates under the any operator without duplicating a segment', () => {
    const result = resolveGate({
      section: { ...section, segment_id: 77 },
      segmentables: [{ id: 1, segment_id: 77, segmentable_id: 11100, segmentable_type: 'App\\Section' }],
      segments: [segment],
      sectionNodeId: 'n1',
    });
    expect(result.rule?.conditions).toHaveLength(1);
  });

  it('marks the section restricted with no rule when the segment is not in the extract set', () => {
    const result = resolveGate({
      section: { ...section, segment_id: 99 },
      segmentables: [],
      segments: [segment],
      sectionNodeId: 'n1',
    });
    expect(result.restricted).toBe(true);
    expect(result.rule).toBeNull();
    expect(result.unmappedReason).toContain('99');
  });

  it('treats the dead permissions column as a restricted signal with no mappable rule', () => {
    const result = resolveGate({
      section: {
        ...section,
        permissions: JSON.stringify({ children: [{ type: 'tags', operator: 'AND', children: [{ value: 'vip' }] }] }),
      },
      segmentables: [],
      segments: [],
      sectionNodeId: 'n1',
    });
    expect(result.restricted).toBe(true);
    expect(result.rule).toBeNull();
    expect(result.unmappedReason).toContain('permissions');
  });
});
