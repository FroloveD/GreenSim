const { launch } = require('./browser');
(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?cg='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1. балкон кампании: клапана нет, отказов клапана нет, миссии про CO2 пропущены
  const camp = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    for (let d=0; d<40; d++){ for (let k=0;k<24;k++) VG.sim(1); }
    renderAll();
    const logText = world.log.map(l=>l.m).join(' | ');
    return { hasCo2: world.has.co2, equipOk: world.equip.co2.ok,
             co2InLog: /Клапан CO₂/.test(logText),
             alerts: document.getElementById('alerts').textContent,
             mission: MISSIONS[world.missionIdx] && MISSIONS[world.missionIdx].id,
             missionIdx: world.missionIdx,
             stockCo2: +world.stock.co2Kg.toFixed(1) };
  });
  console.log('балкон:', JSON.stringify(camp));
  console.log('  клапан отсутствует:', camp.hasCo2===false ? '✅' : '❌',
              '· отказов клапана нет:', camp.co2InLog?'❌ в логе':'✅',
              '· задание сдвинуто:', camp.mission!=='m1'?'✅ '+camp.mission:'❌ всё ещё m1');

  // 2. в шапке не должно быть сырого кода
  const season = await page.evaluate(()=>document.getElementById('tSeason').textContent);
  console.log('подпись сезона в шапке:', JSON.stringify(season), /world\.|'\+/.test(season)?'❌ сырой код':'✅');

  // 3. настройки: вместо слайдера CO2 — пояснение
  await page.evaluate(()=>setPage('settings'));
  await page.waitForTimeout(300);
  const set = await page.evaluate(()=>({ slider: !!document.getElementById('s_co2'),
    hint: (document.querySelector('#settingsBody').textContent.match(/На балконе и в комнате клапана нет[^.]*\./)||[''])[0] }));
  console.log('параметры:', JSON.stringify(set), set.slider?'❌ слайдер есть':'✅ слайдера нет');

  // 4. в теплице клапан есть и ломается
  const farm = await page.evaluate(()=>{
    setPage('greenhouse');
    pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    let broke = false;
    for (let d=0; d<200 && !broke; d++){ for (let k=0;k<24;k++) VG.sim(1); broke = !world.equip.co2.ok; }
    if (!broke){ world.equip.co2.ok = false; world.events.push({kind:'breakdown', equip:'co2', days:0}); }
    renderAll();
    return { has: world.has.co2, alert: document.getElementById('alerts').textContent.includes('Клапан CO₂') };
  });
  console.log('теплица:', JSON.stringify(farm), farm.has && farm.alert ? '✅ клапан есть и попадает в риски' : '❌');

  // 5. задание про досветку выполнимо через LED-ленту (глава 0)
  const lamp = await page.evaluate(()=>{
    pending.campaign=false; pending.profile='balcony'; pending.crop='tomato'; startGame();
    world.missionIdx = MISSIONS.findIndex(m=>m.id==='m2');
    world.has.ledStrip = true; world.ctrl.lampEnabled = true;
    missionsTick(world);
    return { idx: world.missionIdx, done: world.missionIdx > MISSIONS.findIndex(m=>m.id==='m2') };
  });
  console.log('задание «досветка» с LED-лентой:', JSON.stringify(lamp), lamp.done?'✅ засчитано':'❌ не засчитано');

  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
