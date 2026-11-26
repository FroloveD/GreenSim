const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1440, height:1000} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?sc='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; startGame(); setPage('settings'); });
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ document.querySelector('#btnCamInv').closest('.card').scrollIntoView({block:'center'}); });
  await page.waitForTimeout(250);
  await cdpShot(page, '/home/user/shots/112_settings_cam.png');
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
