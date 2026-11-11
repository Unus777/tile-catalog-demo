#!/usr/bin/env python3
"""Download Ozon primary images, cover brand marks, write poster srcset, patch data.js."""
from __future__ import annotations
import json, re, hashlib, concurrent.futures, urllib.request, time
from pathlib import Path
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TPL = Path(__file__).resolve().parent / 'brand-tpl'
OZON = Path('/tmp/ozon-images.json')
RAW = Path('/tmp/ozon-primaries')
PREV = Path('/tmp/poster-preview')
RAW.mkdir(exist_ok=True)
PREV.mkdir(exist_ok=True)

SIZES = (560, 900, 1200)
UA = 'Mozilla/5.0 (compatible; catalog-clone/1.0)'

# words that must not remain on white-label posters
BRAND_RE = re.compile(r'алмал|almaly|almali|almaly.?ceramic', re.I)

def load_cat():
    s = (ROOT / 'data.js').read_text()
    i = s.find('{')
    return s[:i], json.loads(s[i:].rstrip().rstrip(';'))

def ahash(im: Image.Image, size=16) -> int:
    g = im.convert('L').resize((size, size), Image.Resampling.LANCZOS)
    a = np.array(g, dtype=np.float32)
    bits = (a > a.mean()).flatten()
    h = 0
    for b in bits:
        h = (h << 1) | int(b)
    return h

def ham(a, b):
    return (a ^ b).bit_count()

def download(url: str, dest: Path, timeout=40) -> bool:
    if dest.exists() and dest.stat().st_size > 2000:
        return True
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://www.ozon.ru/'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if len(data) < 1000:
            return False
        dest.write_bytes(data)
        return True
    except Exception as e:
        print('DL fail', dest.name, url, e)
        return False

def load_templates():
    tpls = []
    for p in sorted(TPL.glob('*.png')):
        im = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        if im is None:
            continue
        tpls.append((p.stem, im))
    return tpls

def match_templates(gray, tpls, thresh=0.58):
    """Return list of (x,y,w,h,score,name) after NMS.
    Search only top/bottom bands on a modest-width copy; scale step is tight
    because CCOEFF_NORMED on these marks falls off sharply away from 1.0.
    """
    H0, W0 = gray.shape
    # downscale for speed, keep aspect
    max_w = 900
    k = min(1.0, max_w / W0)
    if k < 1:
        g0 = cv2.resize(gray, (int(W0 * k), int(H0 * k)), interpolation=cv2.INTER_AREA)
    else:
        g0 = gray
    Hs, Ws = g0.shape
    band = max(40, int(0.24 * Hs))
    regions = [(0, 0, g0[:band, :]), (0, Hs - band, g0[-band:, :])]
    boxes = []
    scales = [i / 100 for i in range(25, 131, 2)]  # 0.25 .. 1.30 step 0.02
    for name, tpl in tpls:
        th, tw = tpl.shape
        for scale in scales:
            rw, rh = int(tw * scale * k), int(th * scale * k)
            if rw < 22 or rh < 14 or rw >= Ws or rh >= band + 2:
                continue
            t = cv2.resize(tpl, (rw, rh), interpolation=cv2.INTER_AREA if scale * k < 1 else cv2.INTER_CUBIC)
            for xoff, yoff, reg in regions:
                if reg.shape[0] <= rh or reg.shape[1] <= rw:
                    continue
                res = cv2.matchTemplate(reg, t, cv2.TM_CCOEFF_NORMED)
                minv, maxv, minl, maxl = cv2.minMaxLoc(res)
                if maxv >= thresh:
                    x, y = maxl
                    boxes.append((int((x + xoff) / k), int((y + yoff) / k), int(rw / k), int(rh / k), float(maxv), name))
    # NMS
    boxes.sort(key=lambda b: -b[4])
    kept = []
    for b in boxes:
        x, y, w, h, s, n = b
        ok = True
        for k in kept:
            ix0, iy0 = max(x, k[0]), max(y, k[1])
            ix1, iy1 = min(x + w, k[0] + k[2]), min(y + h, k[1] + k[3])
            inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
            union = w * h + k[2] * k[3] - inter
            if union and inter / union > 0.35:
                ok = False
                break
        if ok:
            kept.append(b)
    return kept

def cover_brand(bgr, tpls):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hits = match_templates(gray, tpls)
    if not hits:
        return bgr, []
    mask = np.zeros(gray.shape, np.uint8)
    H, W = gray.shape
    used = []
    for x, y, w, h, s, n in hits:
        cy = y + h / 2
        in_top = cy <= 0.13 * H
        in_bot = cy >= 0.78 * H
        if not (in_top or in_bot):
            continue
        # stricter score at the top, where product titles live
        if in_top and s < 0.64:
            continue
        pad = max(6, int(0.08 * max(w, h)))
        # less padding downward from top hits so we don't smear the title
        pad_y1 = pad if in_bot else max(4, pad // 2)
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(W, x + w + pad), min(H, y + h + pad_y1)
        # do not allow a hit to cover more than 22% of the image (would eat the tile)
        if (x1 - x0) * (y1 - y0) > 0.22 * W * H:
            continue
        cv2.rectangle(mask, (x0, y0), (x1, y1), 255, -1)
        used.append({'name': n, 'score': round(s, 3), 'box': [x0, y0, x1, y1]})
    if not used:
        return bgr, []
    # soften mask edges
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    out = cv2.inpaint(bgr, mask, 7, cv2.INPAINT_TELEA)
    return out, used

def save_srcset(im: Image.Image, art: str):
    dest = ROOT / 'img2' / art
    dest.mkdir(parents=True, exist_ok=True)
    # keep original aspect (typically 3:4)
    entries = []
    for w in SIZES:
        if im.width < w * 0.85 and entries:
            continue
        h = max(1, round(im.height * w / im.width))
        r = im.resize((w, h), Image.Resampling.LANCZOS)
        if r.mode != 'RGB':
            r = r.convert('RGB')
        stem = dest / f'poster-{w}'
        r.save(stem.with_suffix('.jpg'), 'JPEG', quality=88, optimize=True, subsampling=0)
        r.save(stem.with_suffix('.webp'), 'WEBP', quality=82, method=4)
        entries.append([w, f'img2/{art}/poster-{w}'])
    return entries

def find_local(art: str, target: Image.Image):
    """Closest local photo by aHash, if reasonably close."""
    th = ahash(target)
    best = None
    folders = [ROOT / 'img' / art, ROOT / 'img2' / art]
    for folder in folders:
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if f.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'}:
                continue
            if '_t' in f.name:
                continue
            try:
                im = Image.open(f)
                d = ham(th, ahash(im))
            except Exception:
                continue
            if best is None or d < best[0]:
                best = (d, str(f.relative_to(ROOT)), im.size)
    return best

def main():
    meta = json.loads(OZON.read_text())
    prefix, cat = load_cat()
    tpls = load_templates()
    print('templates', [t[0] for t in tpls])

    # download
    jobs = []
    for t in cat['tiles']:
        art = t['art']
        info = meta.get(art) or {}
        url = info.get('primary') or (info.get('images') or [None])[0]
        if not url:
            continue
        jobs.append((art, url, RAW / f'{art}.jpg'))
    print('to download', len(jobs))
    ok_dl = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download, url, dest): art for art, url, dest in jobs}
        for fut in concurrent.futures.as_completed(futs):
            art = futs[fut]
            if fut.result():
                ok_dl += 1
            else:
                print('missing download', art)
    print('downloaded', ok_dl)

    report = {'ok': [], 'no_ozon': [], 'no_match_brand': [], 'failed': [], 'used_images0': []}
    poster_count = 0

    for t in cat['tiles']:
        art = t['art']
        info = meta.get(art) or {}
        url = info.get('primary')
        src_kind = 'primary'
        if not url and (info.get('images') or [None])[0]:
            url = info['images'][0]
            src_kind = 'images0'
        dest = RAW / f'{art}.jpg'
        if not url or not dest.exists() or dest.stat().st_size < 2000:
            t.pop('poster', None)
            report['no_ozon'].append({'art': art, 'name': t['name'], 'reason': 'no primary/images on Ozon'})
            continue
        try:
            im = Image.open(dest).convert('RGB')
        except Exception as e:
            t.pop('poster', None)
            report['failed'].append({'art': art, 'error': str(e)})
            continue
        local = find_local(art, im)
        bgr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
        covered, hits = cover_brand(bgr, tpls)
        out = Image.fromarray(cv2.cvtColor(covered, cv2.COLOR_BGR2RGB))
        entries = save_srcset(out, art)
        t['poster'] = entries
        poster_count += 1
        rec = {
            'art': art, 'name': t['name'], 'src': src_kind, 'url': url,
            'ozon_size': list(im.size), 'hits': hits,
            'local': {'dist': local[0], 'file': local[1], 'size': list(local[2])} if local else None,
        }
        if src_kind == 'images0':
            report['used_images0'].append(rec)
        if not hits:
            report['no_match_brand'].append(rec)
        else:
            report['ok'].append(rec)
        # preview first 12 and any without hits
        if len(list(PREV.glob('*.jpg'))) < 16 or not hits:
            vis = covered.copy()
            for h in hits:
                x0,y0,x1,y1 = h['box']
                cv2.rectangle(vis, (x0,y0), (x1,y1), (0, 180, 0), 3)
            pv = cv2.resize(vis, (400, int(400 * vis.shape[0] / vis.shape[1])))
            cv2.imwrite(str(PREV / f'{art}.jpg'), pv, [int(cv2.IMWRITE_JPEG_QUALITY), 85])

    (ROOT / 'data.js').write_text(
        prefix + json.dumps(cat, ensure_ascii=False, separators=(', ', ': ')) + ';\n'
    )
    (ROOT / 'tools' / 'poster-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('posters', poster_count)
    print('ok with brand cover', len(report['ok']))
    print('no brand detected', len(report['no_match_brand']), [x['art'] for x in report['no_match_brand']])
    print('no ozon', [x['art'] for x in report['no_ozon']])
    print('used images[0]', [x['art'] for x in report['used_images0']])

if __name__ == '__main__':
    main()
