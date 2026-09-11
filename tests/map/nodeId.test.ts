import { describe, expect, it } from 'vitest';
import { nodeId } from '../../src/map/nodeId.js';

describe('nodeId', () => {
  it('is deterministic for the same legacy path', () => {
    expect(nodeId(7, 100, 11100, 0)).toBe(nodeId(7, 100, 11100, 0));
  });

  it('differs on every component of the path', () => {
    const base = nodeId(7, 100, 11100, 0);
    expect(nodeId(8, 100, 11100, 0)).not.toBe(base);
    expect(nodeId(7, 101, 11100, 0)).not.toBe(base);
    expect(nodeId(7, 100, 11101, 0)).not.toBe(base);
    expect(nodeId(7, 100, 11100, 1)).not.toBe(base);
  });

  it('is shaped like a UUID so the backend accepts it anywhere an id is read', () => {
    expect(nodeId(7, 100, 11100, 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
