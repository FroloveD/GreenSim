// node tools/crop.js in.png out.png x y w h scale
const { chromeless } = {};
const fs=require('fs');
(async()=>{
  const { chromium: pw } = require('playwright-core');
  const chromium = require('@sparticuz/chromium');
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const p = await b.newPage();
  const [inp,out,x,y,w,h,sc] = process.argv.slice(2);
  const b64 = fs.readFileSync(inp).toString('base64');
  await p.setContent(`<body style="margin:0;background:#000"><canvas id=c></canvas><script>
    const im=new Image(); im.onload=()=>{const c=document.getElementById('c'),g=c.getContext('2d');
      c.width=${w}*${sc||2}; c.height=${h}*${sc||2};
      g.imageSmoothingEnabled=false; g.drawImage(im,${x},${y},${w},${h},0,0,c.width,c.height); document.title='ok';};
    im.src='data:image/png;base64,${b64}';</script></body>`);
  await p.waitForFunction(()=>document.title==='ok', {timeout:15000});
  await p.locator('#c').screenshot({path:out});
  await b.close();
})();
