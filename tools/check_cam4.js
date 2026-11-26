const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?c4='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<25;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(300);

  // состояние + фактическое положение камеры (по view), чтобы поймать «камера под полом»
  const st = ()=> page.evaluate(()=>{
    const v = buildView();
    const camY = v.ortho ? null : v.target.y + v.dist*Math.sin(v.pitch);
    return { pitch:+cam.pitch.toFixed(3), yaw:+cam.yaw.toFixed(3),
             viewPitch:+v.pitch.toFixed(3), camY: camY===null?null:+camY.toFixed(3),
             tgtY: v.ortho?null:+v.target.y.toFixed(3) };
  });
  const drag = async (dx,dy,steps=10)=>{
    await page.mouse.move(640,420); await page.mouse.down();
    for (let i=1;i<=steps;i++){ await page.mouse.move(640+dx*i/steps, 420+dy*i/steps); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(220);
  };

  console.log('старт:', JSON.stringify(await st()));

  // 1. тянем мышь ВВЕРХ — камера должна наклоняться вверх, далеко за старый предел 0.05
  await drag(0,-260,14);
  const up = await st();
  console.log('тянем вверх:', JSON.stringify(up),
    up.pitch < -0.2 ? '→ уходит вверх ✅' : '→ УПЁРЛАСЬ ❌');
  console.log('  камера над полом:', up.camY >= 0.17 ? 'да ✅' : 'ПОД ПОЛОМ ❌', up.camY);

  // 1б. при крайнем наклоне вверх сцена не должна «уезжать» из кадра
  const fr = await page.evaluate(()=>{
    const top = project({x:2,y:3.3,z:1.5}), bot = project({x:2,y:0,z:1.5});
    return {topY:Math.round(top.y), botY:Math.round(bot.y), H};
  });
  const cover = (fr.botY - fr.topY) / fr.H;
  console.log('  теплица в кадре:', JSON.stringify(fr), 'занимает', (cover*100).toFixed(0)+'% высоты',
    (fr.topY > 0 && fr.botY < fr.H && cover > 0.35) ? '✅ не уехала' : '❌ УЕХАЛА');

  // 2. тянем мышь ВНИЗ — вниз камера тоже ходит
  await drag(0,420,16);
  const dn = await st();
  console.log('тянем вниз:', JSON.stringify(dn),
    dn.pitch > 0.4 ? 'наклон вниз ✅' : 'не двигается вниз ❌');
  console.log('  камера над полом:', dn.camY >= 0.17 ? 'да ✅' : 'ПОД ПОЛОМ ❌', dn.camY);

  // 3. кадр «смотрим вверх» — вернуть наклон и снять
  await drag(0,-300,16);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, '/home/user/shots/107_look_up.png');
  await page.evaluate(()=>VG.freeze(false));
  console.log('кадр вверх:', JSON.stringify(await st()));

  // 4. инверсия в «Параметрах»
  await page.evaluate(()=>{ cam.pitch = 0.26; resetCam(); });
  await page.waitForTimeout(500);
  await page.evaluate(()=>setPage('settings'));
  await page.waitForTimeout(200);
  await page.click('#btnCamInv'); await page.waitForTimeout(150);
  const inv = await page.evaluate(()=>({inv:camInvertY, label:$('btnCamInv').textContent.trim(),
    saved: (()=>{ try{ return localStorage.getItem('vgCamInvert'); }catch(e){ return 'n/a'; } })()}));
  console.log('инверсия включена:', JSON.stringify(inv));
  await page.evaluate(()=>setPage('greenhouse')); await page.waitForTimeout(200);
  const beforeInv = await st();
  await drag(0,-120,10);
  const afterInv = await st();
  console.log('при инверсии тянем вверх:', beforeInv.pitch, '→', afterInv.pitch,
    afterInv.pitch > beforeInv.pitch ? 'наклон вниз ✅' : 'НЕ ИНВЕРТИРУЕТ ❌');
  await page.evaluate(()=>setCamInvertY(false));

  // 5. кнопки ▲▼ работают по-старому (без инверсии)
  await page.evaluate(()=>resetCam()); await page.waitForTimeout(500);
  for (let i=0;i<4;i++){ await page.click('.camNav [data-cam="up"]'); await page.waitForTimeout(60); }
  const bu = await st();
  for (let i=0;i<8;i++){ await page.click('.camNav [data-cam="down"]'); await page.waitForTimeout(60); }
  const bd = await st();
  console.log('кнопка ▲ ×4:', bu.pitch, bu.pitch < 0.15 ? '✅' : '❌',
              '· ▼ ×8:', bd.pitch, bd.pitch > bu.pitch + 0.3 ? '✅' : '❌');

  // 6. кадр вниз для сравнения
  await page.evaluate(()=>resetCam()); await page.waitForTimeout(500);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, '/home/user/shots/108_home.png');
  await page.evaluate(()=>VG.freeze(false));

  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
