const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  for (const sz of [{n:'desk',w:1440,h:900},{n:'tablet',w:1024,h:768},{n:'phone',w:390,h:844}]){
    const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const page = await b.newPage({ viewport:{width:sz.w, height:sz.h} });
    const errs=[]; page.on('pageerror', e=>errs.push(e.message));
    await page.goto('http://localhost:8080/index.html?f9='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(700);
    await page.evaluate(()=>{ pending.campaign=false; pending.profile='room'; pending.crop='tomato'; pending.sys='nft'; startGame();
      for(let d=0;d<22;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
    await page.waitForTimeout(700);
    await page.evaluate(()=>VG.freeze(true));
    await cdpShot(page, shotFile(`106_${sz.n}.png`));
    await page.evaluate(()=>VG.freeze(false));
    const info = await page.evaluate(()=>({topH: getComputedStyle(document.documentElement).getPropertyValue('--topH'),
      topBar: Math.round(document.getElementById('top').getBoundingClientRect().height),
      sys: world.sys, prof: document.getElementById('tProfile').textContent}));
    console.log(sz.n, JSON.stringify(info), errs[0]||'');
    await b.close();
  }
})();
