const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  for (const w of [1440, 1366, 1280, 1180, 1024, 768, 390]){
    const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const page = await b.newPage({ viewport:{width:w, height:800} });
    await page.goto('http://localhost:8080/index.html?f='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(600);
    await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame(); });
    await page.waitForTimeout(400);
    const r = await page.evaluate(()=>{
      const t = document.getElementById('top');
      const last = [...t.querySelectorAll('button')].filter(b=>b.offsetParent).pop();
      const tr = t.getBoundingClientRect(), lr = last.getBoundingClientRect();
      const cb = document.getElementById('camBar').getBoundingClientRect();
      return {overflow: t.scrollWidth > t.clientWidth + 1,
        lastBtn: last.textContent.trim().slice(0,10), lastRight: Math.round(lr.right), topRight: Math.round(tr.right),
        camBarH: Math.round(cb.height), viewport: window.innerWidth};
    });
    console.log(w, JSON.stringify(r));
    if (w===390){ await page.evaluate(()=>VG.freeze(true)); await cdpShot(page,'/home/user/shots/105_phone_camnav.png'); await page.evaluate(()=>VG.freeze(false)); }
    await b.close();
  }
})();
