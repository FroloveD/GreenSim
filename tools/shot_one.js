const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  page.on('pageerror',e=>console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8080/index.html?q='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame();
    answerMail(world,'intro',0);
    for(let d=0;d<45;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); renderAll(); });
  await page.waitForTimeout(700);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, shotFile('71_balcony.png'));
  console.log('ок');
  await browser.close();
})();
