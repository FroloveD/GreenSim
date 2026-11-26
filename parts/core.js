"use strict";
// === SIM CORE START ===
/* Ядро симуляции. Никакого DOM: гоняется в Node для тестов и в Web Worker в проде.
   Всё состояние мира — сериализуемые данные (для прогноза мир клонируется). */

const D2R = Math.PI/180;

const CFG = {
  lat: 52.0,
  floorW: 4.0, floorD: 3.0,          // размер отрендеренной площадки, м
  ridgeY: 3.1, eaveY: 2.5,
  glassTau: 0.70, frameShade: 0.12,
  seasonDays: 90,
  // цены
  energyPrice: 0.11,                 // €/кВт·ч
  co2Price: 0.45,                    // €/кг
  waterPrice: 1.2,                   // €/м³
  fertPrice: 1.35,                   // €/кг смеси
  laborHour: 18,                     // €/ч
  // прочее
  maxPhyHardCap: 40,
  plotPlants: 8
};

/* ---------------- Каталог культур ---------------- */
const CROPS = {
  tomato: {
    id:'tomato', name:'Томат бифштекс', icon:'🍅',
    phyllochron:34, maxPhy:30, internode:0.082, leafMax:0.055, vcmax:115, tilt:50,
    leafy:false, trussStart:4, trussEvery:2, fruitsPerTruss:[5,7], fruitSink:15,
    fruitFresh:0.18, price:1.7, density:2.5, goalKgM2:14,
    tempOpt:24, rhMax:91, coldTol:8, heatTol:31, seedCost:1.1, shelfDays:12, bulkL:1.7,
    note:'Классический high-wire. Требует света, обрезки и стабильного климата.'
  },
  cherry: {
    id:'cherry', name:'Томат черри', icon:'🍒',
    phyllochron:32, maxPhy:32, internode:0.076, leafMax:0.046, vcmax:110, tilt:50,
    leafy:false, trussStart:4, trussEvery:2, fruitsPerTruss:[10,14], fruitSink:4,
    fruitFresh:0.022, price:4.2, density:2.6, goalKgM2:6.5,
    tempOpt:24, rhMax:91, coldTol:8, heatTol:31, seedCost:1.4, shelfDays:9, bulkL:1.6,
    note:'Много мелких плодов: чувствителен к нагрузке, дороже на рынке.'
  },
  cucumber: {
    id:'cucumber', name:'Огурец', icon:'🥒',
    phyllochron:26, maxPhy:28, internode:0.090, leafMax:0.070, vcmax:125, tilt:62,
    leafy:false, trussStart:3, trussEvery:1, fruitsPerTruss:[2,3], fruitSink:11,
    fruitFresh:0.13, price:1.05, density:2.2, goalKgM2:16,
    tempOpt:25, rhMax:93, coldTol:10, heatTol:32, seedCost:0.9, shelfDays:7, bulkL:1.8,
    note:'Растёт быстро, любит влажность — но именно она открывает серую гниль.'
  },
  lettuce: {
    id:'lettuce', name:'Салат листовой', icon:'🥬',
    phyllochron:30, maxPhy:14, internode:0.014, leafMax:0.030, vcmax:105, tilt:72,
    leafy:true, headTarget:52, fruitFresh:0.22, price:2.9, density:12, goalKgM2:9,
    tempOpt:19, rhMax:90, coldTol:5, heatTol:26, seedCost:0.35, shelfDays:4, bulkL:2.4,
    note:'Быстрый цикл без плодов: вся биомасса — «головка». Низкая температура критична.'
  }
};

/* ---------------- Профили капитала ---------------- */
/* Уровни сложности — отдельно от профиля капитала.
   fixedF — множитель постоянных расходов, failF — отказы и инциденты,
   priceF — множитель цены реализации, driftF — скорость дрейфа датчиков,
   eventF — частота погодных событий.                                     */
const DIFFICULTY = {
  easy: { id:'easy', name:'Лёгкая', fixedF:0.70, failF:0.55, priceF:1.12, driftF:0.6, eventF:0.8,
          note:'прощает ошибки: дешевле содержание, реже аварии, цена выше' },
  normal: { id:'normal', name:'Обычная', fixedF:1.00, failF:1.00, priceF:1.00, driftF:1.0, eventF:1.0,
          note:'базовый баланс: как в жизни, без поблажек и без издевательств' },
  hard: { id:'hard', name:'Жёсткая', fixedF:1.25, failF:1.60, priceF:0.95, driftF:1.5, eventF:1.25,
          note:'тонкая маржа: аварии чаще, датчики врут злее, оптовая цена ниже' }
};

const PROFILES = {
  hobby: {
    id:'hobby', name:'Хобби', start:1000, area:120, startDoy:91, priceF:1.8,
    fixedDay:14, heatPerM2:0.12, uaPerM2:3.4, volPerM2:2.6, capPerM2:9.0e3, lampPerM2:45,
    co2PerM2:6, labor:1.0, upgF:0.30, loanMax:0, note:'120 м², прямые продажи, премиальная цена'
  },
  farm: {
    id:'farm', name:'Ферма', start:10000, area:400, startDoy:91, priceF:1.0,
    fixedDay:45, heatPerM2:0.09, uaPerM2:2.9, volPerM2:2.9, capPerM2:1.05e4, lampPerM2:60,
    co2PerM2:10, labor:1.0, upgF:1.0, loanMax:20000, note:'400 м², оптовый рынок, полный климат-контроль'
  },
  balcony: {
    id:'balcony', name:'Балкон', start:100, area:4, startDoy:91, priceF:6.5,
    fixedDay:0.3, heatPerM2:0.02, uaPerM2:9.0, volPerM2:2.4, capPerM2:2.0e3, lampPerM2:120,
    co2PerM2:0, labor:1.0, upgF:0.35, loanMax:300, riskF:0.35, tauF:0.72,
    note:'4 м² на балконе: два горшка, лампа и упорство'
  },
  room: {
    id:'room', name:'Комната', start:450, area:20, startDoy:91, priceF:4.0,
    fixedDay:2.5, heatPerM2:0.05, uaPerM2:5.0, volPerM2:2.6, capPerM2:5.0e3, lampPerM2:90,
    co2PerM2:2, labor:1.0, upgF:0.6, loanMax:500, riskF:0.55, tauF:0.55,
    note:'20 м²: стеллажи, LED и вытяжка'
  },
  agro: {
    id:'agro', name:'Агрокомплекс', start:100000, area:1500, startDoy:91, priceF:0.72,
    fixedDay:150, heatPerM2:0.07, uaPerM2:2.2, volPerM2:3.1, capPerM2:1.2e4, lampPerM2:70,
    co2PerM2:9, labor:0.9, upgF:3.2, loanMax:120000, note:'1 500 м², контракты, тонкая маржа в объёме'
  }
};

/* ---------------- Склад ---------------- */
const WH = {
  sectionL: 600,          // литров в одной секции
  maxSections: 12,
  // объём на единицу, литры
  bulk: { fertKg:1.2, co2Kg:1.5, seed:0.012 },
  bulkHarvest: 1.7,       // л на 1 кг урожая в ящиках
  // содержание: €/сут за секцию и цена новой секции, по профилям
  rent:   { balcony:0.1, room:0.8, hobby:0.8, farm:1.6, agro:3.0 },
  price:  { balcony:180, room:420, hobby:520, farm:900, agro:2000 },
  start:  { balcony:1, room:2, hobby:2, farm:4, agro:8 }
};
// сколько дней урожай держится без холодильника — в CROPS (shelfDays)
/* ---------------- Система выращивания ----------------
   Одна и та же культура в грунте и в гидропонике ведёт себя по-разному:
   гидропоника экономит воду и даёт прибавку, но требует стабильного EC/pH,
   электричества для насоса и кислорода в корневой зоне. Грунт прощает
   больше, но реагирует медленнее.

   waterF  — расход воды (× от базового)
   fertF   — расход удобрений
   yieldF  — прибавка к росту (доля сухого вещества)
   rotF    — во сколько раз выше риск корневой гнили при застое
   ecSens  — чувствительность к промахам EC/pH (0 — как грунт, 1 — как есть)
   ch      — с какой главы кампании доступна (0 балкон, 1 комната, 2 теплица)
   cost    — разовая цена перехода на систему (в свободном сезоне сразу)      */
const GROW_SYS = {
  soil: {id:'soil', short:'Грунт', name:'Грунт', ch:0, cost:0,
    waterF:1.00, fertF:1.00, yieldF:1.00, rotF:1.0, ecSens:0.6,
    note:'Обычные горшки с землёй: медленно реагирует, прощает перелив и недолив. С этого начинают все.'},
  coco: {id:'coco', short:'Кокос', name:'Кокос + капельный полив', ch:1, cost:120,
    waterF:0.80, fertF:0.90, yieldF:1.05, rotF:1.1, ecSens:1.1,
    note:'Кокосовый субстрат с каплями: буфер ещё есть, но соли копятся — нужен дренаж и промывка.'},
  dwc:  {id:'dwc', short:'DWC', name:'DWC — глубинная культура', ch:1, cost:180,
    waterF:0.55, fertF:0.80, yieldF:1.08, rotF:1.5, ecSens:1.2,
    note:'Корни висят в питательном растворе с аэратором. Быстро растёт, но тёплый раствор без кислорода = корневая гниль.'},
  nft:  {id:'nft', short:'NFT', name:'NFT — питательная плёнка', ch:2, cost:420,
    waterF:0.35, fertF:0.70, yieldF:1.12, rotF:1.3, ecSens:1.35,
    note:'Тонкая плёнка раствора в жёлобах: самый экономный по воде, но прощает меньше всего — встал насос, и корни высохли.'},
  aero: {id:'aero', short:'Аэропоника', name:'Аэропоника', ch:2, cost:900,
    waterF:0.25, fertF:0.60, yieldF:1.18, rotF:1.7, ecSens:1.6,
    note:'Корни в тумане: максимум кислорода и минимум воды, но любая остановка насоса убивает корни за часы.'}
};
function sysOf(w){ return GROW_SYS[(w && w.sys) || 'soil'] || GROW_SYS.soil; }
/* какие системы доступны в текущей кампании */
function sysAllowed(w, id){
  const S = GROW_SYS[id]; if (!S) return false;
  if (!w.camp) return true;
  const ch = (w.camp.ch >= 3) ? 2 : w.camp.ch;
  return S.ch <= ch;
}
function setGrowSys(w, id){
  const S = GROW_SYS[id]; if (!S) return {ok:false, msg:'Нет такой системы'};
  if (w.sys === id) return {ok:false, msg:'Уже используется'};
  if (!sysAllowed(w, id)) return {ok:false, msg:'Откроется в главе '+(S.ch+1)+' · '+CHAPTERS[S.ch].name};
  const cost = Math.round((S.cost||0)*PROFILES[w.profile].upgF);
  if (w.money < cost) return {ok:false, msg:'Переход стоит '+Math.round(cost)+' € — не хватает'};
  w.money -= cost; if (cost) w.cost.upgrade += cost;
  w.sys = id;
  // смена системы — это новая корневая зона: гнили и вредители начинают с чистого листа
  w.disease = Math.max(0, w.disease-0.35);
  w.log.unshift({t:'Д'+w.day, m:'Система выращивания: '+S.name+(cost?' (−'+Math.round(cost)+' €)':''), k:'hl'});
  return {ok:true, msg:S.name+' — готово'};
}

/* ---------------- Сеть теплиц (финальная цель кампании) ----------------
   Филиал — это 400 м² под управлением наёмного агронома. Внутри он не
   моделируется покамерно (климат, органы, свет) — это агрегированная модель:
   урожай на м² в день, оптовая цена, содержание. Так честнее, чем делать вид,
   будто игрок одновременно ведёт шесть теплиц руками.                     */
const NET = {
  area: 400,
  cost: 3500, costGrow: 1.25,     // цена следующего филиала
  eff: 0.9,                       // «наёмный агроном чуть хуже вас»
  priceF: 0.85,                   // сдаём оптом, не в розницу
  opexM2Day: 0.12,                // 48 €/сут на 400 м²: управляющий, энергия, расходники
  refund: 0.6,                    // продать филиал можно за 60% цены
  // сколько кг с квадратного метра в день даёт управляемый филиал
  kgM2Day: { tomato:0.20, cherry:0.09, cucumber:0.22, lettuce:0.10 }
};
function netCost(w){ return Math.round(NET.cost*Math.pow(NET.costGrow, (w.net.houses||[]).length)); }
function netGrossDay(w, h){
  const kg = (NET.kgM2Day[h.crop] || 0.15)*NET.area*NET.eff;
  const price = CROPS[h.crop].price*(w.market&&w.market.mult?w.market.mult[h.crop]:1)*NET.priceF;
  return {kg, price, gross: kg*price, opex: NET.opexM2Day*NET.area};
}
function netNetDay(w, h){ const g = netGrossDay(w, h); return g.gross - g.opex; }
function netTotal(w){
  const houses = (w.net && w.net.houses) || [];
  let gross = 0, opex = 0;
  for (const h of houses){ const g = netGrossDay(w, h); gross += g.gross; opex += g.opex; }
  return {n:houses.length, gross, opex, net:gross-opex};
}
function netBuy(w, crop){
  if (!w.net) w.net = {houses:[], cum:{gross:0, opex:0}, netDay:0, won:false};
  const cost = netCost(w);
  if (w.money < cost) return {ok:false, msg:`Филиал стоит ${Math.round(cost)} € — не хватает`};
  const cr = crop || w.crop;
  if (!NET.kgM2Day[cr]) return {ok:false, msg:'Для этой культуры нет контракта на объём'};
  w.money -= cost; w.cost.upgrade += cost;
  w.net.houses.push({crop:cr, day:w.day, price:cost});
  w.log.unshift({t:'Д'+w.day, m:`Открыт филиал №${w.net.houses.length}: ${CROPS[cr].name}, 400 м²`, k:'hl'});
  return {ok:true, msg:`Филиал №${w.net.houses.length} открыт · −${Math.round(cost)} €`};
}
function netSell(w, i){
  const h = w.net.houses[i]; if (!h) return false;
  const back = Math.round(h.price*NET.refund);
  w.money += back; w.net.houses.splice(i,1);
  w.log.unshift({t:'Д'+w.day, m:`Филиал продан за ${back} €`, k:''});
  return back;
}
/* ежедневное начисление по филиалам — вызывается в newDay */
function netTick(w){
  if (!w.net || !w.net.houses || !w.net.houses.length){ if (w.net) w.net.netDay = 0; return; }
  const t = netTotal(w);
  w.money += t.gross - t.opex;
  w.revenue += t.gross; w.soldEur = (w.soldEur||0) + t.gross;
  w.cost.fixed += t.opex;
  w.net.cum.gross += t.gross; w.net.cum.opex += t.opex;
  w.net.netDay = t.net;
}

/* ---------------- Обучение: зачем нужна каждая покупка ----------------
   ch — с какой главы кампании вещь открывается (0 балкон · 1 комната · 2 теплица).
   why — объяснение «зачем это вообще», человеческим языком. В свободном сезоне
   ограничений нет, но подпись «зачем» остаётся: она полезна и там.        */
const GEAR = {
  thermo:     {ch:0, why:'Датчик врёт — вы об этом не знаете. Второй прибор рядом покажет расхождение, и будет видно, когда пора калибровать.'},
  sticky:     {ch:0, why:'Клещ заводится в сухом тёплом воздухе и сначала незаметен. Ловушки ловят его до того, как он съест листья.'},
  ledStrip:   {ch:0, why:'В пасмурный день растение не набирает сахар. Лента добавляет 60 µmol прямо на грядку и работает по расписанию досветки.'},
  water:      {ch:0, why:'Полив и подпитка. Без воды устьица закрываются, и весь свет становится бесполезен.'},
  fert20:     {ch:0, why:'Еда для растений: без азота, фосфора и калия рост встаёт, сколько бы света ни было.'},
  whSection:  {ch:0, why:'Склад не резиновый: нет места — урожай останется на грядке. Каждая секция тянет содержание, поэтому расширяйте под объём.'},
  calib:      {ch:0, why:'Калибровка сбрасывает дрейф датчиков. Раз в месяц дешевле, чем принимать решения по вранью.'},
  treatPest:  {ch:0, why:'Когда клещ уже завёлся, обработка сбивает его до безопасного уровня.'},
  treatFungi: {ch:0, why:'Серая гниль на плодах: фунгицид снимает половину, но качество партии просядет на несколько дней.'},

  circFan:    {ch:1, why:'Гниль начинается с застоя воздуха. Обдув сушит лист и подводит CO₂ к устьицам — первое, что окупается в комнате.'},
  handDose:   {ch:1, why:'Без EC/pH вы кормите на глаз. Ручной метр даёт +6% усвоения и стоит втрое дешевле автодозирования.'},
  humid:      {ch:1, why:'В жару воздух сухой, устьица закрываются. Туман поднимает влажность — но тратит воду.'},
  film:       {ch:1, why:'Плёнка на окно — дешёвый термоэкран: −32% теплопотерь ночью, без покупки настоящего экрана.'},
  secondSensor:{ch:1, why:'Первый датчик врёт молча. Второй комплект показывает расхождение — это защита от «полива вслепую».'},
  shade:      {ch:1, why:'Южное окно летом перегревает: сетка снимает до 45% солнца и спасает завязи.'},
  biocontrol: {ch:1, why:'Биозащита: −60% риска вредителей и выше качество партии. Работает вместо химии.'},
  weather:    {ch:1, why:'Метеосервис показывает будущие события в прогнозе: можно закрыть форточку заранее.'},
  fert100:    {ch:1, why:'Мешок со скидкой 12% — выгодно, когда расход перевалил за 20 кг.'},
  co2_50:     {ch:1, why:'CO₂ поднимает фотосинтез до +30% при хорошем свете — но только в закрытом помещении.'},
  seeds:      {ch:1, why:'Пересев листовых: салат живёт коротким циклом, семена расходуются.'},
  rain:       {ch:1, why:'Запас воды на 40 м³: полив и подпитка идут каждый день, и бегать за водой некогда.'},
  repair:     {ch:1, why:'Сломалось — чинить сразу: простой оборудования в разгар плодоношения дороже ремонта.'},

  climatePC:  {ch:2, why:'Перестаёте жить у пульта: контроллер сам держит T и RH и пишет логи колебаний.'},
  ups:        {ch:2, why:'Отключение света останавливает котёл. ИБП держит отопление, пока не дадут ток.'},
  led:        {ch:2, why:'190 µmol на всю площадь — промышленная досветка. На 4 м² она не окупится, на 400 м² — решает.'},
  ledBoost:   {ch:2, why:'+50% света за счёт энергии: имеет смысл, когда урожай упирается в свет, а не в площадь.'},
  screen:     {ch:2, why:'Термоэкран сохраняет тепло ночью: −55% теплопотерь, окупается за один холодный сезон.'},
  dosing:     {ch:2, why:'Автодозирование: +12% к усвоению питания без ручной работы. На 400 м² это заметные деньги.'},
  worker:     {ch:2, why:'Сбор и обрезка без вас: 400 м² — это уже смена на восемь часов, а не «проверить перед работой».'},
  reliability:{ch:2, why:'Плановый сервис: −40% отказов. Дешевле, чем аварийный ремонт в разгар сезона.'},
  service:    {ch:2, why:'Сервисный контракт: −65% отказов и плановое ТО по графику.'},
  insurance:  {ch:2, why:'Страховка гасит 60% ущерба от инцидентов: один град или отключение — и вы в минусе без неё.'},
  co2_200:    {ch:2, why:'Опт: скидка 15%, но 300 л склада. В теплице газ уходит быстрее, чем в комнате.'},
  autoBuy:    {ch:2, why:'Докупка по низкому остатку: не бегать в магазин посреди цветения.'}
};

/* ---------------- Кампания: главы и письма ---------------- */
const CHAPTERS = [
  {id:'balcony', name:'Балкон', profile:'balcony', goal:350, moveCost:0,
   note:'4 м², два горшка и лампа на стойке'},
  {id:'room', name:'Комната', profile:'room', goal:1500, moveCost:380,
   note:'20 м²: стеллаж в три полки, вытяжка, LED'},
  {id:'farm', name:'Теплица', profile:'farm', goal:3000, moveCost:1000,
   note:'400 м² под стеклом: полный климат-контроль'},
  {id:'net',  name:'Сеть', profile:'farm', goal:12000, moveCost:0,
   note:'филиалы по 400 м²: приносят деньги без вашего участия'}
];

/* Письма наставника: приходят в почту, когда выполнено условие.
   Выбор влияет на стартовые условия следующей главы.               */
const MAILBOX = [
  {id:'intro', subj:'«С балкона начинают все» — тётя Роза',
   when:w=>w.camp && !w.camp.seen.includes('intro'),
   body:'Не слушай тех, кто говорит «нужен миллион». Начнём с балкона: два горшка, лампа и голова на плечах. '+
        'Деньги есть только эти сто евро. Хочешь — займу триста до конца сезона под восемь процентов, '+
        'но тогда придётся продавать быстрее, чем хочется.',
   opts:[
     {label:'Взять 300 € в долг', desc:'+300 € сейчас, долг с процентами', apply:w=>{ w.money+=300; w.loan+=300;
        w.log.unshift({t:'Д'+w.day,m:'Тётя Роза одолжила 300 €',k:'hl'}); }},
     {label:'Обойтись своими', desc:'без долга: только 100 € и смекалка', apply:w=>{
        w.log.unshift({t:'Д'+w.day,m:'Решено: без долгов',k:''}); }}
   ]},
  {id:'goal1', subj:'«Пора выбираться с балкона»',
   when:w=>w.camp && w.camp.ch===0 && chapterSales(w)>=CHAPTERS[0].goal && !w.camp.seen.includes('goal1'),
   body:'Ты продал на '+CHAPTERS[0].goal+' € — на балконе это предел: света мало, места нет. '+
        'Есть комната за 380 € в месяц с окном на юг. Переезжаем?',
   opts:[
     {label:`Переехать в комнату (−${CHAPTERS[1].moveCost} €)`, desc:'20 м², стеллажи и вытяжка', apply:w=>moveChapter(w,1)},
     {label:'Ещё пожить на балконе', desc:'подкопить денег и опыта', apply:w=>{ w.camp.wait=(w.camp.wait||0)+1; }}
   ]},
  {id:'goal2', subj:'«Время теплицы»',
   when:w=>w.camp && w.camp.ch===1 && chapterSales(w)>=CHAPTERS[1].goal && !w.camp.seen.includes('goal2'),
   body:'Полторы тысячи продаж — это уже не хобби. Знакомый сдаёт теплицу на 400 м² за 1 000 € первого взноса. '+
        'Там настоящий климат-контроль и опт, но и расходы другие.',
   opts:[
     {label:`Взять теплицу (−${CHAPTERS[2].moveCost} €)`, desc:'400 м² и полный климат-контроль', apply:w=>moveChapter(w,2)},
     {label:'Взять теплицу с кредитом 3 000 €', desc:'−'+CHAPTERS[2].moveCost+' € за въезд, долг 3 000 € под 8 %: хватит на топливо и удобрения',
      apply:w=>{ w.money += 3000; w.loan += 3000; moveChapter(w,2); }},
     {label:'Остаться в комнате', desc:'стабильно, но потолок близко', apply:w=>{ w.camp.wait=(w.camp.wait||0)+1; }}
   ]},
  {id:'gear0', subj:'«Что купить на первые деньги» — тётя Роза',
   when:w=>w.camp && w.camp.ch===0 && w.day>=3 && !w.camp.seen.includes('gear0'),
   body:'Слушай главное: на балконе не покупают «всё сразу». Сначала — термометр-гигрометр за 28 €: он нужен не для красоты, '+
        'а чтобы знать, врёт ли датчик (он врёт всегда, вопрос только когда). Потом клейкие ловушки: клещ любит сухой тёплый воздух '+
        'и появляется тихо. Лампа-лента — если день пасмурный, растение просто не наберёт сахар. '+
        'Остальное в магазине закрыто до следующей главы: на 4 м² оно не окупится.',
   opts:[{label:'Понятно', desc:'дальше разберусь сам', apply:w=>{}}]},

  {id:'gear1', subj:'«Комната — другие деньги» — тётя Роза',
   when:w=>w.camp && w.camp.ch===1 && w.camp.seen.includes('goal1') && !w.camp.seen.includes('gear1'),
   body:'В комнате 20 м², воздух стоит. Первое, что окупается — обдув кроны: он сушит лист, подводит CO₂ и снимает половину риска гнили. '+
        'Второе — ручной EC/pH-метр: без него вы кормите на глаз. Третье — второй комплект датчиков, чтобы видеть дрейф. '+
        'Затеняющая сетка нужна только на южном окне летом. Климат-контроллер и автодозирование — это уже теплица, не тратьте.',
   opts:[{label:'Запомнил', desc:'сначала обдув и EC-метр', apply:w=>{}}]},

  {id:'gear2', subj:'«Теплица — это предприятие» — тётя Роза',
   when:w=>w.camp && w.camp.ch===2 && w.camp.seen.includes('goal2') && !w.camp.seen.includes('gear2'),
   body:'400 м² руками не обслужить. Тут порядок такой: климат-контроллер (перестаёте жить у пульта), плановый сервис '+
        '(отказы дешевле предотвратить), страховка (один инцидент съедает сезон), работник (сбор и обрезка без вас). '+
        'Досветка и термоэкран — только если считаете: каждый кВт·ч должен вернуться урожаем. '+
        'И держите склад: полный склад зимой — это уже не урожай, а компост.',
   opts:[{label:'Принято', desc:'сначала автоматика и защита', apply:w=>{}}]},

  {id:'hydro', subj:'«Земля или вода?» — тётя Роза',
   when:w=>w.camp && w.camp.ch===1 && w.day>=6 && !w.camp.seen.includes('hydro'),
   body:'В комнате можно уйти с земли на воду. Смысл такой: в гидропонике вы подаёте питание точно, растение тратит меньше сил на корни '+
        'и растёт быстрее, а воды уходит втрое меньше. Цена — стабильность: EC/pH надо держать, насос не должен вставать, '+
        'а тёплый раствор без кислорода даёт корневую гниль. Грунт прощает, вода — нет. Переключиться можно в «Параметрах», '+
        'раздел «Система выращивания».',
   opts:[
     {label:'Перейти на DWC (180 €)', desc:'глубинная культура: вода ×0.55, рост +8%, риск гнили ×1.5',
      apply:w=>{ const r = setGrowSys(w,'dwc');
        if (!r.ok) w.log.unshift({t:'Д'+w.day, m:'Гидропоника: '+r.msg+' — вернуться можно в «Параметрах»', k:''}); }},
     {label:'Остаться на грунте', desc:'надёжнее, зато медленнее', apply:w=>{}}
   ]},

  {id:'goal3', subj:'«Пора строить сеть» — тётя Роза',
   when:w=>w.camp && w.camp.ch===2 && chapterSales(w)>=3000 && !w.camp.seen.includes('goal3'),
   body:'Одна теплица — это работа. Пять — это бизнес. Филиал — 400 м² под наёмным агрономом: он не сделает лучше вас, '+
        'но делает сам. Управляющий, энергия и расходники — за ваш счёт, около 48 € в сутки; с томата выходит около 55–60 € чистыми в день. '+
        'Хотите — начинайте сеть прямо сейчас, хотите — докопите на нормальный первый филиал.',
   opts:[
     {label:'Начать сеть', desc:'открывается раздел «Сеть» и цель главы',
      apply:w=>{ w.camp.ch = 3; w.camp.soldBase = w.soldEur||0; w.camp.seen.push('ch3');
        w.log.unshift({t:'Д'+w.day, m:'Глава 4: сеть теплиц', k:'hl'}); }},
     {label:'Пока коплю на теплицу', desc:'вернуться к этому позже',
      apply:w=>{ w.camp.wait=(w.camp.wait||0)+1; }}
   ]},

  {id:'netDone', subj:'«У тебя теперь сеть» — тётя Роза',
   when:w=>w.camp && w.camp.ch===3 && (w.net?w.net.houses.length:0)>=3 && chapterSales(w)>=CHAPTERS[3].goal && !w.camp.seen.includes('netDone'),
   body:'Три теплицы, свои люди, свои контракты. Ты прошёл путь от двух горшков на балконе до сети — и, что важнее, '+
        'научился считать свет, влажность и деньги. Дальше сезон закрывается сам: сеть работает, вы только принимаете решения. '+
        'Можно продолжать до конца сезона и смотреть, сколько она принесёт.',
   opts:[{label:'Продолжать сезон', desc:'пусть работает', apply:w=>{ if (w.net) w.net.won = true; }}]}
];

const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const DOY_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
function dateFromDoy(doy){
  let d = doy, m = 0;
  while (d > DOY_IN_MONTH[m]){ d -= DOY_IN_MONTH[m]; m++; if (m>11){ m=0; } }
  return {day: d, month: m};
}
function fmtDate(doy){ const d = dateFromDoy(((doy-1)%365)+1); return d.day+' '+MONTHS[d.month]; }

/* ---------------- Утилиты ---------------- */
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
/** Детерминированный PRNG (mulberry32) с состоянием в мире — нужен для replay и прогноза */
function rnd(w){
  let t = (w.rngState = (w.rngState + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function satVap(t){ return 0.6108*Math.exp(17.27*t/(t+237.3)); }   // кПа

/* ---------------- Солнце и внешний климат ---------------- */
function sunPosition(doy, hour, latDeg){
  const decl = 23.45*Math.sin(D2R*360*(284+doy)/365);
  const phi = latDeg*D2R, d = decl*D2R, H = 15*(hour-12)*D2R;
  const sinEl = Math.sin(phi)*Math.sin(d)+Math.cos(phi)*Math.cos(d)*Math.cos(H);
  const el = Math.asin(clamp(sinEl,-1,1))/D2R;
  const cosAz = (Math.sin(d)-Math.sin(phi)*sinEl)/(Math.cos(phi)*Math.cos(Math.asin(clamp(sinEl,-1,1)))||1e-6);
  let az = Math.acos(clamp(cosAz,-1,1))/D2R;
  if (H>0) az = 360-az;
  return {el, az};
}
function sunVector(el, az){
  const e = Math.max(el, -0.1)*D2R, a = az*D2R;
  return {x: Math.cos(e)*Math.sin(a), y: Math.sin(e), z: Math.cos(e)*Math.cos(a)};
}
function outsideClimate(w, doy, hour){
  const season = Math.sin((doy-105)/365*2*Math.PI);
  let tMean = 9 + 9*season, tAmp = 6.5 - 1.5*season;
  // погодные события: холодный фронт / жара
  for (const ev of w.events){
    if (ev.inFuture) continue;
    if (ev.kind==='cold') tMean -= ev.severity;
    if (ev.kind==='heat') tMean += ev.severity;
  }
  tMean += (w.tempBias||0);
  const temp = tMean + tAmp*Math.sin((hour-9)/24*2*Math.PI);
  const s = sunPosition(doy, hour, CFG.lat);
  const sinEl = Math.max(0, Math.sin(s.el*D2R));
  let cloud = clamp(w.cloudToday + (w.cloudBias||0), 0, 0.95);
  for (const ev of w.events) if (ev.kind==='overcast' && !ev.inFuture) cloud = Math.max(cloud, 0.9);
  const ppfd = 2100*Math.pow(sinEl,1.15)*(1-0.55*cloud);
  const rh = clamp(80 - 12*Math.sin((hour-6)/24*2*Math.PI) + 12*cloud, 35, 98);
  return {temp, ppfd, rh, el:s.el, az:s.az, sun:s, cloud};
}

/* ---------------- Геометрия органов (порт turtle-подхода) ---------------- */
function nodeY(C, i){ return 0.06 + i*C.internode*0.8; }

function leafGeom(lf, C, px, py, pz){
  const tilt = lf.tilt, az = lf.az;
  const dir = {x: Math.sin(tilt)*Math.cos(az), y: Math.cos(tilt), z: Math.sin(tilt)*Math.sin(az)};
  let sx = -dir.z, sy = 0, sz = dir.x;
  const sl = Math.hypot(sx,sz)||1; sx/=sl; sz/=sl;
  let nrm = {x: dir.y*sz - dir.z*sy, y: dir.z*sx - dir.x*sz, z: dir.x*sy - dir.y*sx};
  if (nrm.y < 0) nrm = {x:-nrm.x, y:-nrm.y, z:-nrm.z};
  const petiole = lf.petiole || 0.085;
  const base = {x: px + Math.cos(az)*petiole, y: py, z: pz + Math.sin(az)*petiole};
  const len = Math.min(0.42, Math.sqrt(Math.max(1e-4,lf.area)*2.05));
  const wid = lf.area/Math.max(0.02, len);
  const mid = {x: base.x+dir.x*len*0.45, y: base.y+dir.y*len*0.45, z: base.z+dir.z*len*0.45};
  const tip = {x: base.x+dir.x*len, y: base.y+dir.y*len, z: base.z+dir.z*len};
  const S = {x:sx, y:sy, z:sz};
  const corners = [
    base,
    {x: mid.x+S.x*wid*0.5, y: mid.y+S.y*wid*0.5, z: mid.z+S.z*wid*0.5},
    tip,
    {x: mid.x-S.x*wid*0.5, y: mid.y-S.y*wid*0.5, z: mid.z-S.z*wid*0.5}
  ];
  const cen = corners.reduce((a,c)=>({x:a.x+c.x/4, y:a.y+c.y/4, z:a.z+c.z/4}), {x:0,y:0,z:0});
  return {corners, dir, side:S, normal:nrm, base, tip, cen, len, wid};
}

/* ---------------- Свет: воксельная LAD + трассировка ---------------- */
const CELL = 0.25;
const NX = Math.round(CFG.floorW/CELL), NY = 14, NZ = Math.round(CFG.floorD/CELL);
const CELLV = CELL*CELL*CELL;

function totalLAI(w){
  const C = CROPS[w.crop];
  let a = 0;
  for (const p of w.plants) for (const lf of p.leaves) if (!lf.dead) a += lf.area;
  return a/(CFG.floorW*CFG.floorD);
}

function computeLight(w, dtH){
  const C = CROPS[w.crop];
  const out = outsideClimate(w, w.doy, w.hour + (dtH||0)*0.5);
  w.out = out;
  const sun = sunVector(out.el, out.az);
  const lampOn = w.ctrl.lampOn && w.has.led && w.equip.lamp.ok && w.power;
  const stripOn = w.ctrl.lampOn && w.has.ledStrip && w.power;
  const tauGH = CFG.glassTau*(PROFILES[w.profile].tauF||1)*(1-CFG.frameShade);
  const shadeF = (w.has.shade && w.ctrl.shadeOn) ? 0.65 : 1;
  const directIn = out.ppfd*tauGH*shadeF;
  const diffuseIn = out.ppfd*tauGH*0.28*shadeF;

  const lad = new Float32Array(NX*NY*NZ);
  const leaves = [];
  for (const p of w.plants) for (const lf of p.leaves){
    if (lf.dead || lf.area < 1e-4) continue;
    const g = leafGeom(lf, C, p.x, nodeY(C, lf.i), p.z);
    leaves.push({lf, p, g});
    let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9,mnz=1e9,mxz=-1e9;
    for (const c of g.corners){
      mnx=Math.min(mnx,c.x); mxx=Math.max(mxx,c.x);
      mny=Math.min(mny,c.y); mxy=Math.max(mxy,c.y);
      mnz=Math.min(mnz,c.z); mxz=Math.max(mxz,c.z);
    }
    const ix0=clamp(Math.floor(mnx/CELL),0,NX-1), ix1=clamp(Math.floor(mxx/CELL),0,NX-1);
    const iy0=clamp(Math.floor(mny/CELL),0,NY-1), iy1=clamp(Math.floor(mxy/CELL),0,NY-1);
    const iz0=clamp(Math.floor(mnz/CELL),0,NZ-1), iz1=clamp(Math.floor(mxz/CELL),0,NZ-1);
    const nc = (ix1-ix0+1)*(iy1-iy0+1)*(iz1-iz0+1);
    for (let iy=iy0;iy<=iy1;iy++) for (let iz=iz0;iz<=iz1;iz++) for (let ix=ix0;ix<=ix1;ix++)
      lad[(iy*NZ+iz)*NX+ix] += lf.area/nc/CELLV;
  }
  const sample = (x,y,z) => {
    const ix = Math.floor(x/CELL), iy = Math.floor(y/CELL), iz = Math.floor(z/CELL);
    if (ix<0||ix>=NX||iy<0||iy>=NY||iz<0||iz>=NZ) return 0;
    return lad[(iy*NZ+iz)*NX+ix];
  };

  const K = 5, k = 0.55, step = 0.16, jitter = 0.035;
  let sum = 0, cnt = 0, laiAboveAll = 0;
  const lampPPFD = w.has.led ? (w.upg.ledBoost?280:190) : (w.has.lampBase?90:0);

  for (const L of leaves){
    const c = L.g.cen;
    let laiAbove = 0;
    for (let y = c.y+0.02; y < CFG.ridgeY; y += CELL) laiAbove += sample(c.x, y, c.z)*CELL;
    laiAboveAll += laiAbove;

    const n = L.g.normal;
    const cosSun = Math.max(0, n.x*sun.x + n.y*sun.y + n.z*sun.z);
    let Tsum = 0;
    for (let r=0;r<K;r++){
      let dx = sun.x + (rnd(w)-0.5)*jitter, dy = sun.y + (rnd(w)-0.5)*jitter, dz = sun.z + (rnd(w)-0.5)*jitter;
      const l = Math.hypot(dx,dy,dz)||1; dx/=l; dy/=l; dz/=l;
      let tau = 1, x = c.x + dx*0.05, y = c.y + dy*0.05, z = c.z + dz*0.05;
      for (let s=0;s<26 && y < CFG.ridgeY;s++){
        tau *= Math.exp(-k*sample(x,y,z)*step);
        x += dx*step; y += dy*step; z += dz*step;
        if (x<0||x>CFG.floorW||z<0||z>CFG.floorD) break;
      }
      Tsum += tau;
    }
    const T = Tsum/K;
    const dirAbs = directIn*T*Math.max(cosSun, 0.03);
    const difAbs = diffuseIn*Math.exp(-0.6*laiAbove)*0.45;
    const lampAbs = (lampOn ? lampPPFD*Math.exp(-0.6*laiAbove)*0.55 : 0)
                  + (stripOn ? 60*Math.exp(-0.8*laiAbove)*0.5 : 0);
    const I = 0.86*(dirAbs + difAbs + lampAbs);
    L.lf.Iabs = I;
    L.lf.relLight = clamp(I/420, 0.05, 1.2);
    sum += I; cnt++;
  }

  w.light = {
    outside: out.ppfd, directIn, diffuseIn, sun,
    meanLeaf: cnt? sum/cnt : 0,
    canopyLAI: totalLAI(w),
    lampOn, cloud: out.cloud
  };
  return w.light;
}

/* ---------------- Фотосинтез листа ---------------- */
function leafAssimilation(Iabs, tempC, co2, ageDays, stress, vcmaxBase, nutri){
  if (Iabs <= 1) return 0;
  const fT = Math.exp(-Math.pow((tempC-26)/13,2));
  const ageF = Math.exp(-Math.max(0, ageDays-12)/45);
  const vcmax = (vcmaxBase||115)*fT*ageF*(1-stress)*(nutri||1);
  if (vcmax <= 0.5) return 0;
  const jmax = 1.9*vcmax, theta = 0.7, Q = Iabs*0.85;
  const J = (Q+jmax - Math.sqrt(Math.max(0, Math.pow(Q+jmax,2)-4*theta*Q*jmax)))/(2*theta);
  const gam = 42.75*Math.pow(1.9,(tempC-25)/10);
  const ci = 0.68*co2;
  const Ac = vcmax*(ci-gam)/Math.max(1,(ci+320));
  const Aj = J*(ci-gam)/Math.max(1,(4*ci+8*gam));
  return Math.max(0, Math.min(Ac,Aj) - 0.9*fT);
}

/* ---------------- Растение как граф органов ---------------- */
let _oid = 1;
function organNode(parent, type, label){
  const n = {id:_oid++, type, parent, children:[], label};
  if (parent) parent.children.push(n);
  return n;
}

function emitPhytomer(w, p, i){
  const C = CROPS[w.crop];
  const az = (i*137.5)*D2R;
  const gstem = organNode(p.root, 'stem', 'internode#'+(i+1));
  const stem = {type:'stem', id:gstem.id, i, age:0};
  const gleaf = organNode(gstem, 'leaf', 'leaf#'+(i+1));
  const maxA = C.leafMax*(0.55+0.45*Math.min(1,i/6)) * (w.crop==='lettuce'? 1.3 : 1);
  const leaf = {
    type:'leaf', id:gleaf.id, node:gleaf, i, az,
    tilt: C.tilt*D2R + (rnd(w)-0.5)*0.18,
    petiole: w.crop==='lettuce' ? 0.03 : 0.085,
    area: 0.004, maxA, age:0, relLight:0.8, Iabs:0, A:0, dead:false
  };
  p.leaves.push(leaf); p.organs.push(stem, leaf);
  p.nPhy = i+1;

  if (!C.leafy && i >= C.trussStart-1 && ((i-(C.trussStart-1)) % C.trussEvery === 0)){
    const gtr = organNode(gstem, 'truss', 'truss#'+i);
    const [a,b] = C.fruitsPerTruss;
    const tr = {type:'truss', id:gtr.id, node:gtr, i, age:0, fruits:[], maxFruit:a+Math.floor(rnd(w)*(b-a+1))};
    p.trusses.push(tr); p.organs.push(tr);
  }
}

function addFruit(w, p, tr, mass){
  const gl = organNode(tr.node, 'fruit', 'fruit');
  const f = {type:'fruit', id:gl.id, node:gl, mass:mass||0.05, ripe:false, harvested:false, rot:false};
  tr.fruits.push(f); p.fruits.push(f); p.organs.push(f);
  return f;
}

function makePlant(w, x, z, id){
  const C = CROPS[w.crop];
  const p = {
    id, x, z, age:0, tt:0, nPhy:0, organs:[], leaves:[], trusses:[], fruits:[],
    pool:0, head:0, bio:{leaf:0.25, stem:0.22, fruit:0},
    carbonStatus:7, assimToday:0, stress:0, nutri:1, dead:false
  };
  p.root = {id:_oid++, type:'plant', parent:null, children:[], label:'plant#'+id};
  const n0 = C.leafy ? 7 : 12;
  for (let i=0;i<n0;i++) emitPhytomer(w, p, i);
  for (const lf of p.leaves){ lf.age = 13-lf.i*1.0; lf.area = lf.maxA*(0.82-0.05*lf.i); }
  if (!C.leafy){
    for (const tr of p.trusses){
      const nf = 2 + Math.floor(rnd(w)*2);
      for (let k=0;k<nf;k++) addFruit(w, p, tr, C.fruitSink*(0.55 + 0.30*rnd(w)));
    }
  } else {
    p.head = 6 + rnd(w)*4;
  }
  p.tt = n0*C.phyllochron;
  return p;
}

/* ---------------- Fertigation: EC/pH, вода, удобрения ---------------- */
function fertFactors(w){
  const c = w.ctrl;
  const ec = c.ecSet, ph = c.phSet;
  const S = sysOf(w);
  let nutri = 1;
  if (w.stock.fertKg <= 0.5) nutri *= 0.55;          // нет удобрений — дефицит
  if (!w.has.dosing) nutri *= 0.93;                  // без автодозирования дозы плавают
  if (w.has.handDose) nutri *= 1.06;                 // ручной EC/pH-метр: точнее дозы
  if (ec < 1.2) nutri *= lerp(1, lerp(0.55, 1, clamp(ec/1.2,0,1)), S.ecSens);
  if (ec > 3.4) nutri *= lerp(1, clamp(1-(ec-3.4)*0.18, 0.6, 1), S.ecSens);   // засоление
  if (ph < 5.2 || ph > 6.6) nutri *= lerp(1, 0.82, S.ecSens);
  // Ca-блок: кальций + высокая VPD → вершинная гниль плодов
  const caDef = clamp((c.recipe!=='fruit' ? 0.2 : 0) + (ec>3.2?0.3:0), 0, 1);
  return {nutri: clamp(nutri,0.35,1.05), caDef};
}

/* ---------------- Климат теплицы ----------------
   Внутри шага симуляции климат интегрируется подшагами ≤5 мин:
   регуляторы (котёл, форточка) должны работать на минутной сетке,
   иначе на 15-минутном шаге возникает автоколебание.                */
function climateTick(w, dtH, C){
  const n = Math.max(1, Math.ceil(dtH/0.0833));
  const h = dtH/n;
  for (let i=0;i<n;i++) climateSub(w, h, C);
  return w;
}

function climateSub(w, dtH, C){
  const out = w.out, c = w.ctrl, E = w.env;
  const sec = dtH*3600;
  if (!w.act) w.act = {vent:0, heat:0};

  // --- приводы ---
  const stuck = (!w.equip.fan.ok) || (!w.power);
  const vBand = w.has.climatePC ? 4 : 3;          // климат-контроллер держит точнее
  let ventTarget = stuck ? 0.35 : clamp((w.temp - c.ventSet)/vBand, 0, 1);
  if (w.temp > c.ventSet + 8) ventTarget = Math.max(ventTarget, stuck ? 0.7 : 1);
  const travel = dtH/0.30;                      // полный ход ≈ 18 мин
  w.act.vent += clamp(ventTarget - w.act.vent, -travel, travel);
  const screenF = (w.has.screen && c.screenOn) ? 0.45 : (w.has.film ? 0.68 : 1);
  const ua = E.UA*screenF + E.UAvent*w.act.vent;

  // --- транспирация ---
  const lai = totalLAI(w);
  const densF = w.plantScale/(w.area/12);
  const vpd = Math.max(0.1, satVap(w.temp)*(1-w.rh/100));
  const transp = 0.0005*Math.max(0,w.light.meanLeaf)*lai*densF*(0.35+0.65*clamp(vpd/1.6,0,1.6))*w.area; // кг/ч
  const latent = transp*2.45e6/3600;

  // --- приход тепла ---
  const shadeF = (w.has.shade && c.shadeOn) ? 0.55 : 1;
  const solarGain = out.ppfd*0.48*w.area*CFG.glassTau*(PROFILES[w.profile].tauF||1)*(1-CFG.frameShade)*0.85*shadeF;
  const lampHeat = (w.light.lampOn ? E.lampKW*1000*0.9 : 0);
  const heaterOK = w.equip.heater.ok && (w.power || w.has.ups);
  let heatIn = 0;
  if (heaterOK && w.temp < c.heatSet){
    heatIn = E.heatKW*1000*clamp((c.heatSet - w.temp)/(w.has.climatePC?0.6:1.0), 0, 1);
  }
  w.heatUse = heatIn/1000;

  // --- температура: релаксация к равновесию (устойчива при любом шаге) ---
  const Q = solarGain + heatIn + lampHeat - latent;
  const Teq = out.temp + Q/Math.max(1, ua);
  const tauT = E.cap/Math.max(1,(ua+60));
  w.temp = clamp(Teq + (w.temp-Teq)*Math.exp(-sec/tauT), -8, 50);

  // --- суточные экстремумы ---
  w.tempMin = Math.min(w.tempMin===undefined?w.temp:w.tempMin, w.temp);
  w.tempMax = Math.max(w.tempMax===undefined?w.temp:w.tempMax, w.temp);
  w.rhMaxDay = Math.max(w.rhMaxDay===undefined?w.rh:w.rhMaxDay, w.rh);

  // --- CO₂ ---
  const co2OK = w.equip.co2.ok && w.power;
  const co2Stuck = w.equip.co2.stuck;
  const photoCO2 = (w.assimRate||0)*w.plantScale*44/30/24;      // г/ч
  let injG = 0;
  if (co2Stuck && w.stock.co2Kg > 0.2) injG = E.co2MaxG;
  else if (co2OK && c.co2Set > w.co2 && w.stock.co2Kg > 0.2)
    injG = E.co2MaxG*clamp((c.co2Set-w.co2)/80,0,1);
  const netPPM = (injG - photoCO2)/w.gPerPPM;
  const exch = 7*w.act.vent;
  if (exch > 0.05){
    const Ceq = 420 + netPPM/exch;
    w.co2 = Ceq + (w.co2-Ceq)*Math.exp(-dtH/exch);
  } else w.co2 += netPPM*dtH;
  w.co2 = clamp(w.co2, 330, 2000);
  w.stock.co2Kg = Math.max(0, w.stock.co2Kg - injG*dtH/1000);

  // --- влажность ---
  const wsat = satVap(w.temp)*1000;
  const addPct = transp*dtH/Math.max(6,wsat)/E.vol*100;
  const RHout = clamp(out.rh, 30, 98);
  w.rh = w.rh + addPct - 7*w.act.vent*dtH*(w.rh-RHout)*0.55 - Math.max(0,(w.rh-88))*0.35*dtH;
  if (stuck) w.rh += 0.35*dtH;
  // увлажнитель-туман: поднимает влажность в жаркую сухую погоду
  if (w.has.humid && w.rh < 62 && w.temp > 20 && w.stock.waterM3 > 0.5){
    w.rh += 5*dtH; w.stock.waterM3 = Math.max(0, w.stock.waterM3 - 0.12*dtH);
    w.useWaterM3 = (w.useWaterM3||0) + 0.12*dtH;
  }
  w.rh = clamp(w.rh, 30, 99);

  // --- вода и удобрения (расход зависит от системы выращивания) ---
  const sys = sysOf(w);
  const waterM3 = transp*0.0011*dtH*sys.waterF;
  w.stock.waterM3 = Math.max(0, w.stock.waterM3 - waterM3);
  const fertKg = transp*0.0011*dtH*1.6*(c.ecSet/2.5)*sys.fertF;
  w.stock.fertKg = Math.max(0, w.stock.fertKg - fertKg);
  w.useWaterM3 = (w.useWaterM3||0) + waterM3;
  w.useFertKg = (w.useFertKg||0) + fertKg;

  // --- стресс среды ---
  let st = 0;
  if (w.temp > C.heatTol) st += (w.temp-C.heatTol)*0.055;
  if (w.temp < C.coldTol) st += (C.coldTol-w.temp)*0.05;
  if (w.rh > 94) st += 0.01;
  w.stress = clamp(st, 0, 0.7);

  // --- болезни ---
  const dRisk = (w.rh>C.rhMax ? 0.018 : 0) + (w.rh>C.rhMax-3 ? 0.004 : 0)
    - w.act.vent*0.012 - (w.has.circFan ? 0.003 : 0) - 0.0060
    + (sys.rotF-1)*0.004                                  // гидропоника гниёт охотнее
    + ((sys.ecSens>1.15 && !w.power) ? 0.012 : 0);        // без насоса корни задыхаются
  w.disease = clamp(w.disease + dRisk*dtH, 0, 1);

  // --- деньги ---
  const eurHeat = w.heatUse*dtH*CFG.energyPrice;
  const eurLamp = (w.light.lampOn? E.lampKW:0)*dtH*CFG.energyPrice;
  const eurCO2 = injG*dtH/1000*CFG.co2Price;
  w.cost.energy += eurHeat; w.cost.lamp += eurLamp; w.cost.co2 += eurCO2;
  w.money -= (eurHeat+eurLamp+eurCO2);
  w.energyKWh += (w.heatUse + (w.light.lampOn? E.lampKW:0))*dtH;
  return w;
}

/* ---------------- Рост растения ---------------- */
function growthTick(w, dtDays, C){
  let dayAssim = 0;
  const f = fertFactors(w);
  const S = sysOf(w);
  // гидропоника даёт прибавку, но без электричества кислород в корнях падает
  const sysYield = S.yieldF * ((S.ecSens>1.15 && !w.power) ? 0.85 : 1);
  const pestF = w.pest.active ? 1-0.35*w.pest.level : 1;
  const disF = 1-0.35*w.disease;

  for (const p of w.plants){
    if (p.dead) continue;
    p.age += dtDays;
    // тепловое время: у листовых культур — фотопериод + температура
    const teff = Math.max(0, w.temp - 8);
    p.tt += teff*dtDays;
    p.stress = clamp(w.stress + (1-p.nutri)*0.15, 0, 0.8);
    p.nutri = f.nutri;

    let pool = 0;
    for (const lf of p.leaves){
      if (lf.dead){ lf.A = 0; continue; }
      lf.age += dtDays;
      const target = lf.maxA*(0.5+0.5*clamp(lf.relLight,0,1.1));
      lf.area += (target-lf.area)*Math.min(1, dtDays*0.9);
      lf.A = leafAssimilation(lf.Iabs, w.temp, w.co2, lf.age, p.stress, C.vcmax, p.nutri)*pestF*disF;
      pool += lf.A*lf.area*dtDays*86400*30e-6*sysYield;
      if (lf.age > (w.crop==='lettuce'?40:55) || (lf.relLight<0.06 && lf.age>25)) lf.area *= (1-dtDays/6);
      if (lf.area < 0.0035){ lf.dead = true; lf.area = 0; }
    }
    dayAssim += pool;
    p.assimToday += pool;

    // развитие: новый фитомер по тепловому времени (для всех культур)
    const cap = Math.min(C.maxPhy, CFG.maxPhyHardCap);
    if (C.phyllochron > 0){
      let guardEmit = 0;
      while (p.tt >= p.nPhy*C.phyllochron && p.nPhy < cap && guardEmit++ < 3) emitPhytomer(w, p, p.nPhy);
    }

    if (C.leafy){
      // листовая культура: биомасса идёт в «головку»
      const fHead = 0.82;
      p.head += pool*fHead*(1-0.3*clamp(p.stress,0,1));
      p.pool += pool*(1-fHead);
      p.bio.leaf += pool*fHead;
    } else {
      const fruitDemand = p.fruits.filter(x=>!x.ripe&&!x.harvested).length;
      const fFruit = fruitDemand>0 ? clamp(0.30+0.055*fruitDemand, 0.30, 0.62) : 0.05;
      const fLeaf = p.nPhy<C.maxPhy ? 0.30 : 0.14;
      const fStem = p.nPhy<C.maxPhy ? 0.16 : 0.08;
      const store = Math.max(0, 1-fFruit-fLeaf-fStem);
      p.bio.leaf += pool*fLeaf; p.bio.stem += pool*fStem; p.pool += pool*store;

      // соцветия: завязывание ограничено углеродом и стрессом
      const setP = clamp(0.12 + p.carbonStatus/9, 0.10, 1.0)*(1-0.7*clamp(p.stress,0,1))*(1-0.5*w.disease);
      const maxGrow = Math.max(1, Math.floor(p.carbonStatus/1.6));
      let grow = p.fruits.filter(x=>!x.ripe&&!x.harvested).length;
      for (const tr of p.trusses){
        tr.age += dtDays;
        if (grow < maxGrow && tr.age>2 && tr.fruits.length < tr.maxFruit && rnd(w) < dtDays*1.1*setP){
          addFruit(w, p, tr, 0.05); grow++;
        }
      }
      // рост плодов
      const gr = p.fruits.filter(x=>!x.ripe&&!x.harvested);
      const sinkSum = gr.reduce((s,x)=>s+Math.max(0.15,1-x.mass/C.fruitSink),0)||1;
      const carbonFruit = pool*fFruit + p.pool*0.02;
      p.pool -= p.pool*0.02;
      for (const x of gr){
        x.mass += carbonFruit*Math.max(0.15,1-x.mass/C.fruitSink)/sinkSum * (1-0.4*f.caDef*0.2);
        if (x.mass >= C.fruitSink){
          x.ripe = true;
          x.rot = f.caDef > 0.45 && rnd(w) < 0.35;         // вершинная гниль
        }
      }
      p.bio.fruit = p.fruits.filter(x=>!x.harvested).reduce((s,x)=>s+x.mass,0);
    }

    // потеря листа от инфекции
    if (w.disease>0.5 && rnd(w) < dtDays*0.02*(w.disease-0.5)*4){
      const alive = p.leaves.filter(l=>!l.dead);
      if (alive.length>3){ const v = alive[Math.floor(rnd(w)*alive.length)]; v.dead = true; v.area = 0; }
    }
  }
  w.assimRate = dtDays>0 ? dayAssim/dtDays : 0;   // г CH₂O/сут на площадку
  w.assimAcc = (w.assimAcc||0) + dayAssim*w.plantScale/Math.max(1,w.area);  // г/м² за сутки
  w.assimDay += dayAssim*dtDays;
  w.bio += dayAssim*dtDays;
  return dayAssim;
}

/* ---------------- Уборка урожая ---------------- */
function harvestAll(w){
  const C = CROPS[w.crop];
  const grade = w.disease>0.35 ? 0.7 : 1;
  let n = 0, kg = 0, rotKg = 0;
  if (C.leafy){
    for (const p of w.plants){
      if (p.head >= C.headTarget){
        const fresh = C.fruitFresh*(p.head/C.headTarget);
        kg += fresh; n++;
        // пересев
        p.head = 0; p.leaves.length = 0; p.organs.length = 0; p.nPhy = 0; p.tt = 0;
        p.root = {id:_oid++, type:'plant', parent:null, children:[], label:'plant#'+p.id};
        for (let i=0;i<7;i++) emitPhytomer(w, p, i);
        for (const lf of p.leaves){ lf.age = 0; lf.area = lf.maxA*0.2; }
        w.stock.seeds = Math.max(0, w.stock.seeds-1);
        w.cost.seed += C.seedCost*w.plantScale/w.plants.length;
        w.money -= C.seedCost*w.plantScale/w.plants.length;
      }
    }
  } else {
    for (const p of w.plants) for (const f of p.fruits){
      if (f.ripe && !f.harvested){
        f.harvested = true; n++;
        if (f.rot){ rotKg += C.fruitFresh; continue; }
        kg += C.fruitFresh;
      }
    }
  }
  if (n>0){
    w.cost.labor += CFG.laborHour*0.03; w.money -= CFG.laborHour*0.03;
    w.harvested += n; w.harvestedKg += kg*w.plantScale;
    w.dayHarvestKg = (w.dayHarvestKg||0) + kg*w.plantScale;
    const put = addLot(w, w.crop, kg*w.plantScale, grade);
    if (put && put.lost > 0.5) return {n, kg: kg*w.plantScale, rotKg: rotKg*w.plantScale, storeFull:true};
  }
  return {n, kg: kg*w.plantScale, rotKg: rotKg*w.plantScale};
}

function harvestFruit(w, plant, f){
  const C = CROPS[w.crop];
  if (!f || f.harvested || !f.ripe) return 0;
  f.harvested = true;
  if (f.rot) return 0;
  const kg = C.fruitFresh*w.plantScale;
  const grade = w.disease>0.35?0.7:1;
  w.harvested++; w.harvestedKg += kg;
  w.dayHarvestKg = (w.dayHarvestKg||0)+kg;
  const put = addLot(w, w.crop, kg, grade);
  // плод ушёл со склада в тот же миг — значит места не хватило
  return put && put.lost > 0.01 ? -1 : kg;
}

function pruneLower(w, count){
  let removed = 0;
  for (const p of w.plants){
    const alive = p.leaves.filter(l=>!l.dead).sort((a,b)=>a.i-b.i);
    const lim = Math.max(0, Math.min(count, alive.length-4));
    for (let i=0;i<lim;i++){ alive[i].dead = true; alive[i].area = 0; removed++; }
  }
  if (removed>0){
    const cost = CFG.laborHour*0.06*w.upg.laborF;
    w.money -= cost; w.cost.labor += cost; w.pruned += removed;
  }
  return removed;
}
function pruneLeaf(w, p, lf){
  if (!lf || lf.dead) return false;
  lf.dead = true; lf.area = 0; w.pruned++;
  const cost = CFG.laborHour*0.01; w.money -= cost; w.cost.labor += cost;
  return true;
}

/* ---------------- Риски: оборудование, датчики, погода, вредители ---------------- */
const EQUIP_DEFS = {
  heater: {name:'Котёл', repair:420, failP:0.0060},
  fan:    {name:'Привод форточек', repair:260, failP:0.0055},
  lamp:   {name:'Светильники', repair:380, failP:0.0040},
  co2:    {name:'Клапан CO₂', repair:210, failP:0.0040},
  dosing: {name:'Дозирующий узел', repair:340, failP:0.0050},
  sensor: {name:'Датчики', repair:120, failP:0.0030}
};

function riskTick(w, dtH){
  const dtD = dtH/24;
  // износ и отказы
  for (const k in w.equip){
    const eq = w.equip[k], def = EQUIP_DEFS[k];
    if (!eq || !def) continue;
    if (!eq.ok){ eq.down += dtH; continue; }
    const p = def.failP*dtD*(w.diffFail||1)*(w.has.service?0.35:1)*(w.upg.reliability?0.6:1);
    if (rnd(w) < p){
      eq.ok = false; eq.down = 0; eq.stuck = (k==='co2') && rnd(w)<0.5;
      w.events.push({kind:'breakdown', equip:k, days:0});
      w.log.unshift({t:'Д'+w.day, m:`Отказ: ${def.name}. Ремонт ${def.repair} € (Магазин → Сервис)`, k:'bad'});
      w.incidents = (w.incidents||0)+1;
    }
  }
  // датчики «плывут»
  const dF = (w.diffDrift||1);
  w.drift.temp += (rnd(w)-0.45)*0.05*dtD*dF;
  w.drift.rh   += (rnd(w)-0.5)*0.12*dtD*dF;
  w.drift.co2  += (rnd(w)-0.5)*1.2*dtD*dF;
  const nz = () => (rnd(w)-0.5)*0.3;
  w.meas.temp = w.temp + w.drift.temp + nz();
  w.meas.rh   = clamp(w.rh + w.drift.rh + nz()*2, 20, 100);
  w.meas.co2  = Math.max(330, w.co2 + w.drift.co2 + nz()*4);

  // погода: планируем события заранее (чтобы прогноз мог их показать)
  for (let i=w.events.length-1;i>=0;i--){
    const ev = w.events[i];
    if (ev.kind==='breakdown'){ w.events.splice(i,1); continue; }
    if (ev.inFuture){ ev.inDays -= dtD; if (ev.inDays<=0){ ev.inFuture=false; ev.days = ev.len; } continue; }
    ev.days -= dtD;
    if (ev.days<=0) w.events.splice(i,1);
  }
  // раз в день — шанс новых погодных событий
  if (!w._planTomorrow){
    w._planTomorrow = true;
    const r = rnd(w)/(w.diffEvent||1);
    if (r < 0.05) w.events.push({kind:'cold', inFuture:true, inDays:4+Math.floor(rnd(w)*7), len:2+Math.floor(rnd(w)*2), severity:6+rnd(w)*5, label:'Похолодание'});
    else if (r < 0.10) w.events.push({kind:'heat', inFuture:true, inDays:4+Math.floor(rnd(w)*7), len:2+Math.floor(rnd(w)*3), severity:4+rnd(w)*4, label:'Жара'});
    else if (r < 0.16) w.events.push({kind:'overcast', inFuture:true, inDays:3+Math.floor(rnd(w)*6), len:4+Math.floor(rnd(w)*6), severity:0, label:'Затяжная облачность'});
    else if (r < 0.18) w.events.push({kind:'blackout', inFuture:true, inDays:3+Math.floor(rnd(w)*8), len:0.4+rnd(w)*0.3, severity:0, label:'Отключение электричества'});
  }
  // электричество
  w.power = true;
  for (const ev of w.events) if (ev.kind==='blackout' && !ev.inFuture) w.power = false;

  // вредители
  if (!w.pest.active && w.day>12 && rnd(w) < 0.004*dtH*(PROFILES[w.profile].riskF||1)*(w.has.biocontrol?0.4:1)*(w.has.sticky?0.75:1)){
    w.pest.active = true; w.pest.level = 0.12;
    w.log.unshift({t:'Д'+w.day, m:'Обнаружен паутинный клещ. Нужна обработка (Магазин → Защита)', k:'bad'});
  }
  if (w.pest.active) w.pest.level = clamp(w.pest.level + (w.temp>27?0.010:0.004)*dtH, 0, 1);
}


/* ---------------- Склад: ёмкость, партии, порча ---------------- */
function whCap(w){ return (w.wh.sections||2)*WH.sectionL; }
function whSupplyL(w){
  const s = w.stock;
  return s.fertKg*WH.bulk.fertKg + s.co2Kg*WH.bulk.co2Kg + s.seeds*WH.bulk.seed;
}
function whHarvestL(w){
  let L = 0;
  for (const l of w.wh.lots) L += l.kg*WH.bulkHarvest;
  return L;
}
function whUsedL(w){ return whSupplyL(w) + whHarvestL(w); }
function whFreeL(w){ return Math.max(0, whCap(w) - whUsedL(w)); }
function storeKg(w, crop){
  let kg = 0;
  for (const l of w.wh.lots) if (!crop || l.crop===crop) kg += l.kg;
  return kg;
}
/* сколько литров займёт покупка расходников */
function needL(item, w){
  const base = item.bulk || 0;
  return base;
}
/* партия урожая: складываем в одну на день, качество — среднее */
function addLot(w, crop, kg, quality){
  if (kg <= 0) return;
  const shelf = CROPS[crop].shelfDays;
  const freeKg = whFreeL(w)/WH.bulkHarvest;
  const put = Math.min(kg, freeKg);
  const lost = kg - put;
  if (put > 0.001){
    let lot = w.wh.lots.find(l=>l.crop===crop && l.day===w.day);
    if (!lot){ lot = {crop, day:w.day, age:0, shelf, kg:0, q:quality}; w.wh.lots.push(lot); }
    lot.q = (lot.q*lot.kg + quality*put)/(lot.kg+put);
    lot.kg += put;
  }
  if (lost > 0.001){
    w.wh.wasteKg += lost; w.wh.wasteEur += lost*CROPS[crop].price*w.profilePriceF;
    w.log.unshift({t:'Д'+w.day, m:`Склад полон: ${Math.round(lost)} кг осталось на грядке`, k:'bad'});
  }
  return {put, lost};
}

/* ---------------- Рынок цен ---------------- */
function priceToday(w, crop){
  const C = CROPS[crop||w.crop];
  const m = (w.market && w.market.mult && w.market.mult[C.id]) || 1;
  return C.price * w.profilePriceF * m;
}
function marketTrend(w, crop){
  const h = (w.market.hist[crop]||[]);
  return h.length>1 ? h[h.length-1]-h[h.length-2] : 0;
}
function marketTick(w){
  if (!w.market) return;
  for (const id in CROPS){
    const m = w.market.mult[id] || 1;
    // медленный дрейф: цена ходит вокруг базовой, изредка «выстреливает»
    let next = m + (rnd(w)-0.5)*0.09;
    if (rnd(w) < 0.05) next += (rnd(w)-0.4)*0.28;
    next = clamp(next, 0.72, 1.34);
    w.market.mult[id] = next;
    const h = w.market.hist[id] = w.market.hist[id] || [];
    h.push(next); if (h.length > 14) h.shift();
  }
}

/* ---------------- Порча урожая ---------------- */
function whRot(w){
  let lost = 0, eur = 0;
  const keep = [];
  for (const lot of w.wh.lots){
    lot.age++;
    const shelf = lot.shelf || CROPS[lot.crop].shelfDays;
    const dead = lot.age > shelf*2;
    const before = lot.kg;
    lot.kg = dead ? 0 : lot.kg*(1 - 1/shelf);
    lost += before - lot.kg;
    eur += (before - lot.kg)*CROPS[lot.crop].price*w.profilePriceF*lot.q;
    if (lot.kg > 0.4) keep.push(lot);
    else if (lot.kg > 0) { lost += lot.kg; eur += lot.kg*CROPS[lot.crop].price*w.profilePriceF*lot.q; }
  }
  w.wh.lots = keep;
  if (lost > 0.5){
    w.wh.wasteKg += lost; w.wh.wasteEur += eur;
    w.log.unshift({t:'Д'+w.day, m:`Порча на складе: −${Math.round(lost)} кг (${Math.round(eur)} €)`, k:'warn'});
  }
  return {lost, eur};
}

/* ---------------- Продажа со склада ---------------- */
function lotQuality(lot){ return clamp(lot.q*(1 - 0.55*lot.age/Math.max(1,lot.shelf*1.4)), 0.35, 1); }
function sellHarvest(w, crop, kgWant){
  crop = crop || w.crop;
  const lots = w.wh.lots.filter(l=>l.crop===crop).sort((a,b)=>b.age-a.age);   // старые первыми
  let left = kgWant==null ? Infinity : kgWant;
  let kg = 0, eur = 0;
  for (const lot of lots){
    if (left <= 0.01) break;
    const take = Math.min(lot.kg, left);
    const kq = lotQuality(lot);
    kg += take; eur += take*CROPS[crop].price*w.profilePriceF*((w.market.mult[crop])||1)*kq;
    lot.kg -= take; left -= take;
  }
  w.wh.lots = w.wh.lots.filter(l=>l.kg > 0.05);
  if (kg <= 0.05) return {kg:0, eur:0, ok:false};
  w.money += eur; w.revenue += eur; w.soldKg = (w.soldKg||0) + kg; w.soldEur = (w.soldEur||0) + eur;
  w.cost.labor += CFG.laborHour*0.03; w.money -= CFG.laborHour*0.03;
  w.log.unshift({t:'Д'+w.day, m:`Продано ${Math.round(kg)} кг по ${(priceToday(w,crop)).toFixed(2)} €/кг: +${Math.round(eur)} €`, k:'hl'});
  return {kg, eur, ok:true};
}

/* ---------------- Контракты: поставка со склада ---------------- */
function deliverContract(w, id){
  const ct = w.contracts.find(c=>c.id===id && !c.done);
  if (!ct) return {ok:false, msg:'Контракт не найден'};
  const avail = storeKg(w, ct.crop);
  if (avail < 1) return {ok:false, msg:'На складе нет продукции'};
  const take = Math.min(ct.leftKg, avail);
  const lots = w.wh.lots.filter(l=>l.crop===ct.crop).sort((a,b)=>b.age-a.age);
  let left = take, eur = 0;
  for (const lot of lots){
    if (left <= 0.01) break;
    const k = Math.min(lot.kg, left);
    eur += k*CROPS[ct.crop].price*w.profilePriceF*ct.priceMult*lotQuality(lot);
    lot.kg -= k; left -= k;
  }
  w.wh.lots = w.wh.lots.filter(l=>l.kg > 0.05);
  ct.delivered += take; ct.leftKg -= take;
  w.money += eur; w.revenue += eur;
  let bonus = 0;
  if (ct.leftKg <= 0.5){
    ct.done = true; bonus = ct.bonus; w.money += bonus; w.revenue += bonus;
    w.log.unshift({t:'Д'+w.day, m:`Контракт «${ct.label}» выполнен: +${Math.round(bonus)} €`, k:'hl'});
  } else {
    w.log.unshift({t:'Д'+w.day, m:`Поставка по контракту: ${Math.round(take)} кг (+${Math.round(eur)} €)`, k:''});
  }
  return {ok:true, kg:take, eur, bonus};
}

/* ---------------- Склад: расширение ---------------- */
function addSection(w){
  if (w.wh.sections >= WH.maxSections) return {ok:false, msg:'Больше секций не влезет'};
  const cost = whSectionCost(w);
  if (w.money < cost) return {ok:false, msg:'Недостаточно средств'};
  w.money -= cost; w.cost.upgrade += cost; w.wh.sections++;
  w.log.unshift({t:'Д'+w.day, m:`Склад расширен: ${w.wh.sections} секций (−${cost} €)`, k:'hl'});
  return {ok:true, cost};
}
function whSectionCost(w){
  const P = PROFILES[w.profile];
  return Math.round((WH.price[w.profile]||600) * (1 + (w.wh.sections - WH.start[w.profile])*0.55));
}
function whRentDay(w){
  return (WH.rent[w.profile]||1.2) * w.wh.sections;
}

/* ---------------- Кампания ---------------- */
function moveChapter(w, idx){
  const ch = CHAPTERS[idx]; if (!ch) return false;
  const cost = idx>0 ? (ch.moveCost||0) : 0;
  const P = PROFILES[ch.profile];
  w.money -= cost; if (cost) w.cost.upgrade += cost;
  w.profile = P.id; w.area = P.area;
  w.profilePriceF = P.priceF*(w.diffPriceF||1);
  w.env = {
    UA: P.uaPerM2*P.area, UAvent: 35*P.area, heatKW: P.heatPerM2*P.area,
    vol: P.volPerM2*P.area, cap: P.capPerM2*P.area, lampKW: P.lampPerM2*P.area/1000,
    co2MaxG: P.co2PerM2*P.area
  };
  w.gPerPPM = 1.83e-3*w.env.vol;
  // на новом месте — новые растения (переезд, а не телепорт куста)
  w.plants = [];
  let id = 100;
  for (let r=0;r<2;r++) for (let cc=0;cc<4;cc++) w.plants.push(makePlant(w, 0.72+cc*0.86, 1.0+r*1.05, id++));
  w.plantScale = CROPS[w.crop].density*P.area/w.plants.length;
  // на новом месте есть базовый запас: пустая теплица без удобрений — это не переезд, а ловушка
  const kit = { balcony:{fertKg:10,co2Kg:0,waterM3:15,seeds:80},
                room:{fertKg:12,co2Kg:0,waterM3:20,seeds:120},
                farm:{fertKg:120,co2Kg:140,waterM3:100,seeds:400},
                hobby:{fertKg:20,co2Kg:60,waterM3:40,seeds:200},
                agro:{fertKg:60,co2Kg:300,waterM3:150,seeds:900} }[P.id] || {fertKg:10,co2Kg:0,waterM3:15,seeds:80};
  for (const k in kit) w.stock[k] = Math.max(w.stock[k]||0, kit[k]);
  if (P.id === 'farm'){ w.has.screen = true; w.ctrl.screenOn = true; w.upg.reliability = true; }
  // новое помещение чистое: вредители и гнили с собой не переезжают
  w.pest = { active:false, level:0 };
  w.disease = 0; w.stress = 0; w.ctrl.lampEnabled = false;
  w.camp.ch = idx;
  w.camp.seen.push('ch'+idx);
  w.log.unshift({t:'Д'+w.day, m:`Переезд: ${ch.name}. ${ch.note}`, k:'hl'});
  return true;
}
function pushMail(w, id){
  const m = MAILBOX.find(x=>x.id===id); if (!m || w.mail.some(x=>x.id===id)) return false;
  w.mail.unshift({id, subj:m.subj, body:m.body, opts:m.opts.map(o=>({label:o.label, desc:o.desc})), read:false});
  return true;
}
function answerMail(w, id, optIdx){
  const m = MAILBOX.find(x=>x.id===id); const mm = w.mail.find(x=>x.id===id);
  if (!m || !mm) return false;
  const o = m.opts[optIdx]; if (!o) return false;
  o.apply && o.apply(w);
  mm.read = true; mm.answered = optIdx; mm.result = o.label;
  w.camp.seen.push(id);
  w.mail = w.mail.filter(x=>x.answered===undefined);
  return true;
}
function chapterSales(w){ return Math.max(0, (w.soldEur||0) - ((w.camp&&w.camp.soldBase)||0)); }

function campaignTick(w){
  if (!w.camp) return;
  for (const m of MAILBOX){
    if (!m.when(w)) continue;
    if (w.camp.seen.includes(m.id)) continue;
    pushMail(w, m.id);
  }
  // балкон/комната: если денег мало и день прошёл — мягкая подсказка
  if (w.camp.ch===0 && w.day>=20 && !w.camp.seen.includes('remind') && w.money < 300){
    w.camp.seen.push('remind');
    w.log.unshift({t:'Д'+w.day, m:'Тётя Роза: «Продай урожай со склада, деньги на балконе не растут»', k:'warn'});
  }
}

/* ---------------- Догон в оффлайне ---------------- */
function catchUp(w, hours){
  const h = Math.min(Math.max(0, hours), 72);          // не больше трёх суток
  if (h < 0.05 || w.over) return {hours:0};
  const d0 = w.day, m0 = w.money, kg0 = w.harvestedKg;
  let left = h, guard = 0;
  while (left > 1e-6 && guard++ < 400){
    const step = Math.min(left, 0.25);
    stepWorld(w, step);
    left -= step;
  }
  return {hours:h, days:w.day-d0, money:w.money-m0, kg:w.harvestedKg-kg0};
}

/* ---------------- Контракты, миссии, займы ---------------- */
function offerContracts(w){
  const C = CROPS[w.crop];
  const baseKg = Math.round(w.plantScale*C.fruitFresh*2*(w.profile==='agro'?3:1));
  return [
    {id:'wholesale', crop:w.crop, label:'Сетевой контракт', kg: baseKg*3,
     priceMult:1.25, bonus: Math.round(baseKg*3*C.price*0.12), deadline: w.day+30,
     desc:`Поставить ${baseKg*3} кг к ${fmtDate(w.doy+30)}; штраф за недопоставку 400 €`},
    {id:'premium', crop:w.crop, label:'Премиум-партия', kg: baseKg*2,
     priceMult:1.6, bonus: Math.round(baseKg*2*C.price*0.35), deadline: w.day+20,
     desc:`${baseKg*2} кг к ${fmtDate(w.doy+20)} с бонусом за качество`}
  ];
}
function signContract(w, idx){
  const offers = offerContracts(w);
  const o = offers[idx]; if (!o) return false;
  if (w.contracts.filter(c=>!c.done).length >= 2) return false;
  w.contracts.push({...o, leftKg:o.kg, delivered:0, done:false, penalty:400});
  w.money += 0; return true;
}
function checkContracts(w){
  for (const ct of w.contracts){
    if (ct.done) continue;
    if (w.day > ct.deadline){
      w.money -= ct.penalty; w.cost.penalty += ct.penalty;
      ct.done = true; ct.failed = true;
      w.log.unshift({t:'Д'+w.day, m:`Контракт «${ct.label}» сорван: штраф −${ct.penalty} €`, k:'bad'});
    }
  }
}

const MISSIONS = [
  {id:'m1', text:'«Параметры» → поднимите целевой CO₂ до 800 ppm', reward:60,
   check:w=>w.ctrl.co2Set>=800},
  {id:'m2', text:'«Параметры» → включите досветку (нужно купить LED в магазине)', reward:90,
   check:w=>w.ctrl.lampEnabled && w.has.led},
  {id:'m3', text:'Соберите первый урожай (клик по спелому плоду)', reward:120,
   check:w=>w.harvested>=1},
  {id:'m3b', text:'Панель «Склад» → продайте партию урожая', reward:130,
   check:w=>(w.soldKg||0)>0.5},
  {id:'m4', text:'Обрежьте 8 нижних листьев (кнопка на дашборде)', reward:110,
   check:w=>w.pruned>=8},
  {id:'m5', text:'Купите 20 кг удобрений в магазине', reward:150,
   check:w=>w.stock.fertKg>=20},
  {id:'m6', text:'Удержите влажность ниже 90% два дня подряд', reward:200,
   check:w=>w.history.slice(-2).every(h=>h.rh<90)&&w.history.length>=2},
  {id:'m7', text:'Подпишите контракт с сетью', reward:250,
   check:w=>w.contracts.length>=1},
  {id:'m8', text:'Откалибруйте датчики в магазине (Сервис)', reward:180,
   check:w=>w.lastCalib>1},
  {id:'m9', text:'Доведите прибыль за день выше 150 €', reward:300,
   check:w=>w.profitDay>150},
  {id:'m10', text:'Завершите сезон в плюсе', reward:0, check:w=>false}
];
function missionsTick(w){
  const m = MISSIONS[w.missionIdx];
  if (!m) return;
  let ok = false;
  try { ok = m.check(w); } catch(e){ ok = false; }
  if (ok){
    w.missionIdx++;
    if (m.reward>0){ w.money += m.reward; w.revenue += m.reward; }
    w.log.unshift({t:'Д'+w.day, m:`Задание выполнено: ${m.text} (+${m.reward} €)`, k:'hl'});
    w.missionsDone++;
  }
}

/* ---------------- Мир ---------------- */
function makeWorld(opts){
  opts = opts || {};
  const P = PROFILES[opts.profile||'farm'], C = CROPS[opts.crop||'tomato'];
  const D = DIFFICULTY[opts.difficulty||'normal'] || DIFFICULTY.normal;
  const seed = (opts.seed || 20260415) >>> 0;
  const area = P.area;
  const w = {
    seed, rngState: seed, profile: P.id, crop: C.id,
    weather: opts.weather||'normal', cloudBias: opts.weather==='cloudy'?0.22:0, tempBias: opts.weather==='hot'?2.5:0,
    profilePriceF: P.priceF*D.priceF, diffPriceF: D.priceF, area,
    diffId: D.id, diffFixed: D.fixedF, diffFail: D.failF, diffDrift: D.driftF, diffEvent: D.eventF,
    plantScale: 1, day:1, hour:6, doy:P.startDoy, over:false, seasonDays: opts.campaign ? 210 : CFG.seasonDays,
    money: P.start, startMoney: P.start, loan: 0, loanRate: 0.06,
    temp: 16, co2: 520, rh: 75,
    meas:{temp:16, co2:520, rh:75}, drift:{temp:0, rh:0, co2:0}, lastCalib: 1,
    plants: [], events: [], contracts: [], pest:{active:false, level:0},
    disease: 0, stress: 0, power: true, pruned: 0, incidents: 0,
    missionIdx: 0, missionsDone: 0,
    ctrl: {
      heatSet: 18, ventSet: 24, co2Set: 600,
      lampOn: false, lampEnabled: false, screenOn: false, shadeOn: false,
      ecSet: 2.4, phSet: 5.8, recipe: 'std', irrig: true
    },
    has: { led:false, lampBase:true, screen:false, shade:false, co2:true, dosing:false, secondSensor:false,
           service:false, insurance:false, weatherSrv:false, biocontrol:false },
    upg: { ledBoost:false, reliability:false, laborF:1, autoBuy:false, worker:false },
    equip: {
      heater:{ok:true, down:0}, fan:{ok:true, down:0}, lamp:{ok:true, down:0},
      co2:{ok:true, down:0, stuck:false}, dosing:{ok:true, down:0}, sensor:{ok:true, down:0}
    },
    stock: { fertKg: 120*(P.area/400), co2Kg: 140*(P.area/400), waterM3: 100*(P.area/400), seeds: 400*(P.area/400) },
    // склад: секции, партии урожая, потери
    wh: { sections: WH.start[P.id]||2, lots: [], wasteKg: 0, wasteEur: 0 },
    // рынок: множитель цены по культурам, история для графика
    market: { mult: { tomato:1, cherry:1, cucumber:1, lettuce:1 }, hist: { tomato:[], cherry:[], cucumber:[], lettuce:[] } },
    // кампания
    camp: opts.campaign ? { ch:0, seen:[], wait:0, soldBase:0 } : null,
    // сеть филиалов (появляется в 4-й главе кампании, доступна и дальше)
    net: { houses: [], cum:{gross:0, opex:0}, netDay:0, won:false },
    // система выращивания: грунт по умолчанию
    sys: GROW_SYS[opts.sys] ? opts.sys : 'soil',
    mail: [],
    cost: {energy:0, lamp:0, co2:0, water:0, fert:0, labor:0, seed:0, repair:0, treat:0,
           maint:0, fixed:0, penalty:0, upgrade:0, loan:0, storage:0},
    revenue: 0, revenueYesterday: 0, costPrev: 0, harvested:0, harvestedKg:0, dayHarvestKg:0,
    assimDay:0, bio:0, energyKWh:0, profitDay:0,
    out: {temp:12, ppfd:0, rh:78, el:0, az:90, sun:{x:0,y:0.2,z:1}},
    light: {meanLeaf:0, canopyLAI:0, lampOn:false, outside:0, directIn:0, diffuseIn:0, sun:{x:0,y:0.2,z:1}},
    log: [], history: [], cloudToday: 0.25,
    useWaterM3: 0, useFertKg: 0
  };
  // абсолютные характеристики теплицы (масштабируются по площади)
  w.env = {
    UA: P.uaPerM2*area, UAvent: 35*area, heatKW: P.heatPerM2*area,
    vol: P.volPerM2*area, cap: P.capPerM2*area, lampKW: P.lampPerM2*area/1000,
    co2MaxG: P.co2PerM2*area
  };
  w.gPerPPM = 1.83e-3*w.env.vol;
  // посадка в сцене: 2 ряда по 4 растения
  let id = 1;
  for (let r=0;r<2;r++) for (let cc=0;cc<4;cc++) w.plants.push(makePlant(w, 0.72+cc*0.86, 1.0+r*1.05, id++));
  w.plantScale = C.density*area/w.plants.length;
  w.cloudToday = 0.15 + rnd(w)*0.3;
  if (opts.campaign){
    // на балконе нет ни запасов, ни денег на них: только мешок удобрений, лейка, семена и лампа на стойке
    w.stock = { fertKg: 10, co2Kg: 0, waterM3: 15, seeds: 80 };
    w.has.ledStrip = true; w.ctrl.lampEnabled = true;
    w.money = 100; w.startMoney = 100;
    campaignTick(w);
  }
  return w;
}

function stepWorld(w, dtH){
  if (w.over) return w;
  const C = CROPS[w.crop];
  const dtDays = dtH/24;
  w.hour += dtH;
  let guard = 0;
  while (w.hour >= 24 && guard++ < 4){ w.hour -= 24; w.day++; w.doy++; newDay(w); }
  // расписание досветки
  w.ctrl.lampOn = !!w.ctrl.lampEnabled && (w.hour > 4.5 && w.hour < 21);
  computeLight(w, dtH);
  climateTick(w, dtH, C);
  fertTick(w, dtH);
  growthTick(w, dtDays, C);
  riskTick(w, dtH);
  if (!w.forecast) missionsTick(w);     // награды за задания — сразу, не раз в сутки
  return w;
}

function fertTick(w, dtH){
  const f = fertFactors(w);
  // расход удобрений и воды уже в climateTick; здесь — оплата сервисов и утечки
  if (w.stock.waterM3 <= 0.05) w.stress = clamp(w.stress + 0.004*dtH, 0, 0.7);   // без воды — стресс
  // страховка: компенсирует часть потерь от инцидентов
  return f;
}

function newDay(w){
  const rev = w.revenue - (w.revenueYesterday||0);
  const costTotal = Object.values(w.cost).reduce((s,x)=>s+x,0);
  const cost = costTotal - (w.costPrev||0);
  w.costPrev = costTotal;
  w.revenueYesterday = w.revenue;
  const profit = rev - cost;
  w.profitDay = profit;
  w.history.push({
    day:w.day-1, doy:w.doy-1, temp:w.temp, co2:w.co2, rh:w.rh, assim:w.assimDay,
    tempMin:w.tempMin, tempMax:w.tempMax, rhMax:w.rhMaxDay,
    rev, cost, profit, lai:w.light.canopyLAI, disease:w.disease,
    harvestedKg: w.dayHarvestKg||0, energyKWh: w.energyKWh||0,
    waterM3: w.useWaterM3||0, fertKg: w.useFertKg||0
  });
  w.assimDay = 0; w.dayHarvestKg = 0; w.energyKWh = 0; w.useWaterM3 = 0; w.useFertKg = 0;
  w.tempMin = undefined; w.tempMax = undefined; w.rhMaxDay = undefined;
  for (const p of w.plants){
    p.carbonStatus = 0.65*p.carbonStatus + 0.35*(p.assimToday||0);
    p.assimToday = 0;
  }
  // погода на новый день
  w.cloudToday = clamp(w.cloudToday + (rnd(w)-0.5)*0.35, 0, 0.95);
  w._planTomorrow = false;
  // фиксированные расходы
  const fixedToday = PROFILES[w.profile].fixedDay*(w.diffFixed||1);
  w.cost.fixed += fixedToday;
  w.money -= fixedToday;
  // склад: содержание секций
  const rent = whRentDay(w);
  w.cost.storage += rent; w.money -= rent;
  // рынок: новая цена дня
  marketTick(w);
  // порча того, что лежит
  whRot(w);
  // сеть филиалов: выручка и содержание
  netTick(w);
  // письма наставника
  campaignTick(w);
  // обслуживание оборудования
  const maint = w.has.service ? 12*PROFILES[w.profile].upgF : 0;
  if (w.has.service){ w.cost.maint += maint; w.money -= maint; }
  // проценты по займу
  if (w.loan>0){ const int = w.loan*0.06/90; w.cost.loan += int; w.money -= int; }
  // контракты
  checkContracts(w);
  // задания
  missionsTick(w);
  // фиксируем вчерашнее усвоение (г CH₂O на м²) и обнуляем счётчик
  w.assimYesterday = w.assimAcc||0; w.assimAcc = 0;
  // конец сезона
  if (w.day > (w.seasonDays || CFG.seasonDays)) w.over = true;
  // автосбор/автообрезка при найме работника
  if (w.upg.worker){
    const r = harvestAll(w);
    if (r.n) w.log.unshift({t:'Д'+w.day, m:`Работник собрал ${r.n} шт (+${Math.round(r.kg)} кг)`, k:'hl'});
    pruneLower(w, 1);
  }
  w.log.unshift({t:'Д'+w.day, m:`${fmtDate(w.doy)} · прибыль за сутки ${profit>=0?'+':''}${Math.round(profit)} €`, k:profit>=0?'hl':''});
  if (w.log.length>60) w.log.length = 60;
}

/* ---------------- Магазин: покупки ---------------- */
// noScale — приборы с фиксированной ценой (термометр, ИБП, ловушки), не зависят от площади
function upgradeCost(w, base, noScale){ return Math.round(base*(noScale?1:PROFILES[w.profile].upgF)); }

const SHOP_ITEMS = () => ([
  {group:'Бюджетный старт (реальные цены)', items:[
    {id:'thermo', noScale:true, name:'Термометр-гигрометр с сигналом', base:28,
     desc:'контрольный прибор рядом с датчиком: покажет, если тот врёт',
     buy:w=>{ w.has.alarm = true; }},
    {id:'sticky', noScale:true, name:'Клейкие ловушки, 10 шт', base:45,
     desc:'−25% риск паутинного клеща',
     buy:w=>{ w.has.sticky = true; }},
    {id:'rain', noScale:true, dynamic:true, bucket:'water', name:'Бочка дождевой воды 200 л', base:90,
     desc:'+40 м³ запаса воды (полив и подпитка)',
     buy:w=>{ w.stock.waterM3 += 40; }},
    {id:'circFan', noScale:true, name:'Вентилятор обдува кроны, 2 шт', base:120,
     desc:'сушит лист и подводит CO₂: −риск гнили',
     buy:w=>{ w.has.circFan = true; }},
    {id:'handDose', noScale:true, name:'Ручной EC/pH-метр', base:160,
     desc:'+6% к усвоению питания (дешевле автодозирования)',
     buy:w=>{ w.has.handDose = true; }},
    {id:'ledStrip', noScale:true, name:'LED-лента 2×50 Вт на грядку', base:220,
     desc:'+60 µmol/м²·с досветки, работает по расписанию досветки',
     buy:w=>{ w.has.ledStrip = true; }},
    {id:'humid', noScale:true, name:'Увлажнитель-туман 5 л/ч', base:260,
     desc:'поднимает влажность в жару (расход воды)',
     buy:w=>{ w.has.humid = true; }},
    {id:'ups', noScale:true, name:'ИБП для котла 1 кВт·ч', base:380,
     desc:'отопление не встаёт при отключении электричества',
     buy:w=>{ w.has.ups = true; }},
    {id:'film', name:'Плёнка-экран (дешевле термоэкрана)', base:520,
     desc:'−32% теплопотерь ночью (термоэкран даёт −55%)',
     buy:w=>{ w.has.film = true; }},
    {id:'climatePC', noScale:true, name:'Климат-контроллер с логами', base:690,
     desc:'точнее держит T и RH: меньше колебаний и стресса',
     buy:w=>{ w.has.climatePC = true; }}
  ]},
  {group:'Оборудование (профессиональное)', items:[
    {id:'led', name:'LED-досветка', base:2800, desc:'190 µmol/м²·с, работает 4:30–21:00',
     buy:w=>{ w.has.led = true; }},
    {id:'ledBoost', name:'Форсирование LED (+50%)', base:2600, desc:'280 µmol, +энергия',
     req:w=>w.has.led, buy:w=>{ w.upg.ledBoost = true; }},
    {id:'screen', name:'Термоэкран', base:3800, desc:'−55% теплопотерь при включении',
     buy:w=>{ w.has.screen = true; }},
    {id:'shade', name:'Затеняющая сетка', base:1400, desc:'−45% солнца: спасает от перегрева летом',
     buy:w=>{ w.has.shade = true; }},
    {id:'dosing', name:'Автодозирование (EC/pH)', base:3400, desc:'+12% к усвоению питания',
     buy:w=>{ w.has.dosing = true; }},
    {id:'secondSensor', name:'Второй комплект датчиков', base:1200, desc:'сигнализирует о дрейфе',
     buy:w=>{ w.has.secondSensor = true; }},
    {id:'worker', name:'Работник', base:4800, desc:'автосбор и автообрезка',
     buy:w=>{ w.upg.worker = true; }},
    {id:'reliability', name:'Плановый сервис оборудования', base:2200, desc:'−40% отказов',
     buy:w=>{ w.upg.reliability = true; }}
  ]},
  {group:'Расходники', items:[
    {id:'fert20', dynamic:true, bucket:'fert', bulk:24, name:'Удобрения, 20 кг', base:34, desc:'комплекс NPK + микро · 24 л склада',
     buy:w=>{ w.stock.fertKg += 20; }},
    {id:'fert100', dynamic:true, bucket:'fert', bulk:120, name:'Удобрения, 100 кг', base:150, desc:'скидка 12% · 120 л склада',
     buy:w=>{ w.stock.fertKg += 100; }},
    {id:'co2_50', dynamic:true, bucket:'co2', bulk:75, name:'CO₂, 50 кг', base:26, desc:'жидкий CO₂ в баллонах · 75 л',
     buy:w=>{ w.stock.co2Kg += 50; }},
    {id:'co2_200', dynamic:true, bucket:'co2', bulk:300, name:'CO₂, 200 кг', base:88, desc:'скидка 15% · 300 л',
     buy:w=>{ w.stock.co2Kg += 200; }},
    {id:'water', dynamic:true, bucket:'water', name:'Вода, 100 м³', base:110, desc:'полив и подпитка',
     buy:w=>{ w.stock.waterM3 += 100; }},
    {id:'seeds', dynamic:true, bucket:'seed', bulk:2, name:'Семена/рассада, 100 шт', base:70, desc:'нужны для пересева листовых · 2 л',
     buy:w=>{ w.stock.seeds += 100; }},
    {id:'autoBuy', name:'Автозакупка расходников', base:900, desc:'докупка по низкому остатку (+10% к цене)',
     buy:w=>{ w.upg.autoBuy = true; }}
  ]},
  {group:'Склад', items:[
    {id:'whSection', dynamic:true, name:'Ещё секция склада', base:0,
     desc:'+600 л места. Содержание вырастет — склад не бывает бесплатным',
     price:w=>whSectionCost(w), buy:w=>{ /* покупка через addSection */ }}
  ]},
  {group:'Сервис и защита', items:[
    {id:'repair', name:'Ремонт оборудования', base:0, desc:'устраняет все отказы', dynamic:true},
    {id:'calib', noScale:true, dynamic:true, bucket:'repair', name:'Калибровка датчиков', base:140, desc:'сбрасывает дрейф измерений',
     buy:w=>{ w.drift.temp=0; w.drift.rh=0; w.drift.co2=0; w.lastCalib = w.day; }},
    {id:'service', name:'Сервисный контракт (сезон)', base:1600, desc:'−65% отказов, плановое ТО',
     buy:w=>{ w.has.service = true; }},
    {id:'insurance', name:'Страховка сезона', base:1900, desc:'компенсирует 60% ущерба от инцидентов',
     buy:w=>{ w.has.insurance = true; }},
    {id:'biocontrol', name:'Биологическая защита', base:850, desc:'−60% риска вредителей, +качество',
     buy:w=>{ w.has.biocontrol = true; }},
    {id:'weather', name:'Метеосервис', base:620, desc:'показывает будущие погодные события в прогнозе',
     buy:w=>{ w.has.weatherSrv = true; }}
  ]},
  {group:'Защита растений', items:[
    {id:'treatPest', dynamic:true, bucket:'treat', name:'Обработка от клеща', base:260, req:w=>w.pest.active,
     desc:'снижает уровень вредителя до 10%',
     buy:w=>{ w.pest.level = 0.1; if (w.pest.level<0.15) w.pest.active=false; }},
    {id:'treatFungi', dynamic:true, bucket:'treat', name:'Фунгицидная обработка', base:300, req:w=>w.disease>0.15,
     desc:'−50% серой гнили (теряется качество партии на 5 дней)',
     buy:w=>{ w.disease = Math.max(0, w.disease-0.5); w.gradePenaltyDays = 5; }}
  ]}
]);

/* Магазин с подмешанной обучающей информацией: глава открытия + «зачем».
   В кампании вещи продаются по мере глав, в свободном сезоне — всё сразу. */
const SHOP = () => {
  const groups = SHOP_ITEMS();
  for (const g of groups) for (const it of g.items){
    const info = GEAR[it.id];
    if (info){ it.ch = info.ch; it.why = info.why; }
  }
  return groups;
};
/* доступна ли покупка в текущей главе кампании */
function gearLocked(w, it){
  if (!w.camp || !w.camp) return false;
  if (it.ch === undefined) return false;
  const maxCh = (w.camp.ch >= 3) ? 2 : w.camp.ch;   // в главе «сеть» всё уже открыто
  return it.ch > maxCh;
}
function gearChapterName(ch){ return (CHAPTERS[ch]||{}).name || ''; }

function buyItem(w, id){
  const shop = SHOP();
  for (const g of shop) for (const it of g.items){
    if (it.id !== id) continue;
    if (it.req && !it.req(w)) return {ok:false, msg:'Недоступно'};
    if (id === 'repair'){
      let total = 0;
      for (const k in w.equip){
        const eq = w.equip[k];
        if (!eq.ok){ total += EQUIP_DEFS[k].repair; eq.ok = true; eq.stuck = false; eq.down = 0; }
      }
      if (!total) return {ok:false, msg:'Всё работает'};
      if (w.money < total) return {ok:false, msg:'Недостаточно средств'};
      if (w.has.insurance) total = Math.round(total*0.4);
      w.money -= total; w.cost.repair += total;
      w.log.unshift({t:'Д'+w.day, m:`Ремонт выполнен: −${total} €`, k:'hl'});
      return {ok:true, msg:`Ремонт: −${total} €`};
    }
    if (it.id === 'whSection'){
      const r = addSection(w);
      return r.ok ? {ok:true, msg:`Склад: ${w.wh.sections} секций (−${r.cost} €)`} : {ok:false, msg:r.msg};
    }
    const cost = it.price ? it.price(w) : upgradeCost(w, it.base, it.noScale);
    if (w.money < cost) return {ok:false, msg:'Недостаточно средств'};
    // место на складе: расходники не бесконечны
    if (it.bulk){
      const free = whFreeL(w);
      if (free < it.bulk)
        return {ok:false, msg:`Склад переполнен: нужно ${it.bulk} л, свободно ${Math.round(free)} л`};
    }
    w.money -= cost;
    const before = w.revenue;
    it.buy && it.buy(w);
    if (!it.dynamic) w.cost.upgrade += cost;
    else if (it.bucket) w.cost[it.bucket] += cost;
    w.log.unshift({t:'Д'+w.day, m:`Покупка: ${it.name} (−${cost} €)`, k:''});
    return {ok:true, msg:it.name+' куплено'};
  }
  return {ok:false, msg:'Не найдено'};
}

/* ---------------- Клонирование и прогноз ---------------- */
function cloneWorld(w){
  const seen = new Map();
  const cl = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)){
      const a = []; seen.set(v,a);
      for (let i=0;i<v.length;i++) a.push(cl(v[i]));
      return a;
    }
    const o = {}; seen.set(v,o);
    for (const k in v) o[k] = cl(v[k]);
    return o;
  };
  return cl(w);
}

/** Запуск прогноза: клон мира + сдвиг PRNG (прогноз не знает будущего шума) */
/* ---------------- Сохранение: сериализация и восстановление графа ----------------
   Узлы графа (node/parent/children) — только «скелет» для правил; в логике роста и рендере
   они не читаются, поэтому в сейв не попадают, а на загрузке пересобираются из массивов. */
const SAVE_VERSION = 2;

function serializeWorld(w){
  return JSON.stringify({ v:SAVE_VERSION, ts:Date.now(), world:w },
    (k, val) => (k==='node'||k==='root'||k==='parent'||k==='children') ? undefined : val);
}

function rebuildGraph(w){
  if (!w || !w.plants) return w;
  for (const p of w.plants){
    p.root = {id:(_oid++), type:'plant', parent:null, children:[], label:'plant#'+p.id};
    const stems = {};
    for (let i=0;i<(p.nPhy||0);i++) stems[i] = organNode(p.root, 'stem', 'internode#'+(i+1));
    for (const lf of p.leaves) lf.node = organNode(stems[lf.i] || p.root, 'leaf', 'leaf#'+(lf.i+1));
    for (const tr of p.trusses){
      tr.node = organNode(stems[tr.i] || p.root, 'truss', 'truss#'+tr.i);
      for (const f of tr.fruits) f.node = organNode(tr.node, 'fruit', 'fruit');
    }
    if (!p.organs) p.organs = [];
  }
  return w;
}

function deserializeWorld(text){
  const pack = (typeof text === 'string') ? JSON.parse(text) : text;
  if (!pack || !pack.world) throw new Error('нет данных мира');
  if (pack.v !== SAVE_VERSION && pack.v !== 1)
    throw new Error('версия сохранения '+pack.v+' не поддерживается');
  const w = pack.world;
  // миграция v1 → v2: склад, рынок, кампания
  w.cost = w.cost || {};
  if (w.cost.storage === undefined) w.cost.storage = 0;
  if (!w.wh){
    w.wh = { sections: WH.start[w.profile]||2, lots: [], wasteKg:0, wasteEur:0 };
    // то, что раньше «продавалось само», кладём на склад
    if (w.dayHarvestKg > 1) w.wh.lots.push({crop:w.crop, day:w.day, age:0,
      shelf:CROPS[w.crop].shelfDays, kg:w.dayHarvestKg, q:1});
  }
  if (!w.market) w.market = { mult:{tomato:1,cherry:1,cucumber:1,lettuce:1},
                              hist:{tomato:[],cherry:[],cucumber:[],lettuce:[]} };
  if (w.camp === undefined) w.camp = null;
  if (!w.net) w.net = { houses: [], cum:{gross:0, opex:0}, netDay:0, won:false };
  if (!w.sys || !GROW_SYS[w.sys]) w.sys = 'soil';
  if (w.camp && w.camp.soldBase === undefined) w.camp.soldBase = 0;
  if (!w.mail) w.mail = [];
  if (w.diffPriceF === undefined) w.diffPriceF = DIFFICULTY[w.diffId||'normal'].priceF;
  if (!w.seasonDays) w.seasonDays = w.camp ? 210 : CFG.seasonDays;
  pack.v = SAVE_VERSION;
  rebuildGraph(w);
  return pack;
}

/* ---------------- Диагностика: что ограничивает урожай ---------------- */
function diagnose(w){
  const C = CROPS[w.crop];
  const lai = totalLAI(w);
  const items = [];
  const push = (sev, text) => items.push({sev, text});
  const assim = (w.assimRate||0)*w.plantScale/Math.max(1,w.area);   // г CH₂O / м² / сут
  const nut = fertFactors(w).nutri;
  const fruits = w.plants.reduce((a,p)=>a+p.fruits.filter(f=>!f.harvested).length,0);

  if (w.stock.waterM3 < 0.5) push('bad', 'Нет воды: устьица закрыты, фотосинтез падает');
  if (w.stock.fertKg < 1.5)  push('bad', 'Закончились удобрения: EC не держится, рост тормозит');
  if (w.disease > 0.18)      push('bad', `Серая гниль ${Math.round(w.disease*100)}%: −${Math.round(w.disease*35)}% фотосинтеза и качества`);
  if (w.pest.active)         push('bad', `Клещ ${Math.round(w.pest.level*100)}%: −${Math.round(35*w.pest.level)}% ассимиляции`);
  if (w.stress > 0.08)       push('warn', `Стресс климата ${Math.round(w.stress*100)}%: ${w.temp > C.tempOpt ? 'жарко' : 'холодно'} для этой культуры`);
  if (lai < 0.55)            push('warn', `Мало листвы (LAI ${lai.toFixed(2)}): нечему ловить свет — дайте кусту дорасти`);
  if (w.co2 < 450)           push('warn', `CO₂ ${Math.round(w.co2)} ppm: фотосинтез недобирает до ${Math.round(Math.max(0,(1-w.co2/700))*30)}%`);
  if (nut < 0.9)             push('warn', `Питание ${Math.round(nut*100)}% от нормы: проверьте EC/pH и запас удобрений`);
  if (w.hour > 8 && w.hour < 18 && (w.light.meanLeaf||0) < 120 && (w.out.ppfd||0) > 250)
                             push('warn', 'Мало света в кроне: пасмурно, затенение или слишком плотный полог');
  if (!C.leafy && fruits === 0 && w.day > 12) push('info', 'Плодов нет: ждём завязывания — нужны свет, углерод и умеренная температура');

  const rank = {bad:0, warn:1, info:2};
  items.sort((a,b)=>rank[a.sev]-rank[b.sev]);
  return {assim, assimDay:(w.assimYesterday||0), lai, nutri:nut, items: items.slice(0,3)};
}

/* ---------------- Цели сезона ---------------- */
function seasonGoals(w){
  const C = CROPS[w.crop];
  const target = w.area*C.goalKgM2;
  const profit = w.money - w.startMoney;
  const contractsDone = w.contracts.filter(c=>c.done).length;
  const g = [
    {id:'kg',       label:`Собрать ${Math.round(target)} кг`, value:w.harvestedKg, target, unit:'кг'},
    {id:'profit',   label:'Выйти в плюс', value:Math.max(0,profit), target:Math.max(1,w.startMoney*0.35), unit:'€'},
    {id:'contract', label:'Выполнить контракт', value:contractsDone, target:1, unit:''},
    {id:'season',   label:'Дожить до конца сезона', value:w.day, target:(w.seasonDays||CFG.seasonDays), unit:'дн'}
  ];
  for (const x of g) x.pct = clamp(x.value/Math.max(1e-6,x.target), 0, 1);
  return g;
}

function startForecast(w, days){
  const sim = cloneWorld(w);
  sim.rngState = (sim.rngState ^ 0x9E3779B9) >>> 0;
  sim.log = []; sim.history = sim.history.slice(-3);
  sim.revenueYesterday = sim.revenue;
  sim.costPrev = Object.values(sim.cost).reduce((s,x)=>s+x,0);
  sim.forecast = true;
  return { sim, days, done:0, histLen: sim.history.length, results: [], events: [] };
}

function stepForecast(fc, hours){
  const w = fc.sim;
  for (let h=0; h<hours && fc.done < fc.days; h+=0.5){
    // в экономическом прогнозе предполагаем ежедневный сбор (перед сменой суток)
    if (w.dailyHarvest && w.hour >= 23 && fc.hDay !== w.day){ harvestAll(w); fc.hDay = w.day; }
    stepWorld(w, 0.5);
  }
  const hist = w.history.slice(fc.histLen||0);
  fc.histLen = w.history.length;
  for (const h of hist){
    if (fc.done >= fc.days) break;
    fc.results.push({day:h.day, doy:h.doy, temp:h.tempMax, tempMin:h.tempMin, rh:h.rhMax, co2:h.co2,
      harvest:h.harvestedKg, profit:h.profit, disease:h.disease, money:w.money,
      energy:h.energyKWh});
    fc.done++;
  }
  fc.sim.over = false;             // прогноз длиннее сезона — не важно
  return fc;
}

function forecastSummary(fc){
  const r = fc.results;
  if (!r.length) return null;
  const kg = r.reduce((s,x)=>s+x.harvest,0);
  const profit = r.reduce((s,x)=>s+x.profit,0);
  const rhMax = Math.max(...r.map(x=>x.rh));
  const tMax = Math.max(...r.map(x=>x.temp));
  const warnings = [];
  if (rhMax>92) warnings.push('Влажность превысит 92% — риск серой гнили');
  if (tMax>31) warnings.push('Перегрев выше 31 °C — аборт завязей');
  if (profit<0) warnings.push('Период в минусе: постоянные расходы и энергия не покрыты урожаем');
  if (kg < 1) warnings.push('Урожая почти нет: мало света, питания или растение болеет');
  return {kg, profit, rhMax, tMax, warnings, days:r.length};
}

// === SIM CORE END ===
