const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const fs = require('fs');
const { shotFile } = require('./paths');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1400, height:940} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?g='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  const crop = async (sel, pad=10)=> page.evaluate(([s,p])=>{ const r=document.querySelector(s).getBoundingClientRect();
      return {x:Math.max(0,r.x-p), y:Math.max(0,r.y-p), width:r.width+2*p, height:r.height+2*p}; }, [sel,pad]);

  await page.evaluate(()=>{ pending.campaign=true; buildStart(); });
  await page.waitForTimeout(200);
  await cdpShot(page, shotFile('95_start4.png'));
  await page.evaluate(()=>document.getElementById('start').classList.remove('on'));
  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame();
    for(let d=0;d<12;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
  await page.waitForTimeout(400);

  await page.evaluate(()=>VG.page('shop'));
  await page.waitForTimeout(500);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, shotFile('96_shop_tutorial.png'), await crop('#shopBody .sect:nth-of-type(2)', 6));
  await page.evaluate(()=>VG.freeze(false));

  // глава сети
  await page.evaluate(()=>{ VG.page('greenhouse'); world.soldEur=4000; world.camp.ch=2; moveChapter(world,2);
    world.camp.soldBase=(world.soldEur||0); world.money=30000;
    answerMail(world,'goal3',0); netBuy(world,'tomato'); netBuy(world,'cherry');
    for(let d=0;d<6;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ const el=document.querySelector('#dashGrid .panel[data-p="net"]');
    el.scrollIntoView({block:'center'}); });
  await page.waitForTimeout(300);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, shotFile('97_net_panel.png'), await crop('#dashGrid .panel[data-p="net"]', 6));
  await cdpShot(page, shotFile('98_net_full.png'));
  await page.evaluate(()=>VG.freeze(false));
  console.log('панели:', await page.evaluate(()=>[...document.querySelectorAll('#dashGrid .panel')].map(p=>p.dataset.p+':'+getComputedStyle(p).display).join(' ')));
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
