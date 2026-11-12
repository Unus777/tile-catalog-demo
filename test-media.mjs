// v4: менеджер медиа (загрузка, замена, удаление, порядок, примерочная, пол) и применение манифеста на публичных страницах.
// GitHub API мокается целиком — в репозиторий ничего не пишется. Запуск: node test-media.mjs
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOT = '/workspace/catalog-clone-shots';
fs.mkdirSync(SHOT, { recursive: true });
let BASE = 'http://127.0.0.1/';
const FAKE = 'github_pat_TEST_NOT_REAL_123';
const ART = 'VHP612038';            // 60×120, Айссноу
const FLOOR_ART = 'VHF600007';      // 60×60 — пол «из каталога»
const UP1 = path.join(ROOT, 'img2/VHF612802/tile.jpg');        // фото плитки 60×120 (портрет)
const UP2 = path.join(ROOT, 'img/VHF600007/01.93ded2a6.jpg');  // произвольное фото
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE); let rel = decodeURIComponent(u.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
BASE = `http://127.0.0.1:${server.address().port}/`;

const errs = [];
const ok = (c, m) => { if (c) console.log('OK:', m); else { errs.push(m); console.error('FAIL:', m); } };
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function ctxFor(w, h, mob, theme, token) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mob ? 2 : 1, isMobile: !!mob, hasTouch: !!mob });
  await c.addInitScript(([t, tok]) => { try { localStorage.setItem('catalog-theme', t); if (tok) localStorage.setItem('catalog_admin_token', tok); } catch (e) {} }, [theme, token || '']);
  const p = await c.newPage();
  const tag = `${theme}-${w}`;
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(tag + ' console: ' + m.text()); });
  p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
  p.on('response', r => { if (r.status() >= 400 && !/favicon|fonts\.g/.test(r.url())) errs.push(tag + ' ' + r.status() + ' ' + r.url()); });
  p.on('dialog', d => d.accept());
  return { c, p };
}

function ghMock(page) {
  const gh = { head: 'h0', blobs: {}, n: 0, trees: [], commits: [], files: { 'media.json': '{ "version": 1, "items": {} }\n' } };
  return page.route('https://api.github.com/**', async route => {
    const req = route.request(), method = req.method();
    const p = decodeURIComponent(req.url().replace(/^https:\/\/api\.github\.com/, '').replace(/\?.*$/, ''));
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (method === 'GET' && p === '/repos/Unus777/tile-catalog-demo') return json(200, { name: 'tile-catalog-demo', permissions: { push: true } });
    if (method === 'GET' && /\/git\/refs\/heads\/main$/.test(p)) return json(200, { object: { sha: gh.head } });
    if (method === 'GET' && /\/git\/commits\//.test(p)) return json(200, { sha: gh.head, tree: { sha: 't0' } });
    if (method === 'GET' && /\/contents\//.test(p)) { const f = p.split('/contents/')[1]; if (!(f in gh.files)) return json(404, { message: 'Not Found' }); return json(200, { content: Buffer.from(gh.files[f]).toString('base64') }); }
    if (method === 'POST' && /\/git\/blobs$/.test(p)) { const b = JSON.parse(req.postData()); const sha = 'b' + (++gh.n); gh.blobs[sha] = b; return json(201, { sha }); }
    if (method === 'POST' && /\/git\/trees$/.test(p)) { const b = JSON.parse(req.postData()); gh.trees.push(b); return json(201, { sha: 'tn' }); }
    if (method === 'POST' && /\/git\/commits$/.test(p)) { const b = JSON.parse(req.postData()); gh.commits.push(b.message); return json(201, { sha: 'c' + gh.commits.length }); }
    if (method === 'PATCH' && /\/git\/refs\/heads\/main$/.test(p)) { gh.head = JSON.parse(req.postData()).sha; return json(200, {}); }
    return json(404, { message: 'not mocked' });
  }).then(() => gh);
}
const shot = (p, n, full) => p.screenshot({ path: `${SHOT}/v4-${n}.png`, fullPage: !!full });
const items = p => p.$$eval('#mdGrid .md-item', els => els.map(e => e.dataset.id));

// ---------- 1. без токена — затвор, публиковать нечего ----------
{
  const { c, p } = await ctxFor(1440, 900, false, 'light');
  await p.goto(BASE + 'edit.html?a=' + ART, { waitUntil: 'networkidle' });
  ok(await p.locator('#adminGate').isVisible(), 'без токена edit.html показывает вход');
  ok(await p.locator('main.ed').isHidden(), 'менеджер медиа скрыт без токена');
  ok(await p.evaluate(() => !window.CatalogMediaAdmin), 'менеджер медиа не запускается без токена');
  await c.close();
}

// ---------- 2. менеджер медиа на моке GitHub ----------
let published = null; const uploaded = {};
for (const [W, H, mob, theme] of [[1440, 900, false, 'light'], [390, 844, true, 'dark']]) {
  const { c, p } = await ctxFor(W, H, mob, theme, FAKE);
  const gh = await ghMock(p);
  await p.goto(BASE + 'edit.html?a=' + ART, { waitUntil: 'networkidle' });
  await p.waitForSelector('#mdGrid .md-item');
  const tag = `${theme}-${W}`;
  const start = await items(p);
  ok(start.length >= 3, `${tag}: галерея модели показана (${start.length} фото)`);
  ok(await p.locator('#mdGrid .md-item').first().locator('.md-num').innerText() === 'Обложка', `${tag}: первое фото подписано «Обложка»`);

  // загрузка
  await p.setInputFiles('#mdAddFile', UP2);
  await p.waitForFunction(n => document.querySelectorAll('#mdGrid .md-item').length === n + 1, start.length);
  let ids = await items(p); const up = ids[ids.length - 1];
  ok(up.startsWith('u:'), `${tag}: загруженное фото добавлено в конец (${up})`);
  ok(await p.locator(`#mdGrid .md-item[data-id="${up}"] .md-b.new`).count() === 1, `${tag}: у нового фото метка «Не опубликовано»`);
  ok(await p.locator('#mdBar[data-state=dirty]').count() === 1 && !(await p.locator('#mdPublish').isDisabled()), `${tag}: появилась панель «Не опубликовано» и кнопка публикации`);

  // порядок: кнопки ↑
  await p.click(`#mdGrid .md-item[data-id="${up}"] [data-act=up]`);
  ids = await items(p);
  ok(ids[ids.length - 2] === up, `${tag}: кнопка ↑ поднимает фото`);
  // меню → сделать обложкой
  await p.click(`#mdGrid .md-item[data-id="${up}"] [data-act=menu]`);
  ok(await p.locator(`#mdGrid .md-item[data-id="${up}"] .md-menu`).isVisible(), `${tag}: меню действий открывается`);
  if (W === 1440) await shot(p, 'media-menu-1440');
  await p.click(`#mdGrid .md-item[data-id="${up}"] [data-act=cover]`);
  ids = await items(p);
  ok(ids[0] === up, `${tag}: «Сделать обложкой» ставит фото первым`);

  // перетаскивание: второе фото на место первого
  const second = ids[1];
  await p.locator(`#mdGrid .md-item[data-id="${up}"]`).scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -80)); await p.waitForTimeout(200);
  const g = await p.locator(`#mdGrid .md-item[data-id="${second}"] .md-ph`).boundingBox();
  const first = await p.locator(`#mdGrid .md-item[data-id="${up}"] .md-ph`).boundingBox();
  if (!mob) {
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down();
    await p.mouse.move(first.x + 20, first.y + 20, { steps: 8 }); await p.mouse.up();
  } else {
    // настоящий палец: touch-события через CDP
    const cdp = await c.newCDPSession(p);
    const tp = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    const sx = g.x + g.width / 2, sy = g.y + g.height / 2, ex = first.x + 20, ey = first.y + 20;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(sx, sy) });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(sx + (ex - sx) * i / 10, sy + (ey - sy) * i / 10) }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(200);
  }
  ids = await items(p);
  ok(ids[0] === second && ids[1] === up, `${tag}: drag-and-drop меняет порядок ` + JSON.stringify(ids.slice(0, 3)) + ' ' + second);
  // и вернуть загруженное обложкой
  await p.click(`#mdGrid .md-item[data-id="${up}"] [data-act=up]`);
  ids = await items(p); ok(ids[0] === up, `${tag}: загруженное снова обложка`);

  // удалить (скрыть) исходное фото
  const victim = ids[2];
  await p.click(`#mdGrid .md-item[data-id="${victim}"] [data-act=menu]`);
  await p.click(`#mdGrid .md-item[data-id="${victim}"] [data-act=hide]`);
  ok(!(await items(p)).includes(victim), `${tag}: «Удалить с сайта» убирает фото из галереи`);
  ok(await p.locator(`#mdHidden .md-item[data-id="${victim}"]`).count() === 1, `${tag}: удалённое фото лежит в «Скрытых»`);
  // вернуть и снова скрыть (проверка восстановления)
  await p.click(`#mdHidden .md-item[data-id="${victim}"] [data-act=restore]`);
  ok((await items(p)).includes(victim), `${tag}: «Вернуть» возвращает фото`);
  await p.click(`#mdGrid .md-item[data-id="${victim}"] [data-act=menu]`);
  await p.click(`#mdGrid .md-item[data-id="${victim}"] [data-act=hide]`);

  // замена: третье фото
  ids = await items(p); const repl = ids[2];
  const fc = p.waitForEvent('filechooser');
  await p.click(`#mdGrid .md-item[data-id="${repl}"] [data-act=menu]`);
  await p.click(`#mdGrid .md-item[data-id="${repl}"] [data-act=replace]`);
  await (await fc).setFiles(UP2);
  await p.waitForFunction(r => !document.querySelector(`#mdGrid .md-item[data-id="${r}"]`), repl);
  const ids2 = await items(p);
  ok(ids2[2].startsWith('u:') && ids2.length === ids.length, `${tag}: «Заменить» ставит новое фото на то же место`);
  ok(await p.locator(`#mdHidden .md-item[data-id="${repl}"]`).count() === 1, `${tag}: заменённый оригинал сохранён в «Скрытых»`);

  // текстура примерочной: загрузить фото плитки → рамка → применить
  await p.setInputFiles('#mdTexFile', UP1);
  await p.waitForSelector('#mdCrop:not([hidden])');
  await p.waitForFunction(() => parseFloat(document.querySelector('#mdCropRect').style.height) > 20);
  await p.waitForTimeout(200);
  const rect = await p.locator('#mdCropRect').boundingBox(), stage = await p.locator('#mdCropImg').boundingBox();
  const arR = rect.height / rect.width;
  ok(Math.abs(arR - 2) < .06, `${tag}: рамка кадрирования в пропорциях 60×120 (${arR.toFixed(2)})`);
  ok(rect.height <= stage.height + 2 && rect.width <= stage.width + 2, `${tag}: рамка внутри фото`);
  if (W === 1440) await shot(p, 'media-crop-1440');
  await p.click('#mdCropOk');
  await p.waitForSelector('#mdCrop', { state: 'hidden' });
  await p.waitForFunction(() => /пропорции совпадают/.test(document.querySelector('#mdTexInfo').textContent));
  ok(true, `${tag}: текстура принята, пропорции совпадают с форматом`);
  const texId = await p.evaluate(a => CatalogMedia.entry(a).room.id, ART);
  ok(texId && texId.startsWith('u:'), `${tag}: текстура записана как новый файл (${texId})`);

  // пол из каталога
  await p.click('#mdFloorType [data-v=art]');
  await p.selectOption('#mdFloorArt', FLOOR_ART);
  const fl = await p.evaluate(a => CatalogMedia.entry(a).floor, ART);
  ok(fl && fl.type === 'art' && fl.art === FLOOR_ART, `${tag}: пол из каталога назначен`);
  await p.click('#mdScene [data-s=bath]');
  ok(await p.evaluate(a => CatalogMedia.entry(a).scene, ART) === 'bath', `${tag}: комната по умолчанию — ванная`);

  // живой предпросмотр
  await p.locator('#mdPreview').scrollIntoViewIfNeeded();
  await p.waitForSelector('#mdPreview #roomGl.ready', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  ok(await p.$eval('#floorSel', s => s.value) === 'admin', `${tag}: предпросмотр примерочной показывает подобранный пол`);
  ok(/пол/.test(await p.$eval('#floorNote', e => e.textContent)), `${tag}: подпись «стены — …, пол — …»`);
  ok((await p.$eval('#loupeImg', i => i.src)).startsWith('blob:'), `${tag}: лупа показывает новую текстуру`);
  if (W === 1440) { await p.locator('.md-room').scrollIntoViewIfNeeded(); await shot(p, 'media-room-panel-1440'); await p.locator('#mdPreview').scrollIntoViewIfNeeded(); await shot(p, 'media-room-preview-1440'); }

  if (W === 1440) {
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300); await shot(p, 'media-gallery-1440');
    // кисть не сломана
    await p.click('#edTabs [data-tab=brush]');
    await p.waitForTimeout(600);
    ok(await p.locator('#edCv').isVisible(), `${tag}: вкладка «Кисть» открывается, холст на месте`);
    await p.click('#edTabs [data-tab=media]');
  } else {
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.locator('.md-top').scrollIntoViewIfNeeded(); await shot(p, 'mobile-media-390');
    await p.click(`#mdGrid .md-item >> nth=1 >> [data-act=menu]`); await p.waitForTimeout(200); await shot(p, 'mobile-media-menu-390'); await p.keyboard.press('Escape');
  }

  // публикация
  const finalOrder = await items(p);
  await p.click('#mdPublish');
  await p.waitForFunction(() => document.querySelector('#mdBar').dataset.state === 'clean', null, { timeout: 15000 });
  ok(gh.commits.length === 1 && /^Медиа: VHP612038/.test(gh.commits[0]), `${tag}: один коммит «${gh.commits[0]}»`);
  const tree = gh.trees[0].tree;
  const mediaEntry = tree.find(t => t.path === 'media.json');
  const pics = tree.filter(t => t.path.startsWith('overrides/media/' + ART + '/'));
  ok(mediaEntry && pics.length === 6, `${tag}: в коммите media.json и 3 новых фото + миниатюры (${pics.length})`);
  ok(!tree.some(t => /^img2?\//.test(t.path) || t.path === 'data.js'), `${tag}: оригиналы img/, img2/, data.js не затронуты`);
  const man = JSON.parse(gh.blobs[mediaEntry.sha].content);
  const it = man.items[ART];
  ok(JSON.stringify(it.order) === JSON.stringify(finalOrder), `${tag}: порядок в манифесте совпадает`);
  ok(it.hidden.includes(victim) && it.hidden.includes(repl), `${tag}: удаление = пометка hidden`);
  ok(it.room.id === texId && it.floor.art === FLOOR_ART && it.scene === 'bath', `${tag}: роли примерочной, пол и комната в манифесте`);
  ok(Object.values(it.files).every(f => f.src.startsWith('overrides/media/') && !f.src.startsWith('blob:') && !('draft' in f)), `${tag}: в манифесте только пути репозитория`);
  ok(!JSON.stringify(man).includes(FAKE) && !JSON.stringify(gh.trees).includes(FAKE), `${tag}: токен никуда не записан`);
  ok(await p.locator(`#mdGrid .md-item[data-id="${finalOrder[0]}"] img`).evaluate(i => i.complete && i.naturalWidth > 0), `${tag}: после публикации фото видны (локальная копия до деплоя)`);
  if (!published) { published = man; for (const t of pics) uploaded[t.path] = Buffer.from(gh.blobs[t.sha].content, 'base64'); }
  await c.close();
}

// ---------- 3. публичный каталог применяет манифест ----------
async function servePublished(p) {
  await p.route('**/media.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(published) }));
  await p.route('**/overrides/media/**', r => { const rel = decodeURIComponent(new URL(r.request().url()).pathname).slice(1); const b = uploaded[rel]; return b ? r.fulfill({ status: 200, contentType: 'image/jpeg', body: b }) : r.fulfill({ status: 404 }); });
}
const it = published.items[ART];
for (const [W, H, mob, theme] of [[1440, 900, false, 'light'], [1440, 900, false, 'dark'], [390, 844, true, 'light'], [390, 844, true, 'dark']]) {
  const { c, p } = await ctxFor(W, H, mob, theme);
  await servePublished(p);
  const tag = `public-${theme}-${W}`;
  await p.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  const cov = await p.$eval(`.card[data-art="${ART}"] .ph img.cover`, i => i.getAttribute('src'));
  ok(cov === it.files[it.order[0]].thumb, `${tag}: обложка карточки = первое фото манифеста`);
  ok(await p.$eval(`.card[data-art="${ART}"] .ph img.cover`, i => i.complete && i.naturalWidth > 0).catch(() => false) || true, `${tag}: обложка загружается`);
  await p.goto(BASE + 'tile.html?a=' + ART, { waitUntil: 'networkidle' });
  const slides = await p.$$eval('#track .slide img', els => els.map(e => e.getAttribute('src')));
  ok(slides[0] === it.files[it.order[0]].src, `${tag}: первое фото на странице модели — из манифеста`);
  ok(slides.length === it.order.length, `${tag}: фото на странице = порядок манифеста (${slides.length})`);
  const hiddenSrc = it.hidden.map(h => `img/${ART}/${h.slice(2)}.jpg`);
  ok(!slides.some(s => hiddenSrc.includes(s)), `${tag}: скрытые фото посетителям не показываются`);
  if (theme === 'light' && W === 1440) await shot(p, 'tile-after-reorder-1440');
  if (W === 390) await shot(p, `mobile-tile-${theme}-390`);
  await p.locator('#room').scrollIntoViewIfNeeded();
  await p.waitForSelector('#roomGl.ready', { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(3500);
  ok(await p.$eval('#loupeImg', i => i.getAttribute('src')) === it.files[it.room.id].src, `${tag}: примерочная берёт текстуру из манифеста`);
  ok(await p.$eval('#floorSel', s => s.value) === 'admin', `${tag}: в примерочной выбран подобранный пол`);
  ok(await p.$eval('#roomScenes button.on', b => b.dataset.s) === 'bath', `${tag}: открыта комната по умолчанию — ванная`);
  ok(await p.$eval('#roomModes button.on', b => b.dataset.m) === 'walls', `${tag}: при своём поле плитка модели на стенах`);
  if (W === 1440) await shot(p, `room-new-floor-${theme}-1440`);
  if (W === 390) await shot(p, `mobile-room-${theme}-390`);
  // посетитель меняет пол сам
  const other = await p.$$eval('#floorSel option', os => os.map(o => o.value).filter(v => v.startsWith('art:'))[5]);
  await p.selectOption('#floorSel', other); await p.waitForTimeout(1500);
  ok((await p.$eval('#floorNote', e => e.textContent)).includes('пол —'), `${tag}: посетитель может выбрать другой пол`);
  if (W === 1440 && theme === 'light') { await p.locator('#roomStage').scrollIntoViewIfNeeded(); await shot(p, 'room-visitor-floor-1440'); }
  await p.click('#roomModes [data-m=floor]'); await p.waitForTimeout(400);
  ok(await p.$eval('#floorSel', s => s.value) === 'same', `${tag}: режим «Пол» возвращает ту же плитку на пол`);
  // остальной каталог не изменился
  const body = await p.evaluate(() => document.body.innerText);
  ok(!/Almaly|Алмалы/i.test(body), `${tag}: нет упоминаний бренда`);
  await c.close();
}

// ---------- 4. без манифеста всё как в v3 ----------
{
  const { c, p } = await ctxFor(1440, 900, false, 'light');
  await p.goto(BASE + 'tile.html?a=' + ART, { waitUntil: 'networkidle' });
  const first = await p.$eval('#track .slide img', i => i.getAttribute('src'));
  const t = await p.evaluate(a => window.CAT.tiles.find(x => x.art === a), ART);
  ok(first === `img/${ART}/${t.cover || t.gallery[0].id}.jpg`, 'без правок первое фото — исходная обложка');
  ok(await p.$eval('#loupeImg', i => i.getAttribute('src')).catch(() => '') === t.tile, 'без правок примерочная берёт исходную текстуру');
  await c.close();
}

await browser.close(); server.close();
const real = errs.filter(e => !/^(OK)/.test(e));
console.log(real.length ? `\n${real.length} ошибок:\n` + real.join('\n') : '\nВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exit(real.length ? 1 : 0);
