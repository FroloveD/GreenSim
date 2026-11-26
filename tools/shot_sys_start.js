const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1400, height:1000} });
  await page.goto('http://localhost:8080/index.html?ss='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=true; buildStart(); });
  await page.waitForTimeout(200);
  await page.evaluate(()=>{ const el=document.getElementById('sysPick'); el.scrollIntoView({block:'center'}); });
  await page.waitForTimeout(200);
  await cdpShot(page, shotFile('104_start_sys.png'));
  console.log('ок:', await page.evaluate(()=>document.querySelectorAll('#sysPick .card').length));
  await b.close();
})();
