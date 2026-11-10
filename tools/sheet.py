import os
import json,sys
from PIL import Image, ImageDraw
T='os.environ.get('CATALOG_SRC', '')'; m=json.load(open('match.json'))
for a in sys.argv[1:]:
    ps=list(m[a].keys()); n=len(ps); cols=6; rows=(n+cols-1)//cols; S=260
    sh=Image.new('RGB',(cols*S,rows*(S+20)),'white'); d=ImageDraw.Draw(sh)
    for i,p in enumerate(ps):
        im=Image.open(f'{T}/img/{a}/{p}_t.jpg').convert('RGB'); im.thumbnail((S-6,S-6)); x,y=(i%cols)*S,(i//cols)*(S+20)
        sh.paste(im,(x+3,y+3)); d.text((x+4,y+S),f'{p} {Image.open(f"{T}/img/{a}/{p}.jpg").size}',fill='black')
    sh.save(f'/tmp/cs_{a}.jpg',quality=80)
