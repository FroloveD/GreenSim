const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { shotFile } = require('./paths');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  const resp = await page.goto('http://localhost:8080/', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  const title = await page.title();
  await page.click('#startBtn');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(()=>({day:window.VG.world.day, plants:window.VG.world.plants.length,
     canvas:[document.getElementById('scene').width, document.getElementById('scene').height],
     hour:document.getElementById('tHour').textContent, money:document.getElementById('tMoney').textContent}));
  await page.screenshot({path:shotFile('40_preview_root.png')});
  console.log('HTTP', resp.status(), '| title:', title, '|', JSON.stringify(st));
  console.log('ошибки:', errs.length? errs.slice(0,4).join(' | '):'нет');
  await browser.close();
})();
