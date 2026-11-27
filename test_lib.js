// Общий код для тестов экономики и сюжета: загрузка ядра и простой игрок-автомат.
// Используется в test6_economy.js и test7_story.js. Не запускается сам.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a, b) + `
  return {makeWorld, stepWorld, harvestAll, sellHarvest, buyItem, answerMail, pushMail, campaignTick,
          hasLight, setLampState, priceToday, lotQuality, moveChapter, chapterSales, gearLocked, shopPriceFactor, shopItemCost,
          MAILBOX, CHAPTERS, PROFILES, CROPS, MISSIONS, SHOP, GEAR,
          serializeWorld, deserializeWorld, offerContracts, signContract, deliverContract, checkContracts,
          netBuy, netTotal, netTick, homeCO2, craftF, CFG, WH, addLot, lotQuality};`)();

// Ответы игрока-автомата на письма наставника: 1 — «обойтись своими» (без долга), остальное — переезд/принять.
const MAIL_CHOICE = { intro: 1 };

// Один игровой день автомата: досветка, расходники, ремонт, сбор, продажа, ответы на письма.
function autoDay(w) {
  if (M.hasLight(w) && !w.ctrl.lampEnabled) M.setLampState(w, true);
  if (w.stock.fertKg < 25) M.buyItem(w, 'fert100');
  if (w.stock.waterM3 < 10) M.buyItem(w, 'water');
  M.buyItem(w, 'repair');
  M.harvestAll(w);
  const crops = [...new Set(w.wh.lots.map(l => l.crop))];
  for (const c of crops) M.sellHarvest(w, c, null);
  for (const m of [...w.mail]) {
    if (!m.opts || !m.opts.length) continue;
    const idx = MAIL_CHOICE[m.id] !== undefined ? MAIL_CHOICE[m.id] : 0;
    try { M.answerMail(w, m.id, idx); } catch (e) { /* ответ недоступен — оставим письмо */ }
  }
}

// Кампания с автоматом: возвращает журнал переходов по главам.
function runCampaign(maxDays, opts = {}) {
  const w = M.makeWorld({ profile: 'balcony', crop: opts.crop || 'lettuce', seed: opts.seed || 777, campaign: true });
  M.campaignTick(w);
  const chapters = [{ day: 1, ch: w.camp.ch, profile: w.profile }];
  const mailDay = {};
  // письмо считаем пришедшим в день, когда оно впервые появилось в почте или в «отвеченных»
  const noteMail = () => { for (const id of [...w.mail.map(m => m.id), ...w.camp.seen]) if (!(id in mailDay)) mailDay[id] = w.day; };
  noteMail();
  for (let d = 1; d <= maxDays && !w.over; d++) {
    autoDay(w);
    for (let k = 0; k < 48; k++) M.stepWorld(w, 0.5);
    M.campaignTick(w);
    noteMail();
    if (w.camp.ch !== chapters[chapters.length - 1].ch) chapters.push({ day: w.day, ch: w.camp.ch, profile: w.profile });
  }
  return { w, chapters, mailDay };
}

// Прогон без сюжета: тот же автомат, фиксированный профиль, сезон 90 дней (для экономики).
function runSeason(profile, crop, days = 90, seed = 777) {
  const w = M.makeWorld({ profile, crop, seed });
  const start = w.money;
  for (let d = 1; d <= days && !w.over; d++) {
    autoDay(w);
    for (let k = 0; k < 48; k++) M.stepWorld(w, 0.5);
  }
  return { w, profit: w.money - start };
}

module.exports = { M, autoDay, runCampaign, runSeason };
