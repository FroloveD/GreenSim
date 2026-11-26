const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
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
    document.getElementById('btnSave').click();
    return {day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg), crop:VG.world.crop}; });
  await page.waitForTimeout(600);
  console.log('до перезагрузки:', JSON.stringify(before));
  await page.screenshot({ path:'/home/user/shots/60_before_reload.png' });

  // перезагрузка страницы: должен появиться баннер «Продолжить»
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForTimeout(900);
  const banner = await page.evaluate(()=>{ const b=document.getElementById('resumeBox');
    return {shown: !!document.getElementById('btnResume'), text: b ? b.textContent.replace(/\s+/g,' ').slice(0,150) : 'нет' }; });
  console.log('баннер:', JSON.stringify(banner));
  await page.screenshot({ path:'/home/user/shots/61_resume_banner.png' });

  await page.click('#btnResume');
  await page.waitForTimeout(1000);
  const after = await page.evaluate(()=>({day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg), crop:VG.world.crop,
     plants:VG.world.plants.length, fruits:VG.world.plants[0].fruits.length, t:VG.world.temp}));
  console.log('после загрузки:', JSON.stringify(after));
  const same = after.day===before.day && Math.abs(after.money-before.money)<=1 && after.crop===before.crop;
  console.log('состояние совпадает:', same ? 'ДА ✓' : 'НЕТ ✗');
  await page.screenshot({ path:'/home/user/shots/62_after_resume.png' });

  // продолжаем играть после загрузки — нет ли ошибок
  await page.evaluate(()=>{ for(let d=0;d<3;d++){ for(let k=0;k<24;k++) window.VG.sim(1); window.VG.harvest(); } });
  await page.waitForTimeout(500);
  const cont = await page.evaluate(()=>({day:VG.world.day, money:Math.round(VG.world.money), kg:Math.round(VG.world.harvestedKg)}));
  console.log('продолжение игры:', JSON.stringify(cont));
  console.log('ошибки:', errs.length? errs.slice(0,4).join(' | '):'нет');
  await browser.close();
})();
