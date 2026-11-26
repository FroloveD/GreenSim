// Проверка экономики: цены, крафт, продажи, склад, займы, контракты, бухгалтерия, сезонная прибыль.
// Запуск: node test6_economy.js  (из корня репозитория)
const L = require('./test_lib.js');
const { M, runSeason, autoDay } = L;

let fails = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fails++;
};
const near = (x, y, tol) => Math.abs(x - y) <= tol;

// 1. Цена за кг: базовая × множитель профиля × рынок × крафт
{
  const bal = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 1 });
  const room = M.makeWorld({ profile: 'room', crop: 'lettuce', seed: 1 });
  bal.market.mult.lettuce = 1; room.market.mult.lettuce = 1;
  const pBal = M.priceToday(bal, 'lettuce'), pRoom = M.priceToday(room, 'lettuce');
  check('салат с балкона дороже салата из комнаты (крафт)', pBal > pRoom, `${pBal.toFixed(2)} > ${pRoom.toFixed(2)} €/кг`);
  check('крафт ×1.5 только у салата на балконе', near(pBal, 2.9 * 6.5 * 1.5, 1e-6), `= ${pBal.toFixed(2)} €/кг`);
  const tBal = M.priceToday(bal, 'tomato');
  check('томат на балконе без крафта', near(tBal, 1.7 * 6.5, 1e-6), `= ${tBal.toFixed(2)} €/кг`);
  check('крафт не действует в комнате', M.craftF(room, 'lettuce') === 1);
}

// 2. Продажа по цене: выручка = кг × цена × качество партии
{
  const w = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 2 });
  w.market.mult.lettuce = 1;
  M.addLot(w, 'lettuce', 10, 1);
  const r = M.sellHarvest(w, 'lettuce', null);
  const expect = 10 * M.priceToday(w, 'lettuce');
  check('продажа салата на балконе по цене с крафтом', near(r.eur, expect, expect * 0.01),
        `получено ${r.eur.toFixed(1)} €, ожидалось ${expect.toFixed(1)} €`);
}

// 3. Рынок: множитель остаётся в пределах, цена не уходит в ноль
{
  const w = M.makeWorld({ profile: 'farm', crop: 'tomato', seed: 3 });
  let lo = 9, hi = 0;
  for (let d = 0; d < 365; d++) {
    for (let k = 0; k < 24; k++) M.stepWorld(w, 1);      // только время, без растений
    for (const c of ['tomato', 'cherry', 'cucumber', 'lettuce']) {
      const m = w.market.mult[c]; lo = Math.min(lo, m); hi = Math.max(hi, m);
    }
  }
  check('рыночный множитель в коридоре 0.72…1.62', lo >= 0.72 - 1e-9 && hi <= 1.62 + 1e-9, `min ${lo.toFixed(2)}, max ${hi.toFixed(2)}`);
}

// 4. Склад: качество падает с возрастом партии, старое продаётся дешевле
{
  const fresh = { q: 1, age: 0, shelf: 12 }, old = { q: 1, age: 12, shelf: 12 };
  check('свежая партия лучше старой', M.lotQuality(fresh) > M.lotQuality(old),
        `${M.lotQuality(fresh).toFixed(2)} > ${M.lotQuality(old).toFixed(2)}`);
  check('качество не падает ниже 0.35', M.lotQuality({ q: 1, age: 999, shelf: 1 }) >= 0.35 - 1e-9);
}

// 5. Бухгалтерия: деньги = старт + выручка − все расходы (до копейки)
{
  const { w } = runSeason('hobby', 'tomato', 90, 777);
  const costs = Object.values(w.cost).reduce((s, x) => s + x, 0);
  const lhs = w.money - w.startMoney;
  const rhs = w.revenue - costs;
  check('баланс сходится: Δденег = выручка − расходы', near(lhs, rhs, 0.5), `Δ=${lhs.toFixed(1)}, выручка−расходы=${rhs.toFixed(1)}`);
}

// 6. Займ: проценты 8% годовых, не попадают в выручку и в продажи
{
  const w = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 4 });
  w.money += 300; w.loan += 300;
  const sales0 = w.soldEur || 0, money0 = w.money, cost0 = w.cost.loan;
  for (let d = 0; d < 9; d++) M.stepWorld(w, 24 - w.hour + 0.001 + 0); // 9 суток
  const interest = w.cost.loan - cost0;
  const expect = 300 * 0.08 / 90 * 9;
  check('проценты по займу 8% годовых', near(interest, expect, expect * 0.05), `${interest.toFixed(2)} € за 9 дней, ожидалось ${expect.toFixed(2)}`);
  check('займ не считается продажами', (w.soldEur || 0) === sales0);
}

// 7. Контракты: сорванный срок даёт штраф 400 €
{
  const w = M.makeWorld({ profile: 'hobby', crop: 'tomato', seed: 5 });
  w.plantScale = 1;
  const offers = M.offerContracts(w);
  M.signContract(w, 0);
  const ct = w.contracts[0];
  w.day = ct.deadline + 1;
  const money0 = w.money;
  M.checkContracts(w);
  check('просроченный контракт штрафуется 400 €', near(money0 - w.money, 400, 1e-6), `−${(money0 - w.money).toFixed(0)} €`);
  check('контракт помечен сорванным', ct.failed === true && ct.done === true);
}

// 8. Сезонная прибыль по профилям (автомат, 90 дней). Коридоры — регрессионные, не «истина».
const bands = [
  ['hobby',  'tomato',   4000, 9000],
  ['farm',   'tomato',   6000, 14000],
  ['agro',   'tomato',   6000, 16000],
  ['hobby',  'lettuce',  2500, 7000],
  ['farm',   'lettuce',  4000, 10000],
  ['agro',   'cherry',   6000, 16000],
];
for (const [p, c, lo, hi] of bands) {
  const { profit, w } = runSeason(p, c, 90);
  check(`прибыль ${p}/${c} в коридоре ${lo}…${hi} €`, profit >= lo && profit <= hi,
        `${profit.toFixed(0)} € (${(w.harvestedKg / w.area).toFixed(1)} кг/м²)`);
}

// 9. Огурец — тонкая маржа: прибыль с м² ниже томата на той же площади (дизайн, см. handoff)
{
  const t = runSeason('farm', 'tomato', 90).profit, cu = runSeason('farm', 'cucumber', 90).profit;
  check('огурец даёт меньше томата на ферме', cu < t, `огурец ${cu.toFixed(0)} € < томат ${t.toFixed(0)} €`);
}

console.log(fails ? `\nпровалено: ${fails}` : '\nвсе проверки экономики прошли');
process.exit(fails ? 1 : 0);
