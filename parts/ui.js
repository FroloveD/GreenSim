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
let activeSensorTip = '';
let financeDetailsOpen = false;
let logFilter = 'all';
let dashboardPrefsApplied = false;
const DASHBOARD_PREFS_KEY = 'vg_dashboard_panels_v1';
let page = 'greenhouse';
let settingsSection = 'grow';

let speed = 64, paused = false;   // скорость = игровых часов за реальную МИНУТУ
let acc = 0, lastT = performance.now(), uiT = 0;
let fc = null, endShown = false;
const pending = { profile:'farm', crop:'tomato', weather:'normal', difficulty:'normal', campaign:false, tutorialEnabled:true, sys:'soil',
                  // где и когда начинаем: средняя полоса по умолчанию, дата — сегодняшняя
                  site:'ekb', orient:'S', startDoy:(typeof todayDoy==='function'?todayDoy():91) };

let toastTimer = 0;
function toast(msg){
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('on'), 1700);
}


const SND_KEY = 'vg_sound_v1';
const SOUND_PRESETS = [
  {id:'off',label:'Без фонового звука'},
  {id:'lounge',label:'Лаунж · мягкий эмбиент'},
  {id:'nature',label:'Природа · птицы и ветер'},
  {id:'rain',label:'Дождь · спокойный ливень'},
  {id:'greenhouse',label:'Теплица · вентиляция и воздух'},
  {id:'night',label:'Ночной сад · сверчки и ветер'}
];
const sndCfg = (()=>{
  const def = {on:true, vol:0.7, preset:'off'};
  try {
    const raw = localStorage.getItem(SND_KEY);
    if (raw){ const o = JSON.parse(raw);
      const preset = SOUND_PRESETS.some(p=>p.id===o.preset) ? o.preset : 'off';
      return {on:o.on!==false,vol:clamp(o.vol===undefined?0.7:+o.vol,0,1),preset};
    }
  } catch(e){}
  return def;
})();
function sndSave(){
  try { localStorage.setItem(SND_KEY, JSON.stringify({on:sndCfg.on,vol:sndCfg.vol,preset:sndCfg.preset})); } catch(e){}
}
const SFX = (()=>{
  let ctx = null, master = null, noiseBuf = null, armed = false;
  let roomSend = null, roomVerb = null, roomWet = null;
  let ambientNodes = [], ambientTimer = 0, worldLayers = null;
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
      // Короткий импульс помещения: ранние отражения и мягкий хвост.
      roomVerb=ctx.createConvolver();
      const irLength=Math.floor(ctx.sampleRate*0.34);
      const impulse=ctx.createBuffer(2,irLength,ctx.sampleRate);
      for(let ch=0;ch<2;ch++){
        const data=impulse.getChannelData(ch);
        for(let i=0;i<irLength;i++){
          const decay=Math.pow(1-i/irLength,3.2);
          data[i]=(Math.random()*2-1)*decay*(i<ctx.sampleRate*0.018?0.32:0.12);
        }
      }
      roomVerb.buffer=impulse;
      roomSend=ctx.createGain();roomSend.gain.value=0.16;
      roomWet=ctx.createGain();roomWet.gain.value=0.12;
      roomSend.connect(roomVerb);roomVerb.connect(roomWet);roomWet.connect(master);
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
    if (ctx.state === 'suspended' && ctx.resume) { try { const p=ctx.resume(); if(p&&p.then)p.then(startAmbient).catch(()=>{}); } catch(e){} }
    armed = true;
    if(ctx.state==='running') startAmbient();
    return true;
  }
  function stopAmbient(){
    if(ambientTimer){clearTimeout(ambientTimer);ambientTimer=0;}
    ambientNodes.forEach(n=>{try{if(n.stop)n.stop();}catch(e){} try{n.disconnect();}catch(e){}});
    ambientNodes=[];
    worldLayers=null;
  }
  function addAmbientNoise(freq,type,gain,pan=0,slowDrift=true){
    const src=ctx.createBufferSource();src.buffer=noiseBuf;src.loop=true;
    const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=freq;filter.Q.value=0.45;
    const g=ctx.createGain();g.gain.value=gain;
    const p=ctx.createStereoPanner();p.pan.value=clamp(pan,-1,1);
    src.connect(filter);filter.connect(g);g.connect(p);p.connect(master);src.start();
    ambientNodes.push(src,filter,g,p);
    if(slowDrift){
      const lfo=ctx.createOscillator(),depth=ctx.createGain();
      lfo.type='sine';lfo.frequency.value=0.018+Math.random()*0.025;depth.gain.value=gain*0.18;
      lfo.connect(depth);depth.connect(g.gain);lfo.start();ambientNodes.push(lfo,depth);
    }
  }
  function addAmbientTone(freq,wave,gain,pan=0){
    const osc=ctx.createOscillator(),g=ctx.createGain(),p=ctx.createStereoPanner();
    osc.type=wave;osc.frequency.value=freq;g.gain.value=gain;p.pan.value=clamp(pan,-1,1);
    osc.connect(g);g.connect(p);p.connect(master);osc.start();ambientNodes.push(osc,g,p);
  }
  function birdChirp(){
    if(!sndCfg.on||!['nature','night'].includes(sndCfg.preset)||!ctx||ctx.state!=='running')return;
    // Разные по длине и высоте фразы с паузами, панорамой и комнатным хвостом.
    const night=sndCfg.preset==='night',base=night?1450:1850;
    const pan=Math.random()*1.25-0.625,count=2+Math.floor(Math.random()*3);
    let at=0;
    for(let i=0;i<count;i++){
      const f=base+Math.random()*(night?850:1250),dur=0.055+Math.random()*0.09;
      tone({type:i%2?'triangle':'sine',f0:f,f1:f*(0.78+Math.random()*0.38),dur,
        gain:0.006+Math.random()*0.005,at,pan,lp:night?4200:5200,attack:0.014});
      at+=dur+0.035+Math.random()*0.09;
    }
    ambientTimer=setTimeout(birdChirp,night?5200+Math.random()*6500:4300+Math.random()*7600);
  }
  function addWorldNoise(freq,type,pan=0){
    const src=ctx.createBufferSource();src.buffer=noiseBuf;src.loop=true;
    const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=freq;filter.Q.value=0.5;
    const gain=ctx.createGain();gain.gain.value=0.0001;
    const p=ctx.createStereoPanner();p.pan.value=clamp(pan,-1,1);
    src.connect(filter);filter.connect(gain);gain.connect(p);p.connect(master);src.start();
    ambientNodes.push(src,filter,gain,p);
    return {gain,filter,p};
  }
  function addWorldTone(freq,pan=0){
    const osc=ctx.createOscillator(),gain=ctx.createGain(),p=ctx.createStereoPanner();
    osc.type='sine';osc.frequency.value=freq;gain.gain.value=0.0001;p.pan.value=clamp(pan,-1,1);
    osc.connect(gain);gain.connect(p);p.connect(master);osc.start();
    ambientNodes.push(osc,gain,p);
    return {osc,gain,p};
  }
  function startWorldBed(){
    // Три независимых слоя: воздушный шум, вентиляция и низкий гул оборудования.
    worldLayers={
      air:addWorldNoise(620,'lowpass',-0.18),
      fan:addWorldNoise(1250,'bandpass',0.16),
      hum:addWorldTone(58,0)
    };
  }
  function setSmooth(param,value,seconds){
    if(!param||!ctx)return;
    const t=ctx.currentTime;
    try{
      param.cancelScheduledValues(t);
      param.setTargetAtTime(Math.max(0.0001,value),t,seconds||0.55);
    }catch(e){param.value=Math.max(0.0001,value);}
  }
  function syncWorld(w){
    if(!w||!worldLayers||!ctx||ctx.state!=='running'||!sndCfg.on||sndCfg.preset==='off')return;
    const c=w.ctrl||{}, temp=Number.isFinite(+w.temp)?+w.temp:20;
    const rh=Number.isFinite(+w.rh)?+w.rh:65;
    const powered=w.power!==false;
    const heating=powered&&(!!c.heatManualOn||(Number.isFinite(+c.heatSet)&&temp<+c.heatSet-1));
    const venting=powered&&(!!c.ventManualOn||(Number.isFinite(+c.ventSet)&&temp>+c.ventSet+1));
    const lighting=powered&&!!c.lampOn;
    const humidity=clamp((rh-45)/50,0,1);
    // Воздушный слой слегка меняет спектр и уровень вместе с влажностью.
    setSmooth(worldLayers.air.gain.gain,0.0007+humidity*0.0028,1.6);
    setSmooth(worldLayers.air.filter.frequency,360+humidity*780,1.8);
    // Вентиляция проявляется только при работе и не включается резким скачком.
    setSmooth(worldLayers.fan.gain.gain,venting?0.0048:0.00025,1.25);
    setSmooth(worldLayers.fan.filter.frequency,venting?1150:520,1.5);
    setSmooth(worldLayers.hum.gain.gain,powered?((heating?0.0018:0.00025)+(lighting?0.00045:0)):0.0001,1.8);
    try{worldLayers.hum.osc.frequency.setTargetAtTime(43+clamp(temp,0,38)*0.28,ctx.currentTime,2.0);}catch(e){}
  }
  function startAmbient(){
    stopAmbient();
    if(!sndCfg.on||sndCfg.preset==='off'||!ctx||ctx.state!=='running')return;
    switch(sndCfg.preset){
      case 'lounge':
        // Не неподвижная мелодия, а тихая многослойная звуковая среда.
        addAmbientTone(110,'sine',0.006,-0.22);addAmbientTone(164.8,'sine',0.003,0.2);
        addAmbientNoise(420,'lowpass',0.004,-0.35);addAmbientNoise(1250,'bandpass',0.0015,0.3);
        break;
      case 'nature':
        addAmbientNoise(520,'lowpass',0.010,-0.28);addAmbientNoise(2600,'bandpass',0.0018,0.34);birdChirp();
        break;
      case 'rain':
        addAmbientNoise(1500,'lowpass',0.014,-0.16);addAmbientNoise(4200,'highpass',0.0025,0.2);
        addAmbientNoise(760,'bandpass',0.003,0.08);
        break;
      case 'greenhouse':
        addAmbientTone(58,'sine',0.004,-0.12);addAmbientTone(116,'sine',0.0012,0.14);
        addAmbientNoise(430,'lowpass',0.009,-0.22);addAmbientNoise(1450,'bandpass',0.0015,0.28);
        break;
      case 'night':
        addAmbientNoise(390,'lowpass',0.009,-0.3);addAmbientNoise(3000,'highpass',0.0018,0.25);birdChirp();
        break;
    }
    startWorldBed();
    if(world) syncWorld(world);
  }
  function syncGain(){
    if(master)master.gain.value=sndCfg.on?sndCfg.vol*0.45:0;
    if(!sndCfg.on)stopAmbient();
    else if(armed&&ctx&&ctx.state==='running'&&!ambientNodes.length)startAmbient();
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
    if(o.distance!==undefined){
      const distant=ctx.createBiquadFilter();distant.type='lowpass';
      distant.frequency.value=clamp(9000-(+o.distance)*7600,700,9000);
      node.connect(distant);node=distant;
    }
    if(o.pan!==undefined&&ctx.createStereoPanner){
      const pan=ctx.createStereoPanner();pan.pan.value=clamp(+o.pan,-1,1);node.connect(pan);node=pan;
    }
    node.connect(g);g.connect(master);
    if(roomSend)g.connect(roomSend);
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
    let node=f;
    if(o.distance!==undefined){
      const distant=ctx.createBiquadFilter();distant.type='lowpass';
      distant.frequency.value=clamp(9000-(+o.distance)*7600,700,9000);
      node.connect(distant);node=distant;
    }
    if(o.pan!==undefined&&ctx.createStereoPanner){
      const pan=ctx.createStereoPanner();pan.pan.value=clamp(+o.pan,-1,1);node.connect(pan);node=pan;
    }
    node.connect(g);g.connect(master);
    if(roomSend)g.connect(roomSend);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }
  /* рисунок каждого звука: короткие, разные по характеру, без мелодий-навязчивостей */
  const RECIPES = {
    harvest(o){                                     // сухой контакт плодоножки и тихий шорох листа
      const k=clamp((o&&o.heavy)||0.5,0,1),pan=(Math.random()-.5)*0.55;
      tone({type:'sine',f0:350+95*k,f1:220,dur:0.09,gain:0.052,attack:0.014,pan,distance:0.12});
      noise({type:'lowpass',f0:1550,f1:520,dur:0.14,gain:0.028,q:0.55,at:0.018,pan,distance:0.12});
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
    water(){                                        // многослойная струя и отдельные капли
      const pan=(Math.random()-.5)*0.45;
      noise({type:'lowpass',f0:1800,f1:420,dur:0.42,gain:0.048,q:0.55,pan,distance:0.08});
      noise({type:'bandpass',f0:920,f1:360,dur:0.30,gain:0.024,q:0.7,at:0.07,pan,distance:0.08});
      for(let i=0;i<3;i++)noise({type:'bandpass',f0:2300+Math.random()*1100,f1:850,dur:0.045+Math.random()*0.04,gain:0.010,q:0.8,at:0.16+i*0.075,pan:(Math.random()-.5)*0.8,distance:0.04});
    },
    lamp(){                                         // негромкий механический щелчок
      noise({type:'lowpass',f0:1700,f1:700,dur:0.055,gain:0.032,q:0.6});
      tone({f0:430,f1:300,dur:0.065,gain:0.024,type:'sine',attack:0.008});
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
    arm, play, syncWorld,
    names: ()=>Object.keys(RECIPES),
    get on(){ return sndCfg.on; },
    get vol(){ return sndCfg.vol; },
    get preset(){ return sndCfg.preset; },
    presetLabel(){ return SOUND_PRESETS.find(p=>p.id===sndCfg.preset)?.label||'Без фонового звука'; },
    setOn(v){ sndCfg.on=!!v; sndSave(); syncGain(); return sndCfg.on; },
    setVol(v){ sndCfg.vol=clamp(+v||0,0,1); sndSave(); syncGain(); return sndCfg.vol; },
    setPreset(v){ sndCfg.preset=SOUND_PRESETS.some(p=>p.id===v)?v:'off'; sndSave(); if(armed&&ctx&&ctx.state==='running')startAmbient(); return sndCfg.preset; },
    state(){ return {on:sndCfg.on,vol:sndCfg.vol,preset:sndCfg.preset,armed,ctx:!!ctx,running:!!(ctx&&ctx.state==='running')}; }
  };
})();
function playSfx(name, opt){ try { return SFX.play(name, opt); } catch(e){ return false; } }
function syncSoundControls(){
  const on=SFX.on, vol=Math.round(SFX.vol*100), preset=SFX.preset;
  const toggleIds=['menuSoundToggle','settingsSoundToggle','btnSoundToggle','btnSndSet'];
  toggleIds.forEach(id=>{
    const el=$(id); if(!el)return;
    const compact=id==='btnSoundToggle';
    el.textContent=compact?(on?'🔊':'🔇'):(on?'Вкл':'Выкл');
    el.classList.toggle('good',on);
    el.setAttribute('aria-pressed',String(on));
    if(id==='btnSoundToggle')el.setAttribute('aria-label',on?'Выключить звук':'Включить звук');
  });
  [['menuSoundPreset','menuSoundVol','menuSoundVolValue'],['settingsSoundPreset','settingsSoundVol','settingsSoundVolValue'],['sndPreset','sndVol','sndVolValue']].forEach(([pid,vid,lid])=>{
    const p=$(pid),v=$(vid),l=$(lid);
    if(p)p.value=preset;
    if(v)v.value=String(vol);
    if(l)l.textContent=vol+'%';
  });
  const state=$('soundState');if(state)state.textContent=(on?'эффекты включены':'эффекты выключены')+' · '+vol+'%';
}
function toggleSound(){
  SFX.arm();
  const on=SFX.setOn(!SFX.on);
  syncSoundControls();
  toast(on?'Звук включён':'Звук выключен');
  if(page==='settings') renderSettings();
  return on;
}
function bindSoundControls(){
  ['menuSoundToggle','settingsSoundToggle','btnSoundToggle','btnSndSet'].forEach(id=>{const el=$(id);if(el)el.onclick=()=>toggleSound();});
  [['menuSoundPreset','menuSoundVol','menuSoundVolValue'],['settingsSoundPreset','settingsSoundVol','settingsSoundVolValue']].forEach(([pid,vid,lid])=>{
    const p=$(pid),v=$(vid),l=$(lid);
    if(p)p.onchange=()=>{SFX.arm();SFX.setPreset(p.value);syncSoundControls();};
    if(v)v.oninput=()=>{SFX.arm();SFX.setVol(v.value/100);syncSoundControls();};
  });
  const toolbarSettings=$('btnSoundSettings');
  if(toolbarSettings)toolbarSettings.onclick=()=>{
    $('mainSettings').classList.add('on');
    setTimeout(()=>{const card=$('mainSoundCard');if(card)card.scrollIntoView({behavior:'smooth',block:'center'});},0);
  };
  syncSoundControls();
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
  if (!world.has) world.has = {};
  if (!world.has.autoTimer && world.auto) ['lamp','water','co2','full'].forEach(k=>{ if(world.auto[k]) world.auto[k].on=false; });
  if (world.camp && world.tutorialEnabled === undefined) world.tutorialEnabled = true;
  world.tutorialEnabled = !!(world.camp && world.tutorialEnabled);
  tutorStep = Math.max(0, Math.min(TUTOR.length, Number.isInteger(world.tutorialStep) ? world.tutorialStep : 0));
  resetTutorFlags();
  tutorDone = !world.tutorialEnabled || !!world.tutorialCompleted;
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
  cam.plant = 0; cam.mode = 'free'; speed = 1; acc = 0; paused = false; endShown = false; fc = null;
  document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='1'));
  $('tutor').classList.remove('on');
  $('start').classList.remove('on');
  $('campaignPrologue').classList.remove('on');
  $('mainMenu').classList.remove('on');
  $('mainSettings').classList.remove('on');
  document.body.classList.remove('menu-open');
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
  const title=$('startTitle'), hint=$('startModeHint');
  if(title) title.textContent=pending.campaign?'Новая кампания':'Новая игра';
  if(hint) hint.textContent=pending.campaign?'Кампания: фиксированный старт и последовательные главы. Обучение можно отключить или включить отдельно.':'Настройте капитал, культуру, оборудование и сложность свободного сезона.';
  const tutorOption=$('campaignTutorOption'), tutorCheck=$('campaignTutorEnabled');
  if(tutorOption) tutorOption.hidden=!pending.campaign;
  if(tutorCheck){ tutorCheck.checked=!!pending.tutorialEnabled; tutorCheck.onchange=()=>{ pending.tutorialEnabled=!!tutorCheck.checked; }; }
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
      const nextCampaign = e.dataset.camp==='1';
      if (nextCampaign !== pending.campaign) pending.tutorialEnabled = nextCampaign;
      pending.campaign = nextCampaign;
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
    {id:'hot', n:'Жаркий', d:'+2.5 °C: перегрев, нужна вентиляция и затенение'},
    {id:'real', n:'Как за окном', d:'Архив Open-Meteo: температура и облачность по дням. Без сети игра вернётся к нормам.'}
  ];
  $('seedPick').innerHTML = ws.map(x=>`
    <div class="card" data-weather="${x.id}" style="cursor:pointer;${x.id===pending.weather?'border-color:var(--acc)':''}">
      <div class="h"><b>${x.n}</b></div><div class="d">${x.d}</div>
    </div>`).join('');
  document.querySelectorAll('[data-weather]').forEach(e=>e.onclick=()=>{
    pending.weather=e.dataset.weather; buildStart();
    if (pending.weather==='real') toast('Архив погоды загрузится при старте; при ошибке останутся нормы');
  });
  $('diffPick').innerHTML = Object.values(DIFFICULTY).map(d=>`
    <div class="card" data-diff="${d.id}" style="cursor:pointer;${d.id===pending.difficulty?'border-color:var(--acc)':''}">
      <div class="h"><b>${d.name}</b></div>
      <div class="d">${d.note}<br>постоянные ×${d.fixedF.toFixed(2)} · аварии ×${d.failF.toFixed(1)} · цена урожая ×${d.priceF.toFixed(2)} · магазин ×${d.shopF.toFixed(2)}</div>
    </div>`).join('');
  // 5. локация старта: климат берём из норм по точке (открытые данные)
  if ($('sitePick')) $('sitePick').innerHTML = SITE_LIST.map(x=>{
    const N = siteNormals(x);
    const summer = Math.round(N.temp[6]), winter = Math.round(N.temp[0]);
    return `<div class="card" data-site="${x.id}" style="cursor:pointer;${x.id===pending.site?'border-color:var(--acc)':''}">
      <div class="h"><b>${x.name}</b><span class="price" style="font-size:11px">${summer>0?'+':''}${summer}° / ${winter>0?'+':''}${winter}°</span></div>
      <div class="d">${x.note}</div>
      <div class="hint">широта ${x.lat.toFixed(1)}° · солнце ${Math.round(N.sun[6]*100)} % летом, ${Math.round(N.sun[0]*100)} % зимой · регион: ${N.region}</div>
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
                      site:pending.site, orient:pending.orient,
                      startDoy:(pending.startDoy!=null?pending.startDoy:todayDoy()),
                      // в кампании на балконе — только грунт, остальное откроется с главой
                      sys:(pending.campaign && pending.sys && GROW_SYS[pending.sys] && GROW_SYS[pending.sys].ch>0)
                          ? 'soil' : pending.sys });
  if (pending.weather === 'real') refreshRealWeather(false);
  world.tutorialEnabled = !!(pending.campaign && pending.tutorialEnabled);
  world.tutorialCompleted = false;
  world.tutorialStep = 0;
  tutorStep = 0; tutorDone = !world.tutorialEnabled; resetTutorFlags();
  cam.plant = 0; cam.mode = 'free'; paused = false; speed = 1;
  acc = 0; lastT = performance.now(); endShown = false; fc = null;
  $('start').classList.remove('on');
  $('mainMenu').classList.remove('on'); $('mainSettings').classList.remove('on');
  document.body.classList.remove('menu-open');
  $('pred').classList.remove('on');
  document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='1'));
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
  if (world.tutorialEnabled) renderTutor();
}

/* ---------------- роутер ---------------- */
function setPage(p){
  page = p;
  bodyCls('toggle','on-gh', p==='greenhouse');
  if (p==='settings') tutorFlags.settings=true;
  if (p==='shop') tutorFlags.shop=true;
  if (p==='greenhouse') tutorFlags.greenhouse=true;
  if (p!=='greenhouse' && typeof closeSheet==='function') closeSheet();
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===p));
  document.querySelectorAll('.page').forEach(e=>e.classList.remove('on'));
  $('page-'+p).classList.add('on');
  canvas.style.display = (p==='greenhouse') ? 'block' : 'none';
  if (p==='shop') renderShop();
  if (p==='settings') renderSettings();
  tutorTick();
  if (p==='shop') renderShop(); // после перехода на шаг покупки подсветить нужную карточку
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
  // Компактный климат всегда рядом с балансом и текущей культурой.
  $('tClimate').textContent = world.temp.toFixed(1) + '° · ' + Math.round(world.rh) + '%';
  $('tClimate').title = 'Температура воздуха: ' + world.temp.toFixed(1) + ' °C · относительная влажность: ' + Math.round(world.rh) + ' %';
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
function gauge(label, val, min, max, unit, cls, digits, tip){
  const pct = clamp((val-min)/(max-min),0,1)*100;
  return `<div class="g"><span class="sensor-label ${activeSensorTip===label?'tip-open':''}" data-tip-key="${label}" data-tip="${tip||label}" tabindex="0" role="button" aria-label="${label}: ${tip||label}">${label}<i>ⓘ</i></span><div class="bar"><i class="${cls||''}" style="width:${pct}%"></i></div>
    <b>${val.toFixed(digits===undefined?1:digits)}${unit}</b></div>`;
}
/* цвет шкалы влаги: сухо и перелив — красным, норма — спокойным */
function soilCls(w){
  const st = soilState(w);
  return st.key==='dry' || st.key==='wilt' ? 'hot' : (st.key==='wet' ? 'cold' : '');
}
function renderGauges(){
  const m = world.meas, C = CROPS[world.crop];
  const tCls = m.temp>C.heatTol ? 'hot' : (m.temp<C.coldTol ? 'cold' : '');
  $('gauges').innerHTML =
    gauge('T', m.temp, 5, 38, '°C', tCls, undefined, 'Температура воздуха на уровне датчика. Сравнивайте с диапазоном переносимости выбранной культуры.') +
    gauge('RH', m.rh, 30, 99, '%', m.rh>C.rhMax?'hot':'', 0, 'Относительная влажность воздуха. Слишком высокая влажность повышает риск грибковых заболеваний.');
  $('gaugeDetails').innerHTML =
gauge('CO₂', m.co2, 330, 1200, ' ppm', '', 0, 'Концентрация углекислого газа. Нужен для фотосинтеза; обогащение имеет смысл при достаточном освещении.') +
    gauge('PAR', world.light.meanLeaf, 0, 600, '', '', 0, 'Фотосинтетически активная радиация на листьях: сколько света реально получает крона сейчас.') +
    (()=>{ const D = dliInfo(world); const cls = D.ref < D.min ? 'cold' : (D.ref > D.max ? 'hot' : '');
      return `<div class="g" title="DLI за сутки: сегодня ${D.val.toFixed(1)}, вчера ${D.yest.toFixed(1)} из ${D.tgt} моль/м². Норма ${D.min}–${D.max}. Фотопериод ${D.photo.toFixed(1)} ч.">
        <span class="sensor-label ${activeSensorTip==='DLI'?'tip-open':''}" data-tip-key="DLI" data-tip="DLI — суммарная доза света за сутки. В отличие от PAR учитывает и интенсивность, и продолжительность освещения." tabindex="0" role="button" aria-label="DLI: суммарная доза света за сутки">DLI<i>ⓘ</i></span><div class="bar"><i class="${cls}" style="width:${clamp(D.val/Math.max(1,D.tgt),0,1)*100}%"></i></div><b>${D.val.toFixed(1)}</b></div>`; })() +
    gauge('влага', (m.moist===undefined?world.moist:m.moist), 0, 100, '%', soilCls(world), 0, 'Влажность субстрата по датчику. Низкие значения означают дефицит воды, слишком высокие — риск переувлажнения корней.') +
    gauge('болезнь', world.disease*100, 0, 100, '%', world.disease>0.4?'hot':'', 0, 'Индекс развития болезни растений. Рост показателя означает, что условия или инфекционный фон ухудшают состояние посадок.');  // подсказка о дрейфе датчиков
  const drift = Math.abs(world.drift.temp)+Math.abs(world.drift.rh)/10;
  const days = world.day - world.lastCalib;
  let hint = '';
  if (world.has.secondSensor){
    hint = `Расхождение датчиков: ΔT ${world.drift.temp>=0?'+':''}${world.drift.temp.toFixed(1)} K, `+
           `ΔRH ${world.drift.rh>=0?'+':''}${world.drift.rh.toFixed(1)}%, `+
           `Δвлага ${world.drift.soil>=0?'+':''}${world.drift.soil.toFixed(1)}%`;
  } else if (world.has.alarm){
    const dT = world.meas.temp - world.temp, dR = world.meas.rh - world.rh;
    const dS = (world.meas.moist||0) - (world.moist||0);
    hint = `Контрольный прибор: ΔT ${dT>=0?'+':''}${dT.toFixed(1)} K, ΔRH ${dR>=0?'+':''}${dR.toFixed(1)}%, `+
           `Δвлага ${dS>=0?'+':''}${dS.toFixed(1)}%`;
  } else if (drift > 0.6 || days > 25){
    hint = `Датчики не калибровались ${days} дн. — показания могут врать`;
  }
  $('driftHint').innerHTML = hint ? `<span style="color:var(--warn)" title="Сравнение основного датчика с контрольным. Большая разница или долгий интервал без калибровки снижают надёжность показаний.">⚠ ${hint}</span>` : 'показания датчиков, не «истина»';
}


function renderClimateControls(){
  if (!world) return;
  const fields = [
    ['ghHeat','ghHeatVal','heatSet',v=>v.toFixed(1)+' °C'],
    ['ghVent','ghVentVal','ventSet',v=>v.toFixed(1)+' °C'],
    ['ghCo2','ghCo2Val','co2Set',v=>Math.round(v)+' ppm']
  ];
  fields.forEach(([inputId,valueId,key,fmt])=>{
    const input=$(inputId), value=$(valueId);
    if (!input || !value) return;
    if (document.activeElement !== input) input.value=world.ctrl[key];
    value.textContent=fmt(world.ctrl[key]);
    if (!input.dataset.bound){
      input.oninput=()=>{
        world.ctrl[key]=parseFloat(input.value);
        value.textContent=fmt(world.ctrl[key]);
        if (world.camp && world.tutorialEnabled && tutorStep===TUTOR.length-1 && key==='heatSet') tutorFlags.climate=true;
      };
      input.onchange=()=>saveNow(true);
      input.dataset.bound='1';
    }
  });
  [['ghHeatToggle','heatManualOn','Отопление'],['ghVentToggle','ventManualOn','Проветривание']].forEach(([id,key,label])=>{
    const btn=$(id); if(!btn) return;
    const on=!!world.ctrl[key];
    btn.textContent=label+': '+(on?'вкл':'выкл');
    btn.classList.toggle('good',on);
    btn.setAttribute('aria-pressed',String(on));
    if(!btn.dataset.bound){
      btn.onclick=()=>{ world.ctrl[key]=!world.ctrl[key]; renderClimateControls(); saveNow(true); };
      btn.dataset.bound='1';
    }
  });
  const co2=$('ghCo2'), co2Hint=$('ghCo2Hint'), co2Control=$('ghCo2Control');
  const co2Label=document.querySelector('label[for="ghCo2"]');
  if(co2Label) co2Label.dataset.tip=world.has.co2
    ? 'Целевая концентрация CO₂ для обогащения воздуха. Включайте подачу только при достаточном свете.'
    : 'Оборудования CO₂ пока нет. Уставка станет полезной после покупки клапана и баллона.';
  if (co2){
    co2.disabled=!world.has.co2;
    if(co2Hint) co2Hint.textContent=world.has.co2
      ? 'Уставка клапана обогащения воздуха.'
      : 'Нет оборудования CO₂: настройка станет доступна после покупки.';
    if(co2Control) co2Control.classList.toggle('is-disabled',!world.has.co2);
  }
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
    <div class="finance-summary"><span>Прибыль сезона <b class="${profit>=0?'pos':'neg'}">${moneyNum(profit)}</b></span><span>Баланс <b>${moneyNum(w.money)}</b></span></div>
    <button type="button" class="panel-fold finance-fold" data-fold-target="financeDetails" aria-expanded="${financeDetailsOpen}">Подробная экономика <span class="fold-icon">${financeDetailsOpen?'−':'＋'}</span></button>
    <div id="financeDetails" class="fold-content" ${financeDetailsOpen?'':'hidden'}>
    <div class="finHead"><span>статья</span><span>сутки</span><span>сезон, ${moneySym()}</span></div>
    ${rows.map(r=>`<div class="finRow"><span>${r.label}</span>${cell(r.day)}${cell(r.season)}</div>`).join('')}
    ${(()=>{ const m = marginInfo(w);
      return `<div class="finRow" title="Себестоимость = все расходы сезона ÷ собранные килограммы. Цена — текущий ориентир рынка.">
        <span>себест./цена 1 кг</span><b class="dim">${m.cost==null?'—':money2(m.cost)}</b>
        <b>${money2(m.price)}</b></div>
      <div class="finRow" title="Маржа — цена дня минус расчётная себестоимость одного килограмма.">
        <span>маржа 1 кг</span><span class="dim">—</span>
        <b class="${m.margin==null?'':(m.margin>=0?'pos':'neg')}">${m.margin==null?'—':money2(m.margin)+' ('+(m.pct*100).toFixed(1)+'%)'}</b></div>
      <div class="hint">Плюс означает, что текущая цена выше расчётной себестоимости; минус — что цена не покрывает расходы. Это ориентир: фактическая выручка зависит от качества партии, порчи и условий контракта.</div>`; })()}
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
    }).join('')}</div>
    </div>`;
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
  const addRisk = (sev, text, why, risk, action) => out.push([sev, text, why, risk, action]);
  // отказы
  const broken = [];
  for (const k in w.equip) if (!w.equip[k].ok && equipInstalled(w,k)) broken.push(EQUIP_DEFS[k].name);
  if (!w.power) addRisk('bad','Нет электричества: отопление и форточки не работают',
    'Сеть питания недоступна или отключён вводной автомат.',
    'Без питания останавливаются активные электроприборы; температура и влажность могут выйти за безопасные пределы.',
    'Проверьте электроснабжение и автомат. После восстановления убедитесь, что контроллеры и оборудование снова включены.');
  if (broken.length) addRisk('bad','Отказ: '+broken.join(', ')+'. Магазин → Сервис → Ремонт',
    'Диагностика оборудования зафиксировала неисправность установленного узла.',
    'Оборудование не выполняет свою функцию; связанные параметры климата или производства могут ухудшиться.',
    'Откройте «Магазин → Сервис», выберите неисправный узел и выполните ремонт. Затем проверьте его состояние.');
  // гарантия: возврат денег за прибор, сломавшийся на 180–364-й день
  if (w.warranty && w.warranty.length){
    for (const r of w.warranty){
      const left = Math.max(0, r.due - w.day);
      out.push(['ok', `Гарантия: ${r.name} — ${money(r.eur)} вернут через ${left} дн (${fmtDate(w.doy + left)})`]);
    }
  }
  // климат по датчикам
  if (w.meas.temp > C.heatTol) addRisk('warn', `Перегрев ${w.meas.temp.toFixed(1)} °C — откройте форточки или затенение`,
    `Измеренная температура выше порога жаростойкости культуры (${C.heatTol} °C).`,
    'Жара снижает эффективность фотосинтеза и может привести к сбросу цветков и завязей.',
    'Проверьте вентиляцию, затеняющую сетку и уставку охлаждения. После изменения следите за температурой по датчику.');
  if (w.meas.temp < C.coldTol) addRisk('warn', `Холод ${w.meas.temp.toFixed(1)} °C — рост замедляется`,
    `Измеренная температура ниже холодостойкого порога культуры (${C.coldTol} °C).`,
    'При длительном охлаждении замедляются обмен веществ, рост корней и развитие плодов.',
    'Проверьте отопление, термоэкран и теплопотери. Убедитесь, что датчик показывает корректное значение.');
  if (w.meas.rh > C.rhMax) addRisk('warn', `Влажность ${w.meas.rh.toFixed(0)}% — повышен риск серой гнили`,
    `Относительная влажность выше ориентира культуры (${C.rhMax}%).`,
    'На влажных листьях дольше сохраняется конденсат, что повышает вероятность развития грибковых болезней.',
    'Проветрите теплицу и проверьте, не переувлажнён ли субстрат. Не допускайте резкого переохлаждения растений.');
  if (w.disease > 0.25) addRisk('bad', `Серая гниль ${(w.disease*100)|0}% — требуется обработка`,
    'Модель болезни учитывает продолжительную влажность и недостаточный воздухообмен.',
    'Поражённые ткани теряют продуктивность; без мер уровень болезни может продолжить расти.',
    'Снизьте влажность, улучшите вентиляцию и примените доступную в магазине обработку.');
  if (w.pest.active) addRisk('bad', `Паутинный клещ: уровень ${(w.pest.level*100)|0}% — требуется обработка`,
    'Вредитель повреждает листья и уменьшает работающую фотосинтезирующую поверхность.',
    'При росте заражения падает ассимиляция, а растение медленнее формирует новую биомассу.',
    'Проведите обработку из магазина и повторно оцените уровень вредителя через несколько игровых дней.');
  // долг
  if (w.money < -0.01){
    const rate = (typeof CFG!=='undefined' && CFG.debtRate) ? CFG.debtRate : 0.02;
    addRisk('bad', `Долг ${moneyS(-w.money)}: проценты ${moneyS(-w.money*rate)} в сутки. Покупки заблокированы`,
      'Баланс ушёл ниже нуля; проценты начисляются на непогашенную сумму каждый игровой день.',
      'Долг увеличивается даже без новых покупок, а блокировка магазина мешает обслуживать хозяйство.',
      'Продайте доступный урожай, сократите необязательные расходы и проверьте ежедневные затраты в панели «Экономика».');
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
  if (w.stock.waterM3 < 3) addRisk('bad','В баке почти нет воды — поливать нечем',
    'Запас воды ниже рабочего резерва системы полива.',
    'При исчерпании запаса влажность субстрата начнёт снижаться, даже если растение нуждается в поливе.',
    'Пополните бак в магазине и проверьте, восстановился ли запас после покупки.');
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
  $('alerts').innerHTML = out.slice(0,8).map(([k,t,why,risk,action])=>{
    const extra = [why?'<div><b>Почему:</b> '+why+'</div>':'',
                   risk?'<div><b>Чем грозит:</b> '+risk+'</div>':'',
                   action?'<div><b>Что сделать:</b> '+action+'</div>':''].filter(Boolean).join('');
    return `<div class="alert ${k}">${t}${extra?'<details style="margin-top:5px"><summary style="cursor:pointer">Разбор риска и действия</summary><div class="hint" style="padding:5px 0 0 4px;display:grid;gap:4px">${extra}</div></details>':''}</div>`;
  }).join('');
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
    ? d.items.map((it,i)=>{
        const cls = it.sev==='bad'?'bad':it.sev==='warn'?'warn':'ok';
        const details = [
          it.why ? `<div class="diagnosis-detail"><b>Почему:</b> ${it.why}</div>` : '',
          it.risk ? `<div class="diagnosis-detail"><b>Чем грозит:</b> ${it.risk}</div>` : '',
          it.action ? `<div class="diagnosis-detail"><b>Что делать:</b> ${it.action}</div>` : ''
        ].filter(Boolean).join('');
        return `<div class="alert ${cls}" style="margin-bottom:5px">
          <div>${it.text}</div>
          ${details ? `<div class="diagnosis-details">${details}</div>` : ''}
        </div>`;
      }).join('')
    : `<div class="alert ok">Ограничений не выявлено: свет, питание и климат в рабочем диапазоне</div>`;
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
      теряется <b>${(100/CROPS[world.crop].shelfDays).toFixed(0)} % массы</b> и <b>${(0.55/1.4*100/CROPS[world.crop].shelfDays).toFixed(0)} % цены</b> в сутки;
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
    <div class="kv"><span>сезон ×${season.toFixed(2)} · спрос дня ×${noise.toFixed(2)}</span><b class="${cls}">${arrow}</b></div>
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
      <div class="kv"><span>${escapeHTML(c.label)} ×${c.priceMult}</span><b>${num(c.delivered)}/${num(c.kg)} кг</b></div>
      ${(()=>{ const cc = c.crop || world.crop;
        const lock = c.priceLock || CROPS[cc].price*world.profilePriceF*c.priceMult;
        const now = priceToday(world, cc);
        const note = !c.priceLock ? '' : now < lock ? ' — рынок ниже, контракт выгоден'
                                            : now > lock ? ' — рынок выше, партию лучше продать свободно' : '';
        return `<div class="hint">цена зафиксирована при подписании: ${money2(lock)}/кг${note}</div>`; })()}
      <div class="g"><span>до D${c.deadline}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct|0}%</b></div>
      <button class="btn" data-deliver="${escapeHTML(c.id)}" style="margin-top:4px" ${canDeliver?'':'disabled'}>
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
    html += world.mail.map(m=>`<button class="btn" data-mail="${escapeHTML(m.id)}" style="display:block;width:100%;text-align:left;margin-bottom:4px;white-space:normal;line-height:1.3;font-size:10px">
      ${m.read?'':'<b style="color:var(--acc2)">● </b>'}${escapeHTML(m.subj.length>46?m.subj.slice(0,44)+'…':m.subj)}</button>`).join('');
  } else {
    html += `<div class="hint">Писем нет.</div>`;
  }
  const decisions = world.camp.decisions || [];
  html += `<div class="hint" style="margin-top:10px;border-top:1px solid var(--line2);padding-top:8px"><b>Решения кампании</b></div>`;
  if(decisions.length){
    html += decisions.slice(0,6).map(d=>`<div class="hint" style="margin:4px 0"><b>Д${d.day}</b> · ${escapeHTML(d.subj)}<br>Выбор: ${escapeHTML(d.result)}${d.repDelta? ' · репутация '+(d.repDelta>0?'+':'')+d.repDelta:''}</div>`).join('');
  }else html += '<div class="hint">Пока нет принятых решений. Ответы на письма будут сохраняться здесь.</div>';
  if (setHTML('mail', html))
    document.querySelectorAll('[data-mail]').forEach(b=>press(b, ()=>openMail(b.dataset.mail)));
}
function renderCampaignArchive(){
  const items = MAILBOX.map(m=>`<button class="btn" data-mail-preview="${escapeHTML(m.id)}" style="display:block;width:100%;text-align:left;margin:4px 0;white-space:normal">${escapeHTML(m.subj)}</button>`).join('');
  $('mailBox').innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Архив писем кампании</h2><button class="btn" data-mail-preview-close>Закрыть</button></div><div class="hint">Можно перечитать любое письмо. Архив не меняет ход кампании и не повторяет выборы.</div>${items}`;
  $('mailModal').classList.add('on');
  document.querySelectorAll('[data-mail-preview]').forEach(b=>press(b,()=>openMailPreview(b.dataset.mailPreview)));
  document.querySelectorAll('[data-mail-preview-close]').forEach(b=>b.onclick=()=> $('mailModal').classList.remove('on'));
}
function openMailPreview(id){
  const m=MAILBOX.find(x=>x.id===id); if(!m)return;
  $('mailBox').innerHTML=`<div class="row" style="justify-content:space-between"><span class="hint">Архив · без повторного выбора</span><button class="btn" data-mail-archive-back>К списку</button></div><h2>${escapeHTML(m.subj)}</h2><p style="white-space:normal">${escapeHTML(m.body).replace(/\\n/g,'<br>')}</p><div class="hint">Это архивная копия письма. Прочтение не меняет сохранение и не повторяет решение.</div>`;
  $('mailModal').classList.add('on');
  const back=$('mailBox').querySelector('[data-mail-archive-back]');if(back)back.onclick=renderCampaignArchive;
}
function openMail(id){
  const m = world.mail.find(x=>x.id===id);
  if (!m) return;
  m.read = true;
  $('mailBox').innerHTML = `<h1>${escapeHTML(m.subj)}</h1><p>${escapeHTML(m.body).replace(/\n/g,'<br>')}</p>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
      ${m.opts.map((o,i)=>`<button class="btn good" data-answer="${i}" style="text-align:left">
        ${escapeHTML(o.label)}${o.desc?`<div class="hint" style="color:#3a2d12">${escapeHTML(o.desc)}</div>`:''}</button>`).join('')}
    </div>`;
  $('mailModal').classList.add('on');
  document.querySelectorAll('[data-answer]').forEach(b=>press(b, ()=>{
    answerMail(world, id, +b.dataset.answer);
    $('mailModal').classList.remove('on');
    renderAll(); toast('Ответ отправлен');
  }));
}

function renderLog(){
  const entries = world.log.filter(l=>logFilter==='all' || (logFilter==='campaign' ? l.cat==='campaign' : l.cat!=='campaign')).slice(0,40);
  const filters = [['all','Все'],['campaign','Кампания'],['other','Остальное']];
  $('log').innerHTML = `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px">${filters.map(([id,label])=>`<button class="btn ${logFilter===id?'good':''}" data-log-filter="${id}" style="font-size:10px;padding:4px 7px">${label}</button>`).join('')}</div>`+
    (entries.length?entries.map(l=>`<div class="${escapeHTML(l.k||'')}">${escapeHTML(l.t)} · ${escapeHTML(l.m)}</div>`).join(''):'<div class="hint">Записей в этой категории пока нет.</div>');
  document.querySelectorAll('[data-log-filter]').forEach(b=>b.onclick=()=>{logFilter=b.dataset.logFilter;renderLog();});
}

/* ---------------- магазин ---------------- */
const OWNED = {
  thermo:w=>w.has.alarm, sticky:w=>w.has.sticky, circFan:w=>w.has.circFan, autoTimer:w=>w.has.autoTimer,
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
    `покупки: <b>×${shopPriceFactor(world).toFixed(2)}</b> · ` +
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
      let price = shopItemCost(world, it);
      if (it.id==='repair'){
        let t = 0; for (const k in world.equip) if (!world.equip[k].ok) t += Math.round(EQUIP_DEFS[k].repair*shopPriceFactor(world));
        price = t;
      }
      const noRoom = it.bulk && whFreeL(world) < it.bulk;
      const affordable = world.money >= price && !noRoom;
      const disabled = (!reqOk || owned || (it.id!=='repair' && !affordable));
      const label = owned ? 'Куплено'
        : (it.id==='repair' ? (price ? 'Отремонтировать' : 'Всё работает')
        : (noRoom ? 'Склад полон' : (!affordable ? 'Мало средств' : (it.dynamic ? 'Купить' : 'Установить'))));
      const tutorBuy = world.camp && world.tutorialEnabled && ((it.id==='thermo' && tutorStep===4) || (it.id==='sticky' && tutorStep===5));
      html += `<div class="card ${tutorBuy?'tutor-shop-buy':''}" data-shop-item="${it.id}">
        <div class="h"><b>${it.name}</b>${tutorBuy?'<span class="lock">покупка по обучению</span>':''}</div>
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
    renderAll(); renderShop();
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
      <div class="h"><b>История кампании и интерфейс</b></div>
      <div class="hint">Перечитывайте сюжетные письма без повторного применения решений. Настройки панелей можно вернуть к исходному виду.</div>
      <div class="row"><label>Архив писем тёти Розы<div class="hint">Все письма кампании, включая уже прочитанные.</div></label><button class="btn" id="btnCampaignArchive">Открыть архив</button></div>
      <div class="row"><label>Расположение и свёрнутость панелей<div class="hint">Сбросить пользовательский порядок и раскрыть все панели.</div></label><button class="btn" id="btnResetPanels">Сбросить вид панелей</button></div>
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
    <div class="card" id="soundCard">
      <div class="h"><b>Звук и атмосфера</b></div>
      <div class="d" style="color:var(--txt)" id="soundState">${SFX.on?'эффекты включены':'эффекты выключены'} · ${Math.round(SFX.vol*100)}%</div>
      <div class="row"><label>Звуки действий и интерфейса<div class="hint">Сбор, покупки, вода и игровые события. Клавиша Z включает или выключает эффекты.</div></label>
        <button class="btn ${SFX.on?'good':''}" id="btnSndSet">${SFX.on?'вкл':'выкл'}</button></div>
      <div class="row"><label for="sndPreset">Фоновая атмосфера<div class="hint">Процедурный фон и адаптивные слои: шум воздуха, вентиляция и гул оборудования меняются вслед за климатом и включёнными системами.</div></label>
        <select id="sndPreset" style="max-width:230px">${SOUND_PRESETS.map(p=>'<option value="'+p.id+'" '+(SFX.preset===p.id?'selected':'')+'>'+p.label+'</option>').join('')}</select></div>
      <div class="row"><label for="sndVol">Общая громкость</label><b id="sndVolValue">${Math.round(SFX.vol*100)}%</b></div>
      <input type="range" id="sndVol" min="0" max="100" step="5" value="${Math.round(SFX.vol*100)}">
      <div class="row"><label>Проверка эффектов</label><button class="btn" id="btnSndTest">прослушать</button></div>
      <div class="hint">Фоновый звук запускается после первого действия игрока — это ограничение браузера. Его можно отключить отдельно от звуков интерфейса.</div>
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
      <div class="hint">Можно вручную (лампа горит, пока не выключите) или по таймеру — карточка «Таймеры и автоматизация» ниже. Будильник только напоминает и сам ничего не переключает.</div>
      <div class="row"><label>Термоэкран ${world.has.screen?'':'<span style="color:var(--dim)">(не куплен)</span>'}</label>
        <button class="btn ${c.screenOn?'good':''}" id="btnScreenSet">${c.screenOn?'вкл':'выкл'}</button></div>
      <div class="row"><label>Затеняющая сетка ${world.has.shade?'':'<span style="color:var(--dim)">(не куплена)</span>'}</label>
        <button class="btn ${c.shadeOn?'good':''}" id="btnShadeSet">${c.shadeOn?'вкл':'выкл'}</button></div>
      <div class="hint">Экран экономит тепло ночью, сетка спасает от перегрева днём — но обе забирают свет.</div>
    </div>
    <div class="card" id="dliCard">
      <div class="h"><b>Свет за сутки (DLI)</b></div>
      ${(()=>{ const D = dliInfo(world);
        const cls = D.val < D.min ? 'var(--warn)' : (D.val > D.max ? 'var(--bad)' : 'var(--acc)');
        return `<div class="kv"><span>набрано сегодня</span><b style="color:${cls}">${D.val.toFixed(1)} из ${D.tgt} моль/м²</b></div>
        <div class="kv"><span>вчера за день</span><b>${D.yest.toFixed(1)} моль/м² · ${D.verdict}</b></div>
        <div class="g" style="grid-template-columns:1fr 96px"><span>${D.verdict}</span>
          <div class="bar"><i class="${D.ref<D.min?'cold':''}" style="width:${clamp(D.val/Math.max(1,D.tgt),0,1)*100}%"></i></div></div>
        <div class="kv"><span>световой день</span><b>${D.day.toFixed(1)} ч</b></div>
        <div class="kv"><span>лампа сегодня</span><b>${D.lampHours.toFixed(1)} ч · ${D.lampDLI.toFixed(1)} моль</b></div>
        <div class="kv"><span>фотопериод</span><b>${D.photo.toFixed(1)} ч <span style="color:var(--dim)">из ${D.photoMin}–${D.photoMax}</span>
          <span style="color:${D.photoVerdict==='в норме'?'var(--acc)':'var(--warn)'}">${D.photoVerdict}</span></b></div>
        <div class="hint" style="margin-top:6px">DLI — это весь свет за сутки, а не мгновенный PAR: у ${C.name.toLowerCase()}
        норма ${D.min}–${D.max} моль/м², цель ${D.tgt}. Один час досветки даёт около ${D.perHour.toFixed(2)} моль/м²: ${
          D.need <= 0.2 ? 'цель взята, лампа не нужна.'
          : D.reachable ? 'до цели ещё '+Math.round(D.hours)+' ч лампы.'
          : 'за 14 ч лампа даст только +'+D.gain14.toFixed(1)+' моль — зимой этого мало: спасают светлая сторона, плёнка на рамы и скороспелые сорта.'}</div>`; })()}
    </div>
    <div class="card" id="weatherCard">
      <div class="h"><b>Погода за окном</b></div>
      ${(()=>{ const rw=world.realWeather;
        if (!rw) return `<div class="d" style="color:var(--txt)">Считаем по климатическим нормам</div>
          <div class="hint">Многолетние средние по выбранной точке. Игра работает без подключения к сети.</div>`;
        if (rw.error) return `<div class="d" style="color:var(--txt)">Архив недоступен</div>
          <div class="hint">${rw.error}. Используются климатические нормы; игровой процесс не зависит от сети.</div>`;
        const t=realWeatherAt(world,world.doy);
        return `<div class="kv"><span>источник</span><b>${rw.source} · ${rw.n||0} дней</b></div>
          <div class="kv"><span>сегодня по архиву</span><b>${t?(t.t>0?'+':'')+t.t.toFixed(1)+' °C':'—'}</b></div>
          <div class="kv"><span>облачность</span><b>${t?Math.round(t.cloud*100)+' %':'—'}</b></div>
          <div class="hint">Архив за последний год заменяет средние нормы фактической температурой и облачностью по дням. Погодные события игры продолжают действовать.</div>`; })()}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn" id="btnWeatherRefresh">Обновить из сети</button>
        <button class="btn" id="btnWeatherNorms">Вернуться к нормам</button>
      </div>
    </div>
    <div class="card" id="pwaCard">
      <div class="h"><b>Приложение</b></div>
      <div class="kv"><span>режим</span><b id="pwaState">проверяю…</b></div>
      <div class="hint" style="margin-bottom:8px">Игра устанавливается на устройство и может запускаться без сети. Сохранение остаётся в браузере.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn good" id="btnInstall" style="display:none">Установить на устройство</button>
        <button class="btn" id="btnPwaHelp">Как установить</button>
      </div>
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
        if (k.id==='full')  nowText = a.on ? 'автопилот: свет, влага, CO₂, отопление и проветривание по климатическим уставкам' : '';
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
      <div class="hint">В кампании автоматизация открывается по главам и требует покупки контроллера таймеров. Полная автоматизация дополнительно требует климат-контроллер. Без нужного оборудования переключатели заблокированы; ручное управление остаётся доступным.</div>
    </div>
    <div class="card">
      <div class="h"><b>Питание (fertigation)</b></div>
      ${(()=>{ const R = stageRecipe(world);
        const inEC = c.ecSet >= R.ec[0] && c.ecSet <= R.ec[1] && c.phSet >= R.ph[0] && c.phSet <= R.ph[1];
        const mid = ((R.ec[0]+R.ec[1])/2).toFixed(1), phMid = ((R.ph[0]+R.ph[1])/2).toFixed(1);
        return `<div class="kv"><span>текущая стадия</span><b>${R.name}</b></div>
        <div class="hint" style="margin-bottom:7px">${R.why}</div>
        <div class="row"><label>Рецепт для этой стадии
          <div class="hint">EC ${R.ec[0]}–${R.ec[1]} · pH ${R.ph[0]}–${R.ph[1]} · ${inEC?'параметры в коридоре':'параметры вне коридора'}</div></label>
          <button class="btn ${inEC?'':'good'}" id="btnRecipeApply">поставить ${mid} / ${phMid}</button></div>`; })()}
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
      <div class="h"><b>Клавиши</b></div>
      ${[['Пробел','пауза / реальное время'],['1–5','переключение камер'],['← → ↑ ↓','сдвиг камеры'],['+ / −','приближение и отдаление'],['R','сброс ракурса'],['L','слой освещения'],['Z','звук вкл./выкл.'],['Ctrl + S','сохранить сезон']]
        .map(([k,d])=>'<div class="kv"><span>'+d+'</span><b>'+k+'</b></div>').join('')}
      <div class="hint" style="margin-top:6px">Горячие клавиши не перехватывают ввод в полях.</div>
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
      <div class="h"><b>Словарь терминов</b></div>
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
    <div class="card" id="campaignTutorCard">
      <div class="h"><b>Обучение кампании</b></div>
      <div class="hint" style="margin-bottom:8px">Обучение встроено в кампанию. Его можно отключить здесь и включить снова в любой момент.</div>
      ${world.camp ? `<div class="row"><label>Подсказки кампании<div class="hint">${world.tutorialEnabled ? (world.tutorialCompleted ? 'Обучение пройдено' : 'Обучение включено') : 'Обучение отключено'}</div></label>
        <button class="btn ${world.tutorialEnabled?'good':''}" id="btnTutorToggle">${world.tutorialEnabled?'Отключить':'Включить'}</button></div>
        ${world.tutorialEnabled ? '<button class="btn" id="btnTutorAgain">Начать обучение заново</button>' : ''}`
        : '<div class="hint">Доступно в кампании. В свободной игре можно пользоваться справочником и обзором интерфейса.</div>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">
        <button class="btn" id="btnObAgain">Обзор интерфейса</button>
        <button class="btn" id="btnManual2">Справочник</button>
      </div>
      <div class="hint" style="margin-top:6px">Термины раскрываются в карточке «Словарь терминов».</div>
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
      <div class="h"><b>Параметры модели</b></div>
      <div class="hint">
        Граф органов в сцене: ${world.plants.reduce((s,p)=>s+p.organs.length,0)} узлов.<br>
        Свет: воксельная LAD 0.25 м, 5 лучей на лист.<br>
        Фотосинтез: Farquhar-lite, V<sub>cmax</sub> ${C.vcmax} µмоль/м²·с, оптимум ${C.tempOpt} °C.<br>
        Климат: баланс с подшагами 5 мин, UA ${num(world.env.UA)} Вт/К.<br>
        Экономика: ${num(world.plantScale)} растений на ${P.area} м², цена ${money2(C.price)}/кг ×${P.priceF}.
      </div>
    </div>
  </div>`;

  // Split the long settings page into focused sections without recreating its controls.
  const settingsGrid = $('settingsBody').querySelector('.setgrid');
  if (settingsGrid) {
    const cards = [...settingsGrid.children];
    const groups = [
      {id:'climate',title:'Погода',icon:'☀',test:/^Погода за окном$/},
      {id:'grow',title:'Выращивание',icon:'🌱',test:/^(Система выращивания|Свет и экраны|Свет за сутки \(DLI\)|Питание \(fertigation\))$/},
      {id:'auto',title:'Автоматизация',icon:'⏱',test:/^Таймеры и автоматизация$/},
      {id:'interface',title:'Интерфейс',icon:'⚙',test:/^(Камера|Валюта|Приложение)$/},
      {id:'help',title:'Обучение и справка',icon:'ⓘ',test:/^(Словарь терминов|Обучение|Параметры модели)$/},
      {id:'save',title:'Сохранение и сезон',icon:'▣',test:/^Сезон$/}
    ];
    const nav=document.createElement('div'); nav.className='settings-nav';
    const panels=document.createElement('div'); panels.className='settings-panels';
    const buckets=new Map(groups.map(g=>[g.id,[]]));
    cards.forEach(card=>{const title=card.querySelector('.h b')?.textContent?.trim()||'';const group=groups.find(g=>g.test.test(title))||groups[4];buckets.get(group.id).push(card);});
    groups.forEach(g=>{const panel=document.createElement('section');panel.className='settings-section';panel.dataset.settingsSection=g.id;buckets.get(g.id).forEach(card=>panel.appendChild(card));if(!panel.children.length)return;panels.appendChild(panel);const button=document.createElement('button');button.type='button';button.className='settings-tab';button.dataset.settingsTab=g.id;button.textContent=g.icon+'  '+g.title;button.onclick=()=>{settingsSection=g.id;paintSettingsSections();};nav.appendChild(button);});
    settingsGrid.replaceWith(nav,panels);
  }
  function paintSettingsSections(){document.querySelectorAll('[data-settings-section]').forEach(el=>el.hidden=el.dataset.settingsSection!==settingsSection);document.querySelectorAll('[data-settings-tab]').forEach(el=>el.classList.toggle('on',el.dataset.settingsTab===settingsSection));}
  if (!document.querySelector('[data-settings-section="'+settingsSection+'"]')) settingsSection='climate';
  paintSettingsSections();
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
  if ($('sndVol')) $('sndVol').oninput = ()=>{
    SFX.arm(); SFX.setVol($('sndVol').value/100); syncSoundControls();
  };
  if ($('sndPreset')) $('sndPreset').onchange = ()=>{
    SFX.arm();SFX.setPreset($('sndPreset').value);syncSoundControls();toast('Фоновый звук: '+SFX.presetLabel());
  };
  if ($('btnSndTest')) $('btnSndTest').onclick = ()=>{
    SFX.arm(); if(!SFX.on) SFX.setOn(true);
    SFX.play('buy'); syncSoundControls(); renderSettings();
  };
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
  if ($('btnWeatherRefresh')) $('btnWeatherRefresh').onclick = ()=>{
    toast('Запрашиваю архив погоды…'); refreshRealWeather(true);
  };
  if ($('btnWeatherNorms')) $('btnWeatherNorms').onclick = ()=>{
    world.realWeather=null; toast('Погода снова по нормам');
    renderSettings(); renderAll(); saveNow(true);
  };
  if ($('btnInstall')) $('btnInstall').onclick = ()=>{
    if (!deferredInstall) return toast('Браузер не предложил установку: откройте меню браузера и выберите «Установить приложение»');
    deferredInstall.prompt(); deferredInstall=null;
    const b=$('btnInstall'); if(b) b.style.display='none';
  };
  if ($('btnPwaHelp')) $('btnPwaHelp').onclick = ()=>{
    toast('Android/Chrome: меню ⋮ → «Установить приложение». iPhone/Safari: «Поделиться» → «На экран «Домой»».');
  };
  updatePwaState();
  // Рецепт фазы: устанавливаем середину диапазонов EC и pH для текущей культуры.
  if ($('btnRecipeApply')) $('btnRecipeApply').onclick = ()=>{
    const R = stageRecipe(world);
    world.ctrl.ecSet = Math.round((R.ec[0]+R.ec[1])/2*10)/10;
    world.ctrl.phSet = Math.round((R.ph[0]+R.ph[1])/2*10)/10;
    world.ctrl.recipe = R.stage.key==='fruit' ? 'fruit' : 'std';
    toast(`Рецепт «${R.name}»: EC ${world.ctrl.ecSet} · pH ${world.ctrl.phSet}`);
    renderSettings(); renderAll(); saveNow(true);
  };
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
  if ($('btnManual2')) $('btnManual2').onclick = ()=>$('manual').classList.add('on');
  if ($('btnObAgain')) $('btnObAgain').onclick = ()=>showOnboarding(0);
  if ($('btnTutorToggle')) $('btnTutorToggle').onclick = ()=>setCampaignTutorEnabled(!world.tutorialEnabled, true);
  if ($('btnTutorAgain')) $('btnTutorAgain').onclick = ()=>showTutorAgain();
  if ($('btnCampaignArchive')) $('btnCampaignArchive').onclick = renderCampaignArchive;
  if ($('btnResetPanels')) $('btnResetPanels').onclick = ()=>{
    try{localStorage.removeItem(DASHBOARD_PREFS_KEY);}catch(e){}
    const col=document.querySelector('#dashGrid .col.left');
    if(col){
      const order=['climate','why','risks','finance'];
      const map=new Map(Array.from(col.querySelectorAll(':scope > [data-panel-key]')).map(el=>[el.dataset.panelKey,el]));
      order.forEach(key=>{const el=map.get(key);if(el)col.appendChild(el);});
    }
    document.querySelectorAll('[data-panel-fold]').forEach(btn=>{
      const target=$(btn.dataset.foldTarget);if(target)target.hidden=false;
      btn.setAttribute('aria-expanded','true');
      const icon=btn.querySelector('.fold-icon');if(icon)icon.textContent='−';
      const panel=btn.closest('[data-panel-key]');if(panel)panel.classList.remove('is-collapsed');
    });
    dashboardPrefsApplied=true;toast('Вид панелей восстановлен');
  };
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

/* ---------------- обучение кампании: сначала интерфейс, затем управление ---------------- */
let tutorStep = 0, tutorDone = false;
const tutorFlags = { cam:false, speed:false, settings:false, shop:false, buyThermo:false, buySticky:false, greenhouse:false, climate:false };
function resetTutorFlags(){ for (const k in tutorFlags) tutorFlags[k] = false; }

const TUTOR = [
  { text:'Начнём со сцены. Перетащите её мышью, чтобы осмотреть теплицу. Кнопки сверху переключают ракурсы, а клавиши 1–5 выбирают камеры.', done:()=>tutorFlags.cam },
  { text:'Настройте темп игры. Новая кампания начинается на скорости 4×. Кнопки 1×, 4×, 16× и выше меняют скорость хода времени. Для внимательного управления выбирайте 1×, для ожидания — ускорение. Попробуйте нажать любую кнопку скорости.', done:()=>tutorFlags.speed },
  { text:'Откройте «Параметры». Здесь находятся настройки выращивания, света, питания и автоматизации. Пока ничего покупать или включать не нужно.', done:()=>tutorFlags.settings },
  { text:'Перейдите в «Магазин». Здесь оборудование открывается по мере развития кампании. Начнём с двух недорогих покупок, полезных уже на балконе.', done:()=>tutorFlags.shop },
  { text:'Первая покупка — термометр-гигрометр с сигналом. Найдите его в разделе «Бюджетный старт» и установите: контрольный прибор поможет заметить расхождение с основным датчиком.', done:()=>!!world.has.alarm },
  { text:'Вторая покупка — клейкие ловушки. Они снижают риск паутинного клеща. Купите комплект, если он ещё не установлен. LED-лента за 220 — не обязательная первая покупка: штатная лампа уже есть, добавляйте ленту только если DLI показывает нехватку света.', done:()=>!!world.has.sticky },
  { text:'Вернитесь в «Теплицу». Основной экран — рабочее место: здесь датчики, климатические регуляторы, состояние растений и быстрые действия.', done:()=>page==='greenhouse' && tutorFlags.settings && tutorFlags.shop && world.has.alarm && world.has.sticky },
  { text:'Попробуйте изменить порог отопления в панели «Климат». Это ручное управление: автоматика появится позже, после открытия нужной главы и покупки контроллера.', done:()=>tutorFlags.climate }
];

/* свернуть подсказку: она больше не висит над сценой, если игрок уже прочитал */
let tutorFoldT = 0, tutorFoldStep = -1;
function tutorFold(min){
  const box = $('tutor'); if (!box) return;
  box.classList.toggle('min', !!min);
  const b = $('tutorFold'); if (b) b.textContent = min ? 'развернуть' : 'свернуть';
}
function clearTutorTarget(){
  document.querySelectorAll('.tutor-target').forEach(el=>el.classList.remove('tutor-target'));
}
function tutorTarget(){
  const selectors = ['.camBar','.speeds','[data-tab="settings"]','[data-tab="shop"]','[data-buy="thermo"]','[data-buy="sticky"]','[data-tab="greenhouse"]','#ghHeat'];
  return document.querySelector(selectors[tutorStep] || '');
}
function renderTutor(){
  const box = $('tutor');
  if (!box) return;
  clearTutorTarget();
  if (tutorDone || !world || !world.camp || !world.tutorialEnabled || tutorStep >= TUTOR.length){ box.classList.remove('on'); return; }
  $('tutorStep').textContent = `Шаг ${tutorStep+1} из ${TUTOR.length}`;
  // Не сворачиваем инструкцию автоматически: игрок сам управляет её отображением.
  if (tutorFoldStep !== tutorStep){ tutorFoldStep = tutorStep; tutorFold(false); }
  $('tutorText').textContent = TUTOR[tutorStep].text;
  $('tutorDots').innerHTML = TUTOR.map((_,i)=>
    `<i class="${i<tutorStep?'done':i===tutorStep?'on':''}"></i>`).join('');
  box.classList.add('on');
  const target = tutorTarget();
  if (target){
    target.classList.add('tutor-target');
    if (target.id==='s_co2') target.closest('.card')?.classList.add('tutor-target');
  }
}
function tutorTick(){
  if (!world || !world.camp || !world.tutorialEnabled || tutorDone) { $('tutor').classList.remove('on'); return; }
  // Уже купленные предметы не предлагаются повторно после загрузки сохранения.
  tutorFlags.buyThermo = !!world.has.alarm;
  tutorFlags.buySticky = !!world.has.sticky;
  // Обучение идёт по действиям игрока, а не по календарю.
  const previousStep = tutorStep;
  while (tutorStep < TUTOR.length && TUTOR[tutorStep].done()) tutorStep++;
  if (tutorStep !== previousStep){
    world.tutorialStep = tutorStep;
    saveNow(true);
  }
  if (tutorStep >= TUTOR.length){
    tutorDone = true; world.tutorialCompleted = true;
    $('tutor').classList.remove('on');
    saveNow(true);
    toast('Обучение кампании пройдено');
    return;
  }
  renderTutor();
}
function skipTutorStep(){
  if (!world || !world.camp || !world.tutorialEnabled || tutorDone) return;
  tutorStep = Math.min(TUTOR.length, tutorStep + 1);
  world.tutorialStep = tutorStep;
  clearTutorTarget();
  if (tutorStep >= TUTOR.length){
    tutorDone = true;
    world.tutorialEnabled = false;
    world.tutorialCompleted = true;
    $('tutor').classList.remove('on');
    toast('Последний шаг пропущен · обучение завершено');
  } else {
    renderTutor();
    toast('Шаг пропущен');
  }
  saveNow(true);
}
function skipAllTutor(){
  if (!world || !world.camp || !world.tutorialEnabled || tutorDone) return;
  if (!window.confirm('Пропустить всё обучение кампании? Все оставшиеся шаги будут отмечены как завершённые. Это действие можно будет отменить только повторным включением обучения в настройках.')) return;
  tutorStep = TUTOR.length;
  tutorDone = true;
  world.tutorialStep = tutorStep;
  world.tutorialEnabled = false;
  world.tutorialCompleted = true;
  clearTutorTarget();
  $('tutor').classList.remove('on');
  saveNow(true);
  toast('Всё обучение пропущено');
}
$('tutorNext').onclick = skipTutorStep;
$('tutorSkip').onclick = skipAllTutor;
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

document.querySelectorAll('#camBar [data-view]').forEach(b=>b.onclick=()=>{
  if(b.dataset.view==='plant' && cam.mode==='plant' && world.plants.length>1) cam.plant=(cam.plant+1)%world.plants.length;
  setCamMode(b.dataset.view);
  if(b.dataset.view==='plant') toast('Выбрано растение #'+(cam.plant+1)+' из '+world.plants.length);
});
window.addEventListener('keydown', e=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const map = {'1':'top','2':'front','3':'bed','4':'plant','5':'free'};
  if (e.key.toLowerCase()==='l'){ toggleLayer(); return; }
  if (e.key.toLowerCase()==='z'){ toggleSound(); return; }
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
  const requested = parseFloat(b.dataset.s);
  if (world && world.camp && requested > 64){
    speed = 64;
    document.querySelectorAll('.spd').forEach(x=>x.classList.toggle('on', x.dataset.s==='64'));
    toast('В кампании максимальное ускорение — 64×');
    return;
  }
  speed = requested;
  document.querySelectorAll('.spd').forEach(x=>x.classList.toggle('on', x===b));
  if (world && world.camp && world.tutorialEnabled) { tutorFlags.speed=true; tutorTick(); }
  if (paused) togglePause();
});
$('btnPred').onclick = ()=>{ $('pred').classList.toggle('on'); };
$('predClose').onclick = ()=>$('pred').classList.remove('on');
document.querySelectorAll('[data-pred]').forEach(b=>b.onclick=()=>startPred(+b.dataset.pred));
$('btnSave').onclick = ()=>saveNow(false);
$('btnHelp').onclick = ()=>showOnboarding(0);
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
function setCampaignTutorEnabled(enabled, restart){
  if (!world || !world.camp){ toast('Обучение доступно в кампании'); return; }
  world.tutorialEnabled=!!enabled;
  if (enabled && restart){ tutorStep=0; world.tutorialStep=0; tutorDone=false; world.tutorialCompleted=false; resetTutorFlags(); }
  if (!enabled){ tutorDone=true; clearTutorTarget(); $('tutor').classList.remove('on'); }
  else { tutorDone=false; setPage('greenhouse'); renderTutor(); }
  saveNow(true);
  if (page==='settings') renderSettings();
  toast(enabled ? 'Обучение кампании включено' : 'Обучение кампании отключено');
}
function showTutorAgain(){ setCampaignTutorEnabled(true, true); setPage('greenhouse'); }
$('obNext').onclick = ()=>{ if(obI < document.querySelectorAll('#help .obSlide').length-1){ obI++; obPaint(); } };
$('obPrev').onclick = ()=>{ if(obI>0){ obI--; obPaint(); } };
$('obDots').onclick = e=>{ const k=e.target.dataset && e.target.dataset.ob; if(k!=null){ obI=+k; obPaint(); } };
$('obGloss').onclick = ()=>{ $('help').classList.remove('on');  setPage('settings'); setTimeout(()=>{ const g=$('glossCard'); if(g) g.scrollIntoView({behavior:'smooth',block:'center'}); },60); };
obPaint();
$('manualClose').onclick = ()=>$('manual').classList.remove('on');
$('startBtn').onclick = startGame;
// Main menu routes the player into a mode before opening the existing setup wizard.
function openNewGame(mode){
  pending.campaign=mode==='campaign';
  pending.tutorialEnabled=!!pending.campaign;
  pending.profile=pending.campaign?'balcony':'farm';
  $('mainMenu').classList.remove('on');
  if (pending.campaign){
    $('campaignPrologue').classList.add('on');
  } else {
    $('start').classList.add('on');
    buildStart();
  }
}
$('introContinue').onclick=()=>{
  $('introScreen').classList.remove('on');
  $('mainMenu').classList.add('on');
};
$('campaignPrologueBack').onclick=()=>{
  $('campaignPrologue').classList.remove('on');
  $('mainMenu').classList.add('on');
};
$('campaignPrologueContinue').onclick=()=>{
  $('campaignPrologue').classList.remove('on');
  $('start').classList.add('on');
  buildStart();
};
$('menuCampaign').onclick=()=>openNewGame('campaign');
$('menuFree').onclick=()=>openNewGame('free');
$('menuContinue').onclick=()=>loadFromStorage();
$('menuSettings').onclick=()=> $('mainSettings').classList.add('on');
$('mainSettingsClose').onclick=()=> $('mainSettings').classList.remove('on');
bindSoundControls();
$('menuCameraInvert').onclick=()=>{ setCamInvertY(!camInvertY); $('menuCameraInvert').textContent=camInvertY?'Наклон камеры: инвертирован':'Наклон камеры: обычный'; };
$('menuCurrency').onchange=e=>setCurrency(e.target.value);

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
$('btnWaterQuick').onclick = ()=>{
  const r = water(world);
  toast(r.msg);
  if (r.ok){ syncLightButtons(); renderAll(); if (page==='settings') renderSettings(); saveNow(true); }
};
/* подсветка состояния на кнопках под сценой: включено — зелёная */
function syncLightButtons(){
  if (!world) return;
  const l = $('btnLampQuick');
  if (l){
    l.classList.toggle('good', !!world.ctrl.lampEnabled && hasLight(world));
    l.setAttribute('aria-label', (!!world.ctrl.lampEnabled && hasLight(world)) ? 'Выключить досветку' : 'Включить досветку');
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
    wb.setAttribute('aria-label', 'Полить грядку. Текущая влажность субстрата: ' + m + '%');
    wb.classList.toggle('warn', st.key === 'dry' || st.key === 'wilt');
    wb.classList.toggle('good', st.key === 'ok');
    wb.title = st.key === 'ok'
      ? 'Влага в норме — поливать не обязательно'
      : (st.key === 'wet' ? 'Перелив: дайте субстрату подсохнуть, помогает проветривание'
                          : 'Субстрат сухой — полейте');
  }
}

/* ---------------- компактные панели и подсказки датчиков ---------------- */
function readDashboardPrefs(){
  try {
    const raw=localStorage.getItem(DASHBOARD_PREFS_KEY);
    const value=raw?JSON.parse(raw):{};
    return {order:Array.isArray(value.order)?value.order:[],collapsed:value.collapsed&&typeof value.collapsed==='object'?value.collapsed:{}};
  } catch(e){ return {order:[],collapsed:{}}; }
}
function writeDashboardPrefs(prefs){
  try { localStorage.setItem(DASHBOARD_PREFS_KEY,JSON.stringify(prefs)); } catch(e){}
}
function saveDashboardPanelOrder(){
  const prefs=readDashboardPrefs();
  prefs.order=Array.from(document.querySelectorAll('#dashGrid .col.left>[data-panel-key]')).map(el=>el.dataset.panelKey);
  writeDashboardPrefs(prefs);
}
function applyDashboardPanelOrder(){
  if(dashboardPrefsApplied) return;
  dashboardPrefsApplied=true;
  const col=document.querySelector('#dashGrid .col.left');
  if(!col) return;
  const prefs=readDashboardPrefs();
  const panels=Array.from(col.querySelectorAll(':scope > [data-panel-key]'));
  const byKey=new Map(panels.map(el=>[el.dataset.panelKey,el]));
  prefs.order.forEach(key=>{ const panel=byKey.get(key); if(panel) col.appendChild(panel); });
}
function bindDashboardDetails(){
  applyDashboardPanelOrder();
  document.querySelectorAll('[data-fold-target]').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound='1';
    const target=$(btn.dataset.foldTarget);
    if(btn.dataset.panelFold && target){
      const prefs=readDashboardPrefs();
      const collapsed=!!prefs.collapsed[btn.dataset.panelFold];
      target.hidden=collapsed;
      btn.setAttribute('aria-expanded',String(!collapsed));
      const panel=btn.closest('[data-panel-key]');
      if(panel) panel.classList.toggle('is-collapsed',collapsed);
      const icon=btn.querySelector('.fold-icon');
      if(icon) icon.textContent=collapsed?'＋':'−';
    }
    btn.addEventListener('click',()=>{
      const target=$(btn.dataset.foldTarget);
      if(!target) return;
      const open=btn.getAttribute('aria-expanded')!=='true';
      btn.setAttribute('aria-expanded',String(open));
      if(target.id==='financeDetails') financeDetailsOpen=open;
      target.hidden=!open;
      const icon=btn.querySelector('.fold-icon');
      if(icon) icon.textContent=open?'−':'＋';
      const panel=btn.closest('[data-panel-key]');
      if(panel) panel.classList.toggle('is-collapsed',!open);
      if(btn.dataset.panelFold){
        const prefs=readDashboardPrefs();
        prefs.collapsed[btn.dataset.panelFold]=!open;
        writeDashboardPrefs(prefs);
      }
    });
  });
  document.querySelectorAll('[data-panel-move]').forEach(btn=>{
    if(btn.dataset.moveBound) return;
    btn.dataset.moveBound='1';
    btn.addEventListener('click',()=>{
      const panel=btn.closest('[data-panel-key]');
      if(!panel) return;
      const siblings=Array.from(panel.parentElement.querySelectorAll(':scope > [data-panel-key]'));
      const index=siblings.indexOf(panel), direction=btn.dataset.panelMove;
      if(direction==='up' && index>0) panel.parentElement.insertBefore(panel,siblings[index-1]);
      else if(direction==='down' && index<siblings.length-1) panel.parentElement.insertBefore(siblings[index+1],panel);
      saveDashboardPanelOrder();
      panel.parentElement.querySelectorAll('[data-panel-move]').forEach(control=>{
        const owner=control.closest('[data-panel-key]');
        const list=Array.from(panel.parentElement.querySelectorAll(':scope > [data-panel-key]'));
        const pos=list.indexOf(owner);
        control.disabled=(control.dataset.panelMove==='up'&&pos===0)||(control.dataset.panelMove==='down'&&pos===list.length-1);
      });
    });
  });
  document.querySelectorAll('[data-panel-move]').forEach(control=>{
    const col=control.closest('.col.left'), owner=control.closest('[data-panel-key]');
    const list=col?Array.from(col.querySelectorAll(':scope > [data-panel-key]')):[];
    const pos=list.indexOf(owner);
    control.disabled=(control.dataset.panelMove==='up'&&pos===0)||(control.dataset.panelMove==='down'&&pos===list.length-1);
  });
  const sensorTip=$('sensorTooltip')||(()=>{
    const node=document.createElement('div');
    node.id='sensorTooltip';
    node.setAttribute('role','tooltip');
    document.body.appendChild(node);
    return node;
  })();
  const placeSensorTip=el=>{
    if(!el||!sensorTip.classList.contains('on')) return;
    const r=el.getBoundingClientRect();
    const margin=12, width=sensorTip.offsetWidth, height=sensorTip.offsetHeight;
    let left=Math.max(margin,Math.min(r.left,window.innerWidth-width-margin));
    let top=r.bottom+8;
    if(top+height>window.innerHeight-margin) top=Math.max(margin,r.top-height-8);
    sensorTip.style.left=left+'px';
    sensorTip.style.top=top+'px';
  };
  const showSensorTip=(el,pinned)=>{
    if(!el) return;
    sensorTip.textContent=el.dataset.tip||el.dataset.tipKey||'';
    sensorTip.classList.add('on');
    sensorTip.dataset.owner=el.dataset.tipKey||'';
    if(pinned) activeSensorTip=el.dataset.tipKey||'';
    placeSensorTip(el);
  };
  const hideSensorTip=()=>{
    activeSensorTip='';
    sensorTip.classList.remove('on');
    sensorTip.dataset.owner='';
  };
  document.querySelectorAll('.sensor-label').forEach(el=>{
    if(el.dataset.tipBound) return;
    el.dataset.tipBound='1';
    el.addEventListener('mouseenter',()=>{ if(!activeSensorTip) showSensorTip(el,false); });
    el.addEventListener('mouseleave',()=>{ if(!activeSensorTip) sensorTip.classList.remove('on'); });
    el.addEventListener('focus',()=>showSensorTip(el,false));
    el.addEventListener('blur',()=>{ if(!activeSensorTip) sensorTip.classList.remove('on'); });
    el.addEventListener('click',e=>{
      e.preventDefault();
      if(activeSensorTip===el.dataset.tipKey) hideSensorTip();
      else showSensorTip(el,true);
    });
    el.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();if(activeSensorTip===el.dataset.tipKey)hideSensorTip();else showSensorTip(el,true);}
      if(e.key==='Escape') hideSensorTip();
    });
  });
  if(activeSensorTip){
    const owner=Array.from(document.querySelectorAll('.sensor-label')).find(el=>el.dataset.tipKey===activeSensorTip);
    if(owner) showSensorTip(owner,true); else hideSensorTip();
  }
  if(!document.documentElement.dataset.sensorTipGlobal){
    document.documentElement.dataset.sensorTipGlobal='1';
    document.addEventListener('pointerdown',e=>{
      if(!e.target.closest('.sensor-label') && activeSensorTip) hideSensorTip();
    });
    window.addEventListener('resize',()=>{ if(activeSensorTip){const owner=Array.from(document.querySelectorAll('.sensor-label')).find(el=>el.dataset.tipKey===activeSensorTip);if(owner)placeSensorTip(owner);}});
    window.addEventListener('scroll',()=>{ if(activeSensorTip){const owner=Array.from(document.querySelectorAll('.sensor-label')).find(el=>el.dataset.tipKey===activeSensorTip);if(owner)placeSensorTip(owner);}},true);
  }
}

/* ---------------- сборка панелей ---------------- */
function renderAll(){
  if (!world) return;
  // В кампании 480× недоступно: скрываем кнопку и страхуем состояние скорости.
  const turboButton = document.querySelector('.spd[data-s="480"]');
  if (turboButton) turboButton.hidden = !!world.camp;
  if (world.camp && speed > 64){
    speed = 64;
    document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='64'));
  }
  const speed64Button = document.querySelector('.spd[data-s="64"]');
  if (speed64Button) speed64Button.title = world.camp
    ? 'Максимальная скорость кампании — 64×'
    : 'Ускорение 64×';
  if (world.alarmPing){ toast(world.alarmPing.text); world.alarmPing = null; }
  renderTop(); renderGauges(); renderClimateControls(); renderFinance();
  bindDashboardDetails();
  renderAlerts();
  renderDiagnosis(); renderGoals(); renderMissions(); renderStock(); renderTanks(); renderContracts(); renderMail(); renderNet(); renderLog();
  syncLightButtons();
  tutorTick();
}

/* ---------------- главный цикл ---------------- */
let frozen = false;                    // отладочный «стоп-кадр»: VG.freeze(true)
let soundSyncAt = 0;
function frame(now){
  if (frozen){ lastT = now; requestAnimationFrame(frame); return; }
  const dtReal = Math.min(0.25, Math.max(0, (now-lastT)/1000));   // на слабом железе кадры редкие — не теряем время
  lastT = now;
  if (world){
    if (now-soundSyncAt>450){
      soundSyncAt=now;
      try{SFX.syncWorld(world);}catch(e){}
    }
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

/* Следующий сезон: хозяйство (деньги, оборудование, склад, глава, репутация)
   переезжает, куст и история начинаются заново. */
function startNextSeason(){
  if (!world) return;
  const prev = world;
  const carry = carrySnapshot(prev);
  const opts = { profile: prev.profile, crop: prev.crop, sys: prev.sys,
    seed: (prev.seed + 7919) >>> 0, difficulty: prev.diffId, campaign: !!prev.camp,
    site: (prev.site && prev.site.id) || 'ekb', orient: (prev.site && prev.site.orient) || 'S',
    startDoy: prev.doy, carry, weather: prev.weather };
  world = makeWorld(opts);
  if (prev.realWeather && prev.realWeather.t) world.realWeather = prev.realWeather;
  if (world.camp && carry.camp && carry.camp.ch > 0) moveChapter(world, carry.camp.ch, true);
  document.querySelectorAll('.modal.on').forEach(m=>{ if (m.id !== 'start') m.classList.remove('on'); });
  endShown = false; paused = false; speed = 1; acc = 0; lastT = performance.now(); fc = null;
  document.querySelectorAll('.spd').forEach(b=>b.classList.toggle('on', b.dataset.s==='1'));
  $('btnPause').classList.remove('on'); $('btnPause').textContent = '⏸';
  setPage('greenhouse'); renderAll(); saveNow(true);
  toast(`Сезон ${world.seasons}: хозяйство перенесено · репутация ${world.rep} · баланс ${money(world.money)}`);
}

function showEnd(){
  endShown = true;
  const w = world;
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
    <div class="kv"><span>Урожай</span><b>${num(w.harvestedKg)} кг · ${kgm2.toFixed(1)} кг/м²</b></div>
    <div class="kv"><span>Выручка</span><b>${money(w.revenue)}</b></div>
    <div class="kv"><span>Затраты всего</span><b>−${money(cost)}</b></div>
    <div class="kv"><span>Энергия за сезон</span><b>${num(Math.round(kwhSum))} кВт·ч · ${kwhm2.toFixed(0)} кВт·ч/м²</b></div>
    <div class="kv"><span>Инцидентов</span><b>${w.incidents||0}</b></div>
    <div class="kv"><span>Заданий выполнено</span><b>${w.missionsDone}</b></div>
    <div class="kv"><span>Себестоимость 1 кг</span><b>${costPerKg(w)==null?'—':money2(costPerKg(w))} · цена дня ${money2(priceToday(w,w.crop))}</b></div>
    <div class="kv"><span>Свет за сутки</span><b>${(()=>{ const hs=(w.history||[]).filter(h=>h.dli>0); return hs.length?'в среднем '+ (hs.reduce((a,b)=>a+b.dli,0)/hs.length).toFixed(1)+' моль/м²':'—'; })()}</b></div>
    <div class="kv"><span>Репутация</span><b>${w.rep||0}${w.carry?' · перенесена':''}</b></div>
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
  const nb = div.querySelector('#btnNextSeason');
  if (nb) nb.onclick = ()=>{ div.remove(); startNextSeason(); };
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
   Service worker обновляет index.html по сети и использует кэш при офлайне. */
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
    e.preventDefault(); deferredInstall=e;
    const b=$('btnInstall'); if(b) b.style.display='';
  });
  window.addEventListener('appinstalled', ()=>{
    deferredInstall=null; toast('Приложение установлено'); updatePwaState();
  });
  if (typeof navigator!=='undefined' && 'serviceWorker' in navigator &&
      typeof location!=='undefined' && location.protocol.indexOf('http')===0){
    navigator.serviceWorker.register('sw.js').then(()=>updatePwaState()).catch(()=>updatePwaState());
    navigator.serviceWorker.addEventListener('controllerchange',updatePwaState);
  }
}

window.addEventListener('pagehide', ()=>{ if (world && !world.over) saveNow(true); });
document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState === 'hidden' && world && !world.over) saveNow(true);
});

/* ---------------- запуск ---------------- */
resize();
buildStart();
renderResumeBox();
document.body.classList.add('menu-open');
if (peekSaveMeta()) $('menuContinue').hidden=false;
$('menuCameraInvert').textContent=camInvertY?'Наклон камеры: инвертирован':'Наклон камеры: обычный';
$('menuCurrency').value=curId;
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
