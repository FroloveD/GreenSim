// P1 security regression tests: imported saves are untrusted and must not inject HTML.
const { M } = require('./test_lib.js');
let fails=0;
const check=(name,ok,extra)=>{
  console.log((ok?'✅ ':'❌ ')+name+(extra!==undefined?'  '+extra:''));
  if(!ok)fails++;
};
const throws=fn=>{try{fn();return false;}catch(e){return true;}};

check('escapeHTML нейтрализует теги и атрибуты событий',
  M.escapeHTML(`<img src=x onerror="alert(1)">& 'quoted'`) ===
  '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp; &#39;quoted&#39;');

{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:23,campaign:true});
  const pack=JSON.parse(M.serializeWorld(w));
  pack.world.mail=[{id:'mail-1',subj:'<svg onload="alert(1)">',body:'<img src=x onerror="alert(1)">',
    read:false,opts:[{label:'<script>alert(1)</script>',desc:'" autofocus onfocus="alert(1)'}]}];
  pack.world.log=[{t:'<b>day</b>',m:'<iframe src=x>',k:'" onclick="alert(1)'}];
  pack.world.contracts=[{id:'contract-1',label:'<object data=x>',done:false}];
  const loaded=M.deserializeWorld(JSON.stringify(pack)).world;
  check('импорт сохраняет текст письма без выполнения разметки',
    loaded.mail[0].subj.startsWith('<svg')&&loaded.mail[0].opts[0].label.startsWith('<script'));
  check('журнал сохраняет атакующие строки как обычные данные',
    loaded.log[0].m==='<iframe src=x>'&&loaded.log[0].k.startsWith('"'));
  check('название контракта остаётся обычным текстом',loaded.contracts[0].label==='<object data=x>');
  const strings=[loaded.mail[0].subj,loaded.mail[0].body,loaded.mail[0].opts[0].label,
    loaded.mail[0].opts[0].desc,loaded.log[0].t,loaded.log[0].m,loaded.log[0].k,loaded.contracts[0].label];
  check('каждая строка из сохранения безопасна при HTML-выводе',
    strings.every(v=>!/[<>"']/.test(M.escapeHTML(v))));
}

{
  const malicious=JSON.parse('{"v":2,"world":{"__proto__":{"polluted":true}}}');
  check('сохранение с ключом __proto__ отклоняется',throws(()=>M.deserializeWorld(malicious)));
  check('прототип Object не изменён',{}.polluted===undefined);
}
{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:24});
  const pack=JSON.parse(M.serializeWorld(w));
  pack.world.mail=[{id:'x',subj:12,body:'body',read:false,opts:[]}];
  check('некорректная структура письма отклоняется',throws(()=>M.deserializeWorld(pack)));
  const oversized=JSON.parse(M.serializeWorld(w));
  oversized.world.untrustedText='x'.repeat(200001);
  check('слишком длинное текстовое поле отклоняется',throws(()=>M.deserializeWorld(oversized)));
  const legacy=JSON.parse(M.serializeWorld(w));legacy.v=1;
  check('старый формат v1 продолжает загружаться',
    M.deserializeWorld(legacy).world.day===w.day);
}
console.log(fails?\`\\nпровалено проверок безопасности: ${fails}\`:'\\nвсе проверки безопасности прошли');
process.exit(fails?1:0);
