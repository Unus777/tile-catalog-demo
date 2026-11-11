/* Подставляет название и контакты из config.js. */
(() => {
  const C = window.CATALOG_CONFIG || {};
  const name = C.NAME || 'Каталог плитки';
  const tag = C.TAGLINE || 'Каталог керамогранита';
  const legal = C.LEGAL_NAME || name;
  const desc = C.DESCRIPTION || (name + ': форматы 60×60 и 60×120, интерьерные фото.');
  const digits = s => String(s || '').replace(/[^\d+]/g, '');
  const waHref = s => { const d = String(s || '').replace(/\D/g, ''); return d ? 'https://wa.me/' + d : ''; };
  const titles = {
    index: name + ' — ' + tag,
    prices: 'Цены — редактор — ' + name,
    edit: 'Редактор фото — ' + name,
    admin: 'Вход для администраторов — ' + name
  };

  const THEME_KEY = 'catalog-theme';
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function setTheme(t) {
    t = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0d0c0b' : '#F1EADF');
    document.querySelectorAll('#themeBtn').forEach(btn => {
      const dark = t === 'dark';
      btn.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
      btn.setAttribute('title', dark ? 'Светлая тема' : 'Тёмная тема');
    });
  }
  function bindTheme() {
    const btn = document.getElementById('themeBtn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
    setTheme(currentTheme());
  }

  function apply() {
    bindTheme();
    const page = document.body && document.body.dataset.page;
    if (page && titles[page]) document.title = titles[page];
    const md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', desc);

    document.querySelectorAll('.logo').forEach(a => a.setAttribute('aria-label', name + ', на главную'));
    document.querySelectorAll('.logo .w').forEach(el => {
      el.textContent = '';
      el.append(document.createTextNode(name));
      const s = document.createElement('small');
      s.textContent = tag;
      el.append(s);
    });
    document.querySelectorAll('[data-brand="legal"]').forEach(el => { el.textContent = legal; });
    document.querySelectorAll('[data-cfg="hero-eyebrow"]').forEach(el => { el.textContent = C.ADDRESS || tag; });
    document.querySelectorAll('[data-cfg="hero-lead"]').forEach(el => { el.textContent = C.LEAD || desc; });
    document.querySelectorAll('[data-cfg="showroom-text"]').forEach(el => {
      el.textContent = C.ADDRESS
        ? (C.ADDRESS + (C.HOURS ? '. ' + C.HOURS + '.' : '.') + ' Подберём модель под ваш интерьер, посчитаем упаковки и доставку.')
        : 'Подберём модель под ваш интерьер и посчитаем упаковки. Контакты и адрес можно указать в config.js.';
    });

    const phone = C.PHONE || '', phone2 = C.PHONE2 || '', wa = C.WHATSAPP || '', email = C.EMAIL || '';
    document.querySelectorAll('a.tel, a[data-cfg="phone"]').forEach(el => {
      if (phone) { el.hidden = false; el.href = 'tel:' + digits(phone); if (el.classList.contains('tel') || el.dataset.cfg === 'phone' && !el.classList.contains('btn') && !el.classList.contains('icon-btn') && !el.classList.contains('call')) el.textContent = phone; }
      else { el.hidden = true; el.removeAttribute('href'); }
    });
    document.querySelectorAll('a.call, a[data-cfg="phone-icon"]').forEach(el => {
      if (phone) { el.hidden = false; el.href = 'tel:' + digits(phone); }
      else { el.hidden = true; }
    });
    document.querySelectorAll('a[data-cfg="phone2"]').forEach(el => {
      if (phone2) { el.hidden = false; el.href = 'tel:' + digits(phone2); el.textContent = phone2; }
      else { el.hidden = true; }
    });
    document.querySelectorAll('a.wa, a[data-cfg="whatsapp"]').forEach(el => {
      if (wa) { el.hidden = false; el.href = waHref(wa); }
      else { el.hidden = true; el.removeAttribute('href'); }
    });
    document.querySelectorAll('a[data-cfg="email"]').forEach(el => {
      if (email) { el.hidden = false; el.href = 'mailto:' + email; el.textContent = email; }
      else { el.hidden = true; }
    });
    document.querySelectorAll('a[data-cfg="dealers"]').forEach(el => {
      if (C.DEALERS_URL) { el.hidden = false; el.href = C.DEALERS_URL; }
      else { el.hidden = true; }
    });
    document.querySelectorAll('[data-cfg="hours"]').forEach(el => {
      if (C.HOURS) { el.hidden = false; el.textContent = /час/i.test(C.HOURS) ? C.HOURS : 'Часы работы: ' + C.HOURS; }
      else { el.hidden = true; }
    });
    const line = document.querySelector('[data-cfg="footer-line"]');
    if (line) {
      const bits = [];
      if (C.ADDRESS) bits.push(C.ADDRESS);
      if (phone) bits.push('<a href="tel:' + digits(phone) + '">' + phone + '</a>');
      if (phone2) bits.push('<a href="tel:' + digits(phone2) + '">' + phone2 + '</a>');
      if (C.HOURS) bits.push(C.HOURS);
      if (bits.length) { line.hidden = false; line.innerHTML = bits.join(' · '); }
      else { line.hidden = true; line.textContent = ''; }
    }
    const hasCall = !!(phone || wa);
    document.querySelectorAll('.callbar').forEach(el => { el.hidden = !hasCall; });
    document.body.classList.toggle('nocall', !hasCall);
    document.querySelectorAll('[data-cfg="showroom-ctas"]').forEach(el => { el.hidden = !hasCall && !phone; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.applyCatalogBrand = apply;
})();
