#!/usr/bin/env node
/**
 * Live-hub probe for checking a migrated page against legacy.
 *
 *   node scripts/probe/hub-probe.mjs measure <page-path> "<section text>"   prints rects and computed styles
 *   node scripts/probe/hub-probe.mjs shot    <page-path> "<section text>" out.png   2x screenshot of that section
 *   node scripts/probe/hub-probe.mjs images  <page-path> "<section text>"   every <img> with its wrapper chain
 *
 * Environment: PROBE_HUB (default https://hub.member.dev/alliance), PROBE_EMAIL,
 * PROBE_EMAIL and PROBE_PASSWORD, a hub member's login; both are required, there are no defaults.
 * Logs in through <hub>/login the way src/verify/browser.ts does, then waits for
 * the first section to render (never networkidle: the hub keeps a socket open).
 */
import { chromium } from 'playwright';

const [mode, pagePath, needle, out] = process.argv.slice(2);
if (!mode || !pagePath || !needle) {
  console.error('usage: hub-probe.mjs measure|shot|images <page-path> "<section text>" [out.png]');
  process.exit(2);
}
const hub = process.env['PROBE_HUB'] ?? 'https://hub.member.dev/alliance';
const email = process.env['PROBE_EMAIL'] ?? '';
const password = process.env['PROBE_PASSWORD'] ?? '';
if (!email || !password) {
  console.error('set PROBE_EMAIL and PROBE_PASSWORD to a hub member login');
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: mode === 'shot' ? 2 : 1 });
await page.goto(`${hub}/login`, { waitUntil: 'domcontentloaded' });
const pw = page.locator('input[type="password"]').first();
await pw.waitFor({ state: 'visible', timeout: 20_000 });
await page.locator('input[type="email"]').first().fill(email);
await pw.fill(password);
await pw.press('Enter');
await page.waitForURL((u) => !/\/login(\?|$)/.test(u.toString()), { timeout: 30_000 });
await page.goto(`${hub}${pagePath.startsWith('/') ? pagePath : `/${pagePath}`}`, { waitUntil: 'domcontentloaded' });
await page.locator('section[class*="hub-template-"]').first().waitFor({ state: 'visible', timeout: 30_000 });
await page.waitForTimeout(3000);

const section = page.locator('section[class*="hub-template-"]').filter({ hasText: needle }).first();
if ((await section.count()) === 0) { console.error(`no section containing "${needle}"`); await browser.close(); process.exit(1); }

if (mode === 'shot') {
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await section.screenshot({ path: out ?? 'section.png' });
  console.log(`wrote ${out ?? 'section.png'}`);
} else {
  const result = await section.evaluate((sec, which) => {
    const r = (el) => { const q = el.getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: +q.width.toFixed(2), h: +q.height.toFixed(2) }; };
    const pick = (el, keys) => { const cs = getComputedStyle(el); return Object.fromEntries(keys.map((k) => [k, cs[k]])); };
    if (which === 'images') {
      return [...sec.querySelectorAll('img')].map((img) => {
        const chain = []; let el = img.parentElement;
        for (let i = 0; i < 4 && el; i++) { chain.push({ tag: el.tagName, cls: el.className.toString().slice(0, 80), box: r(el), ...pick(el, ['backgroundColor', 'borderRadius', 'overflow', 'padding']) }); el = el.parentElement; }
        return { src: (img.getAttribute('src') ?? '').slice(-70), natural: [img.naturalWidth, img.naturalHeight], box: r(img), ...pick(img, ['objectFit', 'width', 'height']), chain };
      });
    }
    const inner = sec.querySelector('[style*="padding"]') ?? sec;
    const leaves = [...sec.querySelectorAll('h1,h2,h3,h4,p,a,button,img,[data-node-id]')].slice(0, 40).map((el) => ({
      tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 40), box: r(el),
      ...pick(el, ['fontSize', 'fontWeight', 'lineHeight', 'color', 'textAlign', 'padding', 'margin', 'borderRadius', 'backgroundColor', 'justifyContent', 'alignItems', 'gap']),
    }));
    return { section: { box: r(sec), padding: getComputedStyle(inner).padding, innerStyle: (inner.getAttribute('style') ?? '').slice(0, 200) }, leaves };
  }, mode);
  console.log(JSON.stringify(result, null, 1));
}
await browser.close();
