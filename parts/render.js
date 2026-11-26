/* =========================================================================
   РЕНДЕР: свои камеры (сверху / фронт / грядка / растение / свободно)
   ========================================================================= */
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize(){
  const cw = canvas.clientWidth || window.innerWidth || 0;
  const ch = canvas.clientHeight || window.innerHeight || 0;
  if (cw < 2 || ch < 2) return false;           // контейнер ещё не разложен
  DPR = Math.min(2, window.devicePixelRatio||1);
  W = cw; H = ch;
  canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  return true;
}
// canvas мог получить размер уже после загрузки (iframe/превью) — чиним на каждом кадре
function ensureSize(){
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw > 1 && ch > 1 && (cw !== W || ch !== H)) { resize(); _view = null; }
}
window.addEventListener('resize', resize);

/* Камера. Все перспективные виды (грядка / растение / свободный) используют одно
   состояние: точку взгляда target, наклон pitch, дистанцию dist и зум.
   Кнопки вида лишь ПЕРЕВОДЯТ камеру в нужное положение — плавно (camTween),
   поэтому при перетаскивании ничего не прыгает.                          */
const cam = {
  mode:'free',
  yaw:-0.62, pitch:0.26, dist:7.4, zoom:1.05, plant:0,
  target:{x:2, y:1.1, z:1.5},
  vel:{yaw:0, pitch:0}
};
const CAM_HOME = {yaw:-0.62, pitch:0.26, dist:7.4, zoom:1.05, target:{x:2, y:1.1, z:1.5}};
/* Наклон камеры. Отрицательный — взгляд снизу вверх (на крышу и небо),
   положительный — сверху вниз. Раньше минимум был 0.05, то есть из
   домашнего ракурса (0.26) вверх оставалось всего ~12° — и поворот
   «упирался» почти сразу.                                          */
const PITCH_MIN = -0.32, PITCH_MAX = 1.32;
const CAM_FLOOR_Y = 0.18;      // ниже этого камера не опускается
let camTween = null;

/* положение камеры для вида: то, куда её нужно поставить */
function camPreset(mode){
  if (mode === 'bed')   return {yaw:cam.yaw, pitch:0.20, dist:4.2, zoom:1, target:{x:2, y:0.75, z:1.05}};
  if (mode === 'plant'){
    const p = selPlant(), C = CROPS[world.crop];
    const y = Math.max(0.5, Math.min(C.ridgeY||1.6, 0.06 + p.nPhy*C.internode*0.8)*0.55);
    return {yaw:cam.yaw, pitch:0.12, dist:1.9, zoom:1, target:{x:p.x, y, z:p.z}};
  }
  return {yaw:CAM_HOME.yaw, pitch:CAM_HOME.pitch, dist:CAM_HOME.dist, zoom:CAM_HOME.zoom, target:{...CAM_HOME.target}};
}
/* плавный переход камеры к положению (используется кнопками вида и сбросом) */
function camTo(to, dur){
  const dst = {yaw:to.yaw, pitch:to.pitch, dist:to.dist, zoom:to.zoom,
               x:(to.tx!==undefined?to.tx:to.x), y:(to.ty!==undefined?to.ty:to.y),
               z:(to.tz!==undefined?to.tz:to.z)};
  camTween = {t:0, dur:dur||0.36, to:dst,
    from:{yaw:cam.yaw, pitch:cam.pitch, dist:cam.dist, zoom:cam.zoom,
          x:cam.target.x, y:cam.target.y, z:cam.target.z}};
  cam.vel.yaw = 0; cam.vel.pitch = 0;
}
function camStep(dt){
  if (camTween){
    camTween.t += dt;
    const k = clamp(camTween.t/camTween.dur, 0, 1);
    const e = 1 - Math.pow(1-k, 3);
    const f = camTween.from, t = camTween.to;
    cam.yaw   = lerp(f.yaw, t.yaw, e);
    cam.pitch = lerp(f.pitch, t.pitch, e);
    cam.dist  = lerp(f.dist, t.dist, e);
    cam.zoom  = lerp(f.zoom, t.zoom, e);
    cam.target = {x:lerp(f.x,t.x,e), y:lerp(f.y,t.y,e), z:lerp(f.z,t.z,e)};
    if (k >= 1) camTween = null;
    return;
  }
  // инерция после отпускания мыши/пальца
  if (Math.abs(cam.vel.yaw) > 1e-4 || Math.abs(cam.vel.pitch) > 1e-4){
    cam.yaw += cam.vel.yaw;
    cam.pitch = clamp(cam.pitch + cam.vel.pitch, PITCH_MIN, PITCH_MAX);
    cam.vel.yaw *= 0.88; cam.vel.pitch *= 0.88;
    if (Math.abs(cam.vel.yaw) < 1e-4 && Math.abs(cam.vel.pitch) < 1e-4) cam.vel = {yaw:0, pitch:0};
  }
}
/* сдвиг точки взгляда (панорама правой кнопкой / двумя пальцами) */
function camPan(dx, dz){
  const m = 1.8;
  cam.target.x = clamp(cam.target.x + dx, -m, 4 + m);
  cam.target.z = clamp(cam.target.z + dz, -m, 3 + m);
}
let dataLayer = false;
let _halftonePat = null;                  // раскраска кроны по освещённости

/* шкала освещённости: тёмно-синий → голубой → зелёный → жёлтый → красный */
function heatColor(v){
  const t = clamp(v, 0, 1);
  const stops = [[10,26,70],[24,110,180],[46,186,124],[238,216,72],[236,84,58]];
  const f = t*(stops.length-1), i = Math.min(stops.length-2, Math.floor(f)), w = f-i;
  const a = stops[i], b = stops[i+1];
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*w)},${Math.round(a[1]+(b[1]-a[1])*w)},${Math.round(a[2]+(b[2]-a[2])*w)})`;
}

function selPlant(){ return world.plants[cam.plant] || world.plants[0]; }

/* Описание активной камеры. Перспектива — для свободного вида,
   ортогональные проекции — для плана и фронта. */
function buildView(){
  const p = selPlant();
  const C = CROPS[world.crop];
  if (cam.mode === 'top'){
    const S = Math.min(W/5.4, H/4.6)*cam.zoom;
    return {ortho:true, kind:'top', S, cx:2, cy:1.5};
  }
  if (cam.mode === 'front'){
    // вписываем и ширину (4 м), и высоту конструкции (~3.3 м)
    const S = Math.min(W/5.4, (H*0.80)/3.5)*cam.zoom;
    return {ortho:true, kind:'front', S, cx:2, baseY:Math.min(H*0.90, H*0.5 + 3.3*S*0.5)};
  }
  const pp = clamp(cam.pitch, PITCH_MIN, PITCH_MAX);
  const d = cam.dist/cam.zoom;
  if (cam.mode === 'bed'){
    return persp(liftTarget({x:2, y:0.75, z:1.05}, d, pp), d, cam.yaw, pp);
  }
  if (cam.mode === 'plant'){
    const y = Math.min(C.ridgeY||1.6, 0.06 + p.nPhy*C.internode*0.8)*0.55;
    return persp(liftTarget({x:p.x, y:Math.max(0.5,y), z:p.z}, d, pp), d, cam.yaw, pp);
  }
  return persp(liftTarget(cam.target, d, pp), d, cam.yaw, pp);
}
/* Каким будет положение камеры при данном ракурсе: точка взгляда + dist
   назад по направлению взгляда. При отрицательном наклоне камера уходит
   ниже пола, поэтому точку взгляда поднимаем — камера остаётся у земли,
   а сцена «запрокидывает голову». Дистанция и фокусное при этом не меняются,
   так что это честный поворот, без подъезда и скачков масштаба.          */
function liftTarget(t, dist, pitch){
  if (pitch >= 0) return t;
  const camY = t.y + dist*Math.sin(pitch);
  if (camY >= CAM_FLOOR_Y) return t;
  return {x:t.x, y:CAM_FLOOR_Y - dist*Math.sin(pitch), z:t.z};
}
function persp(target, dist, yaw, pitch){
  // фокусное подбираем по «узкой» стороне: на телефоне в портрете сцена иначе
  // ужимается до пятачка посреди экрана
  const portrait = H > W*1.15;
  const fit = (portrait ? Math.min(W*1.35, H*0.8) : Math.min(W*1.15, H))/700;
  // на телефоне снизу кадр занимают панель камеры и док: поднимаем оптический
  // центр, иначе сцена (особенно при взгляде вверх) прячется под кнопками
  const oy = portrait ? H*0.075 : 0;
  return {ortho:false, target, dist, yaw, pitch, f:780*clamp(fit, 0.45, 1.25), oy};
}

let _view = null;                       // инициализируется лениво (world создаётся позже)
function refreshView(){ _view = buildView(); }

function project(p){
  if (!_view) refreshView();
  const v = _view;
  if (v.ortho){
    if (v.kind === 'top'){
      const s = v.S;
      return {x: W/2 + (p.x - v.cx)*s, y: H/2 + (p.z - v.cy)*s, s, z: -p.y};
    }
    const s = v.S;
    return {x: W/2 + (p.x - v.cx)*s, y: v.baseY - p.y*s, s, z: p.z};
  }
  const dx = p.x-v.target.x, dy = p.y-v.target.y, dz = p.z-v.target.z;
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  const x1 = dx*cy - dz*sy, z1 = dx*sy + dz*cy;
  const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const y2 = dy*cp - z1*sp, z2 = dy*sp + z1*cp;
  const zz = z2 + v.dist;
  const s = v.f/Math.max(0.25, zz);
  return {x: W/2 + x1*s, y: H/2 - (v.oy||0) - y2*s, s, z: zz};
}
function depthOf(p){ return project(p).z; }

/* ---------- примитивы ---------- */
function poly(pts3, fill, stroke, lw){
  if (!pts3 || pts3.length<3) return;
  ctx.beginPath();
  for (let i=0;i<pts3.length;i++){
    const q = project(pts3[i]);
    if (i===0) ctx.moveTo(q.x,q.y); else ctx.lineTo(q.x,q.y);
  }
  ctx.closePath();
  if (fill){ ctx.fillStyle = fill; ctx.fill(); }
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw||1; ctx.stroke(); }
}
function line3(a,b,color,lw){
  const pa = project(a), pb = project(b);
  ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y);
  ctx.strokeStyle = color; ctx.lineWidth = lw||1; ctx.stroke();
}
function dot3(p, r, fill, stroke, lw){
  const q = project(p);
  const rr = Math.max(1, r*q.s);
  ctx.beginPath(); ctx.arc(q.x,q.y,rr,0,6.2832);
  if (fill){ ctx.fillStyle = fill; ctx.fill(); }
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw||2; ctx.stroke(); }
  return q;
}

function skyColor(){
  // палитра Borderlands: днём — горчичное небо с рыжиной, ночью — глухой сине-фиолетовый
  const day = clamp(Math.sin((world.hour-5.2)/13.5*Math.PI), 0, 1);
  const dawn = clamp(1-Math.abs(world.hour-6.4)/2.2,0,1);
  const cloud = world.light.cloud||0;
  const r = lerp(26, 224, day)+18*dawn-40*cloud;
  const g = lerp(18, 168, day)+12*dawn-34*cloud;
  const b = lerp(32, 66, day)-6*dawn-18*cloud;
  return `rgb(${Math.max(0,r)|0},${Math.max(0,g)|0},${Math.max(0,b)|0})`;
}
function drawBackground(){
  const g = ctx.createLinearGradient(0,0,0,H*0.75);
  g.addColorStop(0, skyColor());
  g.addColorStop(1, '#5a3a12');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  // «лучи» — грубые клинья из центра кадра, как в комиксе
  const day = clamp(Math.sin((world.hour-5.2)/13.5*Math.PI), 0, 1);
  if (day > 0.05 && !(world.profile==='room'||world.profile==='balcony')){
    ctx.save();
    ctx.globalAlpha = 0.16*day;
    ctx.fillStyle = '#fff0b0';
    const cx = W*0.5, cy = H*0.30;
    for (let i=0;i<11;i++){
      const a0 = i/11*6.2832 + world.hour*0.05, a1 = a0 + 0.14;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.lineTo(cx+Math.cos(a0)*W, cy+Math.sin(a0)*W);
      ctx.lineTo(cx+Math.cos(a1)*W, cy+Math.sin(a1)*W);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  // полутон: точки в небе (паттерн кэшируется, иначе это 40 000 заливок на кадр)
  if (!_halftonePat){
    const pc = document.createElement('canvas'); pc.width = 8; pc.height = 8;
    const px = pc.getContext('2d');
    px.fillStyle = '#2a1400'; px.fillRect(1,1,2,2); px.fillRect(5,5,2,2);
    _halftonePat = ctx.createPattern(pc, 'repeat');
  }
  ctx.save(); ctx.globalAlpha = 0.13; ctx.fillStyle = _halftonePat;
  ctx.fillRect(0,0,W,H);
  ctx.restore();
}

function leafColor(lf){
  if (dataLayer) return heatColor(lf.Iabs/700);
  const L = clamp(lf.Iabs/420, 0, 1);
  // желтеют только старые листья на свету; в тени лист остаётся тёмно-зелёным
  const ageYellow = clamp((lf.age-45)/25, 0, 1) * clamp(1-lf.relLight*1.2, 0.25, 1);
  const Lq = Math.round(L*3)/3;           // 4 плоских тона вместо градиента
  let r = lerp(38, 152, Lq), g = lerp(74, 222, Lq), b = lerp(42, 96, Lq);
  r = lerp(r, 150, ageYellow*0.45); g = lerp(g, 138, ageYellow*0.30); b = lerp(b, 52, ageYellow*0.40);
  if (lf.dead){ r=92; g=80; b=44; }
  return `rgb(${r|0},${g|0},${b|0})`;
}

/* ---------- основная сцена ---------- */
function drawScene(){
  refreshView();
  drawBackground();
  const C = CROPS[world.crop];
  const interior = (world.profile==='room' || world.profile==='balcony');
  const items = [];
  const orthoTop = _view.ortho && _view.kind==='top';

  // земля: заливка от линии горизонта вниз (в экранных координатах — устойчиво)
  if (!_view.ortho){
    // линия горизонта. Наклон вниз — как раньше (светлое «за стеклом» держится
    // в кадре). Наклон вверх — уходит вниз кадра, чтобы вверху было небо, а не пол.
    const yHor = H/2 - (_view.oy||0) + _view.f*Math.abs(Math.tan(_view.pitch));
    const top = Math.max(0, Math.min(H, yHor));
    const g = ctx.createLinearGradient(0, Math.max(0,yHor - H*0.1), 0, H);
    g.addColorStop(0, '#4a2f14');
    g.addColorStop(0.4, '#33200f');
    g.addColorStop(1, '#1d1208');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H-top);          // при взгляде сверху земля занимает весь кадр
    if (yHor > 0 && yHor < H){
      ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, yHor); ctx.lineTo(W, yHor); ctx.stroke();
    }
  }
  // пол теплицы
  poly([{x:0,y:0,z:0},{x:CFG.floorW,y:0,z:0},{x:CFG.floorW,y:0,z:CFG.floorD},{x:0,y:0,z:CFG.floorD}],
       '#2b1c0e','#0a0806',2.5);
  if (interior && !_view.ortho){
    // потолок: без него при взгляде снизу вверх комната выглядела как открытая
    // площадка — стена обрывалась в небо. Рисуем до растений: они ближе.
    poly([{x:0,y:2.7,z:0},{x:CFG.floorW,y:2.7,z:0},
          {x:CFG.floorW,y:2.7,z:CFG.floorD},{x:0,y:2.7,z:CFG.floorD}],
         '#6b4d23','#0a0806',3.5);
    for (let i=1;i<4;i++){
      const z = i*(CFG.floorD/4);
      line3({x:0,y:2.68,z},{x:CFG.floorW,y:2.68,z}, '#0f0a05', 2.5);
    }
    for (let i=1;i<3;i++){
      const x = i*(CFG.floorW/3);
      line3({x,y:2.68,z:0},{x,y:2.68,z:CFG.floorD}, '#0f0a05', 2);
    }
    // лампа на потолке — ориентир: видно, что смотрим вверх
    poly([{x:1.55,y:2.66,z:1.35},{x:2.45,y:2.66,z:1.35},{x:2.45,y:2.66,z:1.65},{x:1.55,y:2.66,z:1.65}],
         '#2a1d0e','#0a0806',2);
    // стена комнаты с окном — рисуем сразу за полом, иначе она закрывает растения
    poly([{x:0,y:2.7,z:CFG.floorD},{x:CFG.floorW,y:2.7,z:CFG.floorD},
          {x:CFG.floorW,y:0,z:CFG.floorD},{x:0,y:0,z:CFG.floorD}],
       '#7a5426','#0a0806',3.5);
    const dayL = clamp(Math.sin((world.hour-5.2)/13.5*Math.PI), 0, 1);
    const winLit = `rgb(${Math.round(lerp(56,255,dayL))},${Math.round(lerp(58,232,dayL))},${Math.round(lerp(92,150,dayL))})`;
    poly([{x:2.45,y:2.05,z:CFG.floorD-0.03},{x:3.65,y:2.05,z:CFG.floorD-0.03},
          {x:3.65,y:0.62,z:CFG.floorD-0.03},{x:2.45,y:0.62,z:CFG.floorD-0.03}],
       winLit,'#0a0806',4);
    poly([{x:3.045,y:2.05,z:CFG.floorD-0.04},{x:3.075,y:2.05,z:CFG.floorD-0.04},
          {x:3.075,y:0.62,z:CFG.floorD-0.04},{x:3.045,y:0.62,z:CFG.floorD-0.04}],
       '#0a0806', null, 0);
    poly([{x:2.45,y:1.345,z:CFG.floorD-0.04},{x:3.65,y:1.345,z:CFG.floorD-0.04},
          {x:3.65,y:1.325,z:CFG.floorD-0.04},{x:2.45,y:1.325,z:CFG.floorD-0.04}],
       '#0a0806', null, 0);
    // тёплый пол — доски
    for (let i=0;i<7;i++){
      const z0 = i*(CFG.floorD/7)+0.05, z1 = z0 + CFG.floorD/7 - 0.06;
      poly([{x:0.05,y:0.002,z:z0},{x:CFG.floorW-0.05,y:0.002,z:z0},
            {x:CFG.floorW-0.05,y:0.002,z:z1},{x:0.05,y:0.002,z:z1}],
           i%2? '#3a2712':'#452e16', '#1a1108', 1);
    }
  }

  // желоба (2 ряда) — только в теплице
  if (!interior) for (let r=0;r<2;r++){
    const z0 = 0.78+r*1.05, z1 = z0+0.28;
    items.push({z: depthOf({x:2,y:0.16,z:(z0+z1)/2}), draw(){
      poly([{x:0.25,y:0.16,z:z0},{x:3.75,y:0.16,z:z0},{x:3.75,y:0.16,z:z1},{x:0.25,y:0.16,z:z1}],
           '#4a3a1e','#0a0806',2);
      poly([{x:0.25,y:0,z:z0},{x:3.75,y:0,z:z0},{x:3.75,y:0.16,z:z0},{x:0.25,y:0.16,z:z0}],'#2a1d0e','#0a0806',2);
    }});
  }

  // каркас
  if (!orthoTop && !interior){
    for (let i=0;i<=4;i++){
      const x = i*(CFG.floorW/4);
      const a0={x,y:0,z:0}, a1={x,y:CFG.eaveY,z:0};
      const b0={x,y:0,z:CFG.floorD}, b1={x,y:CFG.eaveY,z:CFG.floorD};
      items.push({z:depthOf({x,y:1.2,z:0}), draw(){
        line3(a0,a1,'#0a0806',4.5); line3(a0,a1,'#d8cba8',2); }});
      items.push({z:depthOf({x,y:1.2,z:CFG.floorD}), draw(){
        line3(b0,b1,'#0a0806',4); line3(b0,b1,'#b9ab8a',1.7); }});
    }
    items.push({z: depthOf({x:2,y:2.5,z:1.5})*0.99, draw(){
      line3({x:0,y:CFG.eaveY,z:0},{x:CFG.floorW,y:CFG.eaveY,z:0},'#0a0806',3);
      line3({x:0,y:CFG.eaveY,z:CFG.floorD},{x:CFG.floorW,y:CFG.eaveY,z:CFG.floorD},'#0a0806',3);
      line3({x:0,y:CFG.ridgeY,z:CFG.floorD/2},{x:CFG.floorW,y:CFG.ridgeY,z:CFG.floorD/2},'#0a0806',5);
      line3({x:0,y:CFG.ridgeY,z:CFG.floorD/2},{x:CFG.floorW,y:CFG.ridgeY,z:CFG.floorD/2},'#e8d9b0',2.2);
      for (let i=0;i<=4;i++){
        const x = i*(CFG.floorW/4);
        line3({x,y:CFG.eaveY,z:0},{x,y:CFG.ridgeY,z:CFG.floorD/2},'#0a0806',2.4);
        line3({x,y:CFG.eaveY,z:CFG.floorD},{x,y:CFG.ridgeY,z:CFG.floorD/2},'#0a0806',2.4);
      }
    }});
  }

  // досветка
  if (world.light.lampOn){
    for (let i=0;i<4;i++){
      const x = 0.6+i*0.94;
      items.push({z: depthOf({x, y:CFG.ridgeY-0.42, z:1.5}), draw(){
        poly([{x:x-0.1,y:CFG.ridgeY-0.42,z:1.28},{x:x+0.1,y:CFG.ridgeY-0.42,z:1.28},
              {x:x+0.1,y:CFG.ridgeY-0.42,z:1.72},{x:x-0.1,y:CFG.ridgeY-0.42,z:1.72}],
              'rgba(255,235,170,.75)');
        const q = project({x, y:CFG.ridgeY-0.42, z:1.5});
        const g = ctx.createRadialGradient(q.x,q.y,2,q.x,q.y,150);
        g.addColorStop(0,'rgba(255,230,150,.12)'); g.addColorStop(1,'rgba(255,230,150,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(q.x,q.y,150,0,6.2832); ctx.fill();
      }});
    }
  }

  // растения
  for (let pi=0; pi<world.plants.length; pi++){
    const p = world.plants[pi];
    if (p.dead) continue;
    const isSel = pi===cam.plant;

    // ёмкость под растением: горшок с грунтом, бак с раствором, плита кокоса или корзина аэропоники
    items.push({z: depthOf({x:p.x, y:0.1, z:p.z}) + 0.02, draw(){
      drawVessel(project({x:p.x, y:0, z:p.z}));
    }});

    // стебель
    const pts = [{x:p.x, y:0.04, z:p.z}];
    for (let i=0;i<=p.nPhy;i++) pts.push({x:p.x+Math.sin(i*0.4)*0.006, y:nodeY(C,i), z:p.z+Math.cos(i*0.4)*0.006});
    items.push({z: depthOf({x:p.x, y:1.0, z:p.z}), draw(){
      ctx.beginPath();
      for (let i=0;i<pts.length;i++){ const q = project(pts[i]); if(i===0) ctx.moveTo(q.x,q.y); else ctx.lineTo(q.x,q.y); }
      ctx.lineCap='round';
      ctx.strokeStyle = '#0a0806'; ctx.lineWidth = Math.max(3.4, 4.6 + p.nPhy*0.10); ctx.stroke();
      ctx.strokeStyle = isSel ? '#c8ea70' : '#8f9a54';
      ctx.lineWidth = Math.max(1.2, 1.6 + p.nPhy*0.06); ctx.stroke();
      if (p.nPhy < C.maxPhy) dot3({x:p.x, y:nodeY(C,p.nPhy)+0.03, z:p.z}, 0.012, '#a8d06a');
    }});

    // листья
    for (const lf of p.leaves){
      if (lf.area < 2e-4 && !lf.dead) continue;
      const g = leafGeom(lf, C, p.x, nodeY(C, lf.i), p.z);
      items.push({z: depthOf(g.cen), draw(){
        poly(g.corners, leafColor(lf), '#0a0806', 1.7);
        if (!lf.dead) line3(g.base, g.tip, 'rgba(12,10,6,.55)', 1.1);
      }});
    }

    // плоды / головки
    if (C.leafy){
      const ready = p.head >= C.headTarget;
      items.push({z: depthOf({x:p.x,y:nodeY(C, Math.min(p.nPhy,6)),z:p.z}), draw(){
        const r = 0.05+0.08*clamp(p.head/C.headTarget,0,1);
        dot3({x:p.x, y:nodeY(C, Math.min(p.nPhy,6)), z:p.z}, r,
             ready? '#d8ec8e' : '#87ad4e', '#0a0806', 2.2);
      }});
    } else {
      for (const tr of p.trusses){
        for (let fi=0; fi<tr.fruits.length; fi++){
          const f = tr.fruits[fi];
          if (f.harvested) continue;
          const fr = clamp(f.mass/C.fruitSink, 0, 1);
          const r = 0.010 + 0.020*Math.cbrt(fr);
          const ang = 0.6+fi*1.05;
          const pos = {x:p.x+Math.cos(ang)*0.06*(1+fi*0.1),
                       y:nodeY(C, tr.i+1) - fi*0.03,
                       z:p.z+Math.sin(ang)*0.06*(1+fi*0.1)};
          items.push({z: depthOf(pos), draw(){
            const q = project(pos);
            const rr = Math.max(1.5, r*q.s);
            // цел-шейдинг: плоская заливка + чёрный контур + один блик
            const base = f.rot ? '#a8823f' : (f.ripe ? '#e8472a' : '#8fc154');
            ctx.beginPath(); ctx.arc(q.x,q.y,rr,0,6.2832);
            ctx.fillStyle = base; ctx.fill();
            ctx.strokeStyle = '#0a0806'; ctx.lineWidth = rr>10 ? 2.4 : 1.6; ctx.stroke();
            if (rr > 4){
              ctx.beginPath(); ctx.arc(q.x-rr*0.32,q.y-rr*0.34,rr*0.32,0,6.2832);
              ctx.fillStyle = 'rgba(255,246,214,.75)'; ctx.fill();
            }
          }});
        }
      }
    }
  }

  items.sort((a,b)=>b.z-a.z);
  for (const it of items) it.draw();

  // стекло / стена комнаты (только в перспективных видах)
  if (!_view.ortho){
    if (interior){
      // перила балкона — передний план
      if (world.profile === 'balcony'){
        poly([{x:0,y:0.95,z:0.06},{x:CFG.floorW,y:0.95,z:0.06},
              {x:CFG.floorW,y:0.88,z:0.06},{x:0,y:0.88,z:0.06}], '#8a6a34','#0a0806',3);
        for (let i=0;i<=8;i++){
          const x = i*(CFG.floorW/8);
          line3({x,y:0.88,z:0.06},{x,y:0.12,z:0.06},'#0a0806',3.5);
          line3({x,y:0.88,z:0.06},{x,y:0.12,z:0.06},'#c8a860',1.6);
        }
      }
    } else {
      poly([{x:0,y:CFG.eaveY,z:CFG.floorD},{x:CFG.floorW,y:CFG.eaveY,z:CFG.floorD},
            {x:CFG.floorW,y:0,z:CFG.floorD},{x:0,y:0,z:CFG.floorD}],
           'rgba(150,210,235,.05)','#0a0806',2.2);
      poly([{x:0,y:CFG.eaveY,z:0},{x:0,y:CFG.ridgeY,z:CFG.floorD/2},
            {x:CFG.floorW,y:CFG.ridgeY,z:CFG.floorD/2},{x:CFG.floorW,y:CFG.eaveY,z:0}],
           'rgba(160,215,240,.04)','#0a0806',2.2);
    }
  } else if (_view.kind === 'front'){
    // разрез: контур теплицы и уровень грунта
    ctx.beginPath();
    const A=project({x:0,y:0,z:0}), B=project({x:CFG.floorW,y:0,z:0});
    ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y);
    ctx.strokeStyle='rgba(122,216,160,.35)'; ctx.lineWidth=1.5; ctx.stroke();
    const R=project({x:CFG.floorW/2,y:CFG.ridgeY,z:0}), L=project({x:0,y:CFG.eaveY,z:0}), Rr=project({x:CFG.floorW,y:CFG.eaveY,z:0});
    ctx.beginPath(); ctx.moveTo(L.x,L.y); ctx.lineTo(R.x,R.y); ctx.lineTo(Rr.x,Rr.y);
    ctx.strokeStyle='rgba(160,220,240,.28)'; ctx.stroke();
    // шкала высоты
    for (let h=0; h<=3; h++){
      const q = project({x:0,y:h,z:0});
      ctx.fillStyle='rgba(122,216,160,.5)'; ctx.font='9px ui-monospace,monospace';
      ctx.fillText(h+' м', q.x-30, q.y+3);
      line3({x:0,y:h,z:0},{x:0.08,y:h,z:0},'rgba(122,216,160,.4)',1);
    }
  } else if (orthoTop){
    // план: сетка 1 м и подписи рядов
    ctx.strokeStyle='rgba(122,216,160,.08)'; ctx.lineWidth=1;
    for (let x=0;x<=CFG.floorW;x++) line3({x,y:0,z:0},{x,y:0,z:CFG.floorD},'rgba(122,216,160,.09)',1);
    for (let z=0;z<=CFG.floorD;z++) line3({x:0,y:0,z},{x:CFG.floorW,y:0,z},'rgba(122,216,160,.09)',1);
    ctx.fillStyle='rgba(122,216,160,.45)'; ctx.font='9px ui-monospace,monospace';
    const q0 = project({x:0,y:0,z:CFG.floorD});
    ctx.fillText('ПЛАН · площадь сцены 4×3 м · рендер-выборка', q0.x, q0.y+16);
  }

  // индикатор солнца
  const sun = world.light.sun || {x:0,y:1,z:0};
  const el = Math.asin(clamp(sun.y,-1,1));
  if (el > 0){
    const sx = W-104, sy = 96 - el*60;
    const gg = ctx.createRadialGradient(sx,sy,1,sx,sy,32);
    gg.addColorStop(0,'rgba(255,236,170,.9)'); gg.addColorStop(1,'rgba(255,210,120,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(sx,sy,32,0,6.2832); ctx.fill();
    ctx.fillStyle='rgba(30,40,30,.8)'; ctx.font='10px ui-monospace,monospace';
    ctx.fillText('☀ '+(el*180/Math.PI).toFixed(0)+'°', sx-15, sy+46);
  }
  // легенда слоя освещённости
  if (dataLayer){
    const lx = Math.max(220, W-470), ly = 78, lw = 170, lh = 30;
    ctx.fillStyle = 'rgba(6,16,12,.9)'; ctx.strokeStyle = 'rgba(122,216,160,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx,ly,lw,lh,7) : ctx.rect(lx,ly,lw,lh);
    ctx.fill(); ctx.stroke();
    const grad = ctx.createLinearGradient(lx+10, 0, lx+lw-10, 0);
    for (let i=0;i<=4;i++) grad.addColorStop(i/4, heatColor(i/4));
    ctx.fillStyle = grad; ctx.fillRect(lx+10, ly+9, lw-20, 6);
    ctx.fillStyle = 'rgba(214,240,224,.85)'; ctx.font = '9px ui-monospace,monospace';
    ctx.fillText('СВЕТ НА ЛИСТЕ, µmol/м²·с', lx+10, ly+25);
    ctx.fillText('0', lx+8, ly+7); ctx.fillText('700+', lx+lw-30, ly+7);
  }

  // подпись камеры
  ctx.fillStyle='rgba(122,216,160,.35)'; ctx.font='10px ui-monospace,monospace';
  const lbl = {top:'вид сверху · ортопроекция', front:'фронт · разрез', bed:'фокус: грядка', plant:'фокус: растение #'+(cam.plant+1), free:'свободное вращение'}[cam.mode];
  ctx.fillText(lbl, 14, H-14);
}

/* ---------- ёмкость под растением по системе выращивания ---------- */
function drawVessel(q){
  const sys = (world.sys || 'soil');
  const S = 0.026*0;                       // масштаб уже в q.s
  const w2 = Math.max(4, 0.13*q.s), h2 = Math.max(6, 0.20*q.s);
  const ink = '#0a0806';
  ctx.lineJoin = 'round';

  if (sys === 'coco'){
    // плита кокоса: приземистый параллелепипед + капельница сверху
    const bw = w2*1.35, bh = h2*0.62;
    ctx.beginPath();
    ctx.moveTo(q.x-bw, q.y); ctx.lineTo(q.x+bw, q.y);
    ctx.lineTo(q.x+bw, q.y-bh); ctx.lineTo(q.x-bw, q.y-bh);
    ctx.closePath();
    ctx.fillStyle = '#6b4a2a'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q.x, q.y-bh, bw, bh*0.28, 0, 0, 6.2832);
    ctx.fillStyle = '#8a6236'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    // капельница
    ctx.beginPath(); ctx.moveTo(q.x, q.y-bh*4.2); ctx.lineTo(q.x, q.y-bh*1.15);
    ctx.strokeStyle = ink; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(q.x, q.y-bh*0.95, Math.max(1.5, bh*0.16), 0, 6.2832);
    ctx.fillStyle = '#57c8ff'; ctx.fill();
    return;
  }
  if (sys === 'dwc' || sys === 'nft'){
    // бак/лоток: белый пластик, голубой раствор, пузырьки
    const bw = w2*1.12, bh = h2*1.15;
    ctx.beginPath();
    ctx.moveTo(q.x-bw, q.y); ctx.lineTo(q.x+bw, q.y);
    ctx.lineTo(q.x+bw*0.86, q.y-bh); ctx.lineTo(q.x-bw*0.86, q.y-bh);
    ctx.closePath();
    ctx.fillStyle = '#dcd7c4'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.stroke();
    // уровень раствора
    const lv = q.y-bh*0.52;
    ctx.beginPath(); ctx.rect(q.x-bw*0.92, lv, bw*1.84, (q.y-lv)*0.86);
    ctx.fillStyle = sys==='nft' ? '#2f7fd0' : '#3f93e0'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(q.x-bw*0.92, lv); ctx.lineTo(q.x+bw*0.92, lv);
    ctx.strokeStyle = ink; ctx.lineWidth = 1.8; ctx.stroke();
    // крышка с отверстием под корни
    ctx.beginPath(); ctx.ellipse(q.x, q.y-bh, bw*0.86, bh*0.22, 0, 0, 6.2832);
    ctx.fillStyle = '#efe9d8'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q.x, q.y-bh, bw*0.30, bh*0.10, 0, 0, 6.2832);
    ctx.fillStyle = '#2b2116'; ctx.fill();
    // пузырьки аэратора
    if (bh > 9){
      for (let i=0;i<3;i++){
        const bx = q.x + (i-1)*bw*0.45, by = q.y - bh*0.22 - (i%2)*bh*0.16;
        ctx.beginPath(); ctx.arc(bx, by, Math.max(1, bh*0.075), 0, 6.2832);
        ctx.fillStyle = 'rgba(240,250,255,.85)'; ctx.fill();
      }
    }
    return;
  }
  if (sys === 'aero'){
    // белая корзина-конус и туман
    ctx.beginPath();
    ctx.moveTo(q.x-w2*0.95, q.y-h2*0.15); ctx.lineTo(q.x+w2*0.95, q.y-h2*0.15);
    ctx.lineTo(q.x+w2*0.62, q.y-h2*1.05); ctx.lineTo(q.x-w2*0.62, q.y-h2*1.05);
    ctx.closePath();
    ctx.fillStyle = '#e8e3d2'; ctx.fill();
    ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.stroke();
    for (let i=0;i<3;i++){
      const bx = q.x + (i-1)*w2*0.55, by = q.y - h2*0.35 - (i%2)*h2*0.25;
      ctx.beginPath(); ctx.arc(bx, by, Math.max(1, h2*0.10), 0, 6.2832);
      ctx.fillStyle = 'rgba(220,240,255,.8)'; ctx.fill();
    }
    return;
  }
  // грунт: терракотовый горшок с землёй
  ctx.beginPath();
  ctx.moveTo(q.x-w2, q.y); ctx.lineTo(q.x+w2, q.y);
  ctx.lineTo(q.x+w2*0.72, q.y-h2); ctx.lineTo(q.x-w2*0.72, q.y-h2);
  ctx.closePath();
  ctx.fillStyle = '#b5552a'; ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(q.x, q.y-h2, w2*0.72, h2*0.20, 0, 0, 6.2832);
  ctx.fillStyle = '#2f2213'; ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
}

/* ---------- клики по сцене ---------- */
function hitTest(cx, cy){
  refreshView();
  const C = CROPS[world.crop];
  const rect = canvas.getBoundingClientRect();
  const x = cx-rect.left, y = cy-rect.top;
  // 1) плоды
  for (const p of world.plants) for (const tr of p.trusses){
    for (let fi=0; fi<tr.fruits.length; fi++){
      const f = tr.fruits[fi];
      if (f.harvested || !f.ripe) continue;
      const ang = 0.6+fi*1.05;
      const pos = {x:p.x+Math.cos(ang)*0.06*(1+fi*0.1), y:nodeY(C, tr.i+1)-fi*0.03, z:p.z+Math.sin(ang)*0.06*(1+fi*0.1)};
      const q = project(pos);
      const rr = Math.max(6, 0.03*q.s);
      if (Math.hypot(q.x-x, q.y-y) < rr+5) return {kind:'fruit', plant:p, fruit:f};
    }
  }
  // 2) листья
  for (const p of world.plants) for (const lf of p.leaves){
    if (lf.dead) continue;
    const g = leafGeom(lf, C, p.x, nodeY(C, lf.i), p.z);
    if (pointInPoly(x,y,g.corners.map(project))) return {kind:'leaf', plant:p, leaf:lf};
  }
  // 3) растение
  let best=null, bd=1e9;
  for (const p of world.plants){
    const q = project({x:p.x, y:nodeY(C, Math.min(p.nPhy,8))*0.5, z:p.z});
    const d = Math.hypot(q.x-x, q.y-y);
    if (d<bd){ bd=d; best=p; }
  }
  if (best && bd<64) return {kind:'plant', plant:best};
  return null;
}
/* подробности органа для всплывающей карточки */
function organInfo(hit){
  if (!hit) return null;
  const C = CROPS[world.crop];
  if (hit.kind==='fruit'){
    const f = hit.fruit;
    const grams = (f.mass/C.fruitSink)*C.fruitFresh*1000;
    return {title:'Плод', rows:[
      ['масса', Math.round(grams)+' г'],
      ['состояние', f.rot ? 'вершинная гниль' : (f.ripe ? 'спелый — можно снять' : 'зелёный')],
      ['кисть', '№'+(hit.plant.trusses.findIndex(t=>t.fruits.includes(f))+1)]
    ]};
  }
  if (hit.kind==='leaf'){
    const lf = hit.leaf;
    return {title:'Лист', rows:[
      ['возраст', Math.round(lf.age)+' дн'],
      ['площадь', lf.area.toFixed(3)+' м²'],
      ['свет', Math.round(lf.Iabs)+' µmol/м²·с'],
      ['ассимиляция', (lf.A||0).toFixed(1)+' µmol/м²·с'],
      ['ярус', 'фитомер '+lf.i]
    ]};
  }
  const p = hit.plant;
  const np = world.plants.indexOf(p)+1;
  const laiP = p.leaves.filter(l=>!l.dead).reduce((a,l)=>a+l.area,0);
  return {title:'Растение #'+np, rows:[
    ['фитомеров', p.nPhy],
    ['листьев', p.leaves.filter(l=>!l.dead).length],
    ['площадь листьев', laiP.toFixed(2)+' м²'],
    ['плодов', p.fruits.filter(f=>!f.harvested).length],
    ['углерод', p.carbonStatus.toFixed(1)]
  ]};
}

function pointInPoly(x,y,pts){
  let inside=false;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
    if (((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
