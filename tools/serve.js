// Мини-сервер для тестов: отдаёт файлы репозитория с 8080 (0.0.0.0).
// Нужен, потому что браузерные проверки ходят по http, а не file://
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 8080);
const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.md':'text/markdown; charset=utf-8'};
http.createServer((req, res)=>{
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/' ) p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (e, data)=>{
    if (e){ res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}).end('404'); return; }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store'});
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', ()=> console.log('serve: http://0.0.0.0:'+PORT+' → '+ROOT));
