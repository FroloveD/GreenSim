const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  for (const vp of [{w:390,h:844,n:'phone'},{w:1024,h:768,n:'tablet'},{w:1280,h:800,n:'desktop'}]){
    const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const page = await b.newPage({ viewport:{width:vp.w, height:vp.h}, hasTouch:true });
    const errs=[]; page.on('pageerror', e=>errs.push(e.message));
    await page.goto('http://localhost:8080/index.html?t='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(700);
    await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame(); });
    await page.waitForTimeout(600);
    const st = ()=> page.evaluate(()=>({yaw:+cam.yaw.toFixed(3), pitch:+cam.pitch.toFixed(3), ptrs: ptrs.size, dragging}));
    const before = await st();
    const cdp = await page.context().newCDPSession(page);
    const cx = Math.round(vp.w/2), cy = Math.round(vp.h*0.45);
    const el = await page.evaluate(([x,y])=>{ const e=document.elementFromPoint(x,y); return e?(e.id||e.className||e.tagName):'null'; }, [cx,cy]);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:cx,y:cy,id:1}]});
    for (let i=1;i<=12;i++){
      await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:cx+i*10, y:cy+i*2, id:1}]});
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    await page.waitForTimeout(200);
    const after = await st();
    console.log(vp.n, 'элемент:', el, 'до:', JSON.stringify(before), 'после:', JSON.stringify(after),
      before.yaw===after.yaw?'❌ НЕ ВРАЩАЕТСЯ':'✅ вращается', errs[0]||'');
    await b.close();
  }
})();
