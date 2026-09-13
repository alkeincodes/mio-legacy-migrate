import Hashids from 'hashids';

/**
 * A legacy hub answers at its custom domain (`hubs.domain`), at
 * `<custom_subdomain>.membership.io`, or, when it has neither, at
 * `hub-<hash>.membership.io` where the hash is the hub id through the
 * `hub.subdomain` Hashids connection (searchie app/Models/Hub.php:840-850,
 * config/hashids.php:209-213). The replica stores nothing for that last form,
 * so the host has to be decoded back to the id.
 */
const SUBDOMAIN_HASHIDS = new Hashids('REDACTED-LEGACY-HASHIDS-SALT', 10, 'abcdefghijklmnopqrstuvwxyz0123456789');
const DEFAULT_HOST = /^hub-([a-z0-9]{10})\.membership\.io$/;

/** What a migrator pastes (a URL, a host, with or without a path) to the bare lowercase host. */
export function normaliseHubHost(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '');
  host = host.replace(/[/?#].*$/, '');
  host = host.replace(/:\d+$/, '');
  return host;
}

/** The hub id behind a default `hub-<hash>.membership.io` host, or null for any other host. */
export function hubIdFromHost(host: string): number | null {
  const match = DEFAULT_HOST.exec(host);
  if (!match) return null;
  const [first] = SUBDOMAIN_HASHIDS.decode(match[1] ?? '');
  const id = Number(first);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The default host a hub answers at when it has no custom domain. */
export function defaultHostFor(hubId: number): string {
  return `hub-${SUBDOMAIN_HASHIDS.encode(hubId)}.membership.io`;
}
