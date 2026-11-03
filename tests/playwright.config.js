// 가계부 검토용 Playwright 설정
// 실행: tests 폴더에서 `npm install` 한 번, 그 다음 `npx playwright test`
//  - desktop: 설치된 Chrome으로 index.html을 file:// 주소로 직접 연다 (더블클릭 실행과 같은 조건)
//  - 모바일: 휴대폰 접속과 같은 조건(http://)으로 serve.js 서버를 띄워 기기별로 확인한다.
//    아이폰은 Safari와 같은 엔진(WebKit)을 쓰므로 처음 한 번 `npx playwright install webkit` 이 필요하다.
//  - 성능(@perf): 다른 테스트가 모두 끝난 뒤 하나씩 따로 실행한다. (동시에 돌면 시간이 부풀려짐)
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8765;
const PERF = /@perf/;
const base = {
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  acceptDownloads: true,
};
// 기기 프리셋에서 브라우저 종류만 빼고 화면·터치·UA 설정을 쓴다
const device = (name) => { const d = { ...devices[name] }; delete d.defaultBrowserType; return d; };
const desktopUse = { ...base, channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 } };
const mobileUse = (name, browserName, extra = {}) => ({ ...base, ...extra, browserName, baseURL: `http://127.0.0.1:${PORT}` });
const mobile = (name, browserName, extra = {}) => ({
  name,
  testMatch: /mobile\.spec\.js$/,
  grepInvert: PERF,
  use: mobileUse(name, browserName, extra),
});

const FUNCTIONAL = ['desktop-chrome', 'iPhone 13 (Safari/WebKit)', 'iPhone SE (Safari/WebKit)', 'iPhone 13 가로 (Safari/WebKit)', 'Galaxy S9+ (Chrome)', 'Pixel 7 (Chrome)'];

module.exports = defineConfig({
  testDir: './specs',
  timeout: 60_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  webServer: {
    command: `node serve.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    env: { HOST: '127.0.0.1' },
  },
  projects: [
    {
      name: 'desktop-chrome',
      testIgnore: /mobile\.spec\.js$/,
      grepInvert: PERF,
      use: desktopUse,
    },
    mobile('iPhone 13 (Safari/WebKit)', 'webkit', device('iPhone 13')),
    mobile('iPhone SE (Safari/WebKit)', 'webkit', device('iPhone SE')),
    mobile('iPhone 13 가로 (Safari/WebKit)', 'webkit', device('iPhone 13 landscape')),
    mobile('Galaxy S9+ (Chrome)', 'chromium', { ...device('Galaxy S9+'), channel: 'chrome' }),
    mobile('Pixel 7 (Chrome)', 'chromium', { ...device('Pixel 7'), channel: 'chrome' }),
    // 성능: 위 테스트가 모두 끝난 뒤 하나씩 차례로
    { name: 'perf: desktop', testIgnore: /mobile\.spec\.js$/, grep: PERF, dependencies: FUNCTIONAL, use: desktopUse },
    { name: 'perf: Galaxy S9+', testMatch: /mobile\.spec\.js$/, grep: PERF, dependencies: ['perf: desktop'], use: mobileUse('g', 'chromium', { ...device('Galaxy S9+'), channel: 'chrome' }) },
    { name: 'perf: Pixel 7', testMatch: /mobile\.spec\.js$/, grep: PERF, dependencies: ['perf: Galaxy S9+'], use: mobileUse('p', 'chromium', { ...device('Pixel 7'), channel: 'chrome' }) },
  ],
});
