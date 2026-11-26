#!/usr/bin/env bash
# Сборка одного файла index.html из частей.
set -e
cd "$(dirname "$0")"
cat parts/head.html parts/core.js parts/render.js parts/ui.js parts/tail.html > index.html
# проверки на дубли маркеров и на синтаксис
n=$(grep -c "SIM CORE START" index.html)
if [ "$n" != "1" ]; then echo "ОШИБКА: маркер ядра встречается $n раз"; exit 1; fi
node -e '
const fs=require("fs");
const s=fs.readFileSync("index.html","utf8");
const js=s.slice(s.indexOf("<script>")+8, s.lastIndexOf("</script>"));
try { new Function(js); } catch(e){ console.log("СИНТАКСИС: "+e.message); process.exit(1); }
console.log("собрано: "+ (s.length/1024).toFixed(0) +" КБ");
'
