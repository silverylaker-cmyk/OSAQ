/* 수면무호흡 원인 평가 설문지 (PART A) — 진행 · 검증 · 결과 · 저장 */
(function () {
  'use strict';

  const { SECTIONS, SCALE_OPTIONS, ESS_IDS, formatAnswer } = window.SURVEY;
  const DRAFT_KEY = 'osaq.draft.v1';
  const LOCAL_STORE_KEY = 'osaq.records.v1';
  const RESULT_STEP = SECTIONS.length;

  const state = {
    step: 0,
    answers: loadDraft(),
    startedAt: new Date().toISOString(),
    saved: null, // { where: 'server' | 'local', at: ISO }
  };

  const el = {
    app: document.getElementById('app'),
    nav: document.getElementById('nav'),
    progressBar: document.getElementById('progressBar'),
    progressSteps: document.getElementById('progressSteps'),
    topPid: document.getElementById('topPid'),
  };

  /* ── 유틸 ─────────────────────────────── */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const visibleFields = (section) => section.fields.filter((f) => !f.showIf || f.showIf(state.answers));

  const hasValue = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.answers));
    } catch (_) {
      /* 저장 공간이 없어도 설문 진행에는 영향 없음 */
    }
  }

  function setAnswer(id, value) {
    if (value === undefined) delete state.answers[id];
    else state.answers[id] = value;
    saveDraft();
  }

  /* ── 계산 ─────────────────────────────── */
  function bmi() {
    const h = parseFloat(state.answers.height);
    const w = parseFloat(state.answers.weight);
    if (!h || !w) return null;
    return w / Math.pow(h / 100, 2);
  }

  function bmiCategory(v) {
    if (v == null) return '';
    if (v < 18.5) return '저체중';
    if (v < 23) return '정상';
    if (v < 25) return '과체중';
    if (v < 30) return '비만 1단계';
    return '비만 2단계 이상';
  }

  function essTotal() {
    return ESS_IDS.reduce((sum, id) => sum + (Number.isFinite(state.answers[id]) ? state.answers[id] : 0), 0);
  }

  function essAnswered() {
    return ESS_IDS.filter((id) => Number.isFinite(state.answers[id])).length;
  }

  function neckCm() {
    const n = parseFloat(state.answers.neckSize);
    if (!n) return null;
    return state.answers.neckUnit === 'cm' ? n : n * 2.54;
  }

  /* 참고 소견 — 진단이 아닌, 의료진 확인용 표식 */
  function findings() {
    const a = state.answers;
    const out = [];
    const b = bmi();
    if (b != null && b >= 25) out.push(`BMI ${b.toFixed(1)} · ${bmiCategory(b)}`);
    if (a.weightChange === '5kg 이상 증가') out.push('최근 2년 체중 5kg 이상 증가');
    const nc = neckCm();
    if (nc != null && nc >= 40) out.push(`목 치수 ${nc.toFixed(0)}cm (≥40cm)`);
    if (a.witnessedApnea === '예') out.push('목격된 무호흡');
    if (a.chokingAwake === '예') out.push('질식감 · 헐떡임으로 깸');
    if (a.snorePosition === '똑바로 누울 때만 심함' || a.sideReduce === '예') out.push('자세 의존성 시사');
    if (a.congestionFreq === '거의 매일' || a.congestionFreq === '주 3–4회' || a.mouthBreathing === '예' || a.nasalSleepOnset === '예')
      out.push('비강 요인 시사');
    if (a.alcoholBefore3h === '예') out.push('취침 3시간 내 음주');
    if (a.sedatives === '예') out.push('수면제 · 안정제 · 근이완제 복용');
    if (a.smoking === '현재') out.push('현재 흡연');
    if (Number(a.bpMedCount) >= 3) out.push('혈압약 3제 이상');
    if (Array.isArray(a.comorbidities) && a.comorbidities.includes('갑상선질환')) out.push('갑상선질환 병력');
    if (a.menopauseWorse === '예') out.push('폐경 이후 증상 악화');
    if (a.familyHistory === '예') out.push('가족력 있음');
    if (essTotal() >= 10) out.push(`Epworth ${essTotal()}점 (주간 과다졸림 의심)`);
    return out;
  }

  /* ── 렌더링: 문항 ─────────────────────── */
  function fieldHtml(field, errored) {
    const v = state.answers[field.id];
    let body = '';

    if (field.type === 'radio') {
      body = `<div class="opts">${field.options
        .map(
          (o) =>
            `<button type="button" class="opt${v === o.v ? ' is-on' : ''}" data-act="radio" data-id="${field.id}" data-v="${esc(
              o.v
            )}"><span class="opt__mark"></span><span class="opt__text">${esc(o.label)}</span></button>`
        )
        .join('')}</div>`;
    } else if (field.type === 'checks') {
      const arr = Array.isArray(v) ? v : [];
      body = `<div class="opts">${field.options
        .map(
          (o) =>
            `<button type="button" class="opt opt--check${arr.includes(o.v) ? ' is-on' : ''}" data-act="check" data-id="${
              field.id
            }" data-v="${esc(o.v)}" data-exclusive="${o.exclusive ? '1' : ''}"><span class="opt__mark"></span><span class="opt__text">${esc(
              o.label
            )}</span></button>`
        )
        .join('')}</div>`;
    } else if (field.type === 'number' || field.type === 'text') {
      const isNum = field.type === 'number';
      const unit = field.unitField
        ? `<select class="field__unit-sel" data-act="unit" data-id="${field.unitField.id}">${field.unitField.options
            .map((u) => {
              const cur = state.answers[field.unitField.id] || field.unitField.default;
              return `<option value="${esc(u)}"${cur === u ? ' selected' : ''}>${esc(u)}</option>`;
            })
            .join('')}</select>`
        : field.unit
        ? `<span class="field__unit">${esc(field.unit)}</span>`
        : '';
      body = `<div class="field">
        <input class="field__input" type="${isNum ? 'number' : 'text'}" data-act="input" data-id="${field.id}"
          value="${esc(v ?? '')}" ${isNum ? `min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 'any'}"` : ''}
          inputmode="${field.inputmode || (isNum ? 'decimal' : 'text')}" placeholder="${esc(field.placeholder || '')}"
          ${field.autofocus ? 'autofocus' : ''} enterkeyhint="next">
        ${unit}
        ${field.optionalNote ? `<span class="field__note">${esc(field.optionalNote)}</span>` : ''}
      </div>`;
    }

    return `<div class="q${errored ? ' is-error' : ''}" data-q="${field.id}">
      <label class="q__label">${esc(field.label)}${field.required ? '<span class="q__req">*</span>' : ''}
        ${field.help ? `<span class="q__help">${esc(field.help)}</span>` : ''}
      </label>
      ${body}
    </div>`;
  }

  function scaleHtml(field, idx, errored) {
    const v = state.answers[field.id];
    return `<div class="scale-row${errored ? ' is-error' : ''}" data-q="${field.id}">
      <div class="scale-row__label"><span class="scale-row__num">${idx + 1}.</span>${esc(field.label)}</div>
      <div class="scale-opts">${SCALE_OPTIONS.map(
        (o) =>
          `<button type="button" class="scale-opt${v === o.v ? ' is-on' : ''}" data-act="scale" data-id="${field.id}" data-v="${o.v}">
            <b>${o.label}</b><span>${esc(o.sub)}</span></button>`
      ).join('')}</div>
    </div>`;
  }

  /* ── 렌더링: 섹션 ─────────────────────── */
  function renderSection(errorIds) {
    const s = SECTIONS[state.step];
    const fields = visibleFields(s);
    const isEss = s.id === 'a6';

    let inner = '';
    if (isEss) {
      inner =
        `<div class="legend">${esc(s.scaleLegend)}</div>` +
        fields.map((f, i) => scaleHtml(f, i, errorIds.includes(f.id))).join('') +
        essTotalHtml();
    } else {
      inner = fields.map((f) => fieldHtml(f, errorIds.includes(f.id))).join('');
      if (s.id === 'a1') inner += bmiHintHtml();
    }

    el.app.innerHTML = `<div class="card">
      ${s.no ? `<span class="sec-no">PART A · ${esc(s.no)}</span>` : '<span class="sec-no">시작하기</span>'}
      <h1 class="sec-title">${esc(s.title)}</h1>
      <p class="sec-desc">${esc(s.desc)}</p>
      ${inner}
    </div>`;

    const answered = fields.filter((f) => hasValue(state.answers[f.id])).length;
    el.nav.innerHTML = `<div class="navbar__inner">
      ${state.step > 0 ? '<button type="button" class="btn btn--ghost" data-act="prev">이전</button>' : ''}
      <span class="nav-hint">${answered} / ${fields.length} 응답</span>
      <button type="button" class="btn btn--primary" data-act="next">${
        state.step === SECTIONS.length - 1 ? '입력 내용 확인' : '다음'
      }</button>
    </div>`;

    const focusTarget = el.app.querySelector(errorIds.length ? `[data-q="${errorIds[0]}"]` : '[autofocus]');
    if (focusTarget) {
      if (errorIds.length) focusTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = focusTarget.matches('input') ? focusTarget : focusTarget.querySelector('input');
      if (input && !errorIds.length) input.focus();
    }
  }

  function bmiHintHtml() {
    const b = bmi();
    if (b == null) return '';
    return `<div class="bmi-hint">계산된 BMI ${b.toFixed(1)} kg/m² · ${bmiCategory(b)}</div>`;
  }

  function essTotalHtml() {
    const total = essTotal();
    const done = essAnswered();
    return `<div class="ess-total">
      <span>합계</span>
      <span class="ess-total__num">${total} / 24</span>
      <span class="nav-hint">${done} / 8 문항 응답</span>
      ${done === 8 && total >= 10 ? '<span class="ess-total__flag">10점 이상 · 주간 과다졸림 의심</span>' : ''}
    </div>`;
  }

  /* ── 렌더링: 결과 ─────────────────────── */
  function renderResult() {
    const a = state.answers;
    const b = bmi();
    const total = essTotal();
    const nc = neckCm();
    const marks = findings();

    const sections = SECTIONS.filter((s) => s.id !== 'intro' && s.id !== 'a6')
      .map((s) => {
        const items = visibleFields(s)
          .map((f) => {
            const val = formatAnswer(f, a);
            const flagged = f.flagOn && a[f.id] === f.flagOn;
            return `<div class="res-item${flagged ? ' is-flag' : ''}">
              <span class="res-item__k">${esc(f.short || f.label)}</span>
              <span class="res-item__v${val ? '' : ' is-empty'}">${esc(val ?? '미입력')}</span>
            </div>`;
          })
          .join('');
        return `<section class="res-sec">
          <h2 class="res-sec__title">${esc(s.no)}. ${esc(s.title)}</h2>
          <div class="res-grid">${items}</div>
        </section>`;
      })
      .join('');

    const essSection = `<section class="res-sec">
      <h2 class="res-sec__title">A6. 주간 졸림 (Epworth) — 합계 ${total} / 24</h2>
      <div class="ess-grid">${SECTIONS.find((s) => s.id === 'a6')
        .fields.map(
          (f, i) =>
            `<div class="ess-cell"><div class="ess-cell__k">${i + 1}. ${esc(f.short)}</div><div class="ess-cell__v">${
              Number.isFinite(a[f.id]) ? a[f.id] : '-'
            }</div></div>`
        )
        .join('')}</div>
    </section>`;

    el.app.innerHTML = `<div class="card">
      <div class="result-head">
        <div>
          <h1 class="result-head__title">수면무호흡 원인 평가 설문 결과</h1>
          <div class="result-head__meta">PART A · 환자 작성 · 작성일시 ${esc(formatNow())}</div>
        </div>
        <div class="result-head__pid"><small>환자번호</small><b>${esc(a.patientNo || '-')}</b></div>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="kpi__k">BMI</div><div class="kpi__v">${b ? b.toFixed(1) : '-'}</div>
          <div class="kpi__s">${b ? esc(bmiCategory(b)) : '키 · 몸무게 미입력'}</div></div>
        <div class="kpi${total >= 10 ? ' is-warn' : ''}"><div class="kpi__k">EPWORTH 졸림 점수</div>
          <div class="kpi__v">${total} / 24</div>
          <div class="kpi__s">${total >= 10 ? '10점 이상 · 과다졸림 의심' : '10점 미만'}</div></div>
        <div class="kpi${a.witnessedApnea === '예' ? ' is-warn' : ''}"><div class="kpi__k">목격된 무호흡</div>
          <div class="kpi__v">${esc(a.witnessedApnea || '-')}</div>
          <div class="kpi__s">질식감으로 깸: ${esc(a.chokingAwake || '-')}</div></div>
        <div class="kpi"><div class="kpi__k">목 치수</div>
          <div class="kpi__v">${nc ? nc.toFixed(0) + ' cm' : '-'}</div>
          <div class="kpi__s">${nc ? (nc >= 40 ? '40cm 이상' : '40cm 미만') : '미입력'}</div></div>
      </div>

      <div class="flags">${
        marks.length
          ? marks.map((m) => `<span class="flag">${esc(m)}</span>`).join('')
          : '<span class="flag flag--none">특이 표식 없음</span>'
      }</div>

      ${sections}
      ${essSection}

      <div class="disclaimer">본 설문은 코골이 · 수면무호흡의 기여 요인을 탐색하기 위한 문진 도구입니다. 무호흡의 확진과 중증도 판정, 자세 의존성 확인은 수면다원검사(PSG)로 이루어지며, 치료 방법은 검사 결과와 진찰 소견을 종합하여 결정합니다.</div>
      <div id="saveState" class="save-state no-print" style="margin-top:16px"></div>
    </div>`;

    el.nav.innerHTML = `<div class="navbar__inner">
      <button type="button" class="btn btn--ghost" data-act="prev">이전</button>
      <button type="button" class="btn" data-act="print">인쇄 / PDF</button>
      <button type="button" class="btn" data-act="download">JSON 내려받기</button>
      <button type="button" class="btn btn--primary" data-act="save">결과 저장</button>
    </div>`;

    if (state.saved) showSaveState(`저장됨 · ${state.saved.where === 'server' ? '서버' : '이 태블릿(브라우저)'} · ${formatNow(state.saved.at)}`, 'ok');
    window.scrollTo({ top: 0 });
  }

  function showSaveState(msg, kind) {
    const node = document.getElementById('saveState');
    if (node) {
      node.textContent = msg;
      node.className = `save-state no-print ${kind === 'ok' ? 'is-ok' : kind === 'err' ? 'is-err' : ''}`;
    }
  }

  function formatNow(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ── 진행 표시 ────────────────────────── */
  function renderProgress() {
    const totalSteps = SECTIONS.length + 1;
    el.progressBar.style.width = `${(state.step / (totalSteps - 1)) * 100}%`;
    el.progressSteps.innerHTML = SECTIONS.map((s, i) => {
      const cls = i === state.step ? 'is-current' : i < state.step ? 'is-done' : '';
      return `<span class="progress__step ${cls}">${esc(s.no || '시작')}</span>`;
    })
      .concat(`<span class="progress__step ${state.step === RESULT_STEP ? 'is-current' : ''}">결과</span>`)
      .join('');
    el.topPid.textContent = state.answers.patientNo ? `환자번호 ${state.answers.patientNo}` : '';
  }

  function render(errorIds) {
    if (state.step === RESULT_STEP) renderResult();
    else renderSection(errorIds || []);
    renderProgress();
  }

  /* ── 검증 ─────────────────────────────── */
  function validate() {
    const s = SECTIONS[state.step];
    return visibleFields(s)
      .filter((f) => f.required && !hasValue(state.answers[f.id]))
      .map((f) => f.id);
  }

  function go(step) {
    state.step = Math.max(0, Math.min(RESULT_STEP, step));
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── 저장 ─────────────────────────────── */
  function buildRecord() {
    const b = bmi();
    return {
      patientNo: state.answers.patientNo || '',
      startedAt: state.startedAt,
      submittedAt: new Date().toISOString(),
      bmi: b ? Number(b.toFixed(1)) : null,
      bmiCategory: b ? bmiCategory(b) : '',
      neckCm: neckCm() ? Number(neckCm().toFixed(1)) : null,
      essTotal: essTotal(),
      essHigh: essTotal() >= 10,
      findings: findings(),
      answers: state.answers,
    };
  }

  async function save() {
    const record = buildRecord();
    showSaveState('저장 중…', '');
    try {
      const res = await fetch('api/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
      const data = await res.json();
      state.saved = { where: 'server', at: record.submittedAt };
      showSaveState(`서버에 저장되었습니다 · 기록번호 ${data.id} · ${formatNow(record.submittedAt)}`, 'ok');
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      // 서버가 없거나 통신에 실패하면 태블릿 브라우저에 보관한다.
      try {
        const list = JSON.parse(localStorage.getItem(LOCAL_STORE_KEY) || '[]');
        list.push(record);
        localStorage.setItem(LOCAL_STORE_KEY, JSON.stringify(list));
        state.saved = { where: 'local', at: record.submittedAt };
        showSaveState(`서버에 연결할 수 없어 이 태블릿에 저장했습니다 (${list.length}건 보관 중) · ${formatNow(record.submittedAt)}`, 'ok');
        localStorage.removeItem(DRAFT_KEY);
      } catch (e2) {
        showSaveState(`저장에 실패했습니다: ${err.message}. JSON 내려받기로 결과를 보관해 주세요.`, 'err');
      }
    }
  }

  function download() {
    const record = buildRecord();
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OSAQ_${record.patientNo || 'unknown'}_${record.submittedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetSurvey() {
    if (!confirm('새 환자 설문을 시작합니다. 현재 화면의 입력 내용은 지워집니다.')) return;
    state.answers = {};
    state.startedAt = new Date().toISOString();
    state.saved = null;
    localStorage.removeItem(DRAFT_KEY);
    go(0);
  }

  /* ── 이벤트 ───────────────────────────── */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'radio') {
      setAnswer(id, state.answers[id] === btn.dataset.v ? undefined : btn.dataset.v);
      render();
    } else if (act === 'scale') {
      const v = Number(btn.dataset.v);
      setAnswer(id, state.answers[id] === v ? undefined : v);
      render();
    } else if (act === 'check') {
      const cur = Array.isArray(state.answers[id]) ? state.answers[id].slice() : [];
      const v = btn.dataset.v;
      const field = SECTIONS.flatMap((s) => s.fields).find((f) => f.id === id);
      let next;
      if (btn.dataset.exclusive) {
        next = cur.includes(v) ? [] : [v];
      } else {
        next = cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat(v);
        const exclusives = field.options.filter((o) => o.exclusive).map((o) => o.v);
        next = next.filter((x) => !exclusives.includes(x));
      }
      setAnswer(id, next.length ? next : undefined);
      render();
    } else if (act === 'next') {
      const errs = validate();
      if (errs.length) {
        render(errs);
        return;
      }
      go(state.step + 1);
    } else if (act === 'prev') {
      go(state.step - 1);
    } else if (act === 'save') {
      save();
    } else if (act === 'print') {
      window.print();
    } else if (act === 'download') {
      download();
    } else if (act === 'reset') {
      resetSurvey();
    }
  });

  document.addEventListener('input', (e) => {
    const input = e.target.closest('[data-act="input"]');
    if (!input) return;
    const raw = input.value;
    const id = input.dataset.id;
    setAnswer(id, raw === '' ? undefined : input.type === 'number' ? Number(raw) : raw);
    // 재렌더링은 입력 흐름을 끊으므로, 값에 연동되는 표시만 갱신한다.
    if (state.step === RESULT_STEP) return;
    if (SECTIONS[state.step].id === 'a1') {
      const hint = el.app.querySelector('.bmi-hint');
      const b = bmi();
      if (b != null) {
        if (hint) hint.textContent = `계산된 BMI ${b.toFixed(1)} kg/m² · ${bmiCategory(b)}`;
        else el.app.querySelector('.card').insertAdjacentHTML('beforeend', bmiHintHtml());
      } else if (hint) hint.remove();
    }
    renderProgress();
  });

  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-act="unit"]');
    if (!sel) return;
    setAnswer(sel.dataset.id, sel.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.field__input')) {
      e.preventDefault();
      document.querySelector('[data-act="next"]')?.click();
    }
  });

  render();
})();
