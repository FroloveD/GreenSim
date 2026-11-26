// Коммунальные счета за свет и тепло — без браузера.
// 1) электричество и тепло не списываются каждый час, а копятся в счётчик;
// 2) счёт приходит по календарю (1 янв/апр/июл/окт) и закрывающий — в конце сезона;
// 3) пени 0,1% в день; 4 квартала просрочки — суд и судебные издержки, но ничего не отключают;
// 4) 8 кварталов — банкротство с распродажей и остатком на руки;
// 5) оплата, неоплата, перенос долга в следующий сезон и старый сейв.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,sellHarvest,
          UTIL,utilInit,utilBill,utilAccrued,utilAccruedKWh,utilDebt,utilPenaltyRate,utilTickDay,
          utilOldest,utilOverdueDays,utilQuartersOverdue,payUtil,bankruptSalvage,
          carrySnapshot,applyCarry,serializeWorld,deserializeWorld,lightLit,dliInfo};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

const mk = (o={})=>{
  const w = M.makeWorld(Object.assign({profile:'farm', crop:'tomato', seed:31, site:'ekb', startDoy:91}, o));
  w.money = 20000; w.stock.waterM3 = 50; w.stock.fertKg = 50;
  return w;
};

/* ---------- 1. почасового списания больше нет ---------- */
{
  const w = mk();
  w.has.led = true; w.ctrl.lampEnabled = true;
  M.stepWorld(w, 1); M.stepWorld(w, 1);          // лампа разогрелась, полночь не перешли
  const m0 = w.money, lamp0 = w.cost.lamp + w.cost.energy, kwh0 = M.utilAccruedKWh(w);
  M.stepWorld(w, 1);                             // ровно один час
  const dMoney = m0 - w.money;
  const dAccrued = (w.cost.lamp + w.cost.energy) - lamp0;
  const dKwh = M.utilAccruedKWh(w) - kwh0;
  ok(dKwh > 2, 'счётчик света и тепла крутится', `${Math.round(dKwh)} кВт·ч за час`);
  ok(dAccrued > 0.2, 'начислено в расходы', `${dAccrued.toFixed(3)} €`);
  ok(dMoney < dAccrued*0.5, 'но из кошелька за это не списали — ушёл только газ CO₂ и мелочи',
     `ушло ${dMoney.toFixed(3)} € при начисленных ${dAccrued.toFixed(3)} €`);
  ok(M.utilDebt(w) === 0, 'долга ещё нет: счёт не выставлен');
  ok(M.utilAccrued(w) > 0, 'накопленное видно в «Экономике»', M.utilAccrued(w).toFixed(2) + ' €');
}

/* ---------- 2. счёт по календарю ---------- */
{
  // старт 20 марта (дой 79): 1 апреля (дой 91) должен прийти счёт
  const w = mk({startDoy:79});
  for (let d=0; d<14; d++) for (let k=0;k<24;k++) M.stepWorld(w, 1);
  const u = M.utilInit(w);
  ok(u.bills.length >= 1, 'на 1 апреля пришёл счёт', `${u.bills.length} шт, день ${w.day}, дой ${w.doy}`);
  const bl = u.bills[0];
  ok(bl && bl.kind === 'за квартал', 'это обычный квартальный счёт', bl && bl.kind);
  ok(bl && bl.eur > 1, 'в счёте есть сумма', bl && `${bl.eur} € за ${Math.round(bl.kwh)} кВт·ч`);
  ok(M.utilAccruedKWh(w) < bl.kwh, 'после выставления счётчик начал копиться заново');
  ok(M.UTIL.billDoy.join(',') === '1,91,182,274', 'даты кварталов — 1 января, апреля, июля, октября',
     M.UTIL.billDoy.join(', '));
}

/* ---------- 3. закрывающий счёт в конце сезона ---------- */
{
  const w = mk();
  let guard = 0;
  while (!w.over && guard++ < 200) for (let k=0;k<24;k++) M.stepWorld(w, 1);
  const u = M.utilInit(w);
  ok(w.over, 'сезон закончился', `день ${w.day}`);
  ok(u.bills.some(x=>x.kind === 'закрывающий'), 'игрок получил закрывающий счёт',
     u.bills.map(x=>x.kind+':'+x.eur.toFixed(1)).join(' · '));
  ok(M.utilDebt(w) > 100, 'за квартал набежала заметная сумма', `${Math.round(M.utilDebt(w))} €`);
}

/* ---------- 4. пени и суд ---------- */
{
  const w = mk();
  w.util = M.utilInit(w);
  w.util.qKwhLamp = 10000;                   // 1100 € на счётчик
  const bill = M.utilBill(w, 'за квартал');
  ok(bill && bill.eur > 1000, 'счёт выставлен', bill.eur + ' €');
  const eur = bill.eur;
  for (let d=0; d<90; d++) M.utilTickDay(w);
  const day90 = M.utilDebt(w);
  ok(Math.abs(day90 - eur*1.09) < 2, 'за квартал пеней набежало ~9%', `${day90.toFixed(1)} против ${(eur*1.09).toFixed(1)}`);
  ok(M.utilOverdueDays(w) === 90 && M.utilQuartersOverdue(w) === 1, 'возраст счёта считается в днях и кварталах');
  ok(w.util.courts === 0, 'до четвёртого квартала суда нет');

  for (let d=0; d<270; d++) M.utilTickDay(w);   // всего 360 дней
  ok(w.util.courts === 1, 'на четвёртом квартале пришёл суд', `судов ${w.util.courts}`);
  const fine = w.util.bills.find(x=>x.kind === 'судебные издержки');
  ok(fine && fine.eur >= 40, 'судебные издержки в счёте', fine && fine.eur + ' €');
  ok(w.cost.penalty > 0, 'пени и издержки попали в расходы', w.cost.penalty.toFixed(1) + ' €');
  ok(!w.over, 'суд не заканчивает игру');
  // ничего не отключили
  w.ctrl.lampEnabled = true; M.stepWorld(w, 1);
  ok(M.lightLit(w), 'свет работает: за неуплату его не отключают');
  ok(w.equip.lamp.ok && w.equip.heater.ok, 'оборудование не описали');
  for (let d=0; d<5; d++) M.utilTickDay(w);
  ok(w.util.courts === 1, 'суд по одному счёту бывает только раз');
}

/* ---------- 5. банкротство на восьмом квартале ---------- */
{
  const w = mk();
  w.util = M.utilInit(w);
  w.util.qKwhLamp = 20000;
  M.utilBill(w, 'за квартал');
  w.wh.lots.push({crop:'tomato', day:w.day, age:0, shelf:12, kg:500, q:1});
  w.cost.upgrade = 3000;
  for (let d=0; d<719; d++) M.utilTickDay(w);
  ok(!w.over && !w.util.bankrupt, 'на 719-й день просрочки банкротства ещё нет');
  M.utilTickDay(w);
  ok(!!w.util.bankrupt, 'на 720-й (8 кварталов) — банкротство');
  ok(w.over, 'сезон закончен');
  const salvage = M.bankruptSalvage(w);
  ok(salvage > 0, 'после распродажи остаётся остаток на руки', salvage + ' €');
  const before = w.money;
  M.stepWorld(w, 5);
  ok(w.money === before, 'после банкротства мир дальше не живёт');
}

/* ---------- 6. оплата ---------- */
{
  const w = mk();
  w.util = M.utilInit(w);
  w.util.qKwhLamp = 5000;
  const bill = M.utilBill(w, 'за квартал');
  for (let d=0; d<10; d++) M.utilTickDay(w);
  const debt = M.utilDebt(w);
  ok(debt > bill.eur, 'долг больше счёта: сверху пени', `${debt.toFixed(1)} против ${bill.eur}`);
  const m0 = w.money;
  const r = M.payUtil(w);
  ok(r.ok, 'оплата проходит', r.msg);
  ok(Math.abs((m0 - w.money) - debt) < 0.02, 'списалась ровно сумма счёта', `${(m0-w.money).toFixed(2)} против ${debt.toFixed(2)}`);
  ok(M.utilDebt(w) === 0, 'долг закрыт');
  ok(w.util.bills.every(x=>x.paid), 'все счета помечены оплаченными');
  ok(!M.payUtil(w).ok, 'второй раз платить нечего');

  // без денег — отказ, долг на месте
  w.util.qKwhLamp = 5000; M.utilBill(w, 'за квартал');
  w.money = 1;
  const r2 = M.payUtil(w);
  ok(!r2.ok && M.utilDebt(w) > 0, 'без денег оплата отклонена, счёт остаётся', r2.msg);
  ok(w.money === 1, 'и кошелёк не тронут');
}

/* ---------- 7. долг переезжает в следующий сезон ---------- */
{
  const w = mk();
  w.util = M.utilInit(w);
  w.util.qKwhLamp = 4000; M.utilBill(w, 'за квартал');
  for (let d=0; d<30; d++) M.utilTickDay(w);
  const debt = M.utilDebt(w);
  const carry = M.carrySnapshot(w);
  const w2 = M.makeWorld({profile:'farm', crop:'tomato', seed:99, startDoy:181, carry});
  ok(M.utilDebt(w2) > 0, 'неоплаченный счёт переехал в новый сезон', `${M.utilDebt(w2).toFixed(1)} €`);
  ok(Math.abs(M.utilDebt(w2) - debt) < 0.05, 'сумма та же', `${M.utilDebt(w2).toFixed(2)} против ${debt.toFixed(2)}`);
  ok(M.utilOverdueDays(w2) >= 30, 'и возраст счёта не сбросился', `${M.utilOverdueDays(w2)} дн`);
}

/* ---------- 8. старый сейв ---------- */
{
  const w = mk();
  M.stepWorld(w, 3);
  const pack = JSON.parse(M.serializeWorld(w));
  delete pack.world.util;
  const back = M.deserializeWorld(JSON.stringify(pack)).world;
  ok(back.util && Array.isArray(back.util.bills), 'старый сейв получает пустой счётчик');
  ok(M.utilAccrued(back) === 0 && M.utilDebt(back) === 0, 'и никакого выдуманного долга', '0 €');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nКоммунальные счета в порядке');
process.exit(fails ? 1 : 0);
