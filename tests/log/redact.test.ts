import { describe, expect, it } from 'vitest';
import { createRedactor } from '../../src/log/redact.js';

describe('createRedactor', () => {
  it('replaces every occurrence of a configured secret', () => {
    const redact = createRedactor(['hunter2']);
    expect(redact('password=hunter2 and again hunter2')).toBe(
      'password=[REDACTED] and again [REDACTED]',
    );
  });

  it('strips query strings from URLs, which is where signatures live', () => {
    const redact = createRedactor([]);
    expect(redact('GET https://cdn.example.com/a/b.m3u8?X-Amz-Signature=abc123 200')).toBe(
      'GET https://cdn.example.com/a/b.m3u8?[REDACTED-QUERY] 200',
    );
  });

  it('ignores empty and whitespace-only secrets so it does not redact everything', () => {
    const redact = createRedactor(['', '   ']);
    expect(redact('nothing to hide')).toBe('nothing to hide');
  });

  it('redacts the longest secret first when one contains another', () => {
    const redact = createRedactor(['abc', 'abcdef']);
    expect(redact('abcdef')).toBe('[REDACTED]');
  });
});
