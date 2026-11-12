/* Менеджер медиа в админке: загрузка, замена, удаление (скрытие), порядок, обложка,
   текстура примерочной, пол и комната по умолчанию. Всё — черновик в этом браузере,
   пока не нажата «Опубликовать на сайт» (один коммит через GitHub API, admin.js → publishMedia). */
(() => {
  'use strict';
  if (!window.CatalogAdmin || !CatalogAdmin.isAuthed()) return;
  const M = window.CatalogMedia, UI = window.CatalogUI;
  if (!M || !$q('#mdGrid')) return;
  function $q(s, r = document) { return r.querySelector(s); }
  const $ = $q, $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const T = (window.CAT || { tiles: [] }).tiles, byArt = M.byArt;
  const DIR = CatalogAdmin.mediaDir || 'overrides/media';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 3200); };
  const MAX_SIDE = 2000, THUMB_SIDE = 720, MAX_BYTES = 30 * 1024 * 1024;
  const SCENE_RU = { living: 'гостиная', bath: 'ванная', kitchen: 'кухня' };

  let art = '';
  const dirty = new Set(), resets = new Set(), pending = {}, floorUI = {};
  let room = null, busy = false;

  const clone = o => JSON.parse(JSON.stringify(o));
  const cur = () => byArt[art];
  const plural = (n, a, b, c) => { const k = n % 10, h = n % 100; return k === 1 && h !== 11 ? a : k >= 2 && k <= 4 && (h < 12 || h > 14) ? b : c; };
  const rid = () => Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6);

  /* ---------- черновик модели ---------- */
  function baseEntry(t) {
    const L = M.list(t, null);
    return { order: L.visible.map(x => x.id), hidden: [], files: {}, room: null, floor: null, scene: '' };
  }
  function work(a) {
    let e = M.drafts[a];
    if (!e) {
      const p = M.published[a];
      e = p ? clone(p) : baseEntry(byArt[a]);
      e.order = Array.isArray(e.order) ? e.order : []; e.hidden = Array.isArray(e.hidden) ? e.hidden : []; e.files = e.files && typeof e.files === 'object' ? e.files : {};
      M.drafts[a] = e;
    }
    return e;
  }
  function change(fn, msg) {
    const t = cur(); if (!t) return;
    const e = work(art);
    fn(e, t);
    const L = M.list(t, e);
    e.order = L.visible.map(x => x.id);
    e.hidden = [...new Set(e.hidden.filter(id => L.all.has(id)))];
    resets.delete(art); dirty.add(art);
    M.setDraft(art, e);
    t.icon = M.icon(t);
    render(); preview();
    if (msg) toast(msg);
  }

  /* ---------- картинки ---------- */
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => no(new Error('Не удалось открыть изображение')); i.src = src; });
  function toCanvas(src, sx, sy, sw, sh, max) {
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (c, q) => new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Не удалось сохранить JPEG')), 'image/jpeg', q));
  const b64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(blob); });
  function checkFile(f) {
    if (!f) return 'Файл не выбран';
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return 'Нужен JPEG, PNG или WebP';
    if (f.size > MAX_BYTES) return 'Файл больше 30 МБ';
    return '';
  }
  /* сохранить картинку (img или canvas) как новый файл модели; вернуть id «u:…» */
  async function addFile(a, srcEl, sx, sy, sw, sh, meta) {
    const full = toCanvas(srcEl, sx, sy, sw, sh, MAX_SIDE), th = toCanvas(srcEl, sx, sy, sw, sh, THUMB_SIDE);
    const [fb, tb] = await Promise.all([toBlob(full, .9), toBlob(th, .84)]);
    const uid = 'u:' + rid();
    (pending[a] = pending[a] || {})[uid] = { blob: fb, tblob: tb };
    const e = work(a);
    e.files[uid] = { src: URL.createObjectURL(fb), thumb: URL.createObjectURL(tb), w: full.width, h: full.height, kind: meta.kind || 'interior', role: meta.role || 'gallery', name: String(meta.name || '').slice(0, 80), draft: true };
    return uid;
  }
  async function ingest(file, meta) {
    const err = checkFile(file); if (err) { toast(err); return null; }
    const u = URL.createObjectURL(file);
    try { const img = await loadImg(u); return await addFile(art, img, 0, 0, img.naturalWidth, img.naturalHeight, { ...meta, name: file.name }); }
    finally { URL.revokeObjectURL(u); }
  }

  /* ---------- галерея ---------- */
  function roles(t, x) {
    const out = [];
    const tex = M.texOf(t), fl = M.floorOf(t);
    if (tex && tex.id === x.id) out.push('<span class="md-b room">Примерочная</span>');
    if (fl && fl.id === x.id) out.push('<span class="md-b floor">Пол</span>');
    if (x.draft) out.push('<span class="md-b new">Не опубликовано</span>');
    return out.join('');
  }
  const menu = (items) => `<div class="md-menu" role="menu" hidden>${items.map(([a, l, cls]) => `<button type="button" role="menuitem" data-act="${a}"${cls ? ` class="${cls}"` : ''}>${l}</button>`).join('')}</div>`;
  function itemHTML(t, x, i, n, hidden) {
    const acts = hidden
      ? [['restore', 'Вернуть в галерею'], ['room', 'Для примерочной'], ['floor', 'Как шаблон пола'], ['brush', 'Править кистью'], ['open', 'Открыть оригинал']].concat(x.draft ? [['drop', 'Удалить навсегда', 'danger']] : [])
      : [['cover', 'Сделать обложкой'], ['replace', 'Заменить фото…'], ['room', 'Для примерочной'], ['floor', 'Как шаблон пола'], ['brush', 'Править кистью'], ['open', 'Открыть оригинал'], ['hide', 'Удалить с сайта', 'danger']];
    return `<li class="md-item${hidden ? ' is-hidden' : ''}${x.kind === 'product' ? ' product' : ''}" data-id="${esc(x.id)}">
      <div class="md-ph"><img src="${esc(x.thumb)}" alt="${esc(x.label)}" loading="lazy" decoding="async">
        ${hidden ? '' : `<span class="md-num">${i === 0 ? 'Обложка' : i + 1}</span>`}<span class="md-badges">${roles(t, x)}</span></div>
      <div class="md-it-bar">
        ${hidden ? '' : '<button type="button" class="md-grip" aria-label="Перетащить" title="Перетащить">⠿</button>'}
        <span class="md-lbl" title="${esc(x.label)}">${esc(x.label)}</span>
        ${hidden ? '<button type="button" class="md-ic md-restore" data-act="restore">Вернуть</button>'
          : `<button type="button" class="md-ic" data-act="up" aria-label="Выше" title="Выше"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="md-ic" data-act="down" aria-label="Ниже" title="Ниже"${i === n - 1 ? ' disabled' : ''}>↓</button>`}
        <button type="button" class="md-ic" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Действия" title="Действия">⋯</button>
      </div>${menu(acts)}</li>`;
  }
  function render() {
    const t = cur(); if (!t) return;
    const L = M.list(t);
    $('#mdTitle').innerHTML = `<b>${esc(t.name)}</b><small>${esc(t.art)} · ${esc(t.format)} · ${esc(t.surface)}</small>`;
    $('#mdGrid').innerHTML = L.visible.map((x, i) => itemHTML(t, x, i, L.visible.length, false)).join('') +
      `<li class="md-add-tile"><label><span>+</span><b>Добавить фото</b><small>JPEG, PNG, WebP</small><input type="file" class="md-add-in" accept="image/jpeg,image/png,image/webp" multiple hidden></label></li>`;
    $('#mdHidden').innerHTML = L.hidden.length ? L.hidden.map((x, i) => itemHTML(t, x, i, 0, true)).join('') : '<li class="md-empty">Скрытых фото нет</li>';
    renderRoom(t);
    renderBar();
    markList();
    if (window.CatalogEditor) CatalogEditor.refresh();
  }
  function renderBar() {
    const n = dirty.size, bar = $('#mdBar');
    bar.dataset.state = n ? 'dirty' : 'clean';
    const names = [...dirty].map(a => byArt[a] ? byArt[a].name : a);
    $('#mdBarTxt').innerHTML = n ? `<b>Не опубликовано: ${n} ${plural(n, 'модель', 'модели', 'моделей')}</b><small>${esc(names.slice(0, 4).join(', '))}${n > 4 ? ' и др.' : ''} — видно только вам</small>` : '<b>Изменений нет</b><small>Сайт показывает опубликованную версию</small>';
    $('#mdPublish').disabled = !n || busy;
    $('#mdUndoArt').disabled = !dirty.has(art) || busy;
  }
  function markList() {
    $$('#edList .ed-item').forEach(b => {
      b.classList.toggle('md-dirty', dirty.has(b.dataset.art));
      const t = byArt[b.dataset.art], im = b.querySelector('img');
      if (t && im && t.icon && im.getAttribute('src') !== t.icon) im.src = t.icon;
    });
  }

  /* ---------- примерочная ---------- */
  function fmtAR(f) { const [a, b] = String(f || '').split('×').map(Number); return a && b ? Math.max(a, b) / Math.min(a, b) : 1; }
  function renderRoom(t) {
    const e = M.entry(t.art) || {};
    const tex = M.texOf(t), frame = $('#mdTexFrame'), img = $('#mdTexImg'), info = $('#mdTexInfo');
    const ar = fmtAR(t.format);
    if (tex) {
      frame.classList.remove('none');
      if (img.getAttribute('src') !== tex.src) img.src = tex.src;
      const upd = () => {
        const w = img.naturalWidth, h = img.naturalHeight; if (!w) return;
        const portrait = h > w;
        frame.style.aspectRatio = ar === 1 ? '1 / 1' : portrait ? `1 / ${ar}` : `${ar} / 1`;
        const iar = Math.max(w, h) / Math.min(w, h), err = Math.abs(iar - ar) / ar;
        info.className = 'md-tex-info ' + (err <= .04 ? 'ok' : 'warn');
        info.innerHTML = (err <= .04 ? '✓ Плитка целиком, пропорции совпадают с форматом ' : '⚠ Пропорции фото не совпадают с форматом ') + esc(t.format) +
          `<small>${w}×${h} px · ${tex.custom ? 'назначено вручную' : 'исходная текстура'}${err > .04 ? ' · в комнате края обрежутся — нажмите «Кадрировать»' : ''}${!tex.custom && !tex.full ? ' · в исходном кадре плитка не целиком' : ''}</small>`;
      };
      img.onload = upd; if (img.complete) upd();
    } else {
      frame.classList.add('none'); img.removeAttribute('src'); frame.style.aspectRatio = ar === 1 ? '1 / 1' : `1 / ${ar}`;
      info.className = 'md-tex-info warn'; info.innerHTML = 'У модели нет текстуры — в примерочной её не будет.<small>Загрузите чистое фото плитки целиком или выберите из фото.</small>';
    }
    $('#mdTexReset').disabled = !(e.room && e.room.id);
    $('#mdTexCrop').disabled = !tex;
    // пол
    const f = e.floor && e.floor.type ? e.floor : { type: 'same' };
    const ui = floorUI[t.art] || f.type;
    $$('#mdFloorType button').forEach(b => b.classList.toggle('on', b.dataset.v === ui));
    $$('.md-floor-pane').forEach(p => { p.hidden = p.dataset.pane !== ui; });
    const others = T.filter(x => x.art !== t.art && M.hasRoom(x)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    $('#mdFloorArt').innerHTML = '<option value="">— выберите плитку —</option>' + others.map(o => `<option value="${o.art}">${esc(o.name)} · ${o.format} · ${esc(o.surface)}</option>`).join('');
    $('#mdFloorArt').value = f.type === 'art' ? f.art : '';
    $('#mdFloorFmt').innerHTML = M.FORMATS.map(x => `<option>${x}</option>`).join('');
    const fl = M.floorOf(t);
    $('#mdFloorFmt').value = f.type === 'file' && f.format ? f.format : t.format;
    $('#mdFloorSurf').value = f.type === 'file' && f.surface ? f.surface : 'Матовая';
    const fimg = $('#mdFloorImg');
    if (fl && fl.type === 'file') { fimg.src = fl.src; fimg.hidden = false; $('#mdFloorEmpty').hidden = true; }
    else { fimg.removeAttribute('src'); fimg.hidden = true; $('#mdFloorEmpty').hidden = false; }
    $$('#mdScene button').forEach(b => b.classList.toggle('on', b.dataset.s === (e.scene || '')));
    $('#mdPreview').classList.toggle('empty', !tex);
  }
  function preview() {
    if (!UI || !UI.Room) return;
    if (!room) { room = UI.Room(() => cur()); return; }
    room.refresh();
  }

  /* ---------- кадрирование ---------- */
  const crop = { img: null, r: null, ar: 1, ori: 'auto', fmt: '', resolve: null, purpose: 'room' };
  function cropAR() {
    const a = fmtAR(crop.fmt), iw = crop.img.naturalWidth, ih = crop.img.naturalHeight;
    const portrait = crop.ori === 'p' || (crop.ori === 'auto' && ih > iw);
    return a === 1 ? 1 : portrait ? 1 / a : a;
  }
  function cropFit() {
    const iw = crop.img.naturalWidth, ih = crop.img.naturalHeight; crop.ar = cropAR();
    let w = iw, h = iw / crop.ar; if (h > ih) { h = ih; w = ih * crop.ar; }
    crop.r = { x: (iw - w) / 2, y: (ih - h) / 2, w, h }; cropDraw();
  }
  function cropDraw() {
    const im = $('#mdCropImg'), k = im.clientWidth / crop.img.naturalWidth, r = crop.r, el = $('#mdCropRect');
    el.style.left = r.x * k + 'px'; el.style.top = r.y * k + 'px'; el.style.width = r.w * k + 'px'; el.style.height = r.h * k + 'px';
    $('#mdCropSub').textContent = `Рамка ${Math.round(r.w)}×${Math.round(r.h)} px — пропорции ${crop.fmt}. Подвиньте рамку и потяните за угол, чтобы в неё попала вся плитка от края до края.`;
  }
  function openCrop(src, purpose, fmt) {
    return new Promise(async (resolve) => {
      let img;
      try { img = await loadImg(src); } catch (e) { toast(e.message); resolve(null); return; }
      Object.assign(crop, { img, purpose, fmt: fmt || cur().format, ori: 'auto', resolve });
      $('#mdCropTitle').textContent = purpose === 'floor' ? 'Шаблон пола' : 'Текстура для примерочной';
      const sel = $('#mdCropFmt');
      sel.innerHTML = M.FORMATS.concat(M.FORMATS.includes(crop.fmt) ? [] : [crop.fmt]).map(x => `<option>${x}</option>`).join('');
      sel.value = crop.fmt; sel.disabled = purpose !== 'floor';
      $$('#mdCropOri button').forEach(b => b.classList.toggle('on', b.dataset.o === 'auto'));
      const im = $('#mdCropImg'); im.src = img.src;
      $('#mdCrop').hidden = false; document.body.style.overflow = 'hidden';
      await new Promise(r => im.complete ? r() : (im.onload = r));
      requestAnimationFrame(cropFit);
    });
  }
  function closeCrop(val) { $('#mdCrop').hidden = true; document.body.style.overflow = ''; const r = crop.resolve; crop.resolve = null; if (r) r(val); }
  (function wireCrop() {
    const rectEl = $('#mdCropRect');
    let drag = null;
    rectEl.addEventListener('pointerdown', e => {
      e.preventDefault(); rectEl.setPointerCapture(e.pointerId);
      const h = e.target.closest('.h');
      drag = { x: e.clientX, y: e.clientY, r: { ...crop.r }, h: h ? [...h.classList].find(c => c.length === 2) : null, k: $('#mdCropImg').clientWidth / crop.img.naturalWidth };
    });
    rectEl.addEventListener('pointermove', e => {
      if (!drag) return;
      const iw = crop.img.naturalWidth, ih = crop.img.naturalHeight, dx = (e.clientX - drag.x) / drag.k, dy = (e.clientY - drag.y) / drag.k, r0 = drag.r;
      if (!drag.h) {
        crop.r = { ...r0, x: Math.max(0, Math.min(iw - r0.w, r0.x + dx)), y: Math.max(0, Math.min(ih - r0.h, r0.y + dy)) };
      } else {
        const right = drag.h[1] === 'e', bottom = drag.h[0] === 's';
        const ax = right ? r0.x : r0.x + r0.w, ay = bottom ? r0.y : r0.y + r0.h; // неподвижный угол
        let w = Math.max(40, r0.w + (right ? dx : -dx));
        const maxW = right ? iw - ax : ax, maxH = bottom ? ih - ay : ay;
        w = Math.min(w, maxW, maxH * crop.ar);
        const h = w / crop.ar;
        crop.r = { x: right ? ax : ax - w, y: bottom ? ay : ay - h, w, h };
      }
      cropDraw();
    });
    const end = () => { drag = null; };
    rectEl.addEventListener('pointerup', end); rectEl.addEventListener('pointercancel', end);
    $('#mdCropAll').onclick = cropFit;
    $('#mdCropFmt').onchange = e => { crop.fmt = e.target.value; cropFit(); };
    $('#mdCropOri').addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (!b) return; crop.ori = b.dataset.o; $$('#mdCropOri button').forEach(x => x.classList.toggle('on', x === b)); cropFit(); });
    $('#mdCropCancel').onclick = () => closeCrop(null);
    $('#mdCrop').addEventListener('click', e => { if (e.target.id === 'mdCrop') closeCrop(null); });
    $('#mdCropOk').onclick = () => closeCrop({ img: crop.img, r: { ...crop.r }, fmt: crop.fmt });
    addEventListener('resize', () => { if (!$('#mdCrop').hidden && crop.r) cropDraw(); });
  })();

  async function assignTexture(src, name) {
    const res = await openCrop(src, 'room'); if (!res) return;
    const uid = await addFile(art, res.img, res.r.x, res.r.y, res.r.w, res.r.h, { kind: 'product', role: 'room', name: name || 'texture' });
    change(e => { e.room = { id: uid, full: true }; }, 'Текстура примерочной обновлена — смотрите предпросмотр');
  }
  async function assignFloor(src, name) {
    const e0 = M.entry(art) || {};
    const res = await openCrop(src, 'floor', e0.floor && e0.floor.type === 'file' && e0.floor.format ? e0.floor.format : $('#mdFloorFmt').value || cur().format); if (!res) return;
    const uid = await addFile(art, res.img, res.r.x, res.r.y, res.r.w, res.r.h, { kind: 'product', role: 'floor', name: name || 'floor' });
    floorUI[art] = 'file';
    change(e => { e.floor = { type: 'file', id: uid, format: res.fmt, surface: $('#mdFloorSurf').value || 'Матовая' }; }, 'Пол обновлён — смотрите предпросмотр');
  }

  /* ---------- выбор из фото ---------- */
  function pick(title, sub) {
    return new Promise(resolve => {
      const t = cur(), L = M.list(t);
      $('#mdPickerTitle').textContent = title; $('#mdPickerSub').textContent = sub || '';
      $('#mdPickerGrid').innerHTML = L.visible.concat(L.hidden).map(x => `<button type="button" data-id="${esc(x.id)}"><img src="${esc(x.thumb)}" alt="" loading="lazy"><span>${esc(x.label)}</span></button>`).join('') || '<p class="ed-note">У модели нет фото — загрузите файл.</p>';
      const box = $('#mdPicker'); box.hidden = false;
      const done = v => { box.hidden = true; box.onclick = null; resolve(v); };
      box.onclick = e => { if (e.target === box || e.target.id === 'mdPickerClose') return done(null); const b = e.target.closest('[data-id]'); if (b) done(L.all.get(b.dataset.id)); };
    });
  }

  /* ---------- действия с фото ---------- */
  let replaceId = '';
  const replaceIn = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  document.body.append(replaceIn);
  replaceIn.onchange = async () => {
    const f = replaceIn.files && replaceIn.files[0]; replaceIn.value = ''; if (!f || !replaceId) return;
    const old = replaceId; replaceId = '';
    const x = M.find(cur(), old);
    const uid = await ingest(f, { kind: x && x.kind === 'product' ? 'product' : 'interior' }); if (!uid) return;
    change(e => {
      const i = e.order.indexOf(old);
      e.order = e.order.filter(id => id !== uid);
      if (i >= 0) e.order.splice(i, 1, uid); else e.order.push(uid);
      if (old.startsWith('u:') && e.files[old] && e.files[old].draft) { delete e.files[old]; delete (pending[art] || {})[old]; }
      else e.hidden.push(old);
    }, 'Фото заменено. Старое — в «Скрытых», его можно вернуть');
  };
  async function act(a, id) {
    const t = cur(); const x = M.find(t, id);
    closeMenus();
    if (a === 'up' || a === 'down') return change(e => { const i = e.order.indexOf(id), j = i + (a === 'up' ? -1 : 1); if (i < 0 || j < 0 || j >= e.order.length) return; [e.order[i], e.order[j]] = [e.order[j], e.order[i]]; });
    if (a === 'cover') return change(e => { e.order = [id].concat(e.order.filter(v => v !== id)); }, 'Обложка карточки обновлена');
    if (a === 'replace') { replaceId = id; replaceIn.click(); return; }
    if (a === 'hide') return change(e => {
      e.order = e.order.filter(v => v !== id);
      if (id.startsWith('u:') && e.files[id] && e.files[id].draft && !(e.room && e.room.id === id) && !(e.floor && e.floor.id === id)) { delete e.files[id]; delete (pending[art] || {})[id]; }
      else e.hidden.push(id);
    }, 'Фото убрано с сайта. Вернуть можно в разделе «Скрытые»');
    if (a === 'restore') return change(e => { e.hidden = e.hidden.filter(v => v !== id); e.order = e.order.filter(v => v !== id).concat(id); }, 'Фото снова в галерее');
    if (a === 'drop') return change(e => { delete e.files[id]; delete (pending[art] || {})[id]; e.hidden = e.hidden.filter(v => v !== id); if (e.room && e.room.id === id) e.room = null; if (e.floor && e.floor.id === id) e.floor = null; }, 'Фото удалено');
    if (a === 'room' && x) return assignTexture(x.src, x.label);
    if (a === 'floor' && x) return assignFloor(x.src, x.label);
    if (a === 'open' && x) return window.open(x.src, '_blank', 'noopener');
    if (a === 'brush' && x) { showTab('brush'); if (window.CatalogEditor) await CatalogEditor.open(art, x.ph); }
  }
  function closeMenus(except) { $$('.md-menu').forEach(m => { if (m !== except) { m.hidden = true; const b = m.parentNode.querySelector('[data-act="menu"]'); if (b) b.setAttribute('aria-expanded', 'false'); } }); }
  function onGridClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const li = b.closest('.md-item'); if (!li) return;
    if (b.dataset.act === 'menu') {
      const m = li.querySelector('.md-menu'), open = m.hidden;
      closeMenus(m); m.hidden = !open; b.setAttribute('aria-expanded', String(open));
      if (open) { const r = m.getBoundingClientRect(); m.classList.toggle('up', r.bottom > innerHeight - 8); const f = m.querySelector('button'); f && f.focus({ preventScroll: true }); }
      return;
    }
    act(b.dataset.act, li.dataset.id);
  }
  $('#mdGrid').addEventListener('click', onGridClick);
  $('#mdHidden').addEventListener('click', onGridClick);
  document.addEventListener('click', e => { if (!e.target.closest('.md-menu,[data-act="menu"]')) closeMenus(); });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#mdCrop').hidden) return closeCrop(null);
    if (!$('#mdPicker').hidden) { $('#mdPicker').hidden = true; return; }
    closeMenus();
  });

  // перетаскивание за любое место карточки (кроме кнопок). Порядок фиксируется при отпускании.
  // На телефоне вертикальный жест остаётся прокруткой: сортировка начинается после небольшого сдвига.
  (function wireDrag() {
    const grid = $('#mdGrid');
    let li = null, pid = null, moved = false, armed = false, sx = 0, sy = 0;
    const stop = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (li) li.classList.remove('dragging');
      grid.classList.remove('sorting');
      li = null; pid = null; armed = false;
    };
    const move = e => {
      if (!li || e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!armed) {
        if (Math.hypot(dx, dy) < 8) return;
        if (e.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx) * 1.15) { stop(); return; }
        armed = true;
        li.classList.add('dragging');
        grid.classList.add('sorting');
      }
      e.preventDefault();
      const over = $$('.md-item', grid).find(x => {
        if (x === li) return false;
        const q = x.getBoundingClientRect();
        return e.clientX >= q.left && e.clientX <= q.right && e.clientY >= q.top && e.clientY <= q.bottom;
      });
      if (!over) return;
      const r = over.getBoundingClientRect();
      const sameRow = e.clientY < r.bottom && e.clientY > r.top;
      const after = sameRow ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      const ref = after ? over.nextSibling : over;
      if (ref !== li && li.nextSibling !== ref) { grid.insertBefore(li, ref); moved = true; }
      else if (ref !== li) { grid.insertBefore(li, ref); moved = true; }
    };
    const end = e => {
      if (!li || (e && e.pointerId !== pid)) return;
      const did = moved && armed;
      const ids = $$('.md-item', grid).map(x => x.dataset.id);
      stop();
      if (did) change(en => { en.order = ids; }, 'Порядок фото изменён');
    };
    grid.addEventListener('pointerdown', e => {
      if (e.button) return;
      if (e.target.closest('.md-ic, .md-menu, .md-add-tile, input, label')) return;
      const item = e.target.closest('.md-item');
      if (!item || item.classList.contains('is-hidden') || !grid.contains(item)) return;
      li = item; pid = e.pointerId; moved = false; armed = false; sx = e.clientX; sy = e.clientY;
      addEventListener('pointermove', move, { passive: false });
      addEventListener('pointerup', end);
      addEventListener('pointercancel', end);
    });
    grid.addEventListener('dragstart', e => { if (e.target.closest('.md-item')) e.preventDefault(); });
    // файлы с компьютера прямо в галерею
    const card = grid.closest('.md-card');
    card.addEventListener('dragover', e => { if ([...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); card.classList.add('drop-on'); } });
    card.addEventListener('dragleave', e => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop-on'); });
    card.addEventListener('drop', e => { e.preventDefault(); card.classList.remove('drop-on'); addMany([...(e.dataTransfer.files || [])]); });
  })();

  async function addMany(files) {
    const ids = [];
    for (const f of files) { const id = await ingest(f, { kind: 'interior' }); if (id) ids.push(id); }
    if (ids.length) change(e => { e.order = e.order.concat(ids); }, ids.length === 1 ? 'Фото добавлено в конец галереи' : `Добавлено фото: ${ids.length}`);
  }
  const onAdd = e => { const fs = [...(e.target.files || [])]; e.target.value = ''; addMany(fs); };
  $('#mdAddFile').onchange = onAdd;
  $('#mdGrid').addEventListener('change', e => { if (e.target.classList.contains('md-add-in')) onAdd(e); });

  /* ---------- панель примерочной ---------- */
  $('#mdTexPick').onclick = async () => { const x = await pick('Фото для примерочной', 'Выберите кадр, где плитка видна целиком, затем подгоните рамку.'); if (x) assignTexture(x.src, x.label); };
  $('#mdTexFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; const err = checkFile(f); if (err) return toast(err);
    const u = URL.createObjectURL(f); await assignTexture(u, f.name); setTimeout(() => URL.revokeObjectURL(u), 4000);
  };
  $('#mdTexCrop').onclick = () => { const tex = M.texOf(cur()); if (tex) assignTexture(tex.src, 'texture'); };
  $('#mdTexReset').onclick = () => change(e => { e.room = null; }, 'Вернули исходную текстуру');
  $('#mdFloorType').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return; const v = b.dataset.v;
    floorUI[art] = v;
    if (v === 'same') return change(en => { en.floor = null; }, 'Пол — та же плитка');
    if (v === 'art') { const sel = $('#mdFloorArt'); renderRoom(cur()); if (sel.value) return; sel.focus(); return; }
    renderRoom(cur());
  });
  $('#mdFloorArt').onchange = e => { const v = e.target.value; if (!v) return; floorUI[art] = 'art'; change(en => { en.floor = { type: 'art', art: v }; }, 'Пол: ' + byArt[v].name); };
  $('#mdFloorFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; const err = checkFile(f); if (err) return toast(err);
    const u = URL.createObjectURL(f); await assignFloor(u, f.name); setTimeout(() => URL.revokeObjectURL(u), 4000);
  };
  $('#mdFloorPick').onclick = async () => { const x = await pick('Шаблон пола из фото', 'Выберите кадр и подгоните рамку под одну плитку пола.'); if (x) assignFloor(x.src, x.label); };
  const floorMeta = () => { const en = M.entry(art); if (!en || !en.floor || en.floor.type !== 'file') return; change(e2 => { e2.floor.format = $('#mdFloorFmt').value; e2.floor.surface = $('#mdFloorSurf').value; }); };
  $('#mdFloorFmt').onchange = floorMeta; $('#mdFloorSurf').onchange = floorMeta;
  $('#mdScene').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; change(en => { en.scene = b.dataset.s; }, b.dataset.s ? 'Комната по умолчанию: ' + SCENE_RU[b.dataset.s] : 'Комната по умолчанию — как обычно'); });

  /* ---------- публикация ---------- */
  $('#mdUndoArt').onclick = () => {
    if (!dirty.has(art)) return;
    if (!confirm('Отменить все неопубликованные правки этой модели?')) return;
    delete pending[art]; dirty.delete(art); resets.delete(art); delete floorUI[art];
    M.clearDraft(art); cur().icon = M.icon(cur()); render(); preview(); toast('Правки модели отменены');
  };
  $('#mdResetArt').onclick = () => {
    if (!confirm('Вернуть исходные фото модели? Загруженные фото останутся в репозитории, но перестанут показываться.')) return;
    delete pending[art]; delete floorUI[art];
    const e = baseEntry(cur()); M.drafts[art] = e; M.setDraft(art, e);
    dirty.add(art); resets.add(art); cur().icon = M.icon(cur()); render(); preview(); toast('Показаны исходные фото — опубликуйте, чтобы применить на сайте');
  };
  $('#mdPublish').onclick = async () => {
    if (!dirty.size || busy) return;
    busy = true; renderBar();
    try {
      const items = {}, files = [], local = {};
      for (const a of dirty) {
        if (resets.has(a)) { items[a] = null; continue; }
        const e = clone(M.drafts[a]);
        for (const [uid, f] of Object.entries(e.files || {})) {
          if (!f.draft) continue;
          const p = pending[a] && pending[a][uid];
          if (!p) { delete e.files[uid]; continue; }
          const name = uid.slice(2), path = `${DIR}/${a}/${name}.jpg`, tpath = `${DIR}/${a}/${name}_t.jpg`;
          files.push({ path, base64: await b64(p.blob) }, { path: tpath, base64: await b64(p.tblob) });
          local[path] = f.src; local[tpath] = f.thumb;
          e.files[uid] = { src: path, thumb: tpath, w: f.w, h: f.h, kind: f.kind, role: f.role, name: f.name };
        }
        items[a] = e;
      }
      await CatalogAdmin.publishMedia(items, files);
      Object.assign(M.alias, local);
      Object.entries(items).forEach(([a, e]) => { delete M.drafts[a]; delete pending[a]; M.setPublished(a, e); });
      const n = dirty.size; dirty.clear(); resets.clear();
      T.forEach(t => { t.icon = M.icon(t); });
      render(); preview();
      toast(`Опубликовано: ${n} ${plural(n, 'модель', 'модели', 'моделей')}. Посетители увидят через 1–2 минуты`);
    } catch (e) {
      toast('Не опубликовано: ' + e.message);
    } finally { busy = false; renderBar(); }
  };
  addEventListener('beforeunload', e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- вкладки и выбор модели ---------- */
  function showTab(name) {
    $$('#edTabs [data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('#tabMedia').hidden = name !== 'media'; $('#tabBrush').hidden = name !== 'brush';
    if (name === 'brush' && window.CatalogEditor) requestAnimationFrame(() => CatalogEditor.fit());
  }
  $('#edTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  $('#edList').addEventListener('click', e => { const b = e.target.closest('[data-art]'); if (!b || !byArt[b.dataset.art]) return; art = b.dataset.art; render(); preview(); });
  $('#edQ').addEventListener('input', () => setTimeout(markList, 0));

  const qp = new URLSearchParams(location.search);
  M.ready.then(() => {
    const start = byArt[qp.get('a')] || T[0]; if (!start) return;
    art = start.art; render(); preview();
    if (qp.get('tab') === 'brush') showTab('brush');
  });
  window.CatalogMediaAdmin = { get art() { return art; }, dirty, act, showTab, select(a) { if (byArt[a]) { art = a; render(); preview(); } } };
})();
