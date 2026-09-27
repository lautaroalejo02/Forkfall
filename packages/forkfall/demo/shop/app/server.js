import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { api } from './server/api.js';

const root = resolve('public');
const pages = { '/': 'index.html', '/product': 'product.html', '/cart': 'cart.html', '/checkout': 'checkout.html', '/confirmation': 'confirmation.html', '/orders': 'orders.html' };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/') || path === '/__reset') return await api(req, res, path);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }
    const file = resolve(root, pages[path] || '.' + decodeURIComponent(path));
    if (!file.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Little Shop listening on port ${server.address().port}`));
