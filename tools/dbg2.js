const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:800} });
  page.on('pageerror',e=>console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8080/index.html?d='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame(); });
  await page.waitForTimeout(500);
  const t = await page.evaluate(()=>{ const t0=performance.now(); let n=0; for(let i=0;i<20;i++){ drawScene(); n++; } return (performance.now()-t0)/n; });
  console.log('кадр сцены (балкон):', t.toFixed(1), 'мс');
  await page.screenshot({ path:'/home/user/shots/71_balcony.png', timeout: 20000 }).then(()=>console.log('скрин ок')).catch(e=>console.log('скрин упал:', e.message.split('\n')[0]));
  await browser.close();
})();
