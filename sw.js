/* Сервис-воркер «Виртуальной теплицы».
   Офлайн-кэш изолирован по scope: /agent/ и /test/ не должны
   перезаписывать кэш друг друга на одном домене GitHub Pages. */
const scopeKey = new URL(self.registration.scope).pathname
  .replace(/^\/+|\/+$/g, '')
  .replace(/[^a-z0-9_-]+/gi, '-') || 'root';
const CACHE_PREFIX = 'greensim-v6-' + scopeKey + '-';
const CACHE = CACHE_PREFIX + '1';
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
    // Удаляем только старые версии кэша ЭТОЙ публикации, не соседний /test/ или /agent/.
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)));
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
