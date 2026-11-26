const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  await page.goto('http://localhost:8080/index.html?h='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);
  const r = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; startGame();
    world.soldEur = 400; campaignTick(world); answerMail(world,'goal1',0);
    for (let d=0; d<8; d++){ for (let k=0;k<24;k++) VG.sim(1); }
    const before = world.mail.map(m=>m.id);
    const letter = world.mail.find(m=>m.id==='hydro');
    campaignTick(world);
    answerMail(world,'hydro',0);
    return {mail:before.join(','), hasHydro:!!letter, sys:world.sys,
      sysAllowed: ['soil','coco','dwc','nft','aero'].map(id=>id+':'+sysAllowed(world,id)).join(' ')};
  });
  console.log(JSON.stringify(r,null,0));
  await b.close();
})();
