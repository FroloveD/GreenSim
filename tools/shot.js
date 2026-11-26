const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  const errs=[];
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  await page.goto('http://localhost:8080/index.html', { waitUntil:'load' });
  await page.waitForTimeout(700);
  await page.screenshot({ path:'/home/user/shots/01_start.png' });
  await page.click('#startBtn');
  await page.waitForTimeout(2500);
  await page.screenshot({ path:'/home/user/shots/02_greenhouse.png' });
  for (const [i,v] of ['top','front','bed','plant','free'].entries()){
    await page.evaluate(v=>window.VG.cam(v), v);
    await page.waitForTimeout(400);
    await page.screenshot({ path:`/home/user/shots/0${i+3}_cam_${v}.png` });
  }
  // ускорим и подождём немного
  await page.click('.spd[data-s="64"]').catch(()=>{});
  await page.waitForTimeout(4000);
  await page.screenshot({ path:'/home/user/shots/08_after64x.png' });
  await page.click('.tabs button[data-tab="shop"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path:'/home/user/shots/09_shop.png' });
  await page.click('.tabs button[data-tab="settings"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path:'/home/user/shots/10_settings.png' });
  await page.click('.tabs button[data-tab="greenhouse"]');
  await page.click('#btnPred');
  await page.click('[data-pred="7"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path:'/home/user/shots/11_forecast.png' });
  const st = await page.evaluate(()=>({day:window.VG.world.day, t:window.VG.world.temp, money:window.VG.world.money, fps:0}));
  console.log('состояние', JSON.stringify(st));
  console.log('ошибки:', errs.length? errs.slice(0,8).join(' | ') : 'нет');
  await browser.close();
})();
