// 버그·예외 상황 점검 (PROMPTS 4단계 [3])
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const H = require('../helpers');

test.describe('입력 검증', () => {
  const bad = [
    ['0', '스타벅스', 'amount'],
    ['-1000', '스타벅스', 'amount'],
    ['1.5', '스타벅스', 'amount'],
    ['1500.50', '스타벅스', 'amount'],
    ['abc', '스타벅스', 'amount'],
    ['1e5', '스타벅스', 'amount'],
    ['99999999999999999', '스타벅스', 'amount'],
    ['', '스타벅스', 'amount'],
    ['5000', '', 'place'],
    ['5000', '    ', 'place'],
  ];
  for (const [amount, place, field] of bad) {
    test(`금액 "${amount}" / 사용처 "${place}" → ${field} 오류, 저장 안 됨`, async ({ page }) => {
      await H.openApp(page);
      const dlg = await H.addExpenseUI(page, { amount, place });
      await expect(dlg.locator(`[data-error-for="${field}"]`)).not.toBeEmpty();
      await expect(dlg.locator(`[name="${field}"]`)).toHaveAttribute('aria-invalid', 'true');
      await expect(dlg.locator(`[name="${field}"]`)).toBeFocused();
      expect((await H.getState(page)).expenses).toHaveLength(0);
    });
  }

  test('쉼표·"원"이 붙은 금액은 허용', async ({ page }) => {
    await H.openApp(page);
    await H.addExpenseUI(page, { amount: '12,500원', place: '김밥' });
    expect((await H.getState(page)).expenses[0].amount).toBe(12500);
  });

  test('[B6] 금액 상한 10억 원: 넘으면 안내하고 저장하지 않음, 10억 원은 저장', async ({ page }) => {
    await H.openApp(page);
    for (const amount of ['9,007,199,254,740,991', '1,000,000,001']) {
      const dlg = await H.addExpenseUI(page, { amount, place: '테스트' });
      await expect(dlg.locator('[data-error-for="amount"]')).toHaveText('금액은 1,000,000,000원까지 입력할 수 있어요.');
      await expect(page.locator('dialog.modal-confirm[open]')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    expect((await H.getState(page)).expenses).toHaveLength(0);
    await H.addExpenseUI(page, { amount: '1,000,000,000', place: '전세 보증금' });
    await H.confirmOk(page);
    expect((await H.getState(page)).expenses[0].amount).toBe(1000000000);
  });

  test('[B6] 예산·하루 한도도 10억 원을 넘으면 안내', async ({ page }) => {
    await H.openApp(page, { hash: '#budget' });
    await page.locator('input[name=total]').fill('9999999999999');
    await page.locator('#budget-form button[type=submit]').click();
    await expect(page.locator('[data-error-for="total"]')).toContainText('1,000,000,000원');
    expect((await H.getState(page)).budgets).toEqual({});
  });

  test('정기 납부 "며칠 전부터 알림"을 비우면 0일로 조용히 저장되지 않아야 한다', async ({ page }) => {
    await H.openApp(page, { hash: '#recurring' });
    await page.locator('.view-head [data-add]').click();
    const dlg = H.modal(page);
    await dlg.locator('input[name=name]').fill('관리비');
    await dlg.locator('input[name=amount]').fill('150000');
    await dlg.locator('input[name=remindDaysBefore]').fill('');
    await dlg.locator('button[type=submit]').click();
    // [B7] 빈칸이면 오류를 보여 주고 저장하지 않는다 (0을 직접 넣으면 당일 알림으로 저장)
    await expect(dlg.locator('[data-error-for="remindDaysBefore"]')).toContainText('0~30');
    expect((await H.getState(page)).recurring).toHaveLength(0);
    await dlg.locator('input[name=remindDaysBefore]').fill('0');
    await dlg.locator('button[type=submit]').click();
    expect((await H.getState(page)).recurring[0].remindDaysBefore).toBe(0);
  });
});

test.describe('날짜 경계', () => {
  test('브라우저가 UTC여도 한국 자정이 지나면 오늘은 다음 날', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'UTC', locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-30T15:30:00Z')); // KST 12-01 00:30
    await page.goto(H.APP_URL);
    await expect(page.locator('.view-title')).toContainText('12월 1일');
    const dlg = await H.openExpenseForm(page);
    await expect(dlg.locator('input[name=date]')).toHaveValue('2026-12-01');
    await ctx.close();
  });

  test('브라우저가 LA 시간대여도 한국 날짜 기준', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'America/Los_Angeles', locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-04T08:00:00+09:00')); // LA는 11-03 15:00
    await page.goto(H.APP_URL);
    await expect(page.locator('.view-title')).toContainText('11월 4일');
    await H.addExpenseUI(page, { amount: '3000', place: '편의점' });
    const st = await H.getState(page);
    expect(st.expenses[0].date).toBe('2026-11-04');
    expect(st.expenses[0].createdAt).toMatch(/^2026-11-04T08:00:00\+09:00$/);
    await ctx.close();
  });

  test('한국 23:59:59는 아직 그날', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'UTC', locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-11-30T23:59:59+09:00'));
    await page.goto(H.APP_URL);
    await expect(page.locator('.view-title')).toContainText('11월 30일');
    await ctx.close();
  });

  test('연말: 12월 31일 → 다음 달/다음 주가 해를 넘어간다', async ({ page }) => {
    await H.openApp(page, { date: '2026-12-31' });
    await H.seed(page, { expenses: [H.exp('2026-12-31', 10000, '송년회 술집', 'meetup'), H.exp('2027-01-02', 20000, '여행', 'culture')] });
    await H.go(page, 'stats');
    await page.locator('[data-type=month]').click();
    await page.locator('[data-shift="1"]').click();
    await expect(page.locator('.period-label')).toHaveText('2027년 1월');
    expect(H.won(await page.locator('#stats-total').textContent())).toBe(20000);
    await page.locator('[data-today]').click();
    await page.locator('[data-type=week]').click();
    await expect(page.locator('.period-label')).toHaveText('12.28 ~ 1.3');
    expect(H.won(await page.locator('#stats-total').textContent())).toBe(30000);
    await H.go(page, 'budget');
    await page.locator('[data-shift="1"]').click();
    await expect(page.locator('.period-label')).toHaveText('2027년 1월');
  });

  test('1월에 "지난달" 필터는 전년도 12월', async ({ page }) => {
    await H.openApp(page, { date: '2027-01-05', hash: '#list' });
    await H.seed(page, { expenses: [H.exp('2026-12-31', 10000, '술집', 'meetup'), H.exp('2026-11-30', 5000, '카페', 'coffee')] });
    await page.locator('[data-preset=lastMonth]').click();
    await expect(page.locator('.list-summary')).toContainText('1건');
    await expect(page.locator('.list-summary')).toContainText('10,000원');
  });

  test('매주 목요일 납부: 2026-W53 회차 납부 후 다음 회차는 2027-01-07', async ({ page }) => {
    await H.openApp(page, { date: '2026-12-31', hash: '#recurring' });
    await H.seed(page, { recurring: [H.rec('주간 용돈 저축', 30000, { type: 'weekly', weekday: 4 }, { categoryId: 'saving', startDate: '2026-12-01', paidPeriods: ['2026-W49', '2026-W50', '2026-W51', '2026-W52'] })] });
    await expect(page.locator('.rec-next')).toContainText('12월 31일');
    await page.locator('[data-pay]').click();
    await H.modal(page).locator('button[type=submit]').click();
    await expect(page.locator('.rec-next')).toContainText('1월 7일');
    expect((await H.getState(page)).recurring[0].paidPeriods).toContain('2026-W53');
  });

  test('매년 2월 29일 납부는 평년에 2월 28일', async ({ page }) => {
    await H.openApp(page, { date: '2027-02-01', hash: '#recurring' });
    await H.seed(page, { recurring: [H.rec('연회비', 50000, { type: 'yearly', month: 2, day: 29 }, { startDate: '2027-01-01' })] });
    await expect(page.locator('.rec-next')).toContainText('2월 28일');
  });
});

test.describe('수정/삭제 즉시 반영', () => {
  test('금액 수정·삭제 시 홈 경고·통계·예산이 바로 바뀐다', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, {
      expenses: [H.exp('2026-11-03', 85000, '식당', 'food'), H.exp('2026-11-04', 5000, '카페', 'coffee')],
      budgets: { '2026-11': { total: 200000, byCategory: { food: 100000 } } },
    });
    await expect(page.locator('.banner-warn')).toContainText('음식 예산의 85%');
    await page.locator('[data-expense-id]').filter({ hasText: '식당' }).click();
    await H.modal(page).locator('input[name=amount]').fill('50000');
    await H.modal(page).locator('button[type=submit]').click();
    await expect(page.locator('.banner')).toHaveCount(0);
    expect(H.won(await page.locator('.stat-cell strong').nth(2).textContent())).toBe(55000);
    await expect(page.locator('.cover-value')).toContainText('145,000');
    await H.go(page, 'stats');
    expect(H.won(await page.locator('#stats-total').textContent())).toBe(55000);
    await H.go(page, 'budget');
    await expect(page.locator('.budget-row').filter({ has: page.locator('label[for="b-food"]') })).toContainText('50,000원 / 100,000원');

    await H.go(page, 'list');
    await page.locator('[data-expense-id]').filter({ hasText: '식당' }).click();
    await H.modal(page).locator('[data-delete]').click();
    await H.confirmOk(page);
    await expect(page.locator('.list-summary')).toContainText('5,000원');
    await H.go(page, 'stats');
    expect(H.won(await page.locator('#stats-total').textContent())).toBe(5000);
  });

  test('삭제 확인에서 취소하면 그대로', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { expenses: [H.exp('2026-11-03', 8000, '식당', 'food')] });
    await page.locator('[data-expense-id]').click();
    await H.modal(page).locator('[data-delete]').click();
    await page.locator('dialog.modal-confirm[open] [data-close]').last().click();
    expect((await H.getState(page)).expenses).toHaveLength(1);
  });

  test('정기 납부로 기록된 지출을 삭제하면 그 회차가 다시 납부 전 상태', async ({ page }) => {
    await H.openApp(page, { date: '2026-11-25' });
    await H.seed(page, { recurring: [H.rec('관리비', 150000, { type: 'monthly', day: 25 }, { startDate: '2026-11-01' })] });
    await page.locator('.due-item [data-pay]').click();
    await H.modal(page).locator('button[type=submit]').click();
    await expect(page.locator('.due-item')).toHaveCount(0);
    await page.locator('[data-expense-id]').filter({ hasText: '관리비' }).click();
    await H.modal(page).locator('[data-delete]').click();
    await expect(page.locator('dialog.modal-confirm[open]')).toContainText('다시 납부 전 상태');
    await H.confirmOk(page);
    await expect(page.locator('.due-item .dday')).toHaveText('오늘');
    expect((await H.getState(page)).recurring[0].paidPeriods).toEqual([]);
  });

  test('카테고리 삭제 시 지출·정기 납부는 기타로, 예산·학습 규칙은 정리', async ({ page }) => {
    await H.openApp(page, { hash: '#settings' });
    await H.seed(page, {
      expenses: [H.exp('2026-11-03', 4500, '스타벅스', 'coffee'), H.exp('2026-11-04', 5000, '블루샥', 'coffee')],
      placeRules: { '블루샥': 'coffee' },
      budgets: { '2026-11': { total: 500000, byCategory: { coffee: 50000, food: 100000 } } },
      recurring: [H.rec('원두 구독', 20000, { type: 'monthly', day: 10 }, { categoryId: 'coffee' })],
    });
    await page.locator('[data-cat-del="coffee"]').click();
    await expect(page.locator('dialog.modal-confirm[open]')).toContainText('지출 2건은 "기타"로');
    await H.confirmOk(page);
    const st = await H.getState(page);
    expect(st.categories.find((c) => c.id === 'coffee')).toBeUndefined();
    expect(st.expenses.every((e) => e.categoryId === 'etc')).toBe(true);
    expect(st.recurring[0].categoryId).toBe('etc');
    expect(st.budgets['2026-11'].byCategory).toEqual({ food: 100000 });
    expect(st.placeRules).toEqual({});
    await H.go(page, 'list');
    await expect(page.locator('.expense-item').first()).toContainText('기타');
  });
});

test.describe('잘못된 데이터에 대한 내구성', () => {
  test('JSON이 아닌 파일 가져오기 → 안내 후 기존 데이터 유지', async ({ page }, info) => {
    await H.openApp(page, { hash: '#settings' });
    await H.seed(page, { expenses: [H.exp('2026-11-03', 8000, '식당', 'food')] });
    const f = info.outputPath('bad.json');
    fs.writeFileSync(f, '{ 이건 JSON이 아님');
    await page.locator('#import-file').setInputFiles(f);
    await expect(page.locator('#toast-region')).toContainText('JSON 파일을 읽지 못했어요');
    expect((await H.getState(page)).expenses).toHaveLength(1);
  });

  test('형식이 다른 JSON 가져오기 → 거부', async ({ page }, info) => {
    await H.openApp(page, { hash: '#settings' });
    const f = info.outputPath('other.json');
    fs.writeFileSync(f, JSON.stringify({ hello: 'world' }));
    await page.locator('#import-file').setInputFiles(f);
    await expect(page.locator('#toast-region')).toContainText('가계부 백업 파일이 아니에요');
  });


  test('새 버전 스키마 백업 가져오기 → 확인창 없이 거부', async ({ page }, info) => {
    await H.openApp(page, { hash: '#settings' });
    const f = info.outputPath('v99.json');
    fs.writeFileSync(f, JSON.stringify({ schemaVersion: 99, expenses: [], categories: [{ id: 'etc', name: '기타', emoji: '📦', color: '#999999', keywords: [] }] }));
    await page.locator('#import-file').setInputFiles(f);
    await expect(page.locator('#toast-region')).toContainText('새로운 버전');
    await expect(page.locator('dialog.modal-confirm[open]')).toHaveCount(0);
  });

  // [B1] 일부가 잘못된 백업: 고칠 수 있는 값은 고치고, 고칠 수 없는 항목만 빼고 가져온다
  const malformed = {
    '정기 납부에 cycle이 없음': { patch: { recurring: [{ id: 'r1', name: '관리비', amount: 1000 }, { id: 'r2', name: '통신비', amount: 55000, cycle: { type: 'monthly', day: 10 } }] }, skipped: '정기 납부 1건' },
    '카테고리에 keywords가 없음': { patch: { categories: [{ id: 'food', name: '음식', emoji: '🍚', color: '#E0703A' }, { id: 'etc', name: '기타', emoji: '📦', color: '#9CA3AF' }] }, skipped: null },
    '예산 값이 null': { patch: { budgets: { '2026-11': null, '2026-10': { total: 500000 } } }, skipped: null },
    '지출 날짜가 없음': { patch: { expenses: [H.exp('2026-11-03', 8000, '식당', 'food'), { id: 'x', amount: 1000, place: '날짜 없음' }] }, skipped: '지출 1건' },
  };
  for (const [name, { patch, skipped }] of Object.entries(malformed)) {
    test(`[B1] 일부가 잘못된 백업(${name})을 가져와도 앱이 멈추지 않는다`, async ({ page }, info) => {
      const errors = H.collectErrors(page);
      await H.openApp(page, { hash: '#settings' });
      const data = Object.assign({ schemaVersion: 1, expenses: [H.exp('2026-11-03', 8000, '식당', 'food')] }, patch);
      data.categories = data.categories || (await page.evaluate(() => window.Ledger.storage.createDefault().categories));
      const f = info.outputPath('partial.json');
      fs.writeFileSync(f, JSON.stringify(data));
      await page.locator('#import-file').setInputFiles(f);
      const c = page.locator('dialog.modal-confirm[open]');
      if (skipped) await expect(c).toContainText(`형식이 잘못된 ${skipped}은 빼고 가져와요`);
      else await expect(c).not.toContainText('빼고 가져와요');
      await H.confirmOk(page);
      for (const r of ['home', 'list', 'stats', 'budget', 'recurring', 'settings']) {
        await page.evaluate((r) => { location.hash = '#' + r; }, r);
        await expect(page.locator('#view')).toHaveAttribute('data-route', r);
        await expect(page.locator('#view .view-root .card').first()).toBeVisible();
        await expect(page.locator('#view')).not.toContainText('문제가 생겼어요');
      }
      // 고친 뒤에는 카테고리 삭제 등 일반 기능도 동작
      await page.locator('[data-cat-del="food"]').click();
      await H.confirmOk(page);
      const st = await H.getState(page);
      expect(st.categories.some((x) => x.id === 'food')).toBe(false);
      expect(st.expenses.every((e) => e.date && e.amount > 0)).toBe(true);
      expect(st.recurring.every((r) => r.cycle && r.cycle.type)).toBe(true);
      expect(st.categories.every((x) => Array.isArray(x.keywords))).toBe(true);
      await page.reload();
      await expect(page.locator('#view .view-root .card').first()).toBeVisible();
      expect(errors.filter((e) => e.startsWith('[pageerror]')), '페이지 오류').toEqual([]);
    });
  }

  test('[B1] 화면 하나에서 예기치 못한 오류가 나도 안내와 설정 링크를 보여 준다', async ({ page }) => {
    await H.openApp(page);
    await page.evaluate(() => { window.Ledger.views.stats.render = () => { throw new Error('테스트용 오류'); }; location.hash = '#stats'; });
    await expect(page.locator('#view')).toContainText('이 화면을 그리는 중 문제가 생겼어요');
    await page.locator('#view a[href="#settings"]').click();
    await expect(page.locator('#view')).toHaveAttribute('data-route', 'settings');
    await expect(page.locator('a.tab[data-route=settings]')).toHaveAttribute('aria-current', 'page');
  });

  test('localStorage가 깨져 있으면 안내하고 새로 시작, 원본은 따로 보관', async ({ page }) => {
    await H.openApp(page);
    await page.evaluate((k) => localStorage.setItem(k, '{깨진 데이터'), H.KEY);
    await page.reload();
    await expect(page.locator('#app-alert')).toBeVisible();
    await expect(page.locator('#app-alert')).toContainText('보관');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.some((k) => k.startsWith('household-ledger-corrupted-'))).toBe(true);
    await H.addExpenseUI(page, { amount: '3000', place: '편의점' });
    expect((await H.getState(page)).expenses).toHaveLength(1);
  });

  test('[B2] localStorage의 지출에 날짜가 빠져 있으면 그 건만 빼고 열고, 원본 보관 후 안내', async ({ page }) => {
    const errors = H.collectErrors(page);
    await H.openApp(page);
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
      schemaVersion: 1,
      expenses: [{ id: 'a', amount: 1000, place: '가게A' }, { id: 'b', amount: 2000, place: '가게B', date: '2026-11-03' }, { id: 'c', amount: 3000, place: '가게C', date: '2026-11-02' }],
    })), H.KEY);
    await page.reload();
    await expect(page.locator('.expense-list')).toContainText('가게B');
    await expect(page.locator('.expense-list')).toContainText('가게C');
    await expect(page.locator('#app-alert')).toContainText('형식이 잘못된 항목 1건');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.some((k) => k.startsWith('household-ledger-corrupted-'))).toBe(true);
    expect(errors.filter((e) => e.startsWith('[pageerror]'))).toEqual([]);
  });

  test('스키마 버전이 없는 옛 데이터는 현재 버전(v4)으로 변환', async ({ page }) => {
    await H.openApp(page);
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
      expenses: [{ id: 'a', amount: 1000, place: '가게', date: '2026-11-03', categoryId: 'food' }],
      recurring: [{ id: 'r', name: '관리비', amount: 1000, categoryId: 'utility', cycle: { type: 'monthly', day: 25 } }],
    })), H.KEY);
    await page.reload();
    await expect(page.locator('.expense-list')).toContainText('가게');
    await H.addExpenseUI(page, { amount: '500', place: '껌' });
    const st = await H.getState(page);
    expect(st.schemaVersion).toBe(4);
    expect(st.stocks).toEqual([]);
    expect(st.expenses[0].installment).toBeNull();
    expect(st.recurring[0]).toMatchObject({ paidPeriods: [], remindDaysBefore: 3 });
    expect(st.settings.warnPercent).toBe(80);
  });

  test('[B4] v1 데이터의 짧은 기본 키워드는 구체적인 키워드로 바뀌고, 직접 넣은 키워드는 유지', async ({ page }) => {
    await H.openApp(page);
    await page.evaluate((k) => {
      const d = window.Ledger.storage.createDefault();
      d.schemaVersion = 1;
      d.categories.find((c) => c.id === 'food').keywords = ['배민', '마트', '빵', '우리동네식당'];
      d.categories.find((c) => c.id === 'living').keywords = ['꽃', '세탁'];
      d.categories.find((c) => c.id === 'utility').keywords = ['관리비', '전기', '가스', '수도'];
      localStorage.setItem(k, JSON.stringify(d));
    }, H.KEY);
    await page.reload();
    await H.addExpenseUI(page, { amount: '500', place: '껌' }); // 저장해서 변환 결과를 기록
    const st = await H.getState(page);
    const kw = (id) => st.categories.find((c) => c.id === id).keywords;
    expect(kw('food')).toEqual(['배민', '롯데마트', '하나로마트', '노브랜드', '코스트코', '빵집', '파리바게뜨', '뚜레쥬르', '우리동네식당']);
    expect(kw('living')).toEqual(['꽃집', '플라워', '세탁']);
    expect(kw('utility')).toEqual(['관리비', '전기요금', '한국전력', '한전', '가스요금', '도시가스', '수도요금']);
  });
});

test.describe('[B4] 자동 분류', () => {
  for (const [place, wrong, why] of [
    ['스마트폰 케이스', 'food', '"마트" 키워드에 걸림'],
    ['꽃게탕', 'living', '"꽃" 키워드에 걸림'],
    ['전기자전거 대여', 'utility', '"전기" 키워드에 걸림'],
    ['Cuckoo 서비스센터', 'food', '영문 "CU"가 단어 안에 걸림'],
    ['Booktopia', 'utility', '영문 "KT"가 단어 안에 걸림'],
  ]) {
    test(`${place}는 ${wrong}로 추천되면 안 된다 (${why})`, async ({ page }) => {
      await H.openApp(page);
      const dlg = await H.openExpenseForm(page);
      await dlg.locator('input[name=place]').fill(place);
      const got = await dlg.locator('.chip[aria-checked="true"]').getAttribute('data-cat');
      expect(got).not.toBe(wrong);
    });
  }
  for (const [place, cat] of [
    ['CU 강남역점', 'food'], ['cu편의점', 'food'], ['이마트 트레이더스', 'food'], ['롯데마트', 'food'], ['파리바게뜨', 'food'],
    ['KT 통신비', 'utility'], ['KTX 서울-부산', 'transport'], ['한국전력 전기요금', 'utility'], ['동네 꽃집', 'living'],
    ['GYM24', 'fitness'], ['GYM 24', 'fitness'], ['SKT', 'utility'], ['CGV용산', 'culture'],
  ]) {
    test(`${place} → ${cat}`, async ({ page }) => {
      await H.openApp(page);
      const dlg = await H.openExpenseForm(page);
      await dlg.locator('input[name=place]').fill(place);
      await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', cat);
    });
  }
});

test.describe('[B3] 고정 지출 합계', () => {
  test('다음 달부터 시작하는 정기 납부는 이번 달 고정 지출에 넣지 않는다', async ({ page }) => {
    await H.openApp(page, { hash: '#recurring' });
    await H.seed(page, { recurring: [
      H.rec('관리비', 150000, { type: 'monthly', day: 25 }, { startDate: '2026-10-01' }),
      H.rec('새 적금', 300000, { type: 'monthly', day: 25 }, { categoryId: 'saving', startDate: '2026-12-01' }),
      H.rec('중간 시작', 20000, { type: 'monthly', day: 10 }, { startDate: '2026-11-15' }), // 이번 달 10일은 시작 전
    ] });
    await expect(page.locator('.view-sub')).toContainText('150,000원');
    await H.go(page, 'budget');
    await expect(page.locator('.fixed-line')).toContainText('150,000원');
    await page.locator('[data-shift="1"]').click(); // 12월: 관리비 + 새 적금 + 중간 시작
    await expect(page.locator('.fixed-line')).toContainText('470,000원');
  });
});
