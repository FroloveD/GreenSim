// Рецепты EC/pH по стадии культуры и мягкая оценка отклонения.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','parts','core.js'),'utf8');
const a=src.indexOf('// === SIM CORE START ==='),b=src.indexOf('// === SIM CORE END ===');
const M=new Function(src.slice(a,b)+`
 return {CROPS,makeWorld,cropStage,stageRecipe,stageFit,fertFactors,diagnose};
`)();
let fails=0;
const ok=(c,m,x)=>{if(!c)fails++;console.log((c?'✅ ':'❌ ')+m+(x!==undefined?' — '+x:''));};

// 1. Для каждой культуры есть три корректных рецепта.
const recipes=Object.keys(M.CROPS).every(id=>['start','veg','fruit'].every(k=>{
 const r=M.stageRecipe(Object.assign(M.makeWorld({profile:'hobby',crop:id,seed:7}),{plants:[]}));
 const x=M.STAGE_RECIPES[id]&&M.STAGE_RECIPES[id][k];
 return !!(x&&x.ec&&x.ph&&x.why&&x.ec[0]<x.ec[1]&&x.ph[0]<x.ph[1]);
}));
ok(recipes,'все культуры имеют рецепты старта, роста и финальной стадии');

// 2. Начальное состояние распознаётся как стартовая стадия.
{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:11});
 ok(M.cropStage(w).key==='start','новая посадка начинается со стадии укоренения',M.cropStage(w).name);
 const r=M.stageRecipe(w);
 ok(r.ec[0]<r.ec[1]&&r.ph[0]<r.ph[1]&&r.why.length>10,'рецепт содержит диапазоны EC/pH и объяснение',r.name);
}

// 3. Внутри коридора штрафа нет; далеко за коридором он мягкий и ограниченный.
{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:13});
 const good=M.stageFit(w,1.9,5.8);
 const poor=M.stageFit(w,3.6,6.8);
 ok(good>=0.99,'рекомендованный раствор не штрафуется',good.toFixed(3));
 ok(poor<0.95&&poor>=0.90,'сильное отклонение даёт ограниченный штраф, не обвал',poor.toFixed(3));
 const base=M.fertFactors(w).nutri;
 w.ctrl.ecSet=3.6;w.ctrl.phSet=6.8;
 ok(M.fertFactors(w).nutri<base,'отклонение от рецепта снижает усвоение питания');
}

// 4. Диагностика объясняет отклонение и предлагает действие.
{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:17});
 w.ctrl.ecSet=3.6;w.ctrl.phSet=6.8;
 const item=M.diagnose(w).items.find(x=>/Раствор не под фазу/.test(x.text));
 ok(!!item,'неподходящий раствор попадает в диагностику',item&&item.text);
 ok(!!(item&&item.why&&item.risk&&item.action),'есть причина, риск и рекомендация');
}

console.log(fails?`\\nПРОВАЛЕНО: ${fails}`:'\\nРецепты по стадиям: проверки пройдены');
process.exit(fails?1:0);
