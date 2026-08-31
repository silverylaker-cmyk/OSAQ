/* 수면무호흡 원인 평가 설문지 - PART A 문항 정의
 * 각 문항: id / label / type / options / unit / help / required / showIf
 * type: number | text | radio | checks | scale
 */
(function (global) {
  const YN = [
    { v: '예', label: '예' },
    { v: '아니오', label: '아니오' },
  ];
  const YNU = [
    { v: '예', label: '예' },
    { v: '아니오', label: '아니오' },
    { v: '모름', label: '모름' },
  ];

  const SECTIONS = [
    {
      id: 'intro',
      no: '',
      title: '환자 확인',
      desc: '환자번호를 입력한 뒤 설문을 시작해 주세요.',
      fields: [
        {
          id: 'patientNo',
          label: '환자번호',
          short: '환자번호',
          type: 'text',
          required: true,
          placeholder: '예) 12345678',
          help: '병원 등록번호(차트번호)를 입력해 주세요.',
          inputmode: 'numeric',
          autofocus: true,
        },
      ],
    },
    {
      id: 'a1',
      no: 'A1',
      title: '체중 · 신체',
      desc: '키와 몸무게를 입력하면 BMI가 자동으로 계산됩니다.',
      fields: [
        { id: 'height', label: '키', short: '키', type: 'number', unit: 'cm', required: true, min: 100, max: 230, step: 0.1 },
        { id: 'weight', label: '몸무게', short: '몸무게', type: 'number', unit: 'kg', required: true, min: 25, max: 250, step: 0.1 },
        {
          id: 'weightChange',
          label: '최근 2년간 체중 변화',
          short: '2년간 체중 변화',
          type: 'radio',
          required: true,
          options: [
            { v: '5kg 이상 증가', label: '5kg 이상 증가' },
            { v: '3–5kg 증가', label: '3–5kg 증가' },
            { v: '변화 없음', label: '변화 없음' },
            { v: '감소', label: '감소' },
          ],
        },
        {
          id: 'neckSize',
          label: '셔츠 목 치수 (아시는 경우에만)',
          short: '셔츠 목 치수',
          type: 'number',
          unitField: { id: 'neckUnit', options: ['인치', 'cm'], default: '인치' },
          min: 5,
          max: 70,
          step: 0.5,
          optionalNote: '모르시면 비워 두세요.',
        },
      ],
    },
    {
      id: 'a2',
      no: 'A2',
      title: '코골이 · 무호흡 양상',
      desc: '주변에서 들은 이야기도 함께 답해 주세요.',
      fields: [
        { id: 'snoreYears', label: '코골이를 지적받은 지 약 몇 년 되었습니까?', short: '코골이 기간', type: 'number', unit: '년', min: 0, max: 80, step: 1 },
        {
          id: 'snorePosition',
          label: '어떤 자세에서 심합니까?',
          short: '악화 자세',
          type: 'radio',
          required: true,
          options: [
            { v: '똑바로 누울 때만 심함', label: '똑바로 누울 때만 심함' },
            { v: '자세와 무관하게 심함', label: '자세와 무관하게 심함' },
            { v: '모름', label: '모름' },
          ],
        },
        { id: 'sideReduce', label: '옆으로 누우면 코골이가 줄어든다는 말을 들었다', short: '옆으로 누우면 감소', type: 'radio', required: true, options: YNU },
        { id: 'witnessedApnea', label: '자는 중 숨이 멎는 것을 본 사람이 있다', short: '목격된 무호흡', type: 'radio', required: true, options: YN, flagOn: '예' },
        { id: 'chokingAwake', label: '자다가 숨이 막히거나 헐떡이며 깬 적이 있다', short: '질식감으로 깸', type: 'radio', required: true, options: YN, flagOn: '예' },
        { id: 'nocturia', label: '밤에 소변 때문에 2회 이상 깬다', short: '야간뇨 2회 이상', type: 'radio', required: true, options: YN },
        { id: 'morningHeadache', label: '아침에 두통이 잦다', short: '아침 두통', type: 'radio', required: true, options: YN },
      ],
    },
    {
      id: 'a3',
      no: 'A3',
      title: '코 증상',
      desc: '코막힘은 코골이·양압기 적응에 영향을 줍니다.',
      fields: [
        {
          id: 'congestionFreq',
          label: '코막힘 빈도',
          short: '코막힘 빈도',
          type: 'radio',
          required: true,
          options: [
            { v: '거의 매일', label: '거의 매일' },
            { v: '주 3–4회', label: '주 3–4회' },
            { v: '가끔', label: '가끔' },
            { v: '없음', label: '없음' },
          ],
        },
        { id: 'rhinitisDx', label: '알레르기비염 또는 축농증 진단을 받은 적이 있다', short: '비염/축농증 진단', type: 'radio', required: true, options: YN },
        { id: 'mouthBreathing', label: '입을 벌리고 잔다는 말을 듣거나, 아침에 입이 말라 있다', short: '구강호흡 · 입마름', type: 'radio', required: true, options: YN },
        { id: 'nasalSleepOnset', label: '코가 막혀 잠들기 어려운 날이 있다', short: '코막힘으로 입면 곤란', type: 'radio', required: true, options: YN },
      ],
    },
    {
      id: 'a4',
      no: 'A4',
      title: '생활 요인',
      desc: '음주 · 흡연 · 복용 약물에 대해 답해 주세요.',
      fields: [
        { id: 'alcoholPerWeek', label: '음주 횟수', short: '음주 횟수', type: 'number', unit: '회 / 주', min: 0, max: 21, step: 1 },
        { id: 'alcoholBefore3h', label: '잠들기 3시간 이내에 음주하는 편이다', short: '취침 3시간 내 음주', type: 'radio', required: true, options: YN, flagOn: '예' },
        { id: 'alcoholWorse', label: '음주한 날 코골이가 더 심해진다는 말을 들었다', short: '음주 시 코골이 악화', type: 'radio', required: true, options: YNU },
        {
          id: 'smoking',
          label: '흡연',
          short: '흡연',
          type: 'radio',
          required: true,
          options: [
            { v: '현재', label: '현재 흡연' },
            { v: '과거', label: '과거 흡연' },
            { v: '비흡연', label: '비흡연' },
          ],
        },
        { id: 'sedatives', label: '수면제 · 신경안정제 · 근이완제를 복용한다', short: '수면제/안정제/근이완제', type: 'radio', required: true, options: YN, flagOn: '예' },
        {
          id: 'sedativeNames',
          label: '복용 중인 약물명',
          short: '약물명',
          type: 'text',
          placeholder: '예) 졸피뎀, 알프라졸람',
          showIf: (a) => a.sedatives === '예',
        },
      ],
    },
    {
      id: 'a5',
      no: 'A5',
      title: '동반질환 · 기타',
      desc: '해당되는 항목을 모두 선택해 주세요.',
      fields: [
        {
          id: 'comorbidities',
          label: '진단받은 질환 (복수 선택 가능)',
          short: '동반질환',
          type: 'checks',
          required: true,
          options: [
            { v: '고혈압', label: '고혈압' },
            { v: '당뇨', label: '당뇨' },
            { v: '갑상선질환', label: '갑상선질환' },
            { v: '역류성식도염', label: '역류성식도염' },
            { v: '심장질환', label: '심장질환' },
            { v: '해당 없음', label: '해당 없음', exclusive: true },
          ],
        },
        {
          id: 'bpMedCount',
          label: '복용 중인 혈압약 개수',
          short: '혈압약 개수',
          type: 'number',
          unit: '개',
          min: 0,
          max: 6,
          step: 1,
          showIf: (a) => Array.isArray(a.comorbidities) && a.comorbidities.includes('고혈압'),
        },
        { id: 'familyHistory', label: '가족(부모 · 형제) 중 심한 코골이나 수면무호흡이 있다', short: '가족력', type: 'radio', required: true, options: YN },
        {
          id: 'menopause',
          label: '여성인 경우: 폐경 여부',
          short: '폐경',
          type: 'radio',
          required: true,
          options: [
            { v: '폐경 전', label: '폐경 전' },
            { v: '폐경 후', label: '폐경 후' },
            { v: '해당 없음', label: '해당 없음 (남성)' },
          ],
        },
        {
          id: 'menopauseWorse',
          label: '증상이 폐경 이후 시작되었거나 악화되었다',
          short: '폐경 후 악화',
          type: 'radio',
          options: YN,
          showIf: (a) => a.menopause === '폐경 후',
        },
      ],
    },
    {
      id: 'a6',
      no: 'A6',
      title: '주간 졸림 (Epworth 졸림 척도)',
      desc: '다음 상황에서 얼마나 졸거나 잠들 것 같은지 선택해 주세요.',
      scaleLegend: '0 = 졸지 않음 · 1 = 조금 · 2 = 상당히 · 3 = 매우 졸림',
      fields: [
        { id: 'ess1', label: '앉아서 책을 읽을 때', short: '독서 중', type: 'scale', required: true },
        { id: 'ess2', label: 'TV를 볼 때', short: 'TV 시청', type: 'scale', required: true },
        { id: 'ess3', label: '공공장소에서 가만히 앉아 있을 때 (회의, 극장 등)', short: '공공장소 착석', type: 'scale', required: true },
        { id: 'ess4', label: '차에 1시간 정도 계속 승객으로 앉아 있을 때', short: '1시간 승차', type: 'scale', required: true },
        { id: 'ess5', label: '오후에 누워서 쉴 때', short: '오후 휴식', type: 'scale', required: true },
        { id: 'ess6', label: '앉아서 다른 사람과 대화할 때', short: '대화 중', type: 'scale', required: true },
        { id: 'ess7', label: '점심 식사 후 (음주하지 않고) 조용히 앉아 있을 때', short: '점심 후 착석', type: 'scale', required: true },
        { id: 'ess8', label: '운전 중 차가 막혀 몇 분간 정차해 있을 때', short: '운전 중 정차', type: 'scale', required: true },
      ],
    },
  ];

  const SCALE_OPTIONS = [
    { v: 0, label: '0', sub: '졸지 않음' },
    { v: 1, label: '1', sub: '조금' },
    { v: 2, label: '2', sub: '상당히' },
    { v: 3, label: '3', sub: '매우' },
  ];

  const ESS_IDS = ['ess1', 'ess2', 'ess3', 'ess4', 'ess5', 'ess6', 'ess7', 'ess8'];

  /* 저장된 답변 1건을 사람이 읽는 문자열로 (설문 화면 · 결과 · 기록 목록 공용) */
  function formatAnswer(field, answers) {
    const v = answers ? answers[field.id] : undefined;
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
    if (field.type === 'checks') return v.join(', ');
    if (field.type === 'scale') return `${v}점`;
    if (field.type === 'number') {
      const unit = field.unitField ? (answers[field.unitField.id] || field.unitField.default) : field.unit || '';
      return unit ? `${v} ${unit}` : String(v);
    }
    return String(v);
  }

  /* 구글 시트의 열 구성 — 태블릿이 직접 보낼 때와 서버가 대신 보낼 때가 같아야 하므로 여기 둔다 */
  function sheetColumns(formatTime) {
    const fields = SECTIONS.flatMap((s) => s.fields).filter((f) => f.id !== 'patientNo');
    return [
      { k: '작성일시', get: (r) => formatTime(r.submittedAt) },
      { k: '환자번호', get: (r) => r.patientNo },
      { k: 'BMI', get: (r) => r.bmi },
      { k: 'BMI 분류', get: (r) => r.bmiCategory },
      { k: '목치수(cm)', get: (r) => r.neckCm },
      { k: 'Epworth 합계', get: (r) => r.essTotal },
    ]
      .concat(fields.map((f) => ({ k: f.short || f.label, get: (r) => formatAnswer(f, r.answers || {}) })))
      .concat([{ k: '참고 소견', get: (r) => (r.findings || []).join(' | ') }]);
  }

  global.SURVEY = { SECTIONS, SCALE_OPTIONS, ESS_IDS, formatAnswer, sheetColumns };
  // 서버(server.js)에서도 같은 문항 정의로 CSV 열 순서를 만든다.
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SURVEY;
})(typeof window !== 'undefined' ? window : globalThis);
