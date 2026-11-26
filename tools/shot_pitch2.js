const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  // телефон
  let page = await b.newPage({ viewport:{width:390, height:844} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?sp2='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='room'; pending.crop='tomato'; startGame();
    for(let d=0;d<20;d++){ for(let k=0;k<24;k++) VG.sim(1); }
    cam.pitch=-0.45; camTween=null; cam.mode='free'; renderAll(); });
  await page.waitForTimeout(400);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, shotFile('111_phone_look_up.png'));
  await page.evaluate(()=>VG.freeze(false));
  console.log('телефон вверх:', JSON.stringify(await page.evaluate(()=>{const v=buildView();
    return {pitch:+v.pitch.toFixed(2), camY:+(v.target.y+v.dist*Math.sin(v.pitch)).toFixed(2), W, H};})));
  await page.close();

  // настройки: карточка «Камера»
  page = await b.newPage({ viewport:{width:1440, height:1000} });
  page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?sp3='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; startGame(); setPage('settings'); });
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ const c=document.querySelector('#btnCamInv').closest('.card'); c.scrollIntoView({block:'center'}); });
  await page.waitForTimeout(200);
  await cdpShot(page, shotFile('112_settings_cam.png'));
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
