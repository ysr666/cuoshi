'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

async function startH5TestServer() {
  if (process.env.CUOSHI_H5_URL) {
    return { url: process.env.CUOSHI_H5_URL, close: async () => {} };
  }
  const root = path.resolve(__dirname, '../dist/build/h5');
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    throw new Error('H5 build missing: run npm run build:h5 first');
  }
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    const requested = path.resolve(root, '.' + pathname);
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      res.writeHead(403).end(); return;
    }
    const filename = requested === root ? path.join(root, 'index.html') : requested;
    fs.stat(filename, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
      fs.createReadStream(filename).pipe(res);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}
module.exports = { startH5TestServer };
