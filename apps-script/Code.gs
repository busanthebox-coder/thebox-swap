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
      case 'swaps':    return json({ ok: true, swaps: listSwaps(req.from, req.to) });
      case 'mine':     return json({ ok: true, swaps: listMine(req.name) });
      case 'addSwap':  return json({ ok: true, swap: addSwap(req) });
      case 'claim':    return json(claim(req.id, req.name));
      case 'unclaim':  return json(unclaim(req.id, req.name));
      case 'cancel':   return json(cancel(req.id, req.name));
      case 'ping':     return json({ ok: true, pong: true, tz: Session.getScriptTimeZone() });
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
