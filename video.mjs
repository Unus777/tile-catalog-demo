// Демо-ролик: покадровая запись скриншотами (WebGL в headless без GPU не попадает в screencast), сборка ffmpeg → shots/demo.mp4
import { chromium } from 'playwright-core';
import fs from 'fs';
const B = 'http://localhost:8780/';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
await c.addInitScript(() => { try { localStorage.removeItem('catalog_prices'); localStorage.removeItem('catalog_mode'); } catch (e) {} });
const p = await c.newPage();
fs.rmSync('/tmp/cframes', { recursive: true, force: true }); fs.mkdirSync('/tmp/cframes');
let rec = false, fi = 0; const ft = [], marks = []; let t0;
const mark = n => marks.push([n, (Date.now() - t0) / 1000]);
const smooth = async (to, ms) => { await p.evaluate(([to, ms]) => new Promise(r => { const s = scrollY, t0 = performance.now(); const f = n => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, s + (to - s) * e); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }), [to, ms]); };
const top = s => p.evaluate(s => document.querySelector(s).getBoundingClientRect().top + scrollY, s);
const ck = s => p.$eval(s, e => e.click());
await p.goto(B + 'index.html?shot&low', { waitUntil: 'networkidle' });
t0 = Date.now(); rec = true; mark('hero');
const loop = (async () => { while (rec) { const t = (Date.now() - t0) / 1000; try { await p.screenshot({ path: `/tmp/cframes/${String(fi).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 }); ft.push(t); fi++; } catch (e) { await new Promise(r => setTimeout(r, 60)); } } })();
for (let i = 0; i < 14; i++) { await p.mouse.move(300 + i * 40, 300 + i * 10); await p.waitForTimeout(90); }
await p.waitForTimeout(1500);
await smooth(await top('#grid') - 190, 1500); await p.waitForTimeout(500); mark('catalog');
await ck('.paytoggle button[data-mode="noncash"]'); await p.waitForTimeout(1200);
await ck('.paytoggle button[data-mode="cash"]'); await p.waitForTimeout(700);
await ck('#fmt .chip[data-v="60×60"]'); await p.waitForTimeout(1100);
await ck('#ton .chip[data-v="Белый"]'); await p.waitForTimeout(1100);
const bb = await p.locator('.card:not(.hide)').nth(1).boundingBox();
for (let i = 0; i <= 10; i++) { await p.mouse.move(bb.x + bb.width * (.3 + i * .03), bb.y + bb.height * (.25 + i * .02)); await p.waitForTimeout(70); }
await p.waitForTimeout(900);
mark('product'); await p.goto(B + 'tile.html?a=VHP600822&shot&low', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
for (const i of [1, 3]) { await ck(`#thumbs button[data-i="${i}"]`); await p.waitForTimeout(1200); }
await ck('#thumbs button[data-i="0"]'); await p.waitForTimeout(800);
await ck('.paytoggle button[data-mode="noncash"]'); await p.waitForTimeout(1000);
await p.fill('#need', '42'); await p.waitForTimeout(1000);
await ck('.paytoggle button[data-mode="cash"]'); await p.waitForTimeout(600);
await smooth(await top('#room') - 80, 1400);
await p.waitForSelector('#roomGl.ready', { timeout: 90000 }); mark('room'); await p.waitForTimeout(1500);
await ck('#roomModes button[data-m="both"]'); await p.waitForTimeout(2200);
await ck('#patSeg button[data-p="half"]'); await p.waitForTimeout(1300);
await ck('#groutDots button:nth-child(4)'); await p.waitForTimeout(1300);
mark('admin'); await p.goto(B + 'prices.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.fill('tr[data-art="VHP612038"] .in-cash', '1650'); await p.waitForTimeout(700);
await p.fill('#ruleX', '15'); await ck('#ruleApply'); await p.waitForTimeout(1500);
mark('end'); rec = false; await loop;
fs.writeFileSync('/tmp/cframes/times.json', JSON.stringify({ ft, marks }));
console.log(JSON.stringify(marks), 'frames', fi);
await b.close();
