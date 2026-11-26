const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
const crypto = require('crypto');
const hash = s => crypto.createHash('md5').update(s||'').digest('hex').slice(0,8);

(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:800} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  page.on('console', m=>{ if (m.type()==='error') errs.push('console: '+m.text()); });
  await page.goto('http://localhost:8080/index.html?c2='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(800);
  await page.evaluate(()=>{ pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<30;d++){ for(let k=0;k<24;k++) VG.sim(1); } renderAll(); });
  await page.waitForTimeout(400);

  const snap = ()=> page.evaluate(()=>document.getElementById('scene').toDataURL().length + ':' + cam.yaw.toFixed(4));
  const camState = ()=> page.evaluate(()=>({mode:cam.mode, yaw:+cam.yaw.toFixed(3), pitch:+cam.pitch.toFixed(3), zoom:+cam.zoom.toFixed(3)}));
  const drag = async (x0,y0,dx,dy,steps=12,btn)=>{
    await page.mouse.move(x0,y0);
    await page.mouse.down(btn?{button:btn}:{});
    for(let i=1;i<=steps;i++){ await page.mouse.move(x0+dx*i/steps, y0+dy*i/steps); await page.waitForTimeout(20); }
    await page.mouse.up(btn?{button:btn}:{});
    await page.waitForTimeout(150);
  };

  // сценарий 1: обычный драг по центру
  let s0 = await snap();
  await drag(640, 400, 220, 40);
  let s1 = await snap();
  console.log('1) драг по центру:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  // сценарий 2: драг по пустому месту над сценой (верхняя часть)
  s0 = await snap();
  await drag(640, 200, -200, 30);
  s1 = await snap();
  console.log('2) драг вверху:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  // сценарий 3: после нажатия кнопки вида — сразу драг
  await page.click('#camBar [data-view="top"]');
  await page.waitForTimeout(200);
  await page.click('#camBar [data-view="free"]');
  s0 = await snap();
  await drag(640, 420, 180, -20);
  s1 = await snap();
  console.log('3) драг сразу после кнопки вида:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  // сценарий 4: медленный драг (по 2 px)
  s0 = await snap();
  await drag(600, 430, 100, 0, 50);
  s1 = await snap();
  console.log('4) медленный драг:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  // сценарий 5: драг, начатый над панелью и ушедший на сцену
  s0 = await snap();
  await drag(150, 300, 400, 0);
  s1 = await snap();
  console.log('5) старт с панели:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  // сценарий 6: элемент под точкой (что реально получает pointerdown)
  const el = await page.evaluate(()=>{
    const e = document.elementFromPoint(640,400);
    return e ? (e.id || e.className || e.tagName) : 'null';
  });
  console.log('6) элемент в центре сцены:', el);

  // сценарий 7: тело/страница перехватывает?
  const hitTest = await page.evaluate(()=>{
    const log=[];
    const c = document.getElementById('scene');
    const h = e => log.push('pointerdown на ' + (e.target.id||e.target.className||e.target.tagName));
    c.addEventListener('pointerdown', h, {once:true});
    return new Promise(res=>{ setTimeout(()=>res(log), 50); });
  });

  // сценарий 8: touch-drag одним пальцем через CDP
  const cdp = await page.context().newCDPSession(page);
  s0 = await snap();
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:640,y:400,id:1}]});
  for (let i=1;i<=10;i++){
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:640+i*16, y:400+i*3, id:1}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await page.waitForTimeout(150);
  s1 = await snap();
  console.log('8) тач одним пальцем:', hash(s0)===hash(s1)?'КАДР НЕ ИЗМЕНИЛСЯ':'кадр изменился', JSON.stringify(await camState()));

  console.log('ошибки:', errs.length?errs.slice(0,4).join(' | '):'нет');
  await b.close();
})();
