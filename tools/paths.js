/* Куда класть скриншоты и как находить корень репозитория.
   Раньше пути вида shotFile('x.png') были вписаны руками — на Windows и в CI
   таких папок нет, и браузерные проверки падали на сохранении кадра. */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');

/* путь к кадру в папке shots/ (папка создаётся сама) */
function shotFile(name){
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, String(name).replace(/^[\/\\]+/, ''));
}

module.exports = { ROOT, SHOTS, shotFile };
