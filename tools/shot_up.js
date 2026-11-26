const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const { cdpShot } = require('./shot_cdp.js');
const run = async (profile, tag, vw, vh, pitch, extra)=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:vw, height:vh} });
  page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('http://localhost:8080/index.html?u4='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(([p,ex])=>{ pending.campaign=!!(ex&&ex.camp); pending.profile=p; pending.crop='tomato';
    if(ex&&ex.sys) pending.sys=ex.sys; startGame();
    for(let d=0;d<22;d++){ for(let k=0;k<24;k++) VG.sim(1); } cam.yaw=-0.62; renderAll(); }, [profile, extra||null]);
  await page.waitForTimeout(300);
  await page.evaluate(pp=>{ cam.pitch=pp; camTween=null; cam.mode='free'; renderAll(); }, pitch);
  await page.waitForTimeout(250);
  await page.evaluate(()=>VG.freeze(true));
  await cdpShot(page, '/home/user/shots/'+tag+'.png');
  await page.evaluate(()=>VG.freeze(false));
  console.log(tag, JSON.stringify(await page.evaluate(()=>{ const v=buildView();
    return {pitch:+v.pitch.toFixed(2), tgtY:+v.target.y.toFixed(2), camY:+(v.target.y+v.dist*Math.sin(v.pitch)).toFixed(2)}; })));
  await b.close();
};
(async()=>{
  await run('room','v4_room_up',1280,800,-0.32);
  await run('room','v4_phone_up',390,844,-0.32);
  await run('balcony','v4_balcony_up',1280,800,-0.32,{camp:true});
  await run('room','v4_room_home',1280,800,0.26);
})();
