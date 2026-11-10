# data.js: исходный data.json (только чтение) + manifest.json (чистые фото, tools/build_photos.py)
# Цвет (тон) — автоматически по средней Lab чистой фактуры; без фото — по словам в названии.
# Путь к исходным данным: переменная окружения CATALOG_SRC (папка с data.json).
import json, re, os, sys
import numpy as np
from PIL import Image
SRC = os.environ.get('CATALOG_SRC', '')
if not SRC:
    sys.exit('Укажите CATALOG_SRC — папку с исходным data.json')
src = json.load(open(f'{SRC}/data.json')); man = json.load(open('manifest.json'))
def sset(files): return sorted([[int(w), p] for w, p in files.items()])
def lab(path):
    im = Image.open(path).convert('RGB'); im.thumbnail((200, 200)); a = np.asarray(im, np.float32) / 255
    a = np.where(a > .04045, ((a + .055) / 1.055) ** 2.4, a / 12.92); M = np.array([[.4124, .3576, .1805], [.2126, .7152, .0722], [.0193, .1192, .9505]])
    xyz = a.reshape(-1, 3) @ M.T / np.array([.9505, 1, 1.089]); f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[:, 1] - 16; A = 500 * (f[:, 0] - f[:, 1]); B = 200 * (f[:, 1] - f[:, 2]); return float(np.median(L)), float(np.median(A)), float(np.median(B))
def tone(L, A, B):
    C = (A * A + B * B) ** .5
    if C > 17: return 'Цветной'
    if L < 45: return 'Тёмный'
    if B > 7.5: return 'Бежевый'
    if L > 80: return 'Белый'
    return 'Серый'
def tone_by_name(n):
    n = n.lower()
    for k, v in [('вайт', 'Белый'), ('бьянко', 'Белый'), ('снеж', 'Белый'), ('дарк', 'Тёмный'), ('блэк', 'Тёмный'), ('блек', 'Тёмный'), ('браун', 'Бежевый'), ('графит', 'Тёмный'), ('беж', 'Бежевый'), ('крем', 'Бежевый'), ('грей', 'Серый'), ('серый', 'Серый')]:
        if k in n: return v
    return None
out = []
for t in src['tiles']:
    art = t['art']; m = man.get(art, {}); s = t['stock']
    mm = re.search(r'([\d,]+)\s*м2', t['packing']); m2 = float(mm.group(1).replace(',', '.')) if mm else None
    nm = tone_by_name(t['name']); lab_ = None
    if 'face' in m: lab_ = lab(m['face']['tile'])
    if nm == 'Тёмный' and lab_ and lab_[0] > 60: nm = None
    if nm and (nm != 'Белый' and nm != 'Серый' or not lab_): tn, tsrc = nm, 'название'
    elif lab_: tn, tsrc = tone(*lab_), 'фото'
    else: tn, tsrc = None, None
    r = dict(art=art, name=t['name'], format=t['format'], surface=t['surface'], packing=t['packing'], pallet=t['pallet'], is_new=t['is_new'],
             stock=s, url='tile.html?a=' + art, m2pack=m2, tone=tn, toneSrc=tsrc if tn else None, flags=[f for f in m.get('flags', []) if f != 'нет фото в каталоге'],
             card=sset(m['card']['files']) if 'card' in m else None, face=sset(m['face']['files']) if 'face' in m else None,
             tile=m['face']['tile'] if 'face' in m else None, tileFull=m.get('face', {}).get('full', False), photos=t['photos'])
    if isinstance(t.get('price'), dict): r['price'] = t['price']
    out.append(r)
hero = [dict(art=h['art'], set=sset(h['files'])) for h in man['_hero']]
open('data.js', 'w').write('/* Данные каталога. Адрес сайта задаётся в config.js (BASE_URL). */\nwindow.CAT=' + json.dumps(dict(base='', tiles=out, hero=hero), ensure_ascii=False) + ';\n')
from collections import Counter
print(len(out), Counter(r['tone'] for r in out))
