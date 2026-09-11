import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/config/profile.js';

describe('loadProfile', () => {
  it('loads the committed mantalks-prod profile', () => {
    const profile = loadProfile('mantalks-prod');
    expect(profile.name).toBe('mantalks-prod');
    expect(profile.apiBase).toBe('https://api.member.dev');
    expect(profile.teamId).toBe('01a090ff-5ac3-7402-b686-66fd46af67bc');
    expect(profile.region).toBe('us-east-1');
  });

  it('throws a clear error for an unknown profile', () => {
    expect(() => loadProfile('nope')).toThrow(/no profile "nope"/);
  });
});
