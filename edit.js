/* Редактор фото: кисть размытия, заливка, пипетка, отмена и сохранение в браузере. */
(() => {
  'use strict';
  const CFG = window.CATALOG_CONFIG || {};
  const T = (window.CAT || { tiles: [] }).tiles;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = msg => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); };

  const cv = $('#edCv'), stage = $('#edStage'), empty = $('#edEmpty');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const blurCv = document.createElement('canvas');
  const blurCtx = blurCv.getContext('2d');
  const MAX = 2000;
  let tool = 'blur', diam = 48, str = 0.6, color = '#c9b79c';
  let art = '', photoId = '', srcURL = '', loaded = false, dirty = false;
  let undos = [], redos = [], painting = false, blurReady = false;
  const MAX_HIST = 20;

  const byArt = Object.fromEntries(T.map(t => [t.art, t]));
  const photosOf = t => {
    const out = [];
    if (t.face) out.push({ id: 'face', label: 'Фактура', src: t.face[t.face.length - 1][1] + '.jpg', thumb: t.face[0][1] + '.jpg' });
    if (t.card) out.push({ id: 'card', label: 'Интерьер', src: t.card[t.card.length - 1][1] + '.jpg', thumb: t.card[0][1] + '.jpg' });
    (t.photos || []).forEach((ph, i) => out.push({ id: 'img:' + ph, label: 'Фото ' + (i + 1), src: `img/${t.art}/${ph}.jpg`, thumb: `img/${t.art}/${ph}_t.jpg` }));
    return out;
  };

  function setBtns() {
    const on = loaded;
    ['edSave', 'edJpg', 'edPng', 'edReset', 'edUndo', 'edRedo'].forEach(id => {
      const b = $('#' + id); if (!b) return;
      if (id === 'edUndo') b.disabled = !undos.length;
      else if (id === 'edRedo') b.disabled = !redos.length;
      else b.disabled = !on;
    });
  }
  function note(s) { const n = $('#edNote'); if (n) n.textContent = s || ''; }

  function pushUndo() {
    try {
      undos.push(ctx.getImageData(0, 0, cv.width, cv.height));
      if (undos.length > MAX_HIST) undos.shift();
    } catch (e) { /* слишком большое изображение */ }
    redos = [];
    dirty = true; blurReady = false; setBtns();
  }
  function restore(data) { ctx.putImageData(data, 0, 0); blurReady = false; dirty = true; setBtns(); }

  function fitStage() {
    const box = stage.getBoundingClientRect();
    const r = Math.min(1, (box.width - 2) / cv.width, Math.max(240, box.height - 2) / cv.height);
    cv.style.width = Math.round(cv.width * r) + 'px';
    cv.style.height = Math.round(cv.height * r) + 'px';
  }
  function pos(e) {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * cv.width / r.width, y: (p.clientY - r.top) * cv.height / r.height };
  }
  function ensureBlur() {
    if (blurReady) return;
    blurCv.width = cv.width; blurCv.height = cv.height;
    const px = 4 + Math.round(str * 28);
    blurCtx.clearRect(0, 0, blurCv.width, blurCv.height);
    blurCtx.filter = `blur(${px}px)`;
    blurCtx.drawImage(cv, 0, 0);
    blurCtx.filter = 'none';
    blurReady = true;
  }
  function dab(x, y) {
    const r = diam / 2;
    if (tool === 'blur') {
      ensureBlur();
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = Math.max(0.15, str);
      ctx.drawImage(blurCv, 0, 0);
      ctx.restore();
    } else if (tool === 'fill') {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function pick(x, y) {
    const p = ctx.getImageData(Math.max(0, Math.min(cv.width - 1, Math.round(x))), Math.max(0, Math.min(cv.height - 1, Math.round(y))), 1, 1).data;
    const hex = '#' + [p[0], p[1], p[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    color = hex; $('#edColor').value = hex; $('#edColorHex').textContent = hex;
    tool = 'fill'; syncTool(); toast('Цвет ' + hex);
  }

  async function loadImage(url, id, fromFile) {
    const img = new Image();
    if (!fromFile) img.crossOrigin = 'anonymous';
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('Не удалось открыть изображение')); img.src = url; });
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.max(1, Math.round(img.naturalWidth * k));
    cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    loaded = true; dirty = false; undos = []; redos = []; blurReady = false;
    empty.hidden = true; cv.style.display = 'block';
    fitStage(); setBtns();
    note((art ? art + ' · ' : '') + (id || 'файл') + ' · ' + cv.width + '×' + cv.height);
  }

  async function openPhoto(t, ph) {
    art = t.art; photoId = ph.id; srcURL = ph.src;
    $$('#edThumbs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === ph.id));
    let rec = null;
    try { rec = await window.CatalogPhotos.get(art, photoId); } catch (e) {}
    if (rec && rec.blob) {
      const u = window.CatalogPhotos.url(window.CatalogPhotos.key(art, photoId), rec.blob);
      await loadImage(u, ph.label + ' (сохранённая правка)', true);
      dirty = false;
      note(art + ' · ' + ph.label + ' · правка из браузера, оригинал не изменён');
    } else {
      await loadImage(ph.src, ph.label);
    }
  }

  function drawList(q) {
    const qq = (q || '').trim().toLowerCase();
    $('#edList').innerHTML = T.filter(t => !qq || (t.name + ' ' + t.art).toLowerCase().includes(qq)).map(t =>
      `<button type="button" class="ed-item${t.art === art ? ' on' : ''}" data-art="${t.art}" role="option" aria-selected="${t.art === art}">
        ${t.icon ? `<img src="${t.icon}" alt="" width="44" height="44">` : '<span class="ed-ph"></span>'}
        <span><b>${esc(t.name)}</b><small>${t.art} · ${t.format}</small></span>
      </button>`).join('');
  }
  function drawThumbs(t) {
    const list = photosOf(t);
    $('#edThumbs').innerHTML = list.length
      ? list.map(p => `<button type="button" data-id="${esc(p.id)}" aria-pressed="${p.id === photoId}"><img src="${p.thumb}" alt=""><span>${esc(p.label)}</span></button>`).join('')
      : '<p class="ed-note">У этой модели пока нет фото в каталоге — откройте файл с компьютера.</p>';
  }

  function syncTool() {
    $$('#edTool button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    $('#edStrWrap').hidden = tool !== 'blur';
    $('#edColorWrap').hidden = tool === 'blur';
    stage.classList.toggle('drop', tool === 'drop');
  }

  $('#edTool').addEventListener('click', e => {
    const b = e.target.closest('[data-tool]'); if (!b) return; tool = b.dataset.tool; syncTool();
  });
  $('#edDiam').addEventListener('input', e => { diam = +e.target.value; $('#edDiamV').textContent = diam; });
  $('#edStr').addEventListener('input', e => { str = +e.target.value / 100; $('#edStrV').textContent = e.target.value + '%'; blurReady = false; });
  $('#edColor').addEventListener('input', e => { color = e.target.value; $('#edColorHex').textContent = color; });

  function down(e) {
    if (!loaded) return;
    e.preventDefault();
    const p = pos(e);
    if (tool === 'drop') { pick(p.x, p.y); return; }
    pushUndo(); painting = true; dab(p.x, p.y);
  }
  function move(e) {
    if (!painting) return;
    e.preventDefault();
    const p = pos(e); dab(p.x, p.y);
  }
  function up() { painting = false; }
  cv.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  cv.addEventListener('touchstart', down, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', up);

  $('#edUndo').onclick = () => { if (!undos.length) return; redos.push(ctx.getImageData(0, 0, cv.width, cv.height)); restore(undos.pop()); };
  $('#edRedo').onclick = () => { if (!redos.length) return; undos.push(ctx.getImageData(0, 0, cv.width, cv.height)); restore(redos.pop()); };
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? $('#edRedo').click() : $('#edUndo').click(); }
  });

  function exportBlob(type, quality) {
    return new Promise(ok => cv.toBlob(b => ok(b), type, quality));
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const fileBase = () => (art || 'photo') + '-' + (photoId || 'edit').replace(/[^\w.-]+/g, '_');
  $('#edJpg').onclick = async () => { const b = await exportBlob('image/jpeg', 0.92); download(b, fileBase() + '.jpg'); toast('JPEG скачан'); };
  $('#edPng').onclick = async () => { const b = await exportBlob('image/png'); download(b, fileBase() + '.png'); toast('PNG скачан'); };
  $('#edSave').onclick = async () => {
    if (!art || !photoId) { toast('Сначала выберите фото модели — тогда правка привяжется к нему'); return; }
    const b = await exportBlob('image/jpeg', 0.92);
    await window.CatalogPhotos.put(art, photoId, b, 'image/jpeg', fileBase() + '.jpg');
    dirty = false;
    toast('Сохранено в этом браузере. Оригинал на диске не изменён.');
    note(art + ' · ' + photoId + ' · правка в браузере, оригинал не изменён');
  };
  $('#edReset').onclick = async () => {
    if (!srcURL) return;
    if (dirty && !confirm('Сбросить правки на этом фото?')) return;
    if (art && photoId) try { await window.CatalogPhotos.remove(art, photoId); } catch (e) {}
    await loadImage(srcURL, photoId);
    toast('Показан оригинал');
  };
  $('#edFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const u = URL.createObjectURL(f);
    art = art || ''; photoId = photoId || ('local:' + f.name);
    srcURL = u;
    await loadImage(u, f.name, true);
    toast('Файл открыт локально');
  };

  $('#edList').addEventListener('click', async e => {
    const b = e.target.closest('[data-art]'); if (!b) return;
    const t = byArt[b.dataset.art]; if (!t) return;
    art = t.art; photoId = ''; srcURL = '';
    drawList($('#edQ').value); drawThumbs(t);
    const list = photosOf(t);
    if (list[0]) await openPhoto(t, list[0]);
    else { loaded = false; empty.hidden = false; empty.textContent = 'У этой модели нет фото — откройте файл с компьютера.'; cv.style.display = 'none'; setBtns(); }
  });
  $('#edThumbs').addEventListener('click', async e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const t = byArt[art]; if (!t) return;
    const ph = photosOf(t).find(p => p.id === b.dataset.id); if (ph) await openPhoto(t, ph);
  });
  $('#edQ').addEventListener('input', e => drawList(e.target.value));
  addEventListener('resize', fitStage);

  const qp = new URLSearchParams(location.search);
  drawList('');
  const start = byArt[qp.get('a')] || T[0];
  if (start) {
    art = start.art; drawList(''); drawThumbs(start);
    const list = photosOf(start);
    if (list[0]) openPhoto(start, list[0]).catch(err => toast(err.message));
  }
  syncTool(); setBtns();
})();
