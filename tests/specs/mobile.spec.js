// 모바일 기기 확인: 아이폰(Safari/WebKit), 갤럭시·픽셀(Chrome)에서 http:// 주소로 접속했을 때
// 실행: npx playwright test --project="iPhone 13 (Safari/WebKit)"  (프로젝트 이름은 playwright.config.js 참고)
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const H = require('../helpers');

const ROUTES = ['home', 'list', 'stats', 'budget', 'recurring', 'stocks', 'settings'];
const SHOTS = path.join(H.SHOT_DIR, 'mobile');
fs.mkdirSync(SHOTS, { recursive: true });
const slug = () => test.info().project.name.replace(/[^\w가-힣]+/g, '-').replace(/-+$/, '');

const sample = () => ({
  expenses: [
    H.exp('2026-11-04', 4500, '스타벅스 강남역 리저브 매장 2층 창가 자리', 'coffee', { payment: 'kakaopay', memo: '아주 긴 메모가 들어가도 줄바꿈이 잘 되는지 확인하기 위한 문장입니다' }),
    H.exp('2026-11-03', 120000, '올리브영', 'beauty', { payment: 'credit' }),
    H.exp('2026-11-02', 85000, '식당', 'food'),
    H.exp('2026-11-01', 1000000000, '전세 보증금 일부', 'living'),
    H.exp('2026-10-30', 33000, '필라테스', 'fitness'),
  ],
  budgets: { '2026-11': { total: 1500000, byCategory: { food: 100000, beauty: 100000 } } },
  recurring: [H.rec('관리비', 150000, { type: 'monthly', day: 5 }, { startDate: '2026-11-01' }), H.rec('적금', 300000, { type: 'monthly', day: 25 }, { startDate: '2026-11-01', categoryId: 'saving' })],
  stocks: [
    { id: 's1', market: 'KS', code: '005930', name: '삼성전자', quantity: 12, avgPrice: 198000, manualPrice: null, memo: '' },
    { id: 's2', market: 'US', code: 'AAPL', name: '', quantity: 3.5, avgPrice: 301.25, manualPrice: null, memo: '장기 보유' },
    { id: 's3', market: 'KQ', code: '247540', name: '에코프로비엠 아주 긴 종목 이름 테스트', quantity: 1, avgPrice: null, manualPrice: null, memo: '' },
  ],
  settings: { stockApiKey: 'test-key' },
});

async function tapTab(page, route) {
  await page.evaluate(() => { window.__log = []; });
  await page.locator(`a.tab[data-route="${route}"]`).tap();
  try {
    await expect(page.locator('#view')).toHaveAttribute('data-route', route, { timeout: 3000 });
  } catch (e) {
    console.log('TAPMISS', test.info().project.name, route, JSON.stringify(await page.evaluate(() => [location.hash, window.__log, document.activeElement && document.activeElement.outerHTML.slice(0, 80)])));
    throw e;
  }
}

/** 가로 넘침(px): 문서와 열린 모달 */
const overflowX = (page) => H.overflowX(page);

// 주식 시세는 가짜 응답으로 고정 (국내: 네이버 중계 서버 형식, 해외: Twelve Data 형식)
test.beforeEach(async ({ page }) => {
  await H.mockQuotes(page);
  await page.addInitScript(() => {
    window.__log = [];
    ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'click', 'hashchange'].forEach((t) =>
      window.addEventListener(t, (e) => {
        const tab = e.target && e.target.closest ? e.target.closest('a.tab') : null;
        window.__log.push(t + ':' + (tab ? tab.dataset.route : (e.target && e.target.tagName)) + (e.defaultPrevented ? '(prevented)' : ''));
      }, true));
    // 앱의 클릭 처리(document) 뒤에 실행 → 앱이 이동을 처리했는지(defaultPrevented) 기록
    window.addEventListener('click', (e) => {
      const tab = e.target && e.target.closest ? e.target.closest('a.tab') : null;
      if (tab) window.__log.push('after-app:' + tab.dataset.route + (e.defaultPrevented ? '(handled)' : '(NOT handled)') + ' hash=' + location.hash + ' route=' + (window.Ledger && window.Ledger.router && window.Ledger.router.current()));
    });
  });
  // 등장 애니메이션 도중에 위치를 재지 않도록 (실제 기기에서는 애니메이션이 정상 동작)
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('일곱 화면 모두 가로 스크롤 없이 보이고, 맨 아래 내용이 탭바·추가 버튼에 가려지지 않음', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, sample());
  const vp = page.viewportSize();
  for (const r of ROUTES) {
    await tapTab(page, r);
    expect(await overflowX(page), `${r} 가로 넘침`).toBe(0);
    const nav = await page.locator('nav.nav').boundingBox();
    // 탭바는 화면 아래에 붙어 있다 (가로 모드 포함)
    expect(Math.round(nav.y + nav.height)).toBeLessThanOrEqual(vp.height);
    expect(nav.y).toBeGreaterThan(vp.height / 2);
    // 맨 아래로 스크롤했을 때 마지막 내용이 탭바보다 위에 있다
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastBottom = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#view .view-root > *:not(.fab)')].filter((e) => e.getBoundingClientRect().height > 0);
      return items.length ? items[items.length - 1].getBoundingClientRect().bottom : 0;
    });
    expect(lastBottom, `${r} 마지막 내용 아래쪽`).toBeLessThanOrEqual(nav.y + 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, `${slug()}-${r}.png`) });
  }
});

test('터치로 지출 추가: 시트가 화면 안에 열리고, 입력 칸 글자가 16px 이상(아이폰 자동 확대 방지)', async ({ page }) => {
  await H.openApp(page);
  await page.locator('#fab-add').tap();
  const dlg = H.modal(page);
  await expect(dlg.locator('form.expense-form')).toBeVisible();
  const vp = page.viewportSize();
  const box = await dlg.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(await overflowX(page)).toBe(0);

  const small = await dlg.locator('input, select, textarea').evaluateAll((els) => els
    .filter((e) => e.type !== 'checkbox' && e.getBoundingClientRect().width > 0)
    .map((e) => [e.name, parseFloat(getComputedStyle(e).fontSize)]).filter(([, s]) => s < 16));
  expect(small, '16px보다 작은 입력 칸').toEqual([]);

  await dlg.locator('input[name=amount]').tap();
  await dlg.locator('input[name=amount]').fill('6500');
  await dlg.locator('input[name=place]').tap();
  await dlg.locator('input[name=place]').fill('메가커피');
  await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', 'coffee');
  await dlg.locator('.chip[data-cat="meetup"]').tap();
  await expect(dlg.locator('input[name=meetup]')).toBeChecked();
  await dlg.locator('select[name=payment]').selectOption('naverpay');
  await dlg.locator('input[name=date]').fill('2026-11-03');
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-add-sheet.png`) });
  const save = dlg.locator('button[type=submit]');
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.tap();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const e = (await H.getState(page)).expenses[0];
  expect(e).toMatchObject({ amount: 6500, place: '메가커피', categoryId: 'meetup', payment: 'naverpay', date: '2026-11-03' });

  // 저장 알림이 화면 안에, 탭바에 가리지 않게 보인다
  const toast = page.locator('#toast-region .toast').last();
  await expect(toast).toBeVisible();
  const tb = await toast.boundingBox();
  const nav = await page.locator('nav.nav').boundingBox();
  expect(tb.y + tb.height).toBeLessThanOrEqual(nav.y + 1);
  expect(tb.x).toBeGreaterThanOrEqual(0);
  expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width + 1);
});

test('모든 입력 창의 입력 칸 글자가 16px 이상', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, sample());
  const openers = [['home', '#fab-add'], ['recurring', '.view-head [data-add]'], ['recurring', '[data-pay]'], ['settings', '[data-cat-add]']];
  const bad = [];
  for (const [r, sel] of openers) {
    await tapTab(page, r);
    await page.locator(sel).first().tap();
    await expect(page.locator('dialog[open]')).toBeVisible();
    bad.push(...(await page.locator('dialog[open]').locator('input, select, textarea').evaluateAll((els, sel) => els
      .filter((e) => e.type !== 'checkbox' && e.type !== 'color' && e.getBoundingClientRect().width > 0)
      .map((e) => [sel, e.name, parseFloat(getComputedStyle(e).fontSize)]).filter((x) => x[2] < 16), sel)));
    await page.locator('dialog[open] [data-close]').first().tap();
  }
  // 화면 위 입력 칸 (내역 필터, 예산, 설정)
  for (const r of ['list', 'budget', 'settings']) {
    await tapTab(page, r);
    if (r === 'list') await page.locator('.filter-more summary').tap();
    bad.push(...(await page.locator('#view input, #view select').evaluateAll((els, r) => els
      .filter((e) => e.type !== 'file' && e.getBoundingClientRect().width > 0)
      .map((e) => [r, e.name, parseFloat(getComputedStyle(e).fontSize)]).filter((x) => x[2] < 16), r)));
  }
  expect(bad).toEqual([]);
});

test('터치 대상 크기: 탭바·추가 버튼 44px 이상, 화면 안 버튼 36px 이상', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, sample());
  const big = await page.locator('a.tab, #fab-add').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect(); return [e.textContent.trim() || e.id, Math.round(r.width), Math.round(r.height)];
  }).filter((x) => x[1] < 44 || x[2] < 44));
  expect(big, '44px 미만').toEqual([]);
  const small = [];
  for (const r of ROUTES) {
    await tapTab(page, r);
    small.push(...(await page.locator('#view button, #view a.btn, #view label.btn, #view summary').evaluateAll((els, r) => els.map((e) => {
      const b = e.getBoundingClientRect(); return [r, e.textContent.trim().slice(0, 12), Math.round(b.width), Math.round(b.height)];
    }).filter((x) => x[2] > 0 && (x[2] < 36 || x[3] < 36)), r)));
  }
  expect(small, '36px 미만').toEqual([]);
});

test('터치로 내역 수정·삭제, 정기 납부 완료', async ({ page }) => {
  await H.openApp(page, { date: '2026-11-05' });
  await H.seed(page, sample());
  // 다가오는 납부 → 납부 완료
  await page.locator('.due-item [data-pay]').first().tap();
  const pay = H.modal(page);
  await expect(pay.locator('input[name=amount]')).toHaveValue('150,000');
  await pay.locator('button[type=submit]').tap();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect((await H.getState(page)).recurring[0].paidPeriods).toContain('2026-11');
  // 내역 → 항목 탭 → 금액 수정
  await tapTab(page, 'list');
  await page.locator('[data-expense-id]').filter({ hasText: '식당' }).tap();
  await H.modal(page).locator('input[name=amount]').fill('9000');
  await H.modal(page).locator('button[type=submit]').tap();
  await expect(page.locator('.expense-item').filter({ hasText: '식당' })).toContainText('9,000원');
  // 삭제 → 확인창도 화면 안
  await page.locator('[data-expense-id]').filter({ hasText: '식당' }).tap();
  await H.modal(page).locator('[data-delete]').tap();
  const c = page.locator('dialog.modal-confirm[open]');
  await expect(c).toBeVisible();
  await expect(c.locator('[data-ok]')).toBeInViewport();
  await c.locator('[data-ok]').tap();
  await expect(page.locator('.expense-item').filter({ hasText: '식당' })).toHaveCount(0);
});

test('통계 차트를 탭하면 말풍선이 화면 안에 뜬다', async ({ page }) => {
  await H.openApp(page, { hash: '#stats' });
  await H.seed(page, sample());
  const vp = page.viewportSize();
  const donut = page.locator('svg.donut');
  await donut.scrollIntoViewIfNeeded();
  const box = await donut.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2 + 3, box.y + box.height * 0.1);
  const tip = page.locator('#chart-tip');
  await expect(tip).toBeVisible();
  await expect(page.locator('[data-center-top]')).not.toHaveText('합계');
  const tb = await tip.boundingBox();
  expect(tb.x).toBeGreaterThanOrEqual(0);
  expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width + 1);
  // 맨 오른쪽 막대 (화면 가장자리에서도 말풍선이 잘리지 않는지)
  const bar = page.locator('#trend-card g.bar').last();
  await bar.scrollIntoViewIfNeeded();
  const bb = await bar.boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await expect(tip).toContainText('2026년 11월');
  const tb2 = await tip.boundingBox();
  expect(tb2.x).toBeGreaterThanOrEqual(0);
  expect(tb2.x + tb2.width, '오른쪽 막대 말풍선이 화면 밖으로 나감').toBeLessThanOrEqual(vp.width + 1);
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-chart-tip.png`) });
});

test('내역 상세 조건을 펼치고 기간·결제수단을 바꿀 수 있다', async ({ page }) => {
  await H.openApp(page, { hash: '#list' });
  await H.seed(page, sample());
  await expect(page.locator('details.filter-more')).not.toHaveAttribute('open', '');
  await page.locator('.filter-more summary').tap();
  await page.locator('select[name=payment]').selectOption('credit');
  await expect(page.locator('.list-summary')).toContainText('1건');
  expect(await overflowX(page)).toBe(0);
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-list-filter.png`) });
});

test('예산 입력: 긴 목록에서도 저장 버튼이 보이고 저장된다', async ({ page }) => {
  await H.openApp(page, { hash: '#budget' });
  await page.locator('input[name=total]').tap();
  await page.locator('input[name=total]').fill('1500000');
  await page.locator('input[name="cat:etc"]').scrollIntoViewIfNeeded();
  await page.locator('input[name="cat:etc"]').fill('50000');
  const save = page.locator('#budget-form button[type=submit]');
  await expect(save).toBeInViewport();
  const sb = await save.boundingBox();
  const nav = await page.locator('nav.nav').boundingBox();
  expect(sb.y + sb.height, '저장 버튼이 탭바에 가려짐').toBeLessThanOrEqual(nav.y + 1);
  await save.tap();
  expect((await H.getState(page)).budgets['2026-11']).toEqual({ total: 1500000, byCategory: { etc: 50000 } });
});

test('새로고침해도 데이터 유지 (http 주소)', async ({ page }) => {
  await H.openApp(page);
  await page.locator('#fab-add').tap();
  await H.modal(page).locator('input[name=amount]').fill('3000');
  await H.modal(page).locator('input[name=place]').fill('편의점');
  await H.modal(page).locator('button[type=submit]').tap();
  await page.reload();
  await expect(page.locator('.expense-list')).toContainText('편의점');
});

test('다크 모드 화면', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await H.openApp(page);
  await H.seed(page, sample());
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-dark-home.png`) });
  await page.locator('#fab-add').tap();
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-dark-add.png`) });
});

test('콘솔 오류 없음', async ({ page }) => {
  const errors = H.collectErrors(page);
  await H.openApp(page);
  await H.seed(page, sample());
  for (const r of ROUTES) await tapTab(page, r);
  expect(errors).toEqual([]);
});

test('저사양 휴대폰(CPU 4배 느리게)에서 지출 1만 건: 화면 전환·저장 1초 이내 @perf', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU 속도 조절은 Chrome에서만 가능');
  test.setTimeout(120_000);
  await H.openApp(page);
  await page.evaluate((KEY) => {
    const d = window.Ledger.storage.createDefault();
    const cats = d.categories.map((c) => c.id);
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 10000; i++) {
      const day = new Date(start + (i % 670) * 86400000).toISOString().slice(0, 10);
      d.expenses.push({ id: 'p' + i, date: day, amount: 1000 + (i * 37) % 90000, place: '가게 ' + (i % 300), categoryId: cats[i % cats.length], memo: '', payment: null, recurringId: null, recurringPeriod: null, createdAt: day + 'T09:00:00+09:00' });
    }
    localStorage.setItem(KEY, JSON.stringify(d));
  }, H.KEY);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.reload();
  await expect(page.locator('.expense-list')).toBeVisible();
  const timings = {};
  for (const r of [...ROUTES.slice(1), 'home']) {
    const t0 = Date.now();
    await tapTab(page, r);
    await expect(page.locator('#view .view-root')).not.toBeEmpty();
    timings[r] = Date.now() - t0;
  }
  await page.locator('#fab-add').tap();
  await H.modal(page).locator('input[name=amount]').fill('5000');
  await H.modal(page).locator('input[name=place]').fill('김밥');
  const t0 = Date.now();
  await H.modal(page).locator('button[type=submit]').tap();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  timings.save = Date.now() - t0;
  console.log('MOBILE-TIMINGS', test.info().project.name, JSON.stringify(timings));
  Object.entries(timings).forEach(([k, v]) => expect(v, k).toBeLessThan(1000));
});


test('주식: 7개 탭이 한 줄에 들어가고, 종목 카드와 합계가 화면 안에 맞는다', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, sample());
  await tapTab(page, 'stocks');
  await expect(page.locator('.stock-item')).toHaveCount(3);
  await expect(page.locator('.stock-item').first().locator('.stock-price strong')).not.toHaveText('-');
  await expect(page.locator('[data-status]')).toContainText('국내 네이버 · 해외 Twelve Data');
  expect(await overflowX(page)).toBe(0);
  const tabs = await page.locator('a.tab').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect(); const span = e.querySelector('span');
    return { w: r.width, h: r.height, clipped: span.scrollWidth > span.clientWidth + 1 || span.getBoundingClientRect().width > r.width + 0.5 };
  }));
  expect(tabs).toHaveLength(7);
  expect(tabs.filter((t) => t.clipped), '탭 글자 잘림').toEqual([]);
  // 종목 카드 안의 글자가 카드 밖으로 넘치지 않는다
  const overflow = await page.locator('.stock-item').evaluateAll((cards) => cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  expect(overflow).toBe(0);
  await page.locator('.stock-item').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-stocks.png`) });
  // 터치로 종목 추가
  await page.locator('.view-head [data-add]').tap();
  const dlg = H.modal(page);
  await dlg.locator('select[name=market]').selectOption('US');
  await dlg.locator('input[name=code]').fill('MSFT');
  await dlg.locator('input[name=quantity]').fill('2');
  expect(await overflowX(page)).toBe(0);
  const save = dlg.locator('button[type=submit]');
  await save.scrollIntoViewIfNeeded();
  await save.tap();
  await expect(page.locator('.stock-item')).toHaveCount(4);
  await expect(page.locator('.stock-item').filter({ hasText: 'MSFT' })).toContainText('시세를 못 받았어요');
});

test('할부: 신용카드를 고르면 할부 칸이 나오고 터치로 3개월 할부 저장', async ({ page }) => {
  await H.openApp(page);
  await page.locator('#fab-add').tap();
  const dlg = H.modal(page);
  await dlg.locator('input[name=amount]').fill('90000');
  await dlg.locator('input[name=place]').fill('무신사');
  await dlg.locator('select[name=payment]').selectOption('credit');
  await expect(dlg.locator('select[name=months]')).toBeVisible();
  await dlg.locator('select[name=months]').selectOption('3');
  await expect(dlg.locator('[data-installment-hint]')).toContainText('매달 30,000원');
  expect(await overflowX(page)).toBe(0);
  const fs16 = await dlg.locator('select[name=months]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(fs16).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-installment.png`) });
  const save = dlg.locator('button[type=submit]');
  await save.scrollIntoViewIfNeeded();
  await save.tap();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect((await H.getState(page)).expenses.filter((e) => e.installment)).toHaveLength(3);
});

test('예산 추천 창: 표와 비율 입력이 화면 안에 맞고 터치로 적용', async ({ page }) => {
  await H.openApp(page, { hash: '#budget' });
  await H.seed(page, {
    expenses: [H.exp('2026-10-10', 500000, '식당', 'food'), H.exp('2026-09-10', 400000, '식당', 'food'), H.exp('2026-10-11', 50000, '카페', 'coffee')],
  });
  await page.locator('[data-recommend]').tap();
  const dlg = H.modal(page);
  await expect(dlg.locator('.rec-row').nth(1)).toContainText('음식');
  expect(await overflowX(page)).toBe(0);
  await page.screenshot({ path: path.join(SHOTS, `${slug()}-recommend.png`) });
  await dlg.locator('[data-mode=ratio]').tap();
  await dlg.locator('input[name=target]').fill('1000000');
  await dlg.locator('input[name="pct:food"]').fill('50');
  await expect(dlg.locator('[data-amt=food]')).toHaveText('500,000원');
  expect(await overflowX(page)).toBe(0);
  const small = await dlg.locator('input').evaluateAll((els) => els.filter((e) => e.type !== 'checkbox' && e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.name));
  expect(small).toEqual([]);
  const apply = dlg.locator('[data-apply]');
  await apply.scrollIntoViewIfNeeded();
  await apply.tap();
  await expect(page.locator('input[name="cat:food"]')).toHaveValue('500,000');
});
