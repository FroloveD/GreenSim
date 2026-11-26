const { launch } = require('./browser');
(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1400, height:900} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?k='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  const shopInfo = ()=> page.evaluate(()=>{
    const cards = [...document.querySelectorAll('#shopBody .card')];
    return {
      total: cards.length,
      locked: cards.filter(c=>c.classList.contains('locked')).map(c=>c.querySelector('b').textContent),
      withWhy: cards.filter(c=>c.querySelector('.why')).length
    };
  });

  await page.evaluate(()=>{ pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; startGame(); });
  await page.waitForTimeout(300);
  await page.evaluate(()=>VG.page('shop'));
  await page.waitForTimeout(400);
  console.log('глава 0, магазин:', JSON.stringify(await shopInfo()));

  // письмо про первые покупки
  await page.evaluate(()=>{ for(let d=0;d<4;d++){ for(let k=0;k<24;k++) VG.sim(1); } campaignTick(world); });
  console.log('письма на Д5:', await page.evaluate(()=>world.mail.map(m=>m.id).join(',')));

  // балкон → комната
  await page.evaluate(()=>{ world.soldEur=400; campaignTick(world);
    answerMail(world,'goal1',0); renderAll(); renderShop(); });
  await page.waitForTimeout(300);
  console.log('после переезда профиль:', await page.evaluate(()=>world.profile), 'глава:', await page.evaluate(()=>world.camp.ch));
  console.log('глава 1, магазин:', JSON.stringify(await shopInfo()));
  console.log('письма:', await page.evaluate(()=>world.mail.map(m=>m.id).join(',')));

  // комната → теплица
  await page.evaluate(()=>{ world.soldEur=3000; campaignTick(world); answerMail(world,'goal2',0); renderAll(); renderShop(); });
  await page.waitForTimeout(300);
  console.log('теплица, глава:', await page.evaluate(()=>world.camp.ch), 'магазин:', JSON.stringify(await shopInfo()));
  console.log('письма:', await page.evaluate(()=>world.mail.map(m=>m.id).join(',')));

  // письмо о сети
  await page.evaluate(()=>{ world.camp.soldBase = (world.soldEur||0) - 3100; campaignTick(world); });
  console.log('письма после 3 100 продаж:', await page.evaluate(()=>world.mail.map(m=>m.id).join(',')));

  const netInfo = await page.evaluate(()=>{
    answerMail(world,'goal3',0); renderAll();
    const panel = document.querySelector('#dashGrid .panel[data-p="net"]');
    const before = world.money;
    world.money = 20000;
    const r1 = netBuy(world, 'tomato');
    const r2 = netBuy(world, 'cherry');
    const t = netTotal(world);
    // сутки
    const m0 = world.money, rev0 = world.revenue;
    for (let k=0;k<24;k++) VG.sim(1);
    renderAll();
    return {ch:world.camp.ch, panel: getComputedStyle(panel).display, r1:r1.msg, r2:r2.msg,
      houses:world.net.houses.length, netDay:+t.net.toFixed(1), gross:+t.gross.toFixed(1), opex:+t.opex.toFixed(1),
      moneyDelta:+(world.money-m0).toFixed(1), revDelta:+(world.revenue-rev0).toFixed(1),
      cost: netCost(world), boxText: document.getElementById('netBox').innerText.replace(/\s+/g,' ').slice(0,180)};
  });
  console.log('сеть:', JSON.stringify(netInfo, null, 0));

  // письмо о завершении
  const done = await page.evaluate(()=>{
    world.camp.soldBase = (world.soldEur||0) - 13000;
    netBuy(world,'tomato'); world.money += 20000; netBuy(world,'tomato');
    campaignTick(world);
    return world.mail.map(m=>m.id).join(',');
  });
  console.log('письма после 3 филиалов и цели:', done);
  console.log('ошибки:', errs.length?errs.slice(0,3).join(' | '):'нет');
  await b.close();
})();
