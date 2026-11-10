import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [w, h, u, out] = [+process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
const m = w < 600;
const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: m ? 2 : 1, isMobile: m, hasTouch: m });
const p = await c.newPage(); const errs = [];
p.on('console', x => { if (x.type() === 'error') errs.push(x.text()); }); p.on('pageerror', e => errs.push('PE ' + e.message));
await p.goto('http://localhost:8780/' + u, { waitUntil: 'networkidle' });
// прокрутка до конца, чтобы сработали reveal/lazy
const H = await p.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < H; y += h * .7) { await p.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(250); }
await p.waitForTimeout(2500); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500);
await p.screenshot({ path: out, fullPage: true });
console.log(errs.join('\n') || 'no errors'); await b.close();
