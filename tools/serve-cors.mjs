// Server statico con CORS aperto per provare il calcolatore in locale: node tools/serve-cors.mjs [cartella] [porta]
// (la mappa lo usa con VITE_URL_CALCOLATORE=http://localhost:5180/ in .env.local)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..')); const port = Number(process.argv[3] || 5180);
const tipi = { '.html': 'text/html; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.js': 'text/javascript', '.md': 'text/plain' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': tipi[path.extname(f)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', root, port));
