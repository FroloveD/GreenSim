// Проверка: index.html в репозитории ровно то, что собирается из parts/*.
// Ловит классическую ошибку «поправил parts, забыл ./build.sh».
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const PARTS = ['head.html', 'core.js', 'render.js', 'ui.js', 'tail.html'];
let fails = 0;
const ok = (c, m, extra)=>{ if(!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

const built = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const expected = PARTS.map(f=>fs.readFileSync(path.join(root,'parts',f),'utf8')).join('');
ok(built === expected, 'index.html совпадает со сборкой из parts/*',
   built === expected ? built.length+' символов' : `разница ${expected.length-built.length} символов — запустите ./build.sh`);

ok(built.length > 100000, 'index.html не пустой и не обрезан', (built.length/1024).toFixed(0)+' КБ');
ok(built.split('<script').length - 1 === 1 &&
   built.split('</script>').length - 1 === 1,
   'страница содержит ровно один script-блок');

// синтаксис всего скрипта
const js = built.slice(built.indexOf('<script>')+8, built.lastIndexOf('</script>'));
try { new Function(js); ok(true, 'синтаксис собранного скрипта корректен'); }
catch(e){ ok(false, 'синтаксис собранного скрипта корректен', e.message); }

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nСборка синхронна');
process.exit(fails?1:0);
