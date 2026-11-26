const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1200, height:800} });
  await page.goto('http://localhost:8080/index.html?c='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<30;d++){ for(let k=0;k<24;k++) VG.sim(1); }
    cam.yaw = 0.46; cam.pitch = 0.38; renderAll();
    window.__log=[];
    const op = window.poly;
    window.poly = (pts, fill, stroke, lw)=>{
      if (pts && pts.length>=3 && fill){
        let a=1e9,b=1e9,c=-1e9,d=-1e9;
        for (const p of pts){ const q=project(p); a=Math.min(a,q.x); b=Math.min(b,q.y); c=Math.max(c,q.x); d=Math.max(d,q.y); }
        window.__log.push({fill, area:Math.round((c-a)*(d-b)), box:[Math.round(a),Math.round(b),Math.round(c),Math.round(d)]});
      }
      return op(pts,fill,stroke,lw);
    };
    drawScene();
  });
  const log = await page.evaluate(()=>window.__log.sort((x,y)=>y.area-x.area).slice(0,10));
  console.log(JSON.stringify(log,null,1));
  await browser.close();
})();
