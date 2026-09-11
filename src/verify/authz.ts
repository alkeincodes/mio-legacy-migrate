export type Principal = 'anonymous' | 'memberNoEntitlement' | 'memberEntitled';
export type RuleKind = 'public' | 'members' | 'entitlement-or-segment';

const PRINCIPALS: Principal[] = ['anonymous', 'memberNoEntitlement', 'memberEntitled'];

export function expectedOutcomes(rule: RuleKind): Record<Principal, 'allowed' | 'refused'> {
  if (rule === 'public') {
    return { anonymous: 'allowed', memberNoEntitlement: 'allowed', memberEntitled: 'allowed' };
  }
  if (rule === 'members') {
    return { anonymous: 'refused', memberNoEntitlement: 'allowed', memberEntitled: 'allowed' };
  }
  return { anonymous: 'refused', memberNoEntitlement: 'refused', memberEntitled: 'allowed' };
}

/** 404 counts, because a target may deliberately hide the existence of a gated item. */
export function isRefusal(status: number, location: string | null): boolean {
  if (status === 401 || status === 403 || status === 404) return true;
  if (status >= 300 && status < 400 && location !== null) return /\/login(\?|$)/.test(location);
  return false;
}

export interface AuthzTarget {
  kind: 'section' | 'playlist' | 'folder' | 'asset';
  ref: string;
  url: string;
  rule: RuleKind;
}

export interface AuthzResult {
  target: AuthzTarget;
  observed: Record<Principal, 'allowed' | 'refused'>;
  pass: boolean;
  reason: string | null;
}

export type Requester = (
  url: string,
  principal: Principal,
) => Promise<{ status: number; location: string | null }>;

export async function runAuthorizationChecks(
  targets: AuthzTarget[],
  request: Requester,
): Promise<AuthzResult[]> {
  const results: AuthzResult[] = [];

  for (const target of targets) {
    const observed = {} as Record<Principal, 'allowed' | 'refused'>;
    for (const principal of PRINCIPALS) {
      const response = await request(target.url, principal);
      observed[principal] = isRefusal(response.status, response.location) ? 'refused' : 'allowed';
    }

    const expected = expectedOutcomes(target.rule);
    const mismatches = PRINCIPALS.filter((p) => observed[p] !== expected[p]);
    results.push({
      target,
      observed,
      pass: mismatches.length === 0,
      reason:
        mismatches.length === 0
          ? null
          : mismatches
              .map((p) => `${p} was ${observed[p]} but a ${target.rule} rule expects ${expected[p]}`)
              .join('; '),
    });
  }

  return results;
}
