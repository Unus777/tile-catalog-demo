# Чистые фото для каталога-витрины. Источник фото: исходные фото каталога (только чтение).
# 1) модели, чьи фото совпадают с дилерским порталом, берут готовую обработку из dealer-design-v3/img2 (та же OCR-очистка);
# 2) модели с новыми/другими фото обрабатываются здесь тем же методом (OCR-маска текста → окно 4:5 интерьера; фактура — целая плитка с белого фона).
import os
import json, os, shutil, numpy as np, cv2
from PIL import Image, ImageChops, ImageFilter
T='os.environ.get('CATALOG_SRC', '')'; DV='/workspace/dealer-design-v3'; OUT='../img2'
m=json.load(open('match.json')); dm=json.load(open(f'{DV}/manifest.json')); ocr=json.load(open('ocr_new.json'))
tiles=json.load(open(f'{T}/data.json'))['tiles']
# ручная разметка по контактным листам: (кандидаты интерьера по приоритету, кадр чистой фактуры)
NEW={'VHP612441':(['06','05','04','07'],'08'),'VHJ600001':(['07','05','06'],'08'),'VHP600502':(['05','04','06','07'],'08'),
     'VHP600801':(['04','08','05','06','07'],'09'),'VHP600157':(['05','08','06','09','04','10','07'],'11'),'VHP600132':(['14','19','13','15','18','12'],'22')}
MANUAL_FACE={'VHP600801':[170,385,885,885]}  # плитка на сером фоне с тенью — рамка вручную
def textmask(k,w,h,sc):
    mm=np.zeros((int(h*sc)+1,int(w*sc)+1),np.uint8)
    for x0,y0,x1,y1 in ocr[k]['boxes']:
        bh=y1-y0; X0=max(0,x0-0.05*w); X1=min(w,x1+0.05*w); Y0=max(0,y0-max(0.09*h,bh*2.5)); Y1=min(h,y1+0.03*h)
        mm[int(Y0*sc):int(Y1*sc)+1,int(X0*sc):int(X1*sc)+1]=1
    return mm
def best_window(mask,ar,minfrac):
    H,W=mask.shape; ii=cv2.integral(mask)
    for hh in np.arange(1.0,minfrac-1e-6,-0.02):
        wh=int(H*hh); ww=int(wh*ar)
        if ww>W: ww=W; wh=int(ww/ar)
        best=None
        for y in range(0,H-wh+1,max(1,H//60)):
            for x in range(0,W-ww+1,max(1,W//60)):
                if ii[y+wh,x+ww]-ii[y,x+ww]-ii[y+wh,x]+ii[y,x]==0:
                    c=abs((x+ww/2)/W-.5)+abs((y+wh/2)/H-.58)*.7
                    if best is None or c<best[0]: best=(c,x,y,ww,wh)
        if best: return best[1:]
def trim(im):
    bg=Image.new('RGB',im.size,im.getpixel((2,2))); b=ImageChops.difference(im,bg).convert('L').point(lambda v:255 if v>18 else 0).getbbox()
    if not b: return im,None
    w,h=b[2]-b[0],b[3]-b[1]; box=(b[0]+int(w*.025),b[1]+int(h*.025),b[2]-int(w*.025),b[3]-int(h*.025))
    return im.crop(box),[box[0],box[1],box[2]-box[0],box[3]-box[1]]
def grade(im,strength):
    a=np.asarray(im).astype(np.float32); L=a.mean(2); lo,hi=np.percentile(L,.4),np.percentile(L,99.6)
    hi=max(hi,235) if hi>225 else hi; s=min(1.18,250/max(1,hi-lo)); lo=min(lo,255-250/s) if s>1 else 0
    b=(a-lo)*s; a=a+(b-a)*strength; return Image.fromarray(np.clip(a,0,255).astype(np.uint8))
def save(im,base,sizes):
    out={}
    for w in sorted(set(min(w,im.width) for w in sizes),reverse=True):
        r=im.resize((w,round(w*im.height/im.width)),Image.LANCZOS) if w!=im.width else im.copy()
        r=r.filter(ImageFilter.UnsharpMask(1.1,40,2))
        r.save(f'{base}-{r.width}.webp','WEBP',quality=82,method=5); r.save(f'{base}-{r.width}.jpg','JPEG',quality=84,optimize=True,progressive=True)
        out[r.width]=f'{base}-{r.width}'.replace('../','')
    return out
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT); man={}
for t in tiles:
    a=t['art']; rec={'name':t['name'],'format':t['format'],'surface':t['surface'],'flags':[]}; ph={p.split('.')[0]:p for p in t['photos']}
    if not t['photos']: rec['flags'].append('нет фото в каталоге'); man[a]=rec; continue
    if a not in NEW:
        r=json.loads(json.dumps(dm[a])); shutil.copytree(f'{DV}/img2/{a}',f'{OUT}/{a}')
        for k in ('card','face'):
            if k in r: r[k]['src']=ph[r[k]['src'][:-4]]+'.jpg'; r[k]['method']+=' · из обработки дилерского прототипа'
        rec.update({k:r[k] for k in ('card','face') if k in r}); rec['flags']=r['flags']; man[a]=rec; continue
    os.makedirs(f'{OUT}/{a}'); cands,tex=NEW[a]
    src=Image.open(f'{T}/img/{a}/{ph[tex]}.jpg').convert('RGB')
    if a in MANUAL_FACE: box=MANUAL_FACE[a]; im=src.crop((box[0],box[1],box[0]+box[2],box[1]+box[3]))
    else: im,box=trim(src)
    fw,fh=[int(v) for v in t['format'].split('×')]; want=min(fw,fh)/max(fw,fh); ar=im.width/im.height
    full=abs(ar-want)/want<.15 or abs(ar-1/want)/want<.15
    im=grade(im,.5); face=dict(src=ph[tex]+'.jpg',box=box,method='целая плитка (обрезка белого поля), новая обработка',full=full,px=[im.width,im.height])
    face['files']=save(im,f'{OUT}/{a}/face',[1000,520]); t2=im.copy(); t2.thumbnail((1400,1400)); t2.save(f'{OUT}/{a}/tile.jpg',quality=88); face['tile']=f'img2/{a}/tile.jpg'
    if min(im.size)<420: rec['flags'].append(f'фактура малого размера ({min(im.size)} px)')
    rec['face']=face; best=None
    for c in cands:
        k=f'{a}/{ph[c]}'; w,h=ocr[k]['w'],ocr[k]['h']; sc=240/h; b=best_window(textmask(k,w,h,sc),0.8,0.45)
        if b:
            fr=b[3]/(h*sc)+(0.08 if c==cands[0] else 0)
            if best is None or fr>best[0]: best=(fr,c,[int(v/sc) for v in b])
    if best:
        _,c,(x,y,w,h)=best; im=Image.open(f'{T}/img/{a}/{ph[c]}.jpg').convert('RGB').crop((x,y,x+w,y+h))
        im=im.resize((round(im.height*.8),im.height)) if abs(im.width/im.height-.8)>.01 else im
        im=grade(im,.35); rec['card']=dict(src=ph[c]+'.jpg',box=[x,y,w,h],method='авто: окно 4:5 без текста (OCR), новая обработка',px=[im.width,im.height],files=save(im,f'{OUT}/{a}/card',[900,560]))
        if im.height<700: rec['flags'].append(f'интерьер малого размера ({im.height} px)')
    else: rec['flags'].append('нет интерьера без текста')
    man[a]=rec; print(a,'card',rec.get('card',{}).get('src'),rec.get('card',{}).get('px'),'face',face['px'],full)
# hero из дилерского прототипа
for a,r in dm.items():
    if a=='_hero':
        man['_hero']=r
        for h in r:
            ph={p.split('.')[0]:p for p in next(x for x in tiles if x['art']==h['art'])['photos']}
            h['src']=ph[h['src'][:-4]]+'.jpg'
            for f in h['files'].values():
                for ext in ('.jpg','.webp'):
                    if not os.path.exists('../'+f+ext): shutil.copy(f'{DV}/{f}{ext}','../'+f+ext)
json.dump(man,open('../manifest.json','w'),ensure_ascii=False,indent=1)
nf=sum(1 for k,r in man.items() if k!='_hero' and 'нет фото в каталоге' in r['flags'])
print('всего',len(man)-('_hero' in man),'без фото',nf,'фактура',sum(1 for k,r in man.items() if k!='_hero' and 'face' in r),'интерьер',sum(1 for k,r in man.items() if k!='_hero' and 'card' in r),'целая плитка',sum(1 for k,r in man.items() if k!='_hero' and r.get('face',{}).get('full')))
for k,r in man.items():
    if k!='_hero' and r['flags'] and 'нет фото в каталоге' not in r['flags']: print(k,r['name'],r['flags'])
