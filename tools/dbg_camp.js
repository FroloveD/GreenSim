const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:800} });
  page.on('pageerror',e=>console.log('PAGEERROR:', e.message));
  page.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE:', m.text()); });
  await page.goto('http://localhost:8080/index.html?c='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  console.log('стартовый экран ок');
  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame(); });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(()=>({
    day: world.day, money: world.money, profile: world.profile, area: world.area,
    lots: world.wh.lots.length, mail: world.mail.map(m=>m.id), season: world.seasonDays,
    sec: world.wh.sections
  }));
  console.log('мир:', JSON.stringify(st));
  await page.waitForTimeout(1500);
  console.log('кадров прошло, страница жива');
  await browser.close();
})();
