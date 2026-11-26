// Один запуск браузера для всех проверок: в песочнице — playwright-core +
// @sparticuz/chromium, в GitHub Actions — обычный playwright со своим chromium.
// Так набор тестов не зависит от того, какой из двух комплектов установлен.
async function launch(){
  // 1) как в песочнице и в лямбдах: свой бинарь chromium
  try {
    const { chromium } = require('playwright-core');
    const chromiumBin = require('@sparticuz/chromium');
    return await chromium.launch({ args: chromiumBin.args, executablePath: await chromiumBin.executablePath(), headless: true });
  } catch (e) {
    if (!/Cannot find module/.test(String(e && e.message))) throw e;
  }
  // 2) как в CI: playwright ставит chromium сам (`npx playwright install chromium`)
  const { chromium } = require('playwright');
  return chromium.launch({ headless: true });
}
module.exports = { launch };
