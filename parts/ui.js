/* =========================================================================
   UI: три страницы (Теплица / Магазин / Параметры), дашборд, прогноз
   ========================================================================= */
const $ = id => document.getElementById(id);
const CROP_ICON = { tomato:'#e05a4e', cherry:'#b8342f', cucumber:'#3f8f57', lettuce:'#7ac06a' };
const ic = c => `<svg width="11" height="11" viewBox="0 0 12 12" style="vertical-align:-1px" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${CROP_ICON[c.id]||'#7ad8a0'}" stroke="rgba(255,255,255,.5)" stroke-width="1"/></svg>`;
function moneyLabels(){
  document.querySelectorAll('[data-eur]').forEach(el=>{ el.textContent = money(+el.dataset.eur); });
}
function setCurrency(id){
  if (!CURS[id]) return;
  curId = id;
  try { if (typeof moneyLabels === 'function') moneyLabels(); } catch(e){}
  try { localStorage.setItem('vgCur', id); } catch(_){}
  renderAll(); if (page==='settings') renderSettings();
  toast('Валюта: ' + CURS[id].label + ' (' + CURS[id].note + ')');
}
const num = v => Math.round(v).toLocaleString('ru-RU');

let world = null;
let page = 'greenhouse';
let speed = 64, paused = false;   // скорость = игровых часов за реальную МИНУТУ
let acc = 0, lastT = performance.now(), uiT = 0;
let fc = null, endShown = false;
const pending = { profile:'farm', crop:'tomato', weather:'normal', difficulty:'normal', campaign:false, sys:'soil',
                  // где и когда начинаем: средняя полоса по умолчанию, дата — сегодняшняя
                  site:'ekb', orient:'S', startDoy:(typeof todayDoy==='function'?todayDoy():91) };

let toastTimer = 0;
function toast(msg){
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('on'), 1700);
}

/* ---------------- Звук: синтез в браузере, без файлов ----------------
   Ни одного mp3: всё собирается из осцилляторов и шума на WebAudio.
   Контекст создаётся только после первого действия игрока (иначе браузер его
   глушит), настройка «звук и громкость» лежит отдельным ключом и переживает
   очистку сейва. Где WebAudio нет (старый браузер, jsdom в тестах) — молча ничего. */
const SND_KEY = 'vg_sound_v1';
const sndCfg = (()=>{
  const def = {on:true, vol:0.7, amb:true};
  try {
    const raw = localStorage.getItem(SND_KEY);
    if (raw){ const o = JSON.parse(raw);
      return {on: o.on !== false, vol: clamp(o.vol === undefined ? 0.7 : +o.vol, 0, 1),
              amb: o.amb !== false}; }
  } catch(e){}
  return def;
})();
function sndSave(){
  try { localStorage.setItem(SND_KEY, JSON.stringify({on:sndCfg.on, vol:sndCfg.vol, amb:sndCfg.amb})); } catch(e){}
}
const SFX = (()=>{
  let ctx = null, master = null, noiseBuf = null, armed = false;
  let ambFan = null, ambGain = null, ambLevel = 0, dripLevel = 0, dripTimer = 0;
  const lastAt = {};                       // троттлинг: сбор пачкой не должен трещать
  const hasAudio = ()=> typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  function ensure(){
    if (ctx || !hasAudio()) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = sndCfg.on ? sndCfg.vol*0.45 : 0;
      master.connect(ctx.destination);
      const n = Math.floor((ctx.sampleRate||44100)*0.5);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0;i<n;i++) d[i] = Math.random()*2-1;
    } catch(e){ ctx = null; }
    return ctx;
  }
  /* первое действие игрока: разбудить контекст */
  function arm(){
    ensure();
    if (!ctx) return false;
    ensureAmbient();
    if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch(e){} }
    armed = true;
    return true;
  }
  function syncGain(){
    if (master) master.gain.value = sndCfg.on ? sndCfg.vol*0.45 : 0;
  }
  /* ---------- фон теплицы: вентилятор гудит, капель капает ----------
     Гул — это тот же буфер шума, но зацикленный и сильно отфильтрованный: он
     не «звучит», а создаёт ощущение работающей теплицы. Громкость ведёт за собой
     форточки и обдув, капель — за влажностью субстрата. Всё на минимуме: фон не
     должен спорить с событийными звуками. */
  function ensureAmbient(){
    if (!ctx || ambFan) return;
    ambFan = ctx.createBufferSource();
    ambFan.buffer = noiseBuf; ambFan.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 210; bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    ambGain = ctx.createGain(); ambGain.gain.value = 0;
    ambFan.connect(bp); bp.connect(lp); lp.connect(ambGain); ambGain.connect(master);
    try { ambFan.start(); } catch(e){}
  }
  function drip(){
    if (!ctx || !sndCfg.on || sndCfg.vol <= 0) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    const f0 = 1100 + Math.random()*700;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f0*0.45, t0 + 0.11);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035*(0.6 + Math.random()*0.7), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + 0.2);
  }
  function ambientTick(){
    if (!ctx) return;
    const want = (sndCfg.on && sndCfg.amb && sndCfg.vol > 0) ? ambLevel : 0;
    if (ambGain) ambGain.gain.setTargetAtTime(want*0.055*sndCfg.vol, ctx.currentTime, 0.6);
    if (want <= 0.01) return;
    // капель: редкие капли, темп зависит от влажности, а не от таймера кадра
    if (dripLevel > 0.05 && !dripTimer){
      dripTimer = setTimeout(()=>{
        dripTimer = 0;
        if (sndCfg.on && sndCfg.amb && Math.random() < dripLevel) drip();
      }, 550 + Math.random()*900);
    }
  }
  function ambient(o){
    ambLevel = clamp(o && o.fan || 0, 0, 1);
    dripLevel = clamp(o && o.drip || 0, 0, 1);
    if (ctx) ensureAmbient();
    ambientTick();
  }
  function tone(o){
    const t0 = ctx.currentTime + (o.at||0);
    const dur = o.dur || 0.2;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.f0), t0);
    if (o.f1 && o.f1 !== o.f0)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + dur);
    const peak = Math.max(0.0005, o.gain === undefined ? 0.18 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (o.lp){ const f = ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  function noise(o){
    const t0 = ctx.currentTime + (o.at||0);
    const dur = o.dur || 0.25;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 900, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f1 || o.f0 || 900), t0 + dur);
    f.Q.value = o.q === undefined ? 1.2 : o.q;
    const g = ctx.createGain();
    const peak = Math.max(0.0005, o.gain === undefined ? 0.12 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }
  /* рисунок каждого звука: короткие, разные по характеру, без мелодий-навязчивостей */
  const RECIPES = {
    harvest(o){                                     // сорвали плод: короткий «плук»
      const k = clamp((o && o.heavy) || 0.5, 0, 1);
      tone({type:'triangle', f0:540 + 220*k, f1:300 + 120*k, dur:0.12, gain:0.16});
      noise({f0:2200, f1:900, dur:0.07, gain:0.05, q:0.7});
    },
    sell(o){                                        // касса: две монетки
      tone({f0:1320, dur:0.10, gain:0.10});
      tone({f0:1760, dur:0.16, gain:0.08, at:0.06});
      tone({f0:2640, dur:0.09, gain:0.045, at:0.12});
    },
    buy(){                                          // покупка: глухой стук и подъём
      tone({f0:190, f1:90, dur:0.14, gain:0.16, type:'sine'});
      tone({f0:520, f1:780, dur:0.13, gain:0.07, at:0.05, type:'triangle'});
    },
    water(){                                        // вода: шум с падающим фильтром
      noise({f0:1400, f1:320, dur:0.34, gain:0.10, q:0.6});
      noise({f0:800, f1:240, dur:0.42, gain:0.06, q:0.5, at:0.05});
    },
    lamp(){                                         // щелчок светильника
      noise({f0:3200, f1:1800, dur:0.04, gain:0.07, q:0.9});
      tone({f0:900, f1:700, dur:0.05, gain:0.05, type:'square'});
    },
    bill(){                                         // пришёл счёт: тусклый колокольчик
      tone({f0:880, dur:0.5, gain:0.10});
      tone({f0:1174, dur:0.42, gain:0.07, at:0.05});
      tone({f0:440, dur:0.6, gain:0.05, at:0.02, type:'triangle'});
    },
    court(){                                        // суд: низкое предупреждение
      tone({f0:160, f1:120, dur:0.5, gain:0.16, type:'sawtooth', lp:700});
      tone({f0:120, f1:80, dur:0.7, gain:0.10, at:0.25, type:'sawtooth', lp:600});
    },
    error(){                                        // отказ
      tone({f0:220, f1:170, dur:0.13, gain:0.13, type:'square', lp:1200});
    },
    warn(){                                         // предупреждение
      tone({f0:660, dur:0.10, gain:0.08, type:'triangle'});
      tone({f0:560, dur:0.12, gain:0.08, at:0.11, type:'triangle'});
    },
    end(){                                          // сезон закрыт: короткая арпеджио
      [523, 659, 784, 1047].forEach((f,i)=>tone({f0:f, dur:0.28, gain:0.09, at:i*0.09, type:'triangle'}));
    },
    bankrupt(){                                     // банкротство: вниз по минору
      [440, 349, 262, 196].forEach((f,i)=>tone({f0:f, dur:0.42, gain:0.11, at:i*0.14, type:'sine'}));
    }
  };
  function play(name, opt){
    if (!sndCfg.on || sndCfg.vol <= 0) return false;
    if (!ctx) ensure();
    if (!ctx || ctx.state === 'suspended') return false;      // без действия игрока браузер молчит
    const r = RECIPES[name];
    if (!r) return false;
    const now = (typeof performance!=='undefined' ? performance.now() : Date.now());
    if (lastAt[name] && now - lastAt[name] < 45) return false;  // пачка плодов = один звук
    lastAt[name] = now;
    try { r(opt || {}); return true; } catch(e){ return false; }
  }
  return {
    arm, play, ambient,
    get amb(){ return sndCfg.amb; },
    setAmb(v){ sndCfg.amb = !!v; sndSave(); return sndCfg.amb; },
    ambState(){ return {fan:ambLevel, drip:dripLevel, on:sndCfg.amb, gain: ambGain ? ambGain.gain.value : 0}; },
    names: ()=>Object.keys(RECIPES),
    get on(){ return sndCfg.on; },
    get vol(){ return sndCfg.vol; },
    setOn(v){ sndCfg.on = !!v; sndSave(); syncGain(); return sndCfg.on; },
    setVol(v){ sndCfg.vol = clamp(+v || 0, 0, 1); sndSave(); syncGain(); return sndCfg.vol; },
    state(){ return { on:sndCfg.on, vol:sndCfg.vol, armed, ctx: !!ctx,
                      running: !!(ctx && ctx.state === 'running') }; }
  };
})();
function playSfx(name, opt){ try { return SFX.play(name, opt); } catch(e){ return false; } }

/* ---------------- сохранение сезона ----------------
   localStorage может быть недоступен (iframe без allow-same-origin, приватный режим),
   поэтому три уровня: localStorage → sessionStorage → память вкладки.
   Файл сохранения (.json) работает всегда и не зависит от ограничений браузера.   */
const SAVE_KEY = 'vg_save_v1', SAVE_META = 'vg_save_meta_v1';
let memSave = null, memMeta = null, lastSaveTs = 0, lastSavedDay = 0;
let seenBills = 0;                      // сколько счетов за свет и тепло уже показано игроку

const store = (()=>{
  const probe = (s) => { s.setItem('__vg','1'); s.removeItem('__vg'); return s; };
  try { const ls = probe(window.localStorage);
    return {kind:'localStorage (сезон переживёт перезагрузку)', get:()=>ls.getItem(SAVE_KEY), set:v=>ls.setItem(SAVE_KEY,v),
            getM:()=>ls.getItem(SAVE_META), setM:v=>ls.setItem(SAVE_META,v), del:()=>{ls.removeItem(SAVE_KEY); ls.removeItem(SAVE_META);}};
  } catch(e){}
  try { const ss = probe(window.sessionStorage);
    return {kind:'sessionStorage (только до закрытия вкладки)', get:()=>ss.getItem(SAVE_KEY), set:v=>ss.setItem(SAVE_KEY,v),
            getM:()=>ss.getItem(SAVE_META), setM:v=>ss.setItem(SAVE_META,v), del:()=>{ss.removeItem(SAVE_KEY); ss.removeItem(SAVE_META);}};
  } catch(e){}
  return {kind:'только память вкладки (браузер блокирует хранилище)', get:()=>memSave, set:v=>{memSave=v;},
          getM:()=>memMeta, setM:v=>{memMeta=v;}, del:()=>{memSave=null; memMeta=null;}};
})();

/* ---------------- Надёжное сохранение: IndexedDB ----------------
   localStorage быстрый и синхронный, но его стирает «очистить данные сайта»,
   а в приватном режиме он может быть недоступен вовсе. Поэтому тот же сейв
   дополнительно уходит в IndexedDB: если в localStorage пусто, а в базе есть —
   восстанавливаем. Всё необязательно: нет IndexedDB — игра работает как раньше. */
const IDB_DB = 'greenhouse', IDB_STORE = 'saves', IDB_KEY = 'current';
let idbDB = null, idbTried = false, idbState = 'проверяю…';
function idbOpen(){
  if (idbTried) return Promise.resolve(idbDB);
  idbTried = true;
  return new Promise(res=>{
    if (typeof indexedDB === 'undefined' || !indexedDB || !indexedDB.open){ idbState = 'недоступна'; return res(null); }
    let req;
    try { req = indexedDB.open(IDB_DB, 1); } catch(e){ idbState = 'недоступна'; return res(null); }
    req.onupgradeneeded = ()=>{ try { const db = req.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); } catch(_){} };
    req.onsuccess = ()=>{ idbDB = req.result; idbState = 'работает'; res(idbDB); };
    req.onerror = ()=>{ idbState = 'недоступна'; res(null); };
    req.onblocked = ()=>{ idbState = 'заблокирована'; res(null); };
  });
}
async function idbPut(val){
  const db = await idbOpen();
  if (!db) return false;
  return new Promise(res=>{
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, IDB_KEY);
      tx.oncomplete = ()=>res(true); tx.onerror = ()=>res(false);
    } catch(e){ res(false); }
  });
}
async function idbRead(){
  const db = await idbOpen();
  if (!db) return null;
  return new Promise(res=>{
    try {
      const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
      rq.onsuccess = ()=>res(rq.result || null); rq.onerror = ()=>res(null);
    } catch(e){ res(null); }
  });
}
async function idbClear(){
  const db = await idbOpen();
  if (!db) return false;
  return new Promise(res=>{
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = ()=>res(true); tx.onerror = ()=>res(false);
    } catch(e){ res(false); }
  });
}
/* если localStorage пуст, а в IndexedDB есть сейв — поднимаем его */
async function restoreFromIdb(){
  let cur = null;
  try { cur = store.get(); } catch(_){}
  if (cur) return false;
  const rec = await idbRead();
  if (!rec || !rec.text) return false;
  try {
    store.set(rec.text);
    if (rec.meta) store.setM(JSON.stringify(rec.meta));
  } catch(e){ return false; }
  if (typeof renderResumeBox === 'function') renderResumeBox();
  return true;
}

function peekSaveMeta(){
  try { const m = store.getM(); return m ? JSON.parse(m) : null; } catch(e){ return null; }
}
function saveNow(silent){
  if (!world) return false;
  try {
    const text = serializeWorld(world);
    const meta = { day:world.day, doy:world.doy, money:Math.round(world.money),
      crop:world.crop, profile:world.profile, diff:world.diffId, kg:Math.round(world.harvestedKg), ts:Date.now() };
    store.set(text);
    store.setM(JSON.stringify(meta));
    // копия в IndexedDB: переживёт «очистить данные сайта» и переполнение localStorage
    idbPut({ text, meta, ts:meta.ts });
    lastSaveTs = Date.now(); lastSavedDay = world.day;
    if (!silent) toast('Сохранено: день '+world.day);
    return true;
  } catch(e){
    toast('Не удалось сохранить: '+e.message);
    return false;
  }
}
function clearSave(){
  store.del(); idbClear(); lastSavedDay = 0;
  toast('Сохранение удалено');
  if (page==='settings') renderSettings();
  // стартовый экран не должен предлагать «продолжить» удалённый сезон
  if (typeof renderResumeBox === 'function') renderResumeBox();
}
function applyLoadedWorld(pack, silent){
  world = pack.world;
  // пока вкладка была закрыта, время шло: догоняем по реальным часам (максимум 3 суток)
  let away = null;
  try {
    const hours = (Date.now() - (pack.ts||Date.now()))/3600000;
    if (hours > 0.05) away = catchUp(world, hours);
  } catch(e){}
  if (away && away.hours > 0.1){
    const hh = away.hours < 1 ? Math.round(away.hours*60)+' мин' : away.hours.toFixed(1)+' ч';
    world.log.unshift({t:'Д'+world.day, m:`Пока вас не было (${hh}): ${away.kg>=0.5?'собрано '+num(away.kg)+' кг · ':''}баланс ${away.money>=0?'+':''}${money(away.money)}`, k:'hl'});
    setTimeout(()=>toast(`Пока вас не было ${hh}: ${away.kg>=0.5?'собрано '+num(away.kg)+' кг · ':''}баланс ${away.money>=0?'+':''}${money(away.money)}`), 700);
  }
  cam.plant = 0; cam.mode = 'free'; acc = 0; paused = false; endShown = false; fc = null;
  tutorDone = true;                       // опытный игрок продолжает сезон, обучение не нужно
  $('tutor').classList.remove('on');
  $('start').classList.remove('on');
  $('pred').classList.remove('on');
  lastSavedDay = world.day;
  setPage('greenhouse');
  renderAll();
  if (!silent) toast('Сезон загружен: день '+world.day+', '+money(world.money));
}
function loadFromStorage(){
  const text = store.get();
  if (!text) return toast('Сохранений нет');
  try { applyLoadedWorld(deserializeWorld(text)); }
  catch(e){ toast('Сохранение повреждено: '+e.message); }
}
function downloadSave(){
  try {
    const text = serializeWorld(world);
    const blob = new Blob([text], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `teplica-D${world.day}-${world.crop}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    toast('Файл сохранения скачан');
  } catch(e){ toast('Скачивание заблокировано браузером — используйте текст сохранения'); }
}
function loadFromText(text){
  try { applyLoadedWorld(deserializeWorld(text)); }
  catch(e){ toast('Не получилось: '+e.message); }
}

/* ---------------- перерисовка без «дрожи» ----------------
   Главный цикл зовёт renderAll() ~8 раз в секунду. Если каждый раз заново
   писать innerHTML, кнопки пересоздаются под курсором: hover слетает (визуально
   «трясётся»), а клик теряется, если mouseup попал уже в новый элемент.
   Поэтому: (1) одинаковый HTML не переписываем, (2) действия вешаем на
   pointerdown — он срабатывает в момент нажатия, а не после отпускания.      */
const _htmlCache = Object.create(null);
let _datePickersReady = false;
function setHTML(id, html){
  const box = $(id);
  if (!box) return false;
  if (_htmlCache[id] === html) return false;
  box.innerHTML = html; _htmlCache[id] = html;
  return true;
}
function press(el, fn){
  if (!el) return;
  el.onpointerdown = (e)=>{ if (e.button && e.button !== 0) return; e.preventDefault(); fn(e); };
  el.onclick = (e)=>{ e.preventDefault(); };      // клик не дублирует действие
}

/* ---------------- стартовый экран ---------------- */
function buildStart(){
  const camp = $('campPick');
  if (camp){
    camp.innerHTML = `<div class="card" data-camp="1" style="cursor:pointer;${pending.campaign?'border-color:var(--acc)':''}">
      <div class="h"><b>Кампания с балкона</b><span class="price" style="font-size:12px">${money(100)}</span></div>
      <div class="d">Три главы: балкон 4 м² → комната 20 м² → теплица 400 м².
      Письма наставника, выборы и переезды. Культуру и погоду выбираете сами, капитал фиксирован.</div>
    </div>
    <div class="card" data-camp="0" style="cursor:pointer;${pending.campaign?'':'border-color:var(--acc)'}">
      <div class="h"><b>Свободный сезон</b></div>
      <div class="d">Обычный старт: выберите капитал, культуру и сложность. Хобби, ферма или агрокомплекс.</div>
    </div>`;
    camp.querySelectorAll('[data-camp]').forEach(e=>e.onclick=()=>{
      pending.campaign = e.dataset.camp==='1';
      pending.profile = pending.campaign ? 'balcony' : 'farm';
      buildStart();
    });
  }
  const n = 0;                              // «Режим» уже занял первый номер
  const setLbl = (id, t, k) => { const e = $(id); if (e) e.textContent = (k+n) + '. ' + t; };
  setLbl('lblCapital', pending.campaign ? 'Старт кампании (фиксирован)' : 'Капитал и площадь', 2);
  setLbl('lblCrop', 'Культура', 3);
  setLbl('lblSys', 'Система выращивания', 4);
  setLbl('lblWeather', 'Погодный режим', 5);
  setLbl('lblDiff', 'Сложность', 6);
  if (pending.campaign){
    const P = PROFILES.balcony;
    $('profilePick').innerHTML = `
      <div class="card" style="border-color:var(--acc)">
        <div class="h"><b>${P.name} · глава 1</b><span class="price" style="font-size:12px">${money(100)}</span></div>
        <div class="d">${P.note}. Дальше — комната 20 м² и теплица 400 м²: переезд предлагает наставник,
        когда вы выполните цель главы. Сезон кампании — 210 дней.</div>
      </div>
      <div class="card" style="opacity:.55">
        <div class="h"><b>Глава 2 · Комната</b></div><div class="d">20 м², стеллажи и вытяжка. Откроется после ${money(350)} продаж.</div>
      </div>
      <div class="card" style="opacity:.55">
        <div class="h"><b>Глава 3 · Теплица</b></div><div class="d">400 м², климат-контроль и опт. Откроется после ${money(1500)} продаж.</div>
      </div>
      <div class="card" style="opacity:.55">
        <div class="h"><b>Глава 4 · Сеть</b></div><div class="d">Филиалы по 400 м² под наёмным агрономом: приносят деньги без вашего участия.
        Открывается письмом наставника в главе 3.</div>
      </div>`;
    const cg = $('campPick');
    if (cg && cg.firstElementChild){
      const d = cg.firstElementChild.querySelector('.d');
      if (d) d.innerHTML = d.innerHTML.replace('Три главы: балкон 4 м² → комната 20 м² → теплица 400 м².',
        'Четыре главы: балкон 4 м² → комната 20 м² → теплица 400 м² → сеть филиалов.');
    }
  } else $('profilePick').innerHTML = Object.values(PROFILES).filter(p=>p.id!=='balcony'&&p.id!=='room').map(p=>`
    <div class="card" data-profile="${p.id}" style="cursor:pointer;${p.id===pending.profile?'border-color:var(--acc)':''}">
      <div class="h"><b>${p.name}</b><span class="price" style="font-size:12px">${money(p.start)}</span></div>
      <div class="d">${p.note}<br>Площадь ${p.area} м² · постоянные ${money(p.fixedDay)}/сут · цена ${nf(p.priceF,2)}×</div>
    </div>`).join('');
  // система выращивания
  const sysLock = S => pending.campaign && S.ch > 0;
  $('sysPick').innerHTML = Object.values(GROW_SYS).map(S=>{
    const locked = sysLock(S);
    return `<div class="card" data-sys="${S.id}" style="cursor:pointer;${locked?'opacity:.55;':''}${S.id===pending.sys?'border-color:var(--acc)':''}">
      <div class="h"><b>${S.name}</b>${locked?`<span class="lock">глава ${S.ch+1}</span>`:''}</div>
      <div class="d">${S.note}</div>
      <div class="hint">вода ×${nf(S.waterF,2)} · питание ×${nf(S.fertF,2)} · рост ×${nf(S.yieldF,2)} · риск гнили ×${nf(S.rotF,1)}</div>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-sys]').forEach(el=>el.onclick = ()=>{
    const S = GROW_SYS[el.dataset.sys];
    if (sysLock(S)){ toast('Откроется в главе '+(S.ch+1)+' · '+CHAPTERS[S.ch].name); return; }
    pending.sys = S.id; buildStart();
  });

  $('cropPick').innerHTML = Object.values(CROPS).map(c=>`
    <div class="card" data-crop="${c.id}" style="cursor:pointer;${c.id===pending.crop?'border-color:var(--acc)':''}">
      <div class="h"><b>${ic(c)} ${c.name}</b><span class="price" style="font-size:12px">${money2(c.price)}/кг</span></div>
      <div class="d">${c.note}<br>Плотность ${c.density} шт/м² · плод ${(c.fruitFresh*1000)|0} г</div>
    </div>`).join('');
  const ws = [
    {id:'normal', n:'Обычный', d:'переменная облачность, риск похолоданий'},
    {id:'cloudy', n:'Пасмурный', d:'+облачность: мало света, мало перегрева'},
    {id:'hot', n:'Жаркий', d:'+2.5 °C: перегрев, нужна вентиляция и затенение'},
    {id:'real', n:'Как за окном', d:'архив open-meteo по выбранной точке: фактическая температура и облачность по дням вместо средних норм. Нет сети — считаем по нормам'}
  ];
  $('seedPick').innerHTML = ws.map(x=>`
    <div class="card" data-weather="${x.id}" style="cursor:pointer;${x.id===pending.weather?'border-color:var(--acc)':''}">
      <div class="h"><b>${x.n}</b>${x.id==='real'?'<span class="price" style="font-size:11px">сеть</span>':''}</div><div class="d">${x.d}</div>
    </div>`).join('');
  document.querySelectorAll('[data-weather]').forEach(e=>e.onclick=()=>{
    pending.weather = e.dataset.weather; buildStart();
    if (pending.weather==='real') toast('Погода из архива подтянется при старте: без сети останутся нормы');
  });
  // обработчик выбора погоды живёт здесь, рядом с разметкой карточек
  $('diffPick').innerHTML = Object.values(DIFFICULTY).map(d=>`
    <div class="card" data-diff="${d.id}" style="cursor:pointer;${d.id===pending.difficulty?'border-color:var(--acc)':''}">
      <div class="h"><b>${d.name}</b></div>
      <div class="d">${d.note}<br>постоянные ×${nf(d.fixedF,2)} · аварии ×${nf(d.failF,1)} · цена ×${nf(d.priceF,2)}</div>
    </div>`).join('');
  // 5. локация старта: климат берём из норм по точке (открытые данные)
  if ($('sitePick')) $('sitePick').innerHTML = SITE_LIST.map(x=>{
    const N = siteNormals(x);
    const summer = Math.round(N.temp[6]), winter = Math.round(N.temp[0]);
    return `<div class="card" data-site="${x.id}" style="cursor:pointer;${x.id===pending.site?'border-color:var(--acc)':''}">
      <div class="h"><b>${x.name}</b><span class="price" style="font-size:11px">${summer>0?'+':''}${summer}° / ${winter>0?'+':''}${winter}°</span></div>
      <div class="d">${x.note}</div>
      <div class="hint">· широта ${nf(x.lat,1)}° · солнце ${Math.round(N.sun[6]*100)} % летом, ${Math.round(N.sun[0]*100)} % зимой · регион: ${N.region}</div>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-site]').forEach(e=>e.onclick=()=>{ pending.site=e.dataset.site; buildStart(); });
  if ($('siteHint')){
    const S = siteById(pending.site), N = siteNormals(S);
    $('siteHint').innerHTML = `Нормы — средние многолетние (1991–2020) по открытым данным.
      ${S.name}: ${Math.round(N.temp[0])}…${Math.round(N.temp[6])} °C по месяцам,
      солнце ${Math.round(N.sun[0]*100)}…${Math.round(N.sun[6]*100)} % от возможного.`;
  }
  // 6. сторона дома: куда смотрит остекление — от неё зависит, как ходит солнце
  if ($('orientPick')) $('orientPick').innerHTML = Object.keys(ORIENTS).map(k=>{
    const O = ORIENTS[k];
    return `<div class="card" data-orient="${k}" style="cursor:pointer;${k===pending.orient?'border-color:var(--acc)':''}">
      <div class="h"><b>${O.name}</b><span class="price" style="font-size:11px">${O.az}°</span></div>
      <div class="d">${O.note}</div>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-orient]').forEach(e=>e.onclick=()=>{ pending.orient=e.dataset.orient; buildStart(); });
  // 7. дата старта
  const mSel = $('dateMonth'), dSel = $('dateDay');
  if (mSel && dSel){
    if (!_datePickersReady){
      _datePickersReady = true;
      mSel.innerHTML = MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
      dSel.innerHTML = Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
      const pick = ()=>{ pending.startDoy = doyFromDate(+mSel.value, +dSel.value); buildStart(); };
      mSel.onchange = pick; dSel.onchange = pick;
      const bt = $('btnDateToday'), bs = $('btnDateSpring');
      if (bt) bt.onclick = ()=>{ pending.startDoy = todayDoy(); buildStart(); };
      if (bs) bs.onclick = ()=>{ pending.startDoy = 91; buildStart(); };
    }
    const dd = dateFromDoy(((pending.startDoy-1)%365)+1);
    mSel.value = String(dd.month); dSel.value = String(dd.day);
    if ($('dateSummary')){
      // честное предупреждение: зимой на балконе и света мало, и холодно
      const N0 = siteNormals(siteById(pending.site));
      const t0 = Math.round(normAt(N0.temp, pending.startDoy));
      const s0 = Math.round(normAt(N0.sun, pending.startDoy)*100);
      const hard = t0 < 12 || s0 < 30;
      $('dateSummary').innerHTML =
        `старт ${fmtDate(pending.startDoy)} · сегодня ${todayLabel()} · ` +
        (pending.startDoy === todayDoy() ? '<b>как за окном</b>' : 'не сегодня') +
        ` · норма ${t0>0?'+':''}${t0} °C, солнце ${s0} %` +
        (hard ? ` <b style="color:var(--warn)">— холодно и мало света: куст будет расти медленно, для быстрого сезона лучше март–сентябрь</b>` : '');
    }
  }
  setLbl('lblPlace', 'Где и когда начинаем', 7);
  setLbl('lblOrient', 'Сторона дома (куда смотрит остекление)', 8);
  setLbl('lblDate', 'Дата старта', 9);
  document.querySelectorAll('[data-diff]').forEach(e=>e.onclick=()=>{ pending.difficulty=e.dataset.diff; buildStart(); });
  document.querySelectorAll('[data-profile]').forEach(e=>e.onclick=()=>{ pending.profile=e.dataset.profile; buildStart(); });
  document.querySelectorAll('[data-crop]').forEach(e=>e.onclick=()=>{ pending.crop=e.dataset.crop; buildStart(); });
}

function renderResumeBox(){
  const box = $('resumeBox');
  if (!box) return;
  const m = peekSaveMeta();
  if (!m){ box.innerHTML = ''; return; }
  const d = new Date(m.ts);
  const when = d.toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
  box.innerHTML = `<div class="card" style="border-color:var(--acc);flex-direction:row;align-items:center;gap:14px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px">
      <div class="h"><b>Продолжить сезон</b></div>
      <div class="d">День ${m.day} · ${CROPS[m.crop].name} · ${PROFILES[m.profile].name} · ${DIFFICULTY[m.diff].name.toLowerCase()} сложность<br>
      собрано ${num(m.kg)} кг · баланс ${money(m.money)} · сохранено ${when}</div>
    </div>
    <button class="btn good" id="btnResume">Продолжить</button>
    <button class="btn warn" id="btnDeleteSave">Удалить</button>
  </div>`;
  $('btnResume').onclick = ()=>loadFromStorage();
  $('btnDeleteSave').onclick = ()=>{ clearSave(); renderResumeBox(); };
}

function startGame(){
  const seed = 20260415 + (pending.weather==='cloudy'?7:0) + (pending.weather==='hot'?13:0) + (pending.crop.length*3);
  world = makeWorld({ profile:pending.campaign?'balcony':pending.profile, crop:pending.crop, weather:pending.weather,
                      difficulty:pending.difficulty, seed, campaign:pending.campaign,
                      site:pending.site, orient:pending.orient,
                      startDoy:(pending.startDoy!=null?pending.startDoy:todayDoy()),
                      // в кампании на балконе — только грунт, остальное откроется с главой
                      sys:(pending.campaign && pending.sys && GROW_SYS[pending.sys] && GROW_SYS[pending.sys].ch>0)
                          ? 'soil' : pending.sys });
  if (pending.weather === 'real') refreshRealWeather(false);   // подтянем архив в фоне
  tutorStep = 0; tutorDone = false; resetTutorFlags();
  cam.plant = 0; cam.mode = 'free'; paused = false; speed = 64;
  acc = 0; lastT = performance.now(); endShown = false; fc = null;
  if (typeof FX !== 'undefined') FX.length = 0;
  seenBills = (world.util && world.util.bills) ? world.util.bills.length : 0;
  $('start').classList.remove('on');
  $('pred').classList.remove('on');
  document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='64'));
  $('btnPause').classList.remove('on'); $('btnPause').textContent='⏸';
  setPage('greenhouse');
  renderAll();
  saveNow(true);
  renderResumeBox();
  toast(pending.campaign
    ? 'Кампания: балкон, '+money(100)+', '+CROPS[world.crop].name.toLowerCase()
    : 'Сезон начат: '+CROPS[world.crop].name+', '+PROFILES[world.profile].area+' м², '
      +DIFFICULTY[world.diffId].name.toLowerCase()+' сложность'
      +((world.startKit&&world.startKit.length)?' · балкон уже утеплён, обогреватель стоит':''));
  if (world.mail.length) setTimeout(()=>toast('В почте письмо от тёти Розы'), 2400);
}

/* ---------------- роутер ---------------- */
function setPage(p){
  page = p;
  bodyCls('toggle','on-gh', p==='greenhouse');
  if (p!=='greenhouse' && typeof closeSheet==='function') closeSheet();
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===p));
  document.querySelectorAll('.page').forEach(e=>e.classList.remove('on'));
  $('page-'+p).classList.add('on');
  canvas.style.display = (p==='greenhouse') ? 'block' : 'none';
  if (p==='shop') renderShop();
  if (p==='settings') renderSettings();
  renderTutor();
}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setPage(b.dataset.tab));

/* высота верхней панели измеряется, а не угадывается: если она переносится
   на две строки (узкий экран, много кнопок), под неё подстроятся и колонки, и шторка */
let _topH = 0;
function syncTopH(){
  const t = document.getElementById('top');
  if (!t) return;
  const h = Math.round(t.getBoundingClientRect().height);
  const root = document.documentElement;
  if (!root || !root.style || !root.style.setProperty) return;
  if (h > 10 && h !== _topH){ _topH = h; root.style.setProperty('--topH', h + 'px'); }
}

/* ---------------- раскладка: планшет и телефон ----------------
   На широком экране — три колонки. На планшете и телефоне правая (а на телефоне
   и левая) колонка прячется в шторку, которую открывает док снизу: иначе на
   маленьком экране от сцены остаётся полоска.                              */
/* безопасная работа с классом body: в тестах DOM-заглушка может не иметь classList */
function bodyCls(mode, cls, on){
  const b = document.body; if (!b || !b.classList) return;
  if (mode==='toggle') b.classList.toggle(cls, !!on);
  else if (mode==='add') b.classList.add(cls);
  else b.classList.remove(cls);
}
const SHEET_TABS = {
  tablet: [
    {k:'mail',  t:'Почта', p:['mail']},
    {k:'tasks', t:'Дела',  p:['goals','missions']},
    {k:'stock', t:'Склад', p:['stock','tanks','contracts']},
    {k:'net',   t:'Сеть',  p:['net']},
    {k:'log',   t:'Журнал',p:['log']}
  ],
  phone: [
    {k:'climate', t:'Климат', p:['climate','risks']},
    {k:'why',     t:'Почему', p:['why']},
    {k:'money',   t:'Деньги', p:['finance']},
    {k:'tasks',   t:'Дела',   p:['goals','missions']},
    {k:'stock',   t:'Склад',  p:['stock','contracts','net']},
    {k:'mail',    t:'Почта',  p:['mail','log']}
  ]
};
let sheetTab = null;
function layoutKind(){
  const w = window.innerWidth;
  return w <= 720 ? 'phone' : (w <= 1180 ? 'tablet' : 'desktop');
}
function applySheet(){
  document.querySelectorAll('#dashGrid .panel').forEach(p=>p.classList.remove('sel'));
  const tabs = SHEET_TABS[layoutKind()] || [];
  const t = tabs.find(x=>x.k===sheetTab);
  if (!t) return;
  for (const k of t.p){
    const el = document.querySelector(`#dashGrid .panel[data-p="${k}"]`);
    if (el) el.classList.add('sel');
  }
}
function buildDock(){
  const kind = layoutKind();
  bodyCls('toggle','narrow', kind!=='desktop');
  const dock = $('dock');
  if (!dock) return;
  if (kind==='desktop'){ dock.innerHTML=''; sheetTab=null; applySheet(); return; }
  // кнопки, за которыми нет ни одной видимой панели (например, почта вне кампании), не показываем
  const panelOf = k => document.querySelector(`#dashGrid .panel[data-p="${k}"]`);
  const vis = k => { const el = panelOf(k); return !!el && el.style.display !== 'none'; };
  const tabs = SHEET_TABS[kind].filter(t=>t.p.some(vis));
  if (sheetTab && !tabs.some(t=>t.k===sheetTab)){ sheetTab = null; bodyCls('remove','sheet-open'); }
  dock.innerHTML = tabs.map(t=>`<button data-sheet="${t.k}" class="${sheetTab===t.k?'on':''}">${t.t}</button>`).join('');
  dock.querySelectorAll('button').forEach(b=>b.onclick=()=>toggleSheet(b.dataset.sheet));
  applySheet();
}
function toggleSheet(k){
  sheetTab = (sheetTab===k) ? null : k;
  bodyCls('toggle','sheet-open', !!sheetTab);
  buildDock();
  if (sheetTab) renderAll();
  if (sheetTab) toast('Панель «'+((SHEET_TABS[layoutKind()].find(t=>t.k===sheetTab)||{}).t||'')+'» открыта — нажмите ещё раз, чтобы скрыть');
}
function closeSheet(){
  sheetTab = null;
  bodyCls('remove','sheet-open');
  document.querySelectorAll('#dashGrid .panel').forEach(p=>p.classList.remove('sel'));
  const dock = $('dock'); if (dock) dock.innerHTML='';
}
let _layT = 0;
window.addEventListener('resize', ()=>{
  clearTimeout(_layT);
  _layT = setTimeout(()=>{ buildDock(); if (layoutKind()==='desktop') bodyCls('remove','sheet-open'); }, 140);
});
buildDock();
bodyCls('add','on-gh');

/* ---------------- верхняя панель ---------------- */
function renderTop(){
  if (!world) return;
  const P = PROFILES[world.profile], C = CROPS[world.crop];
  // в шапке помещается ~200 px: место и сторона короткие, подробности — в подсказке
  const siteShort = world.site ? (siteById(world.site.id).short || world.site.name) : '';
  const sideShort = world.site ? ((ORIENTS[world.site.orient]||ORIENTS.S).short || 'юг') : '';
  $('tProfile').textContent = P.name + ' · ' + P.area + ' м²' +
    (siteShort ? ' · ' + siteShort : '') + (sideShort ? ' · ' + sideShort : '');
  $('tProfile').title = P.name + ' · ' + P.area + ' м² · ' + (sysOf(world).short||'').toLowerCase() + ' · ' +
    (DIFFICULTY[world.diffId]?DIFFICULTY[world.diffId].name.toLowerCase():'обычная') +
    (world.weather==='cloudy'?' · пасмурно':world.weather==='hot'?' · жарко':'') +
    (world.site ? ' · ' + world.site.name + ' · ' + ((ORIENTS[world.site.orient]||ORIENTS.S).name.toLowerCase()) : '');
  $('tDay').textContent = 'Д ' + world.day;
  $('tSeason').textContent = 'из ' + (world.seasonDays || CFG.seasonDays);
  $('tDate').textContent = fmtDate(world.doy) + ' 2026';
  const hh = Math.floor(world.hour), mm = Math.floor((world.hour-hh)*60);
  $('tHour').textContent = String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
  $('tMoney').textContent = money(world.money);
  // минус на балансе должен быть виден, а не «−0»
  $('tMoney').style.color = world.money < -0.004 ? 'var(--bad)' : '';
  syncTopH();
  const pd = world.profitDay||0;
  const pe = $('tProfit');
  pe.textContent = (pd>=0?'+' : '') + moneyS(pd);
  pe.style.color = pd>=0 ? 'var(--acc)' : 'var(--bad)';
  $('tCrop').innerHTML = ic(C) + ' ' + C.name.toLowerCase();
  $('tYield').textContent = num(world.harvestedKg) + ' кг';
}

/* ---------------- дашборд: датчики ---------------- */
function gauge(label, val, min, max, unit, cls, digits){
  const pct = clamp((val-min)/(max-min),0,1)*100;
  // единица: проценты и градусы липнут к числу так, как их пишут в отчётах
  const u = unit ? (unit.trim()==='%' ? '%' : ' '+unit.trim()) : '';
  return `<div class="g"><span>${label}</span><div class="bar"><i class="${cls||''}" style="width:${pct}%"></i></div>
    <b>${nf(val, digits===undefined?1:digits)}${u}</b></div>`;
}
/* звук: вкл/выкл одной функцией на кнопку клавишу и карточку */
function toggleSound(){
  SFX.arm();
  const on = SFX.setOn(!SFX.on);
  toast(on ? 'Звук включён · клавиша Z глушит' : 'Звук выключен · клавиша Z вернёт');
  if (page === 'settings') renderSettings();
  return on;
}

/* сбор урожая — один путь для кнопки, клавиши и тапа: одинаковый текст, звук и эффект */
function doHarvest(){
  if (!world) return null;
  const r = harvestAll(world);
  if (r.n){
    playSfx('harvest', {heavy: clamp(r.kg/Math.max(0.4, world.area*0.02), 0.1, 1)});
    toast(`Собрано ${r.n} шт · ${num(r.kg)} кг → склад`);
  } else {
    toast('Нет спелых плодов');
  }
  renderAll(); if (page==='shop') renderShop();
  return r;
}

/* когда придёт следующий счёт за свет и тепло */
function utilNextBillText(w){
  const rests = UTIL.billDoy.map(d=>((d - (((w.doy-1)%365)+1)) + 365) % 365);
  const days = Math.min(...rests);
  const when = days===0 ? 'сегодня' : `через ${days} дн`;
  return `Счёт ${when}: 1 янв, апр, июл, окт. «Сутки» — прошлые полные сутки, «сезон» — с начала.`;
}
/* что происходит с корпусом лампы — словами, для подсказки в панели климата */
function litWord(warm){ return warm > 0.9 ? 'в режиме' : (warm > 0.35 ? 'остывает' : 'почти остыл'); }
/* цвет шкалы влаги: сухо и перелив — красным, норма — спокойным */
function soilCls(w){
  const st = soilState(w);
  return st.key==='dry' || st.key==='wilt' ? 'hot' : (st.key==='wet' ? 'cold' : '');
}
function renderGauges(){
  const m = world.meas, C = CROPS[world.crop];
  const tCls = m.temp>C.heatTol ? 'hot' : (m.temp<C.coldTol ? 'cold' : '');
  $('gauges').innerHTML =
    gauge('T', m.temp, 5, 38, '°C', tCls) +
    gauge('RH', m.rh, 30, 99, '%', m.rh>C.rhMax?'hot':'', 0) +
    gauge('CO₂', m.co2, 330, 1200, ' ppm', '', 0) +
    gauge('PAR', world.light.meanLeaf, 0, 600, '', '', 0) +
    (()=>{ const D = dliInfo(world);
      const cls = D.ref < D.min ? 'cold' : (D.ref > D.max ? 'hot' : '');
      return `<div class="g" title="Свет за сутки (DLI): сегодня ${nf(D.val,1)}, вчера ${nf(D.yest,1)} из ${D.tgt} моль/м². Норма ${D.min}–${D.max}. Световой день ${nf(D.day,1)} ч, лампа ${nf(D.lampHours,1)} ч.">
        <span>DLI</span><div class="bar"><i class="${cls}" style="width:${clamp(D.val/Math.max(1,D.tgt),0,1)*100}%"></i></div>
        <b>${nf(D.val,1)}</b></div>`; })() +
    gauge('влага', (m.moist===undefined?world.moist:m.moist), 0, 100, '%', soilCls(world), 0) +
    gauge('болезнь', world.disease*100, 0, 100, '%', world.disease>0.4?'hot':'', 0) +
    // корпус лампы остывает не мгновенно: пока он горячий, он греет и после выключения
    (()=>{ const warm = lampWarm(world), kw = lampHeatKW(world);
      if (warm < 0.03) return '';
      const litres = Math.round(warm*100);
      return `<div class="g" title="Корпус светильника ещё отдаёт тепло: ${litWord(warm)}. Это влияет на температуру и на счёт за отопление.">
        <span>лампа</span><div class="bar"><i class="hot" style="width:${Math.round(warm*100)}%"></i></div>
        <b>${nf(kw, kw>=10?0:2)} кВт</b></div>`; })();
  // подсказка о дрейфе датчиков
  const drift = Math.abs(world.drift.temp)+Math.abs(world.drift.rh)/10;
  const days = world.day - world.lastCalib;
  let hint = '';
  if (world.has.secondSensor){
    hint = `Расхождение датчиков: ΔT ${world.drift.temp>=0?'+':''}${nf(world.drift.temp,1)} K, `+
           `ΔRH ${world.drift.rh>=0?'+':''}${nf(world.drift.rh,1)}%, `+
           `Δвлага ${world.drift.soil>=0?'+':''}${nf(world.drift.soil,1)}%`;
  } else if (world.has.alarm){
    const dT = world.meas.temp - world.temp, dR = world.meas.rh - world.rh;
    const dS = (world.meas.moist||0) - (world.moist||0);
    hint = `Контрольный прибор: ΔT ${dT>=0?'+':''}${nf(dT,1)} K, ΔRH ${dR>=0?'+':''}${nf(dR,1)}%, `+
           `Δвлага ${dS>=0?'+':''}${nf(dS,1)}%`;
  } else if (drift > 0.6 || days > 25){
    hint = `Датчики не калибровались ${days} дн. — показания могут врать`;
  }
  $('driftHint').innerHTML = hint ? `<span style="color:var(--warn)">⚠ ${hint}</span>` : 'показания датчиков, не «истина»';
}

/* ---------------- дашборд: финансы ---------------- */
function renderFinance(){
  const w = world;
  const cost = Object.values(w.cost).reduce((s,x)=>s+x,0);
  const profit = w.revenue - cost;
  const h = w.history || [];
  const last = h.length ? h[h.length-1] : null;
  const cb = (last && last.costBreak) || null;
  // статьи: [ключи статей расходов, подпись, знак]; «за сутки» — из разбивки дня
  const items = [
    [['__sales'],   'Продажи', +1],
    [['__rewards'], 'Награды',   +1],
    [['energy'],    'Тепло',   -1],
    [['lamp'],      'Досветка',-1],
    [['co2'],       'CO₂',       -1],
    [['water'],     'Вода',      -1],
    [['fert'],      'Удобр.',  -1],
    [['seed'],      'Семена',    -1],
    [['storage'],   'Склад',     -1],
    [['labor','maint'], 'Труд',  -1],
    [['fixed','penalty','loan'], 'Постоян.',-1],
    [['upgrade','repair','treat'], 'Покупки',-1]
  ];
  const seasonOf = it=>{
    const [keys,,sign] = it;
    if (keys[0]==='__sales') return w.soldEur||0;
    if (keys[0]==='__rewards') return w.rewardSum||0;
    return -keys.reduce((s,k)=>s+(w.cost[k]||0),0);
  };
  const dayOf = it=>{
    const [keys,,sign] = it;
    if (!cb) return null;
    if (keys[0]==='__sales') return (last.rev||0) - (last.rewardDay||0);
    if (keys[0]==='__rewards') return last.rewardDay||0;
    return -keys.reduce((s,k)=>s+(cb[k]||0),0);
  };
  const rows = items.map(it=>({label:it[1], day:dayOf(it), season:seasonOf(it)}))
    .filter(r=>Math.abs(r.season)>0.02 || Math.abs(r.day||0)>0.02);
  const profitDay = last ? (last.profit||0) : (w.profitDay||0);
  const moneyDay  = last ? (last.moneyDelta||0) : null;
  const recon = (w.money - w.startMoney) - profit;
  const cell = v => (v===null || v===undefined) ? '<span class="dim">—</span>'
    : `<b class="${v>0.004?'pos':(v<-0.004?'neg':'')}">${v>0.004?'+':''}${moneyNum(v)}</b>`;
  // свет и тепло: счёт раз в квартал. Строка и кнопка стоят в самом верху карточки,
  // иначе «Оплатить» уезжает под прокрутку и по ней не попасть с первого клика
  const utilBar = (()=>{
    const debt = utilDebt(w), acc = utilAccrued(w), od = utilOverdueDays(w);
    const q = Math.floor(od/90), rate = utilPenaltyRate(w);
    if (debt > 0.005){
      return `<div class="utilBar" style="display:flex;flex-direction:column;gap:4px;padding:6px 7px;margin-bottom:6px;
        border:1px solid rgba(255,123,114,.55);border-radius:6px;background:rgba(255,123,114,.10)">
        <div style="display:flex;justify-content:space-between;gap:6px;font-size:10px;align-items:baseline">
          <span style="color:var(--bad);font-weight:700">счёт: свет, тепло</span>
          <b style="font-variant-numeric:tabular-nums">${moneyNum(debt)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:6px;font-size:10px;color:var(--dim)">
          <span>просрочен${q>0?` ${q} кв.`:''}</span><span>${od} дн${rate>0.001?` · пени ${moneyS(rate)}/сут`:''}</span></div>
        <button class="btn" data-payutil="1" style="width:100%">Оплатить ${moneyS(debt)}</button>
      </div>`;
    }
    return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:10px;color:var(--dim);margin-bottom:5px"
        title="Электричество и тепло выставляются счётом раз в квартал: 1 января, 1 апреля, 1 июля, 1 октября.">
        <span>в счёт: свет, тепло</span><b style="font-variant-numeric:tabular-nums;opacity:.9">${moneyNum(acc)}</b></div>`;
  })();
  $('finance').innerHTML = utilBar + `
    <div class="finHead"><span>статья</span><span>сутки</span><span>сезон, ${moneySym()}</span></div>
    ${rows.map(r=>`<div class="finRow"><span>${r.label}</span>${cell(r.day)}${cell(r.season)}</div>`).join('')}
    ${(()=>{ const m = marginInfo(w);
      return `<div class="finRow" title="Себестоимость килограмма = все расходы сезона ÷ собранные кг. Справа — цена дня.">
        <span>себест./цена 1 кг</span><b class="dim">${m.cost==null?'—':money2(m.cost)}</b>
        <b class="${m.margin==null?'':(m.margin>=0?'pos':'neg')}">${money2(m.price)}</b></div>`; })()}
    <div class="finRow total"><span>Прибыль</span>${cell(profitDay)}${cell(profit)}</div>
    <div class="finRow total"><span>Деньги</span>${cell(moneyDay)}${cell(w.money)}</div>
    <div class="finRow"><span>от старта</span><span class="dim">—</span>${cell(w.money-w.startMoney)}</div>
    ${Math.abs(recon)>1 ? `<div class="finRow"><span>кредит и прочее</span><span class="dim">—</span>${cell(recon)}</div>`:''}
    ${w.money < -0.01 ? `<div class="finRow"><span>долг, ${(CFG.debtRate*100).toFixed(0)}%/сут</span><span class="dim">—</span><b class="neg">${moneyNum(-w.money)}</b></div>`:''}
    <div class="hint" style="margin-top:6px">${w.ctrl.lampEnabled
      ? `Досветка горит: ${nf(lightPowerNowKW(w), lightPowerNowKW(w)>=10?1:2)} кВт — это ${moneyS(lightPowerNowKW(w)*CFG.energyPrice)} в час.`
      : 'Досветка выключена — счётчик света стоит.'} ${utilNextBillText(w)}</div>
    <div class="spark">${h.slice(-40).map(x=>{
      const mx = Math.max(2, ...h.slice(-40).map(y=>Math.abs(y.profit||0)));
      const hp = Math.max(2, Math.abs(x.profit||0)/mx*34);
      return `<i style="height:${hp}px;background:${(x.profit||0)>=0?'#7ad8a0':'#ff7b72'}"></i>`;
    }).join('')}</div>`;
  const pay = $('finance').querySelector('[data-payutil]');
  if (pay) pay.onclick = ()=>{
    const r = payUtil(world);
    playSfx(r.ok ? 'sell' : 'error');
    toast(r.msg);
    renderAll();
  };
}

/* ---------------- баки и возможности ---------------- */
function renderTanks(){
  const box = $('tanks'); if (!box || !world) return;
  const w = world, S = w.stock;
  const daysHint = (what)=>{
    const d = tankDays(w, what);
    if (d===null || !isFinite(d) || d<=0) return '';
    return ' · хватит ' + (d>999 ? '>999' : '≈'+(d<10?nf(d,1):Math.round(d))) + ' дн';
  };
  const row = (label, val, what, cls)=>`<div class="kv"><span>${label}</span><b class="${cls||''}">${val}<span style="font-weight:400;color:var(--dim)">${daysHint(what)}</span></b></div>`;
  const tankRows = [
    row('Вода в баке', `${nf(S.waterM3,0)} м³`, 'water', Math.floor(S.waterM3)<1?'bad':''),
    row('Удобрения', `${nf(S.fertKg, S.fertKg<10?1:0)} кг`, 'fert', S.fertKg<5?'bad':''),
    ...(w.has.co2 ? [row('CO₂ в баллоне', `${nf(S.co2Kg,0)} кг`, 'co2', S.co2Kg<5?'bad':'')] : []),
    row('Семена', `${num(S.seeds)} шт`, null, S.seeds<5?'bad':''),
    row('Склад свободно', `${num(whFreeL(w)/WH.bulkHarvest)} кг`, null, '')
  ];
  const featList = [
    ['Свет: '+lightName(w), hasLight(w)],
    ['LED-панель 420', !!w.has.panel],
    ['Клапан CO₂', w.has.co2],
    ['Термоэкран', w.has.screen],
    ['Затеняющая сетка', w.has.shade],
    ['Автодозирование EC/pH', w.has.dosing],
    ['Второй датчик', w.has.secondSensor],
    ['Обдув кроны', w.has.circFan],
    ['Метеосервис', w.has.weatherSrv],
    ['Страховка', w.has.insurance],
    ['Работник', w.upg.worker],
    ['Автозакупка', w.upg.autoBuy],
    ['Плановый сервис', w.has.service]
  ];
  const yes = featList.filter(f=>f[1]).length;
  box.innerHTML = `
    ${tankRows.join('')}
    <div class="hint" style="margin:7px 0 3px"><b>Возможности: ${yes} из ${featList.length}</b> · чего нет — покупается в магазине</div>
    <div class="featGrid">${featList.map(([n,ok])=>`<div class="feat ${ok?'on':''}"><i>${ok?'✓':'·'}</i>${n}</div>`).join('')}</div>
    <div class="hint" style="margin-top:6px">«Хватит ≈N дн» — оценка по вчерашнему расходу.</div>`;
}

/* ---------------- сеть филиалов ---------------- */
function renderNet(){
  const box = $('netBox'); if (!box) return;
  const w = world;
  const panel = document.querySelector('#dashGrid .panel[data-p="net"]');
  const houses = (w.net && w.net.houses) || [];
  const open = !!(w.camp && w.camp.ch >= 3) || houses.length > 0;
  if (panel) panel.style.display = open ? '' : 'none';
  if (!open) return;
  const t = netTotal(w);
  const cost = netCost(w);
  const chGoal = CHAPTERS[3] ? CHAPTERS[3].goal : 12000;
  const sales = w.camp && w.camp.ch===3 ? chapterSales(w) : 0;
  const pct = Math.min(100, sales/chGoal*100);
  let html = `<div class="kv"><span>филиалов</span><b>${t.n}</b></div>
    <div class="g" style="grid-template-columns:1fr 84px"><span>${money(sales)}/${money(chGoal)}</span>
      <div class="bar"><i style="width:${pct}%;background:repeating-linear-gradient(115deg,#ffc21a 0 6px,#e0a100 6px 12px)"></i></div></div>
    <div class="kv"><span>доход</span><b class="pos">+${money(t.gross)}/сут</b></div>
    <div class="kv"><span>содержание</span><b class="neg">${money(-t.opex)}/сут</b></div>
    <div class="kv"><span>чистыми</span><b class="${t.net>=0?'pos':'neg'}">${money(t.net)}/сут</b></div>`;
  houses.forEach((h,i)=>{
    const g = netGrossDay(w, h);
    html += `<div class="kv"><span>${i+1}. ${CROPS[h.crop].name}</span>
      <b>${money(g.gross-g.opex)}/сут</b></div>`;
  });
  html += `<div style="margin-top:7px">
    <button class="btn good" data-netbuy="1" ${w.money<cost?'disabled':''} style="width:100%">
      Построить филиал · ${money(cost)}</button></div>
    <div class="hint" style="margin-top:5px">Филиал — 400 м² под наёмным агрономом: он не сделает лучше вас,
    но делает сам. Каждый следующий дороже на 25%.</div>`;
  if (houses.length){
    html += `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">` +
      houses.map((h,i)=>`<button class="btn" data-netsell="${i}" style="font-size:9.5px;padding:3px 6px">
        продать ${i+1}-й · ${money(Math.round(h.price*NET.refund))}</button>`).join('') + `</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-netbuy]').forEach(b=>b.onclick=()=>{
    const r = netBuy(world, world.crop); toast(r.msg);
    renderAll(); saveNow(false);
  });
  box.querySelectorAll('[data-netsell]').forEach(b=>b.onclick=()=>{
    const back = netSell(world, +b.dataset.netsell);
    toast('Филиал продан за '+money(back)); renderAll(); saveNow(false);
  });
}

/* ---------------- дашборд: риски ---------------- */
function renderAlerts(){
  const w = world, C = CROPS[w.crop], out = [];
  // отказы
  const broken = [];
  for (const k in w.equip) if (!w.equip[k].ok && equipInstalled(w,k)) broken.push(EQUIP_DEFS[k].name);
  if (!w.power) out.push(['bad','Нет электричества: отопление и форточки не работают']);
  if (broken.length) out.push(['bad','Отказ: '+broken.join(', ')+'. Магазин → Сервис → Ремонт']);
  // гарантия: возврат денег за прибор, сломавшийся на 180–364-й день
  if (w.warranty && w.warranty.length){
    for (const r of w.warranty){
      const left = Math.max(0, r.due - w.day);
      out.push(['ok', `Гарантия: ${r.name} — ${money(r.eur)} вернут через ${left} дн (${fmtDate(w.doy + left)})`]);
    }
  }
  // климат по датчикам
  if (w.meas.temp > C.heatTol) out.push(['warn', `Перегрев ${nf(w.meas.temp,1)} °C — аборт завязей, откройте форточки или затенение`]);
  if (w.meas.temp < C.coldTol) out.push(['warn', `Холод ${nf(w.meas.temp,1)} °C — рост останавливается`]);
  if (w.meas.rh > C.rhMax) out.push(['warn', `Влажность ${nf(w.meas.rh,0)}% — риск серой гнили, нужна вентиляция`]);
  if (w.disease > 0.25) out.push(['bad', `Серая гниль ${(w.disease*100)|0}% — обработка в магазине`]);
  if (w.pest.active) out.push(['bad', `Паутинный клещ: уровень ${(w.pest.level*100)|0}% — обработка`]);
  // коммунальные счета: неоплаченный счёт — это пени, а с четвёртого квартала суд
  {
    const debt = utilDebt(w);
    if (debt > 0.01){
      const od = utilOverdueDays(w), q = Math.floor(od/90);
      const tail = q >= 4 ? ' — суд уже был, издержки в счёте' : (q >= 3 ? ' — следующий квартал и суд' : '');
      out.push([q >= 2 ? 'bad' : 'warn',
        `Счёт за свет и тепло ${moneyS(debt)} не оплачен${od>0?`, просрочен ${od} дн`:''}: пени ${moneyS(utilPenaltyRate(w))} в сутки${tail}`]);
    }
  }
  // долг
  if (w.money < -0.01){
    const rate = (typeof CFG!=='undefined' && CFG.debtRate) ? CFG.debtRate : 0.02;
    out.push(['bad', `Долг ${moneyS(-w.money)}: проценты ${moneyS(-w.money*rate)} в сутки. Покупки заблокированы — продайте урожай или уберите расходы`]);
  }
  // свет: будильник напоминает, но не переключает
  if (hasLight(w) && w.ctrl.alarmOn){
    const from = w.ctrl.alarmFrom, to = w.ctrl.alarmTo, h = w.hour;
    const inside = from < to ? (h >= from && h < to) : (h >= from || h < to);
    if (inside && !w.ctrl.lampEnabled) out.push(['warn', `Будильник досветки: время с ${fmtHour(from)} до ${fmtHour(to)} — включите лампу кнопкой «Досветка» под сценой`]);
    if (!inside && w.ctrl.lampEnabled) out.push(['warn', `Будильник досветки: окно закончилось — выключите лампу, она ест электричество впустую`]);
  } else if (hasLight(w) && w.ctrl.lampEnabled && (w.hour < 4 || w.hour > 22)) {
    out.push(['warn', 'Досветка горит ночью: растение не фотосинтезирует, а счётчик крутится — выключите лампу']);
  }
  // запасы
  if (w.stock.fertKg < 5) out.push(['warn','Удобрения заканчиваются — рост замедлится']);
  if (w.has.co2 && w.stock.co2Kg < 5 && w.ctrl.co2Set > 450) out.push(['warn','CO₂ заканчивается — заданный уровень не держится']);
  if (w.stock.waterM3 < 3) out.push(['bad','Нет воды в баке — полить нечем, купите воду в магазине']);
  // влага субстрата: датчик показывает проценты, поливает игрок руками
  {
    const st = soilState(w), m = Math.round(w.moist||0);
    if (st.key === 'wilt') out.push(['bad', `Субстрат ${m}%: куст вянет — полейте срочно (кнопка «Полить» или клик по горшку)`]);
    else if (st.key === 'dry') out.push(['warn', `Субстрат ${m}%: сухо, устьица закрываются — полейте (кнопка «Полить» или клик по горшку)`]);
    else if (st.key === 'wet') out.push(['warn', `Субстрат ${m}%: перелив, корни без воздуха — откройте проветривание, полив подождите`]);
  }
  // контракты
  for (const ct of w.contracts){
    if (!ct.done && ct.deadline - w.day <= 5) out.push(['warn', `Контракт «${ct.label}»: осталось ${ct.deadline-w.day} дн., недопоставка ${num(ct.leftKg)} кг`]);
  }
  // висит спелый урожай
  const ripeKg = w.plants.reduce((a,p)=>a+p.fruits.filter(f=>f.ripe&&!f.harvested).reduce((x,f)=>x+(w.crop==='lettuce'?0:CROPS[w.crop].fruitFresh),0),0)*w.plantScale;
  if (ripeKg > 30 && !w.upg.worker) out.push(['warn', `Спелых плодов ~${num(ripeKg)} кг — соберите урожай (кнопка снизу или клик по плоду)`]);
  // погода (если есть метеосервис)
  if (w.has.weatherSrv){
    for (const ev of w.events) if (ev.inFuture && ev.label) out.push(['warn', `${ev.label} через ${Math.max(1,Math.round(ev.inDays))} дн.`]);
  }
  if (!out.length) out.push(['ok','Критических рисков нет']);
  // сначала плохие, потом предупреждения: будильник не должен теряться за мелочью
  const rank = {bad:0, warn:1, ok:2};
  out.sort((a,b)=>(rank[(a[0])]||9)-(rank[(b[0])]||9));
  $('alerts').innerHTML = out.slice(0,8).map(([k,t])=>`<div class="alert ${k}">${t}</div>`).join('');
}

/* ---------------- дашборд: цели сезона ---------------- */
function renderGoals(){
  if (!world) return;
  const g = seasonGoals(world);
  $('goals').innerHTML = g.map(x=>{
    const done = x.pct >= 1;
    const shown = x.unit==='€' ? money(x.value)+' / '+money(x.target)
                : x.unit==='кг' ? num(x.value)+' / '+num(x.target)+' кг'
                : num(x.value)+' / '+num(x.target)+' '+(x.unit||'');
    return `<div class="goal">
      <div class="g" style="grid-template-columns:1fr auto"><span style="${done?'color:var(--acc)':''}">${done?'✓ ':''}${x.label}</span><b>${Math.round(x.pct*100)}%</b></div>
      <div class="g" style="grid-template-columns:1fr"><div class="bar"><i style="width:${x.pct*100}%"></i></div></div>
      <div class="hint" style="margin-top:-2px">${shown}</div>
    </div>`;
  }).join('');
}

/* ---------------- дашборд: почему так ---------------- */
function renderDiagnosis(){
  if (!world) return;
  const d = diagnose(world);
  const head = `<div class="kv"><span>усвоено за сутки</span><b>${world.day>1?nf(d.assimDay,1)+' г/м²':'— (первый день)'}</b></div>`;
  const body = d.items.length
    ? d.items.map(it=>{
        const cls = it.sev==='bad'?'bad':it.sev==='warn'?'warn':'ok';
        return `<div class="alert ${cls}" style="margin-bottom:4px">${it.text}</div>`;
      }).join('')
    : `<div class="alert ok">Растение у своего предела: свет, питание и климат в норме</div>`;
  $('diagnosis').innerHTML = head + body +
    `<div class="hint" style="margin-top:4px">углерод, усвоенный кроной за прошлые сутки. Ориентир: 15–25 г/м²·сут у томата в апреле</div>`;
}

/* ---------------- дашборд: задания, склад, контракты, журнал ---------------- */
function renderMissions(){
  const i = world.missionIdx;
  let html = '';
  for (let k=i; k<Math.min(i+3, MISSIONS.length); k++){
    const m = MISSIONS[k];
    html += `<div class="task"><div>${k===i?'▸ ':'· '}${m.text}</div>
      <div class="r">награда ${money(m.reward)}</div></div>`;
  }
  if (i>=MISSIONS.length-1) html = `<div class="task done">Все задания выполнены</div>`;
  html += `<div class="hint">Выполнено: ${world.missionsDone} · награды — это доход</div>`;
  $('missions').innerHTML = html;
}
function renderStock(){
  const s = world.stock, wh = world.wh;
  const cap = whCap(world), used = whUsedL(world);
  const pct = clamp(used/cap, 0, 1)*100;
  const lots = wh.lots.slice().sort((a,b)=>b.age-a.age);
  const shelfRows = lots.map(l=>{
    const C = CROPS[l.crop];
    const left = Math.max(0, l.shelf - l.age);
    const q = Math.round(lotQuality(l)*100);
    return `<div class="kv"><span>${ic(C)} ${C.name.split(' ')[0]} · ${l.age} дн</span>
      <b style="${left<=1?'color:var(--bad)':(left<=3?'color:var(--warn)':'')}">${num(l.kg)} кг · ещё ${left} дн · ${q}% · −${nf(100/l.shelf,0)}%/сут</b></div>`;
  }).join('');
  const freeKg = whFreeL(world)/WH.bulkHarvest;
  const stockHtml = `
    <div class="g" style="grid-template-columns:64px 1fr 74px">
      <span>занято</span>
      <div class="bar"><i style="width:${pct}%;${pct>88?'background:linear-gradient(90deg,#ffb86b,#ff7b72)':''}"></i></div>
      <b>${Math.round(used)}/${cap} л</b>
    </div>
    ${shelfRows || `<div class="hint" style="margin-bottom:4px">Продукции нет — соберите урожай.</div>`}
    <div class="kv"><span>Удобрения</span><b style="${s.fertKg<8?'color:var(--bad)':''}">${s.fertKg.toFixed(s.fertKg<10?1:0)} кг</b></div>
    <div class="kv"><span>CO₂</span><b style="${s.co2Kg<8?'color:var(--bad)':''}">${s.co2Kg.toFixed(s.co2Kg<10?1:0)} кг</b></div>
    <div class="kv"><span>Семена</span><b>${num(s.seeds)} шт</b></div>
    <div class="kv"><span>Вода (в баке)</span><b style="${s.waterM3<5?'color:var(--bad)':''}">${s.waterM3.toFixed(0)} м³</b></div>
    ${marketBlock(world)}
    <div class="hint" style="margin-top:6px">${wh.sections} секц. · содержание ${money2(whRentDay(world))}/сут ·
      свободно ${num(freeKg)} кг</div>
    <div class="hint">Лёжкость ${CROPS[world.crop].name.split(' ')[0].toLowerCase()}: ${CROPS[world.crop].shelfDays} дн →
      теряется <b>${nf(100/CROPS[world.crop].shelfDays,0)} % массы</b> и <b>${nf(0.55/1.4*100/CROPS[world.crop].shelfDays,0)} % цены</b> в сутки;
      после ${CROPS[world.crop].shelfDays*2} дн партия списывается целиком.</div>
    ${wh.wasteKg>1 ? `<div class="hint" style="color:var(--warn)">испорчено за сезон: ${num(wh.wasteKg)} кг (${money(wh.wasteEur)})</div>`:''}
    <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
      <button class="btn good" id="btnSellAll" ${storeKg(world)>0.5?'':'disabled'}>Продать всё · ${money2(priceToday(world))}/кг</button>
      <button class="btn" id="btnWhExpand" title="Вторая секция: +600 л места, но и содержание">+секция ${money(whSectionCost(world))}</button>
    </div>`;
  setHTML('stock', stockHtml);
  const sell = $('btnSellAll');
  if (sell) press(sell, ()=>{
    const r = sellHarvest(world, world.crop, null);
    playSfx(r.ok ? 'sell' : 'error');
    toast(r.ok ? `Продано ${num(r.kg)} кг за ${money(r.eur)}` : 'На складе нет продукции');
    renderAll(); if (page==='shop') renderShop();
  });
  const ex = $('btnWhExpand');
  if (ex) press(ex, ()=>{
    const r = addSection(world);
    toast(r.ok ? `Склад: ${world.wh.sections} секций (${money(-r.cost)}). Содержание ${money2(whRentDay(world))}/сут`
               : r.msg);
    renderAll(); if (page==='shop') renderShop();
  });
}
/* Рынок: цена сегодня, из чего она собрана и что будет через неделю.
   Игрок должен видеть решение «продать сейчас или подождать», а не одно число. */
function marketBlock(w){
  const crop = w.crop, C = CROPS[crop];
  const price = priceToday(w, crop);
  const ahead = seasonAhead(w, crop, 21);   // трёхнедельный горизонт: за неделю рынок почти не двигается
  const noise = (w.market && w.market.mult && w.market.mult[crop]) || 1;
  const season = seasonFactor(crop, w.doy);
  const hist = (w.market.hist && w.market.hist[crop]) || [];
  const max = Math.max(1.2, ...hist), min = Math.min(0.6, ...hist);
  const W = 100, H = 22;
  const bars = hist.length > 1 ? hist.map((v,i)=>{
    const x = i/(hist.length-1)*W;
    const y = H - (v - min)/(max - min || 1)*H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') : '';
  const arrow = ahead.pct > 0.02 ? '▲ дорожает' : ahead.pct < -0.02 ? '▼ дешевеет' : '→ ровно';
  const cls = ahead.pct > 0.02 ? 'ok' : ahead.pct < -0.02 ? 'warn' : '';
  return `<div class="kv"><span>Цена ${C.name.split(' ')[0].toLowerCase()}</span><b>${money2(price)}/кг</b></div>
    <div class="kv"><span>сезон ×${nf(season,2)} · спрос дня ×${nf(noise,2)}</span><b class="${cls}">${arrow}</b></div>
    ${bars ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:22px;margin:3px 0 1px">
      <polyline points="${bars}" fill="none" stroke="var(--acc)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
    </svg>` : `<div class="hint" style="margin:2px 0 1px">график цены появится через пару дней</div>`}
    <div class="hint">через 3 недели ${money2(C.price*w.profilePriceF*ahead.next*noise)}/кг
      (${ahead.pct>0?'+':''}${Math.round(ahead.pct*100)}%) ·
      ${ahead.pct < -0.03 ? 'лучше продать сейчас' : ahead.pct > 0.03 ? 'можно подождать' : 'время не решает'}</div>`;
}

function renderContracts(){
  const act = world.contracts.filter(c=>!c.done);
  if (!act.length){ setHTML('contracts', `<div class="hint">Нет активных. Предложения — в магазине.</div>`); return; }
  const cHtml = act.map(c=>{
    const pct = clamp(1-c.leftKg/c.kg,0,1)*100;
    const canDeliver = storeKg(world, c.crop) > 1;
    return `<div style="margin-bottom:7px">
      <div class="kv"><span>${c.label} ×${c.priceMult}</span><b>${num(c.delivered)}/${num(c.kg)} кг</b></div>
      ${(()=>{ const cc = c.crop || world.crop;
        const lock = c.priceLock || CROPS[cc].price*world.profilePriceF*c.priceMult;
        const now = priceToday(world, cc);
        const note = !c.priceLock ? '' : now < lock ? ' — рынок ниже, контракт выгоден'
                                            : now > lock ? ' — рынок выше, партию лучше продать свободно' : '';
        return `<div class="hint">цена зафиксирована при подписании: ${money2(lock)}/кг${note}</div>`; })()}
      <div class="g"><span>до D${c.deadline}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct|0}%</b></div>
      <button class="btn" data-deliver="${c.id}" style="margin-top:4px" ${canDeliver?'':'disabled'}>
        Поставить со склада</button>
    </div>`;
  }).join('');
  if (setHTML('contracts', cHtml))
    document.querySelectorAll('[data-deliver]').forEach(b=>press(b, ()=>{
      const r = deliverContract(world, b.dataset.deliver);
      toast(r.ok ? `Поставлено ${num(r.kg)} кг за ${money(r.eur)}${r.bonus?' · бонус '+money(r.bonus):''}` : r.msg);
      renderAll(); if (page==='shop') renderShop();
    }));
}
function renderMail(){
  const box = $('mail');
  if (!box) return;
  const panel = $('mailPanel');
  if (!world.camp){ if (panel) panel.style.display = 'none'; return; }
  if (panel) panel.style.display = '';
  const ch = CHAPTERS[world.camp.ch];
  const unread = world.mail.filter(m=>!m.read).length;
  let html = `<div class="kv"><span>Глава ${world.camp.ch+1}/${CHAPTERS.length}</span><b>${ch.name}</b></div>
    <div class="hint" style="margin:3px 0 6px">${ch.note}</div>`;
  if (ch.goal > 0){
    const sales = chapterSales(world);
    const pct = clamp(sales/ch.goal,0,1)*100;
    html += `<div class="g" style="grid-template-columns:44px 1fr 84px"><span>продажи</span>
      <div class="bar"><i style="width:${pct}%;background:repeating-linear-gradient(115deg,#ffc21a 0 6px,#e0a100 6px 12px)"></i></div>
      <b>${money(sales)}/${money(ch.goal)}</b></div>`;
  }
  if (world.mail.length){
    html += world.mail.map(m=>`<button class="btn" data-mail="${m.id}" style="display:block;width:100%;text-align:left;margin-bottom:4px;white-space:normal;line-height:1.3;font-size:10px">
      ${m.read?'':'<b style="color:var(--acc2)">● </b>'}${m.subj.length>46?m.subj.slice(0,44)+'…':m.subj}</button>`).join('');
  } else {
    html += `<div class="hint">Писем нет.</div>`;
  }
  if (setHTML('mail', html))
    document.querySelectorAll('[data-mail]').forEach(b=>press(b, ()=>openMail(b.dataset.mail)));
}
function openMail(id){
  const m = world.mail.find(x=>x.id===id);
  if (!m) return;
  m.read = true;
  $('mailBox').innerHTML = `<h1>${m.subj}</h1><p>${m.body}</p>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
      ${m.opts.map((o,i)=>`<button class="btn good" data-answer="${i}" style="text-align:left">
        ${o.label}${o.desc?`<div class="hint" style="color:#3a2d12">${o.desc}</div>`:''}</button>`).join('')}
    </div>`;
  $('mailModal').classList.add('on');
  document.querySelectorAll('[data-answer]').forEach(b=>press(b, ()=>{
    answerMail(world, id, +b.dataset.answer);
    $('mailModal').classList.remove('on');
    renderAll(); toast('Ответ отправлен');
  }));
}

function renderLog(){
  $('log').innerHTML = world.log.slice(0,16).map(l=>`<div class="${l.k||''}">${l.t} · ${l.m}</div>`).join('');
}

/* ---------------- магазин ---------------- */
const OWNED = {
  thermo:w=>w.has.alarm, sticky:w=>w.has.sticky, circFan:w=>w.has.circFan,
  handDose:w=>w.has.handDose, ledStrip:w=>w.has.ledStrip, humid:w=>w.has.humid,
  ups:w=>w.has.ups, film:w=>w.has.film, climatePC:w=>w.has.climatePC,
  led:w=>w.has.led, ledBoost:w=>w.upg.ledBoost, screen:w=>w.has.screen, shade:w=>w.has.shade,
  dosing:w=>w.has.dosing, secondSensor:w=>w.has.secondSensor, worker:w=>w.upg.worker,
  reliability:w=>w.upg.reliability, service:w=>w.has.service, insurance:w=>w.has.insurance,
  biocontrol:w=>w.has.biocontrol, weather:w=>w.has.weatherSrv, autoBuy:w=>w.upg.autoBuy,
  // балкон на лёгкой сложности приходит с этими двумя — в магазине они уже «куплены»
  windowFilm:w=>!!w.has.windowFilm, heaterMini:w=>!!w.has.heatBoost,
  humid:w=>!!w.has.humid, ups:w=>!!w.has.ups, strip2:w=>!!w.has.strip2, panel:w=>!!w.has.panel
};
function shopTopLine(){
  const tr = marketTrend(world, world.crop);
  return `Баланс: <b style="color:var(--acc2)">${money(world.money)}</b> · ` +
    `склад: <b>${Math.round(whUsedL(world))}/${whCap(world)} л</b> · ` +
    `цена дня: <b style="color:var(--acc)">${money2(priceToday(world))}/кг</b> ` +
    (tr>0.01?'<span style="color:#a8e05a">▲ растёт</span>':(tr<-0.01?'<span style="color:var(--bad)">▼ падает</span>':''));
}
function renderShop(){
  if (!world) return;
  const groups = SHOP();
  let html = `<div class="hint" id="shopBalance" style="margin-bottom:12px;color:var(--txt)">${shopTopLine()}
    · профиль ${PROFILES[world.profile].name} (цена реализации ×${nf(PROFILES[world.profile].priceF,1)} к базовой,
    апгрейды ×${nf(PROFILES[world.profile].upgF,2)})</div>`;
  for (const g of groups){
    html += `<div class="sect"><h3>${g.group}</h3><div class="grid">`;
    for (const it of g.items){
      // кампания — обучающий режим: вещи открываются по главам, с объяснением «зачем»
      if (world.camp && gearLocked(world, it)){
        html += `<div class="card locked">
          <div class="h"><b>${it.name}</b><span class="lock">глава ${it.ch+1}</span></div>
          <div class="why"><b>Зачем:</b> ${it.why||''}</div>
          <div class="f"><span class="hint">Откроется: ${gearChapterName(it.ch)} · глава ${it.ch+1}</span></div>
        </div>`;
        continue;
      }
      const owned = OWNED[it.id] ? OWNED[it.id](world) : false;
      const reqOk = !it.req || it.req(world);
      let price = it.price ? it.price(world) : upgradeCost(world, it.base, it.noScale);
      if (it.id==='repair'){
        let t = 0; for (const k in world.equip) if (!world.equip[k].ok) t += EQUIP_DEFS[k].repair;
        price = t;
      }
      const noRoom = it.bulk && whFreeL(world) < it.bulk;
      const affordable = world.money >= price && !noRoom;
      const disabled = (!reqOk || owned || (it.id!=='repair' && !affordable));
      const label = owned ? 'Куплено'
        : (it.id==='repair' ? (price ? 'Отремонтировать' : 'Всё работает')
        : (noRoom ? 'Склад полон' : (!affordable ? 'Мало средств' : (it.dynamic ? 'Купить' : 'Установить'))));
      html += `<div class="card">
        <div class="h"><b>${it.name}</b></div>
        <div class="d">${it.desc}</div>
        ${it.why ? `<div class="why"><b>Зачем:</b> ${it.why}</div>` : ''}
        <div class="f"><span class="price">${it.id==='repair'? (price? money(price):'—') : money(price)}</span>
        <button class="btn" data-buy="${it.id}" ${disabled?'disabled':''}>${label}</button></div>
      </div>`;
    }
    html += `</div></div>`;
  }
  // контракты
  const offers = offerContracts(world);
  html += `<div class="sect"><h3>Контракты</h3><div class="grid">` +
    offers.map((o,i)=>`<div class="card">
      <div class="h"><b>${o.label}</b><span class="price">${num(o.kg)} кг</span></div>
      <div class="d">${o.desc}<br>Наценка к цене ×${o.priceMult}, бонус за выполнение ${money(o.bonus)}</div>
      <div class="f"><span class="hint">до D${o.deadline}</span>
      <button class="btn" data-contract="${i}">Подписать</button></div></div>`).join('') +
    `</div></div>`;
  $('shopBody').innerHTML = html;

  document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{
    const r = buyItem(world, b.dataset.buy);
    playSfx(r.ok ? 'buy' : 'error');
    toast(r.msg);
    renderShop(); renderAll();
  });
  document.querySelectorAll('[data-contract]').forEach(b=>b.onclick=()=>{
    if (signContract(world, +b.dataset.contract)){ toast('Контракт подписан'); renderShop(); }
    else toast('Нельзя: уже два активных контракта');
  });
}

/* ---------------- параметры ---------------- */
function renderSettings(){
  if (!world) return;
  const c = world.ctrl, C = CROPS[world.crop], P = PROFILES[world.profile];
  const slider = (id,label,min,max,step,val,fmt) => `
    <div class="row"><label>${label}</label><span class="val" id="v_${id}">${fmt(val)}</span></div>
    <input type="range" id="s_${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <div style="height:8px"></div>`;
  $('settingsBody').innerHTML = `
  <div class="setgrid">
    <div class="card">
      <div class="h"><b>Климат</b></div>
      ${slider('heat','Отопление ≥',8,28,0.5,c.heatSet,v=>nf(v,1)+' °C')}
      ${slider('vent','Вентиляция ≥',14,38,0.5,c.ventSet,v=>nf(v,1)+' °C')}
      ${world.has.co2 ? slider('co2','Целевой CO₂',400,1200,25,c.co2Set,v=>v+' ppm')
        : `<div class="row"><label>Обогащение CO₂</label><span class="val">нет оборудования</span></div>
           <div class="hint">На балконе и в комнате клапана нет: воздух и так меняется через щели. Появится вместе с теплицей.</div>`}
      <div class="hint">Проветривание выдувает CO₂ и тепло: чем ниже порог, тем дороже сезон, но суше воздух.</div>
    </div>
    <div class="card">
      <div class="h"><b>Место и дата</b></div>
      <div class="d" style="color:var(--txt)">${(world.site&&world.site.name)||'Екатеринбург'} · ${(ORIENTS[(world.site&&world.site.orient)||'S']||ORIENTS.S).name}</div>
      <div class="hint">старт ${fmtDate(world.startDoy||world.doy)} · день ${world.day} из ${world.seasonDays||CFG.seasonDays}</div>
      ${(()=>{ const N = siteNormals(world.site||{region:'uralsib'});
        const now = Math.round(normAt(N.temp, world.doy));
        return `<div class="hint">норма сейчас ${now>0?'+':''}${now} °C · солнце ${Math.round(normAt(N.sun, world.doy)*100)} % от возможного
        · регион ${N.region}</div>
        <div class="hint">данные: средние многолетние 1991–2020 по открытым источникам (Гидрометцентр, Википедия).
        Смена места и даты — только новой игрой: климат сезона не подменяется на ходу.</div>`; })()}
    </div>
    <div class="card">
      <div class="h"><b>Система выращивания</b></div>
      <div class="d" style="color:var(--txt)">${sysOf(world).name}</div>
      <div class="hint" style="margin-bottom:8px">${sysOf(world).note}</div>
      ${Object.values(GROW_SYS).map(S=>{
        const cur = world.sys === S.id;
        const allowed = sysAllowed(world, S.id);
        const cost = Math.round((S.cost||0)*P.upgF);
        const label = cur ? 'сейчас' : (!allowed ? 'глава '+(S.ch+1) : (cost? money(cost) : 'бесплатно'));
        return `<div class="row"><label>${S.name}<div class="hint">вода ×${nf(S.waterF,2)} · рост ×${nf(S.yieldF,2)} · гниль ×${nf(S.rotF,1)}</div></label>
          <button class="btn ${cur?'good':''}" data-sysset="${S.id}" ${cur||!allowed?'disabled':''}>${label}</button></div>`;
      }).join('')}
      <div class="hint">Переход стоит денег и обнуляет часть гнили: это новый корневой объём, а не пересадка куста.</div>
    </div>
    <div class="card">
      <div class="h"><b>Звук</b></div>
      <div class="d" style="color:var(--txt)">${SFX.on ? (SFX.vol>0.001 ? 'включён · громкость '+Math.round(SFX.vol*100)+'%' : 'включён, но громкость 0') : 'выключен'}</div>
      <div class="row"><label>Сбор, продажа, покупка, вода, свет, счёт
        <div class="hint">Звук синтезируется в браузере: файлов нет, работает офлайн. Клавиша <b>Z</b> глушит и возвращает.</div></label>
        <button class="btn ${SFX.on?'good':''}" id="btnSndSet">${SFX.on?'вкл':'выкл'}</button></div>
      <input type="range" id="sndVol" min="0" max="100" step="5" value="${Math.round(SFX.vol*100)}">
      <div class="row"><label>Фон теплицы: вентилятор и капель
        <div class="hint">Тихий слой под событиями: гул форточек и обдува, редкие капли по влажности субстрата.</div></label>
        <button class="btn ${SFX.amb?'good':''}" id="btnAmbSet">${SFX.amb?'вкл':'выкл'}</button></div>
      <div class="hint">${SFX.state().running ? 'браузер разрешил звук' : 'звук включится после первого клика — так требуют браузеры'}</div>
    </div>
    <div class="card">
      <div class="h"><b>Свет и экраны</b></div>
      <div class="row"><label>Досветка: <b>${lightName(world)}</b>
        ${hasLight(world)?'':'<span style="color:var(--bad)">(не куплена)</span>'}
        <div class="hint">${lampPPFDOf(world)} µmol/м²·с · ${nf(lampPowerKW(world),2)} кВт${world.has.panel?' · панель':' '}</div>
        <div class="hint">${hasLight(world)
          ? (c.lampEnabled ? `горит${world.power?'':' — <span style="color:var(--bad)">нет электричества</span>'}` : 'выключена')
          : 'Купите лампу в магазине — «Бюджетный старт» или «Оборудование».'}</div></label>
        <button class="btn ${c.lampEnabled?'good':''}" id="btnLampSet" ${hasLight(world)?'':'disabled'}>${c.lampEnabled?'вкл':'выкл'}</button></div>
      <div class="row"><label>Будильник досветки
        <div class="hint">Включать/выключать лампу всё равно вручную: будильник только напоминает алертом.</div></label>
        <button class="btn ${c.alarmOn?'good':''}" id="btnAlarmSet" ${hasLight(world)?'':'disabled'}>${c.alarmOn?'вкл':'выкл'}</button></div>
      ${c.alarmOn && hasLight(world) ? `
      ${slider('afrom','Будильник: включать с',0,23,1,c.alarmFrom,v=>String(v).padStart(2,'0')+':00')}
      ${slider('ato','Будильник: выключать в',1,24,1,c.alarmTo,v=>(v>=24?'24:00':String(v).padStart(2,'0')+':00'))}
      <div class="hint">Сейчас ${fmtHour(Math.floor(world.hour))}:${String(Math.floor((world.hour%1)*60)).padStart(2,'0')} · ${alarmState(world)}</div>` : ''}
      <div class="hint">Можно вручную (лампа горит, пока не выключите) или по таймеру — карточка «Таймеры и автоматизация» ниже. Будильник только напоминает и сам ничего не переключает.</div>
      <div class="row"><label>Термоэкран ${world.has.screen?'':'<span style="color:var(--dim)">(не куплен)</span>'}</label>
        <button class="btn ${c.screenOn?'good':''}" id="btnScreenSet">${c.screenOn?'вкл':'выкл'}</button></div>
      <div class="row"><label>Затеняющая сетка ${world.has.shade?'':'<span style="color:var(--dim)">(не куплена)</span>'}</label>
        <button class="btn ${c.shadeOn?'good':''}" id="btnShadeSet">${c.shadeOn?'вкл':'выкл'}</button></div>
      <div class="hint">Экран экономит тепло ночью, сетка спасает от перегрева днём — но обе забирают свет.</div>
    </div>
    <div class="card" id="autoCard">
      <div class="h"><b>Таймеры и автоматизация</b></div>
      ${AUTO_KEYS.map(k=>{
        const a = world.auto[k.id] || {on:false};
        const ok = autoAllowed(world, k.id);
        const why = autoWhy(world, k.id);
        const now = world.hour;
        let nowText = '';
        if (k.id==='lamp')  nowText = a.on ? (inWindow(now, a.from, a.to) ? 'сейчас в окне · лампа по расписанию' : 'вне окна · лампа выключена') : '';
        if (k.id==='water') nowText = a.on ? (inWindow(now, a.from, a.to) ? `сейчас в окне · цель ${a.target}%` : 'вне окна · полива нет') : '';
        if (k.id==='co2')   nowText = a.on ? (inWindow(now, a.from, a.to) ? 'клапан открыт для цели' : 'вне окна · клапан закрыт') : '';
        if (k.id==='full')  nowText = a.on ? 'автопилот: свет по кроне, влага по датчику, CO₂ у цели' : '';
        return `<div class="row"><label>${k.name}
            <div class="hint">${ok ? k.note : '<span style="color:var(--warn)">'+why+'</span>'}</div>
            ${nowText ? `<div class="hint" style="color:var(--acc)">${nowText}</div>` : ''}
          </label>
          <button class="btn ${a.on?'good':''}" data-auto="${k.id}" ${ok?'':'disabled'}>${a.on?'вкл':'выкл'}</button></div>
          ${(a.on && ok && k.id!=='full') ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 8px">
            <span class="hint">с</span><input type="number" min="0" max="24" step="1" value="${a.from}" data-autonum="${k.id}.from" style="width:62px">
            <span class="hint">до</span><input type="number" min="0" max="24" step="1" value="${a.to}" data-autonum="${k.id}.to" style="width:62px">
            ${k.id==='water' ? `<span class="hint">цель влаги</span><input type="number" min="20" max="90" step="1" value="${a.target||55}" data-autonum="${k.id}.target" style="width:62px"><span class="hint">%</span>` : ''}
          </div>` : ''}`;
      }).join('')}
      <div class="hint">Свободный сезон открывает всё сразу. В кампании таймеры приходят по шагам: свет → полив → CO₂ → полная автоматизация (нужен климат-контроллер). Кнопка «Досветка» под сценой сильнее расписания: нажали — таймер света выключается, и лампа снова в руках.</div>
    </div>
    <div class="card">
      <div class="h"><b>Питание по стадии (fertigation)</b></div>
      ${(()=>{ const R = stageRecipe(world);
        const inEC = c.ecSet >= R.ec[0] && c.ecSet <= R.ec[1];
        const mid = nf((R.ec[0]+R.ec[1])/2,1), phMid = nf((R.ph[0]+R.ph[1])/2,1);
        return `<div class="kv"><span>стадия</span><b>${R.name}</b></div>
        <div class="hint" style="margin-bottom:7px">${R.why}</div>
        <div class="row"><label>Рецепт фазы
            <div class="hint">EC ${nf(R.ec[0],1)}–${nf(R.ec[1],1)} · pH ${nf(R.ph[0],1)}–${nf(R.ph[1],1)}${
              inEC ? ' · <span style="color:var(--acc)">EC в коридоре</span>'
                   : ' · <span style="color:var(--warn)">EC вне коридора фазы</span>'}</div></label>
          <button class="btn ${inEC?'':'good'}" id="btnRecipeApply">поставить ${mid} / ${phMid}</button></div>`; })()}
      ${slider('ec','EC, мСм/см',1.0,3.6,0.1,c.ecSet,v=>nf(v,1))}
      ${slider('ph','pH',5.0,6.8,0.1,c.phSet,v=>nf(v,1))}
      <div class="row"><label>Рецепт</label>
        <select id="recipeSel">
          <option value="std" ${c.recipe==='std'?'selected':''}>Стандартный</option>
          <option value="fruit" ${c.recipe==='fruit'?'selected':''}>Плодоношение (+K, +Ca)</option>
          <option value="veg" ${c.recipe==='veg'?'selected':''}>Вегетативный (+N)</option>
        </select></div>
      <div class="hint">Низкий EC — дефицит питания, высокий — засоление. Без кальция плоды поражает вершинная гниль.
      ${world.has.dosing?'Автодозирование установлено ✓':'Без автодозирования дозы плавают (−7% усвоения)'}</div>
    </div>
    <div class="card">
      <div class="h"><b>Камера</b></div>
      <div class="row"><label>Наклон мышью
        <div class="hint">По умолчанию: тянете вниз — смотрите ниже, тянете вверх — на крышу и небо.</div></label>
        <button class="btn ${camInvertY?'good':''}" id="btnCamInv">${camInvertY?'инверсия':'обычно'}</button></div>
      <div class="hint">Кнопки ▲▼ рядом со сценой и стрелки клавиатуры не инвертируются.</div>
      <div class="row"><label>Сброс ракурса</label>
        <button class="btn" id="btnCamReset">⟲ как было</button></div>
    </div>
    <div class="card">
      <div class="h"><b>Валюта</b></div>
      <div class="row"><label>Показывать суммы в<div class="hint">Меняется только подпись и курс — экономика одна и та же.</div></label>
        <div style="display:flex;gap:6px">
          ${Object.values(CURS).map(c=>`<button class="btn ${curId===c.id?'good':''}" data-curset="${c.id}">${c.sym} ${c.label}</button>`).join('')}
        </div></div>
      <div class="hint">Сейчас: <b>${CURS[curId].sym} ${CURS[curId].label}</b> — ${CURS[curId].note}. Курс ${curId==='rub'?'1 € = 100 ₽':'базовый'}, цены магазина и отчёты пересчитываются целиком.</div>
    </div>
    <div class="card" id="glossCard">
      <div class="h" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Словарь терминов</b><button class="btn" id="btnManual" style="padding:2px 8px">Справочник</button></div>
      <div class="hint" style="margin-bottom:6px">Всё, что встречается в интерфейсе, — простыми словами.</div>
      ${[
        ['EC','Насколько «солёная» вода с удобрениями. 2.4 мСм/см для томата — норма. Мало — растение голодает, много — корни обжигаются и перестают пить.'],
        ['pH','Кислотность раствора от 0 до 14. 5.5–6.0 — удобрения усваиваются лучше всего; вне этого коридора часть питания просто выпадает в осадок.'],
        ['ppm','Частей на миллион. 800 ppm CO₂ ≈ 0.08 % воздуха — это примерно вдвое больше, чем на улице.'],
        ['Досветка / ДНАТ / LED','Лампа для растений. ДНАТ — газоразрядная, греется и жрёт много; LED-лента — дешёвая и слабая, годится для рассады и досветки утром.'],
        ['µmol/м²·с (PPFD)','Сила света для растения — сколько фотонов падает на квадратный метр в секунду. 200 — пасмурный день, 1000 — яркое солнце.'],
        ['LAI','Сколько листвы над квадратным метром грядки. LAI 3 = три слоя листьев друг над другом; выше — нижние листья в тени и работают в минус.'],
        ['Фаркуар','Модель фотосинтеза: считает, сколько сахара лист сделает из света и CO₂ и что его ограничивает — свет, газ или температура.'],
        ['Воксельный свет','Сцена делится на кубики 25 см, в каждом считается свет. Так видно, что нижний ярус полога недополучает свет.'],
        ['Граф органов','Растение как набор узлов: стебель, листья, кисти, плоды. Каждый орган стареет и вносит свой вклад в рост.'],
        ['Дрейф датчиков','Показания медленно уплывают: датчик «врёт» на 1–2 °C. Калибровка возвращает его в норму, второй комплект — ловит расхождение.'],
        ['Прогноз','Расчёт вперёд на копии мира с текущими настройками. Это оценка, а не гарантия: погода внутри другая.'],
        ['Лежкость','Сколько дней урожай может лежать на складе, прежде чем начнёт портиться и дешеветь.']
      ].map(([t,d])=>`<details style="border-top:1px solid var(--line2);padding:6px 0"><summary style="cursor:pointer"><b>${t}</b></summary><div class="hint" style="margin-top:4px">${d}</div></details>`).join('')}
    </div>
    <div class="card">
      <div class="h"><b>Обучение</b></div>
      <div class="hint" style="margin-bottom:8px">Всё это можно пройти заново в любой момент — прогресс сезона не пострадает.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn good" id="btnObAgain">Обучение по шагам</button>
        <button class="btn" id="btnTutorAgain">Подсказки на сцене</button>
        <button class="btn" id="btnManual2">Справочник</button>
      </div>
      <div class="hint" style="margin-top:6px">Словарь терминов — ниже в карточке «Словарь»: EC, pH, ppm, LAI, Фаркуар и остальное простыми словами.</div>
    </div>
    <div class="card">
      <div class="h"><b>Сезон</b></div>
      <div class="kv"><span>Профиль</span><b>${P.name} · ${P.area} м²</b></div>
      <div class="kv"><span>Культура</span><b>${ic(C)} ${C.name}</b></div>
      <div class="kv"><span>Погода</span><b>${world.weather==='cloudy'?'пасмурная':world.weather==='hot'?'жаркая':'обычная'}</b></div>
      <div class="kv"><span>Дата</span><b>Д${world.day} · ${fmtDate(world.doy)} 2026</b></div>
      <div class="kv"><span>seed</span><b>${world.seed}</b></div>
      <div class="hint" style="margin-top:6px">Одинаковый seed + одинаковые действия = одинаковый сезон (детерминированный PRNG).</div>
      <div class="hint" style="margin-top:8px;border-top:1px solid var(--line2);padding-top:8px">
        <b>Сохранение</b><br>${store.kind}<br>
        ${lastSaveTs ? 'последнее: '+new Date(lastSaveTs).toLocaleTimeString('ru-RU') : 'ещё не сохраняли'}<br>
        <b>Надёжная копия</b>: IndexedDB ${idbState}${idbState==='работает' ? ' — переживёт очистку данных сайта' : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn good" id="btnSaveNow">Сохранить</button>
        <button class="btn" id="btnSaveFile">Скачать файл</button>
        <button class="btn" id="btnLoadFile">Загрузить файл</button>
        <button class="btn warn" id="btnDropSave">Удалить</button>
      </div>
      <input type="file" id="saveInput" accept=".json,application/json" style="display:none">
      <div style="margin-top:8px"><button class="btn warn" id="btnRestart">Начать заново</button></div>
    </div>
    <div class="card" id="dliCard">
      <div class="h"><b>Свет за сутки (DLI)</b></div>
      ${(()=>{ const D = dliInfo(world);
        const cls = D.val < D.min ? 'var(--warn)' : (D.val > D.max ? 'var(--bad)' : 'var(--acc)');
        return `<div class="kv"><span>набрано сегодня</span><b style="color:${cls}">${nf(D.val,1)} из ${D.tgt} моль/м²</b></div>
        <div class="kv"><span>вчера за день</span><b>${nf(D.yest,1)} моль/м² · ${D.verdict}</b></div>
        <div class="g" style="grid-template-columns:1fr 96px"><span>${D.verdict}</span>
          <div class="bar"><i class="${D.ref<D.min?'cold':''}" style="width:${clamp(D.val/Math.max(1,D.tgt),0,1)*100}%"></i></div></div>
        <div class="kv"><span>световой день</span><b>${nf(D.day,1)} ч</b></div>
        <div class="kv"><span>лампа сегодня</span><b>${nf(D.lampHours,1)} ч · ${nf(D.lampDLI,1)} моль</b></div>
        <div class="kv"><span>фотопериод</span><b>${nf(D.photo,1)} ч <span style="color:var(--dim)">из ${D.photoMin}–${D.photoMax}</span>
          <span style="color:${D.photoVerdict==='в норме'?'var(--acc)':'var(--warn)'}">${D.photoVerdict}</span></b></div>
        <div class="hint" style="margin-top:6px">DLI — это весь свет за сутки, а не мгновенный PAR: у ${C.name.toLowerCase()}
        норма ${D.min}–${D.max} моль/м², цель ${D.tgt}. Один час досветки даёт около ${nf(D.perHour,2)} моль/м²: ${
          D.need <= 0.2 ? 'цель взята, лампа не нужна.'
          : D.reachable ? 'до цели ещё '+Math.round(D.hours)+' ч лампы.'
          : 'за 14 ч лампа даст только +'+nf(D.gain14,1)+' моль — зимой этого мало: спасают светлая сторона, плёнка на рамы и скороспелые сорта.'}</div>`; })()}
    </div>
    <div class="card" id="weatherCard">
      <div class="h"><b>Погода за окном</b></div>
      ${(()=>{ const rw = world.realWeather;
        if (!rw) return `<div class="d" style="color:var(--txt)">Считаем по нормам</div>
          <div class="hint">Многолетние средние по выбранной точке (1991–2020): так игра работает без сети.</div>`;
        if (rw.error) return `<div class="d" style="color:var(--txt)">Сеть недоступна</div>
          <div class="hint">${rw.error}. Считаем по нормам — на сезон это не влияет.</div>`;
        const t = realWeatherAt(world, world.doy);
        return `<div class="kv"><span>источник</span><b>${rw.source} · ${rw.n||0} дн.</b></div>
        <div class="kv"><span>сегодня по факту</span><b>${t?((t.t>0?'+':'')+nf(t.t,1)+' °C'):'—'}</b></div>
        <div class="kv"><span>облачность</span><b>${t?Math.round(t.cloud*100)+' %':'—'}</b></div>
        <div class="hint">Архив за последний год по дням года: температура и облачность вместо средних норм.
        Прогноз погодных событий (холодный фронт, оттепель) работает как раньше.</div>`; })()}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn" id="btnWeatherRefresh">Обновить из сети</button>
        <button class="btn" id="btnWeatherNorms">Вернуться к нормам</button>
      </div>
    </div>
    <div class="card">
      <div class="h"><b>Клавиши</b></div>
      ${[['пробел','пауза (время идёт как в жизни)'],['1 … 5','камеры: план, фронт, грядка, растение, свободная'],
         ['H / B / W','собрать урожай / обрезать низ / полить'],['D / S','досветка / затенение'],
         ['← → ↑ ↓','сдвинуть камеру'],['+ / −','ближе / дальше'],['R','вернуть ракурс'],
         ['L','слой света'],['G / M / P','теплица / магазин / параметры'],['F','прогноз'],['Esc','закрыть окно'],
         ['Ctrl+S','сохранить']]
        .map(([k,d])=>`<div class="kv"><span>${d}</span><b>${k}</b></div>`).join('')}
      <div class="hint" style="margin-top:6px">Клавиши не срабатывают, когда курсор в поле ввода.</div>
    </div>
    <div class="card" id="pwaCard">
      <div class="h"><b>Приложение</b></div>
      <div class="kv"><span>режим</span><b id="pwaState">проверяю…</b></div>
      <div class="hint" style="margin-bottom:8px">Игра ставится на телефон и запускается без сети: манифест и
      сервис-воркер лежат рядом с index.html. Сохранение — в самом браузере.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn good" id="btnInstall" style="display:none">Установить на устройство</button>
        <button class="btn" id="btnPwaHelp">Как установить</button>
      </div>
    </div>
    <div class="card">
      <div class="h"><b>Модель (справка)</b></div>
      <div class="hint">
        Граф органов в сцене: ${world.plants.reduce((s,p)=>s+p.organs.length,0)} узлов.<br>
        Свет: воксельная LAD 0.25 м, 5 лучей на лист.<br>
        Фотосинтез: Farquhar-lite, V<sub>cmax</sub> ${C.vcmax} µмоль/м²·с, оптимум ${C.tempOpt} °C.<br>
        Климат: баланс с подшагами 5 мин, UA ${num(world.env.UA)} Вт/К.<br>
        Экономика: ${num(world.plantScale)} растений на ${P.area} м², цена ${money2(C.price)}/кг ×${P.priceF}.
      </div>
    </div>
  </div>`;

  const bind = (id, key, fmt) => {
    const s = $('s_'+id);
    if (!s) return;                 // регулятора может не быть (например CO₂ без клапана)
    s.oninput = () => {
      const v = parseFloat(s.value);
      world.ctrl[key] = v;
      $('v_'+id).textContent = fmt(v);
    };
  };
  bind('heat','heatSet', v=>nf(v,1)+' °C');
  bind('vent','ventSet', v=>nf(v,1)+' °C');
  bind('co2','co2Set', v=>v+' ppm');
  bind('ec','ecSet', v=>nf(v,1));
  bind('ph','phSet', v=>nf(v,1));
  const bs = $('btnSndSet');
  if (bs) bs.onclick = ()=>{ toggleSound(); };
  const ba = $('btnAmbSet');
  if (ba) ba.onclick = ()=>{ SFX.setAmb(!SFX.amb); renderSettings(); toast(SFX.amb ? 'Фон теплицы включён' : 'Фон теплицы выключен'); };
  const vs = $('sndVol');
  if (vs) vs.oninput = ()=>{ SFX.arm(); SFX.setVol(vs.value/100); const d = vs.parentNode.querySelector('.d'); if (d) d.textContent = SFX.on ? 'включён · громкость '+Math.round(SFX.vol*100)+'%' : 'выключен'; };

  $('btnLampSet').onclick = ()=>{
    const r = toggleLamp(world);
    toast(r.msg);
    if (r.ok){ syncLightButtons(); renderSettings(); renderTop(); renderAlerts(); }
  };
  if ($('btnAlarmSet')) $('btnAlarmSet').onclick = ()=>{
    world.ctrl.alarmOn = !world.ctrl.alarmOn;
    toast(world.ctrl.alarmOn ? 'Будильник досветки включён' : 'Будильник досветки выключен');
    renderSettings();
  };
  bind('afrom','alarmFrom', v=>String(v).padStart(2,'0')+':00');
  bind('ato','alarmTo', v=>(v>=24?'24:00':String(v).padStart(2,'0')+':00'));
  document.querySelectorAll('[data-sysset]').forEach(b=>b.onclick = ()=>{
    const r = setGrowSys(world, b.dataset.sysset);
    toast(r.msg); renderSettings(); renderAll(); saveNow(false);
  });
  $('btnScreenSet').onclick = ()=>{ if (!world.has.screen) return toast('Сначала купите термоэкран'); world.ctrl.screenOn = !world.ctrl.screenOn; renderSettings(); };
  $('btnShadeSet').onclick = ()=>{ if (!world.has.shade) return toast('Сначала купите сетку'); world.ctrl.shadeOn = !world.ctrl.shadeOn; renderSettings(); };
  $('recipeSel').onchange = e => { world.ctrl.recipe = e.target.value; };
  // рецепт под стадию: одна кнопка ставит EC и pH в середину коридора фазы
  if ($('btnRecipeApply')) $('btnRecipeApply').onclick = ()=>{
    const R = stageRecipe(world);
    world.ctrl.ecSet = Math.round((R.ec[0]+R.ec[1])/2*10)/10;
    world.ctrl.phSet = Math.round((R.ph[0]+R.ph[1])/2*10)/10;
    world.ctrl.recipe = R.stage.key==='fruit' ? 'fruit' : 'std';
    toast(`Рецепт «${R.name}»: EC ${world.ctrl.ecSet} · pH ${world.ctrl.phSet}`);
    renderSettings(); renderAll(); saveNow(true);
  };
  if ($('btnWeatherRefresh')) $('btnWeatherRefresh').onclick = ()=>{
    toast('Запрашиваю архив погоды…'); refreshRealWeather(true);
  };
  if ($('btnWeatherNorms')) $('btnWeatherNorms').onclick = ()=>{
    world.realWeather = null;
    toast('Погода снова по многолетним нормам');
    renderSettings(); renderAll(); saveNow(true);
  };
  if ($('btnInstall')) $('btnInstall').onclick = ()=>{
    if (!deferredInstall) return toast('Браузер не предложил установку: откройте меню и выберите «Установить приложение»');
    deferredInstall.prompt();
    deferredInstall = null;
    const b = $('btnInstall'); if (b) b.style.display = 'none';
  };
  if ($('btnPwaHelp')) $('btnPwaHelp').onclick = ()=>{
    toast('Android/Chrome: меню ⋮ → «Установить приложение». iPhone/Safari: «Поделиться» → «На экран «Домой»».');
  };
  updatePwaState();
  document.querySelectorAll('[data-auto]').forEach(b=>b.onclick=()=>{
    const id = b.dataset.auto, cur = !!(world.auto[id] && world.auto[id].on);
    const r = setAuto(world, id, !cur);
    toast(r.msg);
    renderSettings(); renderAll(); saveNow(true);
  });
  document.querySelectorAll('[data-autonum]').forEach(inp=>{
    inp.onchange = ()=>{
      const [id, field] = inp.dataset.autonum.split('.');
      setAutoTime(world, id, field, inp.value);
      renderSettings(); renderAll(); saveNow(true);
    };
  });
  $('btnCamInv').onclick = ()=>{
    setCamInvertY(!camInvertY);
    toast(camInvertY ? 'Наклон мышью: инверсия (тянете вверх — смотрите ниже)' : 'Наклон мышью: обычно');
    renderSettings();
  };
  $('btnCamReset').onclick = ()=>{ resetCam(); toast('Ракурс сброшен'); };
  document.querySelectorAll('[data-curset]').forEach(b=>b.onclick = ()=>setCurrency(b.dataset.curset));
  if ($('btnManual')) $('btnManual').onclick = ()=>$('manual').classList.add('on');
  if ($('btnManual2')) $('btnManual2').onclick = ()=>$('manual').classList.add('on');
  if ($('btnObAgain')) $('btnObAgain').onclick = ()=>showOnboarding(0);
  if ($('btnTutorAgain')) $('btnTutorAgain').onclick = ()=>showTutorAgain();
  moneyLabels();
  $('btnRestart').onclick = ()=>{ renderResumeBox(); $('start').classList.add('on'); setPage('greenhouse'); };
  $('btnSaveNow').onclick = ()=>{ saveNow(false); renderSettings(); };
  $('btnSaveFile').onclick = downloadSave;
  $('btnLoadFile').onclick = ()=>$('saveInput').click();
  $('btnDropSave').onclick = ()=>{ clearSave(); renderSettings(); };
  $('saveInput').onchange = (e)=>{
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ()=>loadFromText(String(r.result));
    r.readAsText(f);
  };
}

/* ---------------- прогноз ---------------- */
function startPred(days){
  if (!world) return;
  tutorFlags.pred = true;
  fc = { ...startForecast(world, days), finished:false };
  fc.sim.dailyHarvest = true;                 // прогноз исходит из того, что урожай собирают
  $('predBody').innerHTML =
    `<div class="hint" style="margin-bottom:6px">Считаю ${days} дн.: <b id="predPct">0%</b></div>
     <div class="g"><span></span><div class="bar"><i id="predBar" style="width:0%"></i></div><b></b></div>`;
}
function stepPred(){
  if (!fc || fc.finished) return;
  const t0 = performance.now();
  while (fc.done < fc.days && performance.now()-t0 < 16) stepForecast(fc, 2);
  const pct = Math.round(fc.done/fc.days*100);
  const el = $('predPct'), bar = $('predBar');
  if (el) el.textContent = pct+'%';
  if (bar) bar.style.width = pct+'%';
  if (fc.done >= fc.days){ fc.finished = true; renderPred(); }
}
function renderPred(){
  const s = forecastSummary(fc);
  if (!s){ $('predBody').textContent = 'Не удалось построить прогноз'; return; }
  const w = world;
  const rev = fc.results.reduce((a,b)=>a+b.profit,0);
  const bars = fc.results.map(r=>{
    const hp = Math.max(2, Math.abs(r.profit)/Math.max(60, ...fc.results.map(x=>Math.abs(x.profit)))*40);
    return `<i style="height:${hp}px;background:${r.profit>=0?'#7ad8a0':'#ff7b72'}"></i>`;
  }).join('');
  const rows = fc.results.map(r=>`<tr>
      <td>D${r.day}</td><td>${fmtDate(r.doy)}</td>
      <td>${nf(r.temp,0)}/${nf(r.tempMin,0)}</td>
      <td>${nf(r.rh,0)}%</td>
      <td>${num(r.harvest)} кг</td>
      <td style="color:${r.profit>=0?'var(--acc)':'var(--bad)'}">${money(r.profit)}</td></tr>`).join('');
  const evs = w.has.weatherSrv
    ? w.events.filter(e=>e.inFuture && e.label).map(e=>`<div class="alert warn">${e.label} через ${Math.max(1,Math.round(e.inDays))} дн.</div>`).join('')
    : `<div class="hint">Метеосервис не куплен: погодные события в прогнозе не показываются.</div>`;
  $('predBody').innerHTML = `
    <div class="kv"><span>Урожай за ${s.days} дн.</span><b>${num(s.kg)} кг</b></div>
    <div class="kv"><span>Прибыль за период</span><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit)}</b></div>
    <div class="kv"><span>Макс. влажность</span><b>${nf(s.rhMax,0)}%</b></div>
    <div class="kv"><span>Макс. температура</span><b>${nf(s.tMax,0)} °C</b></div>
    <div class="spark">${bars}</div>
    ${s.warnings.map(x=>`<div class="alert warn">${x}</div>`).join('')}
    ${evs}
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-top:8px">
      <tr style="color:var(--dim)"><th align="left">день</th><th align="left">дата</th><th align="left">T°</th><th align="left">RH</th><th align="left">сбор</th><th align="left">приб.</th></tr>
      ${rows}
    </table>
    <div class="hint" style="margin-top:6px">Оценка: копия вашего мира с текущими настройками, независимой погодой и ежедневным сбором. Это оценка, а не гарантия.</div>`;
}

/* ---------------- обучение: 5 шагов на первые дни ---------------- */
let tutorStep = 0, tutorDone = false;
const tutorFlags = { cam:false, pred:false };
function resetTutorFlags(){ for (const k in tutorFlags) tutorFlags[k] = false; }

const TUTOR = [
  { text:'Покрутите сцену: зажмите мышь и ведите по ней. Клавиши 1–5 — пять камер: сверху, фронт, грядка, растение, свободная.',
    done:()=>tutorFlags.cam },
  { text:'Соберите спелый урожай: кнопка «Собрать урожай» внизу или клик по красному плоду на кусте.',
    done:()=>world.harvested >= 1 },
  { text:'Урожай лёг на склад — деньги за него ещё не пришли. В панели «Склад» нажмите «Продать всё»: цена дня меняется, а лёжкость ограничена.',
    done:()=>(world.soldKg||0) > 0.5 },
  { text:'Откройте «Параметры» и поднимите целевой CO₂ до 800 ppm — при хорошем свете это даёт до +15% фотосинтеза.',
    done:()=>world.ctrl.co2Set >= 800 },
  { text:'Влага в горшке падает от испарения. Когда датчик покажет меньше 40 %, нажмите «Полить» под сценой или щёлкните по горшку: одна доза — 15 %. Держите 45–60 %.',
    done:()=>(world.wateredTotalL||0) > 0 },
  { text:'В «Магазине» есть дешёвый старт: термометр-гигрометр ${money(28)}, клейкие ловушки ${money(45)}, бочка воды ${money(90)} — купите одну вещь.',
    done:()=>world.has.alarm||world.has.sticky||world.has.circFan||world.has.handDose||
            world.has.humid||world.has.ups||world.has.film||world.has.climatePC||world.has.ledStrip },
  { text:'Нажмите «Прогноз» сверху и постройте прогноз на 7 дней — так проверяют решение до трат.',
    done:()=>tutorFlags.pred }
];

/* свернуть подсказку: она больше не висит над сценой, если игрок уже прочитал */
let tutorFoldT = 0, tutorFoldStep = -1;
function tutorFold(min){
  const box = $('tutor'); if (!box) return;
  box.classList.toggle('min', !!min);
  const b = $('tutorFold'); if (b) b.textContent = min ? 'развернуть' : 'свернуть';
}
function renderTutor(){
  const box = $('tutor');
  if (!box) return;
  if (tutorDone || !world || page !== 'greenhouse' || tutorStep >= TUTOR.length){ box.classList.remove('on'); return; }
  $('tutorStep').textContent = `Шаг ${tutorStep+1} из ${TUTOR.length}`;
  // новый шаг — снова разворачиваем и через 9 секунд сворачиваем сами
  if (tutorFoldStep !== tutorStep){
    tutorFoldStep = tutorStep; tutorFold(false);
    clearTimeout(tutorFoldT);
    tutorFoldT = setTimeout(()=>{ if ($('tutor') && $('tutor').classList.contains('on')) tutorFold(true); }, 9000);
  }
  $('tutorText').textContent = TUTOR[tutorStep].text;
  $('tutorDots').innerHTML = TUTOR.map((_,i)=>
    `<i class="${i<tutorStep?'done':i===tutorStep?'on':''}"></i>`).join('');
  box.classList.add('on');
}
function tutorTick(){
  if (!world || tutorDone) return;
  // подсказки актуальны первые дни; дальше не мешаем
  if (world.day > 5 && tutorStep < TUTOR.length){
    tutorDone = true; $('tutor').classList.remove('on'); return;
  }
  while (tutorStep < TUTOR.length && TUTOR[tutorStep].done()) tutorStep++;
  if (tutorStep >= TUTOR.length){
    tutorDone = true;
    $('tutor').classList.remove('on');
    toast('Обучение пройдено — дальше только ваши решения');
    return;
  }
  renderTutor();
}
$('tutorSkip').onclick = ()=>{ tutorDone = true; $('tutor').classList.remove('on'); toast('Обучение пропущено'); };
$('tutorFold').onclick = ()=>{
  const box = $('tutor');
  tutorFold(!box.classList.contains('min'));
  clearTimeout(tutorFoldT);          // ручной выбор игрока автоматика не перебивает
};

/* ---------------- карточка органа под курсором ---------------- */
let hoverStamp = 0, hoverKey = '';
function hoverMove(cx, cy){
  const now = performance.now();
  if (now - hoverStamp < 60) return;
  hoverStamp = now;
  const card = $('hoverCard');
  if (!world || page !== 'greenhouse' || dragging){ card.style.display = 'none'; return; }
  const hit = hitTest(cx, cy);
  const info = hit ? organInfo(hit) : null;
  if (!info){ card.style.display = 'none'; hoverKey = ''; return; }
  const key = info.title + '|' + info.rows.map(r=>r[1]).join(',');
  card.style.display = 'block';
  if (key !== hoverKey){
    hoverKey = key;
    card.innerHTML = `<b>${info.title}</b>` + info.rows.map(([k,v])=>
      `<div><span class="k">${k}:</span> ${v}</div>`).join('');
  }
  const pad = 14, w = 200, h = 20 + info.rows.length*15;
  card.style.left = Math.min(window.innerWidth - w - 8, cx + pad) + 'px';
  card.style.top  = Math.min(window.innerHeight - h - 8, cy + pad) + 'px';
}
canvas.addEventListener('mousemove', e=>hoverMove(e.clientX, e.clientY));
canvas.addEventListener('mouseleave', ()=>{ const c=$('hoverCard'); if (c) c.style.display='none'; });

/* ---------------- слой освещённости ---------------- */
function toggleLayer(){
  dataLayer = !dataLayer;
  const b = $('btnLayer');
  if (b) b.classList.toggle('on', dataLayer);
  toast(dataLayer ? 'Слой света: цвет листа = сколько света он ловит' : 'Обычная раскраска кроны');
}
if ($('btnLayer')) $('btnLayer').onclick = toggleLayer;

/* ---------------- ввод: мышь, палец, стилус ---------------- */
/* Раньше здесь были mousedown/mousemove на window: палец на планшете не работал,
   а при переходе из «грядки»/«растения» в свободный вид камера прыгала на другой
   ракурс. Теперь единый Pointer Events, захват указателя и перенос текущего
   ракурса в свободный вид без скачка.                                     */
const ptrs = new Map();
let dragging=false, dragMoved=0, lastX=0, lastY=0, pinchD=0, panMode=false;

/* Инверсия наклона мышью: привычка. По умолчанию тянем вниз — смотрим ниже.
   Настройка живёт отдельно от сохранения мира (это про руки, а не про сезон). */
let camInvertY = false;
try { camInvertY = localStorage.getItem('vgCamInvert') === '1'; } catch(_){}
function setCamInvertY(v){
  camInvertY = !!v;
  try { localStorage.setItem('vgCamInvert', camInvertY ? '1' : '0'); } catch(_){}
}
function pitchSign(){ return camInvertY ? -1 : 1; }

canvas.style.touchAction = 'none';
canvas.addEventListener('contextmenu', e=>e.preventDefault());

function syncCamBar(){
  document.querySelectorAll('#camBar [data-view]').forEach(b=>b.classList.toggle('on', b.dataset.view===cam.mode));
}

/* перевести текущий вид в свободный, сохранив ракурс (никаких скачков) */
function toFreeKeepingView(){
  if (cam.mode === 'free') return;
  const pr = camPreset(cam.mode === 'plant' ? 'plant' : 'bed');
  if (cam.mode === 'plant' || cam.mode === 'bed'){
    cam.dist = pr.dist; cam.pitch = pr.pitch; cam.target = {...pr.target};
  } else {
    cam.dist = CAM_HOME.dist; cam.pitch = CAM_HOME.pitch; cam.target = {...CAM_HOME.target};
  }
  cam.zoom = 1; cam.mode = 'free'; syncCamBar();
}

function setCamMode(mode){
  tutorFlags.cam = true;
  camTween = null;
  if (mode === 'top' || mode === 'front'){ cam.mode = mode; syncCamBar(); return; }
  const pr = camPreset(mode);
  if (mode === 'free' && cam.mode === 'free') return;   // уже свободный — ничего не дёргаем
  cam.mode = mode;
  camTo({yaw:(cam.mode==='free'? pr.yaw : cam.yaw), pitch:pr.pitch, dist:pr.dist, zoom:pr.zoom,
         tx:pr.target.x, ty:pr.target.y, tz:pr.target.z});
  syncCamBar();
}

canvas.addEventListener('pointerdown', e=>{
  if (page !== 'greenhouse') return;
  if (e.pointerType === 'mouse' && e.button > 2) return;
  try { canvas.setPointerCapture(e.pointerId); } catch(_){}
  // мышь главнее: сбрасываем «зависшие» пальцы, иначе камера уйдёт в режим щипка
  if (e.pointerType === 'mouse') { ptrs.clear(); dragMoved = 0; }
  ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY, type:e.pointerType});
  if (ptrs.size > 2){ const k = [...ptrs.keys()][0]; ptrs.delete(k); }
  if (ptrs.size === 1){
    dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
    panMode = (e.button === 2 || e.button === 1 || e.shiftKey || e.altKey);
    camTween = null; cam.vel = {yaw:0, pitch:0};
    canvas.classList.add('drag');
  } else if (ptrs.size === 2){
    const [a, b] = [...ptrs.values()];
    pinchD = Math.hypot(a.x-b.x, a.y-b.y); dragging = false;
  }
  e.preventDefault();
});

canvas.addEventListener('pointermove', e=>{
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (ptrs.size >= 2){                       // два пальца: щипок = зум, сдвиг = панорама
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x-b.x, a.y-b.y);
    if (pinchD > 0 && d > 0) cam.zoom = clamp(cam.zoom*(d/pinchD), 0.45, 3.2);
    pinchD = d;
    return;
  }
  if (!dragging || page !== 'greenhouse') return;
  const dx = e.clientX-lastX, dy = e.clientY-lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx)+Math.abs(dy);
  if (dragMoved > 8) tutorFlags.cam = true;
  if (!panMode) toFreeKeepingView();
  if (panMode){
    const k = 0.006*cam.dist/7.4;
    camPan(-dx*k, dy*k);
  } else {
    const kp = pitchSign();
    cam.yaw += dx*0.006;
    cam.pitch = clamp(cam.pitch + dy*0.004*kp, PITCH_MIN, PITCH_MAX);
    cam.vel = {yaw:dx*0.0018, pitch:dy*0.0012*kp};
  }
});

function endPointer(e){
  const wasDrag = dragging, moved = dragMoved;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinchD = 0;
  if (ptrs.size === 0){
    dragging = false; panMode = false;
    canvas.classList.remove('drag');
    if (wasDrag && moved < 6 && page === 'greenhouse' && e.type !== 'pointercancel')
      handleClick(e.clientX, e.clientY);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);

canvas.addEventListener('wheel', e=>{
  if (page !== 'greenhouse') return;
  e.preventDefault();
  camTween = null;
  cam.zoom = clamp(cam.zoom*(e.deltaY>0?0.92:1.08), 0.45, 3.2);
}, {passive:false});

canvas.addEventListener('dblclick', ()=>{ resetCam(); });

/* поворот и зум кнопками — работают при любом вводе (мышь, палец, стилус) */
function camNudge(dyaw, dpitch){
  camTween = null; cam.vel = {yaw:0, pitch:0};
  toFreeKeepingView();
  cam.yaw += dyaw;
  cam.pitch = clamp(cam.pitch + dpitch, PITCH_MIN, PITCH_MAX);
  tutorFlags.cam = true;
}
function camZoomBy(f){ camTween = null; cam.zoom = clamp(cam.zoom*f, 0.45, 3.2); }
function resetCam(){
  camTween = null; cam.vel = {yaw:0, pitch:0};
  cam.mode = 'free';
  camTo({yaw:CAM_HOME.yaw, pitch:CAM_HOME.pitch, dist:CAM_HOME.dist, zoom:CAM_HOME.zoom,
         tx:CAM_HOME.target.x, ty:CAM_HOME.target.y, tz:CAM_HOME.target.z});
  syncCamBar();
}
document.querySelectorAll('.camNav [data-cam]').forEach(b=>{
  const act = b.dataset.cam;
  b.onclick = ()=>{
    if (act==='left')  camNudge(-0.16, 0);
    else if (act==='right') camNudge(0.16, 0);
    else if (act==='up')    camNudge(0, -0.09);
    else if (act==='down')  camNudge(0, 0.09);
    else if (act==='in')    camZoomBy(1.15);
    else if (act==='out')   camZoomBy(1/1.15);
    else resetCam();
  };
});

function handleClick(cx, cy){
  const hit = hitTest(cx, cy);
  if (!hit) return;
  if (hit.kind==='pot'){
    const r = water(world);
    toast(r.msg);
    if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
    return;
  }
  if (hit.kind==='lamp'){
    const r = toggleLamp(world);
    toast(r.msg);
    if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
    return;
  }
  if (hit.kind==='fruit'){
    const rev = harvestFruit(world, hit.plant, hit.fruit);
    if (rev>0) toast('+'+money(rev)+' за плод');
    else if (hit.fruit.rot) toast('Плод с вершинной гнилью — списан');
    renderAll();
  } else if (hit.kind==='leaf'){
    pruneLeaf(world, hit.plant, hit.leaf);
    renderAll();
  } else if (hit.kind==='plant'){
    cam.plant = world.plants.indexOf(hit.plant);
    toast('Выбрано растение #'+(cam.plant+1));
  }
}

document.querySelectorAll('#camBar [data-view]').forEach(b=>b.onclick=()=>setCamMode(b.dataset.view));
/* Клавиши: камеры и сцена — как раньше, плюс быстрые действия и страницы.
   В полях ввода клавиши не перехватываются, иначе цифры в них не набрать. */
/* первое действие игрока: только после него браузер разрешает звук */
['pointerdown','touchstart','keydown'].forEach(ev=>
  window.addEventListener(ev, ()=>{ if (!SFX.state().armed) SFX.arm(); }, {passive:true}));

/* прогрев: клик по любой кнопке — это звук покупки/сбора, поэтому вешаем на действия */

window.addEventListener('keydown', e=>{
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
  const k = (e.key || '').toLowerCase();
  if ((e.ctrlKey||e.metaKey) && k==='s'){ e.preventDefault(); saveNow(false); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const map = {'1':'top','2':'front','3':'bed','4':'plant','5':'free'};
  if (map[e.key]){ setCamMode(map[e.key]); return; }
  if (e.key===' '){ e.preventDefault(); togglePause(); return; }
  if (e.key==='ArrowLeft'){ e.preventDefault(); camNudge(-0.12, 0); return; }
  if (e.key==='ArrowRight'){ e.preventDefault(); camNudge(0.12, 0); return; }
  if (e.key==='ArrowUp'){ e.preventDefault(); camNudge(0, -0.07); return; }
  if (e.key==='ArrowDown'){ e.preventDefault(); camNudge(0, 0.07); return; }
  if (e.key==='+' || e.key==='='){ camZoomBy(1.12); return; }
  if (e.key==='-' || e.key==='_'){ camZoomBy(1/1.12); return; }
  if (k==='r'){ resetCam(); return; }
  if (k==='l'){ toggleLayer(); return; }
  if (k==='z'){ toggleSound(); return; }
  if (k==='escape'){
    ['help','manual','pred','mailModal'].forEach(id=>{ const el=$(id); if (el) el.classList.remove('on'); });
    if (page!=='greenhouse') setPage('greenhouse');
    return;
  }
  // страницы
  if (k==='g'){ setPage('greenhouse'); return; }
  if (k==='m'){ setPage('shop'); return; }
  if (k==='p'){ setPage('settings'); return; }
  if (k==='f'){ const p=$('pred'); if (p) p.classList.toggle('on'); return; }
  if (!world || world.over) return;
  // быстрые действия теми же путями, что и кнопки под сценой
  if (k==='h'){ doHarvest(); return; }
  if (k==='b'){ const n=pruneLower(world,2); if (n) playSfx('harvest',{heavy:0.2}); toast(n?`Обрезано ${n} листьев`:'Нечего обрезать'); renderAll(); return; }
  if (k==='w'){ const r=water(world); if (r.ok) playSfx('water'); toast(r.msg); if (r.ok){ syncLightButtons(); renderAll(); saveNow(true); } return; }
  if (k==='d'){ const r=toggleLamp(world); if (r.ok) playSfx('lamp'); toast(r.msg); if (r.ok){ syncLightButtons(); renderAll(); saveNow(true); } return; }
  if (k==='s'){ if (!world.has.shade) return toast('Сначала купите затеняющую сетку'); world.ctrl.shadeOn=!world.ctrl.shadeOn; toast(world.ctrl.shadeOn?'Сетка опущена':'Сетка поднята'); syncLightButtons(); renderAll(); return; }
});

function togglePause(){
  paused = !paused;
  $('btnPause').textContent = paused ? 'пауза' : '⏸';
  $('btnPause').classList.toggle('on', paused);
  $('btnPause').title = paused ? 'Реальное время включено: час за час. Нажмите, чтобы вернуться к ускорению'
                               : 'Пауза: время замедлится до реального';
  if (paused) toast('Пауза: время идёт как в жизни — секунда за секунду');
}
$('btnPause').onclick = togglePause;
document.querySelectorAll('.spd').forEach(b=>b.onclick=()=>{
  speed = parseFloat(b.dataset.s);
  document.querySelectorAll('.spd').forEach(x=>x.classList.toggle('on', x===b));
  if (paused) togglePause();
});
$('btnPred').onclick = ()=>{ $('pred').classList.toggle('on'); };
$('predClose').onclick = ()=>$('pred').classList.remove('on');
document.querySelectorAll('[data-pred]').forEach(b=>b.onclick=()=>startPred(+b.dataset.pred));
$('btnSave').onclick = ()=>saveNow(false);
$('btnHelp').onclick = ()=>$('help').classList.add('on');
$('helpClose').onclick = ()=>{ clearInterval(window._obT); $('help').classList.remove('on'); };
// ---- онбординг: пошаговый мастер ----
let obI = 0;
function obPaint(){
  const slides = [...document.querySelectorAll('#help .obSlide')];
  slides.forEach((el,k)=>el.classList.toggle('on', k===obI));
  $('obStepNo').textContent = 'шаг '+(obI+1)+' из '+slides.length;
  $('obDots').innerHTML = slides.map((_,k)=>`<i class="${k===obI?'on':''}" data-ob="${k}"></i>`).join('');
  $('obPrev').style.visibility = obI===0 ? 'hidden' : 'visible';
  $('obNext').style.display = obI===slides.length-1 ? 'none' : '';
  $('helpClose').style.display = obI===slides.length-1 ? '' : 'none';
}
function showOnboarding(step){
  obI = step||0; obPaint(); $('help').classList.add('on');
}
function showTutorAgain(){
  tutorDone = false; tutorStep = 0; resetTutorFlags();
  if (typeof renderTutor === 'function') renderTutor(); tutorTick();
  setPage('greenhouse');
  toast('Подсказки снова включены — они пройдут заново');
}
$('obNext').onclick = ()=>{ if(obI < document.querySelectorAll('#help .obSlide').length-1){ obI++; obPaint(); } };
$('obPrev').onclick = ()=>{ if(obI>0){ obI--; obPaint(); } };
$('obDots').onclick = e=>{ const k=e.target.dataset && e.target.dataset.ob; if(k!=null){ obI=+k; obPaint(); } };
$('obGloss').onclick = ()=>{ $('help').classList.remove('on'); setPage('settings'); setTimeout(()=>{ const g=$('glossCard'); if(g) g.scrollIntoView({behavior:'smooth',block:'center'}); },60); };
obPaint();
$('manualClose').onclick = ()=>$('manual').classList.remove('on');
$('startBtn').onclick = startGame;

$('btnHarvest').onclick = ()=>doHarvest();
$('btnPrune').onclick = ()=>{
  const n = pruneLower(world, 2);
  if (n) playSfx('harvest', {heavy:0.2});
  toast(n? `Обрезано ${n} листьев` : 'Нечего обрезать');
  renderAll();
};
$('btnLampQuick').onclick = ()=>{
  const r = toggleLamp(world);
  if (r.ok) playSfx('lamp');
  toast(r.msg);
  if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
};
$('btnShadeQuick').onclick = ()=>{
  if (!world.has.shade) return toast('Сначала купите затеняющую сетку в магазине');
  world.ctrl.shadeOn = !world.ctrl.shadeOn;
  toast(world.ctrl.shadeOn?'Сетка опущена':'Сетка поднята');
  syncLightButtons(); renderAll(); if (page==='settings') renderSettings();
};
$('btnWaterQuick').onclick = ()=>{
  const r = water(world);
  if (r.ok) playSfx('water');
  toast(r.msg);
  if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
};
/* подсветка состояния на кнопках под сценой: включено — зелёная */
function syncLightButtons(){
  if (!world) return;
  const l = $('btnLampQuick');
  if (l){
    l.classList.toggle('good', !!world.ctrl.lampEnabled && hasLight(world));
    l.textContent = (!!world.ctrl.lampEnabled && hasLight(world)) ? 'Досветка: вкл' : 'Досветка';
    l.title = hasLight(world)
      ? (world.ctrl.lampEnabled ? lightName(world)+' горит — нажмите, чтобы выключить'
                                : lightName(world)+' выключена — нажмите, чтобы включить')
      : 'Лампы нет: покупается в магазине';
  }
  const s = $('btnShadeQuick');
  if (s) s.classList.toggle('good', !!world.ctrl.shadeOn);
  const wb = $('btnWaterQuick');
  if (wb){
    const m = Math.round(world.meas && world.meas.moist!==undefined ? world.meas.moist : world.moist || 0);
    const st = soilState(world);
    wb.textContent = 'Полить ' + m + '%';
    wb.classList.toggle('warn', st.key === 'dry' || st.key === 'wilt');
    wb.classList.toggle('good', st.key === 'ok');
    wb.title = st.key === 'ok'
      ? 'Влага в норме — поливать не обязательно'
      : (st.key === 'wet' ? 'Перелив: дайте субстрату подсохнуть, помогает проветривание'
                          : 'Субстрат сухой — полейте');
  }
}

/* ---------------- сборка панелей ---------------- */
function renderAll(){
  if (!world) return;
  if (world.alarmPing){ toast(world.alarmPing.text); world.alarmPing = null; }
  renderTop(); renderGauges(); renderFinance(); renderAlerts();
  renderDiagnosis(); renderGoals(); renderMissions(); renderStock(); renderTanks(); renderContracts(); renderMail(); renderNet(); renderLog();
  syncLightButtons();
  tutorTick();
}

/* ---------------- Реальная погода: архив open-meteo ----------------
   Берём последний год по точке старта и раскладываем по дням года:
   температура и облачность вместо средних норм. Нет сети — молча
   возвращаемся к нормам, потому что погода не должна ломать игру.      */
function owDate(d){ return d.toISOString().slice(0,10); }
async function fetchWeatherRows(site){
  const end = new Date(Date.now() - 6*86400e3);
  const start = new Date(end.getTime() - 364*86400e3);
  const url = 'https://archive-api.open-meteo.com/v1/archive?latitude='+site.lat.toFixed(2)+
    '&longitude='+site.lon.toFixed(2)+'&start_date='+owDate(start)+'&end_date='+owDate(end)+
    '&daily=temperature_2m_mean,cloud_cover_mean&timezone=auto';
  const r = await fetch(url, {cache:'no-store'});
  if (!r.ok) throw new Error('ответ '+r.status);
  const j = await r.json();
  const days = (j.daily && j.daily.time) || [];
  const rows = [];
  for (let i=0;i<days.length;i++){
    const d = new Date(days[i]+'T12:00:00');
    if (isNaN(d.getTime())) continue;
    const t = j.daily.temperature_2m_mean ? j.daily.temperature_2m_mean[i] : null;
    const cl = j.daily.cloud_cover_mean ? j.daily.cloud_cover_mean[i] : null;
    if (t === null || t === undefined) continue;
    rows.push({doy: doyFromDate(d.getMonth()+1, d.getDate()), t:+t, cloud: cl==null?null:cl/100});
  }
  return rows;
}
async function refreshRealWeather(showToast){
  const site = (world && world.site) || siteById(pending.site || 'ekb');
  try {
    const rows = await fetchWeatherRows(site);
    if (!rows.length) throw new Error('пустой ответ');
    if (!world) return rows;
    applyWeatherTable(world, rows, {source:'open-meteo'});
    if (showToast) toast('Погода за окном: '+rows.length+' дней из архива open-meteo');
    if (page==='settings') renderSettings();
    renderAll(); saveNow(true);
    return rows;
  } catch(e){
    if (world){
      world.realWeather = {error:'Не удалось получить архив ('+(e.message||'сеть')+')'};
      if (showToast) toast('Архив недоступен — считаем по нормам');
      if (page==='settings') renderSettings();
      renderAll();
    } else if (showToast) toast('Архив недоступен — считаем по нормам');
    return null;
  }
}

/* ---------------- PWA: установка и офлайн ----------------
   Манифест и сервис-воркер лежат рядом с index.html, поэтому игра
   ставится на телефон и открывается без сети. Если браузер не умеет —
   всё работает как раньше, без единой ошибки.                        */
let deferredInstall = null;
function updatePwaState(){
  const el = $('pwaState');
  if (!el) return;
  const nav = (typeof navigator !== 'undefined') ? navigator : {};
  const mm = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(display-mode: standalone)') : null;
  const standalone = (mm && mm.matches) || nav.standalone;
  const proto = (typeof location !== 'undefined' && location.protocol) || '';
  const swOK = !!(nav.serviceWorker && nav.serviceWorker.controller);
  el.textContent = standalone ? 'запущено как приложение'
                 : proto.indexOf('http')!==0 ? 'нужен адрес http (не файл)'
                 : swOK ? 'готово к установке' : 'кэш включается при первом запуске';
}
if (typeof window !== 'undefined' && window.addEventListener){
  window.addEventListener('beforeinstallprompt', e=>{
    e.preventDefault(); deferredInstall = e;
    const b = $('btnInstall'); if (b) b.style.display = '';
  });
  window.addEventListener('appinstalled', ()=>{ deferredInstall = null; toast('Приложение установлено'); updatePwaState(); });
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
      typeof location !== 'undefined' && location.protocol.indexOf('http')===0){
    navigator.serviceWorker.register('sw.js').then(()=>updatePwaState()).catch(()=>updatePwaState());
    navigator.serviceWorker.addEventListener('controllerchange', updatePwaState);
  }
}

/* ---------------- главный цикл ---------------- */
let frozen = false;                    // отладочный «стоп-кадр»: VG.freeze(true)
function frame(now){
  if (frozen){ lastT = now; requestAnimationFrame(frame); return; }
  const dtReal = Math.min(0.25, Math.max(0, (now-lastT)/1000));   // на слабом железе кадры редкие — не теряем время
  lastT = now;
  if (world){
    if (!world.over){
      // пауза не останавливает время: 1 реальная секунда = 1 игровая секунда
      // скорость задана как «игровых часов за реальную минуту»: 1× — час за минуту
      const rateH = paused ? 1/3600 : speed/60;
      acc += dtReal*rateH;
      // порог шага подстраивается под скорость: на 1× (час за минуту) шагаем мелко и часто,
      // иначе мир «дёргался» бы раз в несколько секунд
      const thr = paused ? 1/2400 : Math.max(1/2400, Math.min(1/12, rateH*0.25));
      let guard = 0;
      while (acc >= thr && guard++ < 40){
        const step = Math.min(acc, paused ? 1/60 : 0.5);
        stepWorld(world, step);
        acc -= step;
        if (world.over) break;
      }
      if (guard>=40) acc = 0;
    }
    // автосохранение: на смене дня или раз в 30 с, но не чаще раза в 4 с
    if (!world.over && (world.day !== lastSavedDay || now - lastSaveTs > 30000) && now - lastSaveTs > 4000){
      saveNow(true);
      if (world.day !== lastSavedDay) lastSavedDay = world.day;
    }
    if (fc && !fc.finished) stepPred();
    // новый счёт за свет и тепло: сказать вслух, иначе его никто не заметит
    if (world.util && Array.isArray(world.util.bills) && world.util.bills.length !== seenBills){
      const nb = world.util.bills[world.util.bills.length-1];
      seenBills = world.util.bills.length;
      if (nb && !nb.paid && nb.eur > 0){
        playSfx(nb.kind === 'судебные издержки' ? 'court' : 'bill');
        toast(`Счёт за свет и тепло: ${moneyS(nb.eur)} · «Экономика» → «Оплатить»`);
      }
    }
    if (now - uiT > 130){
      uiT = now;
      // фон теплицы: чем сильнее проветривание и обдув, тем слышнее вентилятор;
      // капель зависит от влажности субстрата, а не от календаря
      {
        const a = world.act || {};
        const fan = clamp((a.vent||0)*0.8 + (world.has.circFan?0.22:0) + (world.has.climatePC?0.08:0)
                          + (world.has.humid && world.rh < 70 ? 0.10 : 0), 0, 1);
        const drip = clamp(((world.moist||0) - 58)/34, 0, 1);
        SFX.ambient({fan, drip});
      }
      renderTop();                                  // часы и баланс идут на любой вкладке
      if (page==='greenhouse') renderAll();
      else if (page==='shop'){ const b=$('shopBalance'); if (b) b.innerHTML = shopTopLine(); }
      if (world.over && !endShown) showEnd();
    }
    camStep(dtReal);
    if (page==='greenhouse'){ ensureSize(); drawScene(); }
  }
  requestAnimationFrame(frame);
}

/* Следующий сезон: хозяйство (деньги, оборудование, склад, глава, репутация)
   переезжает, куст и история начинаются заново. */
function startNextSeason(salvage){
  if (!world) return;
  const prev = world;
  const carry = carrySnapshot(prev);
  // банкротство: счета и долг закрыты распродажей, на руках только остаток
  if (salvage !== undefined && salvage !== null){
    carry.money = Math.max(0, Math.round(salvage));
    carry.startMoney = Math.max(1, carry.money);
    carry.util = null;
    carry.prev = null;
  }
  const opts = { profile: prev.profile, crop: prev.crop, sys: prev.sys,
    seed: (prev.seed + 7919) >>> 0, difficulty: prev.diffId, campaign: !!prev.camp,
    site: (prev.site && prev.site.id) || 'ekb', orient: (prev.site && prev.site.orient) || 'S',
    startDoy: prev.doy, carry, weather: prev.weather };
  world = makeWorld(opts);
  if (prev.realWeather && prev.realWeather.t) world.realWeather = prev.realWeather;
  if (world.camp && carry.camp && carry.camp.ch > 0) moveChapter(world, carry.camp.ch, true);
  document.querySelectorAll('.modal.on').forEach(m=>{ if (m.id !== 'start') m.classList.remove('on'); });
  endShown = false; paused = false; speed = 64; acc = 0; lastT = performance.now(); fc = null;
  if (typeof FX !== 'undefined') FX.length = 0;
  seenBills = (world.util && world.util.bills) ? world.util.bills.length : 0;
  document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='64'));
  $('btnPause').classList.remove('on'); $('btnPause').textContent = '⏸';
  setPage('greenhouse'); renderAll(); saveNow(true);
  toast(`Сезон ${world.seasons}: хозяйство перенесено · репутация ${world.rep} · баланс ${money(world.money)}`);
}

function showBankrupt(w){
  const u = utilInit(w);
  const debt = utilDebt(w);
  const days = utilOverdueDays(w);
  const salvage = bankruptSalvage(w);
  const div = document.createElement('div');
  div.className = 'modal on';
  div.innerHTML = `<div class="sheet">
    <h1>Банкротство · ${PROFILES[w.profile].name}</h1>
    <div class="kv"><span>Сезон</span><b>${w.seasons||1} · день ${w.day}</b></div>
    <div class="kv"><span>Долг за свет и тепло</span><b class="neg">${money(debt)}</b></div>
    <div class="kv"><span>Просрочка</span><b>${days} дн · ${Math.floor(days/90)} кв. · судов ${u.courts}</b></div>
    <div class="kv"><span>Распродажа</span><b>склад и оборудование в счёт долга</b></div>
    <div class="kv"><span>Остаток на руки</span><b class="pos">${money(salvage)}</b></div>
    <div class="hint" style="margin-top:10px">Восемь кварталов счёт не оплачивался: суд признал хозяйство банкротом.
      Оборудование и склад ушли в зачёт, счета закрыты. Дальше — только новый сезон с тем, что осталось.</div>
    <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn good" id="btnSalvage">Новый сезон с остатком ${money(salvage)}</button>
      <button class="btn" onclick="location.reload()">Начать заново</button></p>
  </div>`;
  document.body.appendChild(div);
  playSfx('bankrupt');
  const b = div.querySelector('#btnSalvage');
  if (b) b.onclick = ()=>{ div.remove(); startNextSeason(salvage); };
}

function showEnd(){
  endShown = true;
  const w = world;
  if (w.util && w.util.bankrupt) return showBankrupt(w);
  const cost = Object.values(w.cost).reduce((s,x)=>s+x,0);
  const profit = w.money - w.startMoney;
  const kgm2 = w.harvestedKg/w.area;
  const kwhSum = w.energyTotal || w.energyKWh || 0;
  const kwhm2 = kwhSum/w.area;
  const verdict = profit > w.startMoney*0.4
    ? 'Отличный сезон: климат, свет и питание сработали вместе.'
    : profit > 0
      ? 'Сезон в плюсе, но маржа тонкая: ищите, где переплатили за энергию или CO₂.'
      : 'Убыток. Проверьте «Параметры»: холод останавливает рост, перегрев убивает завязи, сырость — урожай.';
  $('help').classList.remove('on');
  $('pred').classList.remove('on');
  const div = document.createElement('div');
  div.className = 'modal on';
  div.innerHTML = `<div class="sheet">
    <h1>Сезон закрыт · ${PROFILES[w.profile].name}</h1>
    <div class="kv"><span>Культура</span><b>${ic(CROPS[w.crop])} ${CROPS[w.crop].name}</b></div>
    <div class="kv"><span>Урожай</span><b>${num(w.harvestedKg)} кг · ${nf(kgm2,1)} кг/м²</b></div>
    <div class="kv"><span>Выручка</span><b>${money(w.revenue)}</b></div>
    <div class="kv"><span>Затраты всего</span><b>−${money(cost)}</b></div>
    <div class="kv"><span>Энергия за сезон</span><b>${num(Math.round(kwhSum))} кВт·ч · ${nf(kwhm2,0)} кВт·ч/м²</b></div>
    <div class="kv"><span>Инцидентов</span><b>${w.incidents||0}</b></div>
    <div class="kv"><span>Заданий выполнено</span><b>${w.missionsDone}</b></div>
    <div class="kv"><span>Себестоимость 1 кг</span><b>${costPerKg(w)==null?'—':money2(costPerKg(w))} · цена дня ${money2(priceToday(w,w.crop))}</b></div>
    <div class="kv"><span>Свет за сутки</span><b>${(()=>{ const hs=(w.history||[]).filter(h=>h.dli>0); return hs.length?'в среднем '+ nf(hs.reduce((a,b)=>a+b.dli,0)/hs.length,1)+' моль/м²':'—'; })()}</b></div>
    <div class="kv"><span>Репутация</span><b>${w.rep||0}${w.carry?' · перенесена':''}</b></div>
    ${(()=>{ const debt = utilDebt(w), od = utilOverdueDays(w);
      if (debt <= 0.005) return `<div class="kv"><span>Счёт за свет и тепло</span><b class="pos">оплачен</b></div>`;
      const q = Math.floor(od/90);
      return `<div class="kv"><span>Счёт за свет и тепло</span><b class="neg">${money(debt)}${od?` · просрочен ${od} дн (${q} кв.)`:''}</b></div>`;
    })()}
    <div class="kv"><span>Итог</span><b class="${profit>=0?'pos':'neg'}">${money(profit)}</b></div>
    <div class="hint" style="margin-top:10px">${verdict}</div>
    <div class="hint" style="margin-top:8px">Следующий сезон: деньги (и долг), оборудование, склад, глава кампании и репутация
      переезжают. Куст, история и рынок начинаются заново.${
        profit < 0 ? '<br><b style="color:var(--warn)">Баланс в минусе: он переедет как долг хозяйства. Если это не по силам — «Начать заново».</b>' : ''}</div>
    <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn good" id="btnNextSeason">Следующий сезон с хозяйством</button>
      <button class="btn" onclick="location.reload()">Начать заново</button></p>
  </div>`;
  document.body.appendChild(div);
  playSfx('end');
  const nb = div.querySelector('#btnNextSeason');
  if (nb) nb.onclick = ()=>{ div.remove(); startNextSeason(); };
}

window.addEventListener('pagehide', ()=>{ if (world && !world.over) saveNow(true); });
document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState === 'hidden' && world && !world.over) saveNow(true);
});

/* ---------------- запуск ---------------- */
resize();
buildStart();
renderResumeBox();
requestAnimationFrame(frame);
/* надёжная копия: если браузер вычистил localStorage, сейв поднимется из IndexedDB.
   Проверяем хранилище заранее — карточка «Сохранение» показывает статус. */
idbOpen();
restoreFromIdb().then(ok=>{ if (ok) toast('Сейв восстановлен из надёжного хранилища (IndexedDB)'); }).catch(()=>{});

/* Отладочный API (консоль браузера / автотесты): window.VG.* */
window.VG = {
  freeze(v){ frozen = !!v; },
  get world(){ return world; },
  start:(opts)=>{ Object.assign(pending, opts||{}); startGame(); return world; },
  page: setPage,
  sim:(hours)=>{ let h=hours||0; while(h>0){ stepWorld(world, Math.min(0.5,h)); h-=0.5; } return world; },
  harvest:()=>harvestAll(world),
  sell:(crop,kg)=>sellHarvest(world, crop||world.crop, kg==null?null:kg),
  wh:()=>({ used:Math.round(whUsedL(world)), cap:whCap(world), sections:world.wh.sections,
            kg:storeKg(world), lots:world.wh.lots.length, rent:whRentDay(world) }),
  market:()=>Object.fromEntries(Object.keys(CROPS).map(c=>[c, +priceToday(world,c).toFixed(2)])),
  mail:()=>world.mail, answer:(id,i)=>answerMail(world,id,i),
  prune:(n)=>pruneLower(world, n||2),
  buy:(id)=>buyItem(world, id),
  contract:(i)=>signContract(world, i),
  predict:(days)=>{ startPred(days||7); while(!fc.finished) stepPred(); return forecastSummary(fc); },
  render: renderAll,
  set:(k,v)=>{ world.ctrl[k]=v; },
  cam:(mode, opt)=>{ tutorFlags.cam = true; cam.mode = mode; if (opt) Object.assign(cam, opt);
    document.querySelectorAll('#camBar button').forEach(b=>b.classList.toggle('on', b.dataset.view===mode));
    drawScene(); return cam.mode; },
  zoom:(z)=>{ cam.zoom = z; drawScene(); },
  shop:()=>SHOP(),
  missions:()=>MISSIONS.map(m=>m.text)
};
