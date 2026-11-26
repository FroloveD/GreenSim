const fs=require('fs');
const src=fs.readFileSync('/home/user/greenhouse/parts/core.js','utf8');
const a=src.indexOf('// === SIM CORE START ==='), b=src.indexOf('// === SIM CORE END ===');
const M=new Function(src.slice(a,b)+'\n return {CFG,CROPS,makeWorld,stepWorld,harvestAll,buyItem,fertFactors};')();
const w=M.makeWorld({profile:'farm',crop:'tomato',seed:777});
let harvest=0;
for(let d=1; d<=40; d++){
  if (w.stock.fertKg<20) w.stock.fertKg+=40;
  if (w.stock.co2Kg<10) w.stock.co2Kg+=50;
  M.buyItem(w,'repair');   // «игрок» ремонтирует сразу
  for(let h=0;h<24;h++) for(let k=0;k<4;k++) M.stepWorld(w,0.25);
  const r=M.harvestAll(w); harvest+=r.kg;
  if (d%5===0){
    const p=w.plants[0];
    const grow=p.fruits.filter(f=>!f.harvested&&!f.ripe);
    const mass=grow.reduce((s,f)=>s+f.mass,0);
    const f=M.fertFactors(w);
    console.log(`д${String(d).padStart(2)} T=${w.temp.toFixed(1)} RH=${w.rh.toFixed(0)} CO2=${w.co2.toFixed(0)} ассим/сут=${w.assimRate.toFixed(1)} LAI=${w.light.canopyLAI.toFixed(2)} б-нь=${w.disease.toFixed(2)} питание=${f.nutri.toFixed(2)} стресс=${p.stress.toFixed(2)} плодов=${grow.length}(сумма ${mass.toFixed(0)}г) carbon=${p.carbonStatus.toFixed(1)} сбор=${harvest.toFixed(0)}кг энергия=${w.cost.energy.toFixed(0)}€`);
  }
}
