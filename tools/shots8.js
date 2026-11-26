const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const sizes = [{n:'phone',w:390,h:844},{n:'tablet',w:1024,h:768}];
  for (const sz of sizes){
    const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const page = await b.newPage({ viewport:{width:sz.w,height:sz.h} });
    const errs=[]; page.on('pageerror', e=>errs.push(e.message));
    await page.goto('http://localhost:8080/index.html?s='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(700);
    await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame();
      for(let d=0;d<14;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell();
      world.soldEur=4200; world.camp.ch=2; moveChapter(world,2); world.camp.soldBase=(world.soldEur||0);
      world.money=26000; answerMail(world,'goal3',0); netBuy(world,'tomato'); netBuy(world,'cherry');
      for(let d=0;d<4;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
    await page.waitForTimeout(600);
    // открыть вкладку со складом/сетью
    const tab = await page.evaluate(()=>{ const bs=[...document.querySelectorAll('#dock button')];
      const b = bs.find(x=>/Склад/i.test(x.textContent)) || bs[0]; b.click(); return b.textContent; });
    await page.waitForTimeout(500);
    await page.evaluate(()=>{ const el=document.querySelector('#dashGrid .panel[data-p="net"]'); if (el) el.scrollIntoView({block:'start'}); });
    await page.waitForTimeout(300);
    await page.evaluate(()=>VG.freeze(true));
    await cdpShot(page, shotFile(`99_${sz.n}_net.png`));
    await page.evaluate(()=>VG.freeze(false));
    console.log(sz.n, 'вкладка:', tab, 'ошибки:', errs.length?errs[0]:'нет');
    await b.close();
  }
})();
