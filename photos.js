/* Правки фото в IndexedDB. Оригиналы на диске не меняются. */
(() => {
  const CFG = window.CATALOG_CONFIG || {};
  const DB_NAME = CFG.PHOTO_DB || 'catalog_photo_edits';
  const STORE = 'photos';
  const urls = new Map();
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((ok, no) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return dbp;
  }
  function req(fn) {
    return open().then(db => new Promise((ok, no) => {
      const tx = db.transaction(STORE, fn.write ? 'readwrite' : 'readonly');
      const st = tx.objectStore(STORE);
      const q = fn(st);
      q.onsuccess = () => ok(q.result);
      q.onerror = () => no(q.error);
    }));
  }
  const key = (art, id) => art + ':' + id;
  function objectURL(k, blob) {
    if (urls.has(k)) URL.revokeObjectURL(urls.get(k));
    const u = URL.createObjectURL(blob);
    urls.set(k, u);
    return u;
  }
  window.CatalogPhotos = {
    key,
    get: (art, id) => req(st => st.get(key(art, id))),
    getByKey: k => req(st => st.get(k)),
    put: (art, id, blob, mime, name) => req(Object.assign(st => st.put({ art, id, blob, mime: mime || blob.type, name: name || id, updated: Date.now() }, key(art, id)), { write: true })),
    remove: (art, id) => req(Object.assign(st => st.delete(key(art, id)), { write: true })),
    keys: () => req(st => st.getAllKeys()),
    url: objectURL,
    cached: k => urls.get(k),
    async hydrate(rootEl = document) {
      if (window.CatalogAdmin && CatalogAdmin.ready) { try { await CatalogAdmin.ready; } catch (e) {} }
      const els = [...rootEl.querySelectorAll('[data-ph]')];
      if (!els.length) return;
      await Promise.all(els.map(async el => {
        try {
          const rec = await window.CatalogPhotos.getByKey(el.dataset.ph);
          let u = '';
          if (rec && rec.blob) u = objectURL(el.dataset.ph, rec.blob);
          else {
            const path = window.CatalogAdmin && CatalogAdmin.overrides && CatalogAdmin.overrides[el.dataset.ph];
            if (path) u = path + (path.includes('?') ? '&' : '?') + 'v=' + CatalogAdmin.overridesStamp;
          }
          if (!u) return;
          const img = el.tagName === 'IMG' ? el : el.querySelector('img');
          if (el.tagName === 'PICTURE') el.querySelectorAll('source').forEach(s => s.remove());
          if (img) { img.removeAttribute('srcset'); img.src = u; }
        } catch (e) {}
      }));
    }
  };
})();
