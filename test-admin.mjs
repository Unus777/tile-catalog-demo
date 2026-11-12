// Проверка входа администратора и публичных цен. GitHub API мокается, в репозиторий ничего не пишется.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}/`;
const FAKE = 'github_pat_TEST_NOT_REAL_123';
const ART = 'VHP612038';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  let rel = decodeURIComponent(u.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
await new Promise(ok => server.listen(PORT, ok));

const errs = [];
const fail = (msg) => { errs.push(msg); console.error('FAIL:', msg); };
const ok = (cond, msg) => { if (cond) console.log('OK:', msg); else fail(msg); };

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

function attachErrors(page, tag) {
  page.on('console', m => {
    const text = m.text();
    if (m.type() === 'error' && !/favicon|409 \(Conflict\)/.test(text)) errs.push(tag + ' console: ' + text);
  });
  page.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
  page.on('response', r => {
    if (r.status() >= 400 && !/favicon/.test(r.url()) && r.status() !== 409) errs.push(tag + ' ' + r.status() + ' ' + r.url());
  });
}

function ghState() {
  return {
    head: 'aaa111',
    tree: 'tree000',
    blobs: 0,
    commits: [],
    patched: 0,
    failFirstPatch: false,
    files: { 'prices.json': '{}\n', 'photo-overrides.json': '{}\n' },
    lastBlobTexts: []
  };
}

async function installGhMock(page, gh) {
  await page.route('https://api.github.com/**', async route => {
    const req = route.request();
    const method = req.method();
    const pathOnly = decodeURIComponent(req.url().replace(/^https:\/\/api\.github\.com/, '').replace(/\?.*$/, ''));
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    try {
      if (method === 'GET' && pathOnly === '/repos/Unus777/tile-catalog-demo') {
        return json(200, { name: 'tile-catalog-demo', permissions: { push: true, pull: true } });
      }
      if (method === 'GET' && /\/git\/refs\/heads\/main$/.test(pathOnly)) {
        return json(200, { object: { sha: gh.head } });
      }
      if (method === 'GET' && /\/git\/commits\//.test(pathOnly)) {
        return json(200, { sha: gh.head, tree: { sha: gh.tree } });
      }
      if (method === 'GET' && /\/contents\//.test(pathOnly)) {
        const file = pathOnly.split('/contents/')[1];
        const text = gh.files[file] || '{}';
        return json(200, { content: Buffer.from(text).toString('base64'), encoding: 'base64', sha: 'sha-' + file });
      }
      if (method === 'POST' && /\/git\/blobs$/.test(pathOnly)) {
        gh.blobs++;
        const body = JSON.parse(req.postData() || '{}');
        if (body.encoding === 'utf-8' && typeof body.content === 'string') gh.lastBlobTexts.push(body.content);
        return json(201, { sha: 'blob' + gh.blobs });
      }
      if (method === 'POST' && /\/git\/trees$/.test(pathOnly)) {
        return json(201, { sha: 'tree-new' });
      }
      if (method === 'POST' && /\/git\/commits$/.test(pathOnly)) {
        const body = JSON.parse(req.postData() || '{}');
        gh.commits.push(body.message);
        return json(201, { sha: 'ccc' + gh.commits.length });
      }
      if (method === 'PATCH' && /\/git\/refs\/heads\/main$/.test(pathOnly)) {
        gh.patched++;
        if (gh.failFirstPatch && gh.patched === 1) {
          return json(409, { message: 'Update is not a fast forward' });
        }
        const body = JSON.parse(req.postData() || '{}');
        gh.head = body.sha;
        return json(200, { object: { sha: gh.head } });
      }
      return json(404, { message: 'not mocked' });
    } catch (e) {
      return json(500, { message: 'mock error' });
    }
  });
}

async function seedPrices(page, data) {
  await page.route('**/prices.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(data)
  }));
  await page.route('**/photo-overrides.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}'
  }));
}

// ---------- 1. Публичный просмотр читает prices.json, без токена правок нет ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attachErrors(page, 'public');
  await seedPrices(page, { [ART]: { cash: 1650, noncash: 1848 } });
  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const card = page.locator(`.card[data-art="${ART}"]`);
  ok(await card.count() === 1, 'карточка ' + ART + ' на главной');
  const texts = await card.locator('.prices .p b').allTextContents();
  ok(texts.some(s => /1\s?650/.test(s)), 'публичная цена 1650 с prices.json: ' + JSON.stringify(texts));
  const hasEx = await card.locator('.ex').count();
  ok(hasEx === 0, 'у товара с ценой из prices.json нет пометки «пример»');
  ok(await page.locator('.admin-acts:visible').count() === 0, 'без входа кнопки «Изменить цену/фото» скрыты');
  ok(await page.locator('a.admin-login-link').isVisible(), 'в подвале есть ссылка «Вход для админов»');
  ok(await page.locator('footer a[href="prices.html"]').isHidden(), 'ссылка «Цены» в подвале скрыта без входа');
  ok(await page.locator('footer a[href="edit.html"]').isHidden(), 'ссылка «Редактор фото» скрыта без входа');

  await page.goto(BASE + 'tile.html?a=' + ART, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const big = await page.locator('#bigprice .p.on b').textContent();
  ok(/1\s?650/.test(big || ''), 'страница модели читает prices.json: ' + big);
  ok(await page.locator('#bigprice .ex').count() === 0, 'на странице модели нет «пример» при опубликованной цене');
  ok(await page.locator('a[href^="edit.html"]:visible').count() === 0, 'без входа ссылки «Изменить фото» нет');
  ok(await page.locator('[data-admin]:visible').count() === 0, 'без входа админ-кнопок на модели нет');

  await page.goto(BASE + 'prices.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(await page.locator('#adminGate').isVisible(), 'prices.html без токена показывает вход');
  ok(await page.locator('main.adm').isHidden(), 'редактор цен скрыт без входа');
  ok(await page.locator('#pubPrices').isHidden(), 'кнопка публикации цен недоступна без входа');

  await page.goto(BASE + 'edit.html?a=' + ART, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(await page.locator('#adminGate').isVisible(), 'edit.html без токена показывает вход');
  ok(await page.locator('main.ed').isHidden(), 'редактор фото скрыт без входа');

  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok(await page.locator('#gate').isVisible(), 'admin.html показывает форму входа');
  ok(await page.locator('#token').count() === 1, 'поле токена есть');
  const help = await page.locator('.token-help').textContent();
  ok(/Contents:\s*Read and write/i.test(help) && /tile-catalog-demo/.test(help), 'на странице есть инструкция по токену');
  ok(/токен GitHub/i.test(await page.locator('.note.warn').innerText()), 'есть честное предупреждение про защиту токеном');
  ok(await page.locator('#adminPanel').isHidden(), 'панель скрыта до входа');
  await ctx.close();
}

// ---------- 2. Вход с моком GitHub и публикация пачки цен (включая конфликт) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attachErrors(page, 'admin');
  const gh = ghState();
  gh.failFirstPatch = true;
  await installGhMock(page, gh);
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.fill('#token', FAKE);
  await page.click('#loginBtn');
  await page.waitForSelector('#adminPanel', { state: 'visible', timeout: 10000 });
  ok(await page.locator('#adminPanel').isVisible(), 'после проверки токена открывается админ-панель');
  ok(await page.locator('#logoutBtn').isVisible(), 'есть кнопка «Выйти»');

  await page.goto(BASE + 'prices.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  ok(await page.locator('#adminGate').count() === 0, 'после входа prices.html без затвора');
  ok(await page.locator(`tr[data-art="${ART}"]`).isVisible(), 'таблица цен доступна после входа');
  await page.fill(`tr[data-art="${ART}"] .in-cash`, '1710');
  await page.click('#pubPrices');
  await page.waitForFunction(() => {
    const el = document.querySelector('.pub-status.ok');
    return el && /1–2 минут/.test(el.textContent || '');
  }, null, { timeout: 15000 });
  ok(gh.commits.length === 2, 'при конфликте коммит повторяется (commits=' + gh.commits.length + ')');
  ok(gh.patched >= 2, 'повтор после 409: patched=' + gh.patched);
  const published = gh.lastBlobTexts.map(s => { try { return JSON.parse(s); } catch { return {}; } });
  ok(published.some(j => j[ART] && j[ART].cash === 1710), 'в коммите есть цена 1710 для ' + ART);
  ok(await page.evaluate(() => /1–2 минут/.test(document.querySelector('.pub-status.ok')?.textContent || '')), 'статус «опубликуется через 1–2 минуты»');

  await page.goto(BASE + 'index.html#catalog', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  ok(await page.locator('.admin-acts:visible').count() > 0, 'после входа на карточках видны кнопки правки');
  ok(await page.locator(`a[href="edit.html?a=${ART}"], [data-admin="photo"][data-art="${ART}"]`).first().isVisible()
    || await page.locator(`.card[data-art="${ART}"] [data-admin="photo"]`).isVisible(),
    'на карточке есть «Изменить фото»');
  await page.locator(`.card[data-art="${ART}"] [data-admin="price"]`).click();
  ok(await page.locator('#priceModal').isVisible(), 'кнопка «Изменить цену» открывает окно');
  await page.click('#pmCancel');

  await page.goto(BASE + 'edit.html?a=' + ART, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  ok(await page.locator('#mdPublish').isVisible(), 'после входа доступен менеджер медиа с кнопкой «Опубликовать на сайт»');
  await page.click('#edTabs [data-tab=brush]');
  ok(await page.locator('#edPublish').isVisible(), 'вкладка «Кисть»: доступна кнопка «Сохранить на сайт» в редакторе фото');

  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.click('#logoutBtn');
  await page.waitForSelector('#gate', { state: 'visible' });
  const still = await page.evaluate(() => localStorage.getItem('catalog_admin_token'));
  ok(!still, '«Выйти» стирает токен из localStorage');
  await ctx.close();
}

await browser.close();
server.close();
if (errs.length) {
  console.error('\nERRORS:\n' + errs.join('\n'));
  process.exit(1);
}
console.log('\nALL TESTS PASSED');
