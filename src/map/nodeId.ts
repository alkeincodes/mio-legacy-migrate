import { createHash } from 'node:crypto';

/**
 * Deterministic, UUID-shaped node id from the legacy path, so a rerun of map
 * produces byte-identical trees and a rerun of apply writes the same ids.
 */
export function nodeId(
  legacyHubId: number,
  legacyPageId: number,
  legacySectionId: number,
  ordinal: number,
): string {
  const hex = createHash('sha256')
    .update(`${legacyHubId}/${legacyPageId}/${legacySectionId}/${ordinal}`)
    .digest('hex')
    .slice(0, 32);
  const variantNibble = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
