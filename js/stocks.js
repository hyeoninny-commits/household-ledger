/* 주식: 시세 받기, 평가금액·변동 계산
 * 시세 출처 (PRD 6.1)
 *  - 국내(코스피·코스닥): 네이버 증권. 브라우저가 직접 부를 수 없어서(CORS) 시세 중계 서버를 거친다.
 *      ① 설정에 넣은 중계 서버 주소 (예: Cloudflare Workers, relay/worker.js)
 *      ② 주소가 비어 있고 PC 서버(tests/serve.js)로 열었으면 같은 주소의 /api/quote
 *  - 해외(미국): Twelve Data. 설정에 무료 API 키를 넣으면 브라우저가 직접 받는다. (환율 USD/KRW 포함)
 *  - 못 받으면 마지막으로 받은 가격이나 직접 입력한 현재가로 계산한다.
 * 외부로는 종목 코드만 보낸다. 보유 수량·금액 같은 가계부 데이터는 보내지 않는다. */
(function (L) {
  'use strict';

  var U = L.utils;
  var MARKET_NAME = { KS: '코스피', KQ: '코스닥', US: '미국' };
  var SOURCE_NAME = { naver: '네이버', 'naver-github': '네이버(10분 간격)', twelvedata: 'Twelve Data', manual: '직접 입력' };
  var sameOriginRelay = null; // PC 서버의 /api/quote 사용 가능 여부 (null: 아직 모름)

  function key(st) { return st.market + ':' + st.code; }
  function currencyOf(st) { return st.market === 'US' ? 'USD' : 'KRW'; }
  function isDomestic(st) { return st.market !== 'US'; }

  /** 가격 표시: 원화는 정수, 달러는 소수 2자리 */
  function formatPrice(n, currency) {
    if (n == null || !isFinite(n)) return '-';
    if (currency === 'USD') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  /** 등락 표시용 { dir:'up'|'down'|'flat', text:'▲ 1,200원 (+0.55%)' } — 한국 관례대로 상승 빨강, 하락 파랑 */
  function change(now, before, currency) {
    if (now == null || before == null || !before) return null;
    var diff = now - before;
    var pct = diff / before * 100;
    var dir = Math.abs(pct) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down';
    var sign = dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : '';
    var amt = currency === 'USD'
      ? '$' + Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Math.round(Math.abs(diff)).toLocaleString('ko-KR') + '원';
    return { dir: dir, diff: diff, pct: pct, text: (dir === 'flat' ? '변동 없음 ' : sign + amt + ' ') + '(' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)' };
  }

  /** 종목 하나의 계산 결과 */
  function valuate(st, state) {
    var q = state.market.quotes[key(st)] || null;
    var currency = currencyOf(st);
    var price = q ? q.price : st.manualPrice;
    var source = q ? q.source : st.manualPrice ? 'manual' : null;
    var value = price != null ? price * st.quantity : null;
    var cost = st.avgPrice != null ? st.avgPrice * st.quantity : null;
    return {
      stock: st,
      quote: q,
      name: st.name || (q && q.name) || st.code,
      currency: currency,
      price: price,
      source: source,
      value: value,
      cost: cost,
      profit: value != null && cost != null ? change(value, cost, currency) : null,
      day: q ? change(q.price, q.prevClose, currency) : null,
      month: q ? change(q.price, q.prevMonthClose, currency) : null,
      dayDiffValue: q && q.prevClose ? (q.price - q.prevClose) * st.quantity : null,
      monthDiffValue: q && q.prevMonthClose ? (q.price - q.prevMonthClose) * st.quantity : null
    };
  }

  /** 전체 합계 (원화 기준. 미국 주식은 환율로 바꾸고, 환율이 없으면 따로 표시) */
  function summary(state) {
    var rate = state.market.usdkrw ? state.market.usdkrw.rate : null;
    var rows = state.stocks.map(function (st) { return valuate(st, state); });
    var t = { value: 0, cost: 0, day: 0, dayBase: 0, month: 0, monthBase: 0, missingPrice: 0, missingFx: 0, hasCost: false };
    rows.forEach(function (r) {
      var k = r.currency === 'USD' ? rate : 1;
      if (r.value == null) { t.missingPrice++; return; }
      if (!k) { t.missingFx++; return; }
      t.value += r.value * k;
      if (r.cost != null) { t.cost += r.cost * k; t.hasCost = true; }
      if (r.dayDiffValue != null) { t.day += r.dayDiffValue * k; t.dayBase += (r.value - r.dayDiffValue) * k; }
      if (r.monthDiffValue != null) { t.month += r.monthDiffValue * k; t.monthBase += (r.value - r.monthDiffValue) * k; }
    });
    return {
      rows: rows,
      rate: rate,
      total: t,
      profit: t.hasCost ? change(t.value, t.cost, 'KRW') : null,
      day: t.dayBase ? change(t.dayBase + t.day, t.dayBase, 'KRW') : null,
      month: t.monthBase ? change(t.monthBase + t.month, t.monthBase, 'KRW') : null
    };
  }

  /* ---------- 일별 종가로 전일·지난달 말 종가 계산 ----------
   * bars: [{ date:'YYYY-MM-DD', close }] 오래된 순. 마지막 막대가 오늘(또는 가장 최근 거래일).
   * prevClose: 마지막 막대 바로 전 거래일 종가
   * prevMonthClose: 마지막 막대가 속한 달보다 앞선 달의 마지막 거래일 종가 */
  function closesFromBars(bars) {
    var list = bars.filter(function (b) { return b && b.close != null && isFinite(b.close); });
    if (!list.length) return null;
    var last = list[list.length - 1];
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var mk = last.date.slice(0, 7);
    var monthPrev = null;
    for (var i = list.length - 1; i >= 0; i--) { if (list[i].date.slice(0, 7) < mk) { monthPrev = list[i]; break; } }
    return { price: last.close, prevClose: prev ? prev.close : null, prevMonthClose: monthPrev ? monthPrev.close : null, date: last.date };
  }

  /* ---------- 시세 받기 ---------- */

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('시간 초과')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function isGithubPages() { return /\.github\.io$/i.test(window.location.hostname); }

  /** 실시간 중계 서버 주소 (설정 주소 → PC 서버 같은 주소). 없으면 null */
  function relayBase(state) {
    var url = (state.settings.stockRelayUrl || '').trim();
    if (url) return url.replace(/\/+$/, '') + '/api/quote';
    if (/^https?:$/.test(window.location.protocol) && !isGithubPages() && sameOriginRelay !== false) return 'api/quote';
    return null;
  }

  /* ---------- GitHub 자동 갱신 파일 (중계 서버가 없을 때) ----------
   * GitHub Actions(.github/workflows/naver-quotes.yml)가 평일 장중 10분마다 네이버 전 종목 시세를
   * data 브랜치의 naver-quotes.json 으로 올린다. raw.githubusercontent.com 은 CORS를 허용해 어디서든 읽을 수 있다. */
  var DEFAULT_DATA_URL = 'https://raw.githubusercontent.com/hyeoninny-commits/household-ledger/data/naver-quotes.json';
  var dataCache = null; // { at, url, data } — 파일이 크므로(약 200KB) 3분 안에는 다시 받지 않는다
  var DATA_CACHE_MS = 3 * 60 * 1000;

  function githubDataUrl() {
    if (isGithubPages()) {
      var owner = window.location.hostname.split('.')[0];
      var repo = window.location.pathname.split('/')[1] || owner + '.github.io';
      return 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/data/naver-quotes.json';
    }
    return DEFAULT_DATA_URL;
  }

  function fetchGithubData(stocks) {
    var url = githubDataUrl();
    var cached = dataCache && dataCache.url === url && Date.now() - dataCache.at < DATA_CACHE_MS ? Promise.resolve(dataCache.data) : null;
    var p = cached || withTimeout(fetch(url, { cache: 'no-store' }), 20000).then(function (res) {
      if (res.status === 404) throw new Error('국내 시세 파일이 아직 없어요. GitHub Actions의 "국내 주식 시세 갱신"이 한 번 실행돼야 해요');
      if (!res.ok) throw new Error('국내 시세 파일을 받지 못했어요 (' + res.status + ')');
      return res.json();
    }, function () {
      throw new Error('국내 시세 파일에 연결하지 못했어요');
    }).then(function (data) {
      dataCache = { at: Date.now(), url: url, data: data };
      return data;
    });
    return p.then(function (data) {
      var quotes = {}, errors = {};
      stocks.forEach(function (st) {
        var row = data.q && data.q[st.code];
        if (row && row[0] > 0) {
          quotes[key(st)] = { price: row[0], prevClose: row[1], prevMonthClose: row[2], currency: 'KRW', name: row[3] || '', time: data.updatedAt || null, source: 'naver-github' };
        } else errors[key(st)] = '종목을 찾지 못했어요';
      });
      return { quotes: quotes, errors: errors };
    });
  }

  /** 국내: 실시간 중계 서버가 있으면 그것을, 없으면 GitHub 자동 갱신 파일을 쓴다 */
  function fetchDomestic(stocks, state) {
    if (!relayBase(state)) return fetchGithubData(stocks);
    return fetchRelay(stocks, state).catch(function (e) {
      if (e && e.message === 'no-relay') return fetchGithubData(stocks);
      throw e;
    });
  }

  /** 국내: 네이버 (실시간 중계 서버 경유) */
  function fetchRelay(stocks, state) {
    var base = relayBase(state);
    if (!base) return Promise.reject(new Error('no-relay'));
    var sameOrigin = base === 'api/quote';
    var codes = stocks.map(function (s) { return s.code; });
    return withTimeout(fetch(base + '?codes=' + encodeURIComponent(codes.join(',')), { cache: 'no-store' }), 15000).then(function (res) {
      var isJson = /json/.test(res.headers.get('content-type') || '');
      if (sameOrigin && (res.status === 404 || !isJson)) { sameOriginRelay = false; throw new Error('no-relay'); }
      if (!isJson) throw new Error('중계 서버 주소를 확인해 주세요');
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : '중계 서버 오류 ' + res.status);
        if (sameOrigin) sameOriginRelay = true;
        return data;
      });
    }, function (e) {
      throw new Error(e && e.message === '시간 초과' ? '중계 서버 응답이 없어요' : '중계 서버에 연결하지 못했어요');
    }).then(function (data) {
      var quotes = {}, errors = {};
      stocks.forEach(function (st) {
        var q = data.quotes && data.quotes[st.code];
        if (q && q.price > 0) {
          quotes[key(st)] = { price: q.price, prevClose: q.prevClose, prevMonthClose: q.prevMonthClose, currency: 'KRW', name: q.name || '', time: q.time || null, source: 'naver' };
        } else errors[key(st)] = (q && q.error) || '시세 없음';
      });
      return { quotes: quotes, errors: errors };
    });
  }

  /** 해외: Twelve Data (API 키) — 일봉 45개로 현재가·전일·지난달 말 종가, 그리고 USD/KRW 환율 */
  function fetchOverseas(stocks, apiKey) {
    if (!apiKey) return Promise.reject(new Error('no-key'));
    var symbols = stocks.map(function (s) { return s.code; }).concat(['USD/KRW']);
    var url = 'https://api.twelvedata.com/time_series?interval=1day&outputsize=45&symbol=' + encodeURIComponent(symbols.join(',')) + '&apikey=' + encodeURIComponent(apiKey);
    return withTimeout(fetch(url, { cache: 'no-store' }), 15000).then(function (res) {
      if (!res.ok) throw new Error('Twelve Data 오류 ' + res.status);
      return res.json();
    }).then(function (data) {
      if (data && data.status === 'error') throw new Error(data.code === 401 ? 'API 키를 확인해 주세요' : data.code === 429 ? '무료 한도를 넘었어요. 잠시 후 다시 받아요' : (data.message || 'Twelve Data 오류'));
      function parse(entry) {
        if (!entry || entry.status !== 'ok' || !Array.isArray(entry.values)) return null;
        var bars = entry.values.map(function (v) { return { date: String(v.datetime).slice(0, 10), close: Number(v.close) }; }).reverse();
        return closesFromBars(bars);
      }
      var quotes = {}, errors = {};
      var now = new Date().toISOString();
      stocks.forEach(function (st) {
        var entry = data[st.code];
        var c = parse(entry);
        if (c) quotes[key(st)] = { price: c.price, prevClose: c.prevClose, prevMonthClose: c.prevMonthClose, currency: 'USD', name: '', time: now, source: 'twelvedata' };
        else errors[key(st)] = entry && entry.message ? entry.message : '이 API 키로는 받을 수 없는 종목이에요';
      });
      var fx = parse(data['USD/KRW']);
      return { quotes: quotes, errors: errors, usdkrw: fx ? { rate: fx.price, time: now } : null };
    });
  }

  var MISSING = {
    'no-relay': '국내 주식 시세는 중계 서버가 있어야 받을 수 있어요',
    'no-key': '해외 주식 시세는 설정에 Twelve Data API 키를 넣어야 받을 수 있어요'
  };

  /**
   * 시세를 받는다. stocks를 주면(종목 확인 미리보기) 저장하지 않는다.
   * @returns Promise<{ quotes, errors:{key:msg}, usdkrw, sources:['naver'|'twelvedata'], notices:[msg] }>
   */
  function refresh(state, stocks) {
    var list = stocks || state.stocks;
    var dom = list.filter(isDomestic), ovs = list.filter(function (s) { return !isDomestic(s); });
    var out = { quotes: {}, errors: {}, usdkrw: null, sources: [], notices: [] };
    function collect(part, source, p) {
      return p.then(function (r) {
        Object.assign(out.quotes, r.quotes);
        Object.assign(out.errors, r.errors);
        if (r.usdkrw) out.usdkrw = r.usdkrw;
        if (Object.keys(r.quotes).length || !Object.keys(r.errors).length) out.sources.push(source || r.source);
      }, function (e) {
        var msg = MISSING[e && e.message] || (e && e.message) || '시세를 받지 못했어요';
        out.notices.push(msg);
        part.forEach(function (st) { out.errors[key(st)] = msg; });
      });
    }
    var jobs = [];
    if (dom.length) {
      jobs.push(collect(dom, null, fetchDomestic(dom, state).then(function (r) {
        var any = Object.keys(r.quotes).map(function (k) { return r.quotes[k].source; })[0];
        r.source = any || (relayBase(state) ? 'naver' : 'naver-github');
        return r;
      })));
    }
    if (ovs.length) jobs.push(collect(ovs, 'twelvedata', fetchOverseas(ovs, state.settings.stockApiKey)));
    return Promise.all(jobs).then(function () {
      if (!stocks) L.store.setMarket(out.quotes, out.usdkrw);
      return out;
    });
  }

  /** 지금 설정으로 쓸 수 있는 시세 출처 설명 */
  function sourceInfo(state) {
    return {
      domestic: (state.settings.stockRelayUrl ? '중계 서버' : relayBase(state) ? 'PC 서버' : 'GitHub 자동 갱신(10분 간격)'),
      overseas: state.settings.stockApiKey ? 'Twelve Data' : null
    };
  }

  L.stocks = {
    MARKET_NAME: MARKET_NAME,
    SOURCE_NAME: SOURCE_NAME,
    key: key,
    currencyOf: currencyOf,
    isDomestic: isDomestic,
    formatPrice: formatPrice,
    change: change,
    valuate: valuate,
    summary: summary,
    closesFromBars: closesFromBars,
    refresh: refresh,
    sourceInfo: sourceInfo,
    githubDataUrl: githubDataUrl,
    _reset: function () { sameOriginRelay = null; dataCache = null; } // 테스트용
  };
})(window.Ledger = window.Ledger || {});
