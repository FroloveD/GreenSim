const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  page.on('pageerror',e=>console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8080/index.html?p='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame(); });
  for (const days of [0, 20, 40, 55]){
    const t = await page.evaluate((dd)=>{
      for(let d=0;d<dd;d++) for(let k=0;k<24;k++) VG.sim(1);
      const t0=performance.now(); for(let i=0;i<12;i++) drawScene(); return (performance.now()-t0)/12;
    }, days);
    console.log('день', days, 'кадр', t.toFixed(1), 'мс');
  }
  await browser.close();
})();
