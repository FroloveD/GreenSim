const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const shot = async (page, path)=>{ await page.evaluate(()=>window.VG&&VG.freeze(true));
  await page.waitForTimeout(100);
  try { await cdpShot(page, path); } catch(e){ console.log('скрин не снялся:', e.message.slice(0,50)); }
  await page.evaluate(()=>window.VG&&VG.freeze(false)); };
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await page.goto('http://localhost:8080/index.html?n=1', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  // выбрать сложность «Жёсткая» и начать
  await page.click('[data-diff="hard"]');
  await page.waitForTimeout(200);
  await page.click('#startBtn');
  await page.waitForTimeout(1200);
  await shot(page, '/home/user/shots/50_tutor.png');
  const st1 = await page.evaluate(()=>({
    diff: window.VG.world.diffId, fixed: window.VG.world.diffFixed,
    tutor: document.getElementById('tutorStep').textContent,
    text: document.getElementById('tutorText').textContent.slice(0,60),
    goals: document.getElementById('goals').children.length,
    diag: document.getElementById('diagnosis').textContent.slice(0,80)
  }));
  console.log('старт:', JSON.stringify(st1));
  // шаг 1: камера
  await page.evaluate(()=>window.VG.cam('plant'));
  await page.waitForTimeout(400);
  // шаг 2: сбор
  await page.evaluate(()=>{ for(let d=0;d<12;d++){ for(let k=0;k<24;k++) window.VG.sim(1); } window.VG.harvest(); });
  await page.waitForTimeout(500);
  const st2 = await page.evaluate(()=>({tutor:document.getElementById('tutorStep').textContent,
     text:document.getElementById('tutorText').textContent.slice(0,70)}));
  console.log('после сбора:', JSON.stringify(st2));
  // шаг 3: CO2
  await page.evaluate(()=>{ window.VG.set('co2Set', 850); window.VG.sim(1); });
  await page.waitForTimeout(400);
  // шаг 4: покупка
  await page.evaluate(()=>{ window.VG.buy('thermo'); });
  await page.waitForTimeout(400);
  // шаг 5: прогноз
  await page.click('#btnPred'); await page.click('[data-pred="7"]');
  await page.waitForTimeout(2500);
  const st3 = await page.evaluate(()=>({visible:document.getElementById('tutor').classList.contains('on'),
     text:document.getElementById('tutorText').textContent.slice(0,50)}));
  console.log('после всех шагов:', JSON.stringify(st3));
  // слой света + наведение
  await page.click('#btnPred'); await page.waitForTimeout(300);
  await page.evaluate(()=>window.VG.cam('plant'));
  await page.click('#btnLayer');
  await page.waitForTimeout(500);
  await shot(page, '/home/user/shots/51_layer.png');
  await page.mouse.move(640, 420);
  await page.waitForTimeout(400);
  const hov = await page.evaluate(()=>{ const c=document.getElementById('hoverCard');
    return {shown:c.style.display, text:c.textContent.slice(0,120)}; });
  console.log('карточка органа:', JSON.stringify(hov));
  await shot(page, '/home/user/shots/52_hover.png');
  console.log('ошибки:', errs.length? errs.slice(0,5).join(' | '):'нет');
  await browser.close();
})();
