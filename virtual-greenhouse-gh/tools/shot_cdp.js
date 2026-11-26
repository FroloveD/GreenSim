// снимок через CDP: Playwright-скриншот иногда ждёт «стабильный кадр» и падает по таймауту
async function cdpShot(page, path){
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format:'png' });
  require('fs').writeFileSync(path, Buffer.from(data, 'base64'));
  await cdp.detach();
}
module.exports = { cdpShot };
