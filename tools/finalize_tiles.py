#!/usr/bin/env python3
"""Финализация текстур примерочной и галереи. Оригиналы img/ не меняются."""
from __future__ import annotations
import json, re, shutil
from collections import Counter
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = Path('/workspace/catalog-clone')
IMG, IMG2 = ROOT / 'img', ROOT / 'img2'
OUT = Path('/tmp/tilefix')
SHOT = Path('/workspace/catalog-clone-shots/audit')
PREV = json.loads((OUT / 'report.json').read_text())
PREV_BY = {r['art']: r for r in PREV}

COVER_1BASED = {
    'VHP612098': 8, 'VHP612391': 6, 'VHP612390': 6, 'VHP612392': 7, 'VHP612826': 8,
    'VHP612800': 8, 'VHP612039': 4, 'VHP612887': 8, 'VHP612042': 5, 'VHP600806': 7,
    'VHP600157': 1, 'VHP600003': 1, 'VHP600865': 5, 'VHF600818': 5, 'VHF600188': 5,
    'VHP600813': 6, 'VHP600826': 7, 'VHF600822': 8, 'VHF600007': 8, 'VHF600080': 8,
    'VHF600229': 7, 'VHF600227': 7, 'VHP600853': 6,
}

def load_cat():
    txt = (ROOT / 'data.js').read_text()
    return json.loads(re.search(r'window\.CAT\s*=\s*(\{.*\})\s*;\s*$', txt, re.S).group(1)), txt

def fmt_ar(fmt):
    a, b = [int(x) for x in fmt.replace('x', '×').split('×')]
    return min(a, b) / max(a, b)

def imread(path):
    data = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)

def sharpness(bgr):
    if bgr is None or bgr.size == 0:
        return 0
    return float(cv2.Laplacian(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())

def save_tile(bgr, path, long_side=1600):
    h, w = bgr.shape[:2]
    if max(h, w) > long_side:
        s = long_side / max(h, w)
        bgr = cv2.resize(bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(bgr, (0, 0), 1.0)
    bgr = cv2.addWeighted(bgr, 1.2, blur, -0.2, 0)
    rgb = cv2.cvtColor(np.clip(bgr, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    im = Image.fromarray(rgb)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'JPEG', quality=90, optimize=True, progressive=True)
    return im.size

def tighten(im, steps=12):
    for _ in range(steps):
        h, w = im.shape[:2]
        if min(h, w) < 180:
            break
        y0, y1, x0, x1 = h // 5, 4 * h // 5, w // 5, 4 * w // 5
        center = im[y0:y1, x0:x1]
        cmed = np.median(center.reshape(-1, 3), 0)
        cstd = float(center.reshape(-1, 3).std(0).mean())
        bw, bh = max(2, w // 45), max(2, h // 45)
        sides = {
            'l': (im[:, :bw], 'x', 0),
            'r': (im[:, -bw:], 'x', 1),
            't': (im[:bh, :], 'y', 0),
            'b': (im[-bh:, :], 'y', 1),
        }
        trim = {'l': 0, 'r': 0, 't': 0, 'b': 0}
        for k, (s, axis, _) in sides.items():
            smed = np.median(s.reshape(-1, 3), 0)
            sstd = float(s.reshape(-1, 3).std(0).mean())
            dist = float(np.linalg.norm(smed.astype(np.float32) - cmed.astype(np.float32)))
            # однотонный фон, отличающийся от плитки
            if (sstd < max(10, cstd * 0.75) and dist > 16) or (dist > 32 and sstd < 22):
                trim[k] = s.shape[1] if axis == 'x' else s.shape[0]
            # подпись / светлая плашка снизу
            if k == 'b' and smed.mean() > 200 and sstd < 20:
                trim[k] = max(trim[k], s.shape[0])
            # тонкая тёмная кромка (торец плитки)
            if k in ('l', 'r') and smed.mean() + 25 < cmed.mean() and sstd < 22:
                trim[k] = max(trim[k], s.shape[1] if axis == 'x' else s.shape[0])
        if not any(trim.values()):
            break
        ny0, ny1 = trim['t'], h - trim['b']
        nx0, nx1 = trim['l'], w - trim['r']
        if ny1 - ny0 < 160 or nx1 - nx0 < 160:
            break
        im = im[ny0:ny1, nx0:nx1]
    return im

def find_edge_rects(im, want):
    h, w = im.shape[:2]
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    found = []
    for lo, hi, dil, cl in [(20, 60, 1, 5), (30, 90, 1, 7), (15, 50, 2, 9), (25, 80, 1, 5)]:
        edges = cv2.Canny(blur, lo, hi)
        edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=dil)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (cl, cl)))
        for mode in (cv2.RETR_LIST, cv2.RETR_TREE, cv2.RETR_EXTERNAL):
            cnts, _ = cv2.findContours(edges, mode, cv2.CHAIN_APPROX_SIMPLE)
            for c in cnts:
                x, y, bw, bh = cv2.boundingRect(c)
                if min(bw, bh) < 110 or max(bw, bh) < 180:
                    continue
                frac = bw * bh / (w * h)
                if frac < 0.035 or frac > 0.62:
                    continue
                ar = min(bw, bh) / max(bw, bh)
                err = abs(ar - want) / max(want, 1e-6)
                if err > 0.18:
                    if want < 0.7 and bw > 150 and bh > bw * 1.6 and abs((bw / (bh / 2)) - want) / want < 0.18:
                        mid = y + bh // 2
                        found.append((x, y, x + bw, mid, 0.05, frac / 2))
                        found.append((x, mid, x + bw, y + bh, 0.05, frac / 2))
                    continue
                found.append((x, y, x + bw, y + bh, err, frac))
    found.sort(key=lambda t: (t[4], -t[5]))
    keep = []
    for f in found:
        if any(abs(f[0] - k[0]) < 18 and abs(f[1] - k[1]) < 18 and abs(f[2] - k[2]) < 18 and abs(f[3] - k[3]) < 18 for k in keep):
            continue
        keep.append(f)
        if len(keep) >= 8:
            break
    return keep

def crop_quality(crop, want):
    """0..1, выше — лучше. Отсекаем кадры с большим фоном или текстом."""
    if crop is None or crop.size == 0:
        return 0
    h, w = crop.shape[:2]
    ar = min(w, h) / max(w, h)
    err = abs(ar - want) / max(want, 1e-6)
    if err > 0.22:
        return 0
    # доля «чужого» фона по краям
    band = max(4, min(h, w) // 30)
    c = crop[band:h - band, band:w - band]
    if c.size == 0:
        return 0
    cmed = np.median(c.reshape(-1, 3), 0)
    bg_frac = 0
    for s in (crop[:band], crop[-band:], crop[:, :band], crop[:, -band:]):
        dist = np.linalg.norm(s.astype(np.float32) - cmed, axis=2)
        bg_frac += (dist > 28).mean()
    bg_frac /= 4
    sh = sharpness(crop)
    score = 1.0 - err * 1.6 - bg_frac * 1.3 + min(sh, 800) / 4000 + min(h, w) / 4000
    if bg_frac > 0.35:
        score -= 0.5
    return float(score)

def extract_from_photo(path, want):
    im = imread(path)
    if im is None:
        return None
    best = None
    for f in find_edge_rects(im, want):
        x0, y0, x1, y1 = f[:4]
        pad = int(min(x1 - x0, y1 - y0) * 0.012)
        crop = im[y0 + pad:y1 - pad, x0 + pad:x1 - pad]
        crop = tighten(crop)
        if want < 0.7 and crop.shape[1] > crop.shape[0] * 1.1:
            crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
        q = crop_quality(crop, want)
        if best is None or q > best[0]:
            best = (q, crop, str(path))
    return best

def typography_top(im):
    h, w = im.shape[:2]
    g = cv2.cvtColor(im[:int(h * 0.26)], cv2.COLOR_BGR2GRAY)
    # сильные горизонтальные контрасты — заголовки
    edges = cv2.Canny(g, 40, 120)
    rows = edges.mean(1)
    # доля «текстовых» строк
    return float((rows > 12).mean()), float(edges.mean())

def is_dark_chart(im):
    h, w = im.shape[:2]
    bg = np.median(np.concatenate([im[:6].reshape(-1, 3), im[-6:].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)]), 0)
    return bg.mean() < 70 or (h < w * 0.8 and bg.mean() < 90)

def is_room_photo(im):
    small = cv2.resize(im, (80, 80), interpolation=cv2.INTER_AREA)
    var = float(small.astype(np.float32).var())
    # комнаты — богатая фактура, нет огромных ровных полей
    h, w = im.shape[:2]
    edge = np.concatenate([im[:int(h * 0.08)].reshape(-1, 3), im[-int(h * 0.08):].reshape(-1, 3)])
    edge_std = float(edge.std(0).mean())
    return var > 500 and edge_std > 12

def classify(im, want):
    ink, emean = typography_top(im)
    dark = is_dark_chart(im)
    rects = find_edge_rects(im, want)
    good = [r for r in rects if r[4] < 0.16]
    h, w = im.shape[:2]
    band = 8
    edge = np.concatenate([im[:band].reshape(-1, 3), im[-band:].reshape(-1, 3), im[:, :band].reshape(-1, 3), im[:, -band:].reshape(-1, 3)])
    bgmean = float(np.median(edge, 0).mean())
    bgstd = float(edge.std(0).mean())
    if dark:
        return 'chart'
    if len(good) >= 2 and bgmean > 155 and bgstd < 28:
        return 'faces'
    if len(good) == 1 and 0.18 <= good[0][5] <= 0.75 and bgmean > 190 and bgstd < 20 and ink < 0.2:
        return 'product'
    if ink > 0.18 and bgmean > 150 and not is_room_photo(im):
        return 'poster'
    if ink > 0.22 and bgmean > 170:
        return 'poster'
    if is_room_photo(im):
        return 'interior'
    if len(good) == 1 and good[0][5] > 0.2:
        return 'product'
    return 'interior' if ink < 0.15 else 'poster'

def main():
    cat, raw = load_cat()
    report = []
    rewritten = []
    for t in cat['tiles']:
        art, name, fmt = t['art'], t['name'], t['format']
        want = fmt_ar(fmt)
        prev = PREV_BY.get(art, {})
        rec = {'art': art, 'name': name, 'format': fmt, 'surface': t.get('surface'),
               'old_full': bool(t.get('tileFull')), 'old_tile': t.get('tile')}
        photos = t.get('photos') or []
        kinds = []
        if not photos and not t.get('tile'):
            rec.update(status='no_photos', note='нет исходных фото', gallery=[], tile=None, tileFull=False)
            report.append(rec)
            continue

        # классификация для галереи
        meta = []
        for i, ph in enumerate(photos):
            p = IMG / art / f'{ph}.jpg'
            if not p.exists():
                continue
            im = imread(p)
            kind = classify(im, want)
            ink, _ = typography_top(im)
            clip = None
            if kind == 'interior':
                clip = 'logo-frame' if ink > 0.12 else 'logo-bottom'
            meta.append({'id': ph, 'i': i, 'kind': kind, 'clip': clip, 'ink': round(ink, 3)})
        interiors = [p for p in meta if p['kind'] == 'interior']
        products = [p for p in meta if p['kind'] == 'product']
        nph = len(photos)
        default_i = COVER_1BASED.get(art, 5 if nph >= 6 else 1) - 1
        cover = next((p for p in interiors if p['i'] == default_i), None)
        if cover is None:
            cover = interiors[0] if interiors else (products[0] if products else None)
        hover = next((p for p in interiors if cover is None or p['id'] != cover['id']), None)
        if hover is None:
            hover = next((p for p in products if cover is None or p['id'] != cover['id']), None)
        gallery = []
        if cover:
            gallery.append(cover)
        for p in interiors + products:
            if p['id'] not in {g['id'] for g in gallery}:
                gallery.append(p)
        rec['photos'] = meta
        rec['gallery'] = [{'id': p['id'], 'kind': p['kind'], 'clip': p['clip']} for p in gallery]
        rec['cover'] = cover['id'] if cover else None
        rec['hover'] = hover['id'] if hover else None

        # текстура
        cands = []
        # already produced in pass 1
        p1 = OUT / art / 'tile.jpg'
        if p1.exists():
            im = imread(p1)
            im = tighten(im)
            if want < 0.7 and im.shape[1] > im.shape[0] * 1.1:
                im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
            cands.append((crop_quality(im, want), im, f'pass1 {p1}', 'pass1'))
        # edge crops from all photos (especially unfixed / bad pass1)
        for ph in photos:
            got = extract_from_photo(IMG / art / f'{ph}.jpg', want)
            if got and got[0] > 0.35:
                cands.append((got[0], got[1], got[2], 'edge'))
        # existing tile if aspect already correct
        if t.get('tile') and (ROOT / t['tile']).exists():
            im = imread(ROOT / t['tile'])
            im = tighten(im)
            q = crop_quality(im, want)
            if q > 0.4 and abs((min(im.shape[:2]) / max(im.shape[:2])) - want) / want < 0.12:
                cands.append((q * 0.95, im, t['tile'], 'existing'))

        cands.sort(key=lambda x: -x[0])
        if not cands:
            rec.update(status='unfixed', tile=t.get('tile'), tileFull=False,
                       note='нет подходящего целого кадра плитки — оставлен исходник или пусто')
            report.append(rec)
            print(f'{art} {name:24} UNFIXED', flush=True)
            continue
        q, crop, src, how = cands[0]
        ar = min(crop.shape[0], crop.shape[1]) / max(crop.shape[0], crop.shape[1])
        err = abs(ar - want) / want
        full = err <= 0.14 and q >= 0.4
        # сохранить, если лучше текущего или текущий с неверным форматом
        dest_final = IMG2 / art / 'tile.jpg'
        old = imread(ROOT / t['tile']) if t.get('tile') and (ROOT / t['tile']).exists() else None
        old_err = 9
        if old is not None:
            oar = min(old.shape[0], old.shape[1]) / max(old.shape[0], old.shape[1])
            old_err = abs(oar - want) / want
        should = (old is None) or (err + 0.03 < old_err) or (full and old_err > 0.12) or (q > 0.7 and how in ('edge', 'pass1') and err <= old_err)
        if should:
            # write to /tmp then copy
            tmp = OUT / art / 'tile.jpg'
            size = save_tile(crop, tmp)
            rec.update(status='fixed', action='rewrite_tile', tile=f'img2/{art}/tile.jpg',
                       tileFull=full, tile_size=list(size), src=src, how=how,
                       ar_err=round(err, 3), quality=round(q, 3),
                       note=f'целая плитка из {Path(src).name} ({how})')
            rewritten.append(art)
        else:
            rec.update(status='ok', action='keep_tile', tile=t.get('tile'),
                       tileFull=full or (old_err <= 0.12),
                       ar_err=round(old_err, 3), quality=round(q, 3),
                       note='текущая текстура целая, пропорции верные' if old_err <= 0.12 else 'оставлен исходник')
        report.append(rec)
        print(f"{art} {name:24} {rec['status']:8} full={rec.get('tileFull')} q={rec.get('quality')} {rec.get('note','')[:70]}", flush=True)

    (OUT / 'report-final.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))

    # apply rewrites into img2
    applied = 0
    for art in rewritten:
        src = OUT / art / 'tile.jpg'
        dst = IMG2 / art / 'tile.jpg'
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            applied += 1

    # update data.js
    by = {r['art']: r for r in report}
    for t in cat['tiles']:
        r = by[t['art']]
        if r.get('tile'):
            t['tile'] = r['tile']
        t['tileFull'] = bool(r.get('tileFull'))
        t['gallery'] = r.get('gallery') or []
        t['cover'] = r.get('cover')
        t['hover'] = r.get('hover')
    js = '/* Данные каталога. Адрес сайта задаётся в config.js (BASE_URL). */\nwindow.CAT=' + json.dumps(cat, ensure_ascii=False) + ';\n'
    (ROOT / 'data.js').write_text(js)

    # markdown report
    lines = ['# Аудит текстур примерочной\n']
    st = Counter(r['status'] for r in report)
    lines.append(f"Всего артикулов: {len(report)}. Исправлено: {st.get('fixed',0)}, уже были в порядке: {st.get('ok',0)}, без фото: {st.get('no_photos',0)}, не удалось найти целый кадр: {st.get('unfixed',0)}.\n")
    for key, title in [('fixed', 'Исправлены'), ('ok', 'Без изменений (пропорции верные)'), ('unfixed', 'Не удалось исправить'), ('no_photos', 'Нет фото')]:
        chunk = [r for r in report if r['status'] == key]
        lines.append(f'\n## {title} ({len(chunk)})\n')
        for r in chunk:
            gal = len(r.get('gallery') or [])
            lines.append(f"- **{r['art']} {r['name']}** ({r['format']}): {r.get('note','—')}; full={r.get('tileFull')}; фото в галерее: {gal}")
    (SHOT / 'sku-report.md').write_text('\n'.join(lines) + '\n')

    # contact of all final tiles
    tiles = [r for r in report if r.get('tile') and (ROOT / r['tile']).exists()]
    cols = 10
    tw = 150
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, max(1, rows) * (tw + 36)), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, r in enumerate(tiles):
        im = Image.open(ROOT / r['tile'])
        im.thumbnail((tw - 6, tw - 6))
        x, y = (i % cols) * tw, (i // cols) * (tw + 36)
        sheet.paste(im, (x + (tw - im.width) // 2, y + 2))
        mark = 'F' if r.get('tileFull') else 'x'
        dr.text((x + 2, y + tw - 2), f"{r['art'][-6:]} {mark}", fill=(220, 220, 220))
    sheet.save(SHOT / 'tiles-final.jpg', quality=88)

    print('\n=== SUMMARY ===')
    print(dict(st), 'rewritten', applied)
    print('unfixed', [r['art'] for r in report if r['status'] == 'unfixed'])
    print('empty gallery with photos', [r['art'] for r in report if r.get('photos') and not r.get('gallery')])
    print('wrote data.js, report, sheets')

if __name__ == '__main__':
    main()
