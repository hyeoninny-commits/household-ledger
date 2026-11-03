// 추가 기능: 신용카드 할부, 예산 추천, 주식(실시간 시세)
const { test, expect } = require('@playwright/test');
const H = require('../helpers');

/* =========================================================
 * 1. 신용카드 할부 — 결제한 달부터 회차별로 나눠 지출에 기록
 * ========================================================= */
test.describe('할부', () => {
  async function fillCredit(page, { amount, place, months, date }) {
    const dlg = await H.openExpenseForm(page);
    await dlg.locator('input[name=amount]').fill(String(amount));
    await dlg.locator('input[name=place]').fill(place);
    if (date) await dlg.locator('input[name=date]').fill(date);
    await dlg.locator('select[name=payment]').selectOption('credit');
    if (months) await dlg.locator('select[name=months]').selectOption(String(months));
    return dlg;
  }
  const inst = (st) => st.expenses.filter((e) => e.installment).sort((a, b) => a.installment.index - b.installment.index);

  test('신용카드 3개월 할부 → 11월·12월·1월에 100,000원씩 기록, 이번 달 예산에는 첫 회차만', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { budgets: { '2026-11': { total: 1000000, byCategory: {} } } });
    const dlg = await fillCredit(page, { amount: '300,000', place: '무신사', months: 3, date: '2026-11-04' });
    await expect(dlg.locator('[data-installment-hint]')).toHaveText('2026년 11월~2027년 1월 매달 100,000원씩 기록해요.');
    await dlg.locator('button[type=submit]').click();
    await H.confirmOk(page); // 30만 원 ≥ 고액 기준
    await expect(page.locator('#toast-region')).toContainText('3개월 할부, 매달 100,000원');
    const list = inst(await H.getState(page));
    expect(list.map((e) => [e.date, e.amount, e.installment.index, e.installment.count, e.installment.total, e.payment, e.categoryId]))
      .toEqual([
        ['2026-11-04', 100000, 1, 3, 300000, 'credit', 'shopping'],
        ['2026-12-04', 100000, 2, 3, 300000, 'credit', 'shopping'],
        ['2027-01-04', 100000, 3, 3, 300000, 'credit', 'shopping'],
      ]);
    expect(new Set(list.map((e) => e.installment.groupId)).size).toBe(1);
    // 홈: 이번 달 지출은 첫 회차만, 최근 지출에 미래 회차 없음
    expect(H.won(await page.locator('.stat-cell strong').nth(2).textContent())).toBe(100000);
    await expect(page.locator('.cover-value')).toContainText('900,000');
    await expect(page.locator('.expense-list [data-expense-id]')).toHaveCount(1);
    await expect(page.locator('.expense-list')).toContainText('할부 1/3');
    // 12월 예산 화면에는 2회차가 반영
    await H.go(page, 'budget');
    await page.locator('[data-shift="1"]').click();
    await expect(page.locator('.hero')).toContainText('100,000원 사용');
    // 내역 전체 보기에서 회차 표시
    await H.go(page, 'list');
    await page.locator('[data-preset=all]').click();
    await expect(page.locator('.expense-item').filter({ hasText: '할부 3/3' })).toContainText('100,000원');
  });

  test('나누어떨어지지 않으면 첫 회차에 나머지, 31일 결제는 짧은 달에 말일', async ({ page }) => {
    await H.openApp(page);
    const dlg = await fillCredit(page, { amount: '100000', place: '쿠팡', months: 3, date: '2027-01-31' });
    await expect(dlg.locator('[data-installment-hint]')).toContainText('매달 33,333원 (첫 달 33,334원)씩');
    await dlg.locator('button[type=submit]').click();
    await H.confirmOk(page); // 총액 100,000원 = 고액 기준
    const list = inst(await H.getState(page));
    expect(list.map((e) => [e.date, e.amount])).toEqual([['2027-01-31', 33334], ['2027-02-28', 33333], ['2027-03-31', 33333]]);
    expect(list.reduce((a, e) => a + e.amount, 0)).toBe(100000);
  });

  test('할부 칸은 신용카드일 때만 보이고, 다른 결제수단이면 일시불로 저장', async ({ page }) => {
    await H.openApp(page);
    const dlg = await H.openExpenseForm(page);
    await expect(dlg.locator('[data-installment]')).toBeHidden();
    await dlg.locator('select[name=payment]').selectOption('credit');
    await expect(dlg.locator('[data-installment]')).toBeVisible();
    await dlg.locator('select[name=months]').selectOption('6');
    await dlg.locator('select[name=payment]').selectOption('debit');
    await expect(dlg.locator('[data-installment]')).toBeHidden();
    await dlg.locator('input[name=amount]').fill('60000');
    await dlg.locator('input[name=place]').fill('다이소');
    await dlg.locator('button[type=submit]').click();
    const st = await H.getState(page);
    expect(st.expenses).toHaveLength(1);
    expect(st.expenses[0]).toMatchObject({ amount: 60000, payment: 'debit', installment: null });
  });

  test('회차를 눌러 수정하면 묶음 전체를 고친다 (3개월 → 6개월 → 일시불)', async ({ page }) => {
    await H.openApp(page, { hash: '#list' });
    const dlg = await fillCredit(page, { amount: '90000', place: '에이블리', months: 3, date: '2026-11-04' });
    await dlg.locator('button[type=submit]').click();
    await page.locator('[data-preset=all]').click();
    await page.locator('.expense-item').filter({ hasText: '할부 2/3' }).click();
    const edit = H.modal(page);
    await expect(edit.locator('.modal-title')).toHaveText('할부 지출 수정');
    await expect(edit.locator('input[name=amount]')).toHaveValue('90,000');
    await expect(edit.locator('input[name=date]')).toHaveValue('2026-11-04');
    await expect(edit.locator('select[name=months]')).toHaveValue('3');
    await edit.locator('select[name=months]').selectOption('6');
    await edit.locator('button[type=submit]').click();
    let list = inst(await H.getState(page));
    expect(list.map((e) => e.amount)).toEqual([15000, 15000, 15000, 15000, 15000, 15000]);
    expect(list[5].date).toBe('2027-04-04');
    await page.locator('.expense-item').filter({ hasText: '할부 4/6' }).click();
    await H.modal(page).locator('select[name=months]').selectOption('1');
    await H.modal(page).locator('button[type=submit]').click();
    const st = await H.getState(page);
    expect(st.expenses).toHaveLength(1);
    expect(st.expenses[0]).toMatchObject({ amount: 90000, date: '2026-11-04', installment: null, payment: 'credit' });
  });

  test('일시불 지출을 할부로 바꿀 수 있다', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { expenses: [H.exp('2026-11-02', 240000, '노트북 거치대', 'shopping', { payment: 'credit' })] });
    await page.locator('[data-expense-id]').click();
    await H.modal(page).locator('select[name=months]').selectOption('2');
    await H.modal(page).locator('button[type=submit]').click();
    const list = inst(await H.getState(page));
    expect(list.map((e) => [e.date, e.amount])).toEqual([['2026-11-02', 120000], ['2026-12-02', 120000]]);
    expect((await H.getState(page)).expenses).toHaveLength(2);
  });

  test('할부 삭제는 확인 후 모든 회차를 지운다', async ({ page }) => {
    await H.openApp(page, { hash: '#list' });
    const dlg = await fillCredit(page, { amount: '30000', place: '책', months: 3 });
    await dlg.locator('button[type=submit]').click();
    await page.locator('[data-expense-id]').first().click();
    await H.modal(page).locator('[data-delete]').click();
    await expect(page.locator('dialog.modal-confirm[open]')).toContainText('책 할부 3회(총 30,000원)를 모두 삭제할까요?');
    await H.confirmOk(page);
    expect((await H.getState(page)).expenses).toHaveLength(0);
  });

  test('고액 확인은 총액 기준, 개월 수보다 적은 금액은 나눌 수 없음', async ({ page }) => {
    await H.openApp(page);
    let dlg = await fillCredit(page, { amount: '1,200,000', place: '냉장고', months: 12 });
    await dlg.locator('button[type=submit]').click();
    await expect(page.locator('dialog.modal-confirm[open]')).toContainText('1,200,000원을 12개월 할부로 결제하셨네요.');
    await H.confirmOk(page);
    expect(inst(await H.getState(page))).toHaveLength(12);
    dlg = await fillCredit(page, { amount: '2', place: '껌', months: 3 });
    await dlg.locator('button[type=submit]').click();
    await expect(dlg.locator('[data-error-for="amount"]')).toHaveText('3개월 할부는 3원 이상부터 나눌 수 있어요.');
  });

  test('새로고침·백업 후에도 할부 정보 유지, 회차가 빠진 묶음은 일반 지출로', async ({ page }) => {
    await H.openApp(page);
    const dlg = await fillCredit(page, { amount: '30000', place: '책', months: 3 });
    await dlg.locator('button[type=submit]').click();
    await page.reload();
    expect(inst(await H.getState(page))).toHaveLength(3);
    // 저장 데이터에서 한 회차를 지우면 남은 두 회차는 일반 지출로 보정
    await page.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.expenses = d.expenses.filter((e) => e.installment.index !== 3);
      localStorage.setItem(k, JSON.stringify(d));
    }, H.KEY);
    await page.reload();
    await H.addExpenseUI(page, { amount: '500', place: '껌' }); // 보정 결과 저장
    const st = await H.getState(page);
    expect(st.expenses.filter((e) => e.place === '책').every((e) => e.installment === null)).toBe(true);
  });
});

/* =========================================================
 * 2. 예산 추천
 * ========================================================= */
test.describe('예산 추천', () => {
  // 오늘 2026-11-04 → 8·9·10월 기록 사용. 음식은 늘어나는 중, 커피는 그대로, 공과금은 정기 납부(고정)
  const history = () => ({
    expenses: [
      H.exp('2026-08-10', 300000, '식당', 'food'), H.exp('2026-09-10', 400000, '식당', 'food'), H.exp('2026-10-10', 500000, '식당', 'food'),
      H.exp('2026-08-11', 50000, '카페', 'coffee'), H.exp('2026-09-11', 50000, '카페', 'coffee'), H.exp('2026-10-11', 50000, '카페', 'coffee'),
      H.exp('2026-08-25', 140000, '관리비', 'utility'), H.exp('2026-09-25', 140000, '관리비', 'utility'), H.exp('2026-10-25', 140000, '관리비', 'utility'),
    ],
    recurring: [H.rec('관리비', 150000, { type: 'monthly', day: 25 }, { startDate: '2026-08-01', paidPeriods: ['2026-08', '2026-09', '2026-10'] })],
  });

  async function openRec(page) {
    await page.locator('[data-recommend]').click();
    const dlg = H.modal(page);
    await expect(dlg.locator('.modal-title')).toHaveText('2026년 11월 예산 추천');
    return dlg;
  }
  async function recRows(dlg) {
    return dlg.locator('.rec-row:not(.rec-thead)').evaluateAll((rows) => rows.map((r) => {
      const cells = r.querySelectorAll('[role=cell]');
      return [cells[0].textContent.replace(/\s+/g, ' ').trim(), cells[3].textContent.trim()];
    }));
  }

  test('지난 3개월 추이로 추천: 최근 달 가중, 늘어나는 항목 표시, 고정 지출 이상', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    await H.seed(page, history());
    const dlg = await openRec(page);
    await expect(dlg).toContainText('8월·9월·10월 지출 기준');
    // 음식: 500×0.5 + 400×0.3 + 300×0.2 = 430,000 / 커피 50,000 / 공과금: 평균 140,000 < 고정 150,000 → 150,000
    expect(await recRows(dlg)).toEqual([
      ['🍚 음식 ▲ 늘어나는 중', '430,000원'],
      ['☕ 커피', '50,000원'],
      ['🧾 공과금 고정 150,000원', '150,000원'],
      ['전체 예산', '630,000원'],
    ]);
    await dlg.locator('[data-apply]').click();
    await expect(page.locator('#toast-region')).toContainText('[예산 저장]을 눌러 주세요');
    // 바로 저장하지 않고 칸에만 채운다
    expect((await H.getState(page)).budgets).toEqual({});
    await expect(page.locator('input[name=total]')).toHaveValue('630,000');
    await expect(page.locator('input[name="cat:food"]')).toHaveValue('430,000');
    await expect(page.locator('input[name="cat:beauty"]')).toHaveValue('');
    await expect(page.locator('#budget-form button[type=submit]')).toBeFocused();
    await page.locator('#budget-form button[type=submit]').click();
    expect((await H.getState(page)).budgets['2026-11']).toEqual({ total: 630000, byCategory: { food: 430000, coffee: 50000, utility: 150000 } });
  });

  test('목표 총액을 넣으면 고정 지출은 두고 나머지를 비율대로 줄인다', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    await H.seed(page, history());
    const dlg = await openRec(page);
    await dlg.locator('input[name=target]').fill('500,000');
    // 남는 돈 350,000을 음식 430 : 커피 50 비율로 → 313,000 / 36,000 (1,000원 단위 내림)
    expect(await recRows(dlg)).toEqual([
      ['🍚 음식 ▲ 늘어나는 중', '313,000원'],
      ['☕ 커피', '36,000원'],
      ['🧾 공과금 고정 150,000원', '150,000원'],
      ['전체 예산', '500,000원'],
    ]);
    await dlg.locator('input[name=target]').fill('100,000');
    await expect(dlg.locator('.banner-warn')).toContainText('고정 지출(150,000원)보다 적어요');
  });

  test('비율로 나누기: 음식 50%, 뷰티 20%, 나머지 30%', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    await H.seed(page, history());
    const dlg = await openRec(page);
    await dlg.locator('[data-mode=ratio]').click();
    await dlg.locator('input[name=target]').fill('1,000,000');
    await dlg.locator('input[name="pct:food"]').fill('50');
    await dlg.locator('input[name="pct:beauty"]').fill('20');
    await dlg.locator('input[name=restHistory]').uncheck();
    await expect(dlg.locator('[data-amt=food]')).toHaveText('500,000원');
    await expect(dlg.locator('[data-amt=beauty]')).toHaveText('200,000원');
    await expect(dlg.locator('[data-ratio-summary]')).toHaveText('나머지 30% · 카테고리 없이 전체 예산에만 300,000원');
    await dlg.locator('[data-apply]').click();
    await page.locator('#budget-form button[type=submit]').click();
    expect((await H.getState(page)).budgets['2026-11']).toEqual({ total: 1000000, byCategory: { food: 500000, beauty: 200000 } });
  });

  test('비율로 나누기: 나머지는 지난 지출 비율대로 다른 카테고리에', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    await H.seed(page, history());
    const dlg = await openRec(page);
    await dlg.locator('[data-mode=ratio]').click();
    await dlg.locator('input[name=target]').fill('1,000,000');
    await dlg.locator('input[name="pct:food"]').fill('50');
    await dlg.locator('input[name="pct:beauty"]').fill('20');
    // 나머지 300,000 → 커피(평균 50,000) : 공과금(평균 140,000) = 78,000 / 221,000
    await expect(dlg.locator('[data-amt=coffee]')).toHaveText('78,000원 (나머지)');
    await expect(dlg.locator('[data-amt=utility]')).toHaveText('221,000원 (나머지)');
    await expect(dlg.locator('[data-ratio-summary]')).toContainText('1,000원');
  });

  test('비율 합계가 100%를 넘으면 안내하고 넣을 수 없음, 기록이 없으면 자동 추천 안내', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    const dlg = await openRec(page);
    await expect(dlg).toContainText('지난 3개월 지출 기록이 없어서 추천할 수 없어요');
    await expect(dlg.locator('[data-apply]')).toBeDisabled();
    await dlg.locator('[data-mode=ratio]').click();
    await dlg.locator('input[name=target]').fill('1000000');
    await dlg.locator('input[name="pct:food"]').fill('70');
    await dlg.locator('input[name="pct:beauty"]').fill('40');
    await expect(dlg.locator('[data-error-for=pct]')).toHaveText('비율 합계가 110%예요. 100% 이하로 맞춰 주세요.');
    await expect(dlg.locator('[data-apply]')).toBeDisabled();
  });
});

/* =========================================================
 * 3. 주식 — 시세는 가짜 응답(page.route)으로 고정해 계산을 검증
 * ========================================================= */
test.describe('주식', () => {
  const { stock } = H;

  async function addStockUI(page, { market = 'KS', code, quantity, avgPrice, name }) {
    await page.locator('.view-head [data-add], .empty [data-add]').first().click();
    const dlg = H.modal(page);
    await dlg.locator('select[name=market]').selectOption(market);
    await dlg.locator('input[name=code]').fill(code);
    if (name) await dlg.locator('input[name=name]').fill(name);
    await dlg.locator('input[name=quantity]').fill(String(quantity));
    if (avgPrice) await dlg.locator('input[name=avgPrice]').fill(String(avgPrice));
    await dlg.locator('button[type=submit]').click();
    return dlg;
  }

  test('국내 주식: PC 서버로 열면 네이버 시세로 전일·지난달 말 대비와 손익을 보여 준다', async ({ page }) => {
    const log = await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#stocks' });
    await expect(page.locator('.empty')).toContainText('첫 종목 추가');
    await addStockUI(page, { code: '005930', quantity: 10, avgPrice: '200,000' });
    const item = page.locator('.stock-item');
    await expect(item).toContainText('삼성전자'); // 네이버의 한글 종목명
    await expect(item.locator('.stock-price strong')).toHaveText('217,750원');
    // 전일 229,000 → ▼ 11,250원 (-4.91%), 지난달 말 225,000 → ▼ 7,250원 (-3.22%)
    await expect(item.locator('.chg').nth(0)).toHaveText('전일 대비 ▼ 11,250원 (-4.91%)');
    await expect(item.locator('.chg').nth(0)).toHaveClass(/chg-down/);
    await expect(item.locator('.chg').nth(1)).toHaveText('지난달 말 대비 ▼ 7,250원 (-3.22%)');
    await expect(item.locator('.stock-meta')).toContainText('2,177,500원');
    await expect(item.locator('.stock-meta .chg-up')).toHaveText('▲ 177,500원 (+8.88%)');
    await expect(page.locator('#stock-total')).toHaveText('2,177,500원');
    await expect(page.locator('[data-status]')).toContainText('시세: 국내 네이버');
    await expect(page.locator('[data-status]')).toContainText('1분마다 자동 갱신');
    // 외부로는 종목 코드만 (수량·금액 없음), 같은 주소의 중계 서버로
    expect(log.length).toBeGreaterThan(0);
    log.forEach((u) => { expect(u).not.toMatch(/quantity|200000|avg/); });
    expect(log[log.length - 1]).toBe('http://127.0.0.1:8765/api/quote?codes=005930');
  });

  test('해외 주식: Twelve Data API 키로 달러 시세와 환율을 받고, 합계는 원화로 환산', async ({ page }) => {
    const log = await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#stocks' });
    await H.seed(page, { stocks: [stock('KS', '005930', 10), stock('US', 'AAPL', 2, { avgPrice: 300 })], settings: { stockApiKey: 'my-free-key' } });
    const aapl = page.locator('.stock-item').filter({ hasText: 'AAPL' });
    await expect(aapl.locator('.stock-price strong')).toHaveText('$338.32');
    await expect(aapl.locator('.chg').nth(0)).toHaveText('전일 대비 ▼ $6.31 (-1.83%)');
    await expect(aapl.locator('.chg').nth(1)).toHaveText('지난달 말 대비 ▼ $1.68 (-0.49%)'); // 10월 마지막 거래일 340
    await expect(aapl.locator('.stock-meta .chg-up')).toHaveText('▲ $76.64 (+12.77%)');
    // 2,177,500 + 676.64 × 1,342.88 = 2,177,500 + 908,646 = 3,086,146
    await expect(page.locator('#stock-total')).toHaveText('3,086,146원');
    await expect(page.locator('.stock-summary')).toContainText('1달러 = 1,343원');
    await expect(page.locator('[data-status]')).toContainText('국내 네이버 · 해외 Twelve Data');
    const td = log.filter((u) => u.includes('twelvedata'));
    expect(decodeURIComponent(td[0])).toContain('symbol=AAPL,USD/KRW');
    expect(td[0]).toContain('apikey=my-free-key');
    // 국내 종목은 Twelve Data로, 해외 종목은 중계 서버로 보내지 않는다
    expect(decodeURIComponent(td[0])).not.toContain('005930');
    log.filter((u) => u.includes('/api/quote')).forEach((u) => expect(u).not.toContain('AAPL'));
  });

  test('GitHub Pages처럼 파일로 열어도 설정의 중계 서버 주소로 국내 시세를 받는다', async ({ page }) => {
    const log = await H.mockQuotes(page, { relayHost: 'https://ledger-relay.example.workers.dev' });
    await H.openApp(page, { hash: '#settings' });
    await H.seed(page, { stocks: [stock('KQ', '247540', 3)] });
    await page.locator('input[name=stockRelayUrl]').fill('ftp://잘못된주소');
    await page.locator('#stock-form button[type=submit]').click();
    await expect(page.locator('[data-error-for=stockRelayUrl]')).toHaveText('https://로 시작하는 주소를 넣거나 비워 두세요.');
    await page.locator('input[name=stockRelayUrl]').fill('https://ledger-relay.example.workers.dev/');
    await page.locator('#stock-form button[type=submit]').click();
    expect((await H.getState(page)).settings.stockRelayUrl).toBe('https://ledger-relay.example.workers.dev/');
    await H.go(page, 'stocks');
    await expect(page.locator('.stock-price strong')).toHaveText('91,500원');
    await expect(page.locator('.stock-item')).toContainText('에코프로비엠');
    expect(log).toContain('https://ledger-relay.example.workers.dev/api/quote?codes=247540');
  });

  test('중계 서버가 없으면 GitHub 자동 갱신 파일(10분 간격)로 국내 시세를 받는다', async ({ page }) => {
    const log = await H.mockQuotes(page, {
      github: { updatedAt: '2026-11-04T02:40:00.000Z', tradeDate: '2026-11-04', month: '2026-11', q: { '005930': [217750, 229000, 225000, '삼성전자', 'KS'], '247540': [91500, 92100, 90900, '에코프로비엠', 'KQ'] } },
    });
    await H.openApp(page, { hash: '#stocks' }); // 파일로 열고, 중계 서버 주소 없음 (GitHub Pages도 같은 방식)
    await H.seed(page, { stocks: [stock('KS', '005930', 10, { avgPrice: 200000 }), stock('KQ', '999999', 1, { manualPrice: 5000 })] });
    const item = page.locator('.stock-item').filter({ hasText: '005930' });
    await expect(item.locator('.stock-price strong')).toHaveText('217,750원');
    await expect(item).toContainText('삼성전자');
    await expect(item.locator('.chg').nth(0)).toHaveText('전일 대비 ▼ 11,250원 (-4.91%)');
    await expect(item.locator('.chg').nth(1)).toHaveText('지난달 말 대비 ▼ 7,250원 (-3.22%)');
    await expect(item).toContainText('11:40 기준 가격'); // 파일이 만들어진 시각 (한국 시간)
    await expect(page.locator('[data-status]')).toContainText('국내 네이버(10분 간격) · 11:40 기준 · 평일 장중 10분마다 새 시세');
    await expect(page.locator('.stock-item').filter({ hasText: '999999' })).toContainText('종목을 찾지 못했어요');
    expect(log).toEqual(['https://raw.githubusercontent.com/hyeoninny-commits/household-ledger/data/naver-quotes.json']);
    // 3분 안에 다시 갱신하면 파일을 또 받지 않는다 (약 200KB라 데이터 절약)
    await page.locator('[data-refresh]').click();
    await expect(page.locator('[data-status]')).toContainText('국내 네이버');
    expect(log.length).toBe(1);
  });

  test('GitHub 시세 파일이 아직 없고 API 키도 없으면 이유를 알리고 직접 입력 가격으로 계산', async ({ page }) => {
    await H.mockQuotes(page);
    await H.openApp(page, { hash: '#stocks' });
    await H.seed(page, { stocks: [stock('KS', '005930', 3, { name: '삼성전자', manualPrice: 200000 }), stock('US', 'TSLA', 1, { manualPrice: 250 })] });
    await expect(page.locator('[data-status]')).toContainText('국내 시세 파일이 아직 없어요');
    await expect(page.locator('[data-status]')).toContainText('해외 주식 시세는 설정에 Twelve Data API 키를 넣어야');
    await expect(page.locator('.stock-item').first()).toContainText('직접 입력 가격');
    await expect(page.locator('.stock-item .chg').first()).toHaveText('전일 대비 -');
    await expect(page.locator('#stock-total')).toHaveText('600,000원');
    await expect(page.locator('.stock-summary')).toContainText('미국 주식 1개는 환율을 아직 못 받아서');
  });

  test('없는 종목은 그 종목만 안내하고, 잘못된 API 키는 이유를 알려 준다', async ({ page }) => {
    await H.mockQuotes(page, { twelveError: { code: 401, message: 'invalid key' } });
    await H.openApp(page, { http: true, hash: '#stocks' });
    await H.seed(page, { stocks: [stock('KS', '005930', 1), stock('KS', '999999', 1, { manualPrice: 5000 }), stock('US', 'AAPL', 1)], settings: { stockApiKey: 'wrong' } });
    const bad = page.locator('.stock-item').filter({ hasText: '999999' });
    await expect(bad).toContainText('시세를 못 받았어요: 종목을 찾지 못했어요');
    await expect(bad.locator('.stock-price strong')).toHaveText('5,000원');
    await expect(page.locator('.stock-item').filter({ hasText: 'AAPL' })).toContainText('API 키를 확인해 주세요');
    await expect(page.locator('[data-status]')).toContainText('API 키를 확인해 주세요');
    await expect(page.locator('.stock-item').filter({ hasText: '005930' }).locator('.stock-price strong')).toHaveText('217,750원');
  });

  test('자동 갱신: 1분마다 새 시세 (주식 화면을 떠나면 멈춤)', async ({ page }) => {
    let price = 217750;
    const log = await H.mockQuotes(page, { domestic: () => ({ '005930': { price, prevClose: 229000, prevMonthClose: 225000, name: '삼성전자' } }) });
    await H.openApp(page, { http: true, hash: '#stocks', clock: 'install' });
    await H.seed(page, { stocks: [stock('KS', '005930', 1)] });
    await expect(page.locator('.stock-price strong')).toHaveText('217,750원');
    const before = log.length;
    price = 230000;
    await page.clock.fastForward(61_000);
    await expect(page.locator('.stock-price strong')).toHaveText('230,000원');
    await expect(page.locator('.stock-item .chg').first()).toHaveText('전일 대비 ▲ 1,000원 (+0.44%)');
    await expect(page.locator('.stock-item .chg').first()).toHaveClass(/chg-up/);
    expect(log.length).toBe(before + 1);
    await H.go(page, 'home');
    await page.clock.fastForward(180_000);
    expect(log.length).toBe(before + 1);
  });

  test('시세 갱신은 다른 입력을 지우지 않는다 (종목 추가 창 입력 유지)', async ({ page }) => {
    await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#stocks', clock: 'install' });
    await H.seed(page, { stocks: [stock('KS', '005930', 1)] });
    await expect(page.locator('.stock-price strong')).toHaveText('217,750원');
    await page.locator('.view-head [data-add]').click();
    await H.modal(page).locator('input[name=code]').fill('000660');
    await page.clock.fastForward(61_000);
    await expect(H.modal(page).locator('input[name=code]')).toHaveValue('000660');
  });

  test('시세 확인 버튼: 저장 전에 이름·현재가 미리 보기 (국내·해외)', async ({ page }) => {
    await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#stocks' });
    await page.locator('.empty [data-add]').click();
    const dlg = H.modal(page);
    await dlg.locator('input[name=code]').fill('005930');
    await dlg.locator('[data-check]').click();
    await expect(dlg.locator('[data-check-result]')).toHaveText('삼성전자 · 현재가 217,750원');
    await expect(dlg.locator('input[name=name]')).toHaveValue('삼성전자');
    await dlg.locator('select[name=market]').selectOption('US');
    await dlg.locator('input[name=code]').fill('aapl');
    await dlg.locator('[data-check]').click();
    await expect(dlg.locator('[data-check-result]')).toHaveText('지금은 시세를 받을 수 없어요. 해외 주식 시세는 설정에 Twelve Data API 키를 넣어야 받을 수 있어요.');
    expect((await H.getState(page)).market.quotes).toEqual({}); // 미리 보기는 저장하지 않음
  });

  test('입력 검증: 종목 코드 형식, 수량, 중복', async ({ page }) => {
    await H.openApp(page, { hash: '#stocks' });
    let dlg = await addStockUI(page, { code: '12345', quantity: 0 });
    await expect(dlg.locator('[data-error-for=code]')).toHaveText('한국 주식은 6자리 종목 코드(예: 005930)로 입력해 주세요.');
    await expect(dlg.locator('[data-error-for=quantity]')).not.toBeEmpty();
    await dlg.locator('select[name=market]').selectOption('US');
    await dlg.locator('input[name=code]').fill('123');
    await dlg.locator('button[type=submit]').click();
    await expect(dlg.locator('[data-error-for=code]')).toHaveText('미국 주식은 티커(예: AAPL)로 입력해 주세요.');
    await dlg.locator('input[name=code]').fill('tsla');
    await dlg.locator('input[name=quantity]').fill('0.5');
    await dlg.locator('input[name=avgPrice]').fill('250.123');
    await dlg.locator('button[type=submit]').click();
    await expect(dlg.locator('[data-error-for=avgPrice]')).toContainText('소수 2자리까지');
    await dlg.locator('input[name=avgPrice]').fill('250.12');
    await dlg.locator('button[type=submit]').click();
    expect((await H.getState(page)).stocks[0]).toMatchObject({ market: 'US', code: 'TSLA', quantity: 0.5, avgPrice: 250.12 });
    dlg = await addStockUI(page, { market: 'US', code: 'TSLA', quantity: 1 });
    await expect(dlg.locator('[data-error-for=code]')).toContainText('이미 추가한 종목');
  });

  test('설정: API 키·갱신 주기 저장, 5분 주기 표시', async ({ page }) => {
    await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#settings' });
    await H.seed(page, { stocks: [stock('US', 'AAPL', 1)] });
    await page.locator('input[name=stockApiKey]').fill('my-free-key');
    await page.locator('select[name=stockRefreshSec]').selectOption('300');
    await page.locator('#stock-form button[type=submit]').click();
    expect((await H.getState(page)).settings).toMatchObject({ stockApiKey: 'my-free-key', stockRefreshSec: 300, stockRelayUrl: '' });
    await H.go(page, 'stocks');
    await expect(page.locator('.stock-price strong')).toHaveText('$338.32');
    await expect(page.locator('[data-status]')).toContainText('해외 Twelve Data');
    await expect(page.locator('[data-status]')).toContainText('5분마다');
  });

  test('종목 수정·삭제', async ({ page }) => {
    await H.mockQuotes(page);
    await H.openApp(page, { http: true, hash: '#stocks' });
    await H.seed(page, { stocks: [stock('KS', '005930', 10, { name: '삼성전자' })] });
    await page.locator('[data-edit]').click();
    await H.modal(page).locator('input[name=quantity]').fill('15');
    await H.modal(page).locator('button[type=submit]').click();
    await expect(page.locator('.stock-meta')).toContainText('15주');
    await expect(page.locator('#stock-total')).toHaveText('3,266,250원');
    await page.locator('[data-del]').click();
    await H.confirmOk(page);
    await expect(page.locator('.empty')).toBeVisible();
    expect((await H.getState(page)).stocks).toEqual([]);
  });
});
