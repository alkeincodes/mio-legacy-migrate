import type { LegacySection, LegacySegment, LegacySegmentable } from '../extract/queries.js';
import { MORPH_SECTION } from '../extract/queries.js';
import type { PlanAccessRule } from './plan.js';

export interface GateResolution {
  restricted: boolean;
  rule: PlanAccessRule | null;
  unmappedReason: string | null;
}

export function segmentRef(legacySegmentId: number): string {
  return `ledger://segment/${legacySegmentId}`;
}

export function resolveGate(input: {
  section: LegacySection;
  segmentables: LegacySegmentable[];
  segments: LegacySegment[];
  sectionNodeId: string;
}): GateResolution {
  const { section, segmentables, segments, sectionNodeId } = input;
  const known = new Set(segments.map((s) => s.id));

  const gateIds = new Set<number>();
  if (section.segment_id !== null) gateIds.add(section.segment_id);
  for (const link of segmentables) {
    if (link.segmentable_type === MORPH_SECTION && link.segmentable_id === section.id) {
      gateIds.add(link.segment_id);
    }
  }

  if (gateIds.size === 0) {
    if (section.permissions) {
      return {
        restricted: true,
        rule: null,
        unmappedReason:
          'section carries the deprecated permissions column with no segment gate; V3 has no equivalent and the section stays unpublished',
      };
    }
    return { restricted: false, rule: null, unmappedReason: null };
  }

  const unknown = [...gateIds].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      restricted: true,
      rule: null,
      unmappedReason: `section is gated by legacy segment ${unknown.join(', ')}, which is not in the extract set`,
    };
  }

  return {
    restricted: true,
    unmappedReason: null,
    rule: {
      targetKind: 'node',
      legacySectionId: section.id,
      targetRef: sectionNodeId,
      logicOperator: 'any',
      conditions: [...gateIds].sort((a, b) => a - b).map((id, position) => ({
        condition_type: 'in_segment' as const,
        condition_data: { segment_id: segmentRef(id) },
        position,
      })),
    },
  };
}
