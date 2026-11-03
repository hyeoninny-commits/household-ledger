// PRD 3장 요구사항별 동작 확인 (완료 기준에서 다루지 않은 것 위주)
const { test, expect } = require('@playwright/test');
const H = require('../helpers');

test('F-1.1 입력 항목: 날짜 기본값 오늘, 결제수단 6종, 메모', async ({ page }) => {
  await H.openApp(page);
  const dlg = await H.openExpenseForm(page);
  await expect(dlg.locator('input[name=date]')).toHaveValue('2026-11-04');
  const opts = await dlg.locator('select[name=payment] option').allTextContents();
  expect(opts).toEqual(['선택 안 함', '현금', '체크카드', '신용카드', '카카오페이', '네이버페이', '기타']);
  await dlg.locator('input[name=amount]').fill('6500');
  await dlg.locator('input[name=place]').fill('메가커피');
  await dlg.locator('select[name=payment]').selectOption('kakaopay');
  await dlg.locator('input[name=memo]').fill('친구 것까지');
  await dlg.locator('input[name=place]').press('Enter'); // Enter로 저장
  const e = (await H.getState(page)).expenses[0];
  expect(e).toMatchObject({ amount: 6500, place: '메가커피', categoryId: 'coffee', payment: 'kakaopay', memo: '친구 것까지', date: '2026-11-04' });
});

test('F-1.3 날짜 내림차순 + 기간·카테고리·키워드 필터', async ({ page }) => {
  await H.openApp(page, { hash: '#list' });
  await H.seed(page, { expenses: [
    H.exp('2026-11-01', 1000, '가', 'food'), H.exp('2026-11-04', 2000, '나 카페', 'coffee'),
    H.exp('2026-11-02', 3000, '다', 'food', { memo: '점심 회식' }), H.exp('2026-10-20', 4000, '라', 'food'),
  ] });
  const heads = await page.locator('.day-head span:first-child').allTextContents();
  expect(heads).toEqual(['11월 4일 (수)', '11월 2일 (월)', '11월 1일 (일)']);
  await page.locator('input[name=q]').fill('회식'); // 메모 검색
  await expect(page.locator('.list-summary')).toContainText('1건');
  await page.locator('input[name=q]').fill('');
  await page.locator('[data-preset=all]').click();
  await expect(page.locator('.list-summary')).toContainText('4건');
  await page.locator('select[name=categoryId]').selectOption('food');
  await expect(page.locator('.list-summary')).toContainText('3건');
});

test('F-1.4 금액 천 단위 쉼표', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, { expenses: [H.exp('2026-11-04', 1234567, '노트북', 'shopping')] });
  await expect(page.locator('.expense-amount')).toHaveText('1,234,567원');
});

test('F-1.5 결제수단 표시와 필터', async ({ page }) => {
  await H.openApp(page, { hash: '#list' });
  await H.seed(page, { expenses: [
    H.exp('2026-11-04', 1000, '편의점', 'food', { payment: 'kakaopay' }),
    H.exp('2026-11-04', 2000, '빵집', 'food', { payment: 'naverpay' }),
    H.exp('2026-11-04', 3000, '분식', 'food'),
  ] });
  await expect(page.locator('.expense-item').filter({ hasText: '편의점' })).toContainText('카카오페이');
  await page.locator('select[name=payment]').selectOption('naverpay');
  await expect(page.locator('.list-summary')).toContainText('1건');
  await expect(page.locator('.expense-item')).toContainText('빵집');
});

test('F-2.4 금액 보조 규칙: 키워드가 없으면 기타', async ({ page }) => {
  await H.openApp(page);
  const dlg = await H.openExpenseForm(page);
  await dlg.locator('input[name=amount]').fill('4500');
  await dlg.locator('input[name=place]').fill('어느 가게');
  await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', 'etc');
});

test('F-2.5 설정에서 카테고리·키워드 추가 → 분류에 바로 반영', async ({ page }) => {
  await H.openApp(page, { hash: '#settings' });
  await page.locator('[data-cat-add]').click();
  const dlg = H.modal(page);
  await dlg.locator('input[name=name]').fill('반려동물');
  await dlg.locator('input[name=emoji]').fill('🐶');
  await dlg.locator('textarea[name=keywords]').fill('동물병원, 펫샵');
  await dlg.locator('button[type=submit]').click();
  await expect(page.locator('.setting-list')).toContainText('반려동물');
  await H.go(page, 'home');
  const form = await H.openExpenseForm(page);
  await form.locator('input[name=place]').fill('행복 동물병원');
  await expect(form.locator('.chip[aria-checked="true"]')).toContainText('반려동물');
});

test('F-2.6 약속 토글은 키워드 추천보다 우선, 학습하지 않음', async ({ page }) => {
  await H.openApp(page);
  await H.addExpenseUI(page, { amount: '15000', place: '스타벅스', meetup: true });
  const st = await H.getState(page);
  expect(st.expenses[0].categoryId).toBe('meetup');
  expect(st.placeRules).toEqual({});
});

test('F-3.1 일/주/월 이동, 주는 월요일 시작', async ({ page }) => {
  await H.openApp(page, { hash: '#stats' }); // 2026-11-04 수요일
  await page.locator('[data-type=week]').click();
  await expect(page.locator('.period-label')).toHaveText('11.2 ~ 11.8');
  await page.locator('[data-type=day]').click();
  await page.locator('[data-shift="-1"]').click();
  await expect(page.locator('.period-label')).toHaveText('11월 3일 (화)');
  await page.locator('[data-today]').click();
  await expect(page.locator('.period-label')).toHaveText('11월 4일 (수)');
});

test('F-3.2·3.3 도넛·추이 막대 개수 (7일/8주/6개월)', async ({ page }) => {
  await H.openApp(page, { hash: '#stats' });
  await H.seed(page, { expenses: [H.exp('2026-11-04', 1000, '가', 'food'), H.exp('2026-11-04', 3000, '나', 'coffee')] });
  await expect(page.locator('.donut-seg')).toHaveCount(2);
  for (const [t, n] of [['day', 7], ['week', 8], ['month', 6]]) {
    await page.locator(`[data-type=${t}]`).click();
    await expect(page.locator('#trend-card g.bar')).toHaveCount(n);
    await expect(page.locator('#trend-card g.bar').last()).toHaveClass(/is-current/);
  }
});

test('F-3.4 직전 기간 대비 증감 문구', async ({ page }) => {
  await H.openApp(page, { hash: '#stats' });
  await H.seed(page, { expenses: [H.exp('2026-11-03', 100000, '가', 'food'), H.exp('2026-10-10', 80000, '나', 'food')] });
  await expect(page.locator('.compare')).toHaveText('지난달보다 20,000원 더 씀 ▲25%');
});

test('F-4.2·4.3 예산 진행 막대와 하루 권장 지출', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, {
    expenses: [H.exp('2026-11-02', 400000, '가', 'shopping')],
    budgets: { '2026-11': { total: 1000000, byCategory: {} } },
  });
  // 남은 600,000원 ÷ 오늘 포함 27일 = 22,222원
  await expect(page.locator('.pace-note')).toContainText('22,222원');
  await H.go(page, 'budget');
  await expect(page.locator('.hero-daily')).toContainText('22,222원');
  await expect(page.locator('.hero .progress')).toHaveAttribute('aria-valuenow', '40');
  await expect(page.locator('.hero')).toContainText('600,000원 남음');
});

test('F-4.1·4.4 예산 입력 저장과 지난달 복사', async ({ page }) => {
  await H.openApp(page, { hash: '#budget' });
  await H.seed(page, { budgets: { '2026-10': { total: 1200000, byCategory: { food: 300000 } } } });
  await page.locator('[data-copy]').click();
  expect((await H.getState(page)).budgets['2026-11']).toEqual({ total: 1200000, byCategory: { food: 300000 } });
  await page.locator('input[name=total]').fill('1,500,000');
  await page.locator('input[name="cat:coffee"]').fill('60000');
  await page.locator('#budget-form button[type=submit]').click();
  expect((await H.getState(page)).budgets['2026-11']).toEqual({ total: 1500000, byCategory: { food: 300000, coffee: 60000 } });
});

test('F-5.1 주의 기준 %를 설정에서 바꾸면 반영', async ({ page }) => {
  await H.openApp(page, { hash: '#settings' });
  await H.seed(page, {
    expenses: [H.exp('2026-11-03', 75000, '식당', 'food')],
    budgets: { '2026-11': { total: null, byCategory: { food: 100000 } } },
  });
  await page.locator('input[name=warnPercent]').fill('70');
  await page.locator('#warn-form button[type=submit]').click();
  await H.go(page, 'home');
  await expect(page.locator('.banner-warn')).toContainText('음식 예산의 75%');
});

test('F-5.3 하루 지출 한도 초과 경고 (배너 + 토스트)', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, { settings: { dailyLimit: 50000 } });
  await H.addExpenseUI(page, { amount: '60000', place: '백화점' });
  await expect(page.locator('#toast-region')).toContainText('하루 한도 50,000원을 10,000원 넘었어요');
  await expect(page.locator('.banner-over')).toContainText('하루 한도');
});

test('F-5.x 경고는 색 외에 아이콘·문구로도 구분', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, {
    expenses: [H.exp('2026-11-03', 120000, '식당', 'food'), H.exp('2026-11-03', 85000, '카페', 'coffee')],
    budgets: { '2026-11': { total: null, byCategory: { food: 100000, coffee: 100000 } } },
  });
  await expect(page.locator('.banner-over')).toContainText('🚨');
  await expect(page.locator('.banner-warn')).toContainText('⚠️');
  // 초과가 주의보다 먼저
  await expect(page.locator('.banner').first()).toHaveClass(/banner-over/);
});

test('F-6.1 정기 납부 등록: 이름으로 카테고리 추천, 매주/매년 주기', async ({ page }) => {
  await H.openApp(page, { hash: '#recurring' });
  await page.locator('.view-head [data-add]').click();
  let dlg = H.modal(page);
  await dlg.locator('input[name=name]').fill('청년 적금');
  await expect(dlg.locator('select[name=categoryId]')).toHaveValue('saving');
  await dlg.locator('input[name=amount]').fill('300000');
  await dlg.locator('select[name=day]').selectOption('10');
  await dlg.locator('button[type=submit]').click();
  await page.locator('.view-head [data-add]').click();
  dlg = H.modal(page);
  await dlg.locator('input[name=name]').fill('자동차 보험');
  await dlg.locator('input[name=amount]').fill('600000');
  await dlg.locator('select[name=cycleType]').selectOption('yearly');
  await dlg.locator('select[name=month]').selectOption('3');
  await dlg.locator('select[name=day]').selectOption('15');
  await dlg.locator('button[type=submit]').click();
  const st = await H.getState(page);
  expect(st.recurring.map((r) => [r.name, r.categoryId, r.cycle])).toEqual([
    ['청년 적금', 'saving', { type: 'monthly', day: 10 }],
    ['자동차 보험', 'utility', { type: 'yearly', month: 3, day: 15 }],
  ]);
  await expect(page.locator('.recurring-item')).toHaveCount(2);
  await expect(page.locator('.recurring-item').first()).toContainText('매월 10일');
});

test('F-6.2 다가오는 납부는 D-day 순', async ({ page }) => {
  await H.openApp(page, { date: '2026-11-22' });
  await H.seed(page, { recurring: [
    H.rec('통신비', 55000, { type: 'monthly', day: 25 }, { startDate: '2026-11-01' }),
    H.rec('적금', 300000, { type: 'monthly', day: 22 }, { startDate: '2026-11-01', categoryId: 'saving' }),
    H.rec('관리비', 150000, { type: 'monthly', day: 24 }, { startDate: '2026-11-01' }),
  ] });
  const rows = await page.locator('.due-item').evaluateAll((els) => els.map((e) => e.querySelector('.dday').textContent + ' ' + e.querySelector('strong').textContent));
  expect(rows).toEqual(['오늘 적금', 'D-2 관리비', 'D-3 통신비']);
});

test('F-7.5 초기화 두 번째 확인에서 취소하면 데이터 유지', async ({ page }) => {
  await H.openApp(page, { hash: '#settings' });
  await H.seed(page, { expenses: [H.exp('2026-11-03', 8000, '식당', 'food')] });
  await page.locator('[data-reset]').click();
  await H.confirmOk(page);
  await page.locator('dialog.modal-confirm[open] [data-close]').last().click();
  expect((await H.getState(page)).expenses).toHaveLength(1);
});

test('테마 선택이 새로고침 후에도 유지', async ({ page }) => {
  await H.openApp(page, { hash: '#settings' });
  await page.locator('[data-theme-opt=dark]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('30일 동안 백업하지 않으면 홈에 백업 권유', async ({ page }) => {
  await H.openApp(page);
  await H.seed(page, { expenses: [H.exp('2026-10-01', 1000, '가', 'food')] });
  await expect(page.locator('.banners')).toContainText('마지막 백업 후 30일');
});
