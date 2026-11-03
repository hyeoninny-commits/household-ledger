// 공통 도우미: 앱 열기(시계 고정), 데이터 심기, 화면 조작
const path = require('path');
const { pathToFileURL } = require('url');
const { expect, test } = require('@playwright/test');

const APP_URL = pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const SHOT_DIR = path.resolve(__dirname, '..', 'review-screenshots');
const KEY = 'household-ledger';

/** 한국 시간 기준 날짜/시각으로 시계를 고정하고 앱을 연다. 각 테스트는 새 컨텍스트라 localStorage가 비어 있다. */
/** http: true 이면 데스크톱에서도 PC 서버 주소(http://)로 연다 (주식 서버 시세 테스트용) */
const HTTP_URL = 'http://127.0.0.1:8765/index.html';
async function openApp(page, { date = '2026-11-04', time = '12:00:00', hash = '#home', http = false, clock = 'fixed' } = {}) {
  const at = new Date(`${date}T${time}+09:00`);
  if (clock === 'install') await page.clock.install({ time: at }); // 타이머까지 조절 (자동 갱신 테스트)
  else await page.clock.setFixedTime(at);
  await page.goto((http ? HTTP_URL : appUrl()) + hash);
  await expect(page.locator('#view .view-root')).toBeVisible();
}

/** 모바일 프로젝트는 http 서버(baseURL), 데스크톱은 file:// 주소 */
function appUrl() {
  let baseURL = null;
  try { baseURL = test.info().project.use.baseURL; } catch (e) { /* 테스트 밖 */ }
  return baseURL ? baseURL + '/index.html' : APP_URL;
}

/** 기본 데이터에 patch를 덮어써 localStorage에 넣고 새로고침 */
async function seed(page, patch = {}) {
  await page.evaluate(({ patch, KEY }) => {
    const d = window.Ledger.storage.createDefault();
    const settings = Object.assign(d.settings, patch.settings || {});
    Object.assign(d, patch, { settings });
    localStorage.setItem(KEY, JSON.stringify(d));
  }, { patch, KEY });
  await page.reload();
  await expect(page.locator('#view .view-root')).toBeVisible();
}

let seq = 0;
/** 지출 객체 만들기 */
function exp(date, amount, place, categoryId, extra = {}) {
  seq += 1;
  return Object.assign({
    id: `t-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    date, amount, place, categoryId,
    memo: '', payment: null, recurringId: null, recurringPeriod: null,
    createdAt: `${date}T09:00:00+09:00`,
  }, extra);
}

/** 정기 납부 객체 만들기 */
function rec(name, amount, cycle, extra = {}) {
  seq += 1;
  return Object.assign({
    id: `r-${seq}`, name, amount, categoryId: 'utility', cycle,
    remindDaysBefore: 3, startDate: '2026-01-01', paidPeriods: [], memo: '',
    createdAt: '2026-01-01T09:00:00+09:00',
  }, extra);
}

async function getState(page) {
  return page.evaluate((KEY) => JSON.parse(localStorage.getItem(KEY)), KEY);
}

async function go(page, route) {
  await page.locator(`a.tab[data-route="${route}"]`).click();
  await expect(page.locator('#view')).toHaveAttribute('data-route', route);
}

const modal = (page) => page.locator('dialog.modal[open]').last();

/** 지출 추가 모달 열기 */
async function openExpenseForm(page) {
  await page.locator('#fab-add').click();
  await expect(modal(page).locator('form.expense-form')).toBeVisible();
  return modal(page);
}

/** 지출 추가 (UI). confirmLarge: 고액 확인창이 뜨면 누를 버튼 */
async function addExpenseUI(page, { amount, place, category, date, payment, meetup } = {}) {
  const dlg = await openExpenseForm(page);
  if (amount != null) await dlg.locator('input[name=amount]').fill(String(amount));
  if (place != null) await dlg.locator('input[name=place]').fill(place);
  if (category) await dlg.locator(`.chip[data-cat="${category}"]`).click();
  if (meetup) await dlg.locator('input[name=meetup]').check();
  if (date) await dlg.locator('input[name=date]').fill(date);
  if (payment) await dlg.locator('select[name=payment]').selectOption(payment);
  await dlg.locator('button[type=submit]').click();
  return dlg;
}

/** 확인창의 확인 버튼 */
async function confirmOk(page) {
  const c = page.locator('dialog.modal-confirm[open]');
  await expect(c).toBeVisible();
  await c.locator('[data-ok]').click();
}

/** 화면이 가로로 넘치는지 (px) */
async function overflowX(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    let worst = doc.scrollWidth - doc.clientWidth;
    document.querySelectorAll('dialog[open]').forEach((d) => {
      worst = Math.max(worst, d.scrollWidth - d.clientWidth);
      const r = d.getBoundingClientRect();
      worst = Math.max(worst, Math.ceil(r.right - window.innerWidth));
    });
    return worst;
  });
}

/** 콘솔 에러·경고·페이지 오류 수집 */
function collectErrors(page) {
  const list = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') list.push(`[console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => list.push(`[pageerror] ${e.message}`));
  return list;
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false });

/** '12,500원' → 12500 */
const won = (text) => Number(String(text).replace(/[^\d-]/g, ''));

/* ---------- 주식 시세 가짜 응답 ----------
 * domestic: { '005930': { price, prevClose, prevMonthClose, name } }  → 국내 중계 서버(/api/quote, 네이버 형식)
 * overseas: { AAPL: { price, prevClose, prevMonthClose } }, usdkrw: 1342.88 → Twelve Data time_series 형식
 * log: 요청 주소를 모아 둔다 (외부로 무엇을 보내는지 확인용) */
const DEFAULT_DOMESTIC = {
  '005930': { price: 217750, prevClose: 229000, prevMonthClose: 225000, name: '삼성전자' },
  '247540': { price: 91500, prevClose: 92100, prevMonthClose: 90900, name: '에코프로비엠' },
};
const DEFAULT_OVERSEAS = {
  AAPL: { price: 338.32, prevClose: 344.63, prevMonthClose: 340 },
};

async function mockQuotes(page, { domestic = DEFAULT_DOMESTIC, overseas = DEFAULT_OVERSEAS, usdkrw = 1342.88, log = [], relayHost = '**', twelveError = null, github = null } = {}) {
  // GitHub 자동 갱신 파일 (data 브랜치). github: { updatedAt, q } 를 주면 그 내용, 없으면 404
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    log.push(route.request().url());
    if (!github) { route.fulfill({ status: 404, body: '404: Not Found', headers: { 'Access-Control-Allow-Origin': '*' } }); return; }
    route.fulfill({ contentType: 'text/plain; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign({ source: 'naver', fields: ['price', 'prevClose', 'prevMonthClose', 'name', 'market'] }, github)) });
  });
  await page.route(`${relayHost === '**' ? '**' : relayHost}/api/quote**`, (route) => {
    log.push(route.request().url());
    const codes = new URL(route.request().url()).searchParams.get('codes').split(',');
    const quotes = {};
    codes.forEach((c) => {
      const d = typeof domestic === 'function' ? domestic()[c] : domestic[c];
      quotes[c] = d ? Object.assign({ currency: 'KRW', market: 'KS', time: '2026-11-04T03:00:00.000Z' }, d) : { error: '종목을 찾지 못했어요' };
    });
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ source: 'naver', quotes }) });
  });
  await page.route('https://api.twelvedata.com/**', (route) => {
    log.push(route.request().url());
    if (twelveError) {
      route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign({ status: 'error' }, twelveError)) });
      return;
    }
    const symbols = new URL(route.request().url()).searchParams.get('symbol').split(',');
    const series = (vals) => ({ meta: {}, status: 'ok', values: vals.map(([d, c]) => ({ datetime: d, close: String(c) })) });
    const body = {};
    symbols.forEach((s) => {
      if (s === 'USD/KRW') body[s] = series([['2026-11-03', usdkrw], ['2026-11-02', usdkrw - 2]]);
      else if (overseas[s]) {
        const o = overseas[s];
        body[s] = series([['2026-11-03', o.price], ['2026-11-02', o.prevClose], ['2026-10-30', o.prevMonthClose], ['2026-10-29', o.prevMonthClose + 1]]);
      } else body[s] = { status: 'error', code: 404, message: `${s} 종목을 찾지 못했어요` };
    });
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  return log;
}

const stock = (market, code, quantity, extra = {}) => Object.assign({ id: 's-' + code, market, code, name: '', quantity, avgPrice: null, manualPrice: null, memo: '' }, extra);

module.exports = {
  APP_URL, HTTP_URL, appUrl, KEY, SHOT_DIR, openApp, seed, exp, rec, getState, go, modal,
  openExpenseForm, addExpenseUI, confirmOk, overflowX, collectErrors, shot, won, mockQuotes, stock,
};
