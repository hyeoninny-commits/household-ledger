// 국내 주식 시세 중계 서버(relay/worker.js) 단위 테스트 — 브라우저 없이 Node에서 실행
// 네이버 응답은 가짜로 바꿔 계산·캐시·입력 검사를 확인한다. (실제 네이버 확인은 LIVE=1 일 때만)
const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');

const WORKER = pathToFileURL(path.resolve(__dirname, '..', '..', 'relay', 'worker.js')).href;

let worker, internal, realFetch, calls;

test.beforeAll(async () => {
  const mod = await import(WORKER);
  worker = mod.default;
  internal = mod._internal;
  realFetch = globalThis.fetch;
});

test.afterAll(() => { globalThis.fetch = realFetch; });

/** 네이버 가짜 응답 */
function fakeNaver({ realtime = {}, daily = {}, failRealtime = false } = {}) {
  calls = [];
  internal.realtimeCache.clear();
  internal.monthCache.clear();
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://polling.finance.naver.com/api/realtime/domestic/stock/')) {
      if (failRealtime) return reply({ message: 'error' }, 500);
      const codes = u.split('/').pop().split(',');
      return reply({ pollingInterval: 7000, datas: codes.filter((c) => realtime[c]).map((c) => Object.assign({ itemCode: c }, realtime[c])) });
    }
    if (u.startsWith('https://api.stock.naver.com/chart/domestic/item/')) {
      const code = u.split('/item/')[1].split('/')[0];
      return reply(daily[code] || []);
    }
    return reply({}, 404);
  };
}

const samsung = {
  stockName: '삼성전자', stockExchangeType: { code: 'KS' }, closePrice: '218,500', closePriceRaw: '218500',
  compareToPreviousClosePrice: '-10,500', compareToPreviousClosePriceRaw: '-10500', localTradedAt: '2026-11-03T13:19:20+09:00',
};
const samsungDaily = [
  { localDate: '20261029', closePrice: 226000 }, { localDate: '20261030', closePrice: 220500 },
  { localDate: '20261102', closePrice: 229000 }, { localDate: '20261103', closePrice: 218500 },
];

async function call(q, init) {
  const res = await worker.fetch(new Request('https://relay.example/api/quote' + q, init));
  return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
}

test('현재가·전일 종가·지난달 말 종가·한글 이름을 돌려준다', async () => {
  fakeNaver({ realtime: { '005930': samsung }, daily: { '005930': samsungDaily } });
  const r = await call('?codes=005930,999999');
  expect(r.status).toBe(200);
  expect(r.headers.get('access-control-allow-origin')).toBe('*');
  expect(r.body.source).toBe('naver');
  expect(r.body.quotes['005930']).toMatchObject({ price: 218500, prevClose: 229000, prevMonthClose: 220500, name: '삼성전자', market: 'KS', currency: 'KRW' });
  expect(r.body.quotes['999999']).toEqual({ error: '종목을 찾지 못했어요' });
  // 여러 종목은 실시간 시세 한 번에 묻는다
  expect(calls.filter((c) => c.includes('polling')).length).toBe(1);
  expect(calls[0]).toBe('https://polling.finance.naver.com/api/realtime/domestic/stock/005930,999999');
  // 일별 시세는 지난달이 들어오도록 석 달 전 1일부터 오늘까지
  expect(calls.find((c) => c.includes('/chart/'))).toBe('https://api.stock.naver.com/chart/domestic/item/005930/day?startDateTime=202609010000&endDateTime=202611032359');
});

test('같은 종목은 20초 동안 네이버를 다시 부르지 않는다 (캐시)', async () => {
  fakeNaver({ realtime: { '005930': samsung }, daily: { '005930': samsungDaily } });
  await call('?codes=005930');
  await call('?codes=005930');
  expect(calls.filter((c) => c.includes('polling')).length).toBe(1);
  expect(calls.filter((c) => c.includes('/chart/')).length).toBe(1);
});

test('잘못된 요청은 거절하고, CORS 사전 요청에 응답한다', async () => {
  fakeNaver();
  for (const q of ['', '?codes=', '?codes=AAPL', '?codes=<script>', '?codes=' + Array.from({ length: 31 }, (_, i) => String(100000 + i)).join(',')]) {
    const r = await call(q);
    expect(r.status, q).toBe(400);
  }
  expect(calls).toEqual([]); // 네이버로 아무것도 보내지 않음
  const pre = await call('?codes=005930', { method: 'OPTIONS' });
  expect(pre.status).toBe(204);
  expect(pre.headers.get('access-control-allow-methods')).toContain('GET');
  expect((await call('?codes=005930', { method: 'POST' })).status).toBe(405);
  const other = await worker.fetch(new Request('https://relay.example/secret'));
  expect(other.status).toBe(404);
  const health = await worker.fetch(new Request('https://relay.example/'));
  expect((await health.json()).ok).toBe(true);
});

test('네이버가 응답하지 않으면 502와 안내 문구', async () => {
  fakeNaver({ failRealtime: true });
  const r = await call('?codes=005930');
  expect(r.status).toBe(502);
  expect(r.body.error).toContain('네이버 시세를 받지 못했어요');
});

test('일별 시세를 못 받아도 현재가·전일 대비는 돌려준다', async () => {
  fakeNaver({ realtime: { '005930': samsung }, daily: {} });
  const r = await call('?codes=005930');
  expect(r.body.quotes['005930']).toMatchObject({ price: 218500, prevClose: 229000, prevMonthClose: null });
});

test('[LIVE] 실제 네이버 증권에서 삼성전자·에코프로비엠 시세 받기', async () => {
  test.skip(!process.env.LIVE, '실제 네트워크 확인은 LIVE=1 npx playwright test 06-relay 로 실행');
  globalThis.fetch = realFetch;
  internal.realtimeCache.clear();
  const r = await call('?codes=005930,247540');
  expect(r.status).toBe(200);
  expect(r.body.quotes['005930'].name).toBe('삼성전자');
  expect(r.body.quotes['247540'].market).toBe('KQ');
  expect(r.body.quotes['005930'].price).toBeGreaterThan(0);
  expect(r.body.quotes['005930'].prevMonthClose).toBeGreaterThan(0);
});
