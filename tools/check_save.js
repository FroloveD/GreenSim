const { launch } = require('./browser');
const { cdpShot } = require('./shot_cdp.js');
const path = require('path');
const SHOTS = path.join(__dirname, '..', 'shots');
// снимок через CDP: page.screenshot ждёт «стабильный кадр» на живой сцене и падает по таймауту
async function shot(page, file){
  try { await page.evaluate(()=>window.VG && window.VG.freeze && window.VG.freeze(true)); } catch(e){}
  await cdpShot(page, file);
  try { await page.evaluate(()=>window.VG && window.VG.freeze && window.VG.freeze(false)); } catch(e){}
}
(async()=>{
  const browser = await launch();
  const ctx = await browser.newContext({ viewport:{width:1280, height:900} });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

  await page.goto('http://localhost:8080/index.html?s=1', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.click('[data-crop="cucumber"]');
  await page.click('#startBtn');
  await page.waitForTimeout(600);
  // играем 12 дней
  // ставим паузу, чтобы состояние не убежало между замером и сохранением
  await page.click('#btnPause');
  const before = await page.evaluate(()=>{ for(let d=0;d<12;d++){ for(let k=0;k<24;k++) window.VG.sim(1); window.VG.harvest(); }
    document.getElementById('btnSave').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));
    return {day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg), crop:VG.world.crop}; });
  await page.waitForTimeout(600);
  console.log('до перезагрузки:', JSON.stringify(before));
  await shot(page, path.join(SHOTS, '60_before_reload.png'));

  // перезагрузка страницы: должен появиться баннер «Продолжить»
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForTimeout(900);
  const banner = await page.evaluate(()=>{ const b=document.getElementById('resumeBox');
    return {shown: !!document.getElementById('btnResume'), text: b ? b.textContent.replace(/\s+/g,' ').slice(0,150) : 'нет' }; });
  console.log('баннер:', JSON.stringify(banner));
  await shot(page, path.join(SHOTS, '61_resume_banner.png'));

  await page.click('#btnResume');
  // сразу замораживаем: иначе за секунду ожидания мир успевает прожить время
  // и деньги расходятся не из-за ошибки сохранения, а из-за хода игры
  await page.evaluate(()=>{ window.VG.freeze(true); });
  await page.waitForTimeout(300);
  const after = await page.evaluate(()=>({day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg), crop:VG.world.crop,
     plants:VG.world.plants.length, fruits:VG.world.plants[0].fruits.length, t:VG.world.temp,
     speed:VG.speed, activeSpeed:document.querySelector('.spd.on')?.dataset.s || null}));
  console.log('после загрузки:', JSON.stringify(after));
  const dMoney = Math.abs(after.money-before.money);
  const same = after.day===before.day && dMoney<=3 && after.crop===before.crop
               && after.plants===8 && after.fruits>0 && after.speed===1 && after.activeSpeed==='1';
  console.log((same?'✅ ':'❌ ')+'состояние совпадает', same ? `день ${after.day}, деньги ±${dMoney} €` : JSON.stringify({before, after}));
  if (!same) process.exitCode = 1;
  await shot(page, path.join(SHOTS, '62_after_resume.png'));

  // продолжаем играть после загрузки — нет ли ошибок
  await page.evaluate(()=>{ window.VG.freeze(false); for(let d=0;d<3;d++){ for(let k=0;k<24;k++) window.VG.sim(1); window.VG.harvest(); } });
  await page.waitForTimeout(500);
  const cont = await page.evaluate(()=>({day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg)}));
  console.log('продолжение игры:', JSON.stringify(cont));
  console.log('ошибки:', errs.length? errs.slice(0,4).join(' | '):'нет');
  await browser.close();
})();
