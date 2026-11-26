// Локальная сборка GreenSim для Windows без зависимости от Git Bash.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const parts = ['parts/head.html', 'parts/core.js', 'parts/render.js', 'parts/ui.js', 'parts/tail.html'];
const output = path.join(root, 'index.html');

try {
  const html = parts.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('');
  const markerCount = (html.match(/SIM CORE START/g) || []).length;
  if (markerCount !== 1) {
    throw new Error('Маркер SIM CORE START должен встречаться ровно один раз; найдено: ' + markerCount);
  }
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  if (start < 0 || end < start) throw new Error('Не найден основной блок script в собранном HTML.');
  new Function(html.slice(start + 8, end));
  fs.writeFileSync(output, html, 'utf8');
  console.log('Сборка успешна: index.html (' + Math.round(Buffer.byteLength(html) / 1024) + ' КБ).');
} catch (error) {
  console.error('ОШИБКА СБОРКИ: ' + error.message);
  process.exitCode = 1;
}
