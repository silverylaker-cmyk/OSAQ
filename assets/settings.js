/* 저장 위치 설정 화면 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function refresh() {
    const cfg = Storage.getConfig();
    $('gasUrl').value = cfg.gasUrl;
    $('token').value = cfg.token;

    const sheet = Boolean(cfg.gasUrl);
    $('modeTitle').textContent = sheet ? '구글 시트' : '병원 서버 (server.js)';
    $('modeDesc').textContent = sheet
      ? '결과가 구글 시트에 바로 쌓입니다. 서버 PC를 켜 둘 필요가 없고, 시트에서 엑셀(.xlsx)로 내려받을 수 있습니다.'
      : '같은 네트워크의 서버 PC에 저장합니다. 서버가 꺼져 있으면 태블릿에 보관했다가 켜졌을 때 전송합니다.';

    const pending = Storage.pendingCount();
    $('pending').textContent = pending ? `${pending}건이 전송을 기다리고 있습니다` : '대기 중인 결과가 없습니다';
    $('pending').className = `save-state ${pending ? 'is-warn' : 'is-ok'}`;
    $('btnFlush').hidden = pending === 0;
  }

  function state(msg, kind) {
    $('testState').textContent = msg;
    $('testState').className = `save-state ${kind || ''}`;
  }

  $('btnSave').addEventListener('click', () => {
    const url = $('gasUrl').value.trim();
    if (url && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      state('주소가 올바르지 않습니다. Apps Script 배포 URL은 https://script.google.com/... 으로 시작하고 /exec 으로 끝납니다.', 'is-err');
      return;
    }
    Storage.setConfig({ gasUrl: url, token: $('token').value });
    state('저장했습니다. 연결 테스트로 확인해 보세요.', 'is-ok');
    refresh();
  });

  $('btnTest').addEventListener('click', async () => {
    state('연결 확인 중…', '');
    try {
      const r = await Storage.test({ gasUrl: $('gasUrl').value.trim(), token: $('token').value.trim() });
      if (r.where === 'sheet') {
        const via = r.via === 'jsonp' ? ' (우회 연결 사용)' : '';
        state(`연결 성공${via} · 시트 "${r.sheetName}"에 ${r.count}건이 저장되어 있습니다`, 'is-ok');
        if (r.sheetUrl) {
          $('testState').insertAdjacentHTML('beforeend', ` · <a href="${r.sheetUrl}" target="_blank" rel="noopener">시트 열기</a>`);
        }
      } else {
        state(`병원 서버 연결 성공 · ${r.count}건이 저장되어 있습니다`, 'is-ok');
      }
    } catch (err) {
      state(`연결 실패: ${err.message}`, 'is-err');
      $('testState').insertAdjacentHTML('beforeend', ' · <b>아래 [자세히 진단]</b>을 눌러 어디서 막혔는지 확인해 주세요.');
      runDiagnose();
    }
  });

  /* 어디서 막혔는지 단계별로 보여 준다 */
  async function runDiagnose() {
    const box = $('diagnose');
    box.hidden = false;
    box.innerHTML = '<div class="save-state">진단 중…</div>';
    const steps = await Storage.diagnose({ gasUrl: $('gasUrl').value.trim(), token: $('token').value.trim() });
    box.innerHTML = `<ol class="diag">${steps
      .map(
        (s) => `<li class="diag__item ${s.ok ? 'is-ok' : 'is-err'}">
          <span class="diag__mark">${s.ok ? '✓' : '✕'}</span>
          <span><b>${s.name}</b><br><span class="diag__detail">${s.detail}</span></span>
        </li>`
      )
      .join('')}</ol>`;
  }

  $('btnDiagnose').addEventListener('click', runDiagnose);

  $('btnClear').addEventListener('click', () => {
    if (!confirm('구글 시트 연결을 해제하고 병원 서버 저장으로 되돌릴까요?')) return;
    Storage.setConfig({ gasUrl: '', token: '' });
    state('구글 시트 연결을 해제했습니다.', 'is-ok');
    refresh();
  });

  $('btnFlush').addEventListener('click', async (e) => {
    e.target.disabled = true;
    state('전송 중…', '');
    const { sent, pending } = await Storage.flush();
    e.target.disabled = false;
    state(sent ? `${sent}건을 전송했습니다.${pending ? ` (남은 대기 ${pending}건)` : ''}` : '아직 저장소에 연결할 수 없습니다.', sent ? 'is-ok' : 'is-err');
    refresh();
  });

  refresh();
})();
