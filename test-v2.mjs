// v2 checks: console errors on key pages, theme screenshots
import { chromium } from 'playwright-core';
import fs from 'fs';
import http from 'http';
import { createReadStream, statSync, existsSync } from 'fs';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SHOT = '/workspace/catalog-clone-shots';
fs.mkdirSync(SHOT, { recursive: true });
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const fp = normalize(join(ROOT, p));
  if (!fp.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
  if (!existsSync(fp) || statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8788, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8788/';

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const errs = [];
async function open(w, h, mob, theme) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: !!mob, hasTouch: !!mob });
  await c.addInitScript(t => { try { localStorage.setItem('catalog-theme', t); } catch (e) {} }, theme);
  const p = await c.newPage();
  const tag = `${theme}-${mob ? 'm' : 'd'}`;
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
  p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(tag + ' ' + r.status() + ' ' + r.url()); });
  return { c, p, tag };
}
const shot = (p, n) => p.screenshot({ path: `${SHOT}/${n}.png`, fullPage: false });

async function checkPages(theme) {
  const { c, p, tag } = await open(1440, 900, false, theme);
  for (const page of ['index.html', 'tile.html?a=VHP612038', 'prices.html', 'edit.html', 'admin.html']) {
    await p.goto(BASE + page, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(800);
    const title = await p.title();
    const t = await p.getAttribute('html', 'data-theme');
    if (t !== theme) errs.push(`${tag} ${page} data-theme=${t} expected ${theme}`);
    if (await p.locator('#themeBtn').count() === 0) errs.push(`${tag} ${page} missing #themeBtn`);
    if (page.startsWith('index') || page.startsWith('tile') || page.startsWith('prices') || page.startsWith('edit') || page.startsWith('admin')) {
      // showroom leftover
      const body = await p.evaluate(() => document.body.innerText);
      for (const bad of ['Приехать в шоу-рум', 'довоз из Твери', 'склада: Москва', 'Шоу-рум']) {
        if (body.includes(bad)) errs.push(`${tag} ${page} leftover: ${bad}`);
      }
    }
    console.log('ok', theme, page, '|', title, '| theme', t);
  }
  await c.close();
}

for (const theme of ['light', 'dark']) {
  await checkPages(theme);
  // screenshots index + tile, 1440 and 390
  for (const [w, h, mob, suffix] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
    const { c, p } = await open(w, h, mob, theme);
    await p.goto(BASE + 'index.html#catalog', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(1800);
    // scroll to grid
    await p.evaluate(() => { const el = document.querySelector('#grid'); if (el) scrollTo(0, el.getBoundingClientRect().top + scrollY - 90); });
    await p.waitForTimeout(1200);
    await shot(p, `v2-${theme}-index-cards-${suffix}`);
    // hero
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(600);
    await shot(p, `v2-${theme}-index-hero-${suffix}`);
    await p.goto(BASE + 'tile.html?a=VHP612038', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(1400);
    await shot(p, `v2-${theme}-tile-${suffix}`);
    await c.close();
  }
}

// also generic v2 card shots (light default) aliases
fs.copyFileSync(`${SHOT}/v2-light-index-cards-1440.png`, `${SHOT}/v2-index-cards-1440.png`);
fs.copyFileSync(`${SHOT}/v2-light-index-cards-390.png`, `${SHOT}/v2-index-cards-390.png`);

await browser.close();
server.close();
if (errs.length) {
  console.log('ERRORS', errs.length);
  errs.forEach(e => console.log(' -', e));
  process.exitCode = 1;
} else {
  console.log('ALL OK, no console errors');
}
