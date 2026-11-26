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
const pending = { profile:'farm', crop:'tomato', weather:'normal', difficulty:'normal', campaign:false, sys:'soil' };

let toastTimer = 0;
function toast(msg){
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('on'), 1700);
}

/* ---------------- сохранение сезона ----------------
   localStorage может быть недоступен (iframe без allow-same-origin, приватный режим),
   поэтому три уровня: localStorage → sessionStorage → память вкладки.
   Файл сохранения (.json) работает всегда и не зависит от ограничений браузера.   */
const SAVE_KEY = 'vg_save_v1', SAVE_META = 'vg_save_meta_v1';
let memSave = null, memMeta = null, lastSaveTs = 0, lastSavedDay = 0;

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

function peekSaveMeta(){
  try { const m = store.getM(); return m ? JSON.parse(m) : null; } catch(e){ return null; }
}
function saveNow(silent){
  if (!world) return false;
  try {
    store.set(serializeWorld(world));
    store.setM(JSON.stringify({ day:world.day, doy:world.doy, money:Math.round(world.money),
      crop:world.crop, profile:world.profile, diff:world.diffId, kg:Math.round(world.harvestedKg), ts:Date.now() }));
    lastSaveTs = Date.now(); lastSavedDay = world.day;
    if (!silent) toast('Сохранено: день '+world.day);
    return true;
  } catch(e){
    toast('Не удалось сохранить: '+e.message);
    return false;
  }
}
function clearSave(){
  store.del(); lastSavedDay = 0;
  toast('Сохранение удалено');
  if (page==='settings') renderSettings();
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
      <div class="d">${p.note}<br>Площадь ${p.area} м² · постоянные ${money(p.fixedDay)}/сут · цена ${p.priceF.toFixed(2)}×</div>
    </div>`).join('');
  // система выращивания
  const sysLock = S => pending.campaign && S.ch > 0;
  $('sysPick').innerHTML = Object.values(GROW_SYS).map(S=>{
    const locked = sysLock(S);
    return `<div class="card" data-sys="${S.id}" style="cursor:pointer;${locked?'opacity:.55;':''}${S.id===pending.sys?'border-color:var(--acc)':''}">
      <div class="h"><b>${S.name}</b>${locked?`<span class="lock">глава ${S.ch+1}</span>`:''}</div>
      <div class="d">${S.note}</div>
      <div class="hint">вода ×${S.waterF.toFixed(2)} · питание ×${S.fertF.toFixed(2)} · рост ×${S.yieldF.toFixed(2)} · риск гнили ×${S.rotF.toFixed(1)}</div>
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
    {id:'hot', n:'Жаркий', d:'+2.5 °C: перегрев, нужна вентиляция и затенение'}
  ];
  $('seedPick').innerHTML = ws.map(x=>`
    <div class="card" data-weather="${x.id}" style="cursor:pointer;${x.id===pending.weather?'border-color:var(--acc)':''}">
      <div class="h"><b>${x.n}</b></div><div class="d">${x.d}</div>
    </div>`).join('');
  $('diffPick').innerHTML = Object.values(DIFFICULTY).map(d=>`
    <div class="card" data-diff="${d.id}" style="cursor:pointer;${d.id===pending.difficulty?'border-color:var(--acc)':''}">
      <div class="h"><b>${d.name}</b></div>
      <div class="d">${d.note}<br>постоянные ×${d.fixedF.toFixed(2)} · аварии ×${d.failF.toFixed(1)} · цена ×${d.priceF.toFixed(2)}</div>
    </div>`).join('');
  document.querySelectorAll('[data-diff]').forEach(e=>e.onclick=()=>{ pending.difficulty=e.dataset.diff; buildStart(); });
  document.querySelectorAll('[data-profile]').forEach(e=>e.onclick=()=>{ pending.profile=e.dataset.profile; buildStart(); });
  document.querySelectorAll('[data-crop]').forEach(e=>e.onclick=()=>{ pending.crop=e.dataset.crop; buildStart(); });
  document.querySelectorAll('[data-weather]').forEach(e=>e.onclick=()=>{ pending.weather=e.dataset.weather; buildStart(); });
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
                      // в кампании на балконе — только грунт, остальное откроется с главой
                      sys:(pending.campaign && pending.sys && GROW_SYS[pending.sys] && GROW_SYS[pending.sys].ch>0)
                          ? 'soil' : pending.sys });
  tutorStep = 0; tutorDone = false; resetTutorFlags();
  cam.plant = 0; cam.mode = 'free'; paused = false; speed = 64;
  acc = 0; lastT = performance.now(); endShown = false; fc = null;
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
      +DIFFICULTY[world.diffId].name.toLowerCase()+' сложность');
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
  $('tProfile').textContent = P.name + ' · ' + P.area + ' м² · ' + (sysOf(world).short||'').toLowerCase() + ' · ' +
    (DIFFICULTY[world.diffId]?DIFFICULTY[world.diffId].name.toLowerCase():'обычная') +
    (world.weather==='cloudy'?' · пасмурно':world.weather==='hot'?' · жарко':'');
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
  return `<div class="g"><span>${label}</span><div class="bar"><i class="${cls||''}" style="width:${pct}%"></i></div>
    <b>${val.toFixed(digits===undefined?1:digits)}${unit}</b></div>`;
}
function renderGauges(){
  const m = world.meas, C = CROPS[world.crop];
  const tCls = m.temp>C.heatTol ? 'hot' : (m.temp<C.coldTol ? 'cold' : '');
  $('gauges').innerHTML =
    gauge('T', m.temp, 5, 38, '°C', tCls) +
    gauge('RH', m.rh, 30, 99, '%', m.rh>C.rhMax?'hot':'', 0) +
    gauge('CO₂', m.co2, 330, 1200, ' ppm', '', 0) +
    gauge('PAR', world.light.meanLeaf, 0, 600, '', '', 0) +
    gauge('болезнь', world.disease*100, 0, 100, '%', world.disease>0.4?'hot':'', 0);
  // подсказка о дрейфе датчиков
  const drift = Math.abs(world.drift.temp)+Math.abs(world.drift.rh)/10;
  const days = world.day - world.lastCalib;
  let hint = '';
  if (world.has.secondSensor){
    hint = `Расхождение датчиков: ΔT ${world.drift.temp>=0?'+':''}${world.drift.temp.toFixed(1)} K, `+
           `ΔRH ${world.drift.rh>=0?'+':''}${world.drift.rh.toFixed(1)}%`;
  } else if (world.has.alarm){
    const dT = world.meas.temp - world.temp, dR = world.meas.rh - world.rh;
    hint = `Контрольный прибор: ΔT ${dT>=0?'+':''}${dT.toFixed(1)} K, ΔRH ${dR>=0?'+':''}${dR.toFixed(1)}%`;
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
  $('finance').innerHTML = `
    <div class="finHead"><span>статья</span><span>сутки</span><span>сезон, ${moneySym()}</span></div>
    ${rows.map(r=>`<div class="finRow"><span>${r.label}</span>${cell(r.day)}${cell(r.season)}</div>`).join('')}
    <div class="finRow total"><span>Прибыль</span>${cell(profitDay)}${cell(profit)}</div>
    <div class="finRow total"><span>Деньги</span>${cell(moneyDay)}${cell(w.money)}</div>
    <div class="finRow"><span>от старта</span><span class="dim">—</span>${cell(w.money-w.startMoney)}</div>
    ${Math.abs(recon)>1 ? `<div class="finRow"><span>кредит и прочее</span><span class="dim">—</span>${cell(recon)}</div>`:''}
    ${w.money < -0.01 ? `<div class="finRow"><span>долг, ${(CFG.debtRate*100).toFixed(0)}%/сут</span><span class="dim">—</span><b class="neg">${moneyNum(-w.money)}</b></div>`:''}
    <div class="hint" style="margin-top:6px">${w.ctrl.lampEnabled
      ? `Досветка горит: ${(((w.light&&w.light.stripOn)?0.1:0)+(((w.light&&w.light.lampOn)?(w.env.lampKW||0):0))).toFixed(2)} кВт·ч в час.`
      : 'Досветка выключена — за свет не платите.'} «Сутки» — прошлые полные сутки, «сезон» — с начала.</div>
    <div class="spark">${h.slice(-40).map(x=>{
      const mx = Math.max(2, ...h.slice(-40).map(y=>Math.abs(y.profit||0)));
      const hp = Math.max(2, Math.abs(x.profit||0)/mx*34);
      return `<i style="height:${hp}px;background:${(x.profit||0)>=0?'#7ad8a0':'#ff7b72'}"></i>`;
    }).join('')}</div>`;
}

/* ---------------- баки и возможности ---------------- */
function renderTanks(){
  const box = $('tanks'); if (!box || !world) return;
  const w = world, S = w.stock;
  const daysHint = (what)=>{
    const d = tankDays(w, what);
    if (d===null || !isFinite(d) || d<=0) return '';
    return ' · хватит ' + (d>999 ? '>999' : '≈'+(d<10?d.toFixed(1):Math.round(d))) + ' дн';
  };
  const row = (label, val, what, cls)=>`<div class="kv"><span>${label}</span><b class="${cls||''}">${val}<span style="font-weight:400;color:var(--dim)">${daysHint(what)}</span></b></div>`;
  const tankRows = [
    row('Вода в баке', `${S.waterM3.toFixed(0)} м³`, 'water', Math.floor(S.waterM3)<1?'bad':''),
    row('Удобрения', `${S.fertKg.toFixed(S.fertKg<10?1:0)} кг`, 'fert', S.fertKg<5?'bad':''),
    ...(w.has.co2 ? [row('CO₂ в баллоне', `${S.co2Kg.toFixed(0)} кг`, 'co2', S.co2Kg<5?'bad':'')] : []),
    row('Семена', `${num(S.seeds)} шт`, null, S.seeds<5?'bad':''),
    row('Склад свободно', `${num(whFreeL(w)/WH.bulkHarvest)} кг`, null, '')
  ];
  const featList = [
    ['Свет: '+lightName(w), hasLight(w)],
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
  // климат по датчикам
  if (w.meas.temp > C.heatTol) out.push(['warn', `Перегрев ${w.meas.temp.toFixed(1)} °C — аборт завязей, откройте форточки или затенение`]);
  if (w.meas.temp < C.coldTol) out.push(['warn', `Холод ${w.meas.temp.toFixed(1)} °C — рост останавливается`]);
  if (w.meas.rh > C.rhMax) out.push(['warn', `Влажность ${w.meas.rh.toFixed(0)}% — риск серой гнили, нужна вентиляция`]);
  if (w.disease > 0.25) out.push(['bad', `Серая гниль ${(w.disease*100)|0}% — обработка в магазине`]);
  if (w.pest.active) out.push(['bad', `Паутинный клещ: уровень ${(w.pest.level*100)|0}% — обработка`]);
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
  if (w.stock.waterM3 < 3) out.push(['bad','Нет воды — растения в стрессе']);
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
  $('alerts').innerHTML = out.slice(0,6).map(([k,t])=>`<div class="alert ${k}">${t}</div>`).join('');
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
  const head = `<div class="kv"><span>усвоено за сутки</span><b>${world.day>1?d.assimDay.toFixed(1)+' г/м²':'— (первый день)'}</b></div>`;
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
      <b style="${left<=1?'color:var(--bad)':(left<=3?'color:var(--warn)':'')}">${num(l.kg)} кг · ещё ${left} дн · ${q}% · −${(100/l.shelf).toFixed(0)}%/сут</b></div>`;
  }).join('');
  const freeKg = whFreeL(world)/WH.bulkHarvest;
  $('stock').innerHTML = `
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
    <div class="hint" style="margin-top:6px">${wh.sections} секц. · содержание ${money2(whRentDay(world))}/сут ·
      свободно ${num(freeKg)} кг</div>
    <div class="hint">Лёжкость ${CROPS[world.crop].name.split(' ')[0].toLowerCase()}: ${CROPS[world.crop].shelfDays} дн →
      теряется <b>${(100/CROPS[world.crop].shelfDays).toFixed(0)} % массы</b> и <b>${(0.55/1.4*100/CROPS[world.crop].shelfDays).toFixed(0)} % цены</b> в сутки;
      после ${CROPS[world.crop].shelfDays*2} дн партия списывается целиком.</div>
    ${wh.wasteKg>1 ? `<div class="hint" style="color:var(--warn)">испорчено за сезон: ${num(wh.wasteKg)} кг (${money(wh.wasteEur)})</div>`:''}
    <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
      <button class="btn good" id="btnSellAll" ${storeKg(world)>0.5?'':'disabled'}>Продать всё · ${money2(priceToday(world))}/кг</button>
      <button class="btn" id="btnWhExpand" title="Вторая секция: +600 л места, но и содержание">+секция ${money(whSectionCost(world))}</button>
    </div>`;
  const sell = $('btnSellAll');
  if (sell) sell.onclick = ()=>{
    const r = sellHarvest(world, world.crop, null);
    toast(r.ok ? `Продано ${num(r.kg)} кг за ${money(r.eur)}` : 'На складе нет продукции');
    renderAll(); if (page==='shop') renderShop();
  };
  const ex = $('btnWhExpand');
  if (ex) ex.onclick = ()=>{
    const r = addSection(world);
    toast(r.ok ? `Склад: ${world.wh.sections} секций (${money(-r.cost)}). Содержание ${money2(whRentDay(world))}/сут`
               : r.msg);
    renderAll(); if (page==='shop') renderShop();
  };
}
function renderContracts(){
  const act = world.contracts.filter(c=>!c.done);
  if (!act.length){ $('contracts').innerHTML = `<div class="hint">Нет активных. Предложения — в магазине.</div>`; return; }
  $('contracts').innerHTML = act.map(c=>{
    const pct = clamp(1-c.leftKg/c.kg,0,1)*100;
    const canDeliver = storeKg(world, c.crop) > 1;
    return `<div style="margin-bottom:7px">
      <div class="kv"><span>${c.label} ×${c.priceMult}</span><b>${num(c.delivered)}/${num(c.kg)} кг</b></div>
      <div class="g"><span>до D${c.deadline}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct|0}%</b></div>
      <button class="btn" data-deliver="${c.id}" style="margin-top:4px" ${canDeliver?'':'disabled'}>
        Поставить со склада</button>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-deliver]').forEach(b=>b.onclick=()=>{
    const r = deliverContract(world, b.dataset.deliver);
    toast(r.ok ? `Поставлено ${num(r.kg)} кг за ${money(r.eur)}${r.bonus?' · бонус '+money(r.bonus):''}` : r.msg);
    renderAll(); if (page==='shop') renderShop();
  });
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
  box.innerHTML = html;
  document.querySelectorAll('[data-mail]').forEach(b=>b.onclick=()=>openMail(b.dataset.mail));
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
  document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{
    answerMail(world, id, +b.dataset.answer);
    $('mailModal').classList.remove('on');
    renderAll(); toast('Ответ отправлен');
  });
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
  biocontrol:w=>w.has.biocontrol, weather:w=>w.has.weatherSrv, autoBuy:w=>w.upg.autoBuy
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
    · профиль ${PROFILES[world.profile].name} (коэффициент цен ×${PROFILES[world.profile].upgF})</div>`;
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
      ${slider('heat','Отопление ≥',8,28,0.5,c.heatSet,v=>v.toFixed(1)+' °C')}
      ${slider('vent','Вентиляция ≥',14,38,0.5,c.ventSet,v=>v.toFixed(1)+' °C')}
      ${world.has.co2 ? slider('co2','Целевой CO₂',400,1200,25,c.co2Set,v=>v+' ppm')
        : `<div class="row"><label>Обогащение CO₂</label><span class="val">нет оборудования</span></div>
           <div class="hint">На балконе и в комнате клапана нет: воздух и так меняется через щели. Появится вместе с теплицей.</div>`}
      <div class="hint">Проветривание выдувает CO₂ и тепло: чем ниже порог, тем дороже сезон, но суше воздух.</div>
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
        return `<div class="row"><label>${S.name}<div class="hint">вода ×${S.waterF.toFixed(2)} · рост ×${S.yieldF.toFixed(2)} · гниль ×${S.rotF.toFixed(1)}</div></label>
          <button class="btn ${cur?'good':''}" data-sysset="${S.id}" ${cur||!allowed?'disabled':''}>${label}</button></div>`;
      }).join('')}
      <div class="hint">Переход стоит денег и обнуляет часть гнили: это новый корневой объём, а не пересадка куста.</div>
    </div>
    <div class="card">
      <div class="h"><b>Свет и экраны</b></div>
      <div class="row"><label>Досветка: <b>${lightName(world)}</b>
        ${hasLight(world)?'':'<span style="color:var(--bad)">(не куплена)</span>'}
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
      <div class="hint">Автоматики нет: лампа горит ровно тогда, когда вы её включили, и всё это время ест электричество.</div>
      <div class="row"><label>Термоэкран ${world.has.screen?'':'<span style="color:var(--dim)">(не куплен)</span>'}</label>
        <button class="btn ${c.screenOn?'good':''}" id="btnScreenSet">${c.screenOn?'вкл':'выкл'}</button></div>
      <div class="row"><label>Затеняющая сетка ${world.has.shade?'':'<span style="color:var(--dim)">(не куплена)</span>'}</label>
        <button class="btn ${c.shadeOn?'good':''}" id="btnShadeSet">${c.shadeOn?'вкл':'выкл'}</button></div>
      <div class="hint">Экран экономит тепло ночью, сетка спасает от перегрева днём — но обе забирают свет.</div>
    </div>
    <div class="card">
      <div class="h"><b>Питание (fertigation)</b></div>
      ${slider('ec','EC, мСм/см',1.0,3.6,0.1,c.ecSet,v=>v.toFixed(1))}
      ${slider('ph','pH',5.0,6.8,0.1,c.phSet,v=>v.toFixed(1))}
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
        ${lastSaveTs ? 'последнее: '+new Date(lastSaveTs).toLocaleTimeString('ru-RU') : 'ещё не сохраняли'}
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
  bind('heat','heatSet', v=>v.toFixed(1)+' °C');
  bind('vent','ventSet', v=>v.toFixed(1)+' °C');
  bind('co2','co2Set', v=>v+' ppm');
  bind('ec','ecSet', v=>v.toFixed(1));
  bind('ph','phSet', v=>v.toFixed(1));
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
      <td>${r.temp.toFixed(0)}/${r.tempMin.toFixed(0)}</td>
      <td>${r.rh.toFixed(0)}%</td>
      <td>${num(r.harvest)} кг</td>
      <td style="color:${r.profit>=0?'var(--acc)':'var(--bad)'}">${money(r.profit)}</td></tr>`).join('');
  const evs = w.has.weatherSrv
    ? w.events.filter(e=>e.inFuture && e.label).map(e=>`<div class="alert warn">${e.label} через ${Math.max(1,Math.round(e.inDays))} дн.</div>`).join('')
    : `<div class="hint">Метеосервис не куплен: погодные события в прогнозе не показываются.</div>`;
  $('predBody').innerHTML = `
    <div class="kv"><span>Урожай за ${s.days} дн.</span><b>${num(s.kg)} кг</b></div>
    <div class="kv"><span>Прибыль за период</span><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit)}</b></div>
    <div class="kv"><span>Макс. влажность</span><b>${s.rhMax.toFixed(0)}%</b></div>
    <div class="kv"><span>Макс. температура</span><b>${s.tMax.toFixed(0)} °C</b></div>
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
  { text:'В «Магазине» есть дешёвый старт: термометр-гигрометр ${money(28)}, клейкие ловушки ${money(45)}, бочка воды ${money(90)} — купите одну вещь.',
    done:()=>world.has.alarm||world.has.sticky||world.has.circFan||world.has.handDose||
            world.has.humid||world.has.ups||world.has.film||world.has.climatePC||world.has.ledStrip },
  { text:'Нажмите «Прогноз» сверху и постройте прогноз на 7 дней — так проверяют решение до трат.',
    done:()=>tutorFlags.pred }
];

function renderTutor(){
  const box = $('tutor');
  if (!box) return;
  if (tutorDone || !world || page !== 'greenhouse' || tutorStep >= TUTOR.length){ box.classList.remove('on'); return; }
  $('tutorStep').textContent = `Шаг ${tutorStep+1} из ${TUTOR.length}`;
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
window.addEventListener('keydown', e=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const map = {'1':'top','2':'front','3':'bed','4':'plant','5':'free'};
  if (e.key.toLowerCase()==='l'){ toggleLayer(); return; }
  if (map[e.key]) setCamMode(map[e.key]);
  if (e.key===' '){ e.preventDefault(); togglePause(); }
  if (e.key==='ArrowLeft'){ e.preventDefault(); camNudge(-0.12, 0); }
  if (e.key==='ArrowRight'){ e.preventDefault(); camNudge(0.12, 0); }
  if (e.key==='ArrowUp'){ e.preventDefault(); camNudge(0, -0.07); }
  if (e.key==='ArrowDown'){ e.preventDefault(); camNudge(0, 0.07); }
  if (e.key==='+' || e.key==='='){ camZoomBy(1.12); }
  if (e.key==='-' || e.key==='_'){ camZoomBy(1/1.12); }
  if (e.key.toLowerCase()==='r'){ resetCam(); }
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveNow(false); }
});

function togglePause(){
  paused = !paused;
  $('btnPause').textContent = paused?'1:1':'1:1';
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

$('btnHarvest').onclick = ()=>{
  const r = harvestAll(world);
  toast(r.n ? `Собрано ${r.n} шт · ${num(r.kg)} кг → склад` : 'Нет спелых плодов');
  renderAll(); if (page==='shop') renderShop();
};
$('btnPrune').onclick = ()=>{
  const n = pruneLower(world, 2);
  toast(n? `Обрезано ${n} листьев` : 'Нечего обрезать');
  renderAll();
};
$('btnLampQuick').onclick = ()=>{
  const r = toggleLamp(world);
  toast(r.msg);
  if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
};
$('btnShadeQuick').onclick = ()=>{
  if (!world.has.shade) return toast('Сначала купите затеняющую сетку в магазине');
  world.ctrl.shadeOn = !world.ctrl.shadeOn;
  toast(world.ctrl.shadeOn?'Сетка опущена':'Сетка поднята');
  syncLightButtons(); renderAll(); if (page==='settings') renderSettings();
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
}

/* ---------------- сборка панелей ---------------- */
function renderAll(){
  if (!world) return;
  renderTop(); renderGauges(); renderFinance(); renderAlerts();
  renderDiagnosis(); renderGoals(); renderMissions(); renderStock(); renderTanks(); renderContracts(); renderMail(); renderNet(); renderLog();
  syncLightButtons();
  tutorTick();
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
    if (now - uiT > 130){
      uiT = now;
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

function showEnd(){
  endShown = true;
  const w = world;
  const cost = Object.values(w.cost).reduce((s,x)=>s+x,0);
  const profit = w.money - w.startMoney;
  const kgm2 = w.harvestedKg/w.area;
  const kwhm2 = w.energyKWh/w.area;
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
    <div class="kv"><span>Урожай</span><b>${num(w.harvestedKg)} кг · ${kgm2.toFixed(1)} кг/м²</b></div>
    <div class="kv"><span>Выручка</span><b>${money(w.revenue)}</b></div>
    <div class="kv"><span>Затраты всего</span><b>−${money(cost)}</b></div>
    <div class="kv"><span>Энергия</span><b>${num(w.energyKWh)} кВт·ч · ${kwhm2.toFixed(0)} кВт·ч/м²</b></div>
    <div class="kv"><span>Инцидентов</span><b>${w.incidents||0}</b></div>
    <div class="kv"><span>Заданий выполнено</span><b>${w.missionsDone}</b></div>
    <div class="kv"><span>Итог</span><b class="${profit>=0?'pos':'neg'}">${money(profit)}</b></div>
    <div class="hint" style="margin-top:10px">${verdict}</div>
    <p style="margin-top:14px"><button class="btn good" onclick="location.reload()">Новый сезон</button></p>
  </div>`;
  document.body.appendChild(div);
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
