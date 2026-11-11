# Сборка страниц из частей pages/ (одинаковые шапка и подвал без JS-вставок → нет сдвига вёрстки)
import time, re
from pathlib import Path
V = time.strftime('%y%m%d%H%M')
root = Path(__file__).resolve().parent
head, foot, room = ((root/'pages'/f'_{n}.html').read_text() for n in ('head', 'foot', 'room'))
cfg = (root/'config.js').read_text()
name = re.search(r"NAME:\s*'([^']*)'", cfg)
name = name.group(1) if name else 'Каталог плитки'
tag = re.search(r"TAGLINE:\s*'([^']*)'", cfg)
tag = tag.group(1) if tag else 'Каталог керамогранита'
P = {
    'index': (f'{name} — {tag}', ''),
    'tile': (f'Плитка — {name}', ' solid'),
    'prices': (f'Цены — редактор — {name}', ' solid'),
    'edit': (f'Редактор фото — {name}', ' solid'),
    'admin': (f'Вход для администраторов — {name}', ' solid'),
}
for page, (title, navcls) in P.items():
    body = (root/'pages'/f'{page}.body.html').read_text()
    body = body.replace('{{room}}', room.replace('{{room_extra}}', '<a class="btn gold wide" id="roomOpen" href="#">Открыть модель <i aria-hidden="true">→</i></a>'))
    body = body.replace('{{room_tile}}', room.replace('{{room_extra}}', ''))
    h = head.replace('{{title}}', title).replace('{{page}}', page).replace('{{navcls}}', navcls).replace('{{cur_cat}}', ' aria-current="page"' if page == 'index' else '')
    html = (h + body + foot).replace('{{v}}', V)
    if page == 'edit':
        html = html.replace('</body>', f'<script src="edit.js?v={V}"></script>\n</body>')
    (root/f'{page}.html').write_text(html)
print('ok', V)
