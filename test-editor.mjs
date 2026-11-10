import { chromium } from 'playwright-core';
import fs from 'fs';
const OUT = '/workspace/catalog-clone-shots';
fs.mkdirSync(OUT, { recursive: true });

// mock image: sharp checkerboard with a red square (to blur / paint)
let mockDataUrl;
try {
  const { createCanvas } = await import('canvas');
  const c = createCanvas(320, 240);
  const x = c.getContext('2d');
  for (let y = 0; y < 240; y += 20) for (let i = 0; i < 320; i += 20) {
    x.fillStyle = ((i / 20 + y / 20) % 2) ? '#e8e0d4' : '#3a342c';
    x.fillRect(i, y, 20, 20);
  }
  x.fillStyle = '#c43c3c'; x.fillRect(80, 50, 80, 80);
  mockDataUrl = c.toDataURL('image/png');
} catch (e) {
  // fallback: tiny PNG drawn in page later
  mockDataUrl = null;
}

const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1280, height: 860 } });
const p = await c.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url()); });

await p.goto('http://localhost:8780/edit.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

if (!mockDataUrl) {
  mockDataUrl = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d');
    for (let y = 0; y < 240; y += 20) for (let i = 0; i < 320; i += 20) {
      x.fillStyle = ((i / 20 + y / 20) % 2) ? '#e8e0d4' : '#3a342c';
      x.fillRect(i, y, 20, 20);
    }
    x.fillStyle = '#c43c3c'; x.fillRect(80, 50, 80, 80);
    return c.toDataURL('image/png');
  });
}

const before = await p.evaluate(async (url) => {
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
  const cv = document.getElementById('edCv');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  document.getElementById('edEmpty').hidden = true;
  cv.style.display = 'block';
  // expose loaded flag used by editor — trigger via file input instead is safer
  return ctx.getImageData(100, 80, 1, 1).data.join(',');
}, mockDataUrl);

// Load via file input so the editor's own loadImage runs
const tmp = '/tmp/mock-tile.png';
{
  const b64 = mockDataUrl.split(',')[1];
  fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
}
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
const [fileChooser] = await Promise.all([
  p.waitForEvent('filechooser'),
  p.click('label.btn:has-text("Открыть файл")')
]);
await fileChooser.setFiles(tmp);
await p.waitForTimeout(500);

const variance = async (x, y, s = 24) => p.evaluate(({ x, y, s }) => {
  const cv = document.getElementById('edCv'); const ctx = cv.getContext('2d');
  const d = ctx.getImageData(x, y, s, s).data;
  let n = 0, m = 0, q = 0;
  for (let i = 0; i < d.length; i += 4) { const v = d[i]; n++; m += v; q += v * v; }
  m /= n; return q / n - m * m;
}, { x, y, s });

const v0 = await variance(80, 50, 80);
// paint blur over the red square
await p.click('#edTool button[data-tool="blur"]');
await p.fill('#edDiam', '');
await p.$eval('#edDiam', el => { el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.$eval('#edStr', el => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const box = await p.locator('#edCv').boundingBox();
// canvas may be scaled
const cx = box.x + box.width * (120 / 320);
const cy = box.y + box.height * (90 / 240);
await p.mouse.move(cx, cy);
await p.mouse.down();
await p.mouse.move(cx + 20, cy + 10, { steps: 8 });
await p.mouse.up();
await p.waitForTimeout(200);
const v1 = await variance(80, 50, 80);
await p.screenshot({ path: OUT + '/04-photo-editor.png' });

await p.click('#edUndo');
await p.waitForTimeout(100);
const v2 = await variance(80, 50, 80);

// fill a corner
await p.click('#edTool button[data-tool="fill"]');
await p.$eval('#edColor', el => { el.value = '#1f8a4d'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await p.$eval('#edDiam', el => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const fx = box.x + box.width * (30 / 320);
const fy = box.y + box.height * (30 / 240);
await p.mouse.click(fx, fy);
const fillPx = await p.evaluate(() => {
  const d = document.getElementById('edCv').getContext('2d').getImageData(30, 30, 1, 1).data;
  return [d[0], d[1], d[2]];
});

// export
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#edJpg')]);
const dlPath = await dl.path();
const dlSize = fs.statSync(dlPath).size;

// save requires art+photoId; after file open photoId is local:name. Save should toast to pick a model OR save with local id.
// Select first model first, then we already have a file. The editor sets photoId to local:filename if no model photo.
// Click first model and first thumb, then... skip if save disabled without model. After opening file, photoId is 'local:mock-tile.png' and art may be first model's if list selected on start.
const saveDisabled = await p.$eval('#edSave', el => el.disabled);
let saved = false;
if (!saveDisabled) {
  await p.click('#edSave');
  await p.waitForTimeout(400);
  saved = await p.evaluate(() => new Promise(ok => {
    const r = indexedDB.open((window.CATALOG_CONFIG && CATALOG_CONFIG.PHOTO_DB) || 'catalog_photo_edits', 1);
    r.onsuccess = () => {
      const tx = r.result.transaction('photos', 'readonly');
      const q = tx.objectStore('photos').getAllKeys();
      q.onsuccess = () => ok(q.result.length > 0);
      q.onerror = () => ok(false);
    };
    r.onerror = () => ok(false);
  }));
}

console.log(JSON.stringify({ v0, v1, v2, fillPx, dlSize, saveDisabled, saved, errs }, null, 2));
if (!(v1 < v0 * 0.85 || v1 < v0 - 100)) console.log('WARN blur variance did not drop as expected', v0, v1);
if (Math.abs(v2 - v0) > 50) console.log('WARN undo did not restore', v0, v2);
if (dlSize < 100) console.log('WARN jpeg too small');
await c.close(); await b.close();
