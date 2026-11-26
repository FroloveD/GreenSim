const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('http://localhost:8080/index.html?pr='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  const out = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    const m0 = world.money, rev0 = world.revenue, cost0 = Object.values(world.cost).reduce((s,x)=>s+x,0);
    for (let d=0; d<20; d++){ for (let k=0;k<24;k++) VG.sim(1); }
    const m1 = world.money;
    const sumProfit = world.history.reduce((s,h)=>s+h.profit,0);
    const sumRev = world.history.reduce((s,h)=>s+h.rev,0);
    const sumCost = world.history.reduce((s,h)=>s+h.cost,0);
    const costNow = Object.values(world.cost).reduce((s,x)=>s+x,0);
    return {
      dMoney:+(m1-m0).toFixed(1), sumProfit:+sumProfit.toFixed(1),
      sumRev:+sumRev.toFixed(1), sumCost:+sumCost.toFixed(1),
      revTotal:+(world.revenue-rev0).toFixed(1), costTotal:+(costNow-cost0).toFixed(1),
      days: world.history.length,
      costBreak: Object.fromEntries(Object.entries(world.cost).map(([k,v])=>[k,+v.toFixed(1)]).filter(([k,v])=>v!==0)),
      negDays: world.history.filter(h=>h.profit<0).length,
      profitDay:+world.profitDay.toFixed(1), money:+world.money.toFixed(1)
    };
  });
  console.log(JSON.stringify(out,null,1));
  await b.close();
})();
