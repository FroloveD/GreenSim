const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:900, height:700} });
  page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('http://localhost:8080/index.html?dbg2='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  const out = await page.evaluate(()=>{
    pending.campaign=false; pending.profile='room'; pending.crop='tomato'; pending.sys='soil'; startGame();
    for(let d=0;d<12;d++) for(let k=0;k<24;k++) VG.sim(1);
    const p = world.plants[0];
    cam.mode='free'; cam.pitch=0.18; cam.yaw=-0.62; cam.dist=1.1; cam.zoom=1;
    cam.target={x:p.x, y:plantBaseY(world)*0.9, z:p.z};
    refreshView();
    const g = vesselGeom(world.sys), base = plantBaseY(world), K=16;
    const ring=(y,r)=>{ const a=[]; for(let i=0;i<K;i++){ const t=i/K*6.2831853; a.push(project({x:p.x+Math.cos(t)*r, y, z:p.z+Math.sin(t)*r})); } return a; };
    const bot=ring(base-g.h, g.rb), top=ring(base, g.rt);
    const area=(pts)=>{ let s=0; for(let i=0;i<pts.length;i++){ const a=pts[i], b2=pts[(i+1)%pts.length]; s += a.x*b2.y - b2.x*a.y; } return s/2; };
    return {
      sys:world.sys, base, h:g.h, wall:g.wall,
      bot0:[Math.round(bot[0].x),Math.round(bot[0].y)], bot8:[Math.round(bot[8].x),Math.round(bot[8].y)],
      top0:[Math.round(top[0].x),Math.round(top[0].y)], top8:[Math.round(top[8].x),Math.round(top[8].y)],
      areaBot:Math.round(area(bot)), areaTop:Math.round(area(top)),
      s:+bot[0].s.toFixed(1)
    };
  });
  console.log(JSON.stringify(out));
  await b.close();
})();
