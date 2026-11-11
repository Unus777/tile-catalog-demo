#!/usr/bin/env python3
"""Аудит и исправление текстур примерочной + классификация фото для белой витрины.
Оригиналы в img/ не меняются. Новые tile.jpg пишутся в OUT_TILES, затем переносятся в img2.
"""
from __future__ import annotations
import json, re, sys, shutil
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('/workspace/catalog-clone')
IMG = ROOT / 'img'
IMG2 = ROOT / 'img2'
TPL = ROOT / 'tools' / 'brand-tpl'
OUT = Path('/tmp/tilefix')
SHOT = Path('/workspace/catalog-clone-shots/audit')
OUT.mkdir(parents=True, exist_ok=True)
SHOT.mkdir(parents=True, exist_ok=True)

COVER_1BASED = {
    'VHP612098': 8, 'VHP612391': 6, 'VHP612390': 6, 'VHP612392': 7, 'VHP612826': 8,
    'VHP612800': 8, 'VHP612039': 4, 'VHP612887': 8, 'VHP612042': 5, 'VHP600806': 7,
    'VHP600157': 1, 'VHP600003': 1, 'VHP600865': 5, 'VHF600818': 5, 'VHF600188': 5,
    'VHP600813': 6, 'VHP600826': 7, 'VHF600822': 8, 'VHF600007': 8, 'VHF600080': 8,
    'VHF600229': 7, 'VHF600227': 7, 'VHP600853': 6,
}

def load_cat():
    txt = (ROOT / 'data.js').read_text()
    return json.loads(re.search(r'window\.CAT\s*=\s*(\{.*\})\s*;\s*$', txt, re.S).group(1))

def fmt_ar(fmt: str):
    a, b = [int(x) for x in fmt.replace('x', '×').split('×')]
    return min(a, b) / max(a, b), a, b  # want short/long, w_cm, h_cm

def imread(path):
    data = np.fromfile(str(path), dtype=np.uint8)
    im = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return im

def to_pil(bgr):
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

def sharpness(bgr):
    if bgr is None or bgr.size == 0:
        return 0
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())

def edge_bg(im, band=6):
    h, w = im.shape[:2]
    parts = [im[:band].reshape(-1, 3), im[-band:].reshape(-1, 3),
             im[:, :band].reshape(-1, 3), im[:, -band:].reshape(-1, 3)]
    edge = np.concatenate(parts, 0)
    return np.median(edge, 0), float(edge.std(0).mean())

def logo_templates():
    # Только характерные знаки — полный набор шаблонов слишком медленный.
    names = ['logo-diamond.png', 'bot-almaly-ru-plain.png', 'top-almaly-ru-center.png',
             'bot-almaly-ru-lines.png', 'VHJ600005-bottom-almali.png']
    tpls = []
    for n in names:
        p = TPL / n
        if not p.exists():
            continue
        im = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if im is None or min(im.shape) < 12:
            continue
        tpls.append((p.stem, im))
    return tpls

TPLS = logo_templates()

def has_brand(im, region='any'):
    """Быстрый поиск логотипа: уменьшаем кадр и проверяем верх/низ."""
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    h0, w0 = gray.shape
    scale = 480 / max(h0, w0)
    if scale < 1:
        gray = cv2.resize(gray, (int(w0 * scale), int(h0 * scale)), interpolation=cv2.INTER_AREA)
    h, w = gray.shape
    strips = []
    if region in ('any', 'top'):
        strips.append((0, gray[:int(h * 0.34), :]))
    if region in ('any', 'bottom'):
        y0 = int(h * 0.68)
        strips.append((y0, gray[y0:, :]))
    if region == 'any':
        # середина редко содержит логотип каталога — пропускаем ради скорости
        pass
    best = 0.0
    by = 0.5
    for yoff, strip in strips:
        gh, gw = strip.shape
        for name, tpl in TPLS:
            th, tw = tpl.shape
            for sc in (0.25, 0.4, 0.6, 0.85, 1.1):
                rw, rh = int(tw * sc * scale if scale < 1 else tw * sc), int(th * sc * (scale if scale < 1 else 1))
                if rw < 14 or rh < 14 or rw >= gw or rh >= gh:
                    continue
                t = cv2.resize(tpl, (rw, rh), interpolation=cv2.INTER_AREA)
                try:
                    r = cv2.matchTemplate(strip, t, cv2.TM_CCOEFF_NORMED)
                except cv2.error:
                    continue
                _, mx, _, loc = cv2.minMaxLoc(r)
                if mx > best:
                    best = float(mx)
                    by = (loc[1] + yoff + rh / 2) / h
    return best >= 0.58, best, by

def find_rects(im, want_ar, min_frac=0.04, max_frac=0.92):
    """Find axis-aligned rectangles that look like face-on tiles on a studio backdrop."""
    h, w = im.shape[:2]
    bg, bgstd = edge_bg(im, 8)
    # allow cream/white/light gray backdrops
    if bg.mean() < 140:
        return []
    diff = np.max(np.abs(im.astype(np.int16) - bg.astype(np.int16)), axis=2)
    # adaptive threshold: stronger if backdrop is clean
    thr = 18 if bgstd < 12 else 26
    mask = (diff > thr).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, w // 200), max(3, h // 200)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < min_frac * w * h or area > max_frac * w * h:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        if bw < 80 or bh < 80:
            continue
        rect_area = bw * bh
        extent = area / max(rect_area, 1)
        if extent < 0.82:
            continue
        ar = min(bw, bh) / max(bw, bh)
        ar_err = min(abs(ar - want_ar) / max(want_ar, 1e-6),
                     abs(ar - 1) / 1.0 if abs(want_ar - 1) < 0.08 else 9)
        # For 60x120 we require close to 1:2, not squares
        if want_ar < 0.7:
            ar_err = abs(ar - want_ar) / want_ar
            if ar_err > 0.18:
                continue
        else:
            if abs(ar - 1) > 0.12:
                continue
            ar_err = abs(ar - 1)
        # almost rectangular
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.03 * peri, True)
        if len(approx) < 4 or len(approx) > 8:
            continue
        # inset to drop shadow / AA fringe
        pad = int(min(bw, bh) * 0.018)
        x0, y0, x1, y1 = x + pad, y + pad, x + bw - pad, y + bh - pad
        if x1 - x0 < 70 or y1 - y0 < 70:
            continue
        crop = im[y0:y1, x0:x1]
        # reject nearly-empty (failed mask) unless the tile itself is uniform:
        # use edge density inside
        g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(g, 40, 120)
        ed = edges.mean()
        sh = sharpness(crop)
        # Text blocks have very high local contrast and many small components — mild filter
        out.append({
            'box': (x0, y0, x1, y1), 'ar': ar, 'ar_err': ar_err,
            'area_frac': (x1 - x0) * (y1 - y0) / (w * h),
            'extent': extent, 'sharp': sh, 'edge': float(ed),
            'crop': crop, 'wh': (x1 - x0, y1 - y0),
        })
    out.sort(key=lambda r: (-min(r['wh']), r['ar_err'], -r['sharp']))
    return out

def normalize_orient(crop, want_ar):
    """Portrait for 60×120 (h > w); square stays."""
    h, w = crop.shape[:2]
    if want_ar < 0.7 and w > h * 1.1:
        crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
    return crop

def save_tile(bgr, path, long_side=1600):
    h, w = bgr.shape[:2]
    scale = long_side / max(h, w)
    if scale < 1:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    # very light unsharp
    blur = cv2.GaussianBlur(bgr, (0, 0), 1.0)
    bgr = cv2.addWeighted(bgr, 1.25, blur, -0.25, 0)
    rgb = cv2.cvtColor(np.clip(bgr, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    im = Image.fromarray(rgb)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, 'JPEG', quality=90, optimize=True, progressive=True)
    return im.size

def classify_photo(im, want_ar, art, idx, ph):
    """Return kind: product | interior | poster | faces | chart."""
    h, w = im.shape[:2]
    bg, bgstd = edge_bg(im, 8)
    rects = find_rects(im, want_ar, min_frac=0.03, max_frac=0.88)
    brand, bscore, by = has_brand(im, 'any')
    # product: 1 dominant studio tile, light clean backdrop, tile 25–85% of frame
    good = [r for r in rects if r['ar_err'] < 0.15]
    if (bg.mean() > 200 and bgstd < 18 and len(good) == 1
            and 0.25 <= good[0]['area_frac'] <= 0.88 and bscore < 0.72):
        return 'product', good, brand, bscore
    if len(good) >= 2 and bg.mean() > 160:
        # several face-on tiles on a studio sheet
        return 'faces', good, brand, bscore
    # chart / lighting comparison: dark background or many similar small tiles in a row
    if bg.mean() < 80 or (len(rects) >= 3 and h < w * 0.85):
        # wide dark "lighting" boards
        if bg.mean() < 70:
            return 'chart', rects, brand, bscore
    # poster: brand + relatively clean studio margins + typography-heavy top
    # heuristic typography: horizontal projection of high-contrast edges in top 28%
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    top = g[:int(h * 0.28)]
    # binarize and count ink
    _, bw = cv2.threshold(top, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # ink as minority
    ink = min((bw == 0).mean(), (bw == 255).mean())
    # posters usually have a large title (ink 0.08–0.35 in top) and brand
    if (brand and ink > 0.06 and bg.mean() > 150) or (ink > 0.12 and bgstd < 20 and bg.mean() > 170 and len(good) <= 1 and good and good[0]['area_frac'] < 0.55):
        return 'poster', good, brand, bscore
    # interiors: photographic, complex
    # if brand mostly at the bottom → interior with logo
    if brand and by > 0.7:
        return 'interior', rects, brand, bscore
    # photographic complexity: high unique colors / mid-frequency energy
    small = cv2.resize(im, (64, 64), interpolation=cv2.INTER_AREA)
    var = small.astype(np.float32).var()
    if var > 400:
        return 'interior', rects, brand, bscore
    if good and good[0]['area_frac'] > 0.35:
        return 'product', good, brand, bscore
    if brand:
        return 'poster', good, brand, bscore
    return 'interior', rects, brand, bscore

def score_existing(path, want_ar):
    if not path.exists():
        return None
    im = imread(path)
    if im is None:
        return None
    h, w = im.shape[:2]
    ar = min(w, h) / max(w, h)
    ar_err = abs(ar - want_ar) / max(want_ar, 1e-6)
    sh = sharpness(im)
    return {'w': w, 'h': h, 'ar': ar, 'ar_err': ar_err, 'sharp': sh, 'min': min(w, h), 'im': im}

def pick_tile_for(t):
    art, fmt = t['art'], t['format']
    want, *_ = fmt_ar(fmt)
    photos = t.get('photos') or []
    candidates = []  # dicts with crop, score, src, reason

    def add(crop, src, reason, base=0):
        crop = normalize_orient(crop, want)
        h, w = crop.shape[:2]
        ar = min(w, h) / max(w, h)
        ar_err = abs(ar - want) / max(want, 1e-6)
        if ar_err > 0.2:
            return
        sh = sharpness(crop)
        # prefer larger, sharper, better aspect
        score = base + min(w, h) * 0.5 + sh * 0.15 - ar_err * 400
        candidates.append({
            'crop': crop, 'src': src, 'reason': reason, 'score': score,
            'w': w, 'h': h, 'ar': ar, 'ar_err': ar_err, 'sharp': sh,
        })

    photo_meta = []
    for i, ph in enumerate(photos):
        p = IMG / art / f'{ph}.jpg'
        if not p.exists():
            continue
        im = imread(p)
        if im is None:
            continue
        kind, rects, brand, bscore = classify_photo(im, want, art, i, ph)
        photo_meta.append({
            'id': ph, 'i': i, 'kind': kind, 'brand': brand, 'bscore': round(bscore, 3),
            'size': list(im.shape[1::-1]), 'nrects': len(rects),
        })
        if kind in ('product', 'faces') and rects:
            # pick best rect
            good = [r for r in rects if r['ar_err'] < 0.15]
            use = good or rects
            # for faces, pick the sharpest reasonably large one
            use = sorted(use, key=lambda r: (-r['sharp'] * (r['wh'][0] * r['wh'][1]) ** 0.5, r['ar_err']))
            best = use[0]
            base = 800 if kind == 'product' else 500
            add(best['crop'], f'img/{art}/{ph}.jpg', f'{kind} rect {best["wh"][0]}×{best["wh"][1]}', base=base)

    # existing tile / face as fallback
    for label, path in (('tile', ROOT / t['tile'] if t.get('tile') else None),
                        ('face', ROOT / (t['face'][-1][1] + '.jpg') if t.get('face') else None)):
        if not path or not path.exists():
            continue
        rec = score_existing(path, want)
        if not rec:
            continue
        if rec['ar_err'] <= 0.12 and rec['min'] >= 280:
            add(rec['im'], str(path.relative_to(ROOT)), f'existing {label}', base=200 if label == 'tile' else 100)

    candidates.sort(key=lambda c: -c['score'])
    return photo_meta, candidates

def contact_pair(old, new, label, tw=220):
    def thumb(im, tw=tw, th=None):
        if im is None:
            canv = Image.new('RGB', (tw, tw), (40, 40, 40))
            return canv
        if not isinstance(im, Image.Image):
            im = to_pil(im)
        im = im.copy()
        th = th or (int(tw * im.height / im.width) if im.width else tw)
        im.thumbnail((tw, 320))
        return im
    a, b = thumb(old), thumb(new)
    h = max(a.height, b.height)
    sheet = Image.new('RGB', (tw * 2 + 16, h + 36), (24, 24, 24))
    sheet.paste(a, (4, 20 + (h - a.height) // 2))
    sheet.paste(b, (tw + 12, 20 + (h - b.height) // 2))
    dr = ImageDraw.Draw(sheet)
    dr.text((4, 2), 'было', fill=(180, 180, 180))
    dr.text((tw + 12, 2), 'стало  ' + label, fill=(180, 220, 180))
    return sheet

def main():
    cat = load_cat()
    report = []
    pairs = []
    for t in cat['tiles']:
        art, name, fmt = t['art'], t['name'], t['format']
        want, *_ = fmt_ar(fmt)
        rec = {
            'art': art, 'name': name, 'format': fmt, 'surface': t.get('surface'),
            'had_tile': bool(t.get('tile')), 'had_full': bool(t.get('tileFull')),
        }
        if not t.get('photos') and not t.get('tile'):
            rec.update(status='no_photos', photos=[], action='none', note='нет исходных фото')
            report.append(rec)
            continue
        photo_meta, cands = pick_tile_for(t)
        rec['photos'] = [{k: v for k, v in p.items()} for p in photo_meta]
        # gallery selection
        interiors = [p for p in photo_meta if p['kind'] == 'interior']
        products = [p for p in photo_meta if p['kind'] == 'product']
        # cover from dealer map among interiors, else first interior, else first product
        nph = len(t.get('photos') or [])
        default_cover_i = (COVER_1BASED.get(art, 5 if nph >= 6 else 1) - 1)
        cover = None
        for p in interiors:
            if p['i'] == default_cover_i:
                cover = p
                break
        if cover is None:
            cover = interiors[0] if interiors else (products[0] if products else None)
        hover = None
        rest_int = [p for p in interiors if cover is None or p['id'] != cover['id']]
        if rest_int:
            hover = rest_int[0]
        elif products and (cover is None or products[0]['id'] != (cover or {}).get('id')):
            hover = products[0]
        gallery = []
        if cover:
            gallery.append(cover)
        for p in interiors + products:
            if p['id'] not in {g['id'] for g in gallery}:
                gallery.append(p)
        rec['gallery'] = [{'id': p['id'], 'kind': p['kind'], 'clip': 'logo-bottom' if p['kind'] == 'interior' and p.get('brand') else None} for p in gallery]
        rec['cover'] = cover['id'] if cover else None
        rec['hover'] = hover['id'] if hover else None

        old_path = ROOT / t['tile'] if t.get('tile') else None
        old_im = imread(old_path) if old_path and old_path.exists() else None
        old_sc = score_existing(old_path, want) if old_path else None

        if not cands:
            rec.update(status='unfixed', action='keep_or_none',
                       note='нет подходящего целого кадра плитки', tileFull=False)
            if old_sc:
                rec['tile'] = t['tile']
                rec['tile_size'] = [old_sc['w'], old_sc['h']]
                rec['ar_err'] = round(old_sc['ar_err'], 3)
            report.append(rec)
            continue

        best = cands[0]
        # decide whether to replace
        replace = True
        reason = best['reason']
        if old_sc and old_sc['ar_err'] <= 0.08 and old_sc['min'] >= 500 and best['src'].endswith('tile.jpg'):
            replace = False
            reason = 'текущая текстура уже целая, пропорции верные'
        elif old_sc and old_sc['ar_err'] <= best['ar_err'] + 0.02 and old_sc['min'] >= best['w'] * 0.9 and old_sc['min'] >= 500 and 'existing' in best['reason']:
            replace = False
            reason = 'текущая текстура не хуже найденного исходника'

        rec['chosen'] = {'src': best['src'], 'reason': best['reason'], 'size': [best['w'], best['h']],
                         'ar': round(best['ar'], 3), 'ar_err': round(best['ar_err'], 3), 'sharp': round(best['sharp'], 1)}
        rec['tileFull'] = best['ar_err'] <= 0.12
        dest = OUT / art / 'tile.jpg'
        if replace and 'existing tile' not in best['reason']:
            size = save_tile(best['crop'], dest)
            rec.update(status='fixed', action='rewrite_tile', tile=f'img2/{art}/tile.jpg',
                       tile_size=list(size), note=reason, new_file=str(dest))
            pairs.append((art, name, fmt, old_im, best['crop'], reason))
        else:
            # still copy current to out if we only confirm tileFull
            rec.update(status='ok' if rec['tileFull'] else 'partial',
                       action='keep_tile', tile=t.get('tile'),
                       tile_size=[old_sc['w'], old_sc['h']] if old_sc else None,
                       note=reason)
            if old_im is not None and rec['tileFull'] and (not old_sc or old_sc['ar_err'] > 0.01):
                # re-orient / light trim already good tiles? keep as-is
                pass
        report.append(rec)
        print(f"{art} {name:24} {fmt} {rec['status']:8} full={rec.get('tileFull')} {rec.get('note','')[:80]}", flush=True)

    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    # contact sheets: new tiles and old-vs-new
    fixed = [r for r in report if r.get('action') == 'rewrite_tile']
    print('\n--- summary ---')
    from collections import Counter
    print(Counter(r['status'] for r in report))
    print('rewrite', len(fixed), 'unfixed', sum(1 for r in report if r['status'] == 'unfixed'))
    print('gallery tiles', sum(1 for r in report if r.get('gallery')))

    # classification sheet: kinds counts
    kinds = Counter()
    for r in report:
        for p in r.get('photos') or []:
            kinds[p['kind']] += 1
    print('photo kinds', kinds)

    # visual sheets
    cols = 8
    cells = pairs
    if cells:
        tw = 200
        # each pair is 2 thumbs side by side under a label — make a grid of pairs
        rows = (len(cells) + cols - 1) // cols
        cellw, cellh = tw * 2 + 10, 360
        sheet = Image.new('RGB', (cols * cellw, rows * cellh), (18, 18, 18))
        dr = ImageDraw.Draw(sheet)
        for i, (art, name, fmt, old, new, reason) in enumerate(cells):
            pair = contact_pair(old, new, f'{art} {fmt}', tw=tw)
            x, y = (i % cols) * cellw, (i // cols) * cellh
            sheet.paste(pair, (x, y))
            dr.text((x + 4, y + pair.height + 2), f'{name}', fill=(220, 220, 220))
        sheet.save(SHOT / 'tiles-before-after.jpg', quality=85)
        print('wrote', SHOT / 'tiles-before-after.jpg')

    # all new tiles sheet
    news = list((OUT).glob('*/tile.jpg'))
    if news:
        tw = 150
        cols = 10
        rows = (len(news) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * tw, rows * (tw + 36)), (20, 20, 20))
        dr = ImageDraw.Draw(sheet)
        for i, p in enumerate(sorted(news)):
            im = Image.open(p)
            im.thumbnail((tw - 6, tw - 6))
            x, y = (i % cols) * tw, (i // cols) * (tw + 36)
            sheet.paste(im, (x + (tw - im.width) // 2, y + 2))
            dr.text((x + 2, y + tw - 2), p.parent.name, fill=(220, 220, 220))
        sheet.save(SHOT / 'tiles-new.jpg', quality=85)
        print('wrote', SHOT / 'tiles-new.jpg', 'n', len(news))

if __name__ == '__main__':
    main()
