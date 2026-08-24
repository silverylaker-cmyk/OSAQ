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

  /* Apps Script 웹앱 호출.
   * Content-Type을 text/plain으로 보내면 브라우저가 사전 요청(preflight)을 생략하므로
   * 별도 서버 설정 없이 태블릿에서 바로 저장할 수 있다. */
  async function postToSheet(record) {
    const { gasUrl } = getConfig();
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(toSheetPayload(record)),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`구글 시트 응답 ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '구글 시트가 저장을 거부했습니다');
    return data;
  }

  async function postToServer(record) {
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
    const { gasUrl, token } = getConfig();
    try {
      const url = gasUrl
        ? `${gasUrl}${gasUrl.includes('?') ? '&' : '?'}action=list&token=${encodeURIComponent(token)}`
        : 'api/responses';
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
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
    const url = `${target.gasUrl}${target.gasUrl.includes('?') ? '&' : '?'}action=ping&token=${encodeURIComponent(
      target.token || ''
    )}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`구글 시트 응답 ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '연결에 실패했습니다');
    return { where: 'sheet', count: data.count, sheetName: data.sheetName, sheetUrl: data.sheetUrl };
  }

  // 앱이 열릴 때, 그리고 인터넷이 다시 연결될 때 대기열을 자동으로 비운다.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flush());
    setTimeout(() => {
      if (pendingCount()) flush();
    }, 1500);
  }

  global.Storage = { getConfig, setConfig, useSheet, save, flush, list, test, pendingCount, sheetColumns, localTime, newClientId };
})(typeof window !== 'undefined' ? window : globalThis);
