/* Примерочная: WebGL-комната (three.js r170, собирается esbuild в room.bundle.js) */
import * as THREE from '../vendor/three.module.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { Reflector } from '../vendor/Reflector.js';
import { RectAreaLightUniformsLib } from '../vendor/RectAreaLightUniformsLib.js';

const W = 5.2, D = 6.0, H = 2.8, Z0 = -4.2, Z1 = Z0 + D, X0 = -W / 2, X1 = W / 2;
const WIN = { z0: -3.5, z1: -0.9, y1: 2.5 }; // окно в левой стене, в пол
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ---------- раскладка плитки на холсте ---------- */
function groutFill(x, cw, ch, color, seed) {
  x.fillStyle = color; x.fillRect(0, 0, cw, ch);
  const r = rng(seed + 17), id = x.getImageData(0, 0, cw, ch), d = id.data;
  // лёгкий шум затирки, без полос на стыках
  for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(id, 0, 0);
}
function tilePlacements(pattern, tw, th, g, cw, ch) {
  const out = [];
  const sX = tw + g, sY = th + g;
  if (pattern === 'herringbone' || pattern === 'herringbone0') {
    // осевая ёлочка (поворот на 45° делается в layTiles одним холстом)
    const short = Math.min(tw, th), long = Math.max(tw, th);
    const ratio = long / Math.max(short, 1);
    if (ratio >= 1.6 && ratio <= 2.4) {
      const modW = long + short + 2 * g;
      const modH = long + 2 * g;
      const cols = Math.ceil(cw / modW) + 4;
      const rows = Math.ceil(ch / modH) + 4;
      for (let by = -3; by < rows; by++) {
        const ox = (by & 1) ? (short + g) : 0;
        for (let bx = -3; bx < cols; bx++) {
          const x = bx * modW + ox, y = by * modH;
          out.push({ x, y, w: long, h: short, deg: 0 });
          out.push({ x, y: y + short + g, w: long, h: short, deg: 0 });
          const vy = y + Math.max(0, (2 * short + g - long) / 2);
          out.push({ x: x + long + g, y: vy, w: short, h: long, deg: 0 });
        }
      }
    } else {
      const step = long + short + 2 * g;
      for (let v = -3; v < Math.ceil(ch / (short + g)) + 4; v++) {
        for (let u = -3; u < Math.ceil(cw / step) + 4; u++) {
          const x = u * step + ((v & 1) ? step / 2 : 0);
          const y = v * (short + g);
          if ((u + v) & 1) out.push({ x, y, w: short, h: long, deg: 0 });
          else out.push({ x, y, w: long, h: short, deg: 0 });
        }
      }
    }
    return out;
  }
  const shift = pattern === 'half' ? .5 : pattern === 'third' ? 1 / 3 : 0;
  const rows = Math.ceil(ch / sY) + 2;
  for (let j = -2; j < rows; j++) {
    const off = ((j * shift) % 1) * sX;
    for (let i = -3; i < cw / sX + 3; i++) out.push({ x: i * sX + off, y: j * sY, w: tw, h: th, deg: 0 });
  }
  return out;
}
function sourceWindow(img, dw, dh, full, r) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const tar = dw / dh;
  let sw, sh;
  if (iw / ih > tar) { sh = ih; sw = ih * tar; } else { sw = iw; sh = iw / tar; }
  const inset = full ? .994 : .98;
  sw *= inset; sh *= inset;
  const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  return { sx, sy, sw, sh };
}
function tileHits(t, cw, ch) {
  const rad = (t.deg || 0) * Math.PI / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const aw = t.w * c + t.h * s, ah = t.w * s + t.h * c;
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
  return !(cx - aw / 2 > cw || cy - ah / 2 > ch || cx + aw / 2 < 0 || cy + ah / 2 < 0);
}
function drawOneTile(x, img, t, g, full, r) {
  const tw = t.w, th = t.h, cx = t.x + tw / 2, cy = t.y + th / 2;
  x.save();
  x.translate(cx, cy);
  x.rotate((t.deg || 0) * Math.PI / 180);
  // клип в локальных осях плитки — после поворота швы остаются ровными
  x.beginPath(); x.rect(-tw / 2, -th / 2, tw, th); x.clip();
  const turn = full ? ((r() < .5) ? 180 : 0) : 0;
  if (turn) x.rotate(Math.PI);
  // фото плитки может быть снято «стоя», а плитка лежит «лёжа» (и наоборот) — поворачиваем на 90°,
  // чтобы на плитку попадал весь кадр без обрезки, в правильных пропорциях формата
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const flip = (tw > th * 1.15 && ih > iw * 1.15) || (th > tw * 1.15 && iw > ih * 1.15);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  if (flip) {
    x.save(); x.rotate(Math.PI / 2);
    const src = sourceWindow(img, th, tw, full, r);
    x.drawImage(img, src.sx, src.sy, src.sw, src.sh, -th / 2, -tw / 2, th, tw);
    x.restore();
  } else {
    const src = sourceWindow(img, tw, th, full, r);
    x.drawImage(img, src.sx, src.sy, src.sw, src.sh, -tw / 2, -th / 2, tw, th);
  }
  const v = (r() - .5) * (full ? .03 : .04);
  x.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
  x.fillRect(-tw / 2, -th / 2, tw, th);
  x.strokeStyle = 'rgba(0,0,0,.08)'; x.lineWidth = 1;
  x.strokeRect(-tw / 2 + .5, -th / 2 + .5, tw - 1, th - 1);
  x.strokeStyle = 'rgba(255,255,255,.12)'; x.beginPath();
  x.moveTo(-tw / 2 + 1.2, th / 2 - 1.2); x.lineTo(-tw / 2 + 1.2, -th / 2 + 1.2); x.lineTo(tw / 2 - 1.2, -th / 2 + 1.2); x.stroke();
  x.restore();
}
function layTiles(o) {
  // o: {img, tw, th (м), aw, ah (м), ppm, grout(мм), groutColor, pattern, seed, ao, full}
  const pat = o.pattern || 'straight';
  const cw = Math.round(o.aw * o.ppm), ch = Math.round(o.ah * o.ppm);
  // ёлочка и диагональ: сначала ось-выровненная раскладка, затем один поворот холста
  if ((pat === 'diagonal' || pat === 'herringbone') && !o._inner) {
    const side = Math.ceil(Math.hypot(cw, ch) + Math.max(o.tw, o.th) * o.ppm);
    const inner = layTiles({ ...o, pattern: pat === 'herringbone' ? 'herringbone0' : 'straight', aw: side / o.ppm, ah: side / o.ppm, ao: null, _inner: true });
    const c = canvas(cw, ch), x = c.getContext('2d');
    groutFill(x, cw, ch, o.groutColor, o.seed);
    x.translate(cw / 2, ch / 2);
    x.rotate(Math.PI / 4);
    x.drawImage(inner, -inner.width / 2, -inner.height / 2);
    if (o.ao) o.ao(x, cw, ch, o.ppm);
    return c;
  }
  const c = canvas(cw, ch), x = c.getContext('2d');
  groutFill(x, cw, ch, o.groutColor, o.seed);
  const r = rng(o.seed);
  const tw = o.tw * o.ppm, th = o.th * o.ppm, g = Math.max(1.5, o.grout / 1000 * o.ppm);
  const tiles = tilePlacements(pat === 'herringbone0' ? 'herringbone0' : (pat === 'herringbone' ? 'herringbone0' : pat), tw, th, g, cw, ch);
  for (const t of tiles) {
    if (!tileHits(t, cw, ch)) continue;
    drawOneTile(x, o.img, t, g, !!o.full, r);
  }
  if (o.ao) o.ao(x, cw, ch, o.ppm);
  return c;
}
function plaster(w, h, seed) {
  const c = canvas(w, h), x = c.getContext('2d'); x.fillStyle = '#ece6dc'; x.fillRect(0, 0, w, h);
  const r = rng(seed), id = x.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(id, 0, 0); return c;
}
/* мягкое затенение в углах и под мебелью (печётся прямо в текстуру) */
function aoEdges(x, cw, ch, ppm, edges, blobs) {
  x.save(); x.globalCompositeOperation = 'multiply';
  const band = .45 * ppm;
  for (const e of edges) { // e: 'l','r','t','b'
    let gr;
    if (e === 't') gr = x.createLinearGradient(0, 0, 0, band); if (e === 'b') gr = x.createLinearGradient(0, ch, 0, ch - band);
    if (e === 'l') gr = x.createLinearGradient(0, 0, band, 0); if (e === 'r') gr = x.createLinearGradient(cw, 0, cw - band, 0);
    gr.addColorStop(0, 'rgb(150,148,145)'); gr.addColorStop(.25, 'rgb(212,210,207)'); gr.addColorStop(1, 'rgb(255,255,255)');
    x.fillStyle = gr; x.fillRect(0, 0, cw, ch);
  }
  for (const b of blobs || []) {
    x.filter = `blur(${b.blur * ppm}px)`; x.fillStyle = `rgba(70,64,58,${b.a})`;
    x.beginPath(); if (b.r) x.arc(b.x * ppm, b.y * ppm, b.r * ppm, 0, 7); else x.rect(b.x * ppm, b.y * ppm, b.w * ppm, b.h * ppm); x.fill();
  }
  x.restore();
}

/* ---------- отражение (полированный / сатин) ---------- */
const ReflShader = {
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, opacity: { value: 0 }, blur: { value: 1.5 }, res: { value: new THREE.Vector2(1024, 1024) } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position,1.0); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float opacity; uniform float blur; uniform vec2 res; varying vec4 vUv; varying vec3 vW;
    void main(){
      vec2 uv = vUv.xy / vUv.w; vec2 t = blur / res; vec4 s = vec4(0.0);
      s += texture2D(tDiffuse, uv) * .2;
      s += texture2D(tDiffuse, uv + vec2(t.x,0.)) * .1; s += texture2D(tDiffuse, uv - vec2(t.x,0.)) * .1;
      s += texture2D(tDiffuse, uv + vec2(0.,t.y)) * .1; s += texture2D(tDiffuse, uv - vec2(0.,t.y)) * .1;
      s += texture2D(tDiffuse, uv + t) * .1; s += texture2D(tDiffuse, uv - t) * .1;
      s += texture2D(tDiffuse, uv + vec2(t.x,-t.y)) * .1; s += texture2D(tDiffuse, uv + vec2(-t.x,t.y)) * .1;
      vec3 v = normalize(cameraPosition - vW); float f = .35 + .65 * pow(1. - abs(v.y), 3.);
      gl_FragColor = vec4(s.rgb, opacity * f);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
};

/* ---------- мебель ---------- */
function fabricTex() { const c = canvas(256, 256), x = c.getContext('2d'), r = rng(7); x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 90 + r() * 80 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.beginPath(); x.arc(r() * 256, r() * 256, .6 + r() * 1.3, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t; }
function stoneTex() { const c = canvas(512, 512), x = c.getContext('2d'), r = rng(3); x.fillStyle = '#cbbfae'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(${150 + r() * 40 | 0},${135 + r() * 30 | 0},${115 + r() * 20 | 0},${.15 + r() * .2})`; x.lineWidth = 1 + r() * 4; x.beginPath(); const y = r() * 512; x.moveTo(0, y); x.bezierCurveTo(170, y + (r() - .5) * 40, 340, y + (r() - .5) * 40, 512, y + (r() - .5) * 30); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function artTex() { const c = canvas(600, 800), x = c.getContext('2d'); x.fillStyle = '#efe7da'; x.fillRect(0, 0, 600, 800);
  x.fillStyle = '#c9a27a'; x.beginPath(); x.arc(250, 330, 170, 0, 7); x.fill(); x.fillStyle = '#8c6a4f'; x.fillRect(300, 420, 190, 260); x.fillStyle = '#e2d3bd'; x.beginPath(); x.arc(380, 300, 90, 0, 7); x.fill();
  x.strokeStyle = '#3b3029'; x.lineWidth = 3; x.beginPath(); x.moveTo(90, 620); x.bezierCurveTo(220, 540, 330, 700, 520, 600); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function skyTex() { const c = canvas(512, 512), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#ffffff'); g.addColorStop(.7, '#fffdf9'); g.addColorStop(1, '#f1efe6'); x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const r = rng(11); x.filter = 'blur(14px)'; for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(${200 + r() * 30 | 0},${205 + r() * 25 | 0},${185 + r() * 25 | 0},.25)`; x.beginPath(); x.arc(r() * 512, 340 + r() * 120, 30 + r() * 60, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

function buildFurniture(scene, list) {
  const fab = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: .97, bumpMap: fabricTex(), bumpScale: .6 });
  const fab2 = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: .97, bumpMap: fab.bumpMap, bumpScale: .6 });
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; scene.add(m); list.push(m); return m; };
  // диван вдоль правой стены, сиденьем к окну
  const sx = X1 - .55, sz = -2.15, L = 2.5;
  add(new RoundedBoxGeometry(.98, .30, L, 4, .06), fab, sx, .22, sz);
  add(new RoundedBoxGeometry(.24, .78, L, 4, .09), fab, sx + .37, .45, sz);
  add(new RoundedBoxGeometry(.98, .56, .22, 4, .09), fab, sx, .30, sz - L / 2 + .11);
  add(new RoundedBoxGeometry(.98, .56, .22, 4, .09), fab, sx, .30, sz + L / 2 - .11);
  for (const dz of [-.52, .52]) add(new RoundedBoxGeometry(.76, .16, 1.0, 5, .07), fab2, sx - .08, .43, sz + dz);
  for (const dz of [-.6, .55]) { const p = add(new RoundedBoxGeometry(.16, .42, .48, 5, .07), fab2, sx + .2, .66, sz + dz); p.rotation.z = .18; }
  for (const dz of [-L / 2 + .12, L / 2 - .12]) for (const dx of [-.4, .4]) add(new THREE.CylinderGeometry(.02, .02, .07, 10), new THREE.MeshStandardMaterial({ color: 0x2b241e, roughness: .5 }), sx + dx, .035, sz + dz);
  // журнальный столик-травертин
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: .6 });
  add(new THREE.CylinderGeometry(.48, .48, .06, 64), stone, sx - 1.35, .35, sz);
  add(new THREE.CylinderGeometry(.30, .34, .32, 48), stone, sx - 1.35, .16, sz);
  const cer = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: .35 });
  add(new THREE.SphereGeometry(.09, 32, 16), cer, sx - 1.25, .46, sz - .1).scale.set(1, 1.3, 1);
  add(new RoundedBoxGeometry(.26, .05, .2, 2, .01), new THREE.MeshStandardMaterial({ color: 0x9c8a74, roughness: .8 }), sx - 1.5, .405, sz + .12);
  // торшер
  const blk = new THREE.MeshStandardMaterial({ color: 0x1f1b17, roughness: .4, metalness: .3 });
  add(new THREE.CylinderGeometry(.16, .18, .02, 40), blk, sx + .05, .01, sz - L / 2 - .4);
  add(new THREE.CylinderGeometry(.012, .012, 1.55, 12), blk, sx + .05, .78, sz - L / 2 - .4);
  const shade = add(new THREE.CylinderGeometry(.16, .24, .3, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xf3ead9, roughness: .9, side: THREE.DoubleSide, emissive: 0xffe2b0, emissiveIntensity: .25 }), sx + .05, 1.6, sz - L / 2 - .4);
  shade.castShadow = false;
  // олива в кашпо у окна
  const pot = new THREE.MeshStandardMaterial({ color: 0xb9ab98, roughness: .9 });
  const px = X0 + .55, pz = WIN.z0 - .25;
  add(new THREE.CylinderGeometry(.26, .2, .55, 48), pot, px, .275, pz);
  const bark = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
  const r = rng(5), trunkTop = [];
  for (let i = 0; i < 4; i++) { const a = i * 1.7 + r(), h = .9 + r() * .5, lean = .12 + r() * .1;
    const g = new THREE.CylinderGeometry(.012, .025, h, 8); const m = add(g, bark, px + Math.cos(a) * lean / 2, .55 + h / 2, pz + Math.sin(a) * lean / 2); m.rotation.z = Math.cos(a) * lean; m.rotation.x = -Math.sin(a) * lean;
    trunkTop.push(new THREE.Vector3(px + Math.cos(a) * lean * 1.3, .55 + h, pz + Math.sin(a) * lean * 1.3)); }
  const leafG = new THREE.SphereGeometry(1, 6, 4); leafG.scale(.034, .008, .012);
  const leafM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .7 });
  const N = 2600, inst = new THREE.InstancedMesh(leafG, leafM, N), q = new THREE.Object3D(), col = new THREE.Color();
  for (let i = 0; i < N; i++) { const c = trunkTop[i % 4], u = r() * 6.28, v = Math.acos(2 * r() - 1), rr = .1 + Math.cbrt(r()) * .38;
    q.position.set(c.x + Math.sin(v) * Math.cos(u) * rr, c.y + .12 + Math.cos(v) * rr * .8, c.z + Math.sin(v) * Math.sin(u) * rr);
    q.rotation.set(r() * 6.28, r() * 6.28, r() * 6.28); q.updateMatrix(); inst.setMatrixAt(i, q.matrix);
    col.setHSL(.19 + r() * .07, .18 + r() * .14, .22 + r() * .14); inst.setColorAt(i, col); }
  inst.castShadow = true; scene.add(inst); list.push(inst);
  // картина на дальней стене
  const fr = add(new RoundedBoxGeometry(1.0, 1.3, .04, 2, .006), new THREE.MeshStandardMaterial({ color: 0x2a241f, roughness: .5 }), -.2, 1.55, Z0 + .03);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(.92, 1.22), new THREE.MeshStandardMaterial({ map: artTex(), roughness: .9 })); art.position.set(-.2, 1.55, Z0 + .052); scene.add(art); list.push(art);
  return { blobs: [ // для AO на полу (координаты в метрах от угла X0,Z0)
    { x: sx - .49 - X0, y: sz - L / 2 - Z0, w: .98, h: L, blur: .08, a: .55 },
    { x: sx - 1.35 - X0, y: sz - Z0, r: .36, blur: .07, a: .45 },
    { x: px - X0, y: pz - Z0, r: .24, blur: .06, a: .5 },
    { x: sx + .05 - X0, y: sz - L / 2 - .4 - Z0, r: .17, blur: .04, a: .35 }] };
}


function addMesh(scene, list, geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; scene.add(m); list.push(m); return m;
}
function buildBath(scene, list) {
  const oak = new THREE.MeshStandardMaterial({ color: 0xcbb79a, roughness: .82 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xe8e2d8, roughness: .45 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: .35 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: .25, metalness: .85 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transmission: .85, thickness: .02, transparent: true, opacity: .35, metalness: 0, side: THREE.DoubleSide });
  const linen = new THREE.MeshStandardMaterial({ color: 0xd9cfc2, roughness: .95 });
  const add = (geo, mat, x, y, z, ry = 0) => addMesh(scene, list, geo, mat, x, y, z, ry);
  // тумба у правой стены
  const vx = X1 - .45, vz = -2.4;
  add(new RoundedBoxGeometry(1.6, .55, .48, 4, .02), oak, vx, .32, vz);
  add(new THREE.CylinderGeometry(.22, .2, .08, 40), stone, vx - .2, .64, vz);
  add(new THREE.SphereGeometry(.2, 32, 16, 0, 7, 0, 1.4), white, vx - .2, .78, vz).scale.set(1, .45, 1);
  add(new THREE.CylinderGeometry(.012, .012, .18, 12), chrome, vx - .2, .95, vz + .14);
  add(new THREE.CylinderGeometry(.012, .012, .12, 12), chrome, vx - .2, .88, vz + .2).rotation.x = 1.1;
  // зеркало
  const mir = add(new RoundedBoxGeometry(.02, 1.05, .7, 2, .01), new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: .12, metalness: .4 }), vx + .22, 1.45, vz);
  add(new RoundedBoxGeometry(.03, 1.1, .76, 2, .01), oak, vx + .23, 1.45, vz);
  // ванна у окна
  const tx = X0 + 1.35, tz = WIN.z0 + .55;
  add(new RoundedBoxGeometry(.85, .42, 1.7, 6, .16), white, tx, .32, tz);
  add(new THREE.CylinderGeometry(.012, .012, .55, 12), chrome, tx + .28, .7, tz - .65);
  add(new RoundedBoxGeometry(.22, .04, .36, 2, .01), linen, tx + .3, .55, tz + .35);
  // стеклянная перегородка душа
  const gx = -0.15, gz = -3.0;
  const scr = add(new THREE.PlaneGeometry(1.35, 2.05), glass, gx, 1.05, gz); scr.rotation.y = Math.PI / 2; scr.castShadow = false;
  add(new THREE.CylinderGeometry(.012, .012, 2.05, 10), chrome, gx, 1.05, gz - .67);
  add(new THREE.CylinderGeometry(.09, .12, .06, 24), chrome, gx - .35, 2.0, gz);
  // полотенца на тумбе
  add(new RoundedBoxGeometry(.18, .08, .28, 2, .02), linen, vx + .4, .66, vz);
  return { blobs: [
    { x: vx - .8 - X0, y: vz - .24 - Z0, w: 1.6, h: .48, blur: .07, a: .5 },
    { x: tx - .42 - X0, y: tz - .85 - Z0, w: .85, h: 1.7, blur: .07, a: .45 },
    { x: gx - X0, y: gz - .1 - Z0, r: .12, blur: .04, a: .3 }
  ] };
}
function buildKitchen(scene, list) {
  const oak = new THREE.MeshStandardMaterial({ color: 0x8d6b4a, roughness: .78 });
  const light = new THREE.MeshStandardMaterial({ color: 0xefe7da, roughness: .85 });
  const top = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: .4, metalness: .08 });
  const black = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: .4, metalness: .3 });
  const add = (geo, mat, x, y, z, ry = 0) => addMesh(scene, list, geo, mat, x, y, z, ry);
  // нижние шкафы вдоль дальней стены
  add(new RoundedBoxGeometry(W - .3, .82, .55, 2, .01), oak, 0, .41, Z0 + .32);
  add(new RoundedBoxGeometry(W - .28, .05, .58, 2, .01), top, 0, .84, Z0 + .32);
  // верхние шкафы
  add(new RoundedBoxGeometry(W - .5, .55, .32, 2, .01), light, 0, 2.25, Z0 + .2);
  // остров
  const ix = .55, iz = -1.7;
  add(new RoundedBoxGeometry(1.7, .82, .75, 3, .02), oak, ix, .41, iz);
  add(new RoundedBoxGeometry(1.74, .04, .79, 2, .01), top, ix, .84, iz);
  // стулья
  for (const dz of [-.22, .22]) {
    add(new THREE.CylinderGeometry(.16, .14, .04, 24), black, ix - .15, .52, iz + .55 + dz);
    add(new THREE.CylinderGeometry(.015, .015, .5, 8), black, ix - .15, .26, iz + .55 + dz);
  }
  // подвесы
  for (const dx of [-.4, .4]) {
    add(new THREE.CylinderGeometry(.006, .006, .45, 8), black, ix + dx, 2.2, iz);
    add(new THREE.CylinderGeometry(.12, .16, .16, 24), new THREE.MeshStandardMaterial({ color: 0xf3ead9, roughness: .9, emissive: 0xffe2b0, emissiveIntensity: .2 }), ix + dx, 1.95, iz);
  }
  // ваза на острове
  add(new THREE.CylinderGeometry(.07, .08, .18, 20), new THREE.MeshStandardMaterial({ color: 0x7a8b74, roughness: .5 }), ix + .45, .97, iz);
  return { blobs: [
    { x: 0.15 - X0, y: Z0 + .05 - Z0, w: W - .3, h: .55, blur: .08, a: .5 },
    { x: ix - .85 - X0, y: iz - .38 - Z0, w: 1.7, h: .75, blur: .08, a: .55 },
    { x: ix - .15 - X0, y: iz + .55 - .16 - Z0, r: .18, blur: .04, a: .3 }
  ] };
}

/* ---------- сцена ---------- */
export function createRoom(host, opts = {}) {
  RectAreaLightUniformsLib.init();
  const lowp = opts.low || matchMedia('(max-width: 700px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowp ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15120f);
  const cam = new THREE.PerspectiveCamera(48, 1, .05, 60);
  const maxA = renderer.capabilities.getMaxAnisotropy();

  // свет
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x9a8d7c, .8));
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2); sun.position.set(X0 - 6, 5.2, -1.2); sun.target.position.set(0, 0, -2.3);
  sun.castShadow = true; sun.shadow.mapSize.set(lowp ? 1024 : 2048, lowp ? 1024 : 2048); sun.shadow.radius = 6; sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 }); scene.add(sun, sun.target);
  const area = new THREE.RectAreaLight(0xfff6ea, 4.5, WIN.z1 - WIN.z0, WIN.y1); area.position.set(X0 + .02, WIN.y1 / 2, (WIN.z0 + WIN.z1) / 2); area.lookAt(X1, WIN.y1 / 2, (WIN.z0 + WIN.z1) / 2); scene.add(area);
  const fill = new THREE.DirectionalLight(0xfff8ee, .55); fill.position.set(3, 2.5, 4); scene.add(fill);
  const warm = new THREE.PointLight(0xffd9a8, .9, 5, 1.6); warm.position.set(X1 - .5, 1.6, -0.5); scene.add(warm);

  // геометрия комнаты
  const mk = (geo, mat, rec = true) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = rec; scene.add(m); return m; };
  const floorMat = new THREE.MeshPhysicalMaterial({ roughness: .6, metalness: 0 });
  const floor = mk(new THREE.PlaneGeometry(W, D), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, Z0 + D / 2);
  const wallMats = { back: new THREE.MeshStandardMaterial({ roughness: .92 }), left: new THREE.MeshStandardMaterial({ roughness: .92 }), right: new THREE.MeshStandardMaterial({ roughness: .92 }) };
  const back = mk(new THREE.PlaneGeometry(W, H), wallMats.back); back.position.set(0, H / 2, Z0); back.castShadow = true;
  const right = mk(new THREE.PlaneGeometry(D, H), wallMats.right); right.rotation.y = -Math.PI / 2; right.position.set(X1, H / 2, Z0 + D / 2); right.castShadow = true;
  // левая стена с проёмом окна: делаем ShapeGeometry с отверстием
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(D, 0); sh.lineTo(D, H); sh.lineTo(0, H); sh.lineTo(0, 0);
  const hole = new THREE.Path(); const hz0 = Z1 - WIN.z1, hz1 = Z1 - WIN.z0; hole.moveTo(hz0, 0); hole.lineTo(hz0, WIN.y1); hole.lineTo(hz1, WIN.y1); hole.lineTo(hz1, 0); hole.lineTo(hz0, 0);
  sh.holes.push(hole);
  const lg = new THREE.ShapeGeometry(sh); // UV = координаты в метрах → нормализуем
  const uv = lg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / D, uv.getY(i) / H);
  const left = mk(lg, wallMats.left); left.rotation.y = Math.PI / 2; left.position.set(X0, 0, Z1); left.castShadow = true;
  const ceil = mk(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: .95 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, Z0 + D / 2); ceil.castShadow = true;
  // откосы окна (толщина стены), рама, вид за окном
  const reveal = new THREE.MeshStandardMaterial({ color: 0xe9e3d8, roughness: .9 }), frame = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: .45, metalness: .4 });
  const T = .22;
  const top = mk(new THREE.BoxGeometry(T, .02, hz1 - hz0), reveal); top.position.set(X0 - T / 2, WIN.y1, (WIN.z0 + WIN.z1) / 2); top.castShadow = true;
  for (const z of [WIN.z0, WIN.z1]) { const s = mk(new THREE.BoxGeometry(T, WIN.y1, .02), reveal); s.position.set(X0 - T / 2, WIN.y1 / 2, z); s.castShadow = true; }
  for (const z of [WIN.z0 + .02, (WIN.z0 + WIN.z1) / 2, WIN.z1 - .02]) { const m = mk(new THREE.BoxGeometry(.05, WIN.y1, .045), frame); m.position.set(X0 - T + .04, WIN.y1 / 2, z); m.castShadow = true; }
  for (const y of [.02, WIN.y1 - .03]) { const m = mk(new THREE.BoxGeometry(.05, .05, hz1 - hz0), frame); m.position.set(X0 - T + .04, y, (WIN.z0 + WIN.z1) / 2); }
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: skyTex(), toneMapped: false, color: 0xffffff })); sky.rotation.y = Math.PI / 2; sky.position.set(X0 - 3.5, 1.6, -2.2); scene.add(sky);
  // плинтус
  const bmat = new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: .6 });
  const bb = (w, x, z, ry) => { const m = mk(new THREE.BoxGeometry(w, .08, .015), bmat); m.position.set(x, .04, z); m.rotation.y = ry; m.castShadow = true; };
  bb(W, 0, Z0 + .008, 0); bb(D, X1 - .008, Z0 + D / 2, Math.PI / 2); bb(WIN.z0 - Z0, X0 + .008, (Z0 + WIN.z0) / 2, Math.PI / 2); bb(Z1 - WIN.z1, X0 + .008, (WIN.z1 + Z1) / 2, Math.PI / 2);
  let furn = []; let blobs = []; let sceneName = 'living';

  // отражение
  const rs = lowp ? 512 : 1024;
  const refl = new Reflector(new THREE.PlaneGeometry(W, D), { textureWidth: rs, textureHeight: rs, clipBias: .003, shader: ReflShader, multisample: lowp ? 0 : 4 });
  refl.material.transparent = true; refl.material.depthWrite = false; refl.material.uniforms.res.value.set(rs, rs);
  refl.rotation.x = -Math.PI / 2; refl.position.set(0, .0015, Z0 + D / 2); refl.renderOrder = 2; scene.add(refl);

  // камера
  const views = {
    floor: { p: new THREE.Vector3(.35, 1.65, 1.55), t: new THREE.Vector3(-.35, .1, -2.2), fov: 50 },
    walls: { p: new THREE.Vector3(.2, 1.45, 1.4), t: new THREE.Vector3(-.15, 1.3, -4.2), fov: 50 },
    both: { p: new THREE.Vector3(1.9, 1.55, 1.5), t: new THREE.Vector3(-1.0, .85, -3.2), fov: 52 },
    close: { p: new THREE.Vector3(-.6, .75, -1.4), t: new THREE.Vector3(-1.2, 0, -2.4), fov: 45 }
  };
  const cur = { p: views.floor.p.clone(), t: views.floor.t.clone(), fov: 50 };
  let tw = null, mouse = { x: 0, y: 0 }, visible = true, dirty = true;
  function go(name, instant) { const v = views[name]; if (RM || instant) { cur.p.copy(v.p); cur.t.copy(v.t); cur.fov = v.fov; dirty = true; return; }
    tw = { from: { p: cur.p.clone(), t: cur.t.clone(), fov: cur.fov }, to: v, t0: performance.now(), dur: 1600 }; kick(); }
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true; kick(); }
  new ResizeObserver(resize).observe(host);
  let userYaw = 0, userPitch = 0, userZoom = 1, dragging = false;
  const pointers = new Map();
  host.style.touchAction = 'none';
  host.addEventListener('pointerdown', e => {
    host.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { dragging = true; host.classList.add('is-drag'); }
  });
  host.addEventListener('pointermove', e => {
    const r = host.getBoundingClientRect();
    if (!dragging && pointers.size < 2) {
      mouse.x = (e.clientX - r.left) / r.width - .5; mouse.y = (e.clientY - r.top) / r.height - .5; kick(); return;
    }
    const prev = pointers.get(e.pointerId); if (!prev) return;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts2 = [...pointers.values()];
      const d1 = Math.hypot(pts2[0].x - pts2[1].x, pts2[0].y - pts2[1].y);
      if (d0 > 4) userZoom = Math.min(2.6, Math.max(0.75, userZoom * (d1 / d0)));
      dirty = true; kick(); return;
    }
    userYaw -= (e.clientX - prev.x) * 0.005;
    userPitch += (e.clientY - prev.y) * 0.0035;
    userPitch = Math.max(-0.7, Math.min(0.7, userPitch));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dirty = true; kick();
  });
  const endPtr = e => { pointers.delete(e.pointerId); if (!pointers.size) { dragging = false; host.classList.remove('is-drag'); } };
  host.addEventListener('pointerup', endPtr); host.addEventListener('pointercancel', endPtr);
  host.addEventListener('pointerleave', () => { if (!dragging) { mouse.x = mouse.y = 0; kick(); } });
  host.addEventListener('wheel', e => {
    e.preventDefault();
    userZoom = Math.min(2.6, Math.max(0.75, userZoom * (e.deltaY > 0 ? 0.91 : 1.1)));
    dirty = true; kick();
  }, { passive: false });
  host.addEventListener('dblclick', () => { userYaw = userPitch = 0; userZoom = 1; dirty = true; kick(); });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(host);
  const sm = { x: 0, y: 0 }; let raf = 0, t0 = performance.now(), frames = 0;
  function kick() { if (!raf && visible) raf = requestAnimationFrame(loop); }
  function loop(now) {
    raf = 0; let anim = false;
    if (tw) { const k = Math.min(1, (now - tw.t0) / tw.dur), e = ease(k); cur.p.lerpVectors(tw.from.p, tw.to.p, e); cur.t.lerpVectors(tw.from.t, tw.to.t, e); cur.fov = tw.from.fov + (tw.to.fov - tw.from.fov) * e; if (k >= 1) tw = null; anim = true; }
    if (!RM && !dragging) { const dx = mouse.x - sm.x, dy = mouse.y - sm.y; if (Math.abs(dx) + Math.abs(dy) > .0005) { sm.x += dx * .08; sm.y += dy * .08; anim = true; } }
    const drift = (RM || dragging) ? 0 : Math.sin((now - t0) / 2400) * .03;
    const look = cur.t, dir = cur.p.clone().sub(cur.t);
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += userYaw + sm.x * .2;
    sph.phi = THREE.MathUtils.clamp(sph.phi + userPitch - sm.y * .12, 0.18, Math.PI * 0.48);
    sph.radius = THREE.MathUtils.clamp(sph.radius / userZoom, 0.85, 7);
    const pos = look.clone().add(new THREE.Vector3().setFromSpherical(sph));
    cam.position.set(pos.x + drift, pos.y, pos.z); cam.lookAt(look.x, look.y, look.z);
    if (cam.fov !== cur.fov) { cam.fov = cur.fov; cam.updateProjectionMatrix(); }
    if (anim || dirty || !RM) { renderer.render(scene, cam); dirty = false; frames++; }
    if ((anim || !RM) && visible) kick();
  }
  function clearFurn() {
    furn.forEach(m => {
      scene.remove(m);
      m.traverse?.(obj => {
        obj.geometry && obj.geometry.dispose && obj.geometry.dispose();
        if (obj.material) [].concat(obj.material).forEach(mat => { mat.map && mat.map.dispose && mat.map.dispose(); mat.dispose && mat.dispose(); });
      });
    });
    furn = [];
  }
  function loadScene(name) {
    const nextName = name || 'living';
    const nextList = [];
    try {
      const built = nextName === 'bath' ? buildBath(scene, nextList) : nextName === 'kitchen' ? buildKitchen(scene, nextList) : buildFurniture(scene, nextList);
      clearFurn();
      furn = nextList; blobs = built.blobs; sceneName = nextName; rebuild();
    } catch (err) {
      console.error('room scene', err);
      nextList.forEach(m => scene.remove(m));
    }
  }

  // плитка
  const state = { img: null, format: '60×60', surface: 'Матовая', mode: 'floor', grout: '#b9b2a7', groutMM: 2, pattern: 'straight', full: false, seed: 1, floor: null };
  const ppm = lowp ? 380 : 760;
  function texFrom(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxA; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
  const old = [];
  function rebuild() {
    if (!state.img) return;
    try {
      const next = [];
      const [a, b] = state.format.split('×').map(v => +v / 100);
      const tile = { tw: Math.max(a, b), th: Math.min(a, b) };
      const base = { img: state.img, grout: state.groutMM, groutColor: state.grout, pattern: state.pattern, full: state.full };
      // пол: своя плитка/шаблон пола, если выбран, иначе та же плитка
      const F = state.floor && state.floor.img ? state.floor : null;
      const fdim = F ? F.format.split('×').map(v => +v / 100) : [a, b];
      const fbase = F ? { img: F.img, grout: state.groutMM, groutColor: state.grout, pattern: F.pattern || state.pattern, full: F.full } : base;
      const fl = layTiles({ ...fbase, tw: Math.max(fdim[0], fdim[1]), th: Math.min(fdim[0], fdim[1]), aw: W, ah: D, ppm, seed: state.seed, ao: (x, cw, ch, p) => aoEdges(x, cw, ch, p, ['l', 'r', 't'], blobs) });
      const ft = texFrom(fl); next.push(ft);
      const fsurf = F ? (F.surface || '') : state.surface;
      const gl = /Глянец|Полир/i.test(fsurf), sat = /Сатин|Карвинг/i.test(fsurf);
      const wgl = /Глянец|Полир/i.test(state.surface), wsat = /Сатин|Карвинг/i.test(state.surface);
      const tiledWalls = state.mode !== 'floor', wppm = ppm * .6;
      const wallCanvases = {};
      const wall = (aw, key, edges, seed) => {
        const c = tiledWalls ? layTiles({ ...base, tw: Math.min(a, b), th: Math.max(a, b), aw, ah: H, ppm: wppm, seed, ao: (x, cw, ch, p) => aoEdges(x, cw, ch, p, edges) })
          : (() => { const c = plaster(Math.round(aw * 160), Math.round(H * 160), seed); aoEdges(c.getContext('2d'), c.width, c.height, 160, edges); return c; })();
        const tex = texFrom(c); next.push(tex); wallCanvases[key] = tex;
      };
      wall(W, 'back', ['l', 'r', 'b', 't'], 21); wall(D, 'right', ['l', 'b', 't'], 22); wall(D, 'left', ['r', 'b', 't'], 23);
      old.forEach(tex => tex.dispose()); old.length = 0; old.push(...next);
      floorMat.map = ft;
      floorMat.roughness = gl ? .12 : sat ? .38 : .72; floorMat.clearcoat = gl ? .6 : 0; floorMat.clearcoatRoughness = .08; floorMat.specularIntensity = gl ? 1 : .5;
      refl.material.uniforms.opacity.value = gl ? .42 : sat ? .14 : 0; refl.material.uniforms.blur.value = gl ? 1.2 : 3.5; refl.visible = gl || sat;
      floorMat.needsUpdate = true;
      for (const key of ['back', 'right', 'left']) {
        wallMats[key].map = wallCanvases[key]; wallMats[key].roughness = tiledWalls ? (wgl ? .2 : wsat ? .45 : .8) : .95; wallMats[key].needsUpdate = true;
      }
    } catch (err) { console.error('room rebuild', err); }
    dirty = true; kick();
  }
  loadScene('living');
  resize(); go('floor', true); kick();
  return {
    setTile(img, info) { state.img = img; state.format = info.format; state.surface = info.surface; state.full = !!info.full; state.seed = (state.seed * 7 + 3) % 997; rebuild(); },
    setFloor(img, info) { state.floor = img ? { img, format: (info && info.format) || state.format, surface: (info && info.surface) || 'Матовая', full: !(info && info.full === false) } : null; rebuild(); },
    getState() { return { mode: state.mode, pattern: state.pattern, format: state.format, floor: state.floor ? { format: state.floor.format, surface: state.floor.surface } : null, scene: sceneName }; },
    setMode(m) { const changed = (m === 'floor') !== (state.mode === 'floor'); state.mode = m; if (changed) rebuild(); go(m); },
    setGrout(c) { state.grout = c; rebuild(); }, setGroutMM(v) { state.groutMM = v; rebuild(); }, setPattern(p) { state.pattern = p; rebuild(); },
    setScene(name) { if (name && name !== sceneName) loadScene(name); },
    resetView() { userYaw = 0; userPitch = 0; userZoom = 1; dirty = true; kick(); },
    download(name) {
      renderer.render(scene, cam);
      const a = document.createElement('a');
      a.href = renderer.domElement.toDataURL('image/png');
      a.download = (name || 'room').replace(/[^\wа-яё\-]+/gi, '_') + '.png';
      a.click();
    },
    view: go, renderer, stats: () => ({ frames, ms: performance.now() - t0 }),
    layoutPreview(cv, opts2) {
      if (!state.img) return; const [a, b] = state.format.split('×').map(v => +v / 100);
      const c = layTiles({ img: state.img, tw: Math.max(a, b), th: Math.min(a, b), aw: 2.4, ah: 2.4 * cv.height / cv.width, ppm: cv.width / 2.4, grout: Math.max(state.groutMM, 1), groutColor: state.grout, pattern: state.pattern, full: state.full, seed: state.seed });
      cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height);
    }
  };
}
window.CatalogRoom = { createRoom };
