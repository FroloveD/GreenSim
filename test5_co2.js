// Клапан CO₂: покупной, без него воздух держится на комнатном уровне.
// Запуск: node test5_co2.js  (из корня репозитория)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a, b) + `
  return {makeWorld, stepWorld, buyItem, SHOP, MISSIONS, riskTick, homeCO2};`)();

let fails = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fails++;
};
const world = (profile = 'hobby') => {
  const w = M.makeWorld({ profile, crop: 'tomato', seed: 777 });
  w.hour = 6; return w;
};
const item = (w, id) => {
  for (const g of M.SHOP()) for (const it of g.items) if (it.id === id) return it;
  return null;
};

// 1. на старте клапана нет во всех профилях
for (const p of ['balcony', 'room', 'farm', 'hobby', 'agro']) {
  const w = world(p);
  check(`старт ${p}: клапана нет`, w.has.co2 === false);
}

// 2. без клапана: домашний воздух 600 ppm днём, 800 ppm ночью, и уставка не работает
{
  const w = world('room'); w.ctrl.co2Set = 800; w.stock.co2Kg = 100;
  const day = [], night = [];
  for (let i = 0; i < 24 * 14 * 2; i++) {              // 14 дней шагами по 0.5 ч
    M.stepWorld(w, 0.5);
    if (w.hour >= 12 && w.hour <= 14) day.push(w.co2);
    if (w.hour >= 0 && w.hour <= 1) night.push(w.co2);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const dMin = Math.min(...day), dMax = Math.max(...day);
  const nMin = Math.min(...night), nMax = Math.max(...night);
  check('без клапана днём CO₂ около 600 ppm', dMin > 595 && dMax < 615, `день ${dMin.toFixed(0)}–${dMax.toFixed(0)} ppm`);
  check('без клапана ночью CO₂ около 800 ppm', nMin > 770 && nMax < 805, `ночь ${nMin.toFixed(0)}–${nMax.toFixed(0)} ppm`);
  check('уставка 800 без клапана не влияет на воздух', avg(night) < 810 && avg(day) < 650);
  check('газ из баллонов не расходуется без клапана', w.stock.co2Kg === 100, `запас=${w.stock.co2Kg}`);
  check('домашний уровень плавно меняется по часам', M.homeCO2(13) === 600 && M.homeCO2(1) === 800);
}

// 3. покупка клапана: один раз, стоит денег
{
  const w = world('hobby'); const before = w.money;
  const r1 = M.buyItem(w, 'co2valve');
  check('клапан покупается', r1.ok && w.has.co2 === true, r1.msg);
  check('клапан списывает деньги', w.money < before, `−${(before - w.money).toFixed(0)} €`);
  const r2 = M.buyItem(w, 'co2valve');
  check('повторно не покупается', !r2.ok);
}

// 4. баллоны с CO₂ только с клапаном
{
  const w = world('hobby'); w.money = 10000;
  check('баллоны без клапана недоступны', M.buyItem(w, 'co2_50').ok === false);
  M.buyItem(w, 'co2valve');
  const before = w.stock.co2Kg;
  check('баллоны с клапаном покупаются', M.buyItem(w, 'co2_50').ok === true && w.stock.co2Kg > before);
}

// 5. с клапаном и уставкой 800 CO₂ действительно поднимается
{
  const w = world('hobby'); w.money = 10000; M.buyItem(w, 'co2valve'); M.buyItem(w, 'co2_200');
  w.ctrl.co2Set = 800; w.ctrl.ventSet = 40;           // проветривание не мешает подаче
  for (let i = 0; i < 24 * 2; i++) M.stepWorld(w, 0.5);
  check('с клапаном CO₂ растёт к уставке', w.co2 > 600, `сейчас ${w.co2.toFixed(0)} ppm`);
}

// 6. клапан без покупки не ломается (отказы считаются только по установленному)
{
  const w = world('room'); w.diffFail = 50;            // завышенная частота отказов, чтобы проверка была строгой
  for (let i = 0; i < 24 * 60 * 2; i++) M.stepWorld(w, 0.5);
  const co2Events = (w.events || []).filter(e => e.equip === 'co2').length;
  const co2Log = (w.log || []).filter(l => /Клапан CO₂/.test(l.m)).length;
  check('непокупленный клапан не отказывает', w.equip.co2.ok === true && co2Events === 0 && co2Log === 0,
        `ok=${w.equip.co2.ok}, событий=${co2Events}`);
}

// 7. задание про CO₂ пропускается, пока нет клапана, и не застревает
{
  const w = world('room');
  M.stepWorld(w, 0.5);
  const cur = M.MISSIONS[w.missionIdx];
  check('задание про клапан пропущено без клапана', !cur || cur.id !== 'm1', cur ? `сейчас ${cur.id}` : 'заданий больше нет');
  const w2 = world('hobby'); M.buyItem(w2, 'co2valve');
  M.stepWorld(w2, 0.5);
  const cur2 = M.MISSIONS[w2.missionIdx];
  check('с клапаном задание про CO₂ показывается', cur2 && cur2.id === 'm1', cur2 && cur2.id);
}

console.log(fails ? `\nпровалено: ${fails}` : '\nвсе проверки клапана CO₂ прошли');
process.exit(fails ? 1 : 0);
