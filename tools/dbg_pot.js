const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const { shotFile } = require('./paths');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:900, height:700} });
  page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('http://localhost:8080/index.html?dbg='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='room'; pending.crop='tomato'; pending.sys='soil'; startGame();
    for(let d=0;d<12;d++){ for(let k=0;k<24;k++) VG.sim(1); }
    const p = world.plants[0];
    cam.mode='free'; cam.pitch=0.18; cam.yaw=-0.62; cam.dist=1.1; cam.zoom=1; cam.plant=0;
    cam.target={x:p.x, y: plantBaseY(world)*0.9, z:p.z};
    renderAll(); });
  await page.waitForTimeout(400);
  console.log('base', await page.evaluate(()=>({base:plantBaseY(world), potH:POT_H[world.sys], stand:vesselStandY(world)})));
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, shotFile('dbg_pot.png'));
  await page.evaluate(()=>VG.freeze(false));
  await b.close();
})();
