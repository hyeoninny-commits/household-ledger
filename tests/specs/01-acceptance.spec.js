// PRD 9장 완료 기준 시나리오
const os = require('os');
const fs = require('fs');
const path = require('path');
const { test, expect, chromium } = require('@playwright/test');
const H = require('../helpers');

test.describe('AC-1 데이터 유지', () => {
  test('지출 추가 → 새로고침 → 브라우저를 닫고 다시 열어도 유지', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-profile-'));
    try {
      let ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      let page = ctx.pages()[0] || await ctx.newPage();
      await H.openApp(page);
      await H.addExpenseUI(page, { amount: '12500', place: '김밥천국' });
      await expect(page.locator('.expense-list')).toContainText('김밥천국');
      await page.reload();
      await expect(page.locator('.expense-list')).toContainText('김밥천국');
      await expect(page.locator('.expense-list')).toContainText('12,500원');
      await ctx.close();

      // 브라우저 재시작
      ctx = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      page = ctx.pages()[0] || await ctx.newPage();
      await H.openApp(page);
      await expect(page.locator('.expense-list')).toContainText('김밥천국');
      const st = await H.getState(page);
      expect(st.expenses).toHaveLength(1);
      expect(st.expenses[0]).toMatchObject({ amount: 12500, place: '김밥천국', categoryId: 'food', date: '2026-11-04' });
      await ctx.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('AC-2 키워드 자동 추천', () => {
  for (const [place, cat] of [['스타벅스', 'coffee'], ['올리브영', 'beauty'], ['헬스장', 'fitness'], ['배달의민족', 'food']]) {
    test(`${place} → ${cat}`, async ({ page }) => {
      await H.openApp(page);
      const dlg = await H.openExpenseForm(page);
      await dlg.locator('input[name=place]').fill(place);
      await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', cat);
      await expect(dlg.locator(`.chip[data-cat="${cat}"]`)).toHaveClass(/is-suggested/);
    });
  }
});

test.describe('AC-3 카테고리 학습', () => {
  test('올리브영을 쇼핑으로 바꾸면 다음부터 쇼핑 추천 (공백·대소문자 무시)', async ({ page }) => {
    await H.openApp(page);
    await H.addExpenseUI(page, { amount: '30000', place: '올리브영', category: 'shopping' });
    const dlg = await H.openExpenseForm(page);
    await dlg.locator('input[name=place]').fill('  올리브영 ');
    await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', 'shopping');
    await expect(dlg.locator('[data-suggest-note]')).toContainText('전에 고른');
    const st = await H.getState(page);
    expect(st.placeRules).toEqual({ '올리브영': 'shopping' });
  });

  test('키워드 없는 사용처를 고른 카테고리로 학습', async ({ page }) => {
    await H.openApp(page);
    await H.addExpenseUI(page, { amount: '9000', place: '동네 국수집', category: 'food' });
    const dlg = await H.openExpenseForm(page);
    await dlg.locator('input[name=place]').fill('동네 국수집');
    await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', 'food');
  });

  test('수정 화면에서 카테고리를 바꿔도 학습', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { expenses: [H.exp('2026-11-04', 5000, '블루샥', 'etc')] });
    await page.locator('[data-expense-id]').first().click();
    await H.modal(page).locator('.chip[data-cat="coffee"]').click();
    await H.modal(page).locator('button[type=submit]').click();
    const dlg = await H.openExpenseForm(page);
    await dlg.locator('input[name=place]').fill('블루샥');
    await expect(dlg.locator('.chip[aria-checked="true"]')).toHaveAttribute('data-cat', 'coffee');
  });
});

test.describe('AC-4 일/주/월 합계 = 내역 합계', () => {
  // 오늘 2026-11-04(수). 이번 주 11-02~11-08, 지난주 10-26~11-01(두 달에 걸침)
  const data = [
    H.exp('2026-11-04', 4500, '스타벅스', 'coffee'),
    H.exp('2026-11-04', 12000, '김밥천국', 'food'),
    H.exp('2026-11-04', 33000, '올리브영', 'beauty'),
    H.exp('2026-11-03', 8000, '메가커피', 'coffee'),
    H.exp('2026-11-02', 70000, '필라테스', 'fitness'),
    H.exp('2026-11-01', 25000, '배민', 'food'),
    H.exp('2026-10-31', 41000, '이자카야', 'meetup'),
    H.exp('2026-10-26', 1250, '버스', 'transport'),
    H.exp('2026-10-25', 99000, '쿠팡', 'shopping'),
    H.exp('2026-11-10', 15000, '약국', 'medical'),
    H.exp('2026-11-30', 150000, '관리비', 'utility'),
    H.exp('2026-09-15', 52000, 'CGV', 'culture'),
  ];
  const sumRange = (from, to) => data.filter((e) => e.date >= from && e.date <= to).reduce((a, e) => a + e.amount, 0);
  const byCat = (from, to) => data.filter((e) => e.date >= from && e.date <= to)
    .reduce((m, e) => { m[e.categoryId] = (m[e.categoryId] || 0) + e.amount; return m; }, {});
  const NAMES = { coffee: '커피', food: '음식', beauty: '뷰티', fitness: '운동', meetup: '약속', transport: '교통', shopping: '쇼핑', medical: '의료', utility: '공과금', culture: '문화/여가' };

  async function readStats(page) {
    const total = H.won(await page.locator('#stats-total').textContent());
    const rows = await page.locator('.cat-row').evaluateAll((els) => els.map((r) => [
      r.querySelector('.cat-name').textContent.trim(), r.querySelector('.cat-amount').textContent,
    ]));
    const cats = {};
    rows.forEach(([n, a]) => { cats[n.replace(/^\S+\s/, '')] = Number(a.replace(/[^\d]/g, '')); });
    return { total, cats };
  }

  async function listTotal(page, from, to, categoryId = '') {
    await H.go(page, 'list');
    const f = page.locator('#list-filters');
    if (!(await f.locator('details').evaluate((d) => d.open))) await f.locator('summary').click();
    await f.locator('input[name=from]').fill(from);
    await f.locator('input[name=to]').fill(to);
    await f.locator('select[name=categoryId]').selectOption(categoryId);
    const summary = page.locator('.list-summary strong');
    if (await summary.count() === 0) return 0;
    return H.won(await summary.textContent());
  }

  for (const [type, label, from, to] of [
    ['day', '일', '2026-11-04', '2026-11-04'],
    ['week', '주', '2026-11-02', '2026-11-08'],
    ['month', '월', '2026-11-01', '2026-11-30'],
  ]) {
    test(`${label} 탭 합계·카테고리 금액이 계산값·내역 합계와 같다`, async ({ page }) => {
      await H.openApp(page);
      await H.seed(page, { expenses: data });
      await H.go(page, 'stats');
      await page.locator(`[data-type="${type}"]`).click();
      const s = await readStats(page);
      expect(s.total).toBe(sumRange(from, to));
      const expectCats = {};
      Object.entries(byCat(from, to)).forEach(([id, v]) => { expectCats[NAMES[id]] = v; });
      expect(s.cats).toEqual(expectCats);
      expect(Object.values(s.cats).reduce((a, b) => a + b, 0)).toBe(s.total);
      expect(await listTotal(page, from, to)).toBe(s.total);
      for (const [id, v] of Object.entries(byCat(from, to))) {
        expect(await listTotal(page, from, to, id)).toBe(v);
      }
    });
  }

  test('두 달에 걸친 지난주(10.26~11.1) 합계와 직전 기간 대비 문구', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { expenses: data });
    await H.go(page, 'stats');
    await page.locator('[data-type="week"]').click();
    const thisWeek = sumRange('2026-11-02', '2026-11-08');
    const lastWeek = sumRange('2026-10-26', '2026-11-01');
    const diff = thisWeek - lastWeek;
    await expect(page.locator('.compare')).toContainText(`지난주보다 ${Math.abs(diff).toLocaleString('ko-KR')}원 ${diff > 0 ? '더' : '덜'} 씀`);
    await page.locator('[data-shift="-1"]').click();
    await expect(page.locator('.period-label')).toHaveText('10.26 ~ 11.1');
    expect((await readStats(page)).total).toBe(lastWeek);
    // 추이 막대 8개, 마지막이 현재 기간
    await expect(page.locator('#trend-card g.bar')).toHaveCount(8);
  });

  test('홈의 오늘/이번 주/이번 달 합계', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, { expenses: data });
    const cells = page.locator('.stat-cell strong');
    expect(H.won(await cells.nth(0).textContent())).toBe(sumRange('2026-11-04', '2026-11-04'));
    expect(H.won(await cells.nth(1).textContent())).toBe(sumRange('2026-11-02', '2026-11-08'));
    expect(H.won(await cells.nth(2).textContent())).toBe(sumRange('2026-11-01', '2026-11-30'));
  });
});

test.describe('AC-5 예산 80%·100% 경계', () => {
  const cases = [
    [79000, null], [80000, 'warn'], [99000, 'warn'], [100000, 'over'], [101000, 'over'],
  ];
  for (const [spent, level] of cases) {
    test(`음식 예산 100,000원 중 ${spent.toLocaleString()}원 사용 → ${level || '경고 없음'}`, async ({ page }) => {
      await H.openApp(page);
      await H.seed(page, {
        expenses: [H.exp('2026-11-03', spent, '식당', 'food')],
        budgets: { '2026-11': { total: null, byCategory: { food: 100000 } } },
      });
      const banners = page.locator('.banners .banner');
      if (!level) {
        await expect(banners).toHaveCount(0);
      } else if (level === 'warn') {
        await expect(banners.first()).toHaveClass(/banner-warn/);
        await expect(banners.first()).toContainText(`⚠️ 이번 달 음식 예산의 ${spent / 1000}%를 사용했어요. 남은 금액 ${(100000 - spent).toLocaleString()}원`);
      } else {
        await expect(banners.first()).toHaveClass(/banner-over/);
        await expect(banners.first()).toContainText(spent === 100000 ? '🚨 이번 달 음식 예산을 모두 사용했어요.' : `🚨 이번 달 음식 예산을 ${(spent - 100000).toLocaleString()}원 초과했어요.`);
      }
      await H.go(page, 'budget');
      const row = page.locator('.budget-row').filter({ has: page.locator('label[for="b-food"]') });
      await expect(row).toHaveClass(new RegExp(`budget-${level || 'ok'}`));
      if (level === 'warn') await expect(row.locator('.badge')).toHaveText('⚠️ 주의');
      if (level === 'over') await expect(row.locator('.badge')).toHaveText('🚨 초과');
      if (!level) await expect(row.locator('.badge')).toHaveCount(0);
    });
  }

  test('저장으로 79% → 80%가 되는 순간 토스트, 100%가 되는 순간 토스트', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, {
      expenses: [H.exp('2026-11-03', 79000, '식당', 'food')],
      budgets: { '2026-11': { total: null, byCategory: { food: 100000 } } },
    });
    await H.addExpenseUI(page, { amount: '1000', place: '김밥', category: 'food' });
    await expect(page.locator('#toast-region')).toContainText('⚠️ 음식 예산의 80%를 썼어요');
    await H.addExpenseUI(page, { amount: '20000', place: '김밥', category: 'food' });
    await expect(page.locator('#toast-region')).toContainText('🚨 음식 예산을 모두 썼어요');
  });
});

test.describe('AC-6 고액 지출 확인', () => {
  test('100,000원은 저장 전 확인, 취소하면 저장 안 됨', async ({ page }) => {
    await H.openApp(page);
    await H.addExpenseUI(page, { amount: '100,000', place: '백화점' });
    const c = page.locator('dialog.modal-confirm[open]');
    await expect(c).toBeVisible();
    await expect(c).toContainText('100,000원');
    await c.locator('[data-close]').last().click();
    expect((await H.getState(page)).expenses).toHaveLength(0);
    await expect(H.modal(page).locator('form.expense-form')).toBeVisible(); // 입력 창은 남아 있음
    await H.modal(page).locator('button[type=submit]').click();
    await H.confirmOk(page);
    expect((await H.getState(page)).expenses).toHaveLength(1);
  });

  test('99,999원은 확인 없이 저장', async ({ page }) => {
    await H.openApp(page);
    await H.addExpenseUI(page, { amount: '99999', place: '백화점' });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect((await H.getState(page)).expenses[0].amount).toBe(99999);
  });
});

test.describe('AC-7 매월 25일 정기 납부', () => {
  const item = H.rec('관리비', 150000, { type: 'monthly', day: 25 }, { startDate: '2026-10-01', paidPeriods: ['2026-10'] });
  const expectations = [
    ['2026-11-21', null],
    ['2026-11-22', 'D-3'],
    ['2026-11-25', '오늘'],
    ['2026-11-26', '미납 1일'],
  ];
  for (const [date, label] of expectations) {
    test(`${date} 홈 표시: ${label || '목록에 없음'}`, async ({ page }) => {
      await H.openApp(page, { date });
      await H.seed(page, { recurring: [item] });
      const due = page.locator('.due-item');
      if (!label) {
        await expect(due).toHaveCount(0);
        await expect(page.locator('.home-grid')).toContainText('다음 납부는 관리비');
        return;
      }
      await expect(due).toHaveCount(1);
      await expect(due.locator('.dday')).toHaveText(label);
      if (label === '미납 1일') {
        await expect(due).toHaveClass(/due-overdue/);
        await expect(page.locator('.banner-over')).toContainText('납부일이 지난 정기 납부가 1건');
        const color = await due.locator('.dday').evaluate((e) => getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e).color);
        expect(color).toMatch(/\d/); // 색 정보 기록용
      } else {
        await expect(page.locator('.banners')).toContainText(label === '오늘' ? '오늘 납부: 관리비' : '곧 납부할 항목이 1건');
      }
    });
  }

  test('납부 완료 → 지출 기록, 이번 회차 알림 사라짐, 금액 수정 가능', async ({ page }) => {
    await H.openApp(page, { date: '2026-11-25' });
    await H.seed(page, { recurring: [item] });
    await page.locator('.due-item [data-pay]').click();
    const dlg = H.modal(page);
    await dlg.locator('input[name=amount]').fill('148,300');
    await dlg.locator('button[type=submit]').click();
    await expect(page.locator('.due-item')).toHaveCount(0);
    const st = await H.getState(page);
    expect(st.expenses).toHaveLength(1);
    expect(st.expenses[0]).toMatchObject({ amount: 148300, place: '관리비', categoryId: 'utility', date: '2026-11-25', recurringPeriod: '2026-11' });
    expect(st.recurring[0].paidPeriods).toContain('2026-11');
    await expect(page.locator('.expense-list')).toContainText('관리비');
  });
});

test.describe('AC-8 31일 납부는 말일로', () => {
  for (const [today, start, expected] of [
    ['2026-11-20', '2026-11-01', '11월 30일'],
    ['2027-02-10', '2027-02-01', '2월 28일'],
    ['2028-02-10', '2028-02-01', '2월 29일'],
    ['2026-12-20', '2026-12-01', '12월 31일'],
  ]) {
    test(`${today} 기준 다음 납부일 ${expected}`, async ({ page }) => {
      await H.openApp(page, { date: today, hash: '#recurring' });
      await H.seed(page, { recurring: [H.rec('적금', 300000, { type: 'monthly', day: 31 }, { categoryId: 'saving', startDate: start })] });
      await expect(page.locator('.rec-next')).toContainText(`납부일 ${expected}`);
    });
  }
});

test.describe('AC-9 백업 내보내기 → 초기화 → 가져오기', () => {
  test('모든 데이터가 그대로 복원', async ({ page }, info) => {
    await H.openApp(page, { hash: '#settings' });
    await H.seed(page, {
      expenses: [H.exp('2026-11-01', 5500, '스타벅스 강남점', 'coffee', { payment: 'debit', memo: '라떼' }), H.exp('2026-10-03', 120000, '관리비', 'utility')],
      placeRules: { '동네 국수집': 'food' },
      budgets: { '2026-11': { total: 1500000, byCategory: { food: 400000 } } },
      recurring: [H.rec('통신비', 55000, { type: 'monthly', day: 10 }, { paidPeriods: ['2026-10'] })],
      settings: { warnPercent: 70, dailyLimit: 50000, theme: 'dark' },
    });
    const dl = page.waitForEvent('download');
    await page.locator('[data-export]').click();
    const download = await dl;
    const file = info.outputPath('backup.json');
    await download.saveAs(file);
    const before = await H.getState(page);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(before);

    await page.locator('[data-reset]').click();
    await H.confirmOk(page);
    await H.confirmOk(page);
    const reset = await H.getState(page);
    expect(reset.expenses).toHaveLength(0);
    expect(reset.recurring).toHaveLength(0);

    await page.locator('#import-file').setInputFiles(file);
    await H.confirmOk(page);
    await expect(page.locator('#toast-region')).toContainText('백업을 가져왔어요');
    expect(await H.getState(page)).toEqual(before);
    await page.reload();
    expect(await H.getState(page)).toEqual(before);
  });
});
