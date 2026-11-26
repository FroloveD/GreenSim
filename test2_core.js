const fs=require('fs');
const src=fs.readFileSync('/home/user/greenhouse/parts/core.js','utf8');
const a=src.indexOf('// === SIM CORE START ==='), b=src.indexOf('// === SIM CORE END ===');
const M=new Function(src.slice(a,b)+'\n return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,sellHarvest,whUsedL,storeKg,cloneWorld,startForecast,stepForecast,forecastSummary,buyItem,signContract,pruneLower,SHOP,totalLAI,leafAssimilation,sunPosition};')();

function run(profile, crop, days, tweaks){
  const w=M.makeWorld({profile, crop, seed:777});
  if (tweaks) tweaks(w);
  let nan=false;
  for(let d=1; d<=days; d++){
    if (w.stock.fertKg<20) w.stock.fertKg+=40;
    if (w.stock.co2Kg<10) w.stock.co2Kg+=60;
    if (w.stock.waterM3<10) w.stock.waterM3+=100;
    M.buyItem(w,'repair');
    for(let h=0;h<24;h++) for(let k=0;k<4;k++) M.stepWorld(w,0.25);
    M.harvestAll(w);
    if (w.wh.lots.length) M.sellHarvest(w, w.crop, null);
    for (const k in w){ if (typeof w[k]==='number' && !isFinite(w[k])) { nan=true; console.log('NaN в поле', k, 'на дне', d); } }
  }
  const cost=Object.values(w.cost).reduce((s,x)=>s+x,0);
  return {w, nan, cost, profit:w.money-w.startMoney};
}

console.log('--- профили × культуры (90 дней) ---');
for (const prof of ['hobby','farm','agro']) for (const crop of ['tomato','cherry','cucumber','lettuce']){
  const r=run(prof,crop,90);
  const w=r.w;
  console.log(`${prof.padEnd(6)} ${crop.padEnd(9)} деньги=${w.money.toFixed(0).padStart(8)} прибыль=${r.profit.toFixed(0).padStart(8)} урож=${w.harvestedKg.toFixed(0).padStart(5)}кг кг/м²=${(w.harvestedKg/w.area).toFixed(1).padStart(5)} энергия=${w.cost.energy.toFixed(0).padStart(6)} CO2=${w.cost.co2.toFixed(0).padStart(5)} фикс=${w.cost.fixed.toFixed(0).padStart(6)} LAI=${w.light.canopyLAI.toFixed(2)} NaN=${r.nan?'ДА':'нет'}`);
}

console.log('\n--- прогноз ---');
{
  const w=M.makeWorld({profile:'farm',crop:'tomato',seed:5});
  for(let h=0;h<24*10;h++) M.stepWorld(w,0.25);
  const t0=Date.now();
  const fc=M.startForecast(w,7);
  let guard=0;
  while(fc.done<fc.days && guard++<200) M.stepForecast(fc,10);
  const s=M.forecastSummary(fc);
  console.log('дней прогноза', fc.results.length, 'за', Date.now()-t0, 'мс');
  console.log(JSON.stringify(s));
}

console.log('\n--- покупки/контракты ---');
{
  const w=M.makeWorld({profile:'farm',crop:'tomato'});
  console.log('led:', JSON.stringify(M.buyItem(w,'led')), 'деньги', w.money);
  console.log('fert100:', JSON.stringify(M.buyItem(w,'fert100')), 'запас', w.stock.fertKg);
  console.log('repair (всё ок):', JSON.stringify(M.buyItem(w,'repair')));
  console.log('контракт:', M.signContract(w,0), w.contracts.length);
  console.log('магазин групп:', M.SHOP().map(g=>g.group+':'+g.items.length).join(', '));
}
