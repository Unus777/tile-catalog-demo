/* Медиа моделей: порядок фото, скрытые фото, загруженные файлы, текстура и пол примерочной.
   Источник — data.js (оригиналы в img/ и img2/ не меняются) + манифест media.json (правки администратора).
   Черновики админки живут только в памяти этого браузера, пока их не опубликуют. */
(() => {
  'use strict';
  const CFG = window.CATALOG_CONFIG || {};
  const FILE = CFG.MEDIA_FILE || 'media.json';
  const T = (window.CAT || { tiles: [] }).tiles;
  const byArt = Object.fromEntries(T.map(t => [t.art, t]));
  let pub = {};
  const drafts = {};
  const alias = {}; // путь только что опубликованного файла → локальная копия, пока GitHub Pages не обновился
  const A = p => alias[p] || p;
  const subs = [];
  const SCENES = ['living', 'bath', 'kitchen'];
  const FORMATS = ['60×60', '60×120', '80×80', '120×120', '20×120', '30×60', '120×280'];

  const clean = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  const ready = fetch(FILE + '?v=' + Date.now(), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : {})
    .then(j => { const it = clean(j && j.items); pub = it || {}; })
    .catch(() => { pub = {}; });

  const big = set => set && set[set.length - 1][1];
  const small = set => set && set[0][1];

  /* Исходный набор фото модели из data.js */
  function baseItems(t) {
    const base = [], extra = [], seen = new Set();
    const gal = (t.gallery || []).slice();
    if (t.cover) { const i = gal.findIndex(g => g.id === t.cover); if (i > 0) gal.unshift(gal.splice(i, 1)[0]); }
    gal.forEach(g => {
      seen.add(g.id);
      base.push({ id: 'g:' + g.id, src: `img/${t.art}/${g.id}.jpg`, thumb: `img/${t.art}/${g.id}_t.jpg`, kind: g.kind || 'interior', clip: g.clip || null, ph: 'img:' + g.id, label: g.kind === 'product' ? 'Фото плитки' : 'Интерьер' });
    });
    if (!gal.length && t.card) base.push({ id: 'card', src: big(t.card) + '.jpg', thumb: small(t.card) + '.jpg', set: t.card, kind: 'interior', clip: null, ph: 'card', label: 'Интерьер' });
    else if (t.card) extra.push({ id: 'card', src: big(t.card) + '.jpg', thumb: small(t.card) + '.jpg', set: t.card, kind: 'interior', clip: null, ph: 'card', label: 'Интерьер (обложка)' });
    (t.photos || []).filter(p => !seen.has(p)).forEach(p => {
      const it = { id: 'g:' + p, src: `img/${t.art}/${p}.jpg`, thumb: `img/${t.art}/${p}_t.jpg`, kind: 'interior', clip: null, ph: 'img:' + p, label: 'Фото производителя' };
      (gal.length || t.card ? extra : base).push(it);
    });
    if (t.tile) extra.push({ id: 'tile', src: t.tile, thumb: t.tile, kind: 'product', clip: null, ph: 'tile', label: 'Текстура плитки' });
    return { base, extra };
  }

  const entry = art => drafts[art] || pub[art] || null;
  function uploads(t, e) {
    const files = clean(e && e.files) || {};
    return Object.entries(files).filter(([id, f]) => id.startsWith('u:') && f && typeof f.src === 'string')
      .map(([id, f]) => ({ id, src: A(f.src), thumb: A(f.thumb || f.src), kind: f.kind === 'product' ? 'product' : 'interior', clip: null, ph: 'up:' + id.slice(2), w: +f.w || 0, h: +f.h || 0, upload: true, draft: !!f.draft, label: f.role === 'room' ? 'Текстура (загружена)' : f.role === 'floor' ? 'Пол (загружен)' : 'Загруженное фото' }));
  }
  /* Галерея с учётом манифеста: visible — в порядке показа (первое = обложка), hidden — скрытые и неиспользуемые */
  function list(t, e = entry(t.art)) {
    const { base, extra } = baseItems(t);
    const up = uploads(t, e);
    const all = new Map([...base, ...extra, ...up].map(x => [x.id, x]));
    if (!e) return { visible: base, hidden: extra.concat(up), all, custom: false };
    const hid = new Set(Array.isArray(e.hidden) ? e.hidden : []);
    const vis = [], used = new Set();
    const take = x => { if (x && !hid.has(x.id) && !used.has(x.id)) { vis.push(x); used.add(x.id); } };
    (Array.isArray(e.order) ? e.order : []).forEach(id => take(all.get(id)));
    base.forEach(take);
    return { visible: vis, hidden: [...all.values()].filter(x => !used.has(x.id)), all, custom: true };
  }
  const find = (t, id, e) => list(t, e).all.get(id) || null;

  function cover(t) { const v = list(t).visible; return v[0] || null; }
  function hover(t) {
    const L = list(t);
    if (!L.custom) { const h = t.hover && L.all.get('g:' + t.hover); return h && h !== L.visible[0] && L.visible.includes(h) ? h : null; }
    return L.visible[1] || null;
  }
  function icon(t) {
    const c = cover(t);
    if (c) return c.thumb;
    const tx = texOf(t);
    return tx ? tx.src : '';
  }
  /* Текстура плитки для примерочной */
  function texOf(t, e = entry(t.art)) {
    let tex = t.tile ? { src: t.tile, full: !!t.tileFull, id: 'tile', custom: false } : null;
    const r = clean(e && e.room);
    if (r && r.id) {
      const x = find(t, r.id, e);
      if (x) tex = { src: x.src, full: r.full !== false, id: x.id, custom: true };
    }
    return tex;
  }
  function floorOf(t, e = entry(t.art)) {
    const f = clean(e && e.floor);
    if (!f || !f.type || f.type === 'same') return null;
    if (f.type === 'art' && f.art && byArt[f.art] && f.art !== t.art) {
      const o = byArt[f.art], tx = texOf(o);
      if (!tx) return null;
      return { src: tx.src, full: tx.full, format: o.format, surface: o.surface, label: o.name, art: o.art, type: 'art' };
    }
    if (f.type === 'file' && f.id) {
      const x = find(t, f.id, e);
      if (!x) return null;
      return { src: x.src, full: true, format: FORMATS.includes(f.format) ? f.format : t.format, surface: f.surface || 'Матовая', label: f.label || 'Свой шаблон пола', type: 'file', id: f.id };
    }
    return null;
  }
  function room(t) {
    const e = entry(t.art);
    const scene = e && SCENES.includes(e.scene) ? e.scene : '';
    return { tex: texOf(t, e), floor: floorOf(t, e), scene };
  }
  const hasRoom = t => !!texOf(t);

  const notify = art => subs.forEach(f => { try { f(art); } catch (e) {} });
  window.CatalogMedia = {
    ready, byArt, FORMATS, SCENES,
    get published() { return pub; },
    drafts, alias,
    entry, baseItems, list, find, cover, hover, icon, texOf, floorOf, room, hasRoom,
    setDraft(art, e) { drafts[art] = e; notify(art); },
    clearDraft(art) { delete drafts[art]; notify(art); },
    setPublished(art, e) { if (e) pub[art] = e; else delete pub[art]; notify(art); },
    onChange(f) { subs.push(f); }
  };
})();
