const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  page.on('pageerror', e=>console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8080/index.html?p=1', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);
  await page.click('#startBtn');
  await page.waitForTimeout(500);
  // плохие настройки: холод + нет света + закрытая вентиляция -> несколько предупреждений
  await page.evaluate(()=>{ const w=window.VG.world; window.VG.set('heatSet',8); window.VG.set('ventSet',36); window.VG.set('co2Set',400);
    for(let d=0; d<40; d++) for(let k=0;k<24;k++) window.VG.sim(1); });
  await page.click('#btnPred'); await page.click('[data-pred="30"]');
  await page.waitForTimeout(3500);
  await page.screenshot({ path:'/home/user/shots/34_pred_warnings.png' });
  const geo = await page.evaluate(()=>{
    const al=[...document.querySelectorAll('#predBody .alert')].map(e=>{const r=e.getBoundingClientRect();
      return {t:Math.round(r.top), b:Math.round(r.bottom), h:Math.round(r.height), s:getComputedStyle(e).whiteSpace};});
    return {alerts:al, panelH: document.getElementById('pred').getBoundingClientRect().height};
  });
  console.log(JSON.stringify(geo));
  await browser.close();
})();
