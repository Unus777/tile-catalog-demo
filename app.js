/* Каталог плитки. Данные: data.js, название и контакты — config.js. */
(() => {
'use strict';
const C = window.CAT || { tiles: [], hero: [] }, T = C.tiles, HERO = C.hero || [];
const CFG = window.CATALOG_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
const PAGE = document.body.dataset.page;
const NB = '\u00A0';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (v, d = 2) => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d });
const rub = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('ru-RU') + NB + '₽';
const m2 = v => v > 0 ? nf(v) + NB + 'м²' : '—';
const m2r = v => v > 0 ? nf(v, 0) + NB + 'м²' : '—';
const parts = list => list.filter(Boolean).map(x => `<span class="nw">${x}</span>`).join('<span class="sep-dot"> · </span>');
const WA = CFG.WHATSAPP ? 'https://wa.me/' + String(CFG.WHATSAPP).replace(/\D/g, '') : '';
const byArt = Object.fromEntries(T.map(t => [t.art, t]));
const big = set => set && set[set.length - 1][1], small = set => set && set[0][1];
T.forEach(t => { t.icon = t.face ? small(t.face) + '.jpg' : t.card ? small(t.card) + '.jpg' : t.photos.length ? `img/${t.art}/${t.photos[0]}_t.jpg` : ''; });
const models = n => { const k = n % 10, h = n % 100; return `${n} ${k === 1 && h !== 11 ? 'модель' : k >= 2 && k <= 4 && (h < 12 || h > 14) ? 'модели' : 'моделей'}`; };
/** «1 уп-2шт-1,44м2-28,8 кг» → {pcs, sqm, kg, packs} */
function pack(s) { const n = re => +((String(s || '').replace(/,/g, '.').match(re) || [])[1] || 0); return { pcs: n(/(\d+)\s*шт/i), sqm: n(/([\d.]+)\s*м2/i), kg: n(/([\d.]+)\s*кг/i), packs: n(/(\d+)\s*уп/i) }; }
const packText = t => { const p = pack(t.packing); return p.sqm ? parts([p.pcs && `${p.pcs}${NB}плит${p.pcs < 5 ? 'ки' : 'ок'}`, `${nf(p.sqm)}${NB}м²`, p.kg && `${nf(p.kg, 1)}${NB}кг`]) : esc(t.packing); };
const palletText = t => { const p = pack(t.pallet); return p.sqm ? parts([p.packs && `${p.packs}${NB}упаковок`, `${nf(p.sqm)}${NB}м²`, p.kg && `${nf(p.kg, 0)}${NB}кг`]) : esc(t.pallet); };
const TONES = { 'Белый': '#efece6', 'Бежевый': '#d8c4a2', 'Серый': '#9b968f', 'Тёмный': '#3b3835', 'Цветной': 'conic-gradient(#d9a441,#b8784a,#8f9a6b,#d9a441)' };

function pic(set, sizes, alt, eager, ph) {
  if (!set) return '';
  const ss = ext => set.map(([w, p]) => `${p}.${ext} ${w}w`).join(', ');
  return `<picture${ph ? ` data-ph="${esc(ph)}"` : ''}><source type="image/webp" srcset="${ss('webp')}" sizes="${sizes}"><img src="${set[0][1]}.jpg" srcset="${ss('jpg')}" sizes="${sizes}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

/* ---------- ЦЕНЫ: price {cash, noncash, unit:'м2'}; прототип хранит правки в localStorage ---------- */
const KEY = CFG.STORAGE_KEY || 'catalog_prices', MKEY = CFG.MODE_KEY || 'catalog_mode';
let store; try { store = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
store = store && store.items ? store : { rule: { x: 12, round: 10 }, items: {} };
const saveStore = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
const roundTo = (v, r) => Math.round(v / r + 1e-9) * r;
const ruleCalc = cash => roundTo(cash * (1 + store.rule.x / 100), store.rule.round);
// В data.json цен нет → демонстрационная цена с пометкой «пример»
function exampleCash(t) { let p = t.format === '60×120' ? 1390 : 1090; if (/карвинг/i.test(t.surface)) p += 100; else if (/Глянец|Сатин/.test(t.surface)) p += 50; return p; }
function publishedPrice(t) {
  const p = window.CatalogAdmin && CatalogAdmin.published && CatalogAdmin.published[t.art];
  if (p && p.cash > 0) return { cash: +p.cash, noncash: p.noncash > 0 ? +p.noncash : ruleCalc(+p.cash), unit: 'м2', example: false };
}
function price(t) {
  const it = store.items[t.art];
  if (it && it.cash > 0) return { cash: +it.cash, noncash: it.auto !== false ? ruleCalc(+it.cash) : (+it.noncash || null), unit: 'м2', example: false };
  const pub = publishedPrice(t); if (pub) return pub;
  if (t.price && t.price.cash > 0) return { cash: +t.price.cash, noncash: t.price.noncash > 0 ? +t.price.noncash : ruleCalc(+t.price.cash), unit: t.price.unit || 'м2', example: false };
  const c = exampleCash(t); return { cash: c, noncash: ruleCalc(c), unit: 'м2', example: true };
}
let mode = 'cash'; try { if (localStorage.getItem(MKEY) === 'noncash') mode = 'noncash'; } catch (e) {}
const qp = new URLSearchParams(location.search);
if (qp.get('pay') === 'noncash' || qp.get('pay') === 'cash') mode = qp.get('pay');
const LBL = { cash: 'Наличные', noncash: 'Безнал с НДС' };
function priceHTML(t, extra) {
  const p = price(t), sq = pack(t.packing).sqm;
  if (!extra) return ['cash', 'noncash'].map(m => `<div class="p${mode === m ? ' on' : ''}" data-m="${m}"><small><span>${m === 'cash' ? 'Наличные' : 'Безнал'}</span></small><b>${rub(p[m])}</b></div>`).join('');
  return ['cash', 'noncash'].map(m => `<div class="p${mode === m ? ' on' : ''}" data-m="${m}"><small><span>${LBL[m]}</span>${p.example ? '<span class="ex">пример</span>' : ''}</small><b>${rub(p[m])}</b><span class="unit">за м² · упаковка ${sq && p[m] ? rub(p[m] * sq) : '—'}</span></div>`).join('');
}
const listeners = [];
function setMode(m, user) {
  mode = m; try { localStorage.setItem(MKEY, m); } catch (e) {}
  $$('.paytoggle button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === m));
  placePill(); $$('.p[data-m]').forEach(p => p.classList.toggle('on', p.dataset.m === m));
  listeners.forEach(f => f());
  if (user) toast(m === 'cash' ? 'Показываем цены за наличный расчёт' : 'Показываем цены по безналу (с НДС)');
}
const pill = $('.paytoggle-pill');
function placePill() { const b = $(`.paytoggle button[data-mode="${mode}"]`); if (!b || !pill) return; pill.style.width = b.offsetWidth + 'px'; pill.style.transform = `translateX(${b.offsetLeft - 3}px)`; }
$('.paytoggle')?.addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.mode !== mode) setMode(b.dataset.mode, true); });
addEventListener('resize', placePill);
$$('.paytoggle button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === mode));
placePill(); document.fonts && document.fonts.ready.then(placePill);

/* ---------- общее: шапка, прогресс, тост, волна, появление ---------- */
const nav = $('#nav'), prog = $('#progress'); let ticking = false; const scrollFns = [];
function onScroll() { ticking = false; const y = scrollY; nav.classList.toggle('scrolled', y > 20); const h = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${h > 0 ? y / h : 0})`; scrollFns.forEach(f => f(y)); }
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); }
document.addEventListener('pointerdown', e => { const b = e.target.closest('.btn'); if (!b || RM) return; const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), sp = document.createElement('span');
  sp.className = 'ripple'; sp.style.width = sp.style.height = s + 'px'; sp.style.left = e.clientX - r.left - s / 2 + 'px'; sp.style.top = e.clientY - r.top - s / 2 + 'px'; b.appendChild(sp); setTimeout(() => sp.remove(), 700); });
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .1, rootMargin: '0px 0px -5% 0px' });
const observe = el => RM ? el.classList.add('in') : io.observe(el);
const stat = $('#stat'); if (stat) stat.textContent = `${models(T.length)} · ${T.filter(t => t.photos.length).length} с фотографиями`;

/* ---------- карточка ---------- */
const CARD_SIZES = '(max-width:640px) 48vw, (max-width:1000px) 32vw, 320px';
function coverSet(t) {
  if (t.poster) return { set: t.poster, kind: 'poster', label: 'карточка' };
  if (t.card) return { set: t.card, kind: 'card', label: 'интерьер' };
  if (t.face) return { set: t.face, kind: 'face', label: 'фактура' };
  return null;
}
function hoverSet(t, mainKind) {
  if (mainKind === 'poster') {
    if (t.face) return { set: t.face, kind: 'face' };
    if (t.card) return { set: t.card, kind: 'card' };
  }
  if (mainKind === 'card' && t.face) return { set: t.face, kind: 'face' };
  if (mainKind === 'face' && t.card) return { set: t.card, kind: 'card' };
  return null;
}
function media(t) {
  const main = coverSet(t);
  if (!main) return t.photos.length ? `<img src="img/${t.art}/${t.photos[0]}_t.jpg" alt="${esc(t.name)}" loading="lazy" data-ph="${t.art}:img:${t.photos[0]}">`
    : `<div class="noph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2 22 12 12 22 2 12z"/><path d="M12 7l5 5-5 5-5-5z"/></svg><b>${esc(t.name)}</b><span>Фото скоро появится</span></div>`;
  const alt = hoverSet(t, main.kind);
  const altLab = main.kind === 'poster' ? (alt && alt.kind === 'face' ? 'фактура' : 'интерьер') : (main.kind === 'face' ? 'в интерьере' : 'фактура');
  return pic(main.set, CARD_SIZES, `${t.name} — ${main.label}`, false, t.art + ':' + main.kind) + (alt ? `<div class="alt">${pic(alt.set, CARD_SIZES, `${t.name} — ${altLab}`, false, t.art + ':' + alt.kind)}</div><div class="inset" aria-hidden="true">${pic(alt.set, '120px', '', false, t.art + ':' + alt.kind)}</div>` : '');
}
const card = t => `<a class="card" href="tile.html?a=${t.art}" data-art="${t.art}">
  <div class="ph">${media(t)}<div class="badges"><span class="badge">${t.format}</span>${t.is_new ? '<span class="badge new">Новинка</span>' : ''}</div></div>
  <div class="body"><div><h3>${esc(t.name)}</h3><div class="meta">${esc(t.surface)}${t.tone ? ' · ' + t.tone.toLowerCase() : ''}<span class="art"> · ${t.art}</span></div></div>
  <div class="prices">${priceHTML(t)}</div><div class="pnote"><span>цена за м²${t.format === '60×120' ? '' : ''}</span>${price(t).example ? '<span class="ex">пример</span>' : ''}</div>
  <div class="admin-acts admin-only" hidden><button type="button" class="btn sm" data-admin="price" data-art="${t.art}">Изменить цену</button><button type="button" class="btn sm" data-admin="photo" data-art="${t.art}">Изменить фото</button></div></div></a>`;
function refreshCardPrices(root = document) { $$('.card', root).forEach(c => { const t = byArt[c.dataset.art]; if (!t) return; $('.prices', c).innerHTML = priceHTML(t); const n = $('.pnote', c); if (n) n.innerHTML = '<span>цена за м²</span>' + (price(t).example ? '<span class="ex">пример</span>' : ''); }); }
// «Наличные» / «Безнал с НДС» — подписи на карточке короче, режим виден по подсветке

/* ---------- ПРИМЕРОЧНАЯ (общая для главной и страницы модели) ---------- */
function Room(getSel) {
  let R = null, started = false; const imgs = {};
  const load = src => imgs[src] || (imgs[src] = new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = no; i.src = src; }));
  function fallback(img, t) { const cv = $('#layoutCv'), x = cv.getContext('2d'); x.fillStyle = '#b9b2a7'; x.fillRect(0, 0, cv.width, cv.height); const [a, b] = t.format.split('×').map(Number), tw = cv.width / 4, th = tw * Math.min(a, b) / Math.max(a, b);
    for (let j = 0; j * th < cv.height; j++) for (let i = -1; i * tw < cv.width; i++) x.drawImage(img, i * tw + (j % 2 ? tw / 2 : 0) + 1, j * th + 1, tw - 2, th - 2); }
  function priceBox() { const t = getSel(); const el = $('#roomPrice'); if (el && t) el.innerHTML = `<div class="prices">${priceHTML(t, true)}</div>`; }
  async function apply() {
    const t = getSel(); if (!t || !t.tile) return;
    const lab = $('#roomLabel'); lab.innerHTML = `<small>${t.art} · ${t.format} · ${esc(t.surface)}</small>${esc(t.name)}`; lab.href = `tile.html?a=${t.art}`;
    const fs = big(t.face); $('#loupeImg').src = fs + '.jpg'; $('#loupe').style.backgroundImage = `url("${fs}.jpg")`;
    priceBox();
    const img = await load(t.tile); if (getSel() !== t) return;
    if (R) { R.setTile(img, { format: t.format, surface: t.surface, full: t.tileFull }); R.layoutPreview($('#layoutCv')); } else fallback(img, t);
  }
  const seg = (id, fn) => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$(id + ' button').forEach(x => x.classList.toggle('on', x === b)); fn(b); });
  seg('#roomModes', b => R && R.setMode(b.dataset.m));
  seg('#patSeg', b => { if (R) { R.setPattern(b.dataset.p); R.layoutPreview($('#layoutCv')); } });
  seg('#groutDots', b => { if (R) { R.setGrout(b.dataset.c); R.layoutPreview($('#layoutCv')); } });
  seg('#groutW', b => { if (R) { R.setGroutMM(+b.dataset.w); R.layoutPreview($('#layoutCv')); } });
  const lb = $('#loupeBox'), lp = $('#loupe');
  const mv = e => { const r = lb.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, Z = 3.2;
    lp.style.setProperty('--lx', (x - 75) + 'px'); lp.style.setProperty('--ly', (y - 75) + 'px'); lp.style.backgroundSize = `${r.width * Z}px ${r.height * Z}px`; lp.style.backgroundPosition = `${-(x * Z - 75)}px ${-(y * Z - 75)}px`; };
  lb.addEventListener('pointermove', e => { lb.classList.add('on'); mv(e); }); lb.addEventListener('pointerdown', e => { lb.classList.add('on'); mv(e); });
  lb.addEventListener('pointerleave', () => lb.classList.remove('on')); lb.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') setTimeout(() => lb.classList.remove('on'), 900); });
  function start() {
    if (started) return; started = true;
    const s = document.createElement('script'); s.src = 'room.bundle.js'; s.async = true;
    s.onload = () => { try { R = window.CatalogRoom.createRoom($('#roomGl'), { preserve: /[?&]shot/.test(location.search), low: /[?&]low/.test(location.search) }); } catch (err) { R = null; }
      if (!R) $('#roomLoading').textContent = '3D-просмотр недоступен на этом устройстве — смотрите фактуру и схему раскладки.';
      apply().then(() => { if (R) setTimeout(() => { $('#roomGl').classList.add('ready'); $('#roomLoading').classList.add('hide'); }, 350); }); };
    s.onerror = () => { $('#roomLoading').textContent = 'Не удалось загрузить 3D-просмотр.'; apply(); };
    document.body.appendChild(s);
  }
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { start(); o.disconnect(); } }, { rootMargin: '700px 0px' }).observe($('#roomStage'));
  listeners.push(priceBox);
  apply();
  return { apply };
}

/* =================== ГЛАВНАЯ =================== */
function pageIndex() {
  // HERO
  const slidesEl = $('#heroSlides'), dots = $('#heroDots');
  HERO.forEach((h, i) => { const d = document.createElement('div'); d.className = 'hero-slide'; d.style.setProperty('--ox', [62, 40, 55, 70, 45][i % 5] + '%'); d.innerHTML = pic(h.set, '100vw', '', i === 0, h.art + ':card'); slidesEl.appendChild(d);
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Слайд ' + (i + 1) + ': ' + byArt[h.art].name); b.onclick = () => show(i, true); dots.appendChild(b); });
  let cur = -1, timer;
  function chip() { if (cur < 0) return; const t = byArt[HERO[cur].art], p = price(t); $('#chipPrice').textContent = `${mode === 'cash' ? 'Наличные' : 'Безнал'} ${rub(p[mode])} / м²${p.example ? ' · пример' : ''}`; }
  function show(i, manual) {
    const ss = $$('.hero-slide'), ds = $$('#heroDots button'); if (!ss.length) return;
    ss.forEach((s, k) => s.classList.toggle('on', k === i)); ds.forEach((s, k) => { s.classList.remove('on'); if (k === i) { void s.offsetWidth; s.classList.add('on'); } });
    cur = i; const t = byArt[HERO[i].art], c = $('#heroChip'); c.classList.add('swap');
    setTimeout(() => { $('#chipImg').src = t.icon; $('#chipArt').textContent = `${t.format} · ${t.surface}`; $('#chipName').textContent = t.name; c.href = `tile.html?a=${t.art}`; chip(); c.classList.remove('swap'); }, manual || !timer ? 60 : 450);
    clearTimeout(timer); if (!RM) timer = setTimeout(() => show((cur + 1) % HERO.length), 7000);
  }
  listeners.push(chip);
  const h1 = $('#heroTitle'), w = h1.dataset.text.split(' ');
  h1.innerHTML = w.map((x, i) => `<span class="w${i >= w.length - 2 ? ' accent' : ''}" style="--i:${i}"><span>${esc(x)}</span></span>`).join(''); h1.setAttribute('aria-label', h1.dataset.text);
  show(0);
  window.CatalogPhotos && CatalogPhotos.hydrate(slidesEl);
  scrollFns.push(y => { if (!RM && y < innerHeight * 1.1) slidesEl.style.transform = `translate3d(0,${y * .25}px,0)`; });
  $('#s-models').textContent = T.length;

  // КАТАЛОГ
  const grid = $('#grid'), count = $('#count');
  const formats = [...new Set(T.map(t => t.format))].sort((a, b) => parseInt(a.split('×')[1]) - parseInt(b.split('×')[1]));
  const surfaces = [...new Set(T.map(t => t.surface))].sort();
  const tones = Object.keys(TONES).filter(k => T.some(t => t.tone === k));
  const st = { f: formats.includes(qp.get('f')) ? qp.get('f') : '', s: surfaces.includes(qp.get('s')) ? qp.get('s') : '', c: tones.includes(qp.get('c')) ? qp.get('c') : '', q: qp.get('q') || '', stock: false, nw: qp.get('new') === '1', sort: qp.get('sort') || '' };
  const chipsHTML = (k, list, all) => (all ? [['', all]] : []).concat(list.map(v => [v, v])).map(([v, l]) => `<button type="button" class="chip" data-k="${k}" data-v="${esc(v)}" aria-pressed="false">${k === 'c' && v ? `<span class="sw" style="--c:${TONES[v]}"></span>` : ''}${esc(l)}</button>`).join('');
  $('#fmt').innerHTML = chipsHTML('f', formats, 'Все форматы'); $('#srf').innerHTML = chipsHTML('s', surfaces); $('#ton').innerHTML = chipsHTML('c', tones);
  $('#sFmt').innerHTML = chipsHTML('f', formats, 'Все форматы'); $('#sSrf').innerHTML = chipsHTML('s', surfaces); $('#sTon').innerHTML = chipsHTML('c', tones);
  $('#sMore').innerHTML = `<button type="button" class="chip" data-k="nw" data-v="1" aria-pressed="false">Новинки</button>`;
  $('#sSort').innerHTML = [...$('#sort').options].map(o => `<button type="button" class="chip" data-k="sort" data-v="${o.value}" aria-pressed="false">${o.textContent}</button>`).join('');
  $('#q').value = st.q; $('#sort').value = st.sort;
  grid.innerHTML = T.map(card).join('') + '<p class="empty" id="empty" hidden>Ничего не найдено — попробуйте другой формат или поверхность.</p>';
  window.CatalogPhotos && CatalogPhotos.hydrate(grid);
  const cards = $$('.card', grid); const free = () => 0;
  function syncUI() {
    $$('.chip[data-k]').forEach(b => { const k = b.dataset.k, v = b.dataset.v; b.setAttribute('aria-pressed', k === 'stock' || k === 'nw' ? String(st[k]) : String(st[k] === v)); });
    $('#fNew').setAttribute('aria-pressed', st.nw); $('#sort').value = st.sort;
    const n = [st.f, st.s, st.c, st.stock, st.nw].filter(Boolean).length, fc = $('#fcount'); fc.textContent = n; fc.classList.toggle('on', n > 0);
  }
  function syncURL() {
    const u = new URLSearchParams(); if (st.f) u.set('f', st.f); if (st.s) u.set('s', st.s); if (st.c) u.set('c', st.c); if (st.q) u.set('q', st.q); if (st.stock) u.set('stock', 1); if (st.nw) u.set('new', 1); if (st.sort) u.set('sort', st.sort);
    if (qp.has('shot')) u.set('shot', ''); if (qp.has('low')) u.set('low', '');
    const s = u.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }
  let first = true;
  function draw() {
    const q = st.q.trim().toLowerCase();
    const ok = t => (!st.f || t.format === st.f) && (!st.s || t.surface === st.s) && (!st.c || t.tone === st.c) && (!st.stock || free(t) > 0) && (!st.nw || t.is_new) && (!q || (t.name + ' ' + t.art).toLowerCase().includes(q));
    const before = first || RM ? null : new Map(cards.filter(c => !c.classList.contains('hide')).map(c => [c, c.getBoundingClientRect()]));
    let order = cards.slice();
    const pr = c => price(byArt[c.dataset.art])[mode];
    if (st.sort === 'price-asc') order.sort((a, b) => pr(a) - pr(b)); else if (st.sort === 'price-desc') order.sort((a, b) => pr(b) - pr(a));
    else if (st.sort === 'name') order.sort((a, b) => byArt[a.dataset.art].name.localeCompare(byArt[b.dataset.art].name, 'ru'));
    let n = 0; order.forEach(c => { const v = ok(byArt[c.dataset.art]); c.classList.toggle('hide', !v); if (v) n++; grid.insertBefore(c, $('#empty')); });
    $('#empty').hidden = n > 0;
    count.textContent = n === T.length ? models(T.length) : `${n} из ${T.length}`;
    if (before) {
      const vis = order.filter(c => !c.classList.contains('hide')).slice(0, 24);
      vis.forEach((c, i) => { const r = c.getBoundingClientRect(); if (r.top > innerHeight + 200) return; const b = before.get(c);
        if (b) { const dx = b.left - r.left, dy = b.top - r.top; if (dx || dy) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.22,1,.36,1)' }); }
        else c.animate([{ opacity: 0, transform: 'translateY(18px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: Math.min(i, 10) * 30, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }); });
    }
    first = false; syncUI(); syncURL();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.chip[data-k]'); if (!b) return; const k = b.dataset.k, v = b.dataset.v;
    if (k === 'stock' || k === 'nw') st[k] = !st[k]; else if (k === 'sort' || k === 'f') st[k] = v; else st[k] = st[k] === v ? '' : v;   // повторный клик снимает фильтр
    draw();
  });
  $('#fNew').onclick = () => { st.nw = !st.nw; draw(); };
  $('#sort').onchange = e => { st.sort = e.target.value; draw(); };
  let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value; draw(); }, 120); });
  const sheet = $('#sheet'); const openSheet = o => { sheet.classList.toggle('open', o); sheet.setAttribute('aria-hidden', String(!o)); };
  $('#fbtn').onclick = () => openSheet(true); $('#sDone').onclick = () => { openSheet(false); $('#catalog').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); };
  $('#sReset').onclick = () => { Object.assign(st, { f: '', s: '', c: '', stock: false, nw: false, sort: '' }); draw(); };
  sheet.addEventListener('click', e => { if (e.target === sheet) openSheet(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') openSheet(false); });
  listeners.push(() => { refreshCardPrices(grid); if (st.sort.startsWith('price')) draw(); });
  draw();
  if (FINE && !RM) grid.addEventListener('pointermove', e => { const c = e.target.closest('.card'); if (!c) return; const r = c.getBoundingClientRect(); c.style.setProperty('--rx', ((e.clientY - r.top) / r.height - .5) * -4 + 'deg'); });

  // ПРИМЕРОЧНАЯ
  const roomT = T.filter(t => t.tile);
  let sel = byArt.VHP600822 && byArt.VHP600822.tile ? byArt.VHP600822 : roomT[0];
  $('#swatches').innerHTML = roomT.map(t => `<button type="button" class="swb" data-art="${t.art}" title="${esc(t.name)} · ${t.format} · ${esc(t.surface)}"><img src="${t.icon}" alt="" loading="lazy" decoding="async" width="76" height="76"><span>${esc(t.name)}</span></button>`).join('');
  const room = Room(() => sel);
  const mark = () => { $$('.swb').forEach(s => s.classList.toggle('on', s.dataset.art === sel.art)); $('#roomOpen').href = `tile.html?a=${sel.art}`; };
  mark();
  $('#swatches').addEventListener('click', e => { const b = e.target.closest('.swb'); if (b) { sel = byArt[b.dataset.art]; mark(); room.apply(); } });
  $$('.reveal').forEach(observe);
}

/* =================== СТРАНИЦА МОДЕЛИ (tile.html?a=АРТИКУЛ) =================== */
function lightbox(list, start) {
  let i = start; const box = document.createElement('div'); box.className = 'lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Фото на весь экран');
  box.innerHTML = `<img alt=""><button class="x" aria-label="Закрыть">✕</button>${list.length > 1 ? '<button class="prev" aria-label="Предыдущее">‹</button><button class="next" aria-label="Следующее">›</button>' : ''}<span class="lc"></span>`;
  const im = $('img', box);
  const show = () => { im.src = list[i].full; $('.lc', box).textContent = `${i + 1} / ${list.length} · ${list[i].label}`; };
  const close = () => { box.remove(); document.removeEventListener('keydown', keys); document.body.style.overflow = ''; };
  const step = d => { i = (i + d + list.length) % list.length; show(); };
  const keys = e => ({ Escape: close, ArrowLeft: () => step(-1), ArrowRight: () => step(1) })[e.key]?.();
  let sx = null; box.addEventListener('pointerdown', e => sx = e.clientX); box.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 50) { step(e.clientX < sx ? 1 : -1); sx = null; e.stopPropagation(); box._sw = true; } sx = null; });
  box.addEventListener('click', e => { if (box._sw) { box._sw = false; return; } const b = e.target.closest('button'); if (!b) { if (e.target !== im) close(); return; } if (b.className === 'x') close(); else step(b.className === 'next' ? 1 : -1); });
  document.addEventListener('keydown', keys); show(); document.body.append(box); document.body.style.overflow = 'hidden';
}
function pageTile() {
  const art = qp.get('a'), t = byArt[art], box = $('#tile');
  if (!t) { box.innerHTML = `<div class="missing"><p class="eyebrow">Каталог</p><h1>Эта модель сейчас не в каталоге.</h1><p>${art ? `Артикул ${esc(art)} не найден.` : ''}</p><p><a class="btn gold" href="index.html#catalog">Весь каталог</a></p></div>`; return; }
  document.title = `${t.name} — керамогранит ${t.format} | ${CFG.NAME || 'Каталог плитки'}`;
  const p = pack(t.packing), packs = v => p.sqm ? Math.floor(v / p.sqm + 1e-9) : 0;
  const wa = WA ? `${WA}?text=${encodeURIComponent(`Здравствуйте! Интересует керамогранит ${t.name} ${t.format}.`)}` : '';
  const cb = $('#cbWa'); if (cb && wa) cb.href = wa;
  // галерея: сначала карточка как на Ozon, затем фактура, интерьер и фото производителя
  const G = [];
  const gSz = '(max-width:1000px) 100vw, 680px';
  if (t.poster) G.push({ html: pic(t.poster, gSz, `${t.name} — карточка`, true, t.art + ':poster'), thumb: small(t.poster) + '.jpg', full: big(t.poster) + '.jpg', label: 'карточка', ph: t.art + ':poster', poster: true });
  if (t.face) G.push({ html: pic(t.face, gSz, `${t.name} — фактура`, !t.poster, t.art + ':face'), thumb: small(t.face) + '.jpg', full: big(t.face) + '.jpg', label: 'фактура', ph: t.art + ':face' });
  if (t.card) G.push({ html: pic(t.card, gSz, `${t.name} в интерьере`, !t.poster && !t.face, t.art + ':card'), thumb: small(t.card) + '.jpg', full: big(t.card) + '.jpg', label: 'интерьер', ph: t.art + ':card' });
  const nClean = G.length;
  t.photos.forEach((ph, i) => G.push({ html: `<img src="img/${t.art}/${ph}.jpg" alt="${esc(t.name)}, фото ${i + 1}" loading="${G.length ? 'lazy' : 'eager'}" decoding="async" data-ph="${t.art}:img:${ph}">`, thumb: `img/${t.art}/${ph}_t.jpg`, full: `img/${t.art}/${ph}.jpg`, label: 'фото производителя', orig: true, ph: t.art + ':img:' + ph }));
  const gallery = G.length ? `<div class="main-ph"><div class="track" id="track">${G.map((g, i) => `<button type="button" class="slide${g.orig || g.poster ? ' contain' : ''}" data-i="${i}" aria-label="Открыть фото ${i + 1} на весь экран">${g.html}${i < nClean ? `<span class="tagl">${g.label}</span>` : ''}</button>`).join('')}</div>
      ${G.length > 1 ? '<button type="button" class="gal-nav prev" aria-label="Предыдущее">‹</button><button type="button" class="gal-nav next" aria-label="Следующее">›</button>' : ''}</div>
    <div class="thumbs" id="thumbs">${G.map((g, i) => `${i === nClean && nClean ? '<span class="sep">производитель</span>' : ''}<button type="button" data-i="${i}" aria-pressed="${i === 0}" aria-label="Фото ${i + 1}"><img src="${g.thumb}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>
    <p class="cap"><span id="cap">Фото 1 из ${G.length}</span><span>${nClean ? 'Чистые кадры + фото производителя' : ''}</span></p>`
    : '<div class="main-ph"><div class="noph"><b>' + esc(t.name) + '</b><span>Фотографии этой модели скоро появятся</span></div></div>';
  const similar = T.filter(x => x.art !== t.art && x.photos.length && x.format === t.format).sort((a, b) => (b.surface === t.surface) - (a.surface === t.surface) || (b.tone === t.tone) - (a.tone === t.tone)).slice(0, 4);
  box.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Путь"><a href="index.html#catalog">Каталог</a><span aria-hidden="true">/</span><a href="index.html?f=${encodeURIComponent(t.format)}#catalog">${t.format}</a><span aria-hidden="true">/</span><span>${esc(t.name)}</span></nav>
    <div class="tile">
      <div class="gal">${gallery}</div>
      <div class="head"><p class="eyebrow">Керамогранит · ${t.format}</p><h1>${esc(t.name)}${t.is_new ? '<span class="tag-new">Новинка</span>' : ''}</h1>
          <p class="sub">${parts([t.art, esc(t.surface), t.tone && `тон: ${t.tone.toLowerCase()}`])}</p></div>
      <div class="side">
        <div class="bigprice" id="bigprice">${priceHTML(t, true)}</div>
        ${p.sqm ? `<div class="calc"><label for="need" class="eyebrow">Сколько нужно, м²</label>
          <div class="row"><input id="need" inputmode="decimal" value="${nf(p.sqm * 10)}" aria-describedby="calcRes"><span class="res" id="calcRes" role="status"></span></div>
          <div class="tot" id="calcTot"></div><p>Отгружаем целыми упаковками, округляем вверх.</p></div>` : ''}
        ${ (CFG.PHONE || wa) ? `<div class="ctas">${CFG.PHONE ? `<a class="btn gold" href="tel:${String(CFG.PHONE).replace(/[^\d+]/g, '')}">Позвонить</a>` : ''}${wa ? `<a class="btn" href="${wa}" target="_blank" rel="noopener">Написать в WhatsApp</a>` : ''}</div>` : ''}
        <dl class="spec"><dt>Формат</dt><dd>${t.format} см</dd><dt>Поверхность</dt><dd>${esc(t.surface)}</dd><dt>В упаковке</dt><dd>${packText(t)}</dd><dt>Паллета</dt><dd>${palletText(t)}</dd><dt>Артикул</dt><dd>${t.art}</dd></dl>
        <div class="admin-acts admin-only" hidden><button type="button" class="btn sm" data-admin="price" data-art="${t.art}">Изменить цену</button><a class="btn sm" href="edit.html?a=${t.art}">Изменить фото</a></div>
      </div>
    </div></div>
    ${t.tile ? `<section class="texsec" id="room"><div class="wrap"><p class="eyebrow">Фактура и примерка</p><h2>${esc(t.name)} <em>в комнате</em></h2><div id="roomHost"></div></div></section>` : ''}
    ${similar.length ? `<section class="similar"><div class="wrap"><h2>Похожие модели</h2><div class="grid">${similar.map(card).join('')}</div></div></section>` : ''}`;
  // калькулятор
  const need = $('#need');
  const recalc = () => { if (!need) return; const v = +need.value.replace(',', '.').replace(/[^\d.]/g, ''); const n = v > 0 ? Math.ceil(v / p.sqm - 1e-9) : 0, pr = price(t);
    $('#calcRes').innerHTML = n ? '= ' + parts([`<b>${n}${NB}уп.</b>`, `${nf(n * p.sqm)}${NB}м²`, p.kg && `${nf(n * p.kg, 0)}${NB}кг`]) : 'Введите площадь';
    $('#calcTot').innerHTML = n ? ['cash', 'noncash'].map(m => `<div class="p${mode === m ? ' on' : ''}" data-m="${m}"><small><span>Итого · ${m === 'cash' ? 'нал' : 'безнал'}</span>${pr.example ? '<span class="ex">пример</span>' : ''}</small><b>${rub(pr[m] * n * p.sqm)}</b></div>`).join('') : ''; };
  need?.addEventListener('input', recalc); recalc();
  listeners.push(() => { $('#bigprice').innerHTML = priceHTML(t, true); recalc(); $$('.similar .card').length && refreshCardPrices($('.similar')); });
  // галерея: свайп (scroll-snap), миниатюры, стрелки, лайтбокс
  const track = $('#track'), thumbs = $('#thumbs');
  if (track) {
    let curI = 0;
    const go = (i, smooth = true) => { i = Math.max(0, Math.min(G.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: smooth && !RM ? 'smooth' : 'auto' }); };
    const upd = () => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i === curI) return; curI = i; $('#cap').textContent = `Фото ${i + 1} из ${G.length}`;
      $$('button', thumbs).forEach(b => b.setAttribute('aria-pressed', +b.dataset.i === i)); const th = $(`button[data-i="${i}"]`, thumbs); th && thumbs.scrollTo({ left: th.offsetLeft - thumbs.clientWidth / 2 + 31, behavior: RM ? 'auto' : 'smooth' }); };
    track.addEventListener('scroll', () => requestAnimationFrame(upd), { passive: true });
    thumbs.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) go(+b.dataset.i); });
    $('.gal-nav.prev')?.addEventListener('click', () => go(curI - 1)); $('.gal-nav.next')?.addEventListener('click', () => go(curI + 1));
    track.addEventListener('click', e => { const s = e.target.closest('.slide'); if (s) lightbox(G, +s.dataset.i); });
    track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(curI + 1); if (e.key === 'ArrowLeft') go(curI - 1); });
  }
  if (t.tile) { $('#roomHost').innerHTML = $('#roomTpl').innerHTML; Room(() => t); }
  window.CatalogPhotos && CatalogPhotos.hydrate(box);
  $$('.texsec,.similar').forEach(el => { el.classList.add('reveal'); observe(el); });
}

/* =================== РЕДАКТОР ЦЕН =================== */
function applyPublishedToStore(overwrite) {
  const pub = (window.CatalogAdmin && CatalogAdmin.published) || {};
  Object.entries(pub).forEach(([art, p]) => {
    if (!overwrite && store.items[art] && store.items[art].cash > 0) return;
    const auto = Math.abs(ruleCalc(+p.cash) - (+p.noncash || 0)) < 1;
    store.items[art] = { cash: +p.cash, noncash: +p.noncash || ruleCalc(+p.cash), auto };
  });
}
function pagePrices() {
  const rows = $('#admRows');
  applyPublishedToStore(false);
  $('#ruleX').value = store.rule.x; $('#ruleRound').value = store.rule.round;
  const row = t => { const it = store.items[t.art] || {}, auto = it.auto !== false, ex = exampleCash(t);
    return `<tr data-art="${t.art}"><td><div class="m">${t.icon ? `<img src="${t.icon}" alt="" loading="lazy">` : '<img alt="">'}<div><a href="tile.html?a=${t.art}" style="text-decoration:none">${esc(t.name)}</a><small>${t.art} · ${esc(t.surface)}</small></div></div></td><td>${t.format}</td>
    <td><span class="pin"><input type="number" min="0" step="10" inputmode="numeric" class="in-cash" value="${it.cash || ''}" placeholder="пример ${ex}" aria-label="Наличные, ${esc(t.name)}"></span></td>
    <td><label class="switch" title="Безнал по правилу"><input type="checkbox" class="in-auto" ${auto ? 'checked' : ''} aria-label="Безнал по правилу"><span></span></label></td>
    <td><span class="pin"><input type="number" min="0" step="10" inputmode="numeric" class="in-non" value="${it.cash ? (auto ? ruleCalc(+it.cash) : (it.noncash || '')) : ''}" placeholder="пример ${ruleCalc(ex)}" ${auto ? 'disabled' : ''} aria-label="Безнал, ${esc(t.name)}"></span><span class="saved">✓ сохранено</span></td></tr>`; };
  const draw = () => { rows.innerHTML = T.map(row).join(''); };
  draw();
  rows.addEventListener('input', e => { const tr = e.target.closest('tr'); if (!tr) return; const a = tr.dataset.art, it = store.items[a] || (store.items[a] = { auto: true });
    if (e.target.classList.contains('in-cash')) { it.cash = Math.max(0, +e.target.value || 0); if (it.auto !== false) $('.in-non', tr).value = it.cash ? ruleCalc(it.cash) : ''; }
    if (e.target.classList.contains('in-non')) it.noncash = Math.max(0, +e.target.value || 0);
    if (e.target.classList.contains('in-auto')) { it.auto = e.target.checked; const n = $('.in-non', tr); n.disabled = it.auto; if (it.auto) n.value = it.cash ? ruleCalc(it.cash) : ''; }
    if (!it.cash && !it.noncash) delete store.items[a];
    saveStore(); const s = $('.saved', tr); s.classList.add('on'); clearTimeout(s._h); s._h = setTimeout(() => s.classList.remove('on'), 1200); });
  $('#ruleApply').onclick = () => { store.rule.x = Math.max(0, +$('#ruleX').value || 0); store.rule.round = +$('#ruleRound').value; saveStore(); draw(); toast(`Безнал = нал + ${store.rule.x}% · пересчитано`); };
  $('#admQ').addEventListener('input', e => { const q = e.target.value.toLowerCase(); $$('tr', rows).forEach(tr => { const t = byArt[tr.dataset.art]; tr.classList.toggle('hide', !!q && !(t.name + ' ' + t.art).toLowerCase().includes(q)); }); });
  $('#exportBtn').onclick = () => { const out = {}; T.forEach(t => { const it = store.items[t.art]; if (it && it.cash > 0) { const p = price(t); out[t.art] = { price: { cash: p.cash, noncash: p.noncash, unit: 'м2' } }; } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ rule: store.rule, tiles: out }, null, 1)], { type: 'application/json' })); a.download = 'catalog-prices.json'; a.click(); toast(`Экспортировано: ${Object.keys(out).length}`); };
  $('#importIn').onchange = async e => { try { const j = JSON.parse(await e.target.files[0].text()); Object.entries(j.tiles || {}).forEach(([a, v]) => { if (byArt[a] && v.price) store.items[a] = { cash: +v.price.cash, noncash: +v.price.noncash, auto: false }; }); if (j.rule) store.rule = j.rule; saveStore(); draw(); toast('Цены загружены'); } catch (err) { toast('Не удалось прочитать файл'); } };
  $('#resetBtn').onclick = () => { if (!confirm('Удалить черновик цен в этом браузере? Опубликованные на сайте цены останутся.')) return; store = { rule: { x: 12, round: 10 }, items: {} }; applyPublishedToStore(true); saveStore(); $('#ruleX').value = 12; $('#ruleRound').value = 10; draw(); toast('Черновик сброшен, показаны цены с сайта'); };
  $('#reloadPrices').onclick = () => { applyPublishedToStore(true); saveStore(); draw(); toast('Загружены опубликованные цены'); };
  $('#pubPrices').onclick = async () => {
    if (!(window.CatalogAdmin && CatalogAdmin.isAuthed())) return toast('Нужен вход администратора');
    const batch = {};
    T.forEach(t => {
      const it = store.items[t.art];
      if (it && it.cash > 0) { const p = price(t); batch[t.art] = { cash: p.cash, noncash: p.noncash }; }
      else if (CatalogAdmin.published[t.art]) batch[t.art] = { cash: 0 };
    });
    const n = Object.values(batch).filter(p => p.cash > 0).length;
    if (!n && !Object.keys(batch).length) return toast('Нечего публиковать — нет введённых цен');
    const btn = $('#pubPrices'); btn.disabled = true;
    try {
      await CatalogAdmin.publishPrices(batch);
      saveStore();
      listeners.forEach(f => f());
    } catch (e) { /* статус уже показан */ }
    finally { btn.disabled = false; }
  };
}

function showAuthGate() {
  const main = $('main');
  if (main) { main.hidden = true; main.setAttribute('aria-hidden', 'true'); }
  const g = document.createElement('section');
  g.className = 'admin-gate'; g.id = 'adminGate';
  g.innerHTML = `<div class="gate-card">
    <h1>Нужен вход администратора</h1>
    <p class="lead">Цены и фото на сайт может менять только администратор с токеном GitHub. Без токена сохранить изменения нельзя.</p>
    <p><a class="btn gold" href="admin.html">Вход для администраторов</a></p>
    <p class="gate-back"><a href="index.html">← Вернуться в каталог</a></p>
  </div>`;
  if (main && main.parentNode) main.parentNode.insertBefore(g, main); else document.body.append(g);
}

function openPriceModal(art) {
  const t = byArt[art]; if (!t) return;
  const modal = $('#priceModal'); if (!modal) return;
  const p = price(t), it = store.items[art] || {};
  const auto = it.auto !== false;
  $('#pmTitle').textContent = 'Цена: ' + t.name;
  $('#pmSub').textContent = t.art + ' · ' + t.format + ' · ₽/м²';
  $('#pmCash').value = p.example ? '' : p.cash;
  $('#pmAuto').checked = auto;
  $('#pmNon').value = p.example ? '' : (p.noncash || '');
  $('#pmNon').disabled = auto;
  modal.dataset.art = art;
  modal.hidden = false;
}
function closePriceModal() { const m = $('#priceModal'); if (m) { m.hidden = true; delete m.dataset.art; } }
function wirePriceModal() {
  const modal = $('#priceModal'); if (!modal || modal._wired) return;
  modal._wired = true;
  const syncNon = () => {
    if ($('#pmAuto').checked) {
      const cash = Math.max(0, +$('#pmCash').value || 0);
      $('#pmNon').disabled = true;
      $('#pmNon').value = cash ? ruleCalc(cash) : '';
    } else $('#pmNon').disabled = false;
  };
  $('#pmCash').addEventListener('input', syncNon);
  $('#pmAuto').addEventListener('change', syncNon);
  $('#pmCancel').onclick = closePriceModal;
  modal.addEventListener('click', e => { if (e.target === modal) closePriceModal(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closePriceModal(); });
  $('#pmSave').onclick = async () => {
    const art = modal.dataset.art, t = byArt[art]; if (!t) return;
    if (!(window.CatalogAdmin && CatalogAdmin.isAuthed())) return toast('Нужен вход администратора');
    const cash = Math.max(0, +$('#pmCash').value || 0);
    if (!cash) return toast('Введите цену за наличные');
    const auto = $('#pmAuto').checked;
    const noncash = auto ? ruleCalc(cash) : Math.max(0, +$('#pmNon').value || 0);
    store.items[art] = { cash, noncash, auto };
    saveStore();
    const btn = $('#pmSave'); btn.disabled = true;
    try {
      await CatalogAdmin.publishPrices({ [art]: { cash, noncash } });
      listeners.forEach(f => f());
      refreshCardPrices();
      const bp = $('#bigprice'); if (bp) bp.innerHTML = priceHTML(t, true);
      closePriceModal();
    } catch (e) { /* статус уже показан */ }
    finally { btn.disabled = false; }
  };
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-admin]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const art = b.dataset.art || b.closest('[data-art]')?.dataset.art;
  if (b.dataset.admin === 'photo' && art) location.href = 'edit.html?a=' + encodeURIComponent(art);
  if (b.dataset.admin === 'price' && art) openPriceModal(art);
}, true);

async function start() {
  if (window.CatalogAdmin && CatalogAdmin.ready) { try { await CatalogAdmin.ready; } catch (e) {} }
  const needAuth = PAGE === 'prices' || PAGE === 'edit';
  if (needAuth && !(window.CatalogAdmin && CatalogAdmin.isAuthed())) { showAuthGate(); onScroll(); return; }
  wirePriceModal();
  if (PAGE === 'index') pageIndex();
  else if (PAGE === 'tile') pageTile();
  else if (PAGE === 'prices') pagePrices();
  onScroll();
  if (window.CatalogAdmin) CatalogAdmin.applyAdminUI(CatalogAdmin.isAuthed());
}
start();
// режим нал/безнал хранится в localStorage
})();
