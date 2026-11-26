// Реальная погода: применение архива, пропуски дат и возврат к климатическим нормам.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','parts','core.js'),'utf8');
const a=src.indexOf('// === SIM CORE START ==='),b=src.indexOf('// === SIM CORE END ===');
const M=new Function(src.slice(a,b)+`
 return {makeWorld,applyWeatherTable,realWeatherAt,outsideClimate};
`)();
let fails=0;
const ok=(c,m,x)=>{if(!c)fails++;console.log((c?'✅ ':'❌ ')+m+(x!==undefined?' — '+x:''));};

{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:12,site:'ekb',startDoy:15});
 ok(M.realWeatherAt(w,15)===null,'без архива используется базовая модель');
 const valid=M.applyWeatherTable(w,[
  {doy:15,t:-18,cloud:0.9},{doy:16,t:-16,cloud:0.7},{doy:18,t:-12,cloud:0.3}
 ],{source:'test-fixture',at:123});
 ok(valid,'валидная таблица принимается');
 const exact=M.realWeatherAt(w,15),nearest=M.realWeatherAt(w,17);
 ok(exact&&exact.t===-18&&Math.abs(exact.cloud-0.9)<1e-8,'точная дата берётся из архива',exact&&exact.t);
 ok(nearest&&nearest.t===-16,'пропущенная дата заполняется ближайшим наблюдением',nearest&&nearest.t);
 const outside=M.outsideClimate(w,15,9);
 ok(outside.real===true&&Math.abs(outside.temp-(-18))<0.01,'реальная температура участвует в расчёте наружного климата',outside.temp);
 ok(outside.dayLen>0&&outside.sunFrac>=0.02,'длина дня и доля солнца продолжают рассчитываться');
 w.realWeather=null;
 ok(M.realWeatherAt(w,15)===null&&!M.outsideClimate(w,15,9).real,'сброс возвращает модель к нормам');
}

{
 const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:13});
 ok(M.applyWeatherTable(w,[],{})===false,'пустая таблица отклоняется');
 ok(M.applyWeatherTable(w,[{doy:15,t:null,cloud:0.5}],{})===false,'таблица без валидной температуры отклоняется');
}

console.log(fails?`\\nПРОВАЛЕНО: ${fails}`:'\\nАрхив погоды: проверки пройдены');
process.exit(fails?1:0);
