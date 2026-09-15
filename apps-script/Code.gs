/**
 * 더박스 대타 보드 — 구글 시트 백엔드
 *
 * 설치: 대상 구글 시트 → 확장 프로그램 → Apps Script → 이 파일 전체를 붙여넣고 저장
 *       → 배포 → 새 배포 → 유형 "웹 앱"
 *       → 실행 계정: 나 / 액세스 권한: 모든 사용자 → 배포 → 승인
 *       → 나온 웹 앱 URL(.../exec)을 config.js 에 붙여넣기
 *
 * 데이터는 "대타" 탭에, 이름 목록은 "스태프" 탭에 쌓입니다.
 * 탭과 헤더는 첫 호출 때 자동으로 만들어집니다. 이미 내용이 있는 탭은 건드리지 않고 에러를 냅니다.
 */

/* ── 어느 탭에 쓸지 ── */
var SHEET_SWAP  = '대타';    // 대타 요청이 쌓이는 탭
var SHEET_STAFF = '스태프';  // 이름 목록 (없으면 자동 생성)

/* 시트 안에서 만든 스크립트면 비워두세요.
   따로 만든 스크립트라면 스프레드시트 URL의 /d/ 와 /edit 사이 값을 넣습니다. */
var SPREADSHEET_ID = '';

var STAFF_COLS = ['name', 'created_at'];
var SWAP_COLS = ['id', 'date', 'requester', 'cover', 'time_note', 'reason', 'tasks', 'status', 'created_at', 'filled_at'];

/* 이 스크립트의 버전. 앱은 이 숫자를 보고 새 기능을 켤지 정한다 — 한 곳에서만 올린다 */
var API_V = 9;

function doGet(e) { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  var req = {};
  try {
    if (e && e.postData && e.postData.contents) req = JSON.parse(e.postData.contents);
    else if (e && e.parameter && e.parameter.payload) req = JSON.parse(e.parameter.payload);
    else req = (e && e.parameter) || {};
  } catch (err) {
    return json({ ok: false, error: '요청을 읽지 못했습니다' });
  }

  try {
    switch (req.action) {
      case 'staff':    return json({ ok: true, staff: listStaff() });
      case 'addStaff': return json({ ok: true, staff: addStaff(req.name) });
      case 'removeStaff': return json(removeStaff(req.name));
      case 'swaps':    return json({ ok: true, swaps: listSwaps(req.from, req.to) });
      case 'mine':     return json({ ok: true, swaps: listMine(req.name) });
      case 'addSwap':  return json({ ok: true, swap: addSwap(req) });
      case 'claim':    return json(claim(req.id, req.name));
      case 'unclaim':  return json(unclaim(req.id, req.name));
      case 'cancel':   return json(cancel(req.id, req.name));
      case 'ping':     return json({ ok: true, pong: true, tz: Session.getScriptTimeZone(), v: API_V, topics: topicCount(), questions: questionCount() });
      case 'importEasy': return json(importEasy(req.rows));
      case 'boot':     return json(boot(req));
      case 'setLead':  return json({ ok: true, lead: setLead(req) });
      case 'translate': return json(translateKo(req.text));

      /* ── 토론 준비 ── */
      case 'questions':       return json({ ok: true, questions: questionsOf(req.topic) });
      case 'importQuestions': return json(importQuestions(req.rows));
      case 'prepSave':        return json({ ok: true, saved: prepSave(req) });
      case 'prepStatus':      return json({ ok: true, preps: prepStatus(req.week) });
      case 'prepView':        return json(prepView(req));

      /* ── 주간 주제 · 숙지 퀴즈 ── */
      case 'importTopics': return json(importTopics(req.rows));
      case 'topics':     return json({ ok: true, topics: listTopics() });
      case 'quiz':       return json({ ok: true, quiz: quizOf(req.topic) });
      case 'importQuiz': return json(importQuiz(req.rows));
      case 'weeks':      return json({ ok: true, weeks: listWeeks() });
      case 'setWeek':    return json({ ok: true, week: setWeek(req) });
      case 'quizStatus': return json({ ok: true, records: quizStatus(req.week) });
      case 'quizSubmit': return json({ ok: true, record: quizSubmit(req) });
      default:         return json({ ok: false, error: '알 수 없는 요청: ' + req.action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────── 시트 준비 ───────── */
function book() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('스프레드시트를 찾지 못했습니다. SPREADSHEET_ID 를 채워주세요.');
  return ss;
}

function writeHeader(sh, cols) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // 날짜·ID가 숫자로 변환되지 않게
}

/**
 * 탭을 찾아 헤더를 확인합니다.
 * - 탭이 없으면 만들고 헤더를 씁니다
 * - 비어 있으면 헤더를 씁니다
 * - 이미 다른 내용이 있으면 덮어쓰지 않고 에러를 냅니다 (기존 데이터 보호)
 */
function sheetOf(name, cols) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); writeHeader(sh, cols); return sh; }
  if (sh.getLastRow() === 0) { writeHeader(sh, cols); return sh; }

  var width = Math.max(cols.length, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, width).getValues()[0]
               .map(function (v) { return String(v == null ? '' : v).trim(); });
  var blank = head.every(function (v) { return v === ''; });
  if (blank) { writeHeader(sh, cols); return sh; }

  var okHeader = cols.every(function (c, i) { return head[i] === c; });
  if (!okHeader) {
    throw new Error(
      '"' + name + '" 탭 1행이 예상과 다릅니다. 기존 데이터를 덮어쓰지 않으려고 멈췄습니다. ' +
      '이 탭을 비우거나, Code.gs 위쪽의 SHEET_SWAP 값을 다른 탭 이름으로 바꿔주세요. ' +
      '(필요한 1행: ' + cols.join(', ') + ')'
    );
  }
  return sh;
}

function readAll(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j]; });
    return o;
  });
}

function colIndex(cols, name) { return cols.indexOf(name) + 1; }

function normDate(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
function parseTasks(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function toSwap(r) {
  return {
    id: String(r.id),
    date: normDate(r.date),
    requester: String(r.requester || ''),
    cover: r.cover ? String(r.cover) : null,
    time_note: r.time_note ? String(r.time_note) : null,
    reason: r.reason ? String(r.reason) : null,
    tasks: parseTasks(r.tasks),
    status: String(r.status || 'open'),
    created_at: r.created_at ? String(r.created_at) : null,
    filled_at: r.filled_at ? String(r.filled_at) : null
  };
}

/* ───────── staff ───────── */
function listStaff() {
  return readAll(sheetOf(SHEET_STAFF, STAFF_COLS), STAFF_COLS)
    .map(function (r) { return String(r.name || '').trim(); })
    .filter(function (n) { return n; })
    .sort();
}

function addStaff(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름이 비어 있습니다');
  if (name.length > 12) throw new Error('이름은 12자까지입니다');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheetOf(SHEET_STAFF, STAFF_COLS);
    var have = listStaff();
    if (have.indexOf(name) === -1) {
      sh.appendRow([name, new Date().toISOString()]);
      have.push(name); have.sort();
    }
    return have;
  } finally { lock.releaseLock(); }
}

/**
 * 이름 삭제 (오타·퇴사자 정리).
 * 스태프 목록에서만 지웁니다. 그 사람이 얽힌 대타 기록은 그대로 남습니다.
 */
function removeStaff(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름이 비어 있습니다');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheetOf(SHEET_STAFF, STAFF_COLS);
    var rows = readAll(sh, STAFF_COLS);
    var hit = 0;
    for (var i = rows.length - 1; i >= 0; i--) {          // 아래에서 위로: 행 번호가 밀리지 않게
      if (String(rows[i].name || '').trim() === name) { sh.deleteRow(rows[i]._row); hit++; }
    }
    SpreadsheetApp.flush();
    if (!hit) return { ok: false, error: '목록에 없는 이름입니다: ' + name };

    var kept = readAll(sheetOf(SHEET_SWAP, SWAP_COLS), SWAP_COLS).map(toSwap)
      .filter(function (s) { return s.requester === name || s.cover === name; }).length;
    return { ok: true, staff: listStaff(), kept: kept };
  } finally { lock.releaseLock(); }
}

/* ───────── swap ───────── */
function listSwaps(from, to) {
  return readAll(sheetOf(SHEET_SWAP, SWAP_COLS), SWAP_COLS)
    .map(toSwap)
    .filter(function (s) {
      return s.status !== 'canceled' && s.date && (!from || s.date >= from) && (!to || s.date <= to);
    });
}

function listMine(name) {
  name = String(name || '').trim();
  return readAll(sheetOf(SHEET_SWAP, SWAP_COLS), SWAP_COLS)
    .map(toSwap)
    .filter(function (s) {
      return s.status !== 'canceled' && (s.requester === name || s.cover === name);
    });
}

function addSwap(req) {
  var date = normDate(req.date);
  var requester = String(req.requester || '').trim();
  if (!date || !requester) throw new Error('날짜와 이름이 필요합니다');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheetOf(SHEET_SWAP, SWAP_COLS);
    var rows = readAll(sh, SWAP_COLS).map(toSwap);
    var dup = rows.some(function (s) {
      return s.date === date && s.requester === requester && s.status !== 'canceled';
    });
    if (dup) throw new Error('이 날짜에 이미 올린 요청이 있습니다');

    var row = {
      id: Utilities.getUuid(),
      date: date,
      requester: requester,
      cover: '',
      time_note: req.time_note || '',
      reason: req.reason || '',
      tasks: JSON.stringify(req.tasks || []),
      status: 'open',
      created_at: new Date().toISOString(),
      filled_at: ''
    };
    sh.appendRow(SWAP_COLS.map(function (c) { return row[c]; }));
    return toSwap(row);
  } finally { lock.releaseLock(); }
}

/** 선착순 확정 — 잠금 안에서 cover가 비었는지 확인 후에만 기록 */
function claim(id, name) {
  name = String(name || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheetOf(SHEET_SWAP, SWAP_COLS);
    var rows = readAll(sh, SWAP_COLS);
    var hit = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) { hit = rows[i]; break; }
    }
    if (!hit) return { ok: false, error: '요청을 찾지 못했습니다' };
    if (String(hit.status) === 'canceled') return { ok: false, error: '취소된 요청입니다' };
    if (hit.cover) return { ok: true, taken: true, cover: String(hit.cover) };
    if (String(hit.requester) === name) return { ok: false, error: '본인 요청에는 대타를 갈 수 없습니다' };

    sh.getRange(hit._row, colIndex(SWAP_COLS, 'cover')).setValue(name);
    sh.getRange(hit._row, colIndex(SWAP_COLS, 'status')).setValue('filled');
    sh.getRange(hit._row, colIndex(SWAP_COLS, 'filled_at')).setValue(new Date().toISOString());
    SpreadsheetApp.flush();
    return { ok: true, taken: false };
  } finally { lock.releaseLock(); }
}

function unclaim(id, name) {
  name = String(name || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheetOf(SHEET_SWAP, SWAP_COLS);
    var rows = readAll(sh, SWAP_COLS);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id) && String(rows[i].cover) === name) {
        sh.getRange(rows[i]._row, colIndex(SWAP_COLS, 'cover')).setValue('');
        sh.getRange(rows[i]._row, colIndex(SWAP_COLS, 'status')).setValue('open');
        sh.getRange(rows[i]._row, colIndex(SWAP_COLS, 'filled_at')).setValue('');
        SpreadsheetApp.flush();
        return { ok: true };
      }
    }
    return { ok: false, error: '내가 확정한 요청이 아닙니다' };
  } finally { lock.releaseLock(); }
}

function cancel(id, name) {
  name = String(name || '').trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheetOf(SHEET_SWAP, SWAP_COLS);
    var rows = readAll(sh, SWAP_COLS);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id) && String(rows[i].requester) === name) {
        sh.getRange(rows[i]._row, colIndex(SWAP_COLS, 'status')).setValue('canceled');
        SpreadsheetApp.flush();
        return { ok: true };
      }
    }
    return { ok: false, error: '내가 올린 요청이 아닙니다' };
  } finally { lock.releaseLock(); }
}


/* ════════════════════════════════════════════════════════════
   주간 주제 · 숙지 퀴즈
   - 주제 PDF는 공개 링크로 공유한 드라이브 폴더에 둔다
   - 주제 번호·제목·PDF 파일 ID는 "주제목록" 탭에 둔다. 드라이브를 직접 읽지 않으므로
     스크립트에 드라이브 권한이 필요 없다. 이 코드는 공개 레포에 올라가서 파일 주소를 박지 않는다
   - 퀴즈 문제는 "퀴즈문제" 탭. 사장님이 시트에서 직접 고칠 수 있다
   - 새 주제를 추가하려면 "주제목록"에 한 줄(번호·제목·파일 ID), "퀴즈문제"에 문제 행을 넣는다
   ════════════════════════════════════════════════════════════ */

var SHEET_WEEK  = '주간주제';
var SHEET_QREC  = '퀴즈기록';
var SHEET_QBANK = '퀴즈문제';
var SHEET_TOPIC = '주제목록';

var WEEK_KEYS  = ['week', 't1', 't2', 'set_by', 'set_at'];
var WEEK_HEAD  = ['주(월요일)', '주제1 (월화토)', '주제2 (수목일)', '정한 사람', '정한 시각'];
var QREC_KEYS  = ['week', 'topic', 'name', 'first_score', 'total', 'attempts', 'passed', 'first_at', 'passed_at'];
var QREC_HEAD  = ['주(월요일)', '주제', '이름', '첫 시도 점수', '문항 수', '시도 횟수', '완료', '첫 시도 시각', '완료 시각'];
var QBANK_KEYS = ['topic', 'kind', 'q', 'a1', 'a2', 'a3', 'a4', 'answer', 'where'];
var QBANK_HEAD = ['주제', '종류', '문제', '보기1', '보기2', '보기3', '보기4', '정답(번호)', '다시 볼 곳'];
var TOPIC_KEYS = ['num', 'title', 'file_id'];
var TOPIC_HEAD = ['번호', '제목', 'PDF 파일 ID'];

/** 한글 헤더로 탭을 준비하고, 기존 내용이 다르면 멈춘다 */
function tabOf(name, head) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); writeHeader(sh, head); return sh; }
  if (sh.getLastRow() === 0) { writeHeader(sh, head); return sh; }
  var got = sh.getRange(1, 1, 1, head.length).getValues()[0].map(function (v) { return String(v).trim(); });
  if (!head.every(function (h, i) { return got[i] === h; })) {
    throw new Error('"' + name + '" 탭 1행이 예상과 다릅니다. 기존 데이터를 지키려고 멈췄습니다.');
  }
  return sh;
}

function rowsOf(sh, keys) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, keys.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    keys.forEach(function (k, j) { o[k] = r[j]; });
    return o;
  });
}

/* ───────── 주제 목록 ("주제목록" 탭) ───────── */
function topicCount() {
  try { return Math.max(0, tabOf(SHEET_TOPIC, TOPIC_HEAD).getLastRow() - 1); } catch (e) { return -1; }
}

function listTopics() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('topics');
  if (hit) return JSON.parse(hit);

  var out = rowsOf(tabOf(SHEET_TOPIC, TOPIC_HEAD), TOPIC_KEYS).map(function (r) {
    return { num: +r.num, title: String(r.title || '').trim(), id: String(r.file_id || '').trim() };
  }).filter(function (t) { return t.num && t.title && t.id; });
  if (!out.length) throw new Error('주제 목록이 아직 비어 있습니다');
  out.sort(function (a, b) { return a.num - b.num; });

  var have = {};
  rowsOf(tabOf(SHEET_QBANK, QBANK_HEAD), QBANK_KEYS).forEach(function (r) { have[+r.topic] = true; });
  out.forEach(function (t) { t.quiz = !!have[t.num]; });

  cache.put('topics', JSON.stringify(out), 600);
  return out;
}

/** 주제 목록 일괄 입력 — 탭이 비어 있을 때만. 이후 추가·수정은 시트에서 직접 */
function importTopics(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '넣을 주제가 없습니다' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tabOf(SHEET_TOPIC, TOPIC_HEAD);
    if (sh.getLastRow() > 1) return { ok: false, error: '주제목록 탭에 이미 내용이 있습니다' };
    var vals = rows.map(function (r) { return TOPIC_KEYS.map(function (k) { return r[k] == null ? '' : r[k]; }); });
    sh.getRange(2, 1, vals.length, TOPIC_KEYS.length).setValues(vals);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('topics');
    return { ok: true, inserted: vals.length };
  } finally { lock.releaseLock(); }
}

/* ───────── 퀴즈 문제 ───────── */
function quizOf(topic) {
  topic = +topic;
  var key = 'quiz_' + topic;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var rows = rowsOf(tabOf(SHEET_QBANK, QBANK_HEAD), QBANK_KEYS).filter(function (r) { return +r.topic === topic; });
  var quiz = { topic: topic, content: [], expr: [], pop: [] };
  rows.forEach(function (r) {
    var opts = [r.a1, r.a2, r.a3, r.a4].map(function (v) { return String(v == null ? '' : v).trim(); })
                                       .filter(function (v) { return v; });
    var q = { q: String(r.q), options: opts, answer: (+r.answer) - 1, where: String(r.where || '') };
    if (q.answer < 0 || q.answer >= opts.length) return;           // 시트에서 잘못 고친 줄은 건너뜀
    var k = String(r.kind);
    if (k === '내용') quiz.content.push(q);
    else if (k === '표현') quiz.expr.push(q);
    else if (k === '팝퀴즈') quiz.pop.push(q);
  });
  cache.put(key, JSON.stringify(quiz), 600);
  return quiz;
}

/** 퀴즈 문제 일괄 입력 — 탭이 비어 있을 때만. 덮어쓰기는 막는다 */
function importQuiz(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '넣을 문제가 없습니다' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tabOf(SHEET_QBANK, QBANK_HEAD);
    if (sh.getLastRow() > 1) return { ok: false, error: '퀴즈문제 탭에 이미 문제가 있습니다. 다시 넣으려면 탭을 비워주세요.' };
    var vals = rows.map(function (r) { return QBANK_KEYS.map(function (k) { return r[k] == null ? '' : r[k]; }); });
    sh.getRange(2, 1, vals.length, QBANK_KEYS.length).setValues(vals);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('topics');
    return { ok: true, inserted: vals.length };
  } finally { lock.releaseLock(); }
}

/* ───────── 주간 주제 ───────── */
function listWeeks() {
  return rowsOf(tabOf(SHEET_WEEK, WEEK_HEAD), WEEK_KEYS).map(function (r) {
    return { week: normDate(r.week), t1: +r.t1 || null, t2: +r.t2 || null, set_by: String(r.set_by || '') };
  }).filter(function (w) { return w.week; });
}

function setWeek(req) {
  var week = normDate(req.week);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('주 날짜 형식이 잘못됐습니다');
  var t1 = +req.t1 || '', t2 = +req.t2 || '';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = tabOf(SHEET_WEEK, WEEK_HEAD);
    var row = [week, t1, t2, String(req.by || ''), new Date().toISOString()];
    var hit = rowsOf(sh, WEEK_KEYS).filter(function (r) { return normDate(r.week) === week; })[0];
    if (hit) sh.getRange(hit._row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    SpreadsheetApp.flush();
    return { week: week, t1: t1 || null, t2: t2 || null };
  } finally { lock.releaseLock(); }
}

/* ───────── 퀴즈 기록 ───────── */
function toRec(r) {
  return {
    week: normDate(r.week), topic: +r.topic, name: String(r.name),
    first_score: +r.first_score, total: +r.total, attempts: +r.attempts,
    passed: r.passed === true || String(r.passed).toUpperCase() === 'TRUE',
    passed_at: r.passed_at ? String(r.passed_at) : null
  };
}

function quizStatus(week) {
  week = normDate(week);
  return rowsOf(tabOf(SHEET_QREC, QREC_HEAD), QREC_KEYS).map(toRec)
    .filter(function (r) { return r.week === week; });
}

/** 첫 시도 점수는 처음 한 번만 기록. 이후엔 시도 횟수와 완료 여부만 갱신 */
function quizSubmit(req) {
  var week = normDate(req.week), topic = +req.topic, name = String(req.name || '').trim();
  if (!week || !topic || !name) throw new Error('주·주제·이름이 필요합니다');
  var score = +req.score, total = +req.total, passed = !!req.passed;
  var now = new Date().toISOString();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = tabOf(SHEET_QREC, QREC_HEAD);
    var hit = rowsOf(sh, QREC_KEYS).filter(function (r) {
      return normDate(r.week) === week && +r.topic === topic && String(r.name) === name;
    })[0];
    if (!hit) {
      sh.appendRow([week, topic, name, score, total, 1, passed, now, passed ? now : '']);
      return toRec({ week: week, topic: topic, name: name, first_score: score, total: total,
                     attempts: 1, passed: passed, passed_at: passed ? now : '' });
    }
    var rec = toRec(hit);
    if (rec.passed) return rec;                                    // 이미 완료면 그대로
    var attempts = rec.attempts + 1;
    sh.getRange(hit._row, QREC_KEYS.indexOf('attempts') + 1).setValue(attempts);
    if (passed) {
      sh.getRange(hit._row, QREC_KEYS.indexOf('passed') + 1).setValue(true);
      sh.getRange(hit._row, QREC_KEYS.indexOf('passed_at') + 1).setValue(now);
    }
    SpreadsheetApp.flush();
    rec.attempts = attempts; rec.passed = passed; rec.passed_at = passed ? now : null;
    return rec;
  } finally { lock.releaseLock(); }
}


/* ════════════════════════════════════════════════════════════
   토론 준비 — 진행하는 주제의 메인 질문을 읽고 질문마다 내 생각을 영어로 적는다 (최소 THINK_MIN개).
   예전(v7)엔 이끌 질문을 골라 여는 질문·꼬리 질문까지 적었다. 그 줄은 시트에 남아 있어 그대로 읽는다.
   다른 리더의 준비는 내 걸 제출한 뒤에만 열린다 (관리자는 언제나).
   ════════════════════════════════════════════════════════════ */

var SHEET_QN   = '토론질문';
var SHEET_PREP = '토론준비';
var QN_KEYS   = ['topic', 'no', 'kr', 'en'];
var QN_HEAD   = ['주제', '질문 번호', '질문(한국어)', '질문(영어)'];
var PREP_KEYS = ['week', 'topic', 'name', 'no', 'thought', 'ask', 'follow', 'saved_at'];
var PREP_HEAD = ['주(월요일)', '주제', '이름', '질문 번호', '내 생각', '멤버에게 던질 질문', '꼬리 질문', '저장 시각'];
var PREP_MIN = 0;                  // 이끌 질문 고르기는 없앴다 (v8). 옛 화면이 보내는 줄만 검사한다
var THINK_MIN = 3;                 // 내 생각을 써야 하는 질문 최소 수
var SHEET_LEAD = '진행';
var LEAD_KEYS = ['week', 'name', 'topic', 'saved_at'];
var LEAD_HEAD = ['주(월요일)', '이름', '진행 주제', '저장 시각'];
var ADMIN_NAMES = ['한남'];         // 다른 리더 준비를 언제든 볼 수 있는 이름
var ARROW = ' ⇒ ';                 // 꼬리 질문을 시트에서 읽기 쉽게: "멤버 답 ⇒ 되묻기" 한 줄씩

function questionCount() {
  try { return Math.max(0, tabOf(SHEET_QN, QN_HEAD).getLastRow() - 1); } catch (e) { return -1; }
}

function questionsOf(topic) {
  topic = +topic;
  var cache = CacheService.getScriptCache(), key = 'qn_' + topic, hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var out = rowsOf(tabOf(SHEET_QN, QN_HEAD), QN_KEYS)
    .filter(function (r) { return +r.topic === topic; })
    .map(function (r) { return { no: +r.no, kr: String(r.kr), en: String(r.en || '') }; })
    .sort(function (a, b) { return a.no - b.no; });
  cache.put(key, JSON.stringify(out), 600);
  return out;
}

/**
 * 주제 탭을 여는 데 필요한 것을 한 번에 돌려준다.
 * 시트 스크립트는 부를 때마다 2초 안팎이 드는데, 예전엔 탭 하나 여는 데 5번,
 * 퀴즈·토론 질문을 열 때 또 1번씩 불렀다. 이번 주 두 주제의 퀴즈와 질문까지 여기 싣는다.
 */
function boot(req) {
  var week = normDate(req.week);
  var weeks = listWeeks();
  var w = weeks.filter(function (x) { return x.week === week; })[0];
  var quiz = {}, questions = {};
  if (w) [w.t1, w.t2].forEach(function (n) {
    if (!n) return;
    quiz[n] = quizOf(n);
    questions[n] = questionsOf(n);
  });
  var allRecs = rowsOf(tabOf(SHEET_QREC, QREC_HEAD), QREC_KEYS).map(toRec);
  return { ok: true, v: API_V, week: week, topics: listTopics(), weeks: weeks,
           records: allRecs.filter(function (r) { return r.week === week; }),
           streaks: streaksOf(week, weeks, allRecs), preps: prepStatus(week), staff: listStaff(),
           leads: listLeads(week), quiz: quiz, questions: questions, prepMin: PREP_MIN, thinkMin: THINK_MIN };
}

/**
 * 연속 기록: 이 주부터 거꾸로, 두 주제 퀴즈를 모두 끝낸 주가 몇 주 이어지는지 이름별로 센다.
 * 이 주를 아직 안 끝냈으면 지난주부터 센다 (주중에는 끊긴 게 아니다). 주제가 안 올라온 주는 건너뛴다.
 */
function streaksOf(week, weeks, recs) {
  var pass = {}, names = {};
  recs.forEach(function (r) {
    names[r.name] = true;
    if (r.passed) pass[r.week + '|' + r.topic + '|' + r.name] = true;
  });
  var ws = weeks.filter(function (w) { return w.week <= week && (w.t1 || w.t2); })
    .sort(function (a, b) { return a.week < b.week ? 1 : -1; });
  var out = {};
  Object.keys(names).forEach(function (n) {
    function full(w) { return [w.t1, w.t2].every(function (t) { return !t || pass[w.week + '|' + t + '|' + n]; }); }
    var i = ws.length && ws[0].week === week && !full(ws[0]) ? 1 : 0, c = 0;
    for (; i < ws.length && full(ws[i]); i++) c++;
    if (c) out[n] = c;
  });
  return out;
}

/* ───────── 이번 주 내가 진행하는 주제 ─────────
   토론 준비는 진행하는 주제만 한다. 사장님 현황표에 누가 어느 주제를 맡는지 보이게 저장한다. */
function listLeads(week) {
  week = normDate(week);
  return rowsOf(tabOf(SHEET_LEAD, LEAD_HEAD), LEAD_KEYS)
    .filter(function (r) { return normDate(r.week) === week; })
    .map(function (r) { return { name: String(r.name), topic: +r.topic || 0, saved_at: String(r.saved_at || '') }; });
}

function setLead(req) {
  var week = normDate(req.week), name = clean(req.name, 30), topic = +req.topic || 0;
  if (!week || !name) throw new Error('주와 이름이 필요합니다');
  var now = new Date().toISOString();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = tabOf(SHEET_LEAD, LEAD_HEAD);
    var hit = rowsOf(sh, LEAD_KEYS).filter(function (r) { return normDate(r.week) === week && String(r.name) === name; })[0];
    var row = [week, name, topic || '', now];
    if (hit) sh.getRange(hit._row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    SpreadsheetApp.flush();
    return { name: name, topic: topic, saved_at: now };
  } finally { lock.releaseLock(); }
}

/* ───────── 한국어로 쓴 초안을 영어로 ─────────
   구글 시트 스크립트에 기본으로 들어 있는 번역 기능. 따로 돈이 들지 않는다. */
function translateKo(text) {
  text = clean(text, 800);
  if (!text) return { ok: false, error: '바꿀 내용이 없습니다' };
  return { ok: true, text: LanguageApp.translate(text, 'ko', 'en') };
}

/** 주제지의 쉬운 질문(Easy Entry)을 토론질문 탭 끝에 번호 101~ 로 붙인다. 한 번만 */
function importEasy(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '넣을 질문이 없습니다' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tabOf(SHEET_QN, QN_HEAD);
    var has = rowsOf(sh, QN_KEYS).some(function (r) { return +r.no > 100; });
    if (has) return { ok: false, error: '쉬운 질문이 이미 들어 있습니다' };
    var vals = rows.map(function (r) { return QN_KEYS.map(function (k) { return r[k] == null ? '' : r[k]; }); });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, QN_KEYS.length).setValues(vals);
    SpreadsheetApp.flush();
    var cache = CacheService.getScriptCache();
    rows.forEach(function (r) { cache.remove('qn_' + r.topic); });
    return { ok: true, inserted: vals.length };
  } finally { lock.releaseLock(); }
}

function importQuestions(rows) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: '넣을 질문이 없습니다' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = tabOf(SHEET_QN, QN_HEAD);
    if (sh.getLastRow() > 1) return { ok: false, error: '토론질문 탭에 이미 내용이 있습니다' };
    var vals = rows.map(function (r) { return QN_KEYS.map(function (k) { return r[k] == null ? '' : r[k]; }); });
    sh.getRange(2, 1, vals.length, QN_KEYS.length).setValues(vals);
    SpreadsheetApp.flush();
    return { ok: true, inserted: vals.length };
  } finally { lock.releaseLock(); }
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/⇒/g, '→').replace(/\s+/g, ' ').trim().slice(0, max || 500);
}
function followToText(list) {
  return list.map(function (f) { return f.if + ARROW + f.then; }).join('\n');
}
function textToFollow(t) {
  return String(t || '').split('\n').map(function (line) {
    var i = line.indexOf(ARROW);
    return i === -1 ? { if: '', then: line.trim() } : { if: line.slice(0, i).trim(), then: line.slice(i + ARROW.length).trim() };
  }).filter(function (f) { return f.then; });
}

/** 한 사람의 한 주·한 주제 준비를 통째로 바꿔 넣는다 (고른 질문을 바꿔도 깔끔하게) */
function prepSave(req) {
  var week = normDate(req.week), topic = +req.topic, name = clean(req.name, 30);
  if (!week || !topic || !name) throw new Error('주·주제·이름이 필요합니다');
  var items = Array.isArray(req.items) ? req.items : [];
  var seen = {};
  items = items.map(function (it) {
    var follow = (Array.isArray(it.follow) ? it.follow : [])
      .map(function (f) { return { if: clean(f.if, 200), then: clean(f.then, 300) }; })
      .filter(function (f) { return f.if && f.then; });
    return { no: +it.no, thought: clean(it.thought, 600), ask: clean(it.ask, 400), follow: follow };
  }).filter(function (it) { if (!it.no || seen[it.no]) return false; seen[it.no] = true; return true; });

  /* 이끄는 질문 = 여는 질문(ask)이 있는 줄. 나머지는 "내 생각"만 쓴 질문 */
  var leads = items.filter(function (it) { return it.ask; });
  items.forEach(function (it) {
    if (it.thought.length < 5) throw new Error('Q' + it.no + ' 내 생각을 조금 더 적어주세요');
  });
  if (items.length < THINK_MIN) throw new Error('내 생각을 ' + THINK_MIN + '개 질문 이상 적어주세요');
  if (leads.length < PREP_MIN) throw new Error('깊게 이끌 질문을 ' + PREP_MIN + '개 이상 골라주세요');
  leads.forEach(function (it) {
    if (it.ask.length < 5) throw new Error('Q' + it.no + ' 여는 질문을 적어주세요');
    if (!it.follow.length) throw new Error('Q' + it.no + ' 대화 잇기를 하나 이상 적어주세요');
  });

  var now = new Date().toISOString();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = tabOf(SHEET_PREP, PREP_HEAD);
    var old = rowsOf(sh, PREP_KEYS).filter(function (r) {
      return normDate(r.week) === week && +r.topic === topic && String(r.name) === name;
    });
    for (var i = old.length - 1; i >= 0; i--) sh.deleteRow(old[i]._row);   // 아래에서 위로
    items.forEach(function (it) {
      sh.appendRow([week, topic, name, it.no, it.thought, it.ask, followToText(it.follow), now]);
    });
    SpreadsheetApp.flush();
    return { week: week, topic: topic, name: name, count: leads.length, thoughts: items.length, saved_at: now };
  } finally { lock.releaseLock(); }
}

/** 현황표용: 내용 없이 누가 몇 개 준비했는지만 */
function prepStatus(week) {
  week = normDate(week);
  var map = {};
  rowsOf(tabOf(SHEET_PREP, PREP_HEAD), PREP_KEYS).forEach(function (r) {
    if (normDate(r.week) !== week) return;
    var k = r.name + '|' + r.topic;
    var m = map[k] || (map[k] = { name: String(r.name), topic: +r.topic, count: 0, thoughts: 0, saved_at: '' });
    m.thoughts++;
    if (String(r.ask || '').trim()) m.count++;
    if (String(r.saved_at) > m.saved_at) m.saved_at = String(r.saved_at);
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/** 준비 내용 보기 — 이 주에 내가 제출했거나 관리자일 때만. 같은 주제의 지난 주 준비도 함께 */
function prepView(req) {
  var week = normDate(req.week), topic = +req.topic, name = String(req.name || '').trim();
  var rows = rowsOf(tabOf(SHEET_PREP, PREP_HEAD), PREP_KEYS).filter(function (r) { return +r.topic === topic; });
  var mine = rows.filter(function (r) { return normDate(r.week) === week && String(r.name) === name; });
  if (!mine.length && ADMIN_NAMES.indexOf(name) === -1) {
    return { ok: false, locked: true, error: '내 준비를 먼저 제출하면 볼 수 있어요' };
  }
  return { ok: true, preps: rows.map(function (r) {
    return { week: normDate(r.week), name: String(r.name), no: +r.no, thought: String(r.thought),
             ask: String(r.ask), follow: textToFollow(r.follow), saved_at: String(r.saved_at) };
  }) };
}

