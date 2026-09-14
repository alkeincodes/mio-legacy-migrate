import Hashids from 'hashids';

/**
 * A legacy hub answers at its custom domain (`hubs.domain`), at
 * `<custom_subdomain>.membership.io`, or, when it has neither, at
 * `hub-<hash>.membership.io` where the hash is the hub id through the
 * `hub.subdomain` Hashids connection (searchie app/Models/Hub.php:840-850,
 * config/hashids.php:209-213). The replica stores nothing for that last form,
 * so the host has to be decoded back to the id.
 */
const DEFAULT_HOST = /^hub-([a-z0-9]{10})\.membership\.io$/;

/**
 * The salt of that connection is a legacy production secret and lives in
 * `.env` as LEGACY_HASHIDS_SALT, never in this repo. Without it a default
 * host cannot be decoded; every other host form still works.
 */
function subdomainHashids(): Hashids | null {
  const salt = process.env['LEGACY_HASHIDS_SALT']?.trim();
  return salt ? new Hashids(salt, 10, 'abcdefghijklmnopqrstuvwxyz0123456789') : null;
}

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
  const hashids = subdomainHashids();
  if (!hashids) {
    throw new Error(`"${host}" is a default hub host; decoding it needs LEGACY_HASHIDS_SALT in .env (searchie config/hashids.php, the hub.subdomain connection). Pass the hub's custom domain or subdomain instead.`);
  }
  const [first] = hashids.decode(match[1] ?? '');
  const id = Number(first);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The default host a hub answers at when it has no custom domain. */
export function defaultHostFor(hubId: number): string {
  const hashids = subdomainHashids();
  if (!hashids) throw new Error('defaultHostFor needs LEGACY_HASHIDS_SALT in .env');
  return `hub-${hashids.encode(hubId)}.membership.io`;
}
