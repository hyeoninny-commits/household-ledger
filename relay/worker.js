/**
 * 가계부 국내 주식 시세 중계 서버 (네이버 증권)
 *
 * 브라우저는 네이버 증권 시세를 직접 받을 수 없어서(CORS 차단) 이 서버가 대신 받아 준다.
 * - Cloudflare Workers에 이 파일을 그대로 붙여 넣어 배포할 수 있다. (relay/README.md 참고)
 * - PC에서는 tests/serve.js 가 이 파일을 불러와 /api/quote 로 제공한다.
 *
 * 요청: GET /api/quote?codes=005930,247540   (국내 6자리 종목 코드, 최대 30개)
 * 응답: { source: 'naver', time, quotes: { '005930': { price, prevClose, prevMonthClose, currency, name, market, time } | { error } } }
 *  - price: 현재가 (장중 실시간)
 *  - prevClose: 전 거래일 종가 (현재가 - 전일 대비)
 *  - prevMonthClose: 지난달 마지막 거래일 종가 (일별 시세)
 *
 * 받는 정보는 종목 코드뿐이며, 가계부 데이터는 이 서버로 오지 않는다.
 */

const REALTIME_URL = 'https://polling.finance.naver.com/api/realtime/domestic/stock/';
const DAILY_URL = 'https://api.stock.naver.com/chart/domestic/item/';
const CODE_RE = /^[0-9A-Z]{6}$/;
const MAX_CODES = 30;
const REALTIME_CACHE_MS = 20 * 1000;       // 같은 종목은 20초 동안 다시 받지 않는다 (네이버 과다 호출 방지)
const MONTH_CACHE_MS = 6 * 60 * 60 * 1000; // 지난달 말 종가는 하루 안에서는 바뀌지 않으므로 6시간 보관

const realtimeCache = new Map(); // code → { at, data }
const monthCache = new Map();    // code|YYYY-MM → { at, close }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function num(v) {
  const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 한국 시간 기준 'YYYY-MM-DD' */
function kstDate(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function ymdCompact(d) { return d.replace(/-/g, ''); }

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (household-ledger relay)', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`네이버 응답 오류 (${res.status})`);
  return res.json();
}

/** 실시간 시세 (여러 종목 한 번에). 네이버에 없는 종목은 결과에서 빠진다. */
async function fetchRealtime(codes) {
  const now = Date.now();
  const out = {};
  const need = codes.filter((c) => {
    const hit = realtimeCache.get(c);
    if (hit && now - hit.at < REALTIME_CACHE_MS) { out[c] = hit.data; return false; }
    return true;
  });
  if (need.length) {
    const body = await getJson(REALTIME_URL + need.join(','));
    (body.datas || []).forEach((d) => {
      const price = num(d.closePriceRaw != null ? d.closePriceRaw : d.closePrice);
      const diff = num(d.compareToPreviousClosePriceRaw != null ? d.compareToPreviousClosePriceRaw : d.compareToPreviousClosePrice);
      if (!(price > 0)) return;
      const data = {
        price,
        prevClose: diff != null ? price - diff : null,
        currency: 'KRW',
        name: d.stockName || '',
        market: d.stockExchangeType && d.stockExchangeType.code ? d.stockExchangeType.code : null,
        time: d.localTradedAt ? new Date(d.localTradedAt).toISOString() : new Date(now).toISOString(),
        tradeDate: d.localTradedAt ? String(d.localTradedAt).slice(0, 10) : kstDate(now),
      };
      realtimeCache.set(d.itemCode, { at: now, data });
      out[d.itemCode] = data;
    });
  }
  return out;
}

/** 지난달 마지막 거래일 종가 (일별 시세에서). tradeDate: 현재 거래일 'YYYY-MM-DD' */
async function fetchPrevMonthClose(code, tradeDate) {
  const month = tradeDate.slice(0, 7);
  const key = code + '|' + month;
  const hit = monthCache.get(key);
  if (hit && Date.now() - hit.at < MONTH_CACHE_MS) return hit.close;
  // 지난달 1일 이전부터 받아 두면 연휴가 길어도 지난달 마지막 거래일이 들어온다
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const from = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
  const url = `${DAILY_URL}${code}/day?startDateTime=${ymdCompact(from)}0000&endDateTime=${ymdCompact(tradeDate)}2359`;
  const bars = await getJson(url);
  let close = null;
  (Array.isArray(bars) ? bars : []).forEach((b) => {
    const d = String(b.localDate || '');
    const ym = d.slice(0, 4) + '-' + d.slice(4, 6);
    const c = num(b.closePrice);
    if (ym < month && c > 0) close = c; // 오래된 순이므로 마지막 값이 지난달 말
  });
  monthCache.set(key, { at: Date.now(), close });
  return close;
}

async function handleQuote(url) {
  const raw = (url.searchParams.get('codes') || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const codes = [...new Set(raw)];
  if (!codes.length || codes.length > MAX_CODES || codes.some((c) => !CODE_RE.test(c))) {
    return json(400, { error: `국내 6자리 종목 코드를 쉼표로 구분해 ${MAX_CODES}개까지 보내 주세요.` });
  }
  let realtime;
  try {
    realtime = await fetchRealtime(codes);
  } catch (e) {
    return json(502, { error: '네이버 시세를 받지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
  const quotes = {};
  await Promise.all(codes.map(async (code) => {
    const q = realtime[code];
    if (!q) { quotes[code] = { error: '종목을 찾지 못했어요' }; return; }
    let prevMonthClose = null;
    try { prevMonthClose = await fetchPrevMonthClose(code, q.tradeDate); } catch (e) { /* 지난달 대비만 빠짐 */ }
    const { tradeDate, ...rest } = q;
    quotes[code] = { ...rest, prevMonthClose };
  }));
  return json(200, { source: 'naver', time: new Date().toISOString(), quotes });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json(405, { error: 'GET만 지원해요.' });
    const url = new URL(request.url);
    if (url.pathname === '/api/quote' || url.pathname === '/api/quote/') return handleQuote(url);
    if (url.pathname === '/' || url.pathname === '/health') return json(200, { ok: true, service: 'household-ledger-naver-relay' });
    return json(404, { error: '없는 주소예요. /api/quote?codes=005930 형식으로 요청해 주세요.' });
  },
};

// 테스트용 (Cloudflare에서는 쓰지 않음)
export const _internal = { realtimeCache, monthCache, num };
