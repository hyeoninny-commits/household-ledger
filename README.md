# 가계부

브라우저에서 바로 쓰는 개인 가계부입니다. 설치나 로그인이 필요 없습니다.

**바로 쓰기:** https://hyeoninny-commits.github.io/household-ledger/
(휴대폰에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있습니다)

## 기능
- 지출 기록: 카테고리 자동 분류·학습, 결제수단 6종, 신용카드 할부(결제한 달부터 회차별 기록)
- 통계: 일·주·월 합계, 카테고리 도넛, 추이 막대, 직전 기간 대비
- 예산: 월·카테고리 예산, 주의(80%)·초과 경고, 하루 권장 지출, 예산 추천(지난 지출 기반·비율로 나누기)
- 정기 납부: 공과금·적금 D-day 알림, 납부 완료 시 지출 기록
- 주식: 보유 종목 현재가, 전일·지난달 말 대비, 평가손익 (국내 네이버·해외 Twelve Data)
- 데이터: 이 브라우저에만 저장(localStorage), JSON 백업·복원, 라이트·다크 모드

## 데이터는 어디에 저장되나요?
기록은 **각자의 브라우저 안에만** 저장되고 이 저장소나 서버로 올라오지 않습니다.
PC와 휴대폰은 따로 저장되므로, 옮길 때는 설정의 백업 내보내기·가져오기를 쓰세요.

## 주식 시세 받기
- **시세는 [지금 갱신]을 누를 때만 받습니다** (기본값). 설정에서 1·5·10분 자동 갱신을 켤 수도 있습니다.
- **국내 주식**: 설정할 것이 없습니다. GitHub Actions가 평일 장중(9:00~16:50) 10분마다 네이버 증권 시세를 받아 두고 가계부가 읽습니다. 화면에 "OO:OO 기준"으로 몇 시 가격인지 표시합니다.
  - 실시간이 필요하면 PC에서 `tests` 폴더의 `node serve.js`로 열거나(같은 Wi-Fi 휴대폰도 가능), [relay/README.md](relay/README.md)대로 실시간 중계 서버를 둘 수 있습니다.
- **해외 주식**: [twelvedata.com](https://twelvedata.com)에서 무료 API 키(Basic)를 받아 기기마다 설정에 넣으세요.
- 시세를 못 받으면 마지막으로 받은 가격이나 종목에 직접 입력한 가격으로 계산합니다.

## 비용
모두 무료입니다. GitHub Pages·Actions(공개 저장소), Twelve Data Basic(카드 등록 없음).

## 폴더
| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 앱 (이것만 있으면 동작) |
| `.github/workflows/naver-quotes.yml` | 국내 시세 자동 갱신 (GitHub Actions → `data` 브랜치 `naver-quotes.json`) |
| `relay/` | 국내 시세 도구: 자동 갱신 스크립트(`update-quotes.mjs`), 실시간 중계 서버(`worker.js`, Cloudflare Workers·PC 공용) |
| `tests/` | Playwright 테스트 230개(데스크톱 + 모바일 5종), PC용 서버(`serve.js`) |
| `PRD.md` | 요구사항 문서 v1.2 (배포·운영, 구현 현황 포함) |
| `REVIEW.md` | 검토 보고서 (버그 수정·모바일·추가 기능·배포 확인 기록) |
| `PROMPTS.md` | 단계별 개발 프롬프트 |

## 개발
```bash
cd tests
npm install
npx playwright install webkit   # 처음 한 번 (아이폰 Safari 엔진)
npx playwright test             # 전체 테스트
node serve.js                   # PC에서 열기 + 국내 실시간 시세 중계
```
앱을 고친 뒤에는 `index.html`의 `?v=` 버전을 올려 push하면 1~2분 뒤 배포 주소에 반영됩니다.
