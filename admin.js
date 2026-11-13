/* Вход администратора и публикация правок в репозиторий через GitHub API.
   Токен хранится только в localStorage этого браузера: его нельзя логировать и нельзя коммитить. */
(() => {
  'use strict';
  const CFG = window.CATALOG_CONFIG || {};
  const REPO = CFG.REPO || 'Unus777/tile-catalog-demo';
  const BRANCH = CFG.BRANCH || 'main';
  const TOKEN_KEY = CFG.TOKEN_KEY || 'catalog_admin_token';
  const PRICES_FILE = CFG.PRICES_FILE || 'prices.json';
  const OVERRIDES_FILE = CFG.OVERRIDES_FILE || 'photo-overrides.json';
  const OVERRIDES_DIR = CFG.OVERRIDES_DIR || 'overrides';
  const HINTS = {
    401: 'токен недействителен или отозван — вставьте новый',
    403: 'у токена нет права записи (Contents: Read and write)',
    404: 'токен не видит репозиторий — дайте ему доступ только к ' + REPO
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

  const published = {};
  const overrides = {};
  let overridesStamp = Date.now();

  async function fetchJson(file) {
    try {
      const r = await fetch(file + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return {};
      const j = await r.json();
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch (e) { return {}; }
  }

  function takePublished(src) {
    Object.keys(published).forEach(k => { delete published[k]; });
    Object.entries(src || {}).forEach(([art, p]) => {
      if (!p || typeof p !== 'object' || !(+p.cash > 0)) return;
      published[art] = { cash: +p.cash, noncash: +p.noncash > 0 ? +p.noncash : 0 };
    });
  }
  function takeOverrides(src) {
    Object.keys(overrides).forEach(k => { delete overrides[k]; });
    Object.entries(src || {}).forEach(([k, path]) => {
      if (k && typeof path === 'string' && path) overrides[k] = path;
    });
    overridesStamp = Date.now();
  }

  const ready = Promise.all([fetchJson(PRICES_FILE), fetchJson(OVERRIDES_FILE)])
    .then(([pr, ov]) => { takePublished(pr); takeOverrides(ov); })
    .catch(() => {});

  const isAuthed = () => !!token;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* GitHub отвечает 403 не только на нехватку прав, но и на «вторичный» лимит частоты
     (много крупных фото подряд). Такие ответы ждём и повторяем, а настоящий отказ в правах
     показываем с текстом самого GitHub. */
  const isRateLimit = (r, d) => r.status === 429 ||
    (r.status === 403 && (r.headers.get('retry-after') || r.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit|abuse/i.test((d && d.message) || '')));
  async function gh(path, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch('https://api.github.com/repos/' + REPO + path + sep + 't=' + Date.now(), {
        ...opts,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opts.headers || {})
        }
      });
      const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
      if (r.ok) return d;
      if (isRateLimit(r, d) && attempt < 6) {
        const ra = +r.headers.get('retry-after');
        const reset = +r.headers.get('x-ratelimit-reset');
        let wait = ra > 0 ? ra * 1000 : (reset ? reset * 1000 - Date.now() : 0);
        wait = Math.min(Math.max(wait, 5000 * (attempt + 1)), 65000);
        setStatus('saving', 'GitHub просит паузу, продолжу через ' + Math.ceil(wait / 1000) + ' с…');
        await sleep(wait);
        continue;
      }
      let msg = HINTS[r.status] || d.message || ('код ' + r.status);
      if (r.status === 403 && isRateLimit(r, d)) msg = 'GitHub временно ограничил частоту запросов, попробуйте ещё раз через пару минут';
      else if (r.status === 403 && d.message) msg += ' — ответ GitHub: ' + d.message;
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
  }

  function applyAdminUI(on) {
    const yes = !!on;
    if (document.body) document.body.classList.toggle('is-admin', yes);
    $$('.admin-only').forEach(el => { el.hidden = !yes; });
    $$('.admin-login-link').forEach(el => { el.textContent = yes ? 'Админ-панель' : 'Вход для админов'; });
  }

  async function login(raw) {
    const next = String(raw || '').trim();
    if (!next) throw new Error('Вставьте токен GitHub');
    const prev = token;
    token = next;
    try {
      const repo = await gh('');
      if (repo.permissions && repo.permissions.push === false)
        throw new Error('у токена только чтение — нужен доступ Contents: Read and write');
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      applyAdminUI(true);
      return repo;
    } catch (e) {
      token = prev;
      throw e;
    }
  }

  function logout() {
    token = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    applyAdminUI(false);
  }

  function setStatus(kind, msg) {
    $$('.pub-status').forEach(el => {
      el.hidden = !msg;
      el.className = 'pub-status' + (kind ? ' ' + kind : '');
      el.innerHTML = (kind === 'saving' ? '<span class="spin" aria-hidden="true"></span>' : '') +
        '<span>' + esc(msg || '') + '</span>';
    });
    if (kind === 'ok' || kind === 'err') {
      const t = $('#toast');
      if (t) {
        t.textContent = msg || '';
        t.classList.add('on');
        clearTimeout(setStatus._h);
        setStatus._h = setTimeout(() => t.classList.remove('on'), 4000);
      }
    }
  }

  async function readAt(ref, path) {
    const f = await gh('/contents/' + path + '?ref=' + encodeURIComponent(ref));
    return decodeURIComponent(escape(atob(String(f.content || '').replace(/\n/g, ''))));
  }

  /* Один коммит из набора файлов и правок текста.
     Правки текстовых файлов накладываются на свежую версию с GitHub (не на копию в браузере),
     при конфликте (ветку сдвинули) обновляем sha и повторяем. */
  async function commit(message, files = [], edits = []) {
    if (!token) throw new Error('Нужен вход администратора');
    setStatus('saving', 'Публикую на сайт…');
    let last;
    for (const wait of [0, 900, 2500, 5000]) {
      if (wait) await sleep(wait);
      try {
        const head = (await gh('/git/refs/heads/' + BRANCH)).object.sha;
        const baseTree = (await gh('/git/commits/' + head)).tree.sha;
        const tree = [];
        for (const e of edits) {
          let current = '';
          try { current = await readAt(head, e.path); }
          catch (err) { if (err.status !== 404) throw err; current = ''; }
          const text = e.apply(current);
          const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: text, encoding: 'utf-8' }) });
          tree.push({ path: e.path, mode: '100644', type: 'blob', sha: b.sha });
        }
        for (const [i, f] of files.entries()) {
          if (files.length > 1) setStatus('saving', 'Загружаю фото ' + (i + 1) + ' из ' + files.length + '…');
          if (i) await sleep(400);
          const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.content, encoding: f.encoding || 'utf-8' }) });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
        }
        const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
        const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [head] }) });
        await gh('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
        setStatus('ok', 'Сохранено. Опубликуется на сайте через 1–2 минуты');
        return c;
      } catch (e) {
        last = e;
        const race = [409, 422].includes(e.status) || /fast forward/i.test(e.message || '');
        if (!race || wait === 5000) {
          setStatus('err', 'Не сохранилось: ' + e.message);
          throw e;
        }
      }
    }
    setStatus('err', 'Не сохранилось: ' + (last && last.message || ''));
    throw last;
  }

  function parseMap(s) {
    try {
      const j = JSON.parse(s || '{}');
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch (e) { return {}; }
  }

  async function publishPrices(items) {
    await commit('Цены: обновление', [], [{
      path: PRICES_FILE,
      apply: s => {
        const out = parseMap(s);
        Object.entries(items || {}).forEach(([art, p]) => {
          if (p && +p.cash > 0) out[art] = { cash: +p.cash, noncash: +p.noncash > 0 ? +p.noncash : 0 };
          else delete out[art];
        });
        return JSON.stringify(out, null, 2) + '\n';
      }
    }]);
    Object.entries(items || {}).forEach(([art, p]) => {
      if (p && +p.cash > 0) published[art] = { cash: +p.cash, noncash: +p.noncash > 0 ? +p.noncash : 0 };
      else delete published[art];
    });
  }

  function fileNameFor(key) {
    return OVERRIDES_DIR + '/' + String(key).replace(/[^\w.-]+/g, '-') + '.jpg';
  }

  async function publishPhotos(list) {
    const files = (list || []).map(p => ({ path: fileNameFor(p.key), content: p.base64, encoding: 'base64' }));
    const map = {};
    (list || []).forEach(p => { map[p.key] = fileNameFor(p.key); });
    await commit('Фото: ' + Object.keys(map).join(', '), files, [{
      path: OVERRIDES_FILE,
      apply: s => JSON.stringify(Object.assign(parseMap(s), map), null, 2) + '\n'
    }]);
    Object.assign(overrides, map);
    overridesStamp = Date.now();
  }

  /* Медиа: порядок, скрытые фото, роли (обложка, текстура примерочной, пол) и новые файлы — одним коммитом.
     items: { АРТИКУЛ: запись манифеста | null (сбросить к исходным фото) }, files: [{ path, base64 }].
     Оригиналы в img/ и img2/ не трогаются: новые фото кладутся в overrides/media/, удаление — пометка hidden. */
  const MEDIA_FILE = CFG.MEDIA_FILE || 'media.json';
  const MEDIA_DIR = CFG.MEDIA_DIR || (OVERRIDES_DIR + '/media');
  const safePath = p => typeof p === 'string' && p.startsWith(MEDIA_DIR + '/') && !p.includes('..') && /\.(jpe?g)$/i.test(p);
  async function publishMedia(items, files) {
    const arts = Object.keys(items || {});
    if (!arts.length) throw new Error('Нет изменений для публикации');
    (files || []).forEach(f => { if (!safePath(f.path)) throw new Error('Недопустимый путь файла: ' + f.path); });
    const message = 'Медиа: ' + arts.slice(0, 6).join(', ') + (arts.length > 6 ? ' и ещё ' + (arts.length - 6) : '');
    await commit(message, (files || []).map(f => ({ path: f.path, content: f.base64, encoding: 'base64' })), [{
      path: MEDIA_FILE,
      apply: s => {
        let j = {};
        try { j = JSON.parse(s || '{}') || {}; } catch (e) { j = {}; }
        const out = { version: 1, updated: new Date().toISOString(), items: (j.items && typeof j.items === 'object' && !Array.isArray(j.items)) ? j.items : {} };
        arts.forEach(a => { if (items[a]) out.items[a] = items[a]; else delete out.items[a]; });
        return JSON.stringify(out, null, 1) + '\n';
      }
    }]);
  }

  /* ---------- страница входа ---------- */
  function gateError(text) {
    const box = $('#gate-error');
    if (!box) return;
    box.hidden = !text;
    const t = $('#gate-error-text');
    if (t) t.textContent = text || '';
  }

  function showPanel() {
    const gate = $('#gate'), panel = $('#adminPanel');
    if (gate) gate.hidden = true;
    if (panel) panel.hidden = false;
    applyAdminUI(true);
  }

  function showGateForm() {
    const gate = $('#gate'), panel = $('#adminPanel');
    if (gate) gate.hidden = false;
    if (panel) panel.hidden = true;
  }

  function pageAdmin() {
    const form = $('#login-form');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = $('#token');
      const btn = $('#loginBtn');
      const value = input ? input.value : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Проверяю…'; }
      gateError('');
      try {
        await login(value);
        if (input) input.value = '';
        showPanel();
      } catch (err) {
        gateError('Вход не выполнен: ' + err.message);
        if (input) { input.classList.add('err'); input.focus(); }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Войти'; }
      }
    });
    $('#pw-eye')?.addEventListener('click', () => {
      const i = $('#token'); if (!i) return;
      const show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      $('#pw-eye').setAttribute('aria-pressed', String(show));
      $('#pw-eye').setAttribute('aria-label', show ? 'Скрыть токен' : 'Показать токен');
    });
    $('#logoutBtn')?.addEventListener('click', () => {
      logout();
      showGateForm();
      gateError('');
    });
    if (isAuthed()) {
      login(token).then(showPanel).catch(err => {
        logout();
        showGateForm();
        gateError('Сохранённый токен больше не подходит: ' + err.message);
      });
    } else {
      showGateForm();
    }
  }

  function bootUI() {
    applyAdminUI(isAuthed());
    if (document.body && document.body.dataset.page === 'admin') pageAdmin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootUI);
  else bootUI();

  window.CatalogAdmin = {
    ready,
    published,
    overrides,
    get overridesStamp() { return overridesStamp; },
    isAuthed,
    login,
    logout,
    commit,
    publishPrices,
    publishPhotos,
    publishMedia,
    mediaDir: MEDIA_DIR,
    fileNameFor,
    applyAdminUI,
    setStatus,
    repo: REPO
  };
})();
