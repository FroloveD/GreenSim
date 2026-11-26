const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?c3='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<25;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(300);
  const st = ()=> page.evaluate(()=>({mode:cam.mode, yaw:+cam.yaw.toFixed(3), pitch:+cam.pitch.toFixed(3), zoom:+cam.zoom.toFixed(3), ptrs:ptrs.size}));
  const click = async sel => { await page.click(sel); await page.waitForTimeout(80); };

  console.log('старт:', JSON.stringify(await st()));
  await click('.camNav [data-cam="left"]');  console.log('кнопка ◀:', JSON.stringify(await st()));
  await click('.camNav [data-cam="right"]'); console.log('кнопка ▶:', JSON.stringify(await st()));
  await click('.camNav [data-cam="down"]');  console.log('кнопка ▼:', JSON.stringify(await st()));
  await click('.camNav [data-cam="in"]');    console.log('кнопка +:', JSON.stringify(await st()));
  await click('.camNav [data-cam="reset"]'); console.log('кнопка ⟲:', JSON.stringify(await st()));

  // клавиши
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  console.log('стрелки:', JSON.stringify(await st()));

  // «Свободно» при свободном виде не должно дёргать камеру
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
  const before = await st();
  await click('#camBar [data-view="free"]');
  const after = await st();
  console.log('повторное «Свободно»:', before.yaw===after.yaw?'не дёргает ✅':'СБРОСИЛО ❌');

  // зависший палец не блокирует мышь
  await page.evaluate(()=>{ ptrs.set(99,{x:1,y:1,type:'touch'}); });
  const y0 = (await st()).yaw;
  await page.mouse.move(640,420); await page.mouse.down();
  for (let i=1;i<=8;i++){ await page.mouse.move(640+i*20, 420); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(120);
  const y1 = (await st()).yaw;
  console.log('после «зависшего» пальца драг мышью:', y0!==y1?'работает ✅':'НЕ РАБОТАЕТ ❌', JSON.stringify(await st()));

  // время: 1× = 1 игровой час за реальную минуту
  const timeTest = await page.evaluate(async()=>{
    const grab = ()=> ({h: world.hour + (world.day-1)*24});
    speed = 1; paused = false; acc = 0;
    const h0 = grab();
    await new Promise(r=>setTimeout(r, 3000));   // 3 реальные секунды
    const h1 = grab();
    return {hours:(h1.h-h0.h).toFixed(3), perMin:(60*(h1.h-h0.h)/3).toFixed(2)};
  });
  console.log('1× за 3 с:', JSON.stringify(timeTest), '(ожидается ~0.05 ч, ~1 ч/мин)');
  await page.evaluate(()=>VG.freeze(true)); await cdpShot(page, shotFile('101_camnav.png')); await page.evaluate(()=>VG.freeze(false));
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
