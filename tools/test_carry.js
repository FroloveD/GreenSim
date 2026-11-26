// Межсезонный перенос: капитал, оборудование, запасы, склад, репутация и долг.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','parts','core.js'),'utf8');
const a=src.indexOf('// === SIM CORE START ==='),b=src.indexOf('// === SIM CORE END ===');
const M=new Function(src.slice(a,b)+`
 return {makeWorld,carrySnapshot,applyCarry,priceToday};
`)();
let fails=0;
const ok=(c,m,x)=>{if(!c)fails++;console.log((c?'✅ ':'❌ ')+m+(x!==undefined?' — '+x:''));};
{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:31});
 w.has.led=true;w.has.screen=true;w.upg.worker=true;w.wh.sections=5;
 w.money=4200;w.stock.fertKg=17;w.stock.waterM3=23;
 w.missionsDone=6;w.harvestedKg=900;w.contracts=[{done:true}];
 w.camp={ch:2,seen:['mail-a']};w.net.houses=[{crop:'tomato',price:3.2}];
 const carry=M.carrySnapshot(w);
 ok(carry.has.led&&carry.has.screen&&carry.upg.worker,'оборудование и апгрейды попадают в снимок');
 ok(carry.sections===5&&carry.money===4200&&carry.stock.fertKg===17,'деньги, склад и запасы сохраняются');
 ok(carry.rep>0&&carry.seasons===2,'репутация и номер сезона рассчитываются',carry.rep);
 const next=M.makeWorld({profile:'hobby',crop:'tomato',seed:32,site:'ekb',startDoy:210,carry});
 ok(next.has.led&&next.has.screen&&next.upg.worker,'новый сезон восстанавливает оборудование');
 ok(next.money===4200&&next.wh.sections===5&&next.stock.fertKg>=17,'капитал, секции и запас удобрений переехали');
 ok(next.day===1&&next.harvestedKg===0&&next.history.length===0,'растение и история нового сезона начинаются заново');
 ok(next.rep===carry.rep&&next.seasons===2&&next.repF>1,'репутация повышает коэффициент цены',next.repF.toFixed(3));
 const plain=M.makeWorld({profile:'hobby',crop:'tomato',seed:32,site:'ekb',startDoy:210});
 ok(M.priceToday(next)>M.priceToday(plain),'репутация даёт надбавку к цене');
 ok(next.net.houses.length===1&&next.camp.ch===2,'филиалы и глава кампании переносятся');
}
{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:41});
 w.money=-500;
 const carry=M.carrySnapshot(w);
 const next=M.makeWorld({profile:'hobby',crop:'tomato',seed:42,carry});
 ok(next.money===-500,'долг не обнуляется при смене сезона',next.money);
}
console.log(fails?`\\nПРОВАЛЕНО: ${fails}`:'\\nПеренос сезона: проверки пройдены');
process.exit(fails?1:0);
