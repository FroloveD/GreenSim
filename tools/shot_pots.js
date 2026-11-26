const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const run = async (tag, profile, sys, pitch, vw=1280, vh=800)=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:vw, height:vh} });
  page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('http://localhost:8080/index.html?pots='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(([pr,sy])=>{ pending.campaign=false; pending.profile=pr; pending.crop='tomato'; pending.sys=sy; startGame();
    for(let d=0;d<24;d++){ for(let k=0;k<24;k++) VG.sim(1); } cam.yaw=-0.62; renderAll(); }, [profile, sys]);
  await page.waitForTimeout(300);
  await page.evaluate(pp=>{ cam.pitch=pp; camTween=null; cam.mode='free'; renderAll(); }, pitch);
  await page.waitForTimeout(250);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, '/home/user/shots/'+tag+'.png');
  await page.evaluate(()=>VG.freeze(false));
  console.log(tag, 'ok');
  await b.close();
};
(async()=>{
  await run('pot_soil_top','farm','soil',0.95);
  await run('pot_soil_mid','farm','soil',0.26);
  await run('pot_soil_low','farm','soil',-0.10);
  await run('pot_dwc_top','room','dwc',0.95);
  await run('pot_dwc_low','room','dwc',-0.10);
  await run('pot_aero_mid','room','aero',0.26);
  await run('pot_balcony','balcony','soil',0.26);
})();
