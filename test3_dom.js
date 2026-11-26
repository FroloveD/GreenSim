// Дымовой тест интерфейса: заглушки DOM/Canvas + прогон кадров и всех страниц
const fs=require('fs');
const src=fs.readFileSync('/home/user/greenhouse/index.html','utf8');
const js=src.slice(src.indexOf('<script>')+8, src.lastIndexOf('</script>'));
const noop=()=>{};
const store={};
function makeEl(id){
  const e={
    id, innerHTML:'', textContent:'', value:'1', dataset:{}, checked:false, tagName:'DIV',
    style:new Proxy({},{get:()=>'',set:()=>true}),
    classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    querySelectorAll:()=>[], querySelector:()=>null,
    getBoundingClientRect:()=>({left:0,top:0,width:1280,height:800}),
    clientWidth:1280, clientHeight:800, width:1280, height:800,
    getContext:()=>ctxStub, setTransform:noop, focus:noop
  };
  return e;
}
const grad={addColorStop:noop};
const ctxStub=new Proxy({},{get(t,k){
  if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>grad;
  if(k==='canvas') return makeEl('c');
  if(k==='measureText') return ()=>({width:10});
  return noop;
},set(){return true;}});
global.document={
  getElementById(id){ return store[id]||(store[id]=makeEl(id)); },
  querySelectorAll(){ return []; },
  querySelector(){ return null; },
  createElement(t){ return makeEl('new'); },
  addEventListener:noop, body:{appendChild:noop, classList:{add:noop,remove:noop,toggle:noop,contains:()=>false}}
};
global.window=global;
global.addEventListener=noop;
global.devicePixelRatio=1;
let rafCb=null;
global.requestAnimationFrame=cb=>{ rafCb=cb; return 1; };
global.performance={now:()=>Date.now()};
global.setTimeout=()=>0; global.clearTimeout=noop; global.setInterval=()=>0;
global.location={reload:noop};
global.innerWidth=1280; global.innerHeight=800;

let err=null;
try{ new Function(js)(); }catch(e){ console.log('ОШИБКА ИНИЦИАЛИЗАЦИИ:', e.stack.split('\n').slice(0,5).join('\n')); process.exit(1); }

const VG=global.VG;
if(!VG){ console.log('НЕТ API VG'); process.exit(1); }

try {
  // старт сезона
  VG.start({profile:'hobby', crop:'tomato', weather:'normal'});
  console.log('старт ок: деньги=' + VG.world.money + ' растений=' + VG.world.plants.length);
  // прогон кадров
  let t=global.performance.now();
  for(let f=0; f<200; f++){ t+=16.7; const cb=rafCb; rafCb=null; cb(t); }
  console.log('200 кадров ок: день=' + VG.world.day + ' T=' + VG.world.temp.toFixed(1));
  // страницы
  VG.page('shop'); VG.page('settings'); VG.page('greenhouse');
  console.log('переключение страниц ок');
  // покупки
  console.log('покупка LED:', JSON.stringify(VG.buy('led')));
  console.log('покупка удобрений:', JSON.stringify(VG.buy('fert100')));
  console.log('контракт:', VG.contract(0));
  // камеры
  for (const m of ['top','front','bed','plant','free']){
    VG.cam(m);
    VG.zoom(1.6); VG.zoom(0.6);
    console.log('камера', m, 'ок');
  }
  VG.cam('free');
  // покупки после заработка
  VG.buy('fert100'); console.log('после закупки баланс', Math.round(VG.world.money));
  for(let f=0; f<30; f++){ t+=16.7; const cb=rafCb; rafCb=null; cb(t); }
  // прогноз
  const tAdv=Date.now();
  const sum = VG.predict(7);
  console.log('прогноз:', JSON.stringify({kg:Math.round(sum.kg), profit:Math.round(sum.profit), days:sum.days}), 'за', Date.now()-tAdv, 'мс');
  // симуляция до конца сезона
  const tSim=Date.now();
  while(!VG.world.over && Date.now()-tSim<60000){ VG.sim(24); VG.harvest(); if (VG.world.wh.lots.length) VG.sell(); }
  console.log('сезон завершён:', VG.world.over, 'день', VG.world.day, 'деньги', Math.round(VG.world.money),
    'урожай', Math.round(VG.world.harvestedKg), 'кг', 'порча', Math.round(VG.world.wh.wasteKg), 'кг',
    'склад', Math.round(VG.world.cost.storage), '€');
  // финальные кадры (путь showEnd)
  for(let f=0; f<20; f++){ t+=16.7; const cb=rafCb; rafCb=null; cb(t); }
  console.log('финальные кадры ок');
} catch(e){
  console.log('ОШИБКА ВЫПОЛНЕНИЯ:', e.stack.split('\n').slice(0,6).join('\n'));
  process.exit(1);
}
