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

    // 주소 확인코드 — PC와 태블릿에서 같은 값이면 주소가 완전히 같다는 뜻이다.
    const fp = Storage.urlFingerprint($('gasUrl').value);
    $('fingerprint').innerHTML = fp
      ? `주소 확인코드 <b>${fp.code}</b> · 길이 ${fp.length}자 · 끝 8자 <code>${fp.tail}</code>
         <span class="q__help">PC와 태블릿에서 이 값이 다르면 주소가 서로 다른 것입니다.</span>`
      : '';

    const pending = Storage.pendingCount();
    $('pending').textContent = pending ? `${pending}건이 전송을 기다리고 있습니다` : '대기 중인 결과가 없습니다';
    $('pending').className = `save-state ${pending ? 'is-warn' : 'is-ok'}`;
    $('btnFlush').hidden = pending === 0;
  }

  function state(msg, kind) {
    $('testState').textContent = msg;
    $('testState').className = `save-state ${kind || ''}`;
  }

  $('gasUrl').addEventListener('input', () => {
    const fp = Storage.urlFingerprint($('gasUrl').value);
    $('fingerprint').innerHTML = fp
      ? `주소 확인코드 <b>${fp.code}</b> · 길이 ${fp.length}자 · 끝 8자 <code>${fp.tail}</code>`
      : '';
  });

  $('btnSave').addEventListener('click', () => {
    const url = $('gasUrl').value.trim();
    const problem = url ? Storage.urlProblem(url) : null;
    // 주소가 예상과 달라도 일단 저장은 한다. 형태만 다르고 동작하는 경우가 있기 때문이다.
    Storage.setConfig({ gasUrl: url, token: $('token').value });
    if (problem) {
      $('testState').innerHTML = `<span class="save-state is-warn">저장했지만 주소를 확인해 주세요 — ${problem}</span>`;
    } else {
      state('저장했습니다. 연결 테스트로 확인해 보세요.', 'is-ok');
    }
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
    const failed = steps.some((s) => !s.ok);
    box.innerHTML =
      `<ol class="diag">${steps
        .map(
          (s) => `<li class="diag__item ${s.ok ? 'is-ok' : 'is-err'}">
          <span class="diag__mark">${s.ok ? '✓' : '✕'}</span>
          <span><b>${s.name}</b><br><span class="diag__detail">${s.detail}</span></span>
        </li>`
        )
        .join('')}</ol>` + (failed ? openHelpHtml() : '');

    const openBtn = document.getElementById('btnOpenUrl');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const url = Storage.pingUrl({ gasUrl: $('gasUrl').value.trim(), token: $('token').value.trim() });
        window.open(url, '_blank', 'noopener');
      });
    }
  }

  /** 구글이 실제로 무엇을 돌려주는지 눈으로 확인하는 안내 */
  function openHelpHtml() {
    return `<div class="panel-help">
      <div class="panel-help__head">
        <b>구글이 무엇을 돌려주는지 직접 확인하기</b>
        <button type="button" class="btn" id="btnOpenUrl">구글 응답 직접 보기</button>
      </div>
      <p>새 탭이 열립니다. 거기에 나오는 내용으로 원인을 알 수 있습니다.</p>
      <table class="help-table">
        <tr>
          <td><code>{"ok":true,…}</code> 같은 글자</td>
          <td>구글은 정상입니다. 이 태블릿의 브라우저나 네트워크 문제이니, 다른 브라우저·다른 인터넷으로 시도해 보세요.</td>
        </tr>
        <tr>
          <td>구글 <b>로그인 화면</b>이 나온다</td>
          <td>배포의 액세스 권한이 “모든 사용자”가 아닙니다. <b>배포 › 배포 관리 › ✏️ › 버전 새 버전</b> 으로 권한을 바꿔 다시 배포하세요.</td>
        </tr>
        <tr>
          <td>“죄송합니다. 파일을 열 수 없습니다”</td>
          <td>같은 원인입니다. 권한을 “모든 사용자”로 바꿔 <b>새 버전</b>으로 재배포하세요.</td>
        </tr>
        <tr>
          <td>“Script function not found: doGet”</td>
          <td>코드가 제대로 저장되지 않았습니다. <code>Code.gs</code> 내용을 <b>처음부터 끝까지</b> 붙여넣고 저장한 뒤 다시 배포하세요.</td>
        </tr>
        <tr>
          <td>빨간 오류 화면 (예외 메시지)</td>
          <td>코드에 문제가 있습니다. 붙여넣기가 중간에 잘렸거나 <code>TOKEN</code> 줄의 따옴표가 지워졌는지 확인하세요.</td>
        </tr>
        <tr>
          <td>“암호(토큰)가 올바르지 않습니다”</td>
          <td>연결은 정상입니다. 설정 화면의 암호를 <code>Code.gs</code>의 <code>TOKEN</code> 과 똑같이 맞추면 됩니다.</td>
        </tr>
      </table>
    </div>`;
  }

  $('btnDiagnose').addEventListener('click', runDiagnose);

  $('btnClear').addEventListener('click', () => {
    if (!confirm('구글 시트 연결을 해제하고 병원 서버 저장으로 되돌릴까요?')) return;
    Storage.setConfig({ gasUrl: '', token: '' });
    state('구글 시트 연결을 해제했습니다.', 'is-ok');
    refresh();
  });

  /* 설정 링크 — PC에서 만든 주소·암호를 태블릿에 손으로 옮겨 적지 않도록.
   * 값은 주소의 # 뒤에 담기므로 서버 기록에는 남지 않는다. */
  function buildSetupLink() {
    const params = new URLSearchParams({ gasUrl: $('gasUrl').value.trim(), token: $('token').value.trim() });
    return `${location.origin}${location.pathname}#setup=${encodeURIComponent(params.toString())}`;
  }

  $('btnLink').addEventListener('click', async () => {
    const link = buildSetupLink();
    try {
      await navigator.clipboard.writeText(link);
      state('설정 링크를 복사했습니다. 태블릿으로 보내서 열면 주소와 암호가 자동으로 입력됩니다.', 'is-ok');
    } catch (_) {
      // 클립보드를 쓸 수 없는 브라우저에서는 링크를 직접 보여 준다.
      $('testState').innerHTML =
        '<span class="save-state">아래 링크를 복사해 태블릿으로 보내세요.</span>' +
        `<textarea readonly rows="3" style="width:100%;margin-top:8px;font-size:13px">${link}</textarea>`;
    }
  });

  /* 태블릿에서 설정 링크로 열었을 때 자동으로 채워 넣는다 */
  function applySetupLink() {
    const hash = location.hash || '';
    if (!hash.startsWith('#setup=')) return;
    const params = new URLSearchParams(decodeURIComponent(hash.slice('#setup='.length)));
    const gasUrl = (params.get('gasUrl') || '').trim();
    const token = (params.get('token') || '').trim();
    if (!gasUrl && !token) return;
    Storage.setConfig({ gasUrl, token });
    history.replaceState(null, '', location.pathname); // 주소창에 암호가 남지 않도록 지운다
    state('링크에서 주소와 암호를 받아 저장했습니다. 연결 테스트로 확인해 보세요.', 'is-ok');
  }

  $('btnFlush').addEventListener('click', async (e) => {
    e.target.disabled = true;
    state('전송 중…', '');
    const { sent, pending } = await Storage.flush();
    e.target.disabled = false;
    state(sent ? `${sent}건을 전송했습니다.${pending ? ` (남은 대기 ${pending}건)` : ''}` : '아직 저장소에 연결할 수 없습니다.', sent ? 'is-ok' : 'is-err');
    refresh();
  });

  applySetupLink();
  refresh();
})();
