/* 저장된 설문 기록 목록 · CSV / JSON 내려받기 */
(function () {
  'use strict';

  const { SECTIONS, ESS_IDS, formatAnswer } = window.SURVEY;
  const FIELDS = SECTIONS.flatMap((s) => s.fields);

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let records = [];

  function fmt(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function load() {
    const source = document.getElementById('source');
    source.textContent = '불러오는 중…';
    source.className = 'save-state';

    const result = await Storage.list();
    records = result.records.slice().sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

    const place = { sheet: '구글 시트', server: '병원 서버', local: '이 태블릿' }[result.source];
    if (result.source === 'local') {
      source.textContent = `${place}에 남은 사본 ${records.length}건 표시 · 저장소에 연결할 수 없습니다`;
      source.className = 'save-state is-warn';
    } else {
      source.textContent = `${place} ${result.remoteCount}건${result.pending ? ` · 전송 대기 ${result.pending}건` : ''}`;
      source.className = 'save-state is-ok';
    }

    document.getElementById('btnFlush').hidden = result.pending === 0;
    renderList();
  }

  function renderList() {
    const list = document.getElementById('list');
    if (!records.length) {
      list.innerHTML = '<div class="rec-empty">저장된 기록이 없습니다.</div>';
      return;
    }
    list.innerHTML = `<table class="rec-table">
      <thead><tr>
        <th>환자번호</th><th>작성일시</th><th>BMI</th><th>Epworth</th><th>목격 무호흡</th><th>참고 소견</th>
      </tr></thead>
      <tbody>${records
        .map(
          (r, i) => `<tr data-row="${i}" style="cursor:pointer">
            <td><b>${esc(r.patientNo || '-')}</b>${r._pending ? ' <span class="tag tag--warn">전송 대기</span>' : ''}</td>
            <td>${esc(fmt(r.submittedAt))}</td>
            <td>${r.bmi ?? '-'}${r.bmiCategory ? ` <span class="tag">${esc(r.bmiCategory)}</span>` : ''}</td>
            <td>${r.essTotal ?? '-'} / 24 ${r.essHigh ? '<span class="tag tag--warn">과다졸림</span>' : ''}</td>
            <td>${esc(r.answers?.witnessedApnea || '-')}</td>
            <td>${(r.findings || []).length}건 <span class="tag">보기</span></td>
          </tr>
          <tr class="rec-detail" data-detail="${i}" hidden><td colspan="6">${detailHtml(r)}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;

    list.querySelectorAll('[data-row]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const detail = list.querySelector(`[data-detail="${tr.dataset.row}"]`);
        detail.hidden = !detail.hidden;
      });
    });
  }

  /* 기록 1건의 전체 응답 펼쳐 보기 */
  function detailHtml(r) {
    const a = r.answers || {};
    const sections = SECTIONS.filter((s) => s.id !== 'intro' && s.id !== 'a6')
      .map((s) => {
        const items = s.fields
          .filter((f) => !f.showIf || f.showIf(a))
          .map((f) => {
            const val = formatAnswer(f, a);
            return `<div class="res-item"><span class="res-item__k">${esc(f.short || f.label)}</span>
              <span class="res-item__v${val ? '' : ' is-empty'}">${esc(val ?? '미입력')}</span></div>`;
          })
          .join('');
        return `<section class="res-sec"><h2 class="res-sec__title">${esc(s.no)}. ${esc(s.title)}</h2>
          <div class="res-grid">${items}</div></section>`;
      })
      .join('');

    const ess = `<section class="res-sec"><h2 class="res-sec__title">A6. Epworth — 합계 ${r.essTotal ?? '-'} / 24</h2>
      <div class="ess-grid">${SECTIONS.find((s) => s.id === 'a6')
        .fields.map(
          (f, i) => `<div class="ess-cell"><div class="ess-cell__k">${i + 1}. ${esc(f.short)}</div>
            <div class="ess-cell__v">${Number.isFinite(a[ESS_IDS[i]]) ? a[ESS_IDS[i]] : '-'}</div></div>`
        )
        .join('')}</div></section>`;

    const flags = (r.findings || []).map((m) => `<span class="flag">${esc(m)}</span>`).join('');
    return `<div style="padding:10px 4px 18px">${flags ? `<div class="flags">${flags}</div>` : ''}${sections}${ess}</div>`;
  }

  function csvCell(v) {
    const s = Array.isArray(v) ? v.join(' | ') : v ?? '';
    return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  }

  function toCsv() {
    const cols = [
      { k: '환자번호', get: (r) => r.patientNo },
      { k: '작성일시', get: (r) => fmt(r.submittedAt) },
      { k: 'BMI', get: (r) => r.bmi },
      { k: 'BMI 분류', get: (r) => r.bmiCategory },
      { k: '목치수(cm)', get: (r) => r.neckCm },
      { k: 'Epworth 합계', get: (r) => r.essTotal },
    ]
      .concat(
        FIELDS.filter((f) => f.id !== 'patientNo').map((f) => ({
          k: f.short || f.label,
          get: (r) => formatAnswer(f, r.answers || {}),
        }))
      )
      .concat([{ k: '참고 소견', get: (r) => r.findings }]);

    const rows = [cols.map((c) => csvCell(c.k)).join(',')].concat(
      records.map((r) => cols.map((c) => csvCell(c.get(r))).join(','))
    );
    // Excel에서 한글이 깨지지 않도록 BOM을 붙인다.
    return '﻿' + rows.join('\r\n');
  }

  function download(content, type, name) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('btnCsv').addEventListener('click', () =>
    download(toCsv(), 'text/csv;charset=utf-8', `OSAQ_records_${today}.csv`)
  );
  document.getElementById('btnJson').addEventListener('click', () =>
    download(JSON.stringify(records, null, 2), 'application/json', `OSAQ_records_${today}.json`)
  );
  document.getElementById('btnReload').addEventListener('click', load);
  document.getElementById('btnFlush').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const { sent, pending } = await Storage.flush();
    e.target.disabled = false;
    alert(sent ? `${sent}건을 전송했습니다.${pending ? ` (남은 대기 ${pending}건)` : ''}` : '아직 저장소에 연결할 수 없습니다.');
    load();
  });

  load();
})();
