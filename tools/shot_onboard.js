const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const p = await b.newPage({viewport:{width:1280,height:900}});
  p.on('pageerror', e=>console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:8080/index.html?l='+Date.now(), {waitUntil:'domcontentloaded', timeout:60000});
  await p.waitForTimeout(600);
  await p.evaluate(()=>{ try{localStorage.clear();}catch(e){} });
  // старт сезона
  await p.evaluate(()=>document.querySelector('#startBtn').click()); await p.waitForTimeout(1200);
  // онбординг
  await p.evaluate(()=>document.querySelector('#btnHelp').click());
  await p.evaluate(()=>VG && VG.freeze && VG.freeze(true));
  await p.waitForTimeout(300);
  await cdpShot(p,'/home/user/shots/ob1.png');
  await p.evaluate(()=>document.querySelector('#obNext').click());
  await p.evaluate(()=>document.querySelector('#obNext').click());
  await p.waitForTimeout(200);
  await cdpShot(p,'/home/user/shots/ob3.png');
  await p.evaluate(()=>{ for(let i=0;i<4;i++) document.querySelector('#obNext').click(); });
  await p.waitForTimeout(200);
  await cdpShot(p,'/home/user/shots/ob5.png');
  // валюту в рубли
  await p.evaluate(()=>document.querySelector('#helpClose').click());
  await p.evaluate(()=>document.querySelector('.tabs button[data-tab="settings"]').click());
  await p.waitForTimeout(500);
  const clicked = await p.evaluate(()=>{ const b=document.querySelector('[data-curset="rub"]'); if(!b) return 'нет кнопки'; b.click(); return b.textContent; });
  console.log('валюта клик:', clicked);
  await p.waitForTimeout(600);
  await p.evaluate(()=>{ const g=document.querySelector('#glossCard'); if(g) g.scrollIntoView({block:'start'}); });
  await p.waitForTimeout(400);
  await cdpShot(p,'/home/user/shots/cur_settings.png');
  await p.evaluate(()=>{ const g=document.querySelector('#glossCard'); if(g) g.scrollIntoView({block:'start'}); });
  await p.waitForTimeout(300);
  await cdpShot(p,'/home/user/shots/cur_gloss.png');
  await p.evaluate(()=>document.querySelector('.tabs button[data-tab="greenhouse"]').click());
  await p.waitForTimeout(600);
  await cdpShot(p,'/home/user/shots/cur_top.png');
  console.log(await p.evaluate(()=>document.querySelector('#tMoney').textContent+' | '+document.querySelector('#tProfit').textContent));
  await b.close();
})();
