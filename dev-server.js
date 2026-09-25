// Локальний перегляд сайту без Vercel:  node dev-server.js  →  http://localhost:3002
// Якщо змінні NETHUNT_* / TELEGRAM_* не задані, заявка просто виводиться в консоль.
const http = require('http');
const fs = require('fs');
const path = require('path');
const leadHandler = require('./api/lead');

const PORT = process.env.PORT || 3002;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json',
};
const hasDestination = process.env.TELEGRAM_BOT_TOKEN || process.env.NETHUNT_WEBHOOK_URL;

function vercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/lead') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { req.body = JSON.parse(raw || '{}'); } catch (e) { req.body = {}; }
      if (!hasDestination && req.method === 'POST') {
        console.log('[dev] lead:', req.body);
        return vercelRes(res).status(200).json({ ok: true, dev: true });
      }
      leadHandler(req, vercelRes(res));
    });
    return;
  }

  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  else if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html'; // як cleanUrls у Vercel
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
