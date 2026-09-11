import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FETCH_TIMEOUT_MS = 30_000;

export interface PlaybackResult {
  url: string;
  stage: 'prefilter' | 'browser';
  ok: boolean;
  reason: string | null;
  contentType: string | null;
  checkedAt: string;
}

const MEDIA_PREFIXES = ['video/', 'audio/', 'image/', 'application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/octet-stream', 'text/vtt'];

export function isHlsContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.startsWith('application/vnd.apple.mpegurl') || lower.startsWith('application/x-mpegurl');
}

export function parseHlsManifest(
  body: string,
  baseUrl: string,
): { variants: string[]; segments: string[]; keys: string[]; captions: string[] } {
  const variants: string[] = [];
  const segments: string[] = [];
  const keys: string[] = [];
  const captions: string[] = [];
  const resolve = (uri: string): string => new URL(uri, baseUrl).toString();

  const lines = body.split(/\r?\n/);
  let expectVariant = false;
  let expectSegment = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) { expectVariant = true; continue; }
    if (line.startsWith('#EXTINF')) { expectSegment = true; continue; }
    if (line.startsWith('#EXT-X-KEY')) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) keys.push(resolve(uri));
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA') && /TYPE=SUBTITLES/.test(line)) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) captions.push(resolve(uri));
      continue;
    }
    if (line.startsWith('#')) continue;
    if (expectVariant) { variants.push(resolve(line)); expectVariant = false; continue; }
    if (expectSegment) { segments.push(resolve(line)); expectSegment = false; continue; }
  }

  return { variants, segments, keys, captions };
}

async function probe(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ result: PlaybackResult; body: string | null }> {
  const checkedAt = new Date().toISOString();

  if (new URL(url).search.length > 0) {
    return {
      result: {
        url, stage: 'prefilter', ok: false, contentType: null, checkedAt,
        reason: 'the URL carries a query string, which is where signatures and expiring tokens live; a legacy URL that needs one cannot be emitted',
      },
      body: null,
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      result: {
        url, stage: 'prefilter', ok: false, contentType: null, checkedAt,
        reason: `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      body: null,
    };
  }

  const contentType = response.headers.get('Content-Type');
  if (response.status !== 200) {
    return {
      result: { url, stage: 'prefilter', ok: false, contentType, checkedAt, reason: `expected 200, got ${response.status}` },
      body: null,
    };
  }
  const lower = (contentType ?? '').toLowerCase();
  if (!MEDIA_PREFIXES.some((p) => lower.startsWith(p))) {
    return {
      result: { url, stage: 'prefilter', ok: false, contentType, checkedAt, reason: `unexpected content type ${contentType ?? 'none'}` },
      body: null,
    };
  }

  const body = isHlsContentType(contentType) ? await response.text() : null;
  return { result: { url, stage: 'prefilter', ok: true, contentType, checkedAt, reason: null }, body };
}

/**
 * Fetches from a clean session with no cookies. For HLS it walks the master
 * manifest, every variant, the first segment of each variant, the key URI and
 * every caption track. Any failure keeps the asset pending-import.
 */
export async function playbackPrefilter(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaybackResult[]> {
  const results: PlaybackResult[] = [];
  const seen = new Set<string>();

  const check = async (target: string): Promise<string | null> => {
    if (seen.has(target)) return null;
    seen.add(target);
    const { result, body } = await probe(target, fetchImpl);
    results.push(result);
    return result.ok ? body : null;
  };

  const masterBody = await check(url);
  if (masterBody === null) return results;

  const master = parseHlsManifest(masterBody, url);
  for (const caption of master.captions) await check(caption);
  for (const variantUrl of master.variants) {
    const variantBody = await check(variantUrl);
    if (variantBody === null) continue;
    const variant = parseHlsManifest(variantBody, variantUrl);
    for (const key of variant.keys) await check(key);
    const firstSegment = variant.segments[0];
    if (firstSegment) await check(firstSegment);
  }

  // A media playlist handed to us directly, with no master above it.
  if (master.variants.length === 0) {
    const direct = parseHlsManifest(masterBody, url);
    for (const key of direct.keys) await check(key);
    const firstSegment = direct.segments[0];
    if (firstSegment) await check(firstSegment);
  }

  return results;
}

export function writePlaybackReport(results: PlaybackResult[], runDir: string): string {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, 'playback.json');
  writeFileSync(path, JSON.stringify(results, null, 2), 'utf8');
  return path;
}
