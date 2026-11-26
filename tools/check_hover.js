const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { shotFile } = require('./paths');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1280, height:900} });
  page.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await page.goto('http://localhost:8080/index.html?h=1', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);
  await page.click('#startBtn');
  await page.waitForTimeout(400);
  await page.evaluate(()=>{ for(let d=0;d<18;d++){ for(let k=0;k<24;k++) window.VG.sim(1); } window.VG.cam('plant'); });
  await page.waitForTimeout(500);
  let found = 0;
  for (let y=200; y<700 && found<3; y+=25){
    for (let x=380; x<900 && found<3; x+=25){
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const t = await page.evaluate(()=>{ const c=document.getElementById('hoverCard'); return c.style.display==='none' ? null : c.textContent; });
      if (t){ found++; console.log('наведение ('+x+','+y+'):', t.slice(0,110)); await page.screenshot({path:shotFile('53_hover.png')}); break; }
    }
  }
  if (!found) console.log('карточка не появилась');
  const tb = await page.evaluate(()=>{ const d=document.getElementById('tDate').getBoundingClientRect(); const m=document.getElementById('tMoney').getBoundingClientRect(); return {dateH:Math.round(d.height), moneyH:Math.round(m.height)}; });
  console.log('высота метрик (одна строка ≈16):', JSON.stringify(tb));
  await page.screenshot({ path:shotFile('54_topbar.png') });
  await browser.close();
})();
