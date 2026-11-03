// 비기능 요구사항: 360px 화면, 콘솔 오류, 키보드, 다크 모드, 포커스, 1만 건 성능, 오프라인
const { test, expect } = require('@playwright/test');
const H = require('../helpers');

const ROUTES = ['home', 'list', 'stats', 'budget', 'recurring', 'settings'];

const sample = () => ({
  expenses: [
    H.exp('2026-11-04', 4500, '스타벅스 강남역 리저브 매장 2층 창가 자리', 'coffee', { payment: 'kakaopay', memo: '아주 긴 메모가 들어가도 줄바꿈이 잘 되는지 확인하기 위한 문장입니다' }),
    H.exp('2026-11-03', 120000, '올리브영', 'beauty'),
    H.exp('2026-11-02', 85000, '식당', 'food', { payment: 'credit' }),
    H.exp('2026-10-30', 1234567890, '아주 비싼 물건', 'shopping'),
  ],
  budgets: { '2026-11': { total: 300000, byCategory: { food: 100000, beauty: 100000 } } },
  recurring: [H.rec('관리비', 150000, { type: 'monthly', day: 5 }, { startDate: '2026-10-01' }), H.rec('적금', 300000, { type: 'monthly', day: 1 }, { startDate: '2026-11-01', categoryId: 'saving' })],
  placeRules: { '동네 국수집': 'food' },
});

/** 각 화면에서 열 수 있는 모달 열기 */
async function openModals(page, route) {
  const openers = {
    home: ['#fab-add', '.due-item [data-pay]', '[data-expense-id]'],
    list: ['[data-expense-id]'],
    budget: [],
    recurring: ['.view-head [data-add]', '[data-pay]', '[data-edit]', '[data-del]'],
    settings: ['[data-cat-add]', '[data-cat-edit="food"]', '[data-reset]'],
    stats: [],
  }[route];
  const results = [];
  for (const sel of openers) {
    await page.locator(sel).first().click();
    await expect(page.locator('dialog[open]').first()).toBeVisible();
    results.push([sel, await H.overflowX(page)]);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
  return results;
}

test.describe('360px 모바일', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('모든 탭·모달에서 가로 스크롤 없음, 탭바로 이동 가능', async ({ page }) => {
    await H.openApp(page);
    await H.seed(page, sample());
    const report = [];
    for (const r of ROUTES) {
      await H.go(page, r);
      report.push([r, 'view', await H.overflowX(page)]);
      if (r === 'list') {
        await page.locator('.filter-more summary').click();
        report.push([r, 'filters-open', await H.overflowX(page)]);
      }
      for (const [sel, ov] of await openModals(page, r)) report.push([r, sel, ov]);
      await H.shot(page, `mobile-360-${r}.png`);
    }
    const bad = report.filter((x) => x[2] > 0);
    expect(bad, JSON.stringify(report)).toEqual([]);
  });

  test('모바일에서 지출 추가 버튼이 탭바에 가려지지 않고, 저장 버튼이 화면 안에 있다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); // 등장 애니메이션 도중 위치를 재지 않도록
    await H.openApp(page);
    const fab = await page.locator('#fab-add').boundingBox();
    const nav = await page.locator('nav.nav').boundingBox();
    expect(fab.y + fab.height).toBeLessThanOrEqual(nav.y);
    await page.locator('#fab-add').click();
    const save = H.modal(page).locator('button[type=submit]');
    await expect(save).toBeInViewport();
  });
});

test('모든 화면·모달에서 콘솔 오류·경고 없음', async ({ page }) => {
  const errors = H.collectErrors(page);
  await H.openApp(page);
  await H.seed(page, sample());
  for (const r of ROUTES) {
    await H.go(page, r);
    await openModals(page, r);
  }
  await H.go(page, 'stats');
  for (const t of ['day', 'week', 'month']) await page.locator(`[data-type=${t}]`).click();
  // 도넛 가운데 구멍이 아니라 고리 위(위쪽 가운데)를 가리킨다
  const box = await page.locator('svg.donut').boundingBox();
  await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height * 0.1);
  await expect(page.locator('#chart-tip')).toBeVisible();
  expect(errors).toEqual([]);
});

test('외부 글꼴(CDN)을 못 불러와도 기록·조회 동작', async ({ page }) => {
  await page.route(/jsdelivr|cdn/, (r) => r.abort());
  await H.openApp(page);
  await H.addExpenseUI(page, { amount: '3000', place: '편의점' });
  await expect(page.locator('.expense-list')).toContainText('편의점');
  await H.go(page, 'stats');
  await expect(page.locator('#stats-total')).toHaveText('3,000원');
});

test('키보드만으로 지출 추가, 저장 후 포커스가 추가 버튼으로 돌아옴', async ({ page }) => {
  await H.openApp(page);
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.evaluate(() => document.activeElement && document.activeElement.id === 'fab-add');
  }
  expect(found, 'Tab으로 지출 추가 버튼에 도달').toBe(true);
  await page.keyboard.press('Enter');
  await expect(H.modal(page).locator('input[name=amount]')).toBeFocused();
  await page.keyboard.type('8000');
  await page.keyboard.press('Tab');
  await page.keyboard.type('김밥천국');
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect((await H.getState(page)).expenses[0]).toMatchObject({ amount: 8000, categoryId: 'food' });
  await expect(page.locator('#fab-add')).toBeFocused();
});

test('키보드로 카테고리 칩을 바꿀 수 있다', async ({ page }) => {
  await H.openApp(page);
  const dlg = await H.openExpenseForm(page);
  await dlg.locator('input[name=amount]').fill('8000');
  await dlg.locator('input[name=place]').fill('어느 가게');
  await dlg.locator('.chip[data-cat="food"]').focus();
  await page.keyboard.press('Space');
  await expect(dlg.locator('.chip[data-cat="food"]')).toHaveAttribute('aria-checked', 'true');
});

test.describe('[B5] 화면을 다시 그린 뒤 키보드 포커스 유지', () => {
  const cases = [
    ['stats', '[data-type=week]', '통계 기간 단위 탭'],
    ['stats', '[data-shift="-1"]', '통계 이전 기간 버튼'],
    ['list', '[data-preset=lastMonth]', '내역 기간 버튼'],
    ['budget', '[data-shift="1"]', '예산 다음 달 버튼'],
    ['settings', '[data-theme-opt=dark]', '설정 화면 모드 버튼'],
  ];
  for (const [route, sel, label] of cases) {
    test(`${label}을 Enter로 누르면 포커스가 같은 버튼에 남는다`, async ({ page }) => {
      await H.openApp(page, { hash: '#' + route });
      await page.locator(sel).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(sel)).toBeFocused();
      // 한 번 더 눌러도 계속 동작 (Tab을 다시 누를 필요 없음)
      await page.keyboard.press('Enter');
      await expect(page.locator(sel)).toBeFocused();
    });
  }

  test('누른 버튼이 사라지면(오늘로) 포커스는 본문 영역으로', async ({ page }) => {
    await H.openApp(page, { hash: '#stats' });
    await page.locator('[data-shift="-1"]').click();
    await page.locator('[data-today]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-today]')).toHaveCount(0);
    await expect(page.locator('#view')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('view').contains(document.activeElement))).toBe(true);
  });

  test('내역 카테고리 선택을 키보드로 바꿔도 같은 선택 상자에 포커스', async ({ page }) => {
    await H.openApp(page, { hash: '#list' });
    await page.locator('select[name=categoryId]').focus();
    await page.locator('select[name=categoryId]').selectOption('food');
    await expect(page.locator('select[name=categoryId]')).toBeFocused();
    await expect(page.locator('select[name=categoryId]')).toHaveValue('food');
  });

  test('경고 기준 저장 후에도 저장 버튼에 포커스', async ({ page }) => {
    await H.openApp(page, { hash: '#settings' });
    await page.locator('input[name=warnPercent]').fill('70');
    await page.locator('input[name=warnPercent]').press('Enter');
    await expect(page.locator('input[name=warnPercent]')).toBeFocused();
    expect((await H.getState(page)).settings.warnPercent).toBe(70);
  });
});

/** 보이는 글자의 대비를 모두 계산해 기준 미달 목록을 돌려준다 */
async function lowContrast(page) {
  return page.evaluate(() => {
    function parse(c) {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    function blend(top, bottom) {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
    }
    function bgOf(el) {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let base = parse(getComputedStyle(document.body).backgroundColor);
      if (base[3] === 0) base = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
      return base;
    }
    function lum(c) {
      const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const el = t.parentElement;
      if (!t.textContent.trim() || !el || seen.has(el)) continue;
      seen.add(el);
      if (el.closest('svg') || el.closest('.visually-hidden') || el.closest('[hidden]') || el.closest('#chart-tip') || el.closest('.skip-link')) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const bg = bgOf(el);
      const fg = blend(parse(cs.color), bg);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) out.push(`${el.tagName.toLowerCase()}.${el.className} "${t.textContent.trim().slice(0, 20)}" ${ratio.toFixed(2)}:1`);
    }
    return out;
  });
}

for (const scheme of ['light', 'dark']) {
  test(`${scheme} 모드 모든 화면 글자 대비 4.5:1 이상`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await H.openApp(page);
    await H.seed(page, sample());
    const bad = [];
    for (const r of ROUTES) {
      await H.go(page, r);
      await page.waitForTimeout(50);
      (await lowContrast(page)).forEach((x) => bad.push(`${r}: ${x}`));
      if (scheme === 'dark') await H.shot(page, `dark-${r}.png`);
    }
    await H.go(page, 'home');
    await page.locator('#fab-add').click();
    await page.locator('dialog[open] input[name=place]').fill('스타벅스');
    (await lowContrast(page)).forEach((x) => bad.push(`modal: ${x}`));
    expect([...new Set(bad)]).toEqual([]);
  });
}

test.describe('지출 1만 건', () => {
  test('화면 전환과 저장이 1초 이내 @perf', async ({ page }) => {
    test.setTimeout(120_000);
    await H.openApp(page);
    const size = await page.evaluate((KEY) => {
      const d = window.Ledger.storage.createDefault();
      const cats = d.categories.map((c) => c.id);
      const places = ['스타벅스', '김밥천국', '올리브영', '헬스장', '배민', 'GS25', '택시', '쿠팡', 'CGV', '약국'];
      const start = Date.UTC(2025, 0, 1);
      for (let i = 0; i < 10000; i++) {
        const day = new Date(start + (i % 670) * 86400000).toISOString().slice(0, 10);
        d.expenses.push({ id: 'p' + i, date: day, amount: 1000 + (i * 37) % 90000, place: places[i % 10] + ' ' + (i % 50), categoryId: cats[i % cats.length], memo: i % 7 ? '' : '메모 ' + i, payment: null, recurringId: null, recurringPeriod: null, createdAt: day + 'T09:00:00+09:00' });
      }
      d.budgets['2026-11'] = { total: 3000000, byCategory: { food: 500000 } };
      const s = JSON.stringify(d);
      localStorage.setItem(KEY, s);
      return s.length;
    }, H.KEY);
    await page.reload();
    await expect(page.locator('.expense-list')).toBeVisible();

    const timings = {};
    for (const r of [...ROUTES.slice(1), 'home']) {
      const t0 = Date.now();
      await page.locator(`a.tab[data-route="${r}"]`).click();
      await expect(page.locator('#view')).toHaveAttribute('data-route', r);
      await expect(page.locator('#view .view-root')).not.toBeEmpty();
      timings[r] = Date.now() - t0;
    }
    await H.go(page, 'stats');
    for (const t of ['day', 'week']) {
      const t0 = Date.now();
      await page.locator(`[data-type=${t}]`).click();
      await expect(page.locator(`[data-type=${t}]`)).toHaveAttribute('aria-selected', 'true');
      timings['stats-' + t] = Date.now() - t0;
    }
    await H.go(page, 'list');
    let t0 = Date.now();
    await page.locator('[data-preset=all]').click();
    await expect(page.locator('#list-more')).toBeVisible();
    timings['list-all'] = Date.now() - t0;

    await H.go(page, 'home');
    const dlg = await H.openExpenseForm(page);
    await dlg.locator('input[name=amount]').fill('5000');
    await dlg.locator('input[name=place]').fill('김밥천국');
    t0 = Date.now();
    await dlg.locator('button[type=submit]').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    timings.save = Date.now() - t0;

    test.info().annotations.push({ type: 'timings(ms)', description: JSON.stringify(timings) }, { type: 'storage', description: `${(size / 1024 / 1024).toFixed(2)}MB` });
    console.log('TIMINGS', JSON.stringify(timings), 'SIZE', (size / 1024 / 1024).toFixed(2) + 'MB');
    Object.entries(timings).forEach(([k, v]) => expect(v, k).toBeLessThan(1000));
  });
});

test('탭 이동 후 뒤로 가기·앞으로 가기, 새로고침하면 보던 화면 유지', async ({ page }) => {
  await H.openApp(page);
  await H.go(page, 'list');
  await H.go(page, 'stats');
  await page.goBack();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'list');
  await expect(page.locator('a.tab[data-route=list]')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'home');
  await page.goForward();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'list');
  await page.reload();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'list');
  // 같은 탭을 다시 눌러도 기록이 쌓이지 않음
  const len = await page.evaluate(() => history.length);
  await H.go(page, 'list');
  expect(await page.evaluate(() => history.length)).toBe(len);
});
