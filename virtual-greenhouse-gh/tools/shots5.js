const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const shot = async (page, p) => {
  await page.evaluate(()=>window.VG && VG.freeze(true));
  await page.waitForTimeout(120);
  try { await cdpShot(page, p); }
  catch(e){ console.log('не снялось:', p, e.message.split('\n')[0]); }
  await page.evaluate(()=>window.VG && VG.freeze(false));
};
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto('http://localhost:8080/index.html?s=' + Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  await shot(page, '/home/user/shots/70_start.png');

  // --- кампания на балконе ---
  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame(); });
  await page.waitForTimeout(1000);
  await shot(page, '/home/user/shots/71_balcony.png');
  const mailTxt = await page.evaluate(()=>{ openMail('intro');
    const t = document.getElementById('mailBox').innerText.replace(/\s+/g,' ');
    document.getElementById('mailModal').classList.remove('on'); return t; });
  console.log('письмо:', mailTxt.slice(0,220));
  await page.evaluate(()=>{ answerMail(world,'intro',0); document.getElementById('mailModal').classList.remove('on'); renderAll(); });
  await page.evaluate(()=>{ for(let d=0;d<40;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); renderAll(); });
  await page.waitForTimeout(800);
  await shot(page, '/home/user/shots/73_balcony_later.png');

  // --- склад крупным планом ---
  const box = await page.evaluate(()=>{ const r=document.getElementById('stock').getBoundingClientRect(); return {x:r.x-8,y:r.y-30,width:r.width+16,height:r.height+40}; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.captureScreenshot', { format:'png', clip:{...box, scale:1} })
    .then(r=>require('fs').writeFileSync('/home/user/shots/76_warehouse.png', Buffer.from(r.data,'base64')))
    .catch(e=>console.log('склад не снялся:', e.message.slice(0,60)));
  await cdp.detach();
  await page.evaluate(()=>{ VG.page('shop'); });
  await page.waitForTimeout(500);
  await shot(page, '/home/user/shots/74_shop.png');

  // --- ферма в новом стиле ---
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<55;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); renderAll(); });
  await page.waitForTimeout(900);
  await shot(page, '/home/user/shots/75_farm_style.png');

  // --- пауза = реальное время ---
  const t0 = await page.evaluate(()=>VG.world.hour + VG.world.day*24);
  await page.evaluate(()=>document.getElementById('btnPause').click());
  await page.waitForTimeout(5000);
  const t1 = await page.evaluate(()=>VG.world.hour + VG.world.day*24);
  console.log('пауза: за 5 реальных секунд прошло', ((t1-t0)*3600).toFixed(2), 'игровых секунд');
  await shot(page, '/home/user/shots/77_pause.png');
  console.log('ошибки:', errs.length?errs.slice(0,5).join(' | '):'нет');
  await browser.close();
})();
