/**
 * 수면무호흡 원인 평가 설문지 — 구글 시트 저장용 Apps Script
 *
 * 사용법은 README.md의 "구글 시트에 저장하기"를 따라 주세요.
 * 요약: 구글 시트 → 확장 프로그램 → Apps Script → 이 코드 붙여넣기 →
 *       아래 TOKEN 수정 → 배포(웹 앱, 액세스 권한 '모든 사용자') → URL 복사
 *
 * 설문 태블릿이 이 웹 앱으로 결과를 보내면 시트에 한 줄씩 쌓입니다.
 * 서버 PC를 켜 둘 필요가 없고, 시트는 언제든 엑셀(.xlsx)로 내려받을 수 있습니다.
 */

// 아무나 시트에 쓰지 못하도록 하는 암호입니다. 아래 값을 바꾼 뒤,
// 설문 프로그램의 [설정] 화면에 같은 값을 입력하세요.
var TOKEN = 'osaq-2026-changeme';

// 결과가 쌓일 시트 이름 (없으면 자동으로 만듭니다)
var SHEET_NAME = '설문결과';

// 원본 응답(JSON)이 저장되는 열 이름 — 설문 프로그램에서 상세 내용을 다시 불러올 때 씁니다.
var RAW_HEADER = '원본데이터(JSON)';
var ID_HEADER = '기록번호';

/**
 * 권한 승인을 (다시) 받을 때 실행하는 함수입니다.
 *
 * Apps Script 편집기 위쪽 함수 목록에서 approveAndTest 를 고르고 ▷실행 을 누르세요.
 *   · 승인 창이 뜨면 계정 선택 → "확인되지 않았습니다" 화면에서 고급 › 이동 › 허용
 *   · 아래쪽 실행 로그에 "준비 완료" 가 찍히면 승인과 설정이 끝난 것입니다.
 * 승인을 마친 뒤에는 배포 › 배포 관리 › ✏️ › 버전 '새 버전' › 배포 로 다시 배포하세요.
 */
function approveAndTest() {
  var sheet = getSheet(); // 시트 접근 권한을 실제로 사용해 승인 창을 띄웁니다.
  var name = SpreadsheetApp.getActiveSpreadsheet().getName();
  var rows = Math.max(0, sheet.getLastRow() - 1);
  var message =
    '준비 완료 — 스프레드시트 "' + name + '" · 시트 "' + sheet.getName() + '" · 저장된 결과 ' + rows + '건' +
    ' · 암호(TOKEN) "' + TOKEN + '"';
  Logger.log(message);
  return message;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // 여러 태블릿이 동시에 제출해도 줄이 섞이지 않게 합니다.
  } catch (err) {
    return json({ ok: false, error: '시트가 사용 중입니다. 잠시 후 다시 시도해 주세요.' });
  }

  try {
    var payload = readPayload(e);
    if (payload.token !== TOKEN) return json({ ok: false, error: '암호(토큰)가 올바르지 않습니다.' });

    var record = payload.record || {};
    if (!record.patientNo) return json({ ok: false, error: '환자번호가 없습니다.' });

    var sheet = getSheet();
    var headers = ensureHeaders(sheet, payload.headers || []);
    var clientId = payload.clientId || record.clientId || '';

    // 통신이 끊겨 다시 보낸 경우, 같은 결과가 두 번 쌓이지 않도록 확인합니다.
    var existing = findRowByClientId(sheet, headers, clientId);
    if (existing > 0) return json({ ok: true, row: existing, duplicated: true });

    var values = payload.values || [];
    var row = headers.map(function (h, i) {
      if (h === RAW_HEADER) return JSON.stringify(record);
      if (h === ID_HEADER) return clientId;
      return i < values.length ? values[i] : '';
    });

    sheet.appendRow(row);
    return json({ ok: true, row: sheet.getLastRow() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  // callback 이 오면 JSONP로 답합니다. 브라우저가 일반 요청(CORS)을 막는 환경에서도 연결됩니다.
  var cb = /^[A-Za-z0-9_]{1,64}$/.test(params.callback || '') ? params.callback : '';

  if (params.token !== TOKEN) return json({ ok: false, error: '암호(토큰)가 올바르지 않습니다.' }, cb);

  var sheet = getSheet();
  var action = params.action || 'ping';

  if (action === 'ping') {
    return json({
      ok: true,
      count: Math.max(0, sheet.getLastRow() - 1),
      sheetName: sheet.getName(),
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    }, cb);
  }

  if (action === 'list') {
    return json({ ok: true, records: readRecords(sheet) }, cb);
  }

  // 폼 방식으로 보낸 결과가 시트에 들어갔는지 확인할 때 씁니다.
  if (action === 'check') {
    var headers = sheet.getLastRow() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      : [];
    var found = findRowByClientId(sheet, headers, params.clientId || '');
    return json({ ok: true, found: found > 0, row: found }, cb);
  }

  return json({ ok: false, error: '알 수 없는 요청입니다: ' + action }, cb);
}

/* ── 내부 함수 ─────────────────────────────── */

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

/** 첫 줄에 열 이름을 만들고, 새로운 문항이 추가되면 열을 덧붙입니다. */
function ensureHeaders(sheet, incoming) {
  var wanted = [ID_HEADER].concat(incoming).concat([RAW_HEADER]);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(wanted);
    var head = sheet.getRange(1, 1, 1, wanted.length);
    head.setFontWeight('bold').setBackground('#eaf1ff');
    sheet.setFrozenRows(1);
    return wanted;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var added = wanted.filter(function (h) {
    return headers.indexOf(h) === -1;
  });
  if (added.length) {
    // 원본데이터 열은 항상 마지막에 두기 위해, 새 열은 그 앞에 넣습니다.
    var rawAt = headers.indexOf(RAW_HEADER);
    var insertAt = rawAt === -1 ? headers.length : rawAt;
    headers = headers.slice(0, insertAt).concat(added.filter(function (h) { return h !== RAW_HEADER; }), headers.slice(insertAt));
    if (headers.indexOf(RAW_HEADER) === -1) headers.push(RAW_HEADER);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function findRowByClientId(sheet, headers, clientId) {
  if (!clientId || sheet.getLastRow() < 2) return 0;
  var col = headers.indexOf(ID_HEADER) + 1;
  if (col < 1) return 0;
  var ids = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(clientId)) return i + 2;
  }
  return 0;
}

/** 설문 프로그램의 '저장된 기록' 화면에서 쓸 수 있도록 원본 JSON을 돌려줍니다. */
function readRecords(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var rawCol = headers.indexOf(RAW_HEADER);
  if (rawCol === -1) return [];
  var rows = sheet.getRange(2, rawCol + 1, sheet.getLastRow() - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    try {
      out.push(JSON.parse(rows[i][0]));
    } catch (err) {
      /* 사람이 직접 고친 줄은 건너뜁니다 */
    }
  }
  return out;
}

/** 설문 프로그램이 보낸 내용을 읽습니다. 일반 전송과 폼 전송을 모두 지원합니다. */
function readPayload(e) {
  if (e && e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  if (e && e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  throw new Error('전송된 내용이 없습니다.');
}

function json(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ');').setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
