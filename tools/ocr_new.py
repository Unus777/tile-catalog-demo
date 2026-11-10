# OCR-детекция текста (полный размер + 960px) для фото, которых нет в обработке дилерского прототипа
import os
import json, os, numpy as np, cv2
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR(); T='os.environ.get('CATALOG_SRC', '')'
m = json.load(open('match.json')); arts=[a for a,v in m.items() if v and not all(v.values())]
out = json.load(open('ocr_new.json')) if os.path.exists('ocr_new.json') else {}
def det(im,s):
    res,_=ocr(cv2.resize(im,None,fx=s,fy=s) if s!=1 else im,use_det=True,use_cls=False,use_rec=False); b=[]
    for r in (res or []):
        pts=np.array(r if not isinstance(r[0][0],list) else r[0])/s; x0,y0=pts.min(0); x1,y1=pts.max(0); b.append([int(x0),int(y0),int(x1),int(y1)])
    return b
for a in arts:
    for p in m[a]:
        k=f'{a}/{p}'
        if k in out: continue
        im=cv2.imread(f'{T}/img/{k}.jpg'); h,w=im.shape[:2]
        out[k]={'w':w,'h':h,'boxes':det(im,1.0)+det(im,960/max(w,h))}
    json.dump(out,open('ocr_new.json','w')); print(a,flush=True)
