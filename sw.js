/* Сервис-воркер «Виртуальной теплицы».
   Задача одна: игра открывается без сети. index.html обновляем по сети
   (network-first), чтобы свежая сборка приходила сразу, а офлайн оставался
   последний удачный вариант. Всё остальное — stale-while-revalidate.        */
const CACHE = 'greensim-v2';
const CORE = ['./', './index.html', './manifest.webmanifest',
              './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    // добавляем по одному: отсутствие файла не должно ломать установку
    await Promise.all(CORE.map(u => c.add(new Request(u, {cache:'reload'})).catch(()=>{})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // чужие API (open-meteo) — мимо кэша

  if (req.mode === 'navigate'){
    e.respondWith((async ()=>{
      try {
        const r = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', r.clone()).catch(()=>{});
        return r;
      } catch(err){
        const hit = await caches.match('./index.html');
        return hit || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async ()=>{
    const hit = await caches.match(req);
    const net = fetch(req).then(r=>{
      if (r && r.ok){ caches.open(CACHE).then(c=>c.put(req, r.clone())).catch(()=>{}); }
      return r;
    }).catch(()=>hit);
    return hit || net;
  })());
});
