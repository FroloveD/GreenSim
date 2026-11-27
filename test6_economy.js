// Актуальные проверки экономики: цены, покупки, склад, продажи, время и сохранения.
// Запуск: node test6_economy.js
const { M, runSeason } = require('./test_lib.js');
let fails=0;
const check=(name,ok,extra)=>{
  console.log((ok?'✅ ':'❌ ')+name+(extra!==undefined?'  '+extra:''));
  if(!ok)fails++;
};
const finite=v=>Number.isFinite(v);

{
  const w=M.makeWorld({profile:'farm',crop:'tomato',seed:101});
  check('новый мир имеет корректный стартовый баланс',finite(w.money)&&w.money>0);
  check('цена выбранной культуры положительна и конечна',
    finite(M.priceToday(w,w.crop))&&M.priceToday(w,w.crop)>0);
  check('цены всех культур доступны',Object.keys(M.CROPS).every(c=>{
    const p=M.priceToday(w,c);return finite(p)&&p>0;
  }));
}

{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:102});
  const money0=w.money;
  M.addLot(w,'lettuce',10,1);
  check('сбор добавляет партию на склад',w.wh.lots.some(l=>l.crop==='lettuce'&&l.kg>=10));
  const sold=M.sellHarvest(w,'lettuce',null);
  check('продажа партии возвращает положительную выручку',sold&&finite(sold.eur)&&sold.eur>0);
  check('выручка увеличивает баланс',w.money>money0);
}

{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:103,campaign:true});
  const item=M.SHOP().flatMap(g=>g.items).find(x=>x.id==='fert2');
  const cost=M.shopItemCost(w,item),before=w.money,stock=w.stock.fertKg;
  const result=M.buyItem(w,'fert2');
  check('стоимость товара магазина рассчитана корректно',finite(cost)&&cost>0);
  check('покупка удобрения проходит и пополняет запас',
    result.ok&&w.stock.fertKg===stock+2);
  check('покупка списывает рассчитанную сумму',
    Math.abs((before-w.money)-cost)<0.011);
}

{
  const w=M.makeWorld({profile:'farm',crop:'tomato',seed:104});
  const day=w.day,hour=w.hour;
  for(let i=0;i<48;i++)M.stepWorld(w,0.5);
  check('игровое время продвигается после 24 часов симуляции',w.day>day||w.hour!==hour);
  check('климатические показатели остаются конечными',
    [w.temp,w.rh,w.co2,w.moist,w.money].every(finite));
}

{
  const w=M.makeWorld({profile:'farm',crop:'cherry',seed:105});
  w.money=12345.67;
  const restored=M.deserializeWorld(M.serializeWorld(w)).world;
  check('сохранение восстанавливает день, культуру и баланс',
    restored.day===w.day&&restored.crop===w.crop&&restored.money===w.money);
  check('восстановленное состояние сохраняет конечные параметры',
    [restored.temp,restored.rh,restored.co2,restored.moist].every(finite));
}

{
  const a=runSeason('hobby','tomato',30,106);
  const b=runSeason('hobby','tomato',30,106);
  check('повторяемый seed даёт одинаковый финансовый результат',
    finite(a.profit)&&a.profit===b.profit);
  check('тестовый сезон не создаёт отрицательную массу урожая',
    finite(a.w.harvestedKg)&&a.w.harvestedKg>=0);
}
console.log(fails?'\nпровалено проверок экономики: '+fails:'\nвсе проверки экономики прошли');
process.exit(fails?1:0);
