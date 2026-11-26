const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1400, height:940} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?sys='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1) выбор системы на старте, свободный сезон
  await page.evaluate(()=>{ pending.campaign=false; buildStart(); });
  const cards = await page.evaluate(()=>[...document.querySelectorAll('#sysPick .card')].map(c=>c.dataset.sys + (c.style.opacity?':'+'' :'')));
  console.log('карточки систем:', cards.join(','));

  // 2) гидропоника в свободном сезоне: сравнение урожая с грунтом
  const cmp = await page.evaluate(async()=>{
    const run = (sys)=>{
      const w = makeWorld({profile:'room', crop:'tomato', weather:'normal', difficulty:'normal', sys});
      w.camp = null;
      let water=0, fert=0, kg=0, dsum=0;
      for (let d=0; d<60; d++){
        for (let k=0;k<24;k++) stepWorld(w, 1);
        water += w.useWaterM3||0; fert += w.useFertKg||0; dsum += w.disease;
        const r = harvestAll(w); kg += r.kg||0;
      }
      return {sys:sysOf(w).short, kg:+kg.toFixed(1), water:+water.toFixed(2), fert:+fert.toFixed(2),
              diseaseAvg:+(dsum/60*100).toFixed(1), money:Math.round(w.money)};
    };
    return ['soil','coco','dwc','nft','aero'].map(run);
  });
  console.log('60 дней, комната, томат:'); cmp.forEach(r=>console.log('  ', JSON.stringify(r)));

  // 3) старт на DWC и вид сцены
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='room'; pending.crop='tomato'; pending.sys='dwc'; startGame();
    for(let d=0;d<25;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(600);
  console.log('система в мире:', await page.evaluate(()=>world.sys), '| профиль в шапке:', await page.evaluate(()=>document.getElementById('tProfile').textContent));
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/102_dwc_room.png'); await page.evaluate(()=>VG.freeze(false));

  await page.evaluate(()=>{ pending.campaign=false; pending.profile='balcony'; pending.crop='lettuce'; pending.sys='soil'; startGame();
    for(let d=0;d<18;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(500);
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/103_soil_balcony.png'); await page.evaluate(()=>VG.freeze(false));

  // 4) смена системы в «Параметрах»
  const sw = await page.evaluate(()=>{ const r = setGrowSys(world,'coco'); renderSettings();
    return {msg:r.msg, sys:world.sys, locked: setGrowSys(world,'aero').msg}; });
  console.log('переключение:', JSON.stringify(sw));
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
