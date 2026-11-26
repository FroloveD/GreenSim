// Снимок через CDP: Playwright-скриншот иногда ждёт «стабильный кадр» и падает по таймауту.
// Каталог создаётся автоматически: тесты должны работать и на чистом CI runner.
const fs = require('fs');
const path = require('path');
async function cdpShot(page, filePath){
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  } finally {
    await cdp.detach();
  }
}
module.exports = { cdpShot };
