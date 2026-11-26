const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  await page.goto('http://localhost:8080/index.html?tt='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame(); });
  await page.waitForTimeout(500);
  const res = await page.evaluate(async()=>{
    const out = {};
    for (const sp of [1, 4, 64, 480]){
      speed = sp; paused = false; acc = 0;
      const h0 = world.hour + (world.day-1)*24;
      let frames = 0; const t0 = performance.now();
      await new Promise(res=>{
        const tick = ()=>{ frames++; if (performance.now()-t0 < 2500) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick);
      });
      const dt = (performance.now()-t0)/1000;
      const h1 = world.hour + (world.day-1)*24;
      out[sp] = {real:+dt.toFixed(2), game:+((h1-h0)).toFixed(3), hPerMin:+(60*(h1-h0)/dt).toFixed(2), frames};
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
