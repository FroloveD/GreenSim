// Один запуск всех автопроверок: node tools/run_all.js
//   --no-browser  только то, что не требует браузера (для CI)
//   --browser-only только браузерные
//   --fast        быстрый набор (без 90-дневных прогонов)
// Сервер на :8080 поднимается сам и гасится в конце.
const { spawn, spawnSync } = require('child_process');
const path = require('path'), http = require('http'), net = require('net');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const NO_BROWSER = args.includes('--no-browser');
const ONLY_BROWSER = args.includes('--browser-only');
const FAST = args.includes('--fast');

const SUITE = [
  { n:'сборка синхронна с parts/*',        f:'tools/test_sync.js',    browser:false },
  { n:'ядро: 12 комбинаций, бухгалтерия, прогноз', f:'tools/test_core.js', browser:false },
  { n:'свет за сутки: DLI и фотопериод', f:'tools/test_dli.js', browser:false },
  { n:'экономика: себестоимость и маржа', f:'tools/test_margin.js', browser:false },
  { n:'питание: рецепты EC/pH по стадиям', f:'tools/test_stage.js', browser:false },
  { n:'рынок: сезон цен и зимнее снаряжение', f:'tools/test_market.js', browser:false },
  { n:'сюжет: главы, ремонт, задания',     f:'tools/test_plot.js',    browser:true },
  { n:'экономика: долг, свет, копейки',    f:'tools/test_econ.js',    browser:true },
  { n:'интерфейс: 90 дней в заглушках DOM', f:'test3_dom.js',         browser:false, slow:true },
  { n:'свет: лента и будильник',           f:'tools/check_light.js',  browser:true },
  { n:'досветка: кнопка и клик по лампе',  f:'tools/check_lamp.js',   browser:true },
  { n:'полив по датчику влаги',            f:'tools/test_water.js',   browser:true },
  { n:'таймеры: свет, полив, CO₂, автопилот', f:'tools/test_auto.js',  browser:true },
  { n:'интерфейс: плашки и неподвижный столбец', f:'tools/test_ui_stable.js', browser:true, slow:true },
  { n:'кнопки, почта, стартовый экран (место/дата)', f:'tools/test_ui_buttons.js', browser:true },
  { n:'деньги: копейки и баки',            f:'tools/check_money.js',  browser:true },
  { n:'CO₂ и задания без оборудования',    f:'tools/check_co2gate.js',browser:true },
  { n:'кампания целиком',                  f:'tools/check_campaign.js', browser:true, slow:true },
  { n:'сохранение и загрузка',             f:'tools/check_save.js',   browser:true },
  { n:'новый сезон',                       f:'tools/check_new.js',    browser:true },
  { n:'шапка: влезает в строку',           f:'tools/check_topfit.js', browser:true },
  { n:'раскладки планшет/телефон',         f:'tools/check_layout.js', browser:true, slow:true }
];

const plan = SUITE.filter(t=> NO_BROWSER ? !t.browser : ONLY_BROWSER ? t.browser : true)
                  .filter(t=> !(FAST && t.slow));
const needBrowser = plan.some(t=>t.browser);

function portBusy(port){
  return new Promise(res=>{
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', ()=>{ s.destroy(); res(true); });
    s.on('error', ()=> res(false));
    setTimeout(()=>{ s.destroy(); res(false); }, 800);
  });
}
function waitHttp(port, ms){
  const t0 = Date.now();
  return new Promise((res, rej)=>{
    const tick = ()=>{
      http.get({host:'127.0.0.1', port, path:'/index.html'}, r=>{ r.resume(); res(true); })
          .on('error', ()=> (Date.now()-t0 > ms) ? rej(new Error('сервер не поднялся')) : setTimeout(tick, 150));
    };
    tick();
  });
}

const FAIL_RE = /❌|ПРОВАЛЕНО|ОШИБКА ВЫПОЛНЕНИЯ|NaN=да/;

(async ()=>{
  let server = null;
  if (needBrowser){
    if (!(await portBusy(8080))){
      server = spawn(process.execPath, [path.join(__dirname,'serve.js')], { cwd: ROOT, stdio:'ignore', env:{...process.env, PORT:'8080'} });
      await waitHttp(8080, 10000).catch(e=>{ console.log('❌ '+e.message); process.exit(1); });
      console.log('поднят локальный сервер :8080');
    } else {
      console.log('порт 8080 уже занят — использую существующий сервер');
    }
  }

  const rows = [];
  let failed = 0;
  for (const t of plan){
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(ROOT, t.f)], { cwd: ROOT, encoding:'utf8', timeout: 240000 });
    const out = (r.stdout||'') + (r.stderr||'');
    const bad = r.status !== 0 || FAIL_RE.test(out);
    if (bad) failed++;
    const tail = out.trim().split('\n').slice(-1)[0] || '';
    const ms = Date.now()-t0;
    rows.push({ n:t.n, ok:!bad, ms, tail: tail.slice(0,90) });
    console.log(`${bad?'❌':'✅'} ${t.n.padEnd(42,' ')} ${String((ms/1000).toFixed(1)).padStart(5)} с  ${tail}`);
    if (bad){
      const lines = out.trim().split('\n').filter(l=>/❌|ПРОВАЛЕНО|ОШИБКА|Error/.test(l)).slice(0,6);
      lines.forEach(l=>console.log('      '+l.trim().slice(0,140)));
    }
  }

  if (server){ server.kill(); }

  const good = rows.filter(r=>r.ok).length;
  const total = rows.reduce((s,r)=>s+r.ms,0)/1000;
  console.log('\n' + '─'.repeat(70));
  console.log(`Итог: ${good}/${rows.length} проверок пройдено · ${total.toFixed(1)} с`);
  if (failed) console.log(`Провалено: ${rows.filter(r=>!r.ok).map(r=>r.n).join(', ')}`);
  process.exit(failed?1:0);
})();
