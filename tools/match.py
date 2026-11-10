# Сопоставление фото витрины (исходный каталог) с фото дилерского портала по перцептивному хэшу
import os
import json, numpy as np
from PIL import Image
T='os.environ.get('CATALOG_SRC', '')'; D='os.environ.get('DEALER_SRC', '')'
def dh(p):
    im=Image.open(p).convert('L').resize((17,16),Image.LANCZOS); a=np.asarray(im,np.int16); return (a[:,1:]>a[:,:-1]).flatten()
tt=json.load(open(f'{T}/data.json'))['tiles']; dd={t['art']:t for t in json.load(open(f'{D}/data.json'))['tiles']}
out={}
for t in tt:
    a=t['art']; dph=dd.get(a,{}).get('photos',[])
    dhs={p:dh(f'{D}/img/{a}/{p}_t.jpg') for p in dph}
    m={}
    for p in t['photos']:
        h=dh(f'{T}/img/{a}/{p}_t.jpg'); best=min(((int((h!=v).sum()),q) for q,v in dhs.items()),default=(999,None))
        m[p]=best[1] if best[0]<=12 else None
    out[a]=m
json.dump(out,open('match.json','w'),indent=0)
same=sum(1 for a,m in out.items() if m and all(m.values()) and len(m)==len(dd.get(a,{}).get('photos',[])))
print('tiles',len(tt),'with photos',sum(1 for t in tt if t['photos']),'identical sets',same)
for a,m in out.items():
    if m and not all(m.values()): print(a,'new:',[p for p,v in m.items() if not v],'dealer had',len(dd.get(a,{}).get('photos',[])))
print('tiles arts not in dealer',[t['art'] for t in tt if t['art'] not in dd])
