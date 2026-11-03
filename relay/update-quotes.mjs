/**
 * 국내 주식 시세 파일 만들기 (GitHub Actions에서 10분마다 실행)
 *
 * 네이버 증권에서 코스피·코스닥 전 종목의 현재가·전일 종가를 받아 naver-quotes.json 으로 저장한다.
 * GitHub Actions가 이 파일을 저장소의 `data` 브랜치에 올리면, GitHub Pages에서 연 가계부가
 * https://raw.githubusercontent.com/<계정>/<저장소>/data/naver-quotes.json 으로 읽는다. (CORS 허용)
 *
 * - 지난달 말 종가: 달이 바뀌었거나 아직 없을 때만 종목별 일별 시세로 계산한다(한 달에 한 번).
 * - 개인 데이터는 다루지 않는다. 전 종목을 받으므로 내 보유 종목을 저장소에 적을 필요가 없다.
 *
 * 실행: node relay/update-quotes.mjs <이전 파일 경로|없으면 생략> <출력 경로>
 * 테스트용 환경 변수: LIMIT=30 (종목 수 제한), NAVER_BASE (가짜 서버 주소)
 */
import fs from 'node:fs';

const BASE_M = process.env.NAVER_BASE || 'https://m.stock.naver.com';
const BASE_CHART = process.env.NAVER_CHART_BASE || 'https://api.stock.naver.com';
const PAGE_SIZE = 100;
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = 6;

const [, , prevPath, outPath = 'naver-quotes.json'] = process.argv;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (household-ledger quotes)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(800 * i);
    }
  }
}

/** 코스피·코스닥 전 종목 현재가 (100개씩) */
async function fetchMarket(market) {
  const out = [];
  let page = 1, total = Infinity;
  while (out.length < total) {
    const body = await getJson(`${BASE_M}/api/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`);
    total = body.totalCount || 0;
    const list = body.stocks || [];
    if (!list.length) break;
    out.push(...list);
    if (LIMIT && out.length >= LIMIT) break;
    page++;
    await sleep(150); // 네이버에 부담을 주지 않도록 천천히
  }
  return out;
}

/** 지난달 마지막 거래일 종가 (일별 시세) */
async function prevMonthClose(code, tradeDate) {
  const month = tradeDate.slice(0, 7);
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const from = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const to = tradeDate.replace(/-/g, '');
  const bars = await getJson(`${BASE_CHART}/chart/domestic/item/${code}/day?startDateTime=${from}0000&endDateTime=${to}2359`);
  let close = null;
  (Array.isArray(bars) ? bars : []).forEach((b) => {
    const d = String(b.localDate || '');
    if (d.slice(0, 4) + '-' + d.slice(4, 6) < month && num(b.closePrice) > 0) close = num(b.closePrice);
  });
  return close;
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; await worker(items[k]); await sleep(50); }
  }));
}

async function main() {
  const prev = prevPath && fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
  const rows = [...await fetchMarket('KOSPI'), ...await fetchMarket('KOSDAQ')];
  if (!rows.length) throw new Error('네이버에서 종목을 하나도 받지 못했어요');

  // 현재 거래일: 가장 최근 거래 시각 (한국 시간 날짜)
  const tradeDate = rows.map((r) => String(r.localTradedAt || '').slice(0, 10)).filter(Boolean).sort().pop()
    || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const month = tradeDate.slice(0, 7);

  const q = {};
  rows.forEach((r) => {
    const price = num(r.closePriceRaw ?? r.closePrice);
    const diff = num(r.compareToPreviousClosePriceRaw ?? r.compareToPreviousClosePrice);
    if (!(price > 0)) return;
    q[r.itemCode] = [price, diff != null ? price - diff : null, null, r.stockName || '', (r.stockExchangeType && r.stockExchangeType.code) || null];
  });

  // 지난달 말 종가: 같은 달이면 이전 파일 값을 그대로, 달이 바뀌었거나 없으면 새로 계산
  const sameMonth = prev && prev.month === month && prev.q;
  const need = [];
  Object.keys(q).forEach((code) => {
    const old = sameMonth && prev.q[code] ? prev.q[code][2] : null;
    if (old != null) q[code][2] = old; else need.push(code);
  });
  if (need.length) {
    console.log(`지난달 말 종가 계산: ${need.length}종목`);
    let fail = 0;
    await pool(need, async (code) => {
      try { q[code][2] = await prevMonthClose(code, tradeDate); } catch (e) { fail++; }
    });
    if (fail) console.log(`  일별 시세를 못 받은 종목 ${fail}개 (다음 실행 때 다시 시도)`);
  }

  const out = {
    updatedAt: new Date().toISOString(),
    tradeDate,
    month,
    source: 'naver',
    fields: ['price', 'prevClose', 'prevMonthClose', 'name', 'market'],
    q,
  };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`저장: ${Object.keys(q).length}종목 · 거래일 ${tradeDate} · ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB`);
}

main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
