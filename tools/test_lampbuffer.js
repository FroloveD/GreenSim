// Буфер остывания светильника — без браузера.
// 1) время буфера своё у каждой лампы (лента 5 мин … панель 40 мин);
// 2) свет выходит на режим и гаснет быстро, тепло — медленно;
// 3) после выключения корпус ещё греет теплицу, и это видно в температуре;
// 4) электричество списывается сразу, буфер счётчик не отменяет;
// 5) старые сейвы мигрируют, прогноз на клоне мира не падает.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,cloneWorld,lampTauMin,lampGlow,lampWarm,
          lampGlowAvg,lampWarmAvg,lampHeatKW,lampBodyWord,lightLit,hasLight,installedLightKW,
          lampPPFDOf,dliInfo,serializeWorld,deserializeWorld,COST:0};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

/* мир без штатной лампы: ставим ровно то, что проверяем */
function world(){
  const w = M.makeWorld({profile:'balcony', crop:'tomato', seed:21, site:'ekb', startDoy:15});
  w.has.lampBase = false; w.has.ledStrip = false; w.has.led = false; w.has.panel = false;
  w.has.strip2 = false; w.upg.ledBoost = false;
  w.money = 5000; w.stock.waterM3 = 20;
  return w;
}
const lampOn = (w, on)=>{
  const h = w.hour;
  w.ctrl.lampEnabled = on; w.ctrl.lampOn = on && !!w.power && M.hasLight(w);
  return h;
};
/* прогон мелкими шагами, возвращает массив состояний */
function run(w, minutes){
  const out = [];
  for (let i=0; i<minutes; i++){ M.stepWorld(w, 1/60); out.push({glow:w.lampGlow, warm:w.lampWarm, t:w.temp}); }
  return out;
}

/* ---------- 1. время буфера по типу лампы ---------- */
{
  const tau = (setup)=>{ const w = world(); setup(w); return M.lampTauMin(w); };
  const T = {
    strip:    tau(w=>{ w.has.ledStrip = true; }),
    strip2:   tau(w=>{ w.has.ledStrip = true; w.has.strip2 = true; }),
    lampBase: tau(w=>{ w.has.lampBase = true; }),
    led:      tau(w=>{ w.has.led = true; }),
    ledBoost: tau(w=>{ w.has.led = true; w.upg.ledBoost = true; }),
    panel:    tau(w=>{ w.has.panel = true; w.has.led = true; })
  };
  ok(T.strip===5 && T.strip2===6 && T.lampBase===15, 'лента остывает за 5 минут, вторая лента за 6, лампа на стойке за 15',
     `${T.strip} / ${T.strip2} / ${T.lampBase} мин`);
  ok(T.led===20 && T.ledBoost===22, 'LED-досветка — 20 минут, с бустом 22', `${T.led} / ${T.ledBoost}`);
  ok(T.panel===40, 'панель — самая тяжёлая, 40 минут', `${T.panel} мин`);
  ok(M.lampTauMin(world())===0, 'без лампы буфера нет');
}

/* ---------- 2. разогрев: свет быстро, тепло медленно ---------- */
{
  const w = world(); w.has.panel = true; w.has.led = true;
  lampOn(w, true);
  const r = run(w, 5);
  ok(r[0].glow > 0.05 && r[0].glow < 0.9, 'в первую минуту панель светит не на полную', `glow ${r[0].glow.toFixed(2)}`);
  ok(r[4].glow > 0.5, 'через 5 минут свет уже больше половины', `glow ${r[4].glow.toFixed(2)}`);
  ok(r[4].warm < r[4].glow, 'а корпус греется медленнее, чем светит', `тепло ${r[4].warm.toFixed(2)} против света ${r[4].glow.toFixed(2)}`);
  run(w, 15);
  ok(w.lampGlow > 0.85, 'за 20 минут свет выходит в режим', `glow ${w.lampGlow.toFixed(2)}`);
  ok(w.lampWarm > 0.6, 'корпус за те же 20 минут горячий', `тепло ${w.lampWarm.toFixed(2)}`);
}

/* ---------- 3. выключение: свет гаснет, тепло держится ---------- */
{
  const w = world(); w.has.panel = true; w.has.led = true;
  lampOn(w, true); run(w, 30);
  const warmBefore = w.lampWarm;
  lampOn(w, false);
  run(w, 5);
  ok(w.lampGlow < 0.15, 'через 5 минут после выключения свет погас', `glow ${w.lampGlow.toFixed(2)}`);
  ok(w.lampWarm > 0.6*warmBefore, 'а корпус ещё горячий', `тепло ${w.lampWarm.toFixed(2)}`);
  ok(M.lampHeatKW(w) > 0.2, 'и продолжает греть теплицу', `+${M.lampHeatKW(w).toFixed(2)} кВт`);
  ok(/остывает/.test(M.lampBodyWord(w)), 'в интерфейсе это слово «остывает»', M.lampBodyWord(w));
  run(w, 30);
  ok(w.lampWarm > 0.1 && w.lampWarm < 0.5, 'через полчаса тепло ещё есть, но уже меньше', `тепло ${w.lampWarm.toFixed(2)}`);
  run(w, 180);
  ok(w.lampWarm < 0.05, 'через три часа корпус остыл', `тепло ${w.lampWarm.toFixed(3)}`);
  ok(M.lampHeatKW(w) < 0.05, 'и тепла от него больше нет', `+${M.lampHeatKW(w).toFixed(3)} кВт`);
}

/* ---------- 4. тепло от корпуса реально видно в температуре ---------- */
{
  // два одинаковых мира: в одном лампа горела, в другом нет — после выключения
  // первый остаётся теплее, хотя свет уже не горит
  const build = (lit)=>{
    const w = world(); w.has.panel = true; w.has.led = true;
    w.ctrl.lampEnabled = lit;
    for (let h=0; h<3; h++) M.stepWorld(w, 1);        // три часа с включённой/выключенной лампой
    return w;
  };
  const warmWorld = build(true), coldWorld = build(false);
  warmWorld.ctrl.lampEnabled = false; coldWorld.ctrl.lampEnabled = false;
  for (let m=0; m<20; m++){ M.stepWorld(warmWorld, 1/60); M.stepWorld(coldWorld, 1/60); }
  ok(warmWorld.temp > coldWorld.temp + 0.3, 'остывающий корпус держит теплицу теплее',
     `${warmWorld.temp.toFixed(1)} против ${coldWorld.temp.toFixed(1)} °C`);
}

/* ---------- 5. счётчик не ждёт буфера ---------- */
{
  const w = world(); w.has.panel = true; w.has.led = true;
  const kwh0 = w.energyTotal || 0;
  lampOn(w, true);
  run(w, 2);
  const nominal = M.installedLightKW(w)*2/60;
  ok(w.cost.lamp > 0, 'электричество списывается сразу, хотя свет ещё не в полную силу',
     `статья ${w.cost.lamp.toFixed(4)} € при glow ${w.lampGlow.toFixed(2)}`);
  ok(Math.abs((w.energyTotal-kwh0) - nominal) < nominal*0.25,
     'счётчик считает по номиналу лампы, буфер его не отменяет',
     `${(w.energyTotal-kwh0).toFixed(4)} против ${nominal.toFixed(4)} кВт·ч`);
}

/* ---------- 6. буфер не съедает зимний свет ---------- */
{
  const w = world(); w.has.panel = true; w.has.led = true; w.ctrl.lampEnabled = true;
  for (let d=0; d<2; d++) for (let h=0; h<24; h++){
    w.ctrl.lampEnabled = (w.hour >= 6 && w.hour < 20);
    M.stepWorld(w, 1);
  }
  const D = M.dliInfo(w);
  ok(w.dliYest > 10, 'за сутки с панелью DLI всё равно высокий', `${w.dliYest.toFixed(1)} моль/м²`);
  ok(D.ref >= M.CROPS.tomato.dliMin, 'и вердикт по свету не испорчен', D.verdict);
}

/* ---------- 7. турникет: выключили и сразу включили — тепло не скачет ---------- */
{
  const w = world(); w.has.led = true;
  lampOn(w, true); run(w, 20);
  const warm = w.lampWarm;
  lampOn(w, false); run(w, 1); lampOn(w, true); run(w, 1);
  ok(Math.abs(w.lampWarm - warm) < 0.12, 'короткое мигание не сбрасывает тепло корпуса',
     `${warm.toFixed(2)} → ${w.lampWarm.toFixed(2)}`);
}

/* ---------- 8. старый сейв без новых полей ---------- */
{
  const w = world(); w.has.led = true; lampOn(w, true); run(w, 30);
  const pack = JSON.parse(M.serializeWorld(w));
  delete pack.world.lampGlow; delete pack.world.lampWarm;
  delete pack.world.lampGlowAvg; delete pack.world.lampWarmAvg;
  const back = M.deserializeWorld(JSON.stringify(pack)).world;
  ok(back.lampGlow !== undefined && back.lampWarm !== undefined, 'старый сейв получает поля буфера');
  ok(back.lampGlow === 1 || back.lampGlow === 0, 'и стартует «как было»: лампа либо горит, либо нет', `${back.lampGlow}`);
}

/* ---------- 9. прогноз на клоне мира ---------- */
{
  const w = world(); w.has.led = true; lampOn(w, true);
  const c = M.cloneWorld(w);
  let threw = null;
  try { for (let i=0;i<48;i++) M.stepWorld(c, 0.5); } catch(e){ threw = e.message; }
  ok(!threw, 'копия мира для прогноза считает буфер без ошибок', threw || 'ок');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nБуфер остывания в порядке');
process.exit(fails ? 1 : 0);
