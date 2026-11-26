const { shotFile } = require('./paths');
// Проверка: браузер блокирует localStorage (как в sandbox-iframe) — игра не должна падать
const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.addInitScript(()=>{
    const boom = ()=>{ throw new DOMException('The operation is insecure.','SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: boom, configurable:true });
    Object.defineProperty(window, 'sessionStorage', { get: boom, configurable:true });
  });
  await page.goto('http://localhost:8080/index.html?ns=1', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  await page.click('#startBtn');
  await page.waitForTimeout(800);
  const st = await page.evaluate(()=>{
    document.getElementById('btnSave').click();
    return { day: VG.world.day, alive: !!VG.world };
  });
  await page.waitForTimeout(300);
  await page.evaluate(()=>window.VG.page('settings'));
  await page.waitForTimeout(400);
  const kind = await page.evaluate(()=>{
    const t = document.getElementById('settingsBody').textContent;
    const i = t.indexOf('Сохранение');
    return t.slice(i, i+110).replace(/\s+/g,' ');
  });
  console.log('игра жива на дне', st.day, '| хранилище:', kind);
  await page.screenshot({ path:shotFile('63_settings_nostorage.png') });
  console.log('ошибки:', errs.length? errs.slice(0,4).join(' | '):'нет');
  await browser.close();
})();
