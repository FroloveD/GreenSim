// DLI и фотопериод: нормы культур, суточный интеграл, досветка и диагностические объяснения.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CROPS,makeWorld,stepWorld,dliInfo,dayLength,diagnose};
`)();

let fails = 0;
const ok = (c, m, extra)=>{ if(!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };
const close = (a,b,t=0.01)=>Math.abs(a-b)<=t;

// 1. Нормы DLI и фотопериода заданы для всех культур.
const crops = Object.keys(M.CROPS);
ok(crops.every(k=>M.CROPS[k].dliMin>0 && M.CROPS[k].dliMin<M.CROPS[k].dliTgt &&
  M.CROPS[k].dliTgt<M.CROPS[k].dliMax && M.CROPS[k].photoMin>0 &&
  M.CROPS[k].photoMax>=M.CROPS[k].photoMin), 'у каждой культуры заданы согласованные нормы DLI и фотопериода');

// 2. Длина естественного дня зависит от даты и широты.
{
  const w = M.makeWorld({profile:'hobby',crop:'tomato',seed:11,site:'ekb',startDoy:15});
  const jan = M.dayLength(w,15), jun = M.dayLength(w,170);
  ok(jan < 9 && jun > 15, 'зимой день короче, летом длиннее', `янв ${jan.toFixed(1)} ч; июн ${jun.toFixed(1)} ч`);
  const south = M.makeWorld({profile:'hobby',crop:'tomato',seed:12,site:'sochi',startDoy:15});
  ok(M.dayLength(south,15)>jan, 'южная широта даёт более длинный зимний день');
}

// 3. Суточная сумма фиксируется в полночь и попадает в историю.
{
  const w = M.makeWorld({profile:'hobby',crop:'tomato',seed:21,site:'ekb',startDoy:15});
  w.hour = 0;
  for(let h=0;h<24;h++) M.stepWorld(w,1);
  ok(w.dliYest>0 && close(w.dliYest,w.history[w.history.length-1].dli), 'DLI сохраняется в истории после полных суток',
    w.dliYest.toFixed(2)+' моль/м²');
  ok(w.photoHoursYest>0 && w.photoHoursYest<=24, 'фотопериод считает только часы со светом', w.photoHoursYest.toFixed(1)+' ч');
  ok(w.dliAcc===0 && w.photoHoursDay===0, 'суточные счётчики обнуляются после полуночи');
}

// 4. Досветка увеличивает DLI и длительность освещения.
{
  const simulate = lamp=>{
    const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:31,site:'ekb',startDoy:15});
    w.hour=0; w.has.ledStrip=true; w.ctrl.lampEnabled=lamp;
    for(let h=0;h<24;h++) M.stepWorld(w,1);
    return w;
  };
  const off=simulate(false), on=simulate(true);
  ok(on.dliYest>off.dliYest+1, 'включённая досветка заметно увеличивает DLI',
    on.dliYest.toFixed(2)+' против '+off.dliYest.toFixed(2)+' моль/м²');
  ok(on.dliLampYest>0 && on.lampHoursYest>0, 'отдельно учитываются вклад лампы и её часы');
}

// 5. Диагностика сообщает причину, риск и действие.
{
  const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:41,site:'ekb',startDoy:15});
  for(let h=0;h<18;h++) M.stepWorld(w,1);
  const item=M.diagnose(w).items.find(x=>/^DLI /.test(x.text));
  ok(!!item, 'дефицит DLI попадает в диагностику', item && item.text);
  ok(!!(item&&item.why&&item.risk&&item.action), 'сообщение содержит почему, риск и что сделать');
}

// 6. Чрезмерно длинный фотопериод отдельно диагностируется.
{
  const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:51,site:'ekb',startDoy:15});
  w.hour=0; w.has.ledStrip=true; w.ctrl.lampEnabled=true;
  for(let h=0;h<24;h++) M.stepWorld(w,1);
  const item=M.diagnose(w).items.find(x=>/Фотопериод/.test(x.text));
  ok(!!item, 'слишком длинный фотопериод обнаруживается', item && item.text);
}

console.log(fails ? `\\nПРОВАЛЕНО: ${fails}` : '\\nDLI и фотопериод: проверки пройдены');
process.exit(fails?1:0);
