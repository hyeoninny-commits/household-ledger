# 국내 주식 시세 (네이버 증권)

> **기본은 설정이 필요 없습니다.** GitHub Actions가 평일 장중 10분마다 코스피·코스닥 전 종목 시세를
> 이 저장소의 `data` 브랜치(`naver-quotes.json`)에 올리고, 가계부가 그 파일을 읽습니다.
> (`.github/workflows/naver-quotes.yml`, `update-quotes.mjs`)
>
> 아래 **실시간 중계 서버**는 10분 간격보다 빠른 시세가 필요할 때만 쓰는 선택 사항입니다.

## 실시간 중계 서버 (선택)

가계부의 **국내 주식(코스피·코스닥) 실시간 시세**를 받기 위한 작은 서버입니다.
브라우저는 네이버 증권 시세를 직접 받을 수 없어서(CORS 차단), 이 서버가 종목 코드를 받아 대신 시세를 가져옵니다.

- 받는 정보: **종목 코드만** (예: `005930`). 가계부 데이터·보유 수량은 오지 않습니다.
- 돌려주는 정보: 현재가, 전 거래일 종가, 지난달 마지막 거래일 종가, 한글 종목명
- 같은 종목은 20초 동안 다시 받지 않습니다(네이버 과다 호출 방지).
- 해외 주식은 이 서버를 쓰지 않고, 앱 설정의 **Twelve Data API 키**로 받습니다.

> 네이버 증권 시세는 공식 공개 API가 아니어서 주소·형식이 예고 없이 바뀔 수 있습니다. 개인 용도로만 사용하세요.
> 바뀌면 이 파일(`worker.js`)의 `REALTIME_URL`, `DAILY_URL` 부분만 고치면 됩니다.

## 어떤 방법을 쓰나요?

| 앱을 여는 방법 | 할 일 |
|---|---|
| PC에서 `node serve.js`로 열기 (같은 Wi-Fi 휴대폰 포함) | 아무것도 안 해도 됩니다. `serve.js`가 이 코드를 그대로 씁니다. 설정의 중계 서버 주소는 **비워 두세요.** |
| GitHub Pages 등에 올려서 열기 | 아래처럼 **Cloudflare Workers**(무료)에 올리고, 앱 설정에 주소를 넣으세요. |
| `index.html`을 더블클릭해서 열기 | Cloudflare Workers 주소를 설정에 넣으면 됩니다. |

## Cloudflare Workers에 올리기 (무료, 약 5분)

1. https://dash.cloudflare.com 에 가입·로그인합니다.
2. 왼쪽 메뉴 **Workers & Pages → Create → Create Worker** (Hello World로 시작)
   - 이름 예: `ledger-relay` → **Deploy**
3. **Edit code**를 누르고, 편집기에 있는 코드를 **모두 지운 뒤** 이 폴더의 `worker.js` 내용을 통째로 붙여 넣고 **Deploy**
4. 주소가 생깁니다: `https://ledger-relay.<내 서브도메인>.workers.dev`
   - 브라우저에서 `https://ledger-relay.<내 서브도메인>.workers.dev/api/quote?codes=005930` 을 열어
     `"name":"삼성전자"`, `"price":…` 가 보이면 성공입니다.
5. 가계부 **설정 → 주식 시세 → 국내 시세 중계 서버 주소**에 4번 주소(`/api/quote` 없이)를 넣고 저장합니다.

무료 요금제는 하루 10만 번 요청까지 됩니다. 1분마다 갱신해도 하루 1,440번이라 충분합니다.

## 요청 형식

```
GET /api/quote?codes=005930,247540
```

```json
{
  "source": "naver",
  "time": "2026-11-03T04:22:44.225Z",
  "quotes": {
    "005930": { "price": 218500, "prevClose": 229000, "prevMonthClose": 220500, "currency": "KRW", "name": "삼성전자", "market": "KS", "time": "…" },
    "999999": { "error": "종목을 찾지 못했어요" }
  }
}
```

- 6자리 종목 코드만 받고(최대 30개), 다른 형식은 400으로 거절합니다.
- 모든 응답에 `Access-Control-Allow-Origin: *` 를 붙여 어디서 연 가계부든 쓸 수 있습니다.
