// Проверка прототипа в headless Chromium: 1440 и 390, ошибки консоли, CLS, QR-ссылки, скриншоты в shots/
import { chromium } from 'playwright-core';
import fs from 'fs';
fs.mkdirSync('/workspace/catalog-clone-shots', { recursive: true });
const B = 'http://localhost:8780/';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], log = (...a) => console.log(...a);
const CLS = `window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});`;
async function ctx(w, h, mob) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: !!mob, hasTouch: !!mob });
  await c.addInitScript(CLS);
  const p = await c.newPage(); const tag = mob ? 'm' : 'd';
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
  p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(tag + ' ' + r.status() + ' ' + r.url()); });
  return { c, p };
}
const shot = (p, n, o = {}) => p.screenshot({ path: `/workspace/catalog-clone-shots/${n}.png`, ...o });
const to = async (p, sel, off = 0) => { await p.evaluate(([s, o]) => scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - o), [sel, off]); };
const cls = p => p.evaluate(() => +window.__cls.toFixed(4));

// ---------- DESKTOP 1440 ----------
{ const { c, p } = await ctx(1440, 900);
  await p.goto(B + 'index.html?shot', { waitUntil: 'networkidle' }); await p.waitForTimeout(2600);
  await shot(p, '01-home-hero'); log('CLS home after hero:', await cls(p));
  await to(p, '#grid', 190); await p.waitForTimeout(1400); await shot(p, '02-catalog-cash');
  await p.click('.paytoggle button[data-mode="noncash"]'); await p.waitForTimeout(900); await shot(p, '03-catalog-noncash-toggle');
  await p.click('.paytoggle button[data-mode="cash"]'); await p.waitForTimeout(300);
  await p.click('#fmt .chip[data-v="60×60"]'); await p.click('#srf .chip[data-v="Глянец"]'); await p.click('#ton .chip[data-v="Белый"]'); await p.waitForTimeout(900);
  await to(p, '#catalog', 0); await p.waitForTimeout(500); await to(p, '#grid', 190); await p.waitForTimeout(700);
  const cb = await p.locator('.card:not(.hide)').nth(1).boundingBox(); await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 3); await p.waitForTimeout(1100);
  await shot(p, '04-filters'); log('filtered:', await p.textContent('#count'), 'url:', await p.evaluate(() => location.search));
  await p.click('#fmt .chip[data-v=""]'); await p.click('#srf .chip[data-v="Глянец"]'); await p.click('#ton .chip[data-v="Белый"]'); await p.waitForTimeout(500);
  await to(p, '#roomStage', 100); await p.waitForSelector('#roomGl.ready', { timeout: 90000 }); await p.waitForTimeout(2500); await shot(p, '06-home-room');
  await to(p, '#showroom', 90); await p.waitForTimeout(1400); await shot(p, '07-showroom');
  log('CLS home total:', await cls(p));
  // QR deep link
  await p.goto(B + 'tile.html?a=VHP600822&shot', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  await shot(p, '05-product-qr-deeplink'); log('CLS product:', await cls(p));
  await to(p, '#room', 90); await p.waitForSelector('#roomGl.ready', { timeout: 90000 }); await p.waitForTimeout(800);
  await p.click('#roomModes button[data-m="both"]'); await p.waitForTimeout(2600);
  const lb = await p.locator('#loupeBox').boundingBox(); await p.mouse.move(lb.x + lb.width * .55, lb.y + lb.height * .45); await p.waitForTimeout(700);
  await shot(p, '08-product-room-texture');
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400); await p.click('.slide[data-i="1"]', { force: true }).catch(() => p.click('.slide')); await p.waitForTimeout(900);
  await shot(p, '09-lightbox'); await p.keyboard.press('Escape');
  // admin
  await p.goto(B + 'prices.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  await p.fill('tr[data-art="VHP612038"] .in-cash', '1650'); await p.fill('tr[data-art="VHF612802"] .in-cash', '1490');
  await p.click('tr[data-art="VHF612802"] .switch'); await p.fill('tr[data-art="VHF612802"] .in-non', '1700');
  await p.fill('#ruleX', '15'); await p.click('#ruleApply'); await p.waitForTimeout(800);
  await shot(p, '10-admin-prices');
  const exp = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]); const ep = await exp[0].path(); const ej = JSON.parse(fs.readFileSync(ep, 'utf8')); log('export:', JSON.stringify(ej.tiles));
  await p.goto(B + 'index.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  log('card prices after admin:', await p.$$eval('.card[data-art="VHP612038"] .p b, .card[data-art="VHF612802"] .p b', e => e.map(x => x.textContent)));
  await p.goto(B + 'edit.html?a=VHP612038', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await shot(p, '19-photo-editor');
  await p.goto(B + 'print.html', { waitUntil: 'networkidle' }); await p.check('#wp'); await p.waitForTimeout(600); await shot(p, '11-print-qr');
  await p.goto(B + 'tile.html?a=NOPE', { waitUntil: 'networkidle' }); log('missing:', await p.textContent('h1'));
  // все QR-ссылки
  const arts = (await p.evaluate(() => window.CAT.tiles.map(t => [t.art, t.url])));
  let bad = 0; for (const [a, u] of arts) { if (!String(u).endsWith('tile.html?a=' + a)) bad++; }
  await p.goto(B + 'tile.html?a=' + arts[5][0], { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(300);
  log('QR urls in data:', arts.length, 'bad:', bad, '; sample page h1:', await p.textContent('h1'));
  await p.goto(B + 'index.html?f=60×120#catalog', { waitUntil: 'networkidle' }); await p.waitForTimeout(800); log('?f=60×120 →', await p.textContent('#count'));
  // reduced motion
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.goto(B + 'index.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
  log('reduced: reveal opacity', await p.evaluate(() => getComputedStyle(document.querySelector('.reveal')).opacity));
  await c.close(); }

// ---------- MOBILE 390 ----------
{ const { c, p } = await ctx(390, 844, true);
  await p.goto(B + 'index.html?shot', { waitUntil: 'networkidle' }); await p.waitForTimeout(2600);
  await shot(p, '12-mobile-home'); log('m CLS hero:', await cls(p));
  await to(p, '#grid', 150); await p.waitForTimeout(1500); await shot(p, '13-mobile-catalog');
  await p.click('#fbtn'); await p.waitForTimeout(800); await p.click('#sheet .chip[data-k="c"][data-v="Бежевый"]'); await p.waitForTimeout(500); await shot(p, '14-mobile-filters');
  await p.click('#sDone'); await p.waitForTimeout(900);
  log('m overflow:', await p.evaluate(() => document.documentElement.scrollWidth), 'CLS:', await cls(p));
  await p.goto(B + 'tile.html?a=VHF612802&shot', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  await shot(p, '15-mobile-product-qr'); log('m CLS product:', await cls(p));
  await p.evaluate(() => scrollBy(0, 700)); await p.waitForTimeout(800); await shot(p, '16-mobile-product-prices');
  await to(p, '#room', 70); await p.waitForSelector('#roomGl.ready', { timeout: 90000 }); await p.waitForTimeout(2500); await shot(p, '17-mobile-room');
  log('m overflow product:', await p.evaluate(() => document.documentElement.scrollWidth));
  await p.goto(B + 'prices.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(600); await shot(p, '18-mobile-admin');
  log('m overflow admin:', await p.evaluate(() => document.documentElement.scrollWidth));
  await c.close(); }
console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
await b.close();
