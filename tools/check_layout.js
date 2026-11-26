const { launch } = require('./browser');
const { cdpShot } = require('./shot_cdp.js');
(async()=>{
  const sizes = [
    {n:'tablet', w:1024, h:768, touch:true},
    {n:'phone',  w:390,  h:844, touch:true}
  ];
  for (const sz of sizes){
    const b = await launch();
    const page = await b.newPage({ viewport:{width:sz.w,height:sz.h} });
    const ctx = { close: ()=>b.close() };
    const errs=[]; page.on('pageerror', e=>errs.push(e.message));
    await page.goto('http://localhost:8080/index.html?l='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(800);
    await page.screenshot({path:`/home/user/shots/lay_${sz.n}_start.png`});
    await page.evaluate(()=>{ document.getElementById('startBtn').click(); });
    await page.waitForTimeout(900);
    await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; startGame();
      for(let d=0;d<20;d++){ for(let k=0;k<24;k++) VG.sim(1); } VG.harvest(); if(world.wh.lots.length) VG.sell(); renderAll(); });
    await page.waitForTimeout(200);
    await page.evaluate(()=>VG.freeze(true));
    await cdpShot(page, `/home/user/shots/lay_${sz.n}_scene.png`);
    await page.evaluate(()=>VG.freeze(false));
    // открыть док
    const first = await page.evaluate(()=>{ const b=document.querySelector('#dock button'); if(!b) return null; b.click(); return b.textContent; });
    await page.waitForTimeout(500);
    await page.evaluate(()=>VG.freeze(true));
    await cdpShot(page, `/home/user/shots/lay_${sz.n}_sheet.png`);
    await page.evaluate(()=>VG.freeze(false));
    const info = await page.evaluate(()=>({
      kind: layoutKind(), dock: !!document.getElementById('dock').children.length,
      tab: document.querySelector('#dock button.on')?.textContent || null,
      sheetOpen: document.body.classList.contains('sheet-open'),
      sel: [...document.querySelectorAll('#dashGrid .panel.sel')].map(p=>p.dataset.p),
      canvas: (()=>{ const r=document.getElementById('scene').getBoundingClientRect(); return [Math.round(r.width),Math.round(r.height)]; })(),
      scrollX: document.documentElement.scrollWidth > window.innerWidth
    }));
    console.log(sz.n, JSON.stringify(info), 'первая кнопка:', first, 'ошибки:', errs.length?errs[0]:'нет');
    await ctx.close();
  }
})();
