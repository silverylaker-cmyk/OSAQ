/* 설문 결과 저장소 — 구글 시트 / 로컬 서버 / 태블릿 보관을 한 곳에서 처리한다.
 *
 * 저장 우선순위
 *   1) 구글 시트(Apps Script 웹앱)가 설정되어 있으면 그곳에 저장 — PC를 켜 둘 필요가 없다.
 *   2) 설정이 없으면 같은 주소의 로컬 서버(server.js)에 저장.
 *   3) 둘 다 실패하면 태블릿에 대기열로 보관했다가, 연결되면 자동으로 다시 보낸다.
 */
(function (global) {
  'use strict';

  const CONFIG_KEY = 'osaq.config.v1';
  const QUEUE_KEY = 'osaq.queue.v1';
  const SAVED_KEY = 'osaq.records.v1'; // 전송 완료본 사본(참고용)

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  };

  function getConfig() {
    const c = read(CONFIG_KEY, {});
    return { gasUrl: c.gasUrl || '', token: c.token || '' };
  }

  function setConfig(next) {
    write(CONFIG_KEY, { gasUrl: (next.gasUrl || '').trim(), token: (next.token || '').trim() });
  }

  const useSheet = () => Boolean(getConfig().gasUrl);

  /* 재전송 시 같은 결과가 두 번 쌓이지 않도록 부여하는 고유 번호 */
  function newClientId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /* 시트의 열 순서 = 설문 문항 순서. 결과 화면·CSV와 같은 정의를 쓴다. */
  function sheetColumns() {
    const { SECTIONS, formatAnswer } = global.SURVEY;
    const fields = SECTIONS.flatMap((s) => s.fields).filter((f) => f.id !== 'patientNo');
    return [
      { k: '작성일시', get: (r) => localTime(r.submittedAt) },
      { k: '환자번호', get: (r) => r.patientNo },
      { k: 'BMI', get: (r) => r.bmi },
      { k: 'BMI 분류', get: (r) => r.bmiCategory },
      { k: '목치수(cm)', get: (r) => r.neckCm },
      { k: 'Epworth 합계', get: (r) => r.essTotal },
    ]
      .concat(fields.map((f) => ({ k: f.short || f.label, get: (r) => formatAnswer(f, r.answers || {}) })))
      .concat([{ k: '참고 소견', get: (r) => (r.findings || []).join(' | ') }]);
  }

  function localTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function toSheetPayload(record) {
    const cols = sheetColumns();
    return {
      token: getConfig().token,
      clientId: record.clientId,
      headers: cols.map((c) => c.k),
      values: cols.map((c) => {
        const v = c.get(record);
        return v === undefined || v === null ? '' : v;
      }),
      record,
    };
  }

  /* ── 전송 수단 ───────────────────────────
   * 브라우저가 구글로 보내는 일반 요청을 막는 환경(파일로 연 페이지, 사내망 정책 등)이 있어
   * 두 가지 우회 경로를 함께 둔다.
   *   · 조회: JSONP  — <script> 태그로 불러오므로 차단되지 않는다.
   *   · 저장: 폼 전송 — 숨긴 iframe으로 보내고, 저장됐는지 JSONP로 확인한다.
   */
  function withParams(base, params) {
    const q = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    return `${base}${base.includes('?') ? '&' : '?'}${q}`;
  }

  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const name = `osaqCb_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
      const script = document.createElement('script');
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        delete global[name];
        script.remove();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('응답 시간이 지났습니다'));
      }, timeoutMs || 20000);
      global[name] = (data) => {
        settled = true;
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('구글에 연결하지 못했습니다'));
      };
      script.src = withParams(url, { callback: name });
      document.head.appendChild(script);
    });
  }

  function formPost(url, payload) {
    return new Promise((resolve) => {
      const name = `osaqFrame_${Date.now().toString(36)}`;
      const frame = document.createElement('iframe');
      frame.name = name;
      frame.style.display = 'none';
      const form = document.createElement('form');
      form.action = url;
      form.method = 'POST';
      form.target = name;
      form.style.display = 'none';
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'payload';
      field.value = JSON.stringify(payload);
      form.appendChild(field);
      document.body.appendChild(frame);
      document.body.appendChild(form);

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setTimeout(() => {
          form.remove();
          frame.remove();
        }, 500);
        resolve();
      };
      // 다른 사이트로 보내므로 응답 내용은 읽을 수 없다. 전송이 끝나면 확인 요청으로 결과를 본다.
      frame.addEventListener('load', finish);
      setTimeout(finish, 8000);
      form.submit();
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 조회 요청 — 일반 요청이 막히면 JSONP로 다시 시도한다 */
  async function gasGet(params, cfg) {
    const target = cfg && cfg.gasUrl ? cfg : getConfig();
    const url = withParams(target.gasUrl, { ...params, token: target.token || '' });
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`구글 시트 응답 ${res.status}`);
      const data = await res.json();
      return { data, via: 'direct' };
    } catch (err) {
      const data = await jsonp(url);
      return { data, via: 'jsonp' };
    }
  }

  /* Apps Script 웹앱 호출.
   * Content-Type을 text/plain으로 보내면 브라우저가 사전 요청(preflight)을 생략하므로
   * 별도 서버 설정 없이 태블릿에서 바로 저장할 수 있다. */
  async function postToSheet(record) {
    // 인터넷이 끊긴 상태라면 기다리지 않고 바로 대기열로 보낸다.
    if (navigator.onLine === false) throw new Error('인터넷에 연결되어 있지 않습니다');
    const { gasUrl } = getConfig();
    const payload = toSheetPayload(record);
    try {
      const res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`구글 시트 응답 ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '구글 시트가 저장을 거부했습니다');
      return data;
    } catch (err) {
      // 일반 요청이 막힌 환경 — 폼으로 보낸 뒤 시트에 들어갔는지 확인한다.
      await formPost(gasUrl, payload);
      for (let i = 0; i < 3; i++) {
        await wait(1200);
        try {
          const { data } = await gasGet({ action: 'check', clientId: record.clientId });
          if (data && data.ok && data.found) return { ok: true, row: data.row, via: 'form' };
          if (data && data.error) throw new Error(data.error);
        } catch (checkErr) {
          if (i === 2) throw checkErr;
        }
      }
      throw err;
    }
  }

  async function postToServer(record) {
    if (navigator.onLine === false) throw new Error('인터넷에 연결되어 있지 않습니다');
    const res = await fetch('api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    return res.json();
  }

  function queue(record) {
    const list = read(QUEUE_KEY, []);
    if (!list.some((r) => r.clientId === record.clientId)) list.push(record);
    write(QUEUE_KEY, list);
    return list.length;
  }

  function dequeue(clientId) {
    write(
      QUEUE_KEY,
      read(QUEUE_KEY, []).filter((r) => r.clientId !== clientId)
    );
  }

  function keepCopy(record) {
    const list = read(SAVED_KEY, []);
    if (!list.some((r) => r.clientId === record.clientId)) list.push(record);
    write(SAVED_KEY, list.slice(-500)); // 태블릿에는 최근 500건까지만 사본을 남긴다.
  }

  const pendingCount = () => read(QUEUE_KEY, []).length;

  /* 결과 1건 저장 */
  async function save(recordInput) {
    const record = { ...recordInput, clientId: recordInput.clientId || newClientId() };
    try {
      const data = useSheet() ? await postToSheet(record) : await postToServer(record);
      keepCopy(record);
      dequeue(record.clientId);
      return {
        ok: true,
        where: useSheet() ? 'sheet' : 'server',
        id: data.id || data.row || '',
        record,
      };
    } catch (err) {
      const pending = queue(record);
      return { ok: false, where: 'queued', pending, error: err.message, record };
    }
  }

  /* 대기열에 남은 결과를 다시 보낸다 */
  async function flush() {
    const list = read(QUEUE_KEY, []);
    let sent = 0;
    for (const record of list) {
      try {
        if (useSheet()) await postToSheet(record);
        else await postToServer(record);
        keepCopy(record);
        dequeue(record.clientId);
        sent += 1;
      } catch (_) {
        break; // 아직 연결되지 않았으므로 나머지는 다음 기회에.
      }
    }
    return { sent, pending: pendingCount() };
  }

  /* 저장된 결과 목록 */
  async function list() {
    const queued = read(QUEUE_KEY, []).map((r) => ({ ...r, _pending: true }));
    const { gasUrl } = getConfig();
    try {
      let data;
      if (gasUrl) {
        data = (await gasGet({ action: 'list' })).data;
      } else {
        const res = await fetch('api/responses', { redirect: 'follow' });
        if (!res.ok) throw new Error(String(res.status));
        data = await res.json();
      }
      if (data.error) throw new Error(data.error);
      const records = data.records || [];
      const keys = new Set(records.map((r) => r.clientId).filter(Boolean));
      return {
        records: records.concat(queued.filter((r) => !keys.has(r.clientId))),
        source: gasUrl ? 'sheet' : 'server',
        remoteCount: records.length,
        pending: queued.length,
      };
    } catch (err) {
      // 연결이 안 되면 이 태블릿에 남은 사본과 대기열이라도 보여 준다.
      const copies = read(SAVED_KEY, []);
      const keys = new Set(queued.map((r) => r.clientId));
      return {
        records: copies.filter((r) => !keys.has(r.clientId)).concat(queued),
        source: 'local',
        remoteCount: 0,
        pending: queued.length,
        error: err.message,
      };
    }
  }

  /* 설정 화면의 연결 테스트 */
  async function test(cfg) {
    const target = cfg && cfg.gasUrl ? cfg : getConfig();
    if (!target.gasUrl) {
      const res = await fetch('api/responses');
      if (!res.ok) throw new Error(`로컬 서버 응답 ${res.status}`);
      const data = await res.json();
      return { where: 'server', count: (data.records || []).length };
    }
    const { data, via } = await gasGet({ action: 'ping' }, target);
    if (!data.ok) throw new Error(data.error || '연결에 실패했습니다');
    return { where: 'sheet', via, count: data.count, sheetName: data.sheetName, sheetUrl: data.sheetUrl };
  }

  /* 어디서 막혔는지 한 단계씩 확인한다 (설정 화면의 '자세히 진단') */
  async function diagnose(cfg) {
    const target = cfg && cfg.gasUrl ? cfg : getConfig();
    const steps = [];
    const add = (name, ok, detail) => steps.push({ name, ok, detail });

    if (location.protocol === 'file:') {
      add('페이지 열기 방식', false, '파일로 직접 연 페이지(file://)는 브라우저가 구글 요청을 막습니다. 서버 주소(http://…)로 접속해 주세요.');
    } else {
      add('페이지 열기 방식', true, `${location.protocol}//${location.host} 에서 실행 중`);
    }

    const url = (target.gasUrl || '').trim();
    if (!url) {
      add('웹 앱 주소', false, '주소가 비어 있습니다. 배포 후 나온 /exec 주소를 입력해 주세요.');
      return steps;
    }
    if (/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      add('웹 앱 주소 형식', true, '올바른 형식입니다');
    } else {
      // 형식이 달라도 연결은 시도해 본다 — 어디까지 되는지 보여 주는 편이 도움이 된다.
      add('웹 앱 주소 형식', false, '보통은 https://script.google.com/macros/s/…/exec 형태입니다. 시트 주소나 /dev(테스트) 주소가 아닌지 확인해 주세요.');
    }

    const pingUrl = withParams(url, { action: 'ping', token: target.token || '' });

    // ① 구글 서버까지 닿기는 하는지 (응답 내용은 읽지 않는 방식이라 차단 정책과 무관하게 확인된다)
    let reachable = false;
    try {
      await fetch(pingUrl, { mode: 'no-cors', redirect: 'follow' });
      reachable = true;
      add('구글 서버 도달', true, '구글까지는 연결됩니다');
    } catch (err) {
      add('구글 서버 도달', false, '구글에 접속하지 못했습니다. 이 태블릿의 인터넷 연결, 또는 병원 네트워크에서 script.google.com 차단 여부를 확인해 주세요.');
    }

    // ② 일반 요청
    let direct = null;
    try {
      const res = await fetch(pingUrl, { redirect: 'follow' });
      direct = await res.json();
      add('일반 연결', true, `구글이 응답했습니다 (HTTP ${res.status})`);
    } catch (err) {
      add('일반 연결', false, `막혔습니다 (${err.message}) — 우회 방식으로 다시 시도합니다`);
    }

    // ③ JSONP 우회
    let viaJsonp = null;
    if (!direct) {
      try {
        viaJsonp = await jsonp(pingUrl, 12000); // 진단은 오래 기다리지 않는다
        add('우회 연결', true, '우회 방식으로 구글에 연결했습니다');
      } catch (err) {
        add('우회 연결', false, err.message);
        // 어디까지 갔는지에 따라 원인을 좁혀 준다.
        if (reachable) {
          add(
            '무엇이 문제인가',
            false,
            '구글까지는 닿았지만 스크립트가 설문 프로그램이 읽을 수 있는 답을 주지 않았습니다. ' +
              '거의 대부분 <b>배포 설정</b> 문제입니다. ① 배포 › 배포 관리 › ✏️ › 버전 <b>새 버전</b> › 배포 로 다시 배포했는지, ' +
              '② 그때 액세스 권한이 <b>모든 사용자</b>인지, ③ 처음 배포할 때 <b>권한 승인(고급 › 이동 › 허용)</b>을 끝냈는지 확인해 주세요. ' +
              '아래 <b>[구글 응답 직접 보기]</b>를 누르면 구글이 실제로 무엇을 돌려주는지 눈으로 확인할 수 있습니다.'
          );
        } else {
          add('무엇이 문제인가', false, '구글 서버에 아예 닿지 못했습니다. 네트워크 문제이거나 주소가 잘못된 경우입니다. 다른 인터넷(휴대폰 핫스팟 등)으로 바꿔서 다시 시도해 보세요.');
        }
        return steps;
      }
    }

    const data = direct || viaJsonp;
    if (data && data.ok) {
      add('암호(토큰)', true, `일치합니다 · 시트 "${data.sheetName}"에 ${data.count}건 저장됨`);
    } else {
      add('암호(토큰)', false, (data && data.error) || '구글이 요청을 거부했습니다');
    }
    return steps;
  }

  // 앱이 열릴 때, 그리고 인터넷이 다시 연결될 때 대기열을 자동으로 비운다.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flush());
    setTimeout(() => {
      if (pendingCount()) flush();
    }, 1500);
  }

  /** 브라우저에서 직접 열어 구글의 실제 응답을 확인할 주소 */
  function pingUrl(cfg) {
    const target = cfg && cfg.gasUrl ? cfg : getConfig();
    return withParams(target.gasUrl, { action: 'ping', token: target.token || '' });
  }

  global.Storage = {
    getConfig, setConfig, useSheet, save, flush, list, test, diagnose, pingUrl,
    pendingCount, sheetColumns, localTime, newClientId,
  };
})(typeof window !== 'undefined' ? window : globalThis);
