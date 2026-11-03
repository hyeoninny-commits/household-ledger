// PC용 웹 서버 (의존성 없음): 앱 파일 + 국내 주식 시세 중계(/api/quote)
// 휴대폰에서 접속할 때처럼 http:// 주소로 앱을 연다.
// 직접 실행: node serve.js [포트]  → 같은 Wi-Fi의 휴대폰에서 http://<PC IP>:<포트>/ 로 접속 가능
//
// 시세 중계는 relay/worker.js(네이버 증권)를 그대로 불러 쓴다.
// 같은 코드를 Cloudflare Workers에 올리면 PC 없이도 시세를 받을 수 있다. (relay/README.md)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// relay/worker.js 는 ES 모듈이라 동적으로 불러온다
const relayReady = import(pathToFileURL(path.join(ROOT, 'relay', 'worker.js')).href).then((m) => m.default);

/** /api/quote 요청을 중계 코드(Request → Response)로 넘기고 결과를 그대로 돌려준다 */
async function handleRelay(req, res) {
  const relay = await relayReady;
  const response = await relay.fetch(new Request(`http://localhost${req.url}`, { method: req.method }));
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  const pathPart = req.url.split('?')[0];
  if (pathPart === '/api/quote' || pathPart === '/api/quote/') {
    handleRelay(req, res).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '시세 중계 중 오류가 났어요.' }));
    });
    return;
  }
  let rel;
  try { rel = decodeURIComponent(pathPart); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // 앱 파일만 내보낸다 (상위 폴더·테스트 폴더 접근 차단)
  if (!file.startsWith(ROOT + path.sep) || file.includes(path.sep + 'tests' + path.sep) || file.includes(path.sep + 'node_modules' + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`가계부 서버: http://localhost:${PORT}/`);
  ips.forEach((ip) => console.log(`같은 Wi-Fi의 휴대폰에서: http://${ip}:${PORT}/`));
  console.log('국내 주식 시세(네이버)는 이 서버의 /api/quote 로 중계해요.');
});
