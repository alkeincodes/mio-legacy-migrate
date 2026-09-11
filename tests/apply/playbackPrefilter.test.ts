import { describe, expect, it, vi } from 'vitest';
import { isHlsContentType, parseHlsManifest, playbackPrefilter } from '../../src/apply/playbackPrefilter.js';

function responder(map: Record<string, { status: number; contentType: string; body?: string }>): typeof fetch {
  return (vi.fn(async (input: string | URL) => {
    const url = String(input);
    const hit = map[url];
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit.body ?? 'bytes', {
      status: hit.status,
      headers: { 'Content-Type': hit.contentType },
    });
  }) as unknown) as typeof fetch;
}

describe('playbackPrefilter', () => {
  it('passes a plain mp4 served as 200 with a video content type', async () => {
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/intro.mp4',
      responder({ 'https://cdn.example.com/a/intro.mp4': { status: 200, contentType: 'video/mp4' } }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.stage).toBe('prefilter');
  });

  it('rejects a URL carrying a query string without fetching it, because that is where signatures live', async () => {
    const fetchImpl = vi.fn();
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/intro.mp4?X-Amz-Signature=abc',
      fetchImpl as unknown as typeof fetch,
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.reason).toContain('query string');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-200', async () => {
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/gone.mp4',
      responder({ 'https://cdn.example.com/a/gone.mp4': { status: 403, contentType: 'text/plain' } }),
    );
    expect(results[0]?.reason).toContain('403');
  });

  it('rejects a content type that is not media', async () => {
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/intro.mp4',
      responder({ 'https://cdn.example.com/a/intro.mp4': { status: 200, contentType: 'text/html' } }),
    );
    expect(results[0]?.reason).toContain('text/html');
  });

  it('walks an HLS master: every variant, the first segment of each, the key and the captions', async () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subs.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'low.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000',
      'high.m3u8',
    ].join('\n');
    const variant = ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXTINF:6,', 'seg0.ts', '#EXTINF:6,', 'seg1.ts'].join('\n');
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/master.m3u8',
      responder({
        'https://cdn.example.com/a/master.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: master },
        'https://cdn.example.com/a/low.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: variant },
        'https://cdn.example.com/a/high.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: variant },
        'https://cdn.example.com/a/subs.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U' },
        'https://cdn.example.com/a/seg0.ts': { status: 200, contentType: 'video/mp2t' },
        'https://cdn.example.com/a/key.bin': { status: 200, contentType: 'application/octet-stream' },
      }),
    );
    const urls = results.map((r) => r.url);
    expect(urls).toContain('https://cdn.example.com/a/low.m3u8');
    expect(urls).toContain('https://cdn.example.com/a/high.m3u8');
    expect(urls).toContain('https://cdn.example.com/a/seg0.ts');
    expect(urls).toContain('https://cdn.example.com/a/key.bin');
    expect(urls).toContain('https://cdn.example.com/a/subs.m3u8');
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('fails the whole asset when one variant manifest is missing', async () => {
    const master = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=800000', 'low.m3u8'].join('\n');
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/master.m3u8',
      responder({
        'https://cdn.example.com/a/master.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: master },
      }),
    );
    expect(results.some((r) => !r.ok)).toBe(true);
  });

  it('only fetches the first segment of each variant, not the whole ladder', async () => {
    const master = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=800000', 'low.m3u8'].join('\n');
    const variant = ['#EXTM3U', '#EXTINF:6,', 'seg0.ts', '#EXTINF:6,', 'seg1.ts'].join('\n');
    const results = await playbackPrefilter(
      'https://cdn.example.com/a/master.m3u8',
      responder({
        'https://cdn.example.com/a/master.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: master },
        'https://cdn.example.com/a/low.m3u8': { status: 200, contentType: 'application/vnd.apple.mpegurl', body: variant },
        'https://cdn.example.com/a/seg0.ts': { status: 200, contentType: 'video/mp2t' },
      }),
    );
    expect(results.map((r) => r.url)).not.toContain('https://cdn.example.com/a/seg1.ts');
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('parseHlsManifest', () => {
  it('resolves relative URIs against the manifest URL', () => {
    const parsed = parseHlsManifest(
      ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1', 'v/low.m3u8'].join('\n'),
      'https://cdn.example.com/a/master.m3u8',
    );
    expect(parsed.variants).toEqual(['https://cdn.example.com/a/v/low.m3u8']);
  });

  it('ignores comment lines that are not tags it cares about', () => {
    const parsed = parseHlsManifest(['#EXTM3U', '#EXT-X-VERSION:4'].join('\n'), 'https://cdn.example.com/a/m.m3u8');
    expect(parsed).toEqual({ variants: [], segments: [], keys: [], captions: [] });
  });
});

describe('isHlsContentType', () => {
  it('recognises both spellings and nothing else', () => {
    expect(isHlsContentType('application/vnd.apple.mpegurl')).toBe(true);
    expect(isHlsContentType('application/x-mpegURL')).toBe(true);
    expect(isHlsContentType('video/mp4')).toBe(false);
    expect(isHlsContentType(null)).toBe(false);
  });
});
