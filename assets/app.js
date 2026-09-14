/* 더박스 대타 보드 — 근무표 없이 이름만으로 굴러가는 대타 교환판 */
(function () {
  'use strict';

  var CFG = window.THEBOX_CONFIG || {};
  var GAS = (CFG.GAS_URL || '').trim();
  var REMOTE = !!GAS;
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var LS_ME = 'thebox.me';
  var LS_DB = 'thebox.local.v1';

  var me = null;
  var cur = new Date();
  var view = { y: cur.getFullYear(), m: cur.getMonth() };
  var swaps = [];
  var staff = [];
  var sheetDate = null;
  var busy = false;

  /* ───────── helpers ───────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function el(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() { var t = new Date(); return ymd(t.getFullYear(), t.getMonth(), t.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dowOf(s) { return parseYmd(s).getDay(); }
  function fmtKo(s) {
    var p = s.split('-');
    return (+p[1]) + '월 ' + (+p[2]) + '일(' + DAYS[dowOf(s)] + ')';
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  }
  function setLoading(on) {
    document.body.classList.toggle('is-loading', !!on);
  }

  /* ───────── data layer ───────── */
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_DB)) || { staff: [], swaps: [] }; }
    catch (e) { return { staff: [], swaps: [] }; }
  }
  function lsWrite(d) { localStorage.setItem(LS_DB, JSON.stringify(d)); }

  /* 구글 Apps Script 웹앱 호출.
     Content-Type을 text/plain으로 보내야 CORS 사전요청(preflight) 없이 통과합니다. */
  function call(payload) {
    return fetch(GAS, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) {
      return r.text().then(function (txt) {
        var d;
        try { d = JSON.parse(txt); }
        catch (e) {
          throw new Error('시트 응답을 읽지 못했습니다. 배포 설정에서 액세스 권한이 "모든 사용자"인지 확인해 주세요.');
        }
        if (!d.ok && d.error) throw new Error(d.error);
        return d;
      });
    });
  }

  var db = {
    listStaff: function () {
      if (!REMOTE) return Promise.resolve(lsRead().staff.slice().sort());
      return call({ action: 'staff' }).then(function (d) { return d.staff || []; });
    },
    addStaff: function (name) {
      if (!REMOTE) {
        var d = lsRead();
        if (d.staff.indexOf(name) === -1) { d.staff.push(name); lsWrite(d); }
        return Promise.resolve(d.staff);
      }
      return call({ action: 'addStaff', name: name }).then(function (d) { return d.staff || []; });
    },
    removeStaff: function (name) {
      if (!REMOTE) {
        var d = lsRead();
        d.staff = d.staff.filter(function (n) { return n !== name; });
        lsWrite(d);
        var kept = d.swaps.filter(function (s) { return s.requester === name || s.cover === name; }).length;
        return Promise.resolve({ ok: true, staff: d.staff.slice().sort(), kept: kept });
      }
      return call({ action: 'removeStaff', name: name });
    },
    listSwaps: function (from, to) {
      if (!REMOTE) {
        return Promise.resolve(lsRead().swaps.filter(function (s) {
          return s.status !== 'canceled' && s.date >= from && s.date <= to;
        }));
      }
      return call({ action: 'swaps', from: from, to: to }).then(function (d) { return d.swaps || []; });
    },
    listMine: function (name) {
      if (!REMOTE) {
        return Promise.resolve(lsRead().swaps.filter(function (s) {
          return s.status !== 'canceled' && (s.requester === name || s.cover === name);
        }));
      }
      return call({ action: 'mine', name: name }).then(function (d) { return d.swaps || []; });
    },
    addSwap: function (row) {
      if (!REMOTE) {
        var d = lsRead();
        row.id = uuid(); row.created_at = new Date().toISOString();
        d.swaps.push(row); lsWrite(d);
        return Promise.resolve(row);
      }
      return call({
        action: 'addSwap', date: row.date, requester: row.requester,
        time_note: row.time_note, reason: row.reason, tasks: row.tasks
      });
    },
    /* 선착순 확정: 이미 채워졌으면 {taken:true} */
    claim: function (id, name) {
      if (!REMOTE) {
        var d = lsRead(), taken = false, found = false;
        d.swaps.forEach(function (s) {
          if (s.id === id) {
            found = true;
            if (s.cover) { taken = true; }
            else { s.cover = name; s.status = 'filled'; s.filled_at = new Date().toISOString(); }
          }
        });
        lsWrite(d);
        return Promise.resolve({ ok: found, taken: taken });
      }
      return call({ action: 'claim', id: id, name: name });
    },
    unclaim: function (id, name) {
      if (!REMOTE) {
        var d = lsRead();
        d.swaps.forEach(function (s) {
          if (s.id === id && s.cover === name) { s.cover = null; s.status = 'open'; s.filled_at = null; }
        });
        lsWrite(d);
        return Promise.resolve({ ok: true });
      }
      return call({ action: 'unclaim', id: id, name: name });
    },
    cancel: function (id, name) {
      if (!REMOTE) {
        var d = lsRead();
        d.swaps.forEach(function (s) { if (s.id === id && s.requester === me) s.status = 'canceled'; });
        lsWrite(d);
        return Promise.resolve({ ok: true });
      }
      return call({ action: 'cancel', id: id, name: name });
    }
  };

  /* ───────── login ───────── */
  function showLogin() {
    el('view-app').hidden = true;
    el('view-login').hidden = false;
    el('login-name').focus();
  }

  function setMe(name) {
    me = name;
    localStorage.setItem(LS_ME, name);
    el('view-login').hidden = true;
    el('view-app').hidden = false;
    el('who-wrap').hidden = true;
    $('.me-n', el('me-btn')).textContent = name;
    loadMonth();
    if (!el('tab-mine').hidden) renderMine();
    if (tp.state === 'ok') { renderTopic(); renderNudge(); } else loadTopic();
    /* 단톡방 공지 링크(#topic)로 들어왔으면 주제 탭부터 */
    if (location.hash === '#topic' && !setMe.hashDone) { setMe.hashDone = true; switchTab('topic'); }
  }

  /* ───────── 계정 / 이름 전환 ─────────
     한 기기를 여럿이 쓰거나, 관리자가 대신 적어줄 때 필요합니다. */
  function renderWho() {
    var others = staff.filter(function (n) { return n !== me; });
    var html = '<div class="who-now"><span class="who-lab">지금 이 기기</span>' +
               '<span class="who-name">' + esc(me) + '</span></div>';
    if (others.length) {
      html += '<span class="lab">다른 사람으로 전환</span><div class="name-chips">' +
        others.map(function (n) {
          return '<button type="button" data-who="' + esc(n) + '">' + esc(n) + '</button>';
        }).join('') + '</div>';
    }
    html += '<button class="btn btn-flat" type="button" data-who-out>다른 이름으로 로그인</button>' +
            '<p class="note">전환은 이 기기에서만 적용됩니다. 시트에 쌓인 기록은 그대로 남습니다.</p>';
    if (others.length) {
      html += '<details class="cleanup"><summary>이름 정리 <span class="dim">(오타·퇴사자)</span>' +
              '<span class="chev">▾</span></summary>' +
              '<p class="cleanup-note">로그인 목록에서만 사라집니다. 그 사람이 얽힌 대타 기록은 시트에 그대로 남습니다.</p>' +
              '<ul class="cleanup-list">' +
              others.map(function (n) {
                return '<li><span>' + esc(n) + '</span>' +
                       '<button type="button" data-del="' + esc(n) + '">삭제</button></li>';
              }).join('') + '</ul></details>';
    }
    el('who-body').innerHTML = html;

    Array.prototype.forEach.call(el('who-body').querySelectorAll('[data-who]'), function (b) {
      b.addEventListener('click', function () {
        setMe(b.dataset.who);
        toast(b.dataset.who + ' 님으로 전환했습니다');
      });
    });
    Array.prototype.forEach.call(el('who-body').querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var n = b.dataset.del;
        if (!confirm('"' + n + '" 을(를) 이름 목록에서 지울까요?\n대타 기록은 그대로 남습니다.')) return;
        b.disabled = true; b.textContent = '지우는 중…';
        db.removeStaff(n).then(function (res) {
          whoSeq++;                                   /* 진행 중이던 목록 조회 결과 무시 */
          staff = (res && res.staff) || staff.filter(function (x) { return x !== n; });
          var kept = res && res.kept;
          toast(n + ' 님을 목록에서 지웠습니다' + (kept ? ' (기록 ' + kept + '건은 유지)' : ''));
          renderWho();
        }).catch(function (e) { b.disabled = false; b.textContent = '삭제'; showError(e); });
      });
    });
    var out = el('who-body').querySelector('[data-who-out]');
    if (out) out.addEventListener('click', function () {
      localStorage.removeItem(LS_ME);
      me = null;
      el('who-wrap').hidden = true;
      el('login-name').value = '';
      el('login-err').hidden = true;
      showLogin();
    });
  }

  /* 계정 시트를 열 때 던진 목록 조회가 삭제보다 늦게 도착하면
     방금 지운 이름이 되살아나 보입니다. 순번을 붙여 낡은 응답은 버립니다. */
  var whoSeq = 0;

  function openWho() {
    el('who-wrap').hidden = false;
    renderWho();
    var seq = ++whoSeq;
    db.listStaff().then(function (n) {
      if (seq !== whoSeq) return;
      staff = n || [];
      if (!el('who-wrap').hidden) renderWho();
    }).catch(function () {});
  }

  el('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = el('login-name').value.trim();
    var err = el('login-err');
    err.hidden = true;
    if (name.length < 1) return;
    if (name.length > 12) { err.textContent = '이름은 12자까지예요.'; err.hidden = false; return; }

    /* 같은 이름이 이미 있으면 서버가 걸러내므로 그냥 보낸다.
       시트 왕복이 2초쯤 걸려서 버튼에 진행 상태를 보여준다. */
    var btn = $('#login-form button[type=submit]');
    btn.disabled = true; btn.textContent = '시작하는 중…';
    db.addStaff(name).then(function (list) {
      staff = list || [];
      setMe(name);
      btn.disabled = false; btn.textContent = '시작하기';
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '시작하기';
      err.textContent = '저장하지 못했습니다: ' + e.message; err.hidden = false;
    });
  });

  el('me-btn').addEventListener('click', openWho);

  /* ───────── month load / render ───────── */
  function monthRange(y, m) {
    var last = new Date(y, m + 1, 0).getDate();
    return [ymd(y, m, 1), ymd(y, m, last)];
  }

  function loadMonth() {
    var r = monthRange(view.y, view.m);
    setLoading(true);
    return db.listSwaps(r[0], r[1]).then(function (rows) {
      setLoading(false);
      swaps = rows || [];
      renderCal();
      renderMonthList();
      if (sheetDate) renderSheet(sheetDate);
    }).catch(function (e) { setLoading(false); showError(e); });
  }

  function byDate() {
    var map = {};
    swaps.forEach(function (s) { (map[s.date] = map[s.date] || []).push(s); });
    return map;
  }

  function renderCal() {
    el('m-num').textContent = view.m + 1;
    el('m-year').textContent = view.y;
    var map = byDate();
    var first = new Date(view.y, view.m, 1).getDay();
    var last = new Date(view.y, view.m + 1, 0).getDate();
    var prevLast = new Date(view.y, view.m, 0).getDate();
    var today = todayStr();
    var html = '';

    for (var i = first - 1; i >= 0; i--) {
      html += '<div class="d off"><span class="dn">' + (prevLast - i) + '</span></div>';
    }
    for (var d = 1; d <= last; d++) {
      var key = ymd(view.y, view.m, d);
      var list = map[key] || [];
      var op = list.filter(function (s) { return !s.cover; }).length;
      var w = new Date(view.y, view.m, d).getDay();
      var cls = 'd' + (w === 0 || w === 6 ? ' we' : '') + (key === today ? ' today' : '') +
                (op ? ' req' : '') + (list.length ? ' has' : '');
      var lbl = (view.m + 1) + '월 ' + d + '일' + (list.length ? ', 대타 ' + list.length + '건' + (op ? ', 미매칭 ' + op : ' 모두 확정') : '');
      html += '<button type="button" class="' + cls + '" data-date="' + key + '" aria-label="' + lbl + '">' +
              '<span class="dn">' + d + '</span>' + (op > 1 ? '<span class="oc">' + op + '</span>' : '') + '</button>';
    }
    var tail = (7 - ((first + last) % 7)) % 7;
    for (var t = 1; t <= tail; t++) {
      html += '<div class="d off"><span class="dn">' + t + '</span></div>';
    }
    el('cal').innerHTML = html;
    Array.prototype.forEach.call(el('cal').querySelectorAll('button.d'), function (b) {
      b.addEventListener('click', function () { openSheet(b.dataset.date); });
    });
  }

  function renderMonthList() {
    var map = byDate();
    var keys = Object.keys(map).sort();
    var total = swaps.length;
    var open = swaps.filter(function (s) { return !s.cover; }).length;
    el('ml-title').textContent = (view.m + 1) + '월 대타';
    el('ml-count').textContent = total ? total + '건 · 미매칭 ' + open : '';
    if (!keys.length) {
      el('mlist').innerHTML = '<p class="empty">이 달은 아직 대타 요청이 없습니다.<br>못 나오는 날이 생기면 아래 버튼으로 올려주세요.</p>';
      return;
    }
    var html = '';
    keys.forEach(function (k) {
      var w = dowOf(k), dd = +k.split('-')[2];
      map[k].slice().sort(function (a, b) { return (a.cover ? 1 : 0) - (b.cover ? 1 : 0); })
        .forEach(function (s, idx) {
          var st = s.cover ? 'mat' : 'req';
          var names = esc(s.requester) + ' → ' + (s.cover ? esc(s.cover) : '?');
          html += '<button type="button" class="ml-row ' + st + (idx ? ' cont' : '') + '" data-date="' + k + '">' +
                  '<span class="dchip">' + dd + '(' + DAYS[w] + ')</span>' +
                  '<span class="names">' + names + '</span>' +
                  '<span class="st">' + (s.cover ? '확정' : '대타 구함') + '</span></button>';
        });
    });
    el('mlist').innerHTML = html;
    Array.prototype.forEach.call(el('mlist').querySelectorAll('.ml-row'), function (b) {
      b.addEventListener('click', function () { openSheet(b.dataset.date); });
    });
  }

  /* ───────── sheet ───────── */
  function openSheet(date) {
    sheetDate = date;
    renderSheet(date);
    el('sheet-wrap').hidden = false;
  }
  function closeSheet() { el('sheet-wrap').hidden = true; sheetDate = null; }

  function renderSheet(date) {
    var list = swaps.filter(function (s) { return s.date === date; })
      .sort(function (a, b) { return (a.cover ? 1 : 0) - (b.cover ? 1 : 0); });
    var op = list.filter(function (s) { return !s.cover; }).length;
    var p = date.split('-');

    el('sheet-date').textContent = (+p[1]) + '.' + (+p[2]);
    el('sheet-dow').textContent = DAYS[dowOf(date)] + '요일';
    var badge = el('sheet-badge');
    if (!list.length) { badge.className = 'badge ok'; badge.textContent = '요청 없음'; }
    else if (op) { badge.className = 'badge req'; badge.textContent = list.length + '건 중 ' + op + '건 미매칭'; }
    else { badge.className = 'badge mat'; badge.textContent = list.length + '건 모두 확정'; }

    if (!list.length) {
      el('sheet-body').innerHTML = '<p class="empty">이 날은 대타 요청이 없습니다.</p>';
      return;
    }
    el('sheet-body').innerHTML = list.map(swapCard).join('');
    bindSheetActions();
  }

  function swapCard(s) {
    var open = !s.cover;
    var tasks = Array.isArray(s.tasks) ? s.tasks : [];
    var mineReq = s.requester === me;
    var mineCov = s.cover === me;
    var out = '<article class="swap ' + (open ? 'open' : 'filled') + '">' +
      '<div class="swap-top">' +
        '<span class="swap-name a">' + esc(s.requester) + '</span><span class="arrow">→</span>' +
        (open ? '<span class="swap-name empty-n">대타 없음</span>'
              : '<span class="swap-name b">' + esc(s.cover) + '</span>') +
        (s.time_note ? '<span class="swap-time">' + esc(s.time_note) + '</span>' : '') +
      '</div>';
    if (s.reason) out += '<div class="swap-body"><span class="lab2">사유</span>' + esc(s.reason) + '</div>';
    if (tasks.length) {
      out += '<details class="todo"' + (open ? ' open' : '') + '><summary><span class="sum-t">대타 하는 원어민<span class="dim">(이름/교재 &amp; 청소 유무)</span> 변경</span><span class="cnt">' + tasks.length + '</span><span class="chev">▾</span></summary><ul>' +
        tasks.map(function (t) { return '<li><span class="cb"></span><span>' + esc(t) + '</span></li>'; }).join('') +
        '</ul></details>';
    }
    if (open) {
      if (mineReq) {
        out += '<div class="swap-foot"><span>내가 올린 요청 · 대타 기다리는 중</span>' +
               '<button class="lk" data-act="cancel" data-id="' + s.id + '">요청 취소</button></div>';
      } else {
        out += '<div class="swap-acts"><button class="btn btn-red" data-act="claim" data-id="' + s.id + '">대타 갈게요</button></div>';
      }
    } else if (mineCov) {
      out += '<div class="swap-foot"><span>내가 대타 가는 날</span>' +
             '<button class="lk" data-act="unclaim" data-id="' + s.id + '">확정 취소</button></div>';
    } else {
      out += '<div class="swap-foot"><span>확정됨 · ' + esc(s.cover) + ' 님이 대신 근무</span></div>';
    }
    return out + '</article>';
  }

  function bindSheetActions() {
    Array.prototype.forEach.call(el('sheet-body').querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id, act = b.dataset.act;
        if (busy) return;
        if (act === 'claim') doClaim(id, b);
        if (act === 'unclaim') { if (confirm('확정을 취소하면 다시 미매칭이 됩니다. 계속할까요?')) doAct(db.unclaim(id, me), '확정을 취소했습니다'); }
        if (act === 'cancel') { if (confirm('이 요청을 취소할까요?')) doAct(db.cancel(id, me), '요청을 취소했습니다'); }
      });
    });
  }

  function doClaim(id, btn) {
    busy = true; btn.disabled = true; btn.textContent = '확정하는 중…';
    db.claim(id, me).then(function (res) {
      busy = false;
      if (res && res.taken) toast('방금 ' + (res.cover || '다른 분') + ' 님이 먼저 확정했어요');
      else toast('확정됐습니다. 요청자에게 표시됩니다');
      return loadMonth();
    }).catch(function (e) { busy = false; showError(e); loadMonth(); });
  }
  function doAct(p, msg) {
    busy = true;
    p.then(function () { busy = false; toast(msg); return loadMonth(); })
     .catch(function (e) { busy = false; showError(e); });
  }

  /* ───────── request form ───────── */
  function openForm(date) {
    var d = date || sheetDate || todayStr();
    el('f-date').value = d;
    el('form-title').textContent = '대타 요청 · ' + fmtKo(d);
    el('f-time').value = ''; el('f-reason').value = '';
    el('task-rows').innerHTML = ''; addTaskRow();
    el('form-err').hidden = true;
    el('form-wrap').hidden = false;
  }

  /* 날짜 입력이 바뀌면 제목도 따라간다 */
  el('f-date').addEventListener('change', function () {
    var v = el('f-date').value;
    el('form-title').textContent = v ? '대타 요청 · ' + fmtKo(v) : '대타 요청';
  });
  function addTaskRow(v) {
    var row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = '<input class="input" type="text" maxlength="60" placeholder="예: Mike / 교재 3권 Unit 5 · 청소 O" value="' + esc(v || '') + '">' +
                    '<button class="del" type="button" aria-label="삭제">×</button>';
    row.querySelector('.del').addEventListener('click', function () { row.remove(); });
    el('task-rows').appendChild(row);
  }
  el('add-task').addEventListener('click', function () { addTaskRow(); });

  el('req-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    var date = el('f-date').value;
    var err = el('form-err'); err.hidden = true;
    if (!date) { err.textContent = '날짜를 골라주세요.'; err.hidden = false; return; }
    var dup = swaps.some(function (s) { return s.date === date && s.requester === me && s.status !== 'canceled'; });
    if (dup) { err.textContent = '이 날짜에 이미 올린 요청이 있습니다.'; err.hidden = false; return; }

    var tasks = [];
    Array.prototype.forEach.call(el('task-rows').querySelectorAll('input'), function (i) {
      var v = i.value.trim(); if (v) tasks.push(v);
    });
    var row = {
      date: date, requester: me, cover: null,
      time_note: el('f-time').value.trim() || null,
      reason: el('f-reason').value.trim() || null,
      tasks: tasks, status: 'open'
    };
    busy = true;
    var btn = $('#req-form button[type=submit]'); btn.disabled = true;
    db.addSwap(row).then(function () {
      busy = false; btn.disabled = false;
      el('form-wrap').hidden = true;
      var d = parseYmd(date);
      view.y = d.getFullYear(); view.m = d.getMonth();
      toast('요청을 올렸습니다');
      return loadMonth();
    }).catch(function (e) { busy = false; btn.disabled = false; showError(e); });
  });

  /* ───────── 내 기록 ───────── */
  function renderMine() {
    db.listMine(me).then(function (rows) {
      rows = rows || [];
      var asked = rows.filter(function (s) { return s.requester === me && s.cover; }).length;
      var went = rows.filter(function (s) { return s.cover === me; }).length;
      var openMine = rows.filter(function (s) { return s.requester === me && !s.cover; }).length;
      el('cnt-asked').textContent = asked;
      el('cnt-went').textContent = went;
      var bal = went - asked;
      var b = el('cnt-bal');
      b.textContent = (bal > 0 ? '+' : '') + bal;
      b.style.color = bal > 0 ? 'var(--green)' : (bal < 0 ? 'var(--amber)' : 'var(--ink-3)');

      var hint = el('open-hint');
      if (openMine) { hint.textContent = '아직 대타를 못 구한 내 요청이 ' + openMine + '건 있습니다.'; hint.hidden = false; }
      else hint.hidden = true;

      el('hist-count').textContent = rows.length ? rows.length + '건' : '';
      if (!rows.length) {
        el('hist').innerHTML = '<p class="empty">아직 기록이 없습니다.</p>';
        return;
      }
      el('hist').innerHTML = rows.sort(function (a, b2) { return a.date < b2.date ? 1 : -1; }).map(function (s) {
        var p = s.date.split('-');
        var isAsk = s.requester === me;
        var txt = isAsk
          ? (s.cover ? esc(s.cover) + ' 님이 대신 근무' : '아직 대타 없음')
          : esc(s.requester) + ' 님 대신 근무';
        return '<div class="h-row"><span class="dt">' + p[1] + '/' + p[2] + '</span>' +
               '<span class="dir ' + (isAsk ? 'ask' : 'went') + '">' + (isAsk ? '구함' : '나감') + '</span>' +
               '<span class="p"' + (isAsk && !s.cover ? ' style="color:var(--red)"' : '') + '>' + txt + '</span></div>';
      }).join('');
    }).catch(showError);
  }

  /* ───────── 주간 주제 · 숙지 퀴즈 ─────────
     일요일에 관리자가 다음 주 주제 두 개를 올리면, 리더·대타 가리지 않고
     스태프 전원이 PDF 앞뒤를 읽고 9문제를 풀어 "숙지 완료"를 받는다. */
  var ADMINS = Array.isArray(CFG.ADMINS) ? CFG.ADMINS : ['한남'];
  var SLOTS = [
    { key: 't1', label: '주제 1', days: '월 · 화 · 토' },
    { key: 't2', label: '주제 2', days: '수 · 목 · 일' }
  ];
  var tp = { state: 'idle', err: '', topics: [], weeks: [], recs: [], preps: [], recWeek: null,
             week: null, moved: false, quizCache: {}, qnCache: {}, pending: null };

  function isAdmin() { return ADMINS.indexOf(me) !== -1; }
  function keyOf(d) { return ymd(d.getFullYear(), d.getMonth(), d.getDate()); }
  function mondayKey(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return keyOf(x);
  }
  function addDays(key, n) { var d = parseYmd(key); d.setDate(d.getDate() + n); return keyOf(d); }
  function md(key) { var d = parseYmd(key); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function weekLabel(key) {
    var a = parseYmd(key), b = parseYmd(addDays(key, 6));
    return (a.getMonth() + 1) + '월 ' + a.getDate() + '일 ~ ' +
           (a.getMonth() === b.getMonth() ? '' : (b.getMonth() + 1) + '월 ') + b.getDate() + '일';
  }
  function weekTag(key) {
    var k = mondayKey(new Date());
    return key === k ? '이번 주' : key === addDays(k, 7) ? '다음 주' : key === addDays(k, -7) ? '지난주' : '';
  }
  function topicOf(n) {
    n = +n;
    for (var i = 0; i < tp.topics.length; i++) if (tp.topics[i].num === n) return tp.topics[i];
    return null;
  }
  function weekOf(key) {
    for (var i = 0; i < tp.weeks.length; i++) if (tp.weeks[i].week === key) return tp.weeks[i];
    return null;
  }
  function recOf(name, topic) {
    if (tp.recWeek !== tp.week) return null;
    for (var i = 0; i < tp.recs.length; i++) {
      var r = tp.recs[i];
      if (r.name === name && r.topic === +topic) return r;
    }
    return null;
  }
  function pdfUrl(t) { return 'https://drive.google.com/file/d/' + encodeURIComponent(t.id) + '/view'; }
  function prepOf(name, topic) {
    if (tp.recWeek !== tp.week) return null;
    for (var i = 0; i < tp.preps.length; i++) {
      var p = tp.preps[i];
      if (p.name === name && p.topic === +topic) return p;
    }
    return null;
  }
  /* 퀴즈 통과 + 준비 2개 = 완료 */
  function progress(name, topic) {
    var r = recOf(name, topic), p = prepOf(name, topic);
    var quiz = !!(r && r.passed), prep = !!(p && p.count >= 2);
    return { rec: r, prep: p, quiz: quiz, prepDone: prep, done: quiz && prep };
  }
  function fmtWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* 주제 목록은 한 번만, 주간 주제·기록·스태프는 매번 */
  function loadTopic() {
    if (!REMOTE) { tp.state = 'local'; renderTopic(); return Promise.resolve(); }
    if (!me) return Promise.resolve();
    if (tp.pending) return tp.pending;
    if (!tp.week) tp.week = mondayKey(new Date());
    var week = tp.week;
    tp.pending = Promise.all([
      tp.topics.length ? { topics: tp.topics } : call({ action: 'topics' }),
      call({ action: 'weeks' }),
      call({ action: 'quizStatus', week: week }),
      db.listStaff(),
      call({ action: 'prepStatus', week: week })
    ]).then(function (r) {
      tp.topics = r[0].topics || [];
      tp.weeks = r[1].weeks || [];
      tp.recs = r[2].records || []; tp.recWeek = week;
      staff = r[3] || staff;
      tp.preps = r[4].preps || [];
      tp.state = 'ok';
      /* 일요일엔 다음 주 준비가 급하다. 관리자는 다음 주를 올려야 하니 바로 다음 주로,
         스태프는 다음 주 주제가 올라와 있을 때만 다음 주로 보여준다 */
      var next = addDays(mondayKey(new Date()), 7);
      if (!tp.moved && new Date().getDay() === 0 && (weekOf(next) || isAdmin())) {
        tp.moved = true; tp.week = next;
        return loadStatus();
      }
    }).catch(function (e) {
      var m = (e && e.message) || '';
      tp.state = m.indexOf('알 수 없는 요청') !== -1 ? 'old'
               : (m.indexOf('주제 목록') !== -1 || m.indexOf('폴더') !== -1) ? 'nofolder' : 'error';
      tp.err = m;
    }).then(function () { tp.pending = null; renderTopic(); renderNudge(); });
    return tp.pending;
  }

  function loadStatus() {
    var week = tp.week;
    return Promise.all([call({ action: 'weeks' }), call({ action: 'quizStatus', week: week }),
                        call({ action: 'prepStatus', week: week })])
      .then(function (r) {
        if (week !== tp.week) return;
        tp.weeks = r[0].weeks || [];
        tp.recs = r[1].records || []; tp.recWeek = week;
        tp.preps = r[2].preps || [];
        renderTopic(); renderNudge();
      }).catch(showError);
  }

  function renderTopic() {
    var box = el('tp-body');
    if (tp.week) {
      el('wk-label').textContent = weekLabel(tp.week);
      el('wk-tag').textContent = weekTag(tp.week);
    }
    el('tp-admin').hidden = !(isAdmin() && tp.state === 'ok');
    var msg = {
      local: '주제 기능은 구글 시트에 연결돼 있어야 씁니다.',
      old: isAdmin() ? '시트 스크립트를 새 버전으로 다시 배포해 주세요.<br>배포 관리 → 연필 → 새 버전' : '주제 기능을 준비하는 중입니다. 곧 열립니다.',
      nofolder: isAdmin() ? '시트의 주제목록 탭이 비어 있습니다.' : '주제 기능을 준비하는 중입니다. 곧 열립니다.',
      error: '주제를 불러오지 못했습니다.<br>' + esc((tp.err || '').slice(0, 80)),
      idle: '불러오는 중…'
    }[tp.state];
    if (msg) { box.innerHTML = '<p class="empty">' + msg + '</p>'; return; }

    var w = weekOf(tp.week);
    box.innerHTML = SLOTS.map(function (s) { return topicCard(s, w && w[s.key]); }).join('') + statusTable(w);
    Array.prototype.forEach.call(box.querySelectorAll('[data-quiz]'), function (b) {
      b.addEventListener('click', function () { openQuiz(+b.dataset.quiz); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-prep]'), function (b) {
      b.addEventListener('click', function () { openPrep(+b.dataset.prep); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { openView(+b.dataset.view); });
    });
  }

  function myBadge(g) {
    if (g.done) return '<span class="badge mat">준비 완료</span>';
    if (g.quiz) return '<span class="badge warn">토론 준비 남음</span>';
    return '<span class="badge ok">' + (g.rec ? '퀴즈 푸는 중' : '아직 안 함') + '</span>';
  }

  function topicCard(s, num) {
    var t = num ? topicOf(num) : null;
    var head = '<div class="tc-top"><span class="tc-slot">' + s.label + '<span class="dim"> · ' + s.days + '</span></span>';
    if (!t) {
      return '<article class="tc tc-empty">' + head + '</div><p class="tc-none">' +
        (num ? num + '번 PDF를 찾지 못했습니다.' : '아직 주제가 올라오지 않았어요.') + '</p></article>';
    }
    var g = progress(me, t.num), r = g.rec;
    var act, foot;
    if (!g.quiz) {
      act = t.quiz ? '<button class="btn btn-red" type="button" data-quiz="' + t.num + '">숙지 퀴즈 풀기</button>'
                   : '<button class="btn btn-flat" type="button" disabled>퀴즈 준비 중</button>';
      foot = '① 숙지 퀴즈 → ② 토론 준비 · 맡은 날 수업 전까지';
    } else if (!g.prepDone) {
      act = '<button class="btn btn-red" type="button" data-prep="' + t.num + '">토론 준비하기</button>';
      foot = '퀴즈 ✓ 첫 시도 ' + r.first_score + '/' + r.total + ' · 이제 토론 준비가 남았어요';
    } else {
      act = '<button class="btn btn-flat" type="button" data-prep="' + t.num + '">내 준비 · 수정</button>';
      foot = '퀴즈 ✓ 첫 시도 ' + r.first_score + '/' + r.total + ' · 준비 ✓ ' + fmtWhen(g.prep.saved_at);
    }
    var view = (g.prepDone || isAdmin())
      ? '<button class="tc-link" type="button" data-view="' + t.num + '">다른 리더들의 준비 보기 ›</button>' : '';
    return '<article class="tc' + (g.done ? ' tc-done' : '') + '">' + head + myBadge(g) + '</div>' +
      '<h3 class="tc-title"><span class="tc-num num">' + t.num + '</span>' + esc(t.title) + '</h3>' +
      '<div class="tc-acts"><a class="btn btn-ghost" href="' + pdfUrl(t) + '" target="_blank" rel="noopener">PDF 앞뒤 보기</a>' + act + '</div>' +
      '<p class="tc-due">' + foot + '</p>' + view + '</article>';
  }

  function statusTable(w) {
    if (!w || (!w.t1 && !w.t2)) return '';
    if (tp.recWeek !== tp.week) return '<section class="st"><p class="empty">현황을 불러오는 중…</p></section>';
    var names = staff.slice().sort();
    var sum = SLOTS.map(function (s) {
      var n = w[s.key];
      if (!n) return '';
      var done = names.filter(function (x) { return progress(x, n).done; }).length;
      return s.label + ' ' + done + '/' + names.length;
    }).filter(Boolean).join(' · ');
    var rows = names.map(function (x) {
      return '<tr' + (x === me ? ' class="me-row"' : '') + '><th>' + esc(x) + '</th>' + SLOTS.map(function (s) {
        var n = w[s.key];
        if (!n) return '<td class="c-na">—</td>';
        var g = progress(x, n), r = g.rec;
        if (g.done) {
          return '<td class="c-done">완료 <span class="num">' + r.first_score + '/' + r.total + '</span>' +
                 '<small>' + fmtWhen(g.prep.saved_at) + '</small></td>';
        }
        if (g.quiz) return '<td class="c-try">퀴즈만 <span class="num">' + r.first_score + '/' + r.total + '</span><small>' + fmtWhen(r.passed_at) + '</small></td>';
        if (r) return '<td class="c-try">퀴즈 푸는 중</td>';
        return '<td class="c-wait">아직</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<section class="st"><div class="mlist-h"><b>숙지 · 준비 현황</b><span class="num">' + sum + '</span></div>' +
      '<div class="tbl-scroll"><table class="st-t"><thead><tr><th></th>' +
      SLOTS.map(function (s) {
        var t = topicOf(w[s.key]);
        return '<th>' + s.label + (t ? '<small>' + t.num + '번</small>' : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">완료 = 퀴즈 + 토론 준비. 숫자는 퀴즈 첫 시도 점수, 아래는 끝낸 시각입니다.</p></section>';
  }

  /* 달력 위에 뜨는 알림: 이번 주 주제에서 남은 단계가 있으면 */
  function renderNudge() {
    var n = el('nudge');
    var w = tp.state === 'ok' && me ? weekOf(tp.week) : null;
    var left = 0;
    if (w) SLOTS.forEach(function (s) {
      var num = w[s.key];
      if (!num) return;
      var g = progress(me, num);
      if (!g.quiz) left++;
      if (!g.prepDone) left++;
    });
    if (!left) { n.hidden = true; return; }
    n.hidden = false;
    n.innerHTML = '<span>' + (weekTag(tp.week) || weekLabel(tp.week)) + ' 주제 · 퀴즈와 토론 준비 ' + left +
                  '개 남았어요</span><span class="nudge-go">하러 가기 ›</span>';
  }

  /* ── 퀴즈 ── */
  var qz = null;
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* 내용 3 + 표현 9개 중 3 + 팝퀴즈 3. 보기 순서는 매번 섞는다 */
  function buildItems(q) {
    function mk(kind, x) {
      var order = shuffle(x.options.map(function (_, i) { return i; }));
      return { kind: kind, q: x.q, where: x.where, answer: order.indexOf(x.answer),
               options: order.map(function (i) { return x.options[i]; }), picked: null, wrong: null, done: false };
    }
    return [].concat(
      q.content.map(function (x) { return mk('뒷면 · 내용', x); }),
      shuffle(q.expr).slice(0, 3).map(function (x) { return mk('뒷면 · 표현', x); }),
      q.pop.map(function (x) { return mk('앞면 · 팝퀴즈', x); })
    );
  }

  function openQuiz(num) {
    var t = topicOf(num);
    if (!t) return;
    el('quiz-wrap').hidden = false;
    el('qz-title').textContent = t.num + '. ' + t.title;
    el('qz-pdf').href = pdfUrl(t);
    el('qz-body').innerHTML = '<p class="empty">문제를 불러오는 중…</p>';
    el('qz-foot').hidden = true;
    var get = tp.quizCache[num] ? Promise.resolve(tp.quizCache[num])
      : call({ action: 'quiz', topic: num }).then(function (d) { return (tp.quizCache[num] = d.quiz); });
    get.then(function (q) {
      if (!q || !(q.content.length + q.expr.length + q.pop.length)) {
        el('qz-body').innerHTML = '<p class="empty">이 주제는 아직 퀴즈가 없습니다.</p>';
        return;
      }
      qz = { topic: num, items: buildItems(q), first: null, sending: false };
      el('qz-err').hidden = true; el('qz-res').hidden = true;
      el('qz-go').hidden = false; el('qz-go').textContent = '채점하기'; el('qz-next').hidden = true;
      renderQuiz();
    }).catch(function (e) {
      el('qz-body').innerHTML = '<p class="empty">문제를 불러오지 못했습니다.</p>';
      showError(e);
    });
  }

  function renderQuiz() {
    var last = '', html = '';
    qz.items.forEach(function (it, i) {
      if (it.kind !== last) { html += '<p class="qz-sec">' + it.kind + '</p>'; last = it.kind; }
      html += '<div class="qz-q' + (it.done ? ' is-done' : '') + '"><p class="qz-t"><span class="num">' + (i + 1) + '.</span> ' + esc(it.q) + '</p>' +
        it.options.map(function (o, j) {
          var c = 'qz-op';
          if (it.done && j === it.answer) c += ' ok';
          else if (it.picked === j) c += ' sel';
          else if (it.wrong === j) c += ' no';
          return '<button type="button" class="' + c + '" data-i="' + i + '" data-j="' + j + '"' + (it.done ? ' disabled' : '') + '>' + esc(o) + '</button>';
        }).join('') +
        (it.wrong !== null && !it.done ? '<p class="qz-hint">틀렸어요 — 다시 볼 곳: ' + esc(it.where) + '</p>' : '') +
        '</div>';
    });
    el('qz-body').innerHTML = html;
    el('qz-foot').hidden = false;
    Array.prototype.forEach.call(el('qz-body').querySelectorAll('.qz-op'), function (b) {
      b.addEventListener('click', function () {
        var it = qz.items[+b.dataset.i];
        if (it.done) return;
        it.picked = +b.dataset.j;
        el('qz-err').hidden = true;
        Array.prototype.forEach.call(b.parentNode.querySelectorAll('.qz-op'), function (x) {
          x.classList.toggle('sel', x === b);
          x.classList.remove('no');
        });
      });
    });
  }

  el('qz-go').addEventListener('click', function () {
    if (!qz || qz.sending) return;
    var left = qz.items.filter(function (it) { return !it.done && it.picked === null; }).length;
    if (left) {
      el('qz-err').textContent = '아직 안 고른 문제가 ' + left + '개 있어요';
      el('qz-err').hidden = false;
      return;
    }
    var right = 0;
    qz.items.forEach(function (it) {
      if (!it.done) {
        if (it.picked === it.answer) { it.done = true; it.wrong = null; }
        else it.wrong = it.picked;
        it.picked = null;
      }
      if (it.done) right++;
    });
    var total = qz.items.length, passed = right === total;
    if (qz.first === null) qz.first = right;
    renderQuiz();

    var res = el('qz-res');
    res.hidden = false;
    res.className = 'qz-res ' + (passed ? 'is-pass' : 'is-fail');
    res.textContent = passed
      ? '숙지 완료 · 첫 시도 ' + qz.first + '/' + total
      : right + '/' + total + ' · 틀린 ' + (total - right) + '개는 PDF를 다시 보고 골라주세요';
    el('qz-go').textContent = '다시 채점하기';
    el('qz-go').hidden = passed;
    el('qz-next').hidden = !passed;
    if (!passed) {
      var firstWrong = el('qz-body').querySelector('.qz-hint');
      if (firstWrong) firstWrong.parentNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    qz.sending = true;
    var sent = { week: tp.week, topic: qz.topic };
    call({ action: 'quizSubmit', week: sent.week, topic: sent.topic, name: me, score: right, total: total, passed: passed })
      .then(function (d) {
        if (qz) qz.sending = false;
        if (d.record && sent.week === tp.recWeek) {
          tp.recs = tp.recs.filter(function (r) { return !(r.name === me && r.topic === sent.topic); }).concat([d.record]);
        }
        renderTopic(); renderNudge();
        if (passed) toast('숙지 완료로 기록했습니다');
      }).catch(function (e) { if (qz) qz.sending = false; showError(e); });
  });

  /* ── 토론 준비 ──
     질문 목록을 먼저 보여주고, 고른 질문만 펼쳐 세 칸을 적게 한다.
     닫았다 열어도 쓰던 내용이 남도록 이 기기에 초안을 저장한다. */
  var pp = null;
  function draftKey(topic) { return 'thebox.prep.' + tp.week + '.' + topic + '.' + me; }
  function blankPrep() { return { thought: '', ask: '', follow: [{ if: '', then: '' }] }; }
  function loadQuestions(topic) {
    return tp.qnCache[topic] ? Promise.resolve(tp.qnCache[topic])
      : call({ action: 'questions', topic: topic }).then(function (d) { return (tp.qnCache[topic] = d.questions || []); });
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey(pp.topic), JSON.stringify({ sel: pp.sel, data: pp.data })); } catch (e) {}
  }

  function openPrep(num) {
    var t = topicOf(num);
    if (!t) return;
    el('quiz-wrap').hidden = true; qz = null;
    el('prep-wrap').hidden = false;
    el('pp-title').textContent = t.num + '. ' + t.title;
    el('pp-chips').innerHTML = '';
    el('pp-body').innerHTML = '<p class="empty">질문을 불러오는 중…</p>';
    el('pp-err').hidden = true;
    pp = null;
    var mine = progress(me, num).prepDone;
    Promise.all([loadQuestions(num), mine ? call({ action: 'prepView', week: tp.week, topic: num, name: me }) : null])
      .then(function (r) {
        var qs = r[0];
        if (!qs.length) { el('pp-body').innerHTML = '<p class="empty">이 주제는 아직 토론 질문이 없습니다.</p>'; return; }
        pp = { topic: num, qs: qs, sel: [], data: {} };
        var saved = (r[1] && r[1].preps || []).filter(function (x) { return x.week === tp.week && x.name === me; });
        if (saved.length) {
          saved.forEach(function (x) {
            pp.sel.push(x.no);
            pp.data[x.no] = { thought: x.thought, ask: x.ask, follow: x.follow.length ? x.follow : [{ if: '', then: '' }] };
          });
        } else {
          try {
            var d = JSON.parse(localStorage.getItem(draftKey(num)) || 'null');
            if (d && Array.isArray(d.sel)) { pp.sel = d.sel.slice(0, 2); pp.data = d.data || {}; }
          } catch (e) {}
        }
        el('pp-go').textContent = saved.length ? '수정해서 다시 제출' : '제출하기';
        renderPrep();
      }).catch(function (e) {
        el('pp-body').innerHTML = '<p class="empty">질문을 불러오지 못했습니다.</p>';
        showError(e);
      });
  }

  function renderPrep() {
    el('pp-chips').innerHTML = '<span class="pp-count">고른 질문 <b>' + pp.sel.length + '</b> / 2</span>';
    el('pp-body').innerHTML = pp.qs.map(function (q) {
      var on = pp.sel.indexOf(q.no) !== -1;
      var d = pp.data[q.no] || blankPrep();
      var h = '<section class="pq' + (on ? ' is-on' : '') + '" data-no="' + q.no + '">' +
        '<button type="button" class="pq-head" data-pick="' + q.no + '">' +
        '<span class="pq-no num">Q' + q.no + '</span>' +
        '<span class="pq-t">' + esc(q.kr) + (q.en ? '<small>' + esc(q.en) + '</small>' : '') + '</span>' +
        '<span class="pq-tog">' + (on ? '고름 ✓' : '고르기') + '</span></button>';
      if (on) {
        h += '<div class="pq-form">' +
          '<label class="lab long">내 생각</label>' +
          '<textarea class="input" rows="2" data-f="thought" placeholder="이 질문에 대한 내 답을 한두 줄로">' + esc(d.thought) + '</textarea>' +
          '<label class="lab long">멤버에게 던질 질문</label>' +
          '<textarea class="input" rows="2" data-f="ask" placeholder="멤버가 편하게 말을 꺼낼 수 있는 질문">' + esc(d.ask) + '</textarea>' +
          '<label class="lab long">꼬리 질문 <span class="dim">— 멤버가 이렇게 말하면 → 이렇게 되묻기</span></label>' +
          d.follow.map(function (f, i) {
            return '<div class="fl-row">' +
              '<input class="input" data-fi="' + i + '" data-k="if" placeholder="멤버 답: 말할 거예요" value="' + esc(f.if) + '">' +
              '<span class="fl-arrow">→</span>' +
              '<input class="input" data-fi="' + i + '" data-k="then" placeholder="되묻기: 친구가 서운해하면요?" value="' + esc(f.then) + '">' +
              (d.follow.length > 1 ? '<button type="button" class="del" data-fdel="' + i + '" aria-label="꼬리 질문 빼기">×</button>' : '') +
              '</div>';
          }).join('') +
          '<button type="button" class="ghost-sm wide" data-fadd="1">+ 꼬리 질문 추가</button></div>';
      }
      return h + '</section>';
    }).join('');

    var body = el('pp-body');
    function noOf(node) { return +node.closest('.pq').dataset.no; }
    Array.prototype.forEach.call(body.querySelectorAll('[data-pick]'), function (b) {
      b.addEventListener('click', function () {
        var no = +b.dataset.pick, at = pp.sel.indexOf(no);
        el('pp-err').hidden = true;
        if (at !== -1) pp.sel.splice(at, 1);
        else if (pp.sel.length >= 2) {
          el('pp-err').textContent = '2개만 고를 수 있어요. 고른 질문을 하나 빼고 골라주세요';
          el('pp-err').hidden = false;
          return;
        } else {
          pp.sel.push(no);
          pp.data[no] = pp.data[no] || blankPrep();
        }
        saveDraft(); renderPrep();
      });
    });
    Array.prototype.forEach.call(body.querySelectorAll('textarea[data-f]'), function (n) {
      n.addEventListener('input', function () { pp.data[noOf(n)][n.dataset.f] = n.value; saveDraft(); });
    });
    Array.prototype.forEach.call(body.querySelectorAll('input[data-fi]'), function (n) {
      n.addEventListener('input', function () { pp.data[noOf(n)].follow[+n.dataset.fi][n.dataset.k] = n.value; saveDraft(); });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-fadd]'), function (b) {
      b.addEventListener('click', function () { pp.data[noOf(b)].follow.push({ if: '', then: '' }); saveDraft(); renderPrep(); });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-fdel]'), function (b) {
      b.addEventListener('click', function () { pp.data[noOf(b)].follow.splice(+b.dataset.fdel, 1); saveDraft(); renderPrep(); });
    });
  }

  el('pp-go').addEventListener('click', function () {
    if (!pp) return;
    var err = el('pp-err'), btn = el('pp-go');
    function stop(m) { err.textContent = m; err.hidden = false; }
    if (pp.sel.length !== 2) return stop('질문을 2개 골라주세요 (지금 ' + pp.sel.length + '개)');
    var items = [];
    for (var i = 0; i < pp.sel.length; i++) {
      var no = pp.sel[i], d = pp.data[no];
      var follow = d.follow.map(function (f) { return { if: f.if.trim(), then: f.then.trim() }; })
                           .filter(function (f) { return f.if && f.then; });
      if (d.thought.trim().length < 5) return stop('Q' + no + ' 내 생각을 조금 더 적어주세요');
      if (d.ask.trim().length < 5) return stop('Q' + no + ' 멤버에게 던질 질문을 적어주세요');
      if (!follow.length) return stop('Q' + no + ' 꼬리 질문을 하나 이상, 양쪽 칸 다 적어주세요');
      items.push({ no: no, thought: d.thought.trim(), ask: d.ask.trim(), follow: follow });
    }
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.textContent = '제출하는 중…'; err.hidden = true;
    var topic = pp.topic, week = tp.week;
    call({ action: 'prepSave', week: week, topic: topic, name: me, items: items }).then(function (d) {
      delete btn.dataset.busy; btn.textContent = '수정해서 다시 제출';
      try { localStorage.removeItem(draftKey(topic)); } catch (e) {}
      if (week === tp.recWeek) {
        tp.preps = tp.preps.filter(function (p) { return !(p.name === me && p.topic === topic); })
                           .concat([{ name: me, topic: topic, count: 2, saved_at: d.saved.saved_at }]);
      }
      renderTopic(); renderNudge();
      toast('토론 준비를 제출했습니다');
      openView(topic);                       /* 제출하자마자 다른 리더들의 준비를 보여준다 */
    }).catch(function (e) { delete btn.dataset.busy; btn.textContent = '제출하기'; showError(e); });
  });

  /* ── 준비 모아보기: 질문별로, 이번 주 먼저 · 지난 준비도 함께 ── */
  function openView(num) {
    var t = topicOf(num);
    if (!t) return;
    el('prep-wrap').hidden = true; pp = null;
    el('pv-wrap').hidden = false;
    el('pv-title').textContent = t.num + '. ' + t.title;
    el('pv-body').innerHTML = '<p class="empty">불러오는 중…</p>';
    Promise.all([loadQuestions(num), call({ action: 'prepView', week: tp.week, topic: num, name: me })])
      .then(function (r) {
        var qs = r[0], preps = r[1].preps || [];
        if (!preps.length) { el('pv-body').innerHTML = '<p class="empty">아직 제출된 준비가 없습니다.</p>'; return; }
        el('pv-body').innerHTML = qs.map(function (q) {
          var list = preps.filter(function (p) { return p.no === q.no; });
          if (!list.length) return '';
          list.sort(function (a, b) {
            if (a.week !== b.week) return a.week < b.week ? 1 : -1;
            return a.name === me ? -1 : b.name === me ? 1 : (a.name < b.name ? -1 : 1);
          });
          return '<section class="pv-q"><p class="pv-qt"><span class="num">Q' + q.no + '</span> ' + esc(q.kr) + '</p>' +
            list.map(function (p) {
              return '<div class="pv-item' + (p.name === me ? ' is-me' : '') + '">' +
                '<p class="pv-who">' + esc(p.name) + (p.name === me ? ' <span class="dim">(나)</span>' : '') +
                (p.week !== tp.week ? '<span class="pv-wk">' + md(p.week) + ' 주 준비</span>' : '') + '</p>' +
                '<p><b>생각</b>' + esc(p.thought) + '</p>' +
                '<p><b>던질 질문</b>' + esc(p.ask) + '</p>' +
                p.follow.map(function (f) {
                  return '<p class="pv-f"><b>꼬리</b>' + (f.if ? '“' + esc(f.if) + '” → ' : '') + esc(f.then) + '</p>';
                }).join('') + '</div>';
            }).join('') + '</section>';
        }).join('');
      }).catch(function (e) {
        var m = (e && e.message) || '';
        el('pv-body').innerHTML = '<p class="empty">' +
          (m.indexOf('먼저 제출') !== -1 ? '내 준비를 먼저 제출하면 다른 리더들의 준비를 볼 수 있어요.' : '불러오지 못했습니다.') + '</p>';
      });
  }

  el('qz-next').addEventListener('click', function () { if (qz) openPrep(qz.topic); });

  /* ── 주제 올리기 (관리자) ── */
  var pk = null;
  function openPick() {
    var w = weekOf(tp.week);
    pk = { week: tp.week, slot: 0, sel: [(w && w.t1) || null, (w && w.t2) || null] };
    if (pk.sel[0] && !pk.sel[1]) pk.slot = 1;
    el('pick-wrap').hidden = false;
    el('pk-week').textContent = weekLabel(tp.week) + (weekTag(tp.week) ? ' · ' + weekTag(tp.week) : '');
    el('pk-q').value = '';
    el('pk-err').hidden = true;
    el('pk-notice').hidden = true;
    el('pk-save').hidden = false;
    renderPick();
  }
  function lastUsed(num) {
    var best = null;
    tp.weeks.forEach(function (w) {
      if (w.week !== pk.week && (w.t1 === num || w.t2 === num) && (!best || w.week > best)) best = w.week;
    });
    return best;
  }
  function renderPick() {
    SLOTS.forEach(function (s, i) {
      var b = el('pk-slot' + i), t = topicOf(pk.sel[i]);
      b.classList.toggle('is-on', pk.slot === i);
      b.innerHTML = '<span class="pk-sl">' + s.label + ' · ' + s.days + '</span>' +
                    '<span class="pk-sv">' + (t ? t.num + '. ' + esc(t.title) : '아래에서 고르세요') + '</span>';
    });
    var q = el('pk-q').value.trim();
    var list = tp.topics.filter(function (t) {
      if (!q) return true;
      if (/^\d+$/.test(q)) return String(t.num).indexOf(q) === 0;
      return t.title.replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) !== -1;
    });
    el('pk-list').innerHTML = list.map(function (t) {
      var on = pk.sel.indexOf(t.num), used = lastUsed(t.num);
      return '<button type="button" class="pk-row' + (on !== -1 ? ' is-sel' : '') + '" data-n="' + t.num + '">' +
        '<span class="pk-n num">' + t.num + '</span><span class="pk-t">' + esc(t.title) + '</span>' +
        (on !== -1 ? '<span class="pk-tag on">' + SLOTS[on].label + '</span>'
          : used ? '<span class="pk-tag">' + md(used) + ' 주에 함</span>' : '') +
        (t.quiz ? '' : '<span class="pk-tag warn">퀴즈 없음</span>') + '</button>';
    }).join('') || '<p class="empty">찾는 주제가 없습니다.</p>';
    Array.prototype.forEach.call(el('pk-list').querySelectorAll('.pk-row'), function (b) {
      b.addEventListener('click', function () {
        var n = +b.dataset.n, other = 1 - pk.slot;
        if (pk.sel[other] === n) pk.sel[other] = null;          /* 같은 주제를 두 칸에 넣지 않게 */
        pk.sel[pk.slot] = n;
        if (!pk.sel[other]) pk.slot = other;                    /* 빈 칸으로 자동 이동 */
        el('pk-err').hidden = true;
        el('pk-notice').hidden = true; el('pk-save').hidden = false;
        renderPick();
      });
    });
  }
  SLOTS.forEach(function (_, i) {
    el('pk-slot' + i).addEventListener('click', function () { pk.slot = i; renderPick(); });
  });
  el('pk-q').addEventListener('input', function () { if (pk) renderPick(); });

  function noticeText(week, a, b) {
    var s = parseYmd(week), e = parseYmd(addDays(week, 6));
    return '[더박스 주제] ' + (s.getMonth() + 1) + '/' + s.getDate() + '(월) ~ ' + (e.getMonth() + 1) + '/' + e.getDate() + '(일)\n\n' +
      '주제 1 · 월 화 토\n' + a.num + '. ' + a.title + '\n\n' +
      '주제 2 · 수 목 일\n' + b.num + '. ' + b.title + '\n\n' +
      '리더·대타 모두 PDF 앞뒤를 읽고 숙지 퀴즈까지 풀어주세요.\n' +
      '주제 1은 월요일, 주제 2는 수요일 수업 전까지입니다.\n\n' +
      location.origin + location.pathname + '#topic';
  }

  el('pk-save').addEventListener('click', function () {
    if (!pk.sel[0] || !pk.sel[1]) {
      el('pk-err').textContent = (!pk.sel[0] ? '주제 1' : '주제 2') + '을 골라주세요';
      el('pk-err').hidden = false;
      return;
    }
    var btn = el('pk-save');
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.textContent = '올리는 중…';
    call({ action: 'setWeek', week: pk.week, t1: pk.sel[0], t2: pk.sel[1], by: me }).then(function () {
      delete btn.dataset.busy; btn.textContent = '이 주제로 올리기';
      tp.weeks = tp.weeks.filter(function (w) { return w.week !== pk.week; })
                         .concat([{ week: pk.week, t1: pk.sel[0], t2: pk.sel[1], set_by: me }]);
      btn.hidden = true;
      el('pk-text').value = noticeText(pk.week, topicOf(pk.sel[0]), topicOf(pk.sel[1]));
      el('pk-notice').hidden = false;
      el('pk-notice').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('올렸습니다. 이제 스태프 모두에게 보입니다');
      renderTopic(); renderNudge();
    }).catch(function (e) { delete btn.dataset.busy; btn.textContent = '이 주제로 올리기'; showError(e); });
  });

  el('pk-copy').addEventListener('click', function () {
    var ta = el('pk-text'), txt = ta.value;
    function fallback() { ta.focus(); ta.select(); toast('선택해 뒀어요. 길게 눌러 복사하세요'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('복사했습니다. 단톡방에 붙여넣으세요'); }, fallback);
    } else fallback();
  });

  el('tp-admin').addEventListener('click', openPick);
  el('wk-prev').addEventListener('click', function () { tp.week = addDays(tp.week, -7); tp.moved = true; renderTopic(); loadStatus(); });
  el('wk-next').addEventListener('click', function () { tp.week = addDays(tp.week, 7); tp.moved = true; renderTopic(); loadStatus(); });
  el('nudge').addEventListener('click', function () { switchTab('topic'); });

  /* ───────── wiring ───────── */
  el('prev-m').addEventListener('click', function () {
    view.m--; if (view.m < 0) { view.m = 11; view.y--; } loadMonth();
  });
  el('next-m').addEventListener('click', function () {
    view.m++; if (view.m > 11) { view.m = 0; view.y++; } loadMonth();
  });
  el('today-btn').addEventListener('click', function () {
    var t = new Date(); view.y = t.getFullYear(); view.m = t.getMonth(); loadMonth();
  });
  el('fab').addEventListener('click', function () { openForm(null); });
  el('sheet-add').addEventListener('click', function () {
    var d = sheetDate;          /* closeSheet()가 비우기 전에 붙잡아 둔다 */
    closeSheet();
    openForm(d);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (n) {
    n.addEventListener('click', function () {
      el('sheet-wrap').hidden = true; el('form-wrap').hidden = true; el('who-wrap').hidden = true;
      el('quiz-wrap').hidden = true; el('pick-wrap').hidden = true; el('prep-wrap').hidden = true; el('pv-wrap').hidden = true;
      sheetDate = null; qz = null; pp = null;
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      el('sheet-wrap').hidden = true; el('form-wrap').hidden = true; el('who-wrap').hidden = true;
      el('quiz-wrap').hidden = true; el('pick-wrap').hidden = true; el('prep-wrap').hidden = true; el('pv-wrap').hidden = true;
      qz = null; pp = null;
    }
  });

  function switchTab(on) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
      x.classList.toggle('is-on', x.dataset.tab === on);
    });
    el('tab-cal').hidden = on !== 'cal';
    el('tab-topic').hidden = on !== 'topic';
    el('tab-mine').hidden = on !== 'mine';
    el('fab').style.display = on === 'cal' ? '' : 'none';
    if (on === 'mine') renderMine();
    if (on === 'topic') { if (tp.state === 'ok') { renderTopic(); loadStatus(); } else loadTopic(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });

  function showError(e) {
    console.error(e);
    var m = (e && e.message) ? e.message : '';
    if (m.indexOf('알 수 없는 요청') !== -1) {
      toast('시트 스크립트가 예전 버전입니다. Apps Script에서 다시 배포해 주세요.');
      return;
    }
    /* 여러 명이 동시에 쓰면 시트 잠금이 밀린다. 데이터는 안전하니 다시 누르면 된다. */
    if (m.indexOf('잠금') !== -1 || m.toLowerCase().indexOf('lock') !== -1 || m.indexOf('시간초과') !== -1) {
      toast('시트가 잠깐 바빴습니다. 다시 한 번 눌러주세요.');
      return;
    }
    if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1) {
      toast('연결이 끊겼습니다. 인터넷을 확인하고 다시 시도해 주세요.');
      return;
    }
    toast('문제가 생겼습니다 — ' + (m ? m.slice(0, 80) : '알 수 없는 오류'));
  }

  /* 로컬 모드 안내 */
  if (!REMOTE) {
    var b = el('banner');
    b.hidden = false;
    b.textContent = '지금은 이 기기에만 저장됩니다 — 다른 사람에게는 보이지 않아요. (구글 시트 연결 전)';
  }

  /* 다른 사람이 올리거나 확정한 걸 반영 */
  function refresh() {
    if (!me || document.hidden || busy) return;
    loadMonth();
    if (!el('tab-mine').hidden) renderMine();
    if (!el('tab-topic').hidden && tp.state === 'ok' && el('quiz-wrap').hidden && el('prep-wrap').hidden) loadStatus();
  }
  if (REMOTE) {
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refresh();
    });
  }

  /* 부팅 */
  var saved = localStorage.getItem(LS_ME);
  if (saved) {
    setMe(saved);
  } else {
    showLogin();
  }
})();
