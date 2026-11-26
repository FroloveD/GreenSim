// Досветка: ручное включение, будильник-напоминание, миграция сохранений.
// Запуск: node test4_lamp.js  (из корня репозитория)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a, b) + `
  return {makeWorld, stepWorld, buyItem, toggleLamp, setLampAlarm, setLampState,
          pendingLampAlert, dismissLampAlert, hasLight, clockHM, serializeWorld, deserializeWorld};`)();

let fails = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fails++;
};
// шаг по часам: dtH = 0.25 (как при обычной скорости симуляции)
const fresh = (opts = {}) => {
  const w = M.makeWorld({ profile: 'hobby', crop: 'tomato', seed: 777, ...opts });
  w.hour = 0; w.day = 1; return w;
};

// 1. без досветки: кнопка не включает, сообщение понятное
{
  const w = fresh();
  const r = M.toggleLamp(w);
  check('без LED и ленты включить нельзя', !r.ok && !w.ctrl.lampEnabled, r.msg);
  check('hasLight = false на старте', M.hasLight(w) === false);
}

// 2. лента считается досветкой (это и был баг: интерфейс смотрел только на LED)
{
  const w = fresh(); w.has.ledStrip = true;
  check('лента считается досветкой', M.hasLight(w) === true);
  const r = M.toggleLamp(w);
  check('с лентой досветка включается', r.ok && w.ctrl.lampEnabled === true, r.msg);
  M.stepWorld(w, 0.25);
  check('лента реально горит (ctrl.lampOn)', w.ctrl.lampOn === true);
  M.toggleLamp(w);
  check('и выключается вручную', w.ctrl.lampEnabled === false);
}

// 3. ручной режим: нет автоматического расписания 4:30–21:00
{
  const w = fresh(); w.has.led = true; w.ctrl.lampEnabled = true;
  w.hour = 2; M.stepWorld(w, 0.25);
  check('ночью при включённой досветке она горит (без расписания)', w.ctrl.lampOn === true);
  w.ctrl.lampEnabled = false; w.hour = 12; M.stepWorld(w, 0.25);
  check('выключенная досветка днём не горит', w.ctrl.lampOn === false);
}

// 4. будильник срабатывает на пересечении времени и говорит, что делать
{
  const w = fresh(); w.has.led = true; w.ctrl.lampEnabled = false;
  w.hour = 4.0;
  for (let i = 0; i < 4; i++) M.stepWorld(w, 0.25);   // 4.0 → 5.0 пересекает 4:30
  const p = M.pendingLampAlert(w);
  check('будильник «включить» в 04:30 сработал', !!p && p.action === 'on' && p.at === '04:30', p && p.text);
  check('сам свет будильник не включил', w.ctrl.lampEnabled === false);
  M.dismissLampAlert(w);
  check('«Понятно» убирает алерт', M.pendingLampAlert(w) === null);
}

// 5. если досветка уже включена — не беспокоим
{
  const w = fresh(); w.has.led = true; w.ctrl.lampEnabled = true;
  w.hour = 4.0;
  for (let i = 0; i < 4; i++) M.stepWorld(w, 0.25);
  check('при включённой досветке «включить» не напоминает', M.pendingLampAlert(w) === null);
}

// 6. вечерний будильник «выключить» в 21:00
{
  const w = fresh(); w.has.led = true; w.ctrl.lampEnabled = true;
  w.hour = 20.5;
  for (let i = 0; i < 4; i++) M.stepWorld(w, 0.25);   // 20.5 → 21.5
  const p = M.pendingLampAlert(w);
  check('будильник «выключить» в 21:00 сработал', !!p && p.action === 'off' && p.at === '21:00', p && p.text);
  M.toggleLamp(w);   // игрок выключил сам — алерт больше не актуален
  check('после ручного выключения алерт снят', M.pendingLampAlert(w) === null);
}

// 7. выключенный будильник молчит; без света будильника нет
{
  const w = fresh(); w.has.led = true; w.ctrl.lampEnabled = false;
  M.setLampAlarm(w, 'on', { on: false, h: 4.5 });
  w.hour = 4.0; for (let i = 0; i < 4; i++) M.stepWorld(w, 0.25);
  check('выключенный будильник не срабатывает', M.pendingLampAlert(w) === null);

  const w2 = fresh(); w2.hour = 4.0; for (let i = 0; i < 4; i++) M.stepWorld(w2, 0.25);
  check('без досветки будильник не срабатывает', M.pendingLampAlert(w2) === null);
}

// 8. в прогнозе будильник не работает
{
  const w = fresh(); w.has.led = true; w.forecast = true; w.hour = 4.0;
  for (let i = 0; i < 4; i++) M.stepWorld(w, 0.25);
  check('в прогнозе алертов нет', (w.alerts || []).length === 0);
}

// 9. валидация времени будильника
{
  const w = fresh();
  check('часы 25 отклоняются', M.setLampAlarm(w, 'on', { on: true, h: 25 }).ok === false);
  check('отрицательные отклоняются', M.setLampAlarm(w, 'on', { on: true, h: -1 }).ok === false);
  M.setLampAlarm(w, 'on', { on: true, h: 4 + 17/60 });
  check('минуты округляются до 15', w.lampAlarm.on.h === 4.25, String(w.lampAlarm.on.h));
  check('clockHM', M.clockHM(4.5) === '04:30' && M.clockHM(21) === '21:00' && M.clockHM(23.999) === '00:00');
}

// 10. миграция старого сохранения: без lampAlarm и alerts
{
  const w = fresh(); w.has.led = true;
  const pack = JSON.parse(M.serializeWorld(w));
  delete pack.world.lampAlarm; delete pack.world.alerts;
  const back = M.deserializeWorld(JSON.stringify(pack));
  check('старое сохранение получает будильник по умолчанию',
        back.world.lampAlarm && back.world.lampAlarm.on.h === 4.5 && back.world.lampAlarm.off.h === 21);
  check('и пустую очередь алертов', Array.isArray(back.world.alerts) && back.world.alerts.length === 0);
}

// 11. стоимость: досветка тратит энергию только когда горит
{
  const off = fresh(); off.has.led = true; off.ctrl.lampEnabled = false;
  const on = fresh(); on.has.led = true; on.ctrl.lampEnabled = true;
  for (let i = 0; i < 40; i++) { M.stepWorld(off, 0.25); M.stepWorld(on, 0.25); }
  check('энергия досветки считается только при включении', (off.cost.lamp || 0) === 0 && (on.cost.lamp || 0) > 0,
        `выкл=${(off.cost.lamp||0).toFixed(2)} вкл=${(on.cost.lamp||0).toFixed(2)}`);
}

console.log(fails ? `\nпровалено: ${fails}` : '\nвсе проверки досветки прошли');
process.exit(fails ? 1 : 0);
