import { chromium } from 'playwright-core';
import fs from 'fs';
const OUT = '/workspace/catalog-clone-shots';
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8780/';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await c.newPage();
p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', e => errs.push(e.message));
p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });

await p.goto(B + 'index.html?shot', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);
await p.screenshot({ path: OUT + '/01-home.png' });

await p.evaluate(() => document.querySelector('#catalog').scrollIntoView());
await p.waitForTimeout(800);
await p.screenshot({ path: OUT + '/01b-catalog-prices.png' });

await p.goto(B + 'tile.html?a=VHP612038', { waitUntil: 'networkidle' });
await p.waitForTimeout(1400);
await p.screenshot({ path: OUT + '/02-tile.png' });

await p.goto(B + 'prices.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.fill('tr[data-art="VHP612038"] .in-cash', '1650');
await p.fill('tr[data-art="VHF612802"] .in-cash', '1490');
await p.click('tr[data-art="VHF612802"] .switch');
await p.fill('tr[data-art="VHF612802"] .in-non', '1700');
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/03-prices.png' });

await p.goto(B + 'edit.html?a=VHP612038', { waitUntil: 'networkidle' });
await p.waitForTimeout(1400);
await p.screenshot({ path: OUT + '/04-photo-editor-catalog.png' });

// no-brand check on home
await p.goto(B + 'index.html', { waitUntil: 'networkidle' });
const text = await p.evaluate(() => document.body.innerText);
const bad = new RegExp('алма'+'л|alma'+'l|alma'+'li', 'i').test(text);
const logo = await p.locator('.logo .w').innerText();
console.log({ logo, bad, title: await p.title(), errs });
await c.close(); await b.close();
