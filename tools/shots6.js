const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const fs = require('fs');
const { shotFile } = require('./paths');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  const S = async (p, clip)=>{ await page.evaluate(()=>VG.freeze(true)); await page.waitForTimeout(120);
    const cdp = await page.context().newCDPSession(page);
    const r = await cdp.send('Page.captureScreenshot', clip?{format:'png',clip:{...clip,scale:1}}:{format:'png'});
    fs.writeFileSync(p, Buffer.from(r.data,'base64')); await cdp.detach();
    await page.evaluate(()=>VG.freeze(false)); };
  const crop = async (id, pad=8)=> page.evaluate(([i,p])=>{ const r=document.getElementById(i).getBoundingClientRect();
      return {x:Math.max(0,r.x-p), y:Math.max(0,r.y-p-26), width:r.width+2*p, height:r.height+2*p+26}; }, [id,pad]);

  await page.goto('http://localhost:8080/index.html?f='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(900);
  await page.evaluate(()=>{ pending.campaign=true; renderResumeBox(); buildStart(); });
  await page.waitForTimeout(200);
  await S(shotFile('80_start_campaign.png'));

  await page.evaluate(()=>{ startGame(); answerMail(world,'intro',0);
    for(let d=0;d<50;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
  await page.waitForTimeout(600);
  await S(shotFile('81_balcony.png'));
  await S(shotFile('82_warehouse.png'), await crop('stock'));
  const mailBox = await crop('mailPanel');
  await S(shotFile('83_mail_panel.png'), mailBox);

  await page.evaluate(()=>{ VG.page('shop'); });
  await page.waitForTimeout(500);
  await S(shotFile('84_shop.png'));
  await page.evaluate(()=>{ VG.page('greenhouse'); });

  // переезд в комнату через письмо
  await page.evaluate(()=>{ world.soldEur = 2000; campaignTick(world);
    const m = world.mail.find(x=>x.id==='goal1'); if (m){ answerMail(world,'goal1',0); }
    for(let d=0;d<35;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
  await page.waitForTimeout(700);
  await S(shotFile('85_room.png'));
  console.log('профиль после переезда:', await page.evaluate(()=>world.profile));

  // ферма в новом стиле
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<58;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
  await page.waitForTimeout(700);
  await S(shotFile('86_farm.png'));
  console.log('ошибки:', errs.length?errs.slice(0,4).join(' | '):'нет');
  await browser.close();
})();
