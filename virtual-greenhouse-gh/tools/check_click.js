const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  await page.goto('http://localhost:8080/index.html?k=2', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(500);
  await page.click('#startBtn');
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ for(let d=0;d<20;d++){ for(let k=0;k<24;k++) window.VG.sim(1); } window.VG.cam('plant'); });
  await page.waitForTimeout(400);
  const p0 = await page.evaluate(()=>({pruned: window.VG.world.pruned||0, harvested: window.VG.world.harvested}));
  for (let y=150; y<760 && true; y+=40){
    for (let x=300; x<1150; x+=40){
      await page.mouse.click(x, y);
    }
  }
  await page.waitForTimeout(300);
  const p1 = await page.evaluate(()=>({pruned: window.VG.world.pruned||0, harvested: window.VG.world.harvested}));
  console.log('до кликов', JSON.stringify(p0), 'после', JSON.stringify(p1));
  await browser.close();
})();
