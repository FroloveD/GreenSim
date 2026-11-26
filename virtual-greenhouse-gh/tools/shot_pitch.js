const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?sp='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<25;d++){ for(let k=0;k<24;k++) VG.sim(1); }
    cam.pitch = 0.26; resetCam(); renderAll(); });
  await page.waitForTimeout(700);
  const shoot = async (name, pitch, yaw)=>{
    await page.evaluate(([p,y])=>{ cam.pitch=p; if(y!==null) cam.yaw=y; camTween=null; cam.mode='free'; renderAll(); }, [pitch, yaw]);
    await page.waitForTimeout(250);
    await page.evaluate(()=>VG.freeze(true));
    await cdpShot(page, '/home/user/shots/'+name+'.png');
    await page.evaluate(()=>VG.freeze(false));
    console.log('снят', name, JSON.stringify(await page.evaluate(()=>{
      const v=buildView(); return {pitch:+v.pitch.toFixed(2), camY:+(v.target.y+v.dist*Math.sin(v.pitch)).toFixed(2)}; })));
  };
  await shoot('108_home', 0.26, null);
  await shoot('107_look_up', -0.55, -0.62);
  await shoot('109_look_up_mid', -0.25, -0.62);
  await shoot('110_look_down', 0.95, -0.62);
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
