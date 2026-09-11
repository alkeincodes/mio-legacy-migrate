import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { PlaybackResult } from '../apply/playbackPrefilter.js';
import type { Env } from '../config/env.js';
import { logger } from '../log/logger.js';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const PLAYBACK_WINDOW_MS = 20_000;
const MEDIA_ERROR_SIGNALS = ['cors', 'media_err', 'failed to fetch', 'failed to load'];

export interface ShotPair {
  slug: string;
  viewport: 'desktop' | 'mobile';
  legacyPath: string;
  v3Path: string;
}

export function renderContactSheet(pairs: ShotPair[], hubTitle: string): string {
  const bySlug = new Map<string, ShotPair[]>();
  for (const pair of pairs) bySlug.set(pair.slug, [...(bySlug.get(pair.slug) ?? []), pair]);

  const sections = [...bySlug.entries()].map(([slug, shots]) => {
    const rows = shots
      .map(
        (shot) => `
      <div class="row">
        <figure><figcaption>legacy ${shot.viewport}</figcaption><img src="${shot.legacyPath}" alt="legacy ${slug} ${shot.viewport}"></figure>
        <figure><figcaption>V3 ${shot.viewport}</figcaption><img src="${shot.v3Path}" alt="V3 ${slug} ${shot.viewport}"></figure>
      </div>`,
      )
      .join('');
    return `<section><h2>${slug}</h2>${rows}</section>`;
  });

  return `<!doctype html>
<meta charset="utf-8">
<title>Contact sheet: ${hubTitle}</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 24px; background: #fafafa; color: #111; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #555; margin-bottom: 4px; }
  img { width: 100%; border: 1px solid #ddd; background: #fff; }
  section { margin-bottom: 48px; }
</style>
<h1>${hubTitle}</h1>
<p>Legacy on the left, V3 on the right. This is a human comparison aid: no automated pixel or layout diff was run.</p>
${sections.join('')}
`;
}

export interface BrowserPageProbe {
  consoleErrors: string[];
  videoState: 'canplaythrough' | 'timeout' | 'error' | 'absent';
  textTrackStates: string[];
}

export function evaluatePlayback(slug: string, url: string, probe: BrowserPageProbe): PlaybackResult {
  const checkedAt = new Date().toISOString();
  const base = { url, stage: 'browser' as const, contentType: null, checkedAt };

  const mediaError = probe.consoleErrors.find((message) =>
    MEDIA_ERROR_SIGNALS.some((signal) => message.toLowerCase().includes(signal)),
  );
  if (mediaError) {
    return { ...base, ok: false, reason: `page /${slug} logged a media console error: ${mediaError}` };
  }
  if (probe.videoState === 'absent') {
    return { ...base, ok: false, reason: `page /${slug} carries a legacy-linked video but rendered no video element` };
  }
  if (probe.videoState === 'error') {
    return { ...base, ok: false, reason: `the video element on /${slug} fired an error event` };
  }
  if (probe.videoState === 'timeout') {
    return { ...base, ok: false, reason: `the video on /${slug} did not reach canplaythrough within 20 seconds` };
  }
  const badTrack = probe.textTrackStates.find((state) => state !== 'loaded');
  if (badTrack !== undefined) {
    return { ...base, ok: false, reason: `a caption text track on /${slug} is in state "${badTrack}", not loaded` };
  }
  return { ...base, ok: true, reason: null };
}

/**
 * Logs in through the site's own form (for V3 that is the hub member login at
 * <hub>/login, not the platform login) and refuses to continue while still on
 * a login page, so a wrong identity fails here instead of producing a sheet of
 * login walls.
 */
async function login(page: Page, url: string, email: string, password: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const passwordField = page.locator('input[type="password"], input[name="password"]').first();
  // Both sites render the form client-side; give it a moment before calling it magic-link only.
  await passwordField.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  if ((await passwordField.count()) === 0) {
    throw new Error(`${url} offers no password field (magic-link only?); cannot log in unattended`);
  }
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await passwordField.fill(password);
  // The hub also offers "Sign in using Magic Link" ahead of the real button, so
  // prefer the submit button and fall back to an exact label only.
  const submit = page.locator('button[type="submit"]');
  if ((await submit.count()) > 0) await submit.first().click();
  else await page.locator('button:text-is("Sign in"), button:text-is("Log in"), button:text-is("Login")').first().click();
  // The hub sets its session then navigates client-side; wait for the URL to leave /login.
  try {
    await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 30_000 });
  } catch {
    // fall through to the check below, which names the identity
  }
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  if (/\/login(\?|$)/.test(page.url()) || (await passwordField.count()) > 0) {
    throw new Error(`login as ${email} at ${url} did not leave the login page (still at ${page.url()}); is that identity a member of this hub?`);
  }
  logger.info('logged in', { url, as: email });
}

/**
 * The hub keeps a connection open, so 'networkidle' never fires; wait for load,
 * give the client a moment to render, and record a page that will not load as a
 * blank shot rather than abandoning the whole sheet.
 */
async function capture(page: Page, url: string, path: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await page.screenshot({ path, fullPage: true });
  } catch (error) {
    logger.warn('could not capture a page; recording the failure', { url, error: error instanceof Error ? error.message.split('\n')[0] : String(error) });
    await page.screenshot({ path, fullPage: false }).catch(() => undefined);
  }
}

export async function captureContactSheet(opts: {
  env: Env;
  slugs: string[];
  legacyOrigin: string;
  v3Origin: string;
  hubTitle: string;
  runDir: string;
}): Promise<string> {
  const shotsDir = join(opts.runDir, 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const browser: Browser = await chromium.launch();
  const pairs: ShotPair[] = [];

  try {
    for (const [name, viewport] of Object.entries(VIEWPORTS) as Array<['desktop' | 'mobile', { width: number; height: number }]>) {
      const legacyContext = await browser.newContext({ viewport });
      const legacyPage = await legacyContext.newPage();
      await login(legacyPage, `${opts.legacyOrigin}/login`, opts.env.legacyHubLoginEmail, opts.env.legacyHubLoginPassword);

      const v3Context = await browser.newContext({ viewport });
      const v3Page = await v3Context.newPage();
      await login(v3Page, `${opts.v3Origin}/login`, opts.env.v3VerifyLoginEmail, opts.env.v3VerifyLoginPassword);

      for (const slug of opts.slugs) {
        const legacyPath = `shots/legacy-${slug}-${name}.png`;
        const v3Path = `shots/v3-${slug}-${name}.png`;
        await capture(legacyPage, `${opts.legacyOrigin}/${slug}`, join(opts.runDir, legacyPath));
        await capture(v3Page, `${opts.v3Origin}/${slug}`, join(opts.runDir, v3Path));
        pairs.push({ slug, viewport: name, legacyPath, v3Path });
      }

      await legacyContext.close();
      await v3Context.close();
    }
  } finally {
    await browser.close();
  }

  const path = join(opts.runDir, 'contact-sheet.html');
  writeFileSync(path, renderContactSheet(pairs, opts.hubTitle), 'utf8');
  logger.info('contact sheet written', { path, shots: pairs.length * 2 });
  return path;
}

export async function runBrowserPlaybackChecks(opts: {
  env: Env;
  v3Origin: string;
  slugs: string[];
}): Promise<PlaybackResult[]> {
  const browser = await chromium.launch();
  const results: PlaybackResult[] = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
    const page = await context.newPage();
    await login(page, `${opts.v3Origin}/login`, opts.env.v3VerifyLoginEmail, opts.env.v3VerifyLoginPassword);

    for (const slug of opts.slugs) {
      const consoleErrors: string[] = [];
      // Only errors raised by a media request count; a 404 on some unrelated
      // resource must not fail the playback check.
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const at = message.location().url ?? '';
        const text = message.text();
        const aboutMedia = /\.(m3u8|mp4|m4v|mov|ts|vtt|webm)(\?|$)/i.test(at) || /cdn\.|\/media\//i.test(at) || /MEDIA_ERR|CORS|hls/i.test(text);
        if (aboutMedia) consoleErrors.push(`${text} (${at})`);
      });
      const url = `${opts.v3Origin}/${slug}`;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForTimeout(2_000);
      } catch (error) {
        results.push(evaluatePlayback(slug, url, {
          consoleErrors: [`Failed to load ${url}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`],
          videoState: 'absent', textTrackStates: [],
        }));
        page.removeAllListeners('console');
        continue;
      }

      const probe = await page.evaluate(async (windowMs: number) => {
        const video = document.querySelector('video');
        if (!video) return { videoState: 'absent' as const, textTrackStates: [] as string[] };
        const state = await new Promise<'canplaythrough' | 'timeout' | 'error'>((resolve) => {
          if (video.readyState >= 4) { resolve('canplaythrough'); return; }
          const timer = setTimeout(() => resolve('timeout'), windowMs);
          video.addEventListener('canplaythrough', () => { clearTimeout(timer); resolve('canplaythrough'); }, { once: true });
          video.addEventListener('error', () => { clearTimeout(timer); resolve('error'); }, { once: true });
        });
        // TextTrack has no readiness; the <track> element's readyState does
        // (0 none, 1 loading, 2 loaded, 3 error).
        // A disabled track never loads by design; only tracks the player enabled count.
        const names = ['none', 'loading', 'loaded', 'error'];
        const tracks = Array.from(video.querySelectorAll('track'))
          .filter((track) => track.track.mode !== 'disabled')
          .map((track) => names[track.readyState] ?? 'none');
        return { videoState: state, textTrackStates: tracks };
      }, PLAYBACK_WINDOW_MS);

      results.push(evaluatePlayback(slug, url, { consoleErrors, ...probe }));
      page.removeAllListeners('console');
    }

    await context.close();
  } finally {
    await browser.close();
  }
  return results;
}
