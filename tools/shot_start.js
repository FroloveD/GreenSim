const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  await page.goto('http://localhost:8080/index.html?g='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  await page.evaluate(()=>{ pending.campaign=true; buildStart(); });
  await page.waitForTimeout(200);
  await cdpShot(page, shotFile('80_start_campaign.png'));
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; buildStart(); });
  await page.waitForTimeout(200);
  await cdpShot(page, shotFile('87_start_free.png'));
  console.log('ок');
  await browser.close();
})();
