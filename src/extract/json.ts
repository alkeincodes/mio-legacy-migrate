/**
 * A legacy JSON column, whichever way it arrived: a string (jsonStrings on the
 * connection, or a bundle written by this tool) or an object (a driver that
 * parsed it). Anything else, including malformed JSON, is an empty object.
 */
export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
