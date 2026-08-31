#!/usr/bin/env node
/* 수면무호흡 설문지 로컬 서버
 * - 정적 파일(index.html / records.html / assets) 제공
 * - POST /api/responses : 설문 결과 1건 저장 (data/responses.jsonl 에 한 줄씩 추가)
 * - GET  /api/responses : 저장된 결과 목록
 * - GET  /api/responses.csv : 전체 결과 CSV
 * 외부 의존성 없음 — `node server.js` 로 바로 실행됩니다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { SECTIONS, formatAnswer, sheetColumns } = require('./assets/schema.js');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'responses.jsonl');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SENT_FILE = path.join(DATA_DIR, 'sent-to-sheet.json');
const MAX_BODY = 256 * 1024; // 설문 1건은 수 KB. 그 이상은 거부한다.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function readRecords() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return fs
    .readFileSync(DATA_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

/* ── 구글 시트 중계 ───────────────────────────────
 * 태블릿에서 구글에 연결되지 않는 경우, 태블릿은 이 서버에만 저장하고
 * 구글 시트로는 서버가 대신 보낸다. (서버에서는 브라우저 제약이 없다)
 */
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return { gasUrl: '', token: '' };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ gasUrl: cfg.gasUrl || '', token: cfg.token || '' }, null, 2), 'utf8');
}

function readSent() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')));
  } catch (_) {
    return new Set();
  }
}

function markSent(clientId) {
  const sent = readSent();
  sent.add(clientId);
  fs.writeFileSync(SENT_FILE, JSON.stringify([...sent]), 'utf8');
}

function localTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let lastRelayError = '';

async function sendToSheet(record) {
  const { gasUrl, token } = readConfig();
  if (!gasUrl) return { skipped: true };

  const cols = sheetColumns(localTime);
  const payload = {
    token,
    clientId: record.clientId || record.id,
    headers: cols.map((c) => c.k),
    values: cols.map((c) => {
      const v = c.get(record);
      return v === undefined || v === null ? '' : v;
    }),
    record,
  };

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
}

/** 아직 시트로 보내지 못한 결과를 모두 전송한다 */
async function flushToSheet() {
  const { gasUrl } = readConfig();
  if (!gasUrl) return { sent: 0, pending: 0 };

  const sent = readSent();
  const waiting = readRecords().filter((r) => !sent.has(r.clientId || r.id));
  let done = 0;
  for (const record of waiting) {
    try {
      await sendToSheet(record);
      markSent(record.clientId || record.id);
      lastRelayError = '';
      done += 1;
      console.log(`[시트 전송] 환자번호 ${record.patientNo}`);
    } catch (err) {
      lastRelayError = err.message;
      console.log(`[시트 전송 실패] ${err.message} — 나중에 다시 시도합니다`);
      break;
    }
  }
  return { sent: done, pending: waiting.length - done };
}

function relayStatus() {
  const { gasUrl, token } = readConfig();
  const sent = readSent();
  const all = readRecords();
  return {
    gasUrl,
    hasToken: Boolean(token),
    total: all.length,
    sentCount: all.filter((r) => sent.has(r.clientId || r.id)).length,
    pending: all.filter((r) => !sent.has(r.clientId || r.id)).length,
    lastError: lastRelayError,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function csvCell(v) {
  const s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : v;
  return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
}

function toCsv(records) {
  // 열 순서는 설문 문항 순서를 그대로 따른다 (환자번호는 맨 앞 한 번만).
  const fields = SECTIONS.flatMap((s) => s.fields).filter((f) => f.id !== 'patientNo');
  const cols = [
    { k: '기록번호', get: (r) => r.id },
    { k: '환자번호', get: (r) => r.patientNo },
    { k: '작성일시', get: (r) => r.submittedAt },
    { k: 'BMI', get: (r) => r.bmi },
    { k: 'BMI 분류', get: (r) => r.bmiCategory },
    { k: '목치수(cm)', get: (r) => r.neckCm },
    { k: 'Epworth 합계', get: (r) => r.essTotal },
  ]
    .concat(fields.map((f) => ({ k: f.short || f.label, get: (r) => formatAnswer(f, r.answers || {}) })))
    .concat([{ k: '참고 소견', get: (r) => r.findings }]);

  const rows = records.map((r) => cols.map((c) => csvCell(c.get(r))).join(','));
  // Excel에서 한글이 깨지지 않도록 BOM을 붙인다.
  return '\ufeff' + [cols.map((c) => csvCell(c.k)).join(',')].concat(rows).join('\r\n');
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // 루트 밖 경로 접근 차단
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/responses' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return sendJson(res, 413, { error: '요청이 너무 큽니다' });
      let record;
      try {
        record = JSON.parse(body);
      } catch (_) {
        return sendJson(res, 400, { error: 'JSON 형식이 올바르지 않습니다' });
      }
      if (!record || typeof record !== 'object' || !record.patientNo) {
        return sendJson(res, 400, { error: '환자번호가 없습니다' });
      }
      // 통신이 끊겨 다시 보낸 경우 같은 결과가 두 번 쌓이지 않게 한다.
      if (record.clientId) {
        const dup = readRecords().find((r) => r.clientId === record.clientId);
        if (dup) return sendJson(res, 200, { ok: true, id: dup.id, duplicated: true });
      }

      const saved = {
        id: `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
        savedAt: new Date().toISOString(),
        ...record,
      };
      try {
        fs.appendFileSync(DATA_FILE, JSON.stringify(saved) + '\n', 'utf8');
      } catch (err) {
        return sendJson(res, 500, { error: `저장 실패: ${err.message}` });
      }
      console.log(`[저장] 환자번호 ${saved.patientNo} · ESS ${saved.essTotal} · id ${saved.id}`);
      sendJson(res, 201, { ok: true, id: saved.id });
      // 구글 시트가 설정돼 있으면 서버가 대신 전송한다 (응답을 지연시키지 않는다).
      flushToSheet().catch(() => {});
    });
    return;
  }

  if (pathname === '/api/relay' && req.method === 'GET') {
    return sendJson(res, 200, relayStatus());
  }

  if (pathname === '/api/relay' && (req.method === 'POST' || req.method === 'PUT')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let cfg;
      try {
        cfg = JSON.parse(body);
      } catch (_) {
        return sendJson(res, 400, { error: 'JSON 형식이 올바르지 않습니다' });
      }
      writeConfig(cfg);
      lastRelayError = '';
      if (cfg.gasUrl) {
        try {
          // 설정하자마자 연결을 확인하고, 밀린 결과가 있으면 함께 보낸다.
          const url = `${cfg.gasUrl}${cfg.gasUrl.includes('?') ? '&' : '?'}action=ping&token=${encodeURIComponent(cfg.token || '')}`;
          const ping = await fetch(url, { redirect: 'follow' });
          const data = await ping.json();
          if (!data.ok) throw new Error(data.error || '연결에 실패했습니다');
          const flushed = await flushToSheet();
          return sendJson(res, 200, { ok: true, sheetName: data.sheetName, count: data.count, ...flushed });
        } catch (err) {
          lastRelayError = err.message;
          return sendJson(res, 200, { ok: false, error: err.message });
        }
      }
      sendJson(res, 200, { ok: true, cleared: true });
    });
    return;
  }

  if (pathname === '/api/relay/flush' && req.method === 'POST') {
    flushToSheet()
      .then((r) => sendJson(res, 200, { ok: true, ...r, lastError: lastRelayError }))
      .catch((err) => sendJson(res, 200, { ok: false, error: err.message }));
    return;
  }

  if (pathname === '/api/responses' && req.method === 'GET') {
    return sendJson(res, 200, { records: readRecords() });
  }

  if (pathname === '/api/responses.csv' && req.method === 'GET') {
    const csv = toCsv(readRecords());
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="OSAQ_records_${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    return res.end(csv);
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('허용되지 않는 요청입니다');
});

server.listen(PORT, HOST, () => {
  console.log(`수면무호흡 설문지 서버 실행 중`);
  console.log(`  로컬:    http://localhost:${PORT}`);
  console.log(`  태블릿:  http://<이 PC의 IP 주소>:${PORT}`);
  console.log(`  저장 위치: ${DATA_FILE}`);
  const { gasUrl } = readConfig();
  if (gasUrl) {
    console.log('  구글 시트 중계: 켜짐 — 서버가 결과를 시트로 대신 보냅니다');
    flushToSheet().catch(() => {});
    // 인터넷이 잠시 끊겨도 계속 재시도한다.
    setInterval(() => flushToSheet().catch(() => {}), 60000);
  }
});
