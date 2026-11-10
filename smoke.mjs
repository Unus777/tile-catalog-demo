import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [w, h, n] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: n === 'm' ? 2 : 1, isMobile: n === 'm', hasTouch: n === 'm' });
  const p = await c.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(n + ' ' + m.text()); }); p.on('pageerror', e => errs.push(n + ' PE ' + e.message));
  p.on('response', r => { if (r.status() >= 400) errs.push(n + ' ' + r.status() + ' ' + r.url()); });
  for (const u of process.argv.slice(2)) {
    await p.goto('http://localhost:8780/' + u, { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
    await p.screenshot({ path: `/tmp/sm-${n}-${u.replace(/[^a-z0-9]/gi, '_')}.png` });
  }
  await c.close();
}
console.log(errs.join('\n') || 'no errors'); await b.close();
