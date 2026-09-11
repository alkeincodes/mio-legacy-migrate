import { describe, expect, it } from 'vitest';
import { evaluatePlayback, renderContactSheet, VIEWPORTS } from '../../src/verify/browser.js';

describe('VIEWPORTS', () => {
  it('captures a desktop and a mobile width', () => {
    expect(VIEWPORTS.desktop.width).toBeGreaterThanOrEqual(1280);
    expect(VIEWPORTS.mobile.width).toBeLessThanOrEqual(430);
  });
});

describe('renderContactSheet', () => {
  it('puts legacy on the left and V3 on the right for every pair', () => {
    const html = renderContactSheet(
      [{ slug: 'about', viewport: 'desktop', legacyPath: 'legacy-about-desktop.png', v3Path: 'v3-about-desktop.png' }],
      'ManTalks Alliance',
    );
    expect(html.indexOf('legacy-about-desktop.png')).toBeLessThan(html.indexOf('v3-about-desktop.png'));
    expect(html).toContain('about');
    expect(html).toContain('ManTalks Alliance');
  });

  it('groups the desktop and mobile shots of one page together', () => {
    const html = renderContactSheet(
      [
        { slug: 'about', viewport: 'desktop', legacyPath: 'l-d.png', v3Path: 'v-d.png' },
        { slug: 'about', viewport: 'mobile', legacyPath: 'l-m.png', v3Path: 'v-m.png' },
      ],
      'ManTalks',
    );
    expect((html.match(/<section/g) ?? []).length).toBe(1);
  });

  it('says plainly that no automated diff was run', () => {
    expect(renderContactSheet([], 'ManTalks')).toContain('no automated pixel or layout diff');
  });
});

describe('evaluatePlayback', () => {
  const url = 'https://hub.member.dev/alliance/about';

  it('passes when the video reaches canplaythrough with no console errors', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: [], videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe('browser');
  });

  it('fails on a CORS console error even when the video loaded', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: ['Access to fetch blocked by CORS policy'],
      videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('CORS');
  });

  it('fails on a MEDIA_ERR console error', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: ['MEDIA_ERR_SRC_NOT_SUPPORTED'], videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(false);
  });

  it('fails on a failed fetch console error', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: ['Failed to fetch https://cdn.legacy.example.com/x.m3u8'],
      videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(false);
  });

  it('ignores a console error that is not about media', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: ['favicon.ico 404'], videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(true);
  });

  it('fails when the video never reached canplaythrough inside the window', () => {
    const result = evaluatePlayback('about', url, { consoleErrors: [], videoState: 'timeout', textTrackStates: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('20 seconds');
  });

  it('fails when the page carries no video element at all', () => {
    const result = evaluatePlayback('about', url, { consoleErrors: [], videoState: 'absent', textTrackStates: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no video element');
  });

  it('fails when a caption track did not reach loaded', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: [], videoState: 'canplaythrough', textTrackStates: ['loaded', 'error'],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('text track');
  });

  it('passes a video with no caption tracks at all, which is vacuously fine', () => {
    const result = evaluatePlayback('about', url, {
      consoleErrors: [], videoState: 'canplaythrough', textTrackStates: [],
    });
    expect(result.ok).toBe(true);
  });
});
