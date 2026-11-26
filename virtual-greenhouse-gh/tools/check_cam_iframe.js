const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1400, height:900} });
  const errs=[]; page.on('pageerror', e=>errs.push('PAGE: '+e.message));
  page.on('console', m=>{ if (m.type()==='error') errs.push('console: '+m.text()); });
  await page.goto('http://localhost:8081/frame_test.html', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  const frames = page.frames();
  console.log('фреймов:', frames.length, frames.map(f=>f.url()).join(' | '));
  const app = frames.find(f=>f.url().includes('index.html'));
  if (!app){ console.log('нет фрейма приложения'); await b.close(); return; }
  await app.click('#startBtn');
  await page.waitForTimeout(600);
  await app.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<20;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(400);
  const st = ()=> app.evaluate(()=>({mode:cam.mode, yaw:+cam.yaw.toFixed(3), pitch:+cam.pitch.toFixed(3)}));
  console.log('до:', JSON.stringify(await st()));
  // координаты iframe на странице (iframe в 0,0)
  await page.mouse.move(640, 420); await page.mouse.down();
  for (let i=1;i<=10;i++){ await page.mouse.move(640+i*20, 420+i*4); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('после драга в iframe:', JSON.stringify(await st()));
  console.log('ошибки:', errs.length?errs.slice(0,5).join(' | '):'нет');
  const info = await app.evaluate(()=>({hasVG: !!window.VG, w: window.innerWidth,
    el: (document.elementFromPoint(640,420)||{}).id || 'null'}));
  console.log('внутри:', JSON.stringify(info));
  await b.close();
})();
