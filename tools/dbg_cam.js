const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1200, height:800} });
  page.on('pageerror', e=>console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8080/index.html?c='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<40;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(400);
  const st = async()=> page.evaluate(()=>({mode:cam.mode, yaw:+cam.yaw.toFixed(3), pitch:+cam.pitch.toFixed(3), zoom:+cam.zoom.toFixed(3),
     W, H, view: (()=>{const v=buildView(); return {dist:+v.dist.toFixed(2), pitch:+v.pitch.toFixed(2)};})()}));
  console.log('до:', JSON.stringify(await st()));
  const box = await page.evaluate(()=>{ const r=document.getElementById('scene').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; });
  console.log('canvas box:', JSON.stringify(box));
  const cx = box.x + box.w/2, cy = box.y + box.h/2;
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/90_free_before.png'); await page.evaluate(()=>VG.freeze(false));
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i=1;i<=10;i++){ await page.mouse.move(cx+i*18, cy+i*3); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('после драга:', JSON.stringify(await st()));
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/91_free_after.png'); await page.evaluate(()=>VG.freeze(false));
  // проверим клик после драга (не должен собирать)
  // зум
  await page.mouse.move(cx,cy); await page.mouse.wheel(0,-300); await page.waitForTimeout(200);
  console.log('после зума:', JSON.stringify(await st()));
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/92_free_zoom.png'); await page.evaluate(()=>VG.freeze(false));
  await browser.close();
})();
