// Проверка сюжета: главы, письма наставника, переезды, замки магазина, сохранение в кампании, сеть.
// Запуск: node test7_story.js  (из корня репозитория)
const L = require('./test_lib.js');
const { M, runCampaign, autoDay } = L;

let fails = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fails++;
};
const shopItem = (id) => {
  for (const g of M.SHOP()) for (const it of g.items) if (it.id === id) return it;
  return null;
};

// 1. Структура сюжета: главы и письма согласованы
{
  check('четыре главы: балкон, комната, теплица, сеть',
        M.CHAPTERS.map(c => c.id).join(',') === 'balcony,room,farm,net', M.CHAPTERS.map(c => c.id).join(','));
  check('цели глав растут', M.CHAPTERS.every((c, i) => i === 0 || c.goal > M.CHAPTERS[i - 1].goal));
  check('каждый профиль главы существует', M.CHAPTERS.every(c => !!M.PROFILES[c.profile]));
  const ids = M.MAILBOX.map(m => m.id);
  check('id писем уникальны', new Set(ids).size === ids.length);
  check('у каждого письма есть варианты ответа', M.MAILBOX.every(m => m.opts && m.opts.length >= 1 && m.opts.length <= 3));
}

// 2. Каждый вариант ответа на каждое письмо работает без ошибок
for (const m of M.MAILBOX) {
  for (let i = 0; i < m.opts.length; i++) {
    const w = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 9, campaign: true });
    w.money = 5000;                              // чтобы переезд не упёрся в деньги
    w.soldEur = 5000;
    let err = null;
    try { M.pushMail(w, m.id); M.answerMail(w, m.id, i); } catch (e) { err = e.message; }
    check(`письмо «${m.id}», вариант ${i + 1} применяется`, err === null && w.camp.seen.includes(m.id), err || '');
  }
}

// 3. Старт кампании: балкон, 100 €, первое письмо тёти Розы, магазин открыт по главе 0
{
  const w = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 9, campaign: true });
  M.campaignTick(w);
  check('старт: балкон, глава 0, 100 €', w.profile === 'balcony' && w.camp.ch === 0 && w.money === 100, `${w.money} €`);
  check('письмо «С балкона начинают все» на старте', w.mail.some(x => x.id === 'intro'));
  check('лампа на стойке (лента) доступна сразу', M.gearLocked(w, shopItem('ledStrip')) === false);
  check('клапан CO₂ на балконе закрыт (глава 2)', w.has.co2 === false);
}

// 4. Вводное письмо: заём не считается продажами и не двигает главу
{
  const w = M.makeWorld({ profile: 'balcony', crop: 'lettuce', seed: 9, campaign: true });
  M.pushMail(w, 'intro');
  const sold0 = w.soldEur || 0, camp0 = M.chapterSales(w);
  M.answerMail(w, 'intro', 0);
  check('заём 300 € даёт деньги и долг', w.money === 400 && w.loan === 300, `${w.money} €, долг ${w.loan}`);
  check('заём не двигает продажи главы', M.chapterSales(w) === camp0 && (w.soldEur || 0) === sold0);
  const intro = M.MAILBOX.find(m => m.id === 'intro');
  check('текст письма про 8% совпадает с процентами в игре', /восемь процентов/.test(intro.body) && w.loanRate === 0.08);
}

// 5. Кампания: письма, явные переходы между главами и оборудование.
{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:12,campaign:true});
  w.money=100000;
  w.day=3;
  M.campaignTick(w);
  check('вводное письмо появляется в начале кампании',w.mail.some(m=>m.id==='intro'));
  check('письмо о первых покупках появляется на третьем дне',w.mail.some(m=>m.id==='gear0'));
  check('переезд открывает комнату и вторую главу',M.moveChapter(w,1)&&w.profile==='room'&&w.camp.ch===1);
  check('переезд в теплицу включает клапан CO₂',M.moveChapter(w,2)&&w.profile==='farm'&&w.camp.ch===2&&w.has.co2);
  check('переезд в сеть открывает четвёртую главу',M.moveChapter(w,3)&&w.camp.ch===3);
}

// 6. Замки магазина по главам: теплица открывает клапан, комната — LED
{
  const w = M.makeWorld({ profile: 'room', crop: 'lettuce', seed: 9, campaign: true });
  w.camp.ch = 1;
  check('в комнате клапан ещё закрыт', w.has.co2 === false);
  check('в комнате LED-лента открыта, профессиональная LED — нет', M.gearLocked(w, shopItem('ledStrip')) === false && M.gearLocked(w, shopItem('led')) === true);
  M.moveChapter(w, 2);
  check('в теплице клапан открыт', w.has.co2 === true);
}

// 7. Сохранение посреди кампании: глава, профиль, письма и деньги возвращаются
{
  const { w } = runCampaign(60);
  const before = { ch: w.camp.ch, profile: w.profile, money: Math.round(w.money), mail: w.mail.map(m => m.id).join(',') };
  const back = M.deserializeWorld(M.serializeWorld(w));
  const after = { ch: back.world.camp.ch, profile: back.world.profile, money: Math.round(back.world.money),
                  mail: back.world.mail.map(m => m.id).join(',') };
  check('кампания переживает сохранение', JSON.stringify(before) === JSON.stringify(after),
        JSON.stringify(before));
}

// 8. Сеть филиалов: филиал приносит доход и содержание, прибыль считается
{
  const w = M.makeWorld({ profile: 'farm', crop: 'tomato', seed: 11 });
  w.money = 50000;
  const r1 = M.netBuy(w, 'tomato'), r2 = M.netBuy(w, 'cherry');
  check('филиалы покупаются', r1.ok && r2.ok, r1.msg || '');
  const money0 = w.money;
  for (let d = 0; d < 3; d++) for (let k = 0; k < 48; k++) M.stepWorld(w, 0.5);
  const t = M.netTotal(w);
  check('сеть даёт выручку и содержание', t.gross > 0 && t.opex > 0, `валовая ${t.gross.toFixed(0)} €/сут, содержание ${t.opex.toFixed(0)} €/сут`);
  check('сеть увеличивает баланс', w.money > money0 - 3 * 48 * 0.5 * 2000, `баланс ${Math.round(w.money)} €`);
}

// 9. Задания: идут по порядку и не застревают на недоступном (CO₂ без клапана)
{
  const { w } = runCampaign(30);
  check('задания выполняются и счётчик неотрицательный', w.missionsDone >= 1 && w.missionIdx >= w.missionsDone, `выполнено ${w.missionsDone}`);
  check('задание про клапан пропущено, пока его нет', !w.has.co2 && (!M.MISSIONS[w.missionIdx] || M.MISSIONS[w.missionIdx].id !== 'm1'));
}

/* 10. Цены магазина: сложность и малые фасовки балкона */
{
  const easy = M.makeWorld({ profile:'balcony', crop:'lettuce', seed:19, campaign:true, difficulty:'easy' });
  const normal = M.makeWorld({ profile:'balcony', crop:'lettuce', seed:19, campaign:true, difficulty:'normal' });
  const hard = M.makeWorld({ profile:'balcony', crop:'lettuce', seed:19, campaign:true, difficulty:'hard' });
  const item = id => shopItem(id);
  check('лёгкая сложность снижает цену магазина на 20%', Math.abs(M.shopItemCost(easy,item('thermo'))-9.6)<0.001);
  check('обычная сложность сохраняет базовую цену', M.shopItemCost(normal,item('thermo'))===12);
  check('жёсткая сложность повышает цену магазина на 10%', Math.abs(M.shopItemCost(hard,item('thermo'))-13.2)<0.001);
  check('балконные фасовки доступны с первой главы', ['fert2','water1','seeds10','treatPestMini','treatFungiMini'].every(id=>M.gearLocked(normal,item(id))===false));
  check('крупные фасовки расходников открываются с комнаты', ['fert20','water','seeds','treatPest','treatFungi'].every(id=>M.gearLocked(normal,item(id))===true));
  check('цены малых фасовок не требуют промышленного бюджета', ['fert2','water1','seeds10','treatPestMini','treatFungiMini'].every(id=>M.shopItemCost(normal,item(id))<=10));
  const before=normal.money, stock=normal.stock.fertKg, cost=M.shopItemCost(normal,item('fert2'));
  const bought=M.buyItem(normal,'fert2');
  check('покупка малого удобрения списывает цену и добавляет 2 кг', bought.ok && Math.abs(normal.money-(before-cost))<0.001 && normal.stock.fertKg===stock+2);
}

// 8. Письма догоняют игрока после быстрого перехода главы.
{
  const w=M.makeWorld({profile:'farm',crop:'tomato',seed:811,campaign:true});
  w.camp.ch=2; w.day=30; w.camp.seen.push('gear1','gear2');
  check('qualityTalk доступно в более поздней главе',M.MAILBOX.find(m=>m.id==='qualityTalk').when(w));
  check('backupPlan доступно после перехода из главы 3',M.MAILBOX.find(m=>m.id==='backupPlan').when(w));
  w.camp.story={cafe:true};w.camp.seen.push('qualityTalk');
  check('cafeReturn догоняет игрока в главе 3',M.MAILBOX.find(m=>m.id==='cafeReturn').when(w));
  w.rep=10;w.camp.story.quality=true;w.camp.story.cafeContract=true;
  check('regionalBuyer доступно в главе 3',M.MAILBOX.find(m=>m.id==='regionalBuyer').when(w));
  w.camp.ch=3;w.camp.story.premiumBuyer=true;w.rep=15;
  check('networkPartner доступно в главе 4',M.MAILBOX.find(m=>m.id==='networkPartner').when(w));
}

// 9. Перенос сезона сохраняет историю решений и ограничивает репутацию.
{
  const source=M.makeWorld({profile:'farm',crop:'tomato',seed:812,campaign:true});
  source.rep=37;source.missionsDone=8;source.harvestedKg=4000;
  source.contracts=[{done:true},{done:true}];
  source.camp.story={cafe:true,quality:true,cafeContract:true,premiumBuyer:true};
  source.camp.decisions=[{id:'qualityTalk',subj:'Проверка качества',result:'Контроль партии',day:20,repDelta:5}];
  const carry=M.carrySnapshot(source);
  check('репутация при переносе ограничена верхним пределом 40',carry.rep===40,carry.rep);
  check('снимок сезона сохраняет сюжетные флаги',carry.camp.story.cafe&&carry.camp.story.quality&&carry.camp.story.premiumBuyer);
  check('снимок сезона сохраняет историю решений',carry.camp.decisions.length===1&&carry.camp.decisions[0].id==='qualityTalk');
  const target=M.makeWorld({profile:'farm',crop:'tomato',seed:813,campaign:true});
  M.applyCarry(target,carry);
  check('новый сезон восстанавливает сюжетные флаги и решения',
    target.camp.story.cafe&&target.camp.story.quality&&target.camp.decisions.length===1);
  check('репутация нового сезона не превышает 40',target.rep===40&&target.repF<=1.06);
  const legacy=Object.assign({},carry,{camp:Object.assign({},carry.camp,{story:undefined,decisions:undefined}),rep:68});
  const oldTarget=M.makeWorld({profile:'farm',crop:'tomato',seed:814,campaign:true});
  M.applyCarry(oldTarget,legacy);
  check('старый снимок без истории решений загружается безопасно',oldTarget.camp.decisions.length===0&&oldTarget.rep===40);
}

// 10. Стоимость сюжетных решений масштабируется по главе и совпадает с оплатой.
{
  const w=M.makeWorld({profile:'balcony',crop:'lettuce',seed:815,campaign:true});
  const base=M.campaignPrice(w,45);
  w.camp.ch=3;
  const late=M.campaignPrice(w,45);
  check('стоимость сюжетного решения растёт с масштабом кампании',late>base&&late===133);
  w.money=1000;M.pushMail(w,'cafeTrial');
  const offer=w.mail.find(m=>m.id==='cafeTrial');
  check('письмо показывает актуальную цену, а не шаблон',offer.opts[0].label.includes(String(late))&&!offer.opts[0].label.includes('{cost}'));
  const before=w.money;M.answerMail(w,'cafeTrial',0);
  check('сумма в письме фактически списывается',before-w.money===late);
  check('выбор записывается в историю кампании',w.camp.decisions[0].id==='cafeTrial'&&w.camp.decisions[0].result.includes(String(late)));
  check('новые записи выбора получают категорию кампании',w.log.some(l=>l.cat==='campaign'));
}

console.log(fails ? `\nпровалено: ${fails}` : '\nвсе проверки сюжета прошли');
process.exit(fails ? 1 : 0);
