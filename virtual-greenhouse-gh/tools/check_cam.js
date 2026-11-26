const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1200, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?c='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<40;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(300);
  const st = async()=> page.evaluate(()=>({mode:cam.mode, yaw:+cam.yaw.toFixed(2), pitch:+cam.pitch.toFixed(2), dist:+cam.dist.toFixed(2), zoom:+cam.zoom.toFixed(3), tgt:[+cam.target.x.toFixed(2),+cam.target.y.toFixed(2),+cam.target.z.toFixed(2)]}));
  const box = await page.evaluate(()=>{ const r=document.getElementById('scene').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; });
  const cx = box.x+box.w/2, cy = box.y+box.h/2;

  // 1) кнопка «Грядка» — плавный переход
  await page.click('#camBar [data-view="bed"]');
  await page.waitForTimeout(120);
  console.log('в процессе перехода:', JSON.stringify(await st()));
  await page.waitForTimeout(500);
  console.log('грядка:', JSON.stringify(await st()));

  // 2) перетаскивание из грядки — не должно прыгать
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i=1;i<=8;i++){ await page.mouse.move(cx+i*14, cy+i*2); await page.waitForTimeout(16); }
  await page.mouse.up();
  console.log('после драга из грядки:', JSON.stringify(await st()));
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/93_cam_drag.png'); await page.evaluate(()=>VG.freeze(false));

  // 3) панорама правой кнопкой
  await page.mouse.move(cx, cy); await page.mouse.down({button:'right'});
  for (let i=1;i<=8;i++){ await page.mouse.move(cx-i*10, cy); await page.waitForTimeout(16); }
  await page.mouse.up({button:'right'});
  console.log('после панорамы:', JSON.stringify(await st()));

  // 4) колесо
  await page.mouse.move(cx,cy); await page.mouse.wheel(0,-240); await page.waitForTimeout(120);
  console.log('после зума:', JSON.stringify(await st()));

  // 5) сброс двойным щелчком
  await page.mouse.dblclick(cx, cy); await page.waitForTimeout(500);
  console.log('после сброса:', JSON.stringify(await st()));

  // 6) камера «Растение» ставится на растение
  await page.click('#camBar [data-view="plant"]'); await page.waitForTimeout(500);
  console.log('растение:', JSON.stringify(await st()));

  // 7) камера не вращается, если тянуть по панели
  await page.mouse.move(100, 400); await page.mouse.down();
  for (let i=1;i<=6;i++){ await page.mouse.move(100+i*12, 400); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(100);
  console.log('после драга по панели:', JSON.stringify(await st()));

  // 8) тач: два пальца
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:cx-60,y:cy},{x:cx+60,y:cy}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:cx-100,y:cy},{x:cx+100,y:cy}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await page.waitForTimeout(150);
  console.log('после щипка (тач):', JSON.stringify(await st()));
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
