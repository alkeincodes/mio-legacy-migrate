import { chromium } from 'playwright';
const [slug, path] = [process.argv[2], process.argv[3] ?? 'login'];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(`https://hub.member.dev/${slug}/${path}`, { waitUntil: 'networkidle' });
const out = await p.evaluate(() => {
  const cs = (el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, color: c.color, bgImg: c.backgroundImage.slice(0, 60) }; };
  const main = document.querySelector('main');
  const h1 = document.querySelector('h1');
  const btn = document.querySelector('button[type=submit]') ?? document.querySelector('button');
  const panels = [...document.querySelectorAll('main > div, main > section, main > aside')].map((el) => ({ tag: el.tagName, cls: el.className.toString().slice(0, 80), ...cs(el), w: el.getBoundingClientRect().width }));
  const vars = ['--hub-primary', '--hub-secondary', '--hub-background', '--hub-text', '--primary', '--primary-foreground', '--secondary'].map((v) => [v, getComputedStyle(document.documentElement).getPropertyValue(v).trim()]);
  return { main: main && cs(main), h1: h1 && { text: h1.textContent, ...cs(h1) }, btn: btn && { text: btn.textContent?.trim(), ...cs(btn) }, panels, vars };
});
console.log(JSON.stringify(out, null, 1));
await p.screenshot({ path: `${process.env.SHOT_DIR}/${slug}-${path}.png` });
await b.close();
