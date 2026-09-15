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
  /* 알림은 화면 위쪽에 — 아래쪽 버튼·입력칸을 가리지 않게. 누르면 바로 닫힌다 */
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg; t.hidden = false;
    t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2400);
  }
  /* 불러오는 동안 보여줄 회색 틀 */
  function skel(kind) {
    if (kind === 'topic') return '<div class="sk-wrap"><div class="sk sk-card sm"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>';
    return '<div class="sk-wrap"><div class="sk sk-line w60"></div><div class="sk sk-block"></div><div class="sk sk-line"></div><div class="sk sk-line w80"></div><div class="sk sk-block"></div></div>';
  }
  function reduced() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
  /* 끝냈을 때 작은 축하: 색종이 조각이 퍼졌다 사라진다 */
  function celebrate(anchor) {
    if (reduced()) return;
    var r = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
    var box = document.createElement('div'), cols = ['#D3202F', '#0C7355', '#1E4FA6', '#E0A100', '#14171C'];
    box.className = 'confetti';
    box.style.left = (r.left + r.width / 2) + 'px'; box.style.top = (r.top + r.height / 2) + 'px';
    for (var i = 0; i < 26; i++) {
      var p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
      p.style.setProperty('--x', Math.round(Math.cos(a) * d) + 'px');
      p.style.setProperty('--y', Math.round(Math.sin(a) * d - 40) + 'px');
      p.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
      p.style.background = cols[i % cols.length];
      p.style.animationDelay = Math.round(Math.random() * 60) + 'ms';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 1300);
    if (navigator.vibrate) try { navigator.vibrate([12, 40, 12]); } catch (e) {}
  }
  var CHECK = '<svg class="ok-mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>';
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
    moveInk();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);
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
     스태프 전원이 PDF 앞뒤를 읽고 6문제를 풀어 "숙지 완료"를 받는다. */
  var ADMINS = Array.isArray(CFG.ADMINS) ? CFG.ADMINS : ['한남'];
  var SLOTS = [
    { key: 't1', label: '주제 1', days: '월 · 화 · 토' },
    { key: 't2', label: '주제 2', days: '수 · 목 · 일' }
  ];
  var tp = { state: 'idle', err: '', topics: [], weeks: [], recs: [], preps: [], recWeek: null,
             week: null, moved: false, quizCache: {}, qnCache: {}, pending: null, v: 0,
             leads: [], prepMin: 0, streaks: null, flash: null };
  function prepMax() { return tp.v >= 5 ? 99 : 2; }   /* 옛 시트 스크립트는 정확히 2개만 받는다 */

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
  /* 이번 주 내가 진행하는 주제 (0 = 아직 안 고름, -1 = 진행 안 함) */
  function leadKey() { return 'thebox.lead.' + tp.week + '.' + me; }
  function leadOf(name) {
    for (var i = 0; i < tp.leads.length; i++) if (tp.leads[i].name === name) return +tp.leads[i].topic || 0;
    if (name === me) { try { return +localStorage.getItem(leadKey()) || 0; } catch (e) {} }
    return 0;
  }
  function setMyLead(num) {
    try { localStorage.setItem(leadKey(), String(num)); } catch (e) {}
    tp.leads = tp.leads.filter(function (l) { return l.name !== me; }).concat([{ name: me, topic: num }]);
    saveCache(tp.week); renderTopic(); renderNudge();
    if (tp.v >= 6) call({ action: 'setLead', week: tp.week, name: me, topic: num }).catch(showError);
  }
  /* 완료 = 퀴즈 통과 + (내가 진행하는 주제라면) 토론 준비 */
  function progress(name, topic) {
    var r = recOf(name, topic), p = prepOf(name, topic);
    var quiz = !!(r && r.passed);
    var prep = !!(p && (p.thoughts != null && tp.v >= 7
      ? p.thoughts >= (tp.thinkMin || 3)
      : p.count >= (tp.prepMin || 1)));
    var lead = leadOf(name) === +topic;
    return { rec: r, prep: p, quiz: quiz, prepDone: prep, lead: lead, done: quiz && (!lead || prep) };
  }
  function fmtWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ── 불러오기 ──
     시트 스크립트는 부를 때마다 2~4초가 든다. 그래서
     1) 새 스크립트면 탭에 필요한 것(이번 주 퀴즈·토론 질문 포함)을 한 번에 받고
     2) 받은 내용을 폰에 저장해 두었다가 다음에 열 때 먼저 보여준 뒤 뒤에서 새로 받는다 */
  var TP_CACHE = 'thebox.tp.v1';
  function cacheAll() {
    try { return JSON.parse(localStorage.getItem(TP_CACHE) || 'null') || { weeks: {} }; } catch (e) { return { weeks: {} }; }
  }
  function readCache(week) { var c = cacheAll().weeks[week]; return c ? c.d : null; }
  function saveCache(week) {
    var w = weekOf(week), quiz = {}, questions = {};
    if (w) [w.t1, w.t2].forEach(function (n) {
      if (n && tp.quizCache[n]) quiz[n] = tp.quizCache[n];
      if (n && tp.qnCache[n]) questions[n] = tp.qnCache[n];
    });
    var c = cacheAll();
    c.weeks[week] = { at: Date.now(), d: { v: tp.v, topics: tp.topics, weeks: tp.weeks, records: tp.recs,
                                            preps: tp.preps, staff: staff, quiz: quiz, questions: questions,
                                            leads: tp.leads, prepMin: tp.prepMin, thinkMin: tp.thinkMin, streaks: tp.streaks } };
    Object.keys(c.weeks).sort().slice(0, -4).forEach(function (k) { delete c.weeks[k]; });   /* 최근 4주만 */
    try { localStorage.setItem(TP_CACHE, JSON.stringify(c)); } catch (e) {}
  }
  function applyBoot(d, week) {
    if (d.topics && d.topics.length) tp.topics = d.topics;
    tp.weeks = d.weeks || [];
    tp.recs = d.records || []; tp.preps = d.preps || []; tp.recWeek = week;
    if (d.staff && d.staff.length) staff = d.staff;
    if (d.v) tp.v = d.v;
    tp.leads = d.leads || tp.leads.filter(function (l) { return l.name === me; });
    tp.prepMin = d.prepMin || (tp.v >= 6 ? 1 : 2);
    tp.thinkMin = d.thinkMin || 0;
    tp.streaks = d.streaks || null;          /* v9부터: 이름별 연속 완료 주 */
    Object.keys(d.quiz || {}).forEach(function (k) { tp.quizCache[k] = d.quiz[k]; });
    Object.keys(d.questions || {}).forEach(function (k) { tp.qnCache[k] = d.questions[k]; });
    tp.state = 'ok';
  }

  /* 시트 스크립트가 아직 토론 준비를 모르는 버전이어도 퀴즈는 그대로 돌게 */
  function prepStatusSafe(week) {
    return call({ action: 'prepStatus', week: week }).catch(function () { return { preps: [] }; });
  }
  /* 새 스크립트면 한 번에(boot), 옛 스크립트면 예전처럼 여러 번 나눠 부른다 */
  function fetchBoot(week) {
    return call({ action: 'boot', week: week }).catch(function (e) {
      if (((e && e.message) || '').indexOf('알 수 없는 요청') === -1) throw e;
      return Promise.all([
        tp.topics.length ? { topics: tp.topics } : call({ action: 'topics' }),
        call({ action: 'weeks' }), call({ action: 'quizStatus', week: week }),
        db.listStaff(), prepStatusSafe(week)
      ]).then(function (r) {
        return { v: 4, topics: r[0].topics, weeks: r[1].weeks, records: r[2].records, staff: r[3], preps: r[4].preps };
      });
    });
  }

  /* 일요일엔 다음 주 준비가 급하다. 관리자는 다음 주를 올려야 하니 바로 다음 주로,
     스태프는 다음 주 주제가 올라와 있을 때만 다음 주로 보여준다 */
  function startWeek() {
    var k = mondayKey(new Date()), next = addDays(k, 7);
    if (new Date().getDay() !== 0) return k;
    if (isAdmin()) return next;
    var known = [].concat.apply([], Object.keys(cacheAll().weeks).map(function (w) {
      var d = readCache(w); return (d && d.weeks) || [];
    }));
    return known.some(function (w) { return w.week === next; }) ? next : k;
  }

  function loadTopic() {
    if (!REMOTE) { tp.state = 'local'; renderTopic(); return Promise.resolve(); }
    if (!me) return Promise.resolve();
    if (tp.pending) return tp.pending;
    if (!tp.week) { tp.week = startWeek(); }
    var week = tp.week;
    if (tp.state !== 'ok') {
      var cached = readCache(week);
      if (cached) { applyBoot(cached, week); renderTopic(); renderNudge(); }
      else renderTopic();                            /* 처음 여는 폰: 회색 틀부터 */
    }
    tp.pending = fetchBoot(week).then(function (d) {
      if (week !== tp.week) return;
      applyBoot(d, week); saveCache(week);
      var next = addDays(mondayKey(new Date()), 7);
      if (!tp.moved && new Date().getDay() === 0 && week !== next && weekOf(next)) {
        tp.moved = true; tp.week = next;
        return loadStatus();
      }
    }).catch(function (e) {
      if (tp.state === 'ok') return;                 /* 저장해 둔 내용이 보이는 중이면 그대로 둔다 */
      var m = (e && e.message) || '';
      tp.state = m.indexOf('알 수 없는 요청') !== -1 ? 'old'
               : (m.indexOf('주제 목록') !== -1 || m.indexOf('폴더') !== -1) ? 'nofolder' : 'error';
      tp.err = m;
    }).then(function () { tp.pending = null; renderTopic(); renderNudge(); });
    return tp.pending;
  }

  function loadStatus() {
    var week = tp.week;
    if (tp.recWeek !== week) {
      var cached = readCache(week);
      if (cached) { applyBoot(cached, week); renderTopic(); renderNudge(); }
    }
    return fetchBoot(week).then(function (d) {
      if (week !== tp.week) return;
      applyBoot(d, week); saveCache(week);
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
      idle: ''
    }[tp.state];
    if (tp.state === 'idle') { box.innerHTML = skel('topic'); box.dataset.sk = '1'; return; }
    if (msg) { box.innerHTML = '<p class="empty">' + msg + '</p>'; return; }

    var w = weekOf(tp.week);
    box.innerHTML = weekBar(w) + leadPicker(w) + SLOTS.map(function (s) { return topicCard(s, w && w[s.key]); }).join('') + statusTable(w);
    if (box.dataset.sk) { delete box.dataset.sk; box.classList.remove('fade-in'); void box.offsetWidth; box.classList.add('fade-in'); }
    if (tp.flash && Date.now() - tp.flash.at > 4000) tp.flash = null;
    Array.prototype.forEach.call(box.querySelectorAll('[data-lead]'), function (b) {
      b.addEventListener('click', function () {
        var n = +b.dataset.lead;
        setMyLead(leadOf(me) === n ? 0 : n);
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-card]'), function (b) {
      b.addEventListener('click', function () { openCard(+b.dataset.card); });
    });
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

  /* 이번 주 내 할 일: 퀴즈 두 개 + 진행 주제 고르기 (+ 진행하면 토론 준비). 칸이 하나씩 찬다 */
  function weekSteps(w) {
    var out = [];
    SLOTS.forEach(function (s) { if (w[s.key]) out.push({ l: s.label + ' 퀴즈', ok: progress(me, w[s.key]).quiz }); });
    var lead = leadOf(me);
    out.push({ l: '진행 주제', ok: lead !== 0 });
    if (lead > 0) out.push({ l: '토론 준비', ok: progress(me, lead).prepDone });
    return out;
  }
  function streakChip(n, big) {
    if (!n) return '';
    return '<span class="streak' + (big ? ' big' : '') + '" title="두 주제 퀴즈를 모두 끝낸 주가 ' + n + '주 이어졌어요">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8.6 1.2c.3 2.1-.6 3.3-1.6 4.4C6 6.7 5 7.8 5 9.7 5 11.5 6.3 13 8 13s3-1.4 3-3.1c0-1-.4-1.8-.9-2.4.9.3 1.6 1 2 1.9.3-1.2.1-2.6-.6-3.9-.6-1.2-1.6-2.3-2.9-4.3z"/></svg>' +
      n + '주 연속</span>';
  }
  function weekBar(w) {
    if (!w || (!w.t1 && !w.t2) || !me) return '';
    var st = weekSteps(w), k = st.filter(function (x) { return x.ok; }).length, all = k === st.length;
    var n = tp.streaks ? (tp.streaks[me] || 0) : 0;
    return '<section class="wb' + (all ? ' is-all' : '') + '"><div class="wb-top"><b>' + (all ? '이번 주 할 일 끝' : '이번 주 내 할 일') + '</b>' +
      '<span class="wb-n num">' + k + ' / ' + st.length + '</span>' + streakChip(n, true) + '</div>' +
      '<div class="wb-bar">' + st.map(function (x) { return '<i class="' + (x.ok ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="wb-l">' + st.map(function (x) { return '<span class="' + (x.ok ? 'on' : '') + '">' + x.l + '</span>'; }).join('') + '</div></section>';
  }

  function leadPicker(w) {
    if (!w || (!w.t1 && !w.t2)) return '';
    var mine = leadOf(me);
    return '<section class="lead"><p class="lead-t">이번 주 내가 진행하는 주제</p><div class="lead-pills">' +
      SLOTS.map(function (s) {
        var n = w[s.key];
        if (!n) return '';
        return '<button type="button" class="lead-pill' + (mine === n ? ' is-on' : '') + '" data-lead="' + n + '">' +
               s.label + ' · ' + s.days.replace(/ · /g, ' ') + '</button>';
      }).join('') +
      '<button type="button" class="lead-pill' + (mine === -1 ? ' is-on' : '') + '" data-lead="-1">이번 주 진행 안 함</button></div>' +
      '<p class="lead-note">토론 준비는 진행하는 주제만 하면 돼요. 대타로 들어가게 되면 그 주제도 준비하면 됩니다.</p></section>';
  }

  function myBadge(g) {
    if (g.done) return '<span class="badge mat">완료</span>';
    if (g.quiz && g.lead) return '<span class="badge warn">토론 준비 남음</span>';
    return '<span class="badge ok">' + (g.rec ? '퀴즈 푸는 중' : '아직 안 함') + '</span>';
  }

  function stepRow(n, label, mins, right, ok, off, fresh) {
    return '<div class="stp' + (off ? ' is-off' : '') + '"><span class="stp-n' + (ok ? ' ok' : '') + (ok && fresh ? ' fresh' : '') + '">' + (ok ? '✓' : n) + '</span>' +
      '<span class="stp-l">' + label + (mins ? '<span class="stp-m">' + mins + '</span>' : '') + '</span>' + right + '</div>';
  }

  function isFresh(num, kind) { return !!(tp.flash && tp.flash.topic === num && tp.flash.kind === kind && Date.now() - tp.flash.at < 4000); }
  function topicCard(s, num) {
    var t = num ? topicOf(num) : null;
    var head = '<div class="tc-top"><span class="tc-slot">' + s.label + '<span class="dim"> · ' + s.days + '</span>' +
               (t && leadOf(me) === t.num ? '<span class="tc-mine">내가 진행</span>' : '') + '</span>';
    if (!t) {
      return '<article class="tc tc-empty">' + head + '</div><p class="tc-none">' +
        (num ? num + '번 PDF를 찾지 못했습니다.' : '아직 주제가 올라오지 않았어요.') + '</p></article>';
    }
    var g = progress(me, t.num), r = g.rec, lead = leadOf(me);
    var s1 = stepRow(1, 'PDF 앞뒤 읽기', '약 5분',
      '<a class="stp-a" href="' + pdfUrl(t) + '" target="_blank" rel="noopener">PDF 보기</a>', g.quiz, false, isFresh(t.num, 'quiz'));
    var s2 = stepRow(2, '숙지 퀴즈 6문제', '약 2분',
      g.quiz ? '<span class="stp-done">완료 · 첫 시도 ' + r.first_score + '/' + r.total + '</span>'
             : t.quiz ? '<button class="stp-a red" type="button" data-quiz="' + t.num + '">' + (r ? '이어서 풀기' : '풀기') + '</button>'
                      : '<span class="stp-off">퀴즈 준비 중</span>', g.quiz, false, isFresh(t.num, 'quiz'));
    var s3;
    if (g.lead) {
      s3 = stepRow(3, '토론 준비 · 영어로', '약 5분',
        g.prepDone ? '<span class="stp-pair"><button class="stp-a red" type="button" data-card="' + t.num + '">진행 카드</button>' +
                     '<button class="stp-a" type="button" data-prep="' + t.num + '">수정</button></span>'
                   : '<button class="stp-a red" type="button" data-prep="' + t.num + '">준비하기</button>', g.prepDone, false, isFresh(t.num, 'prep'));
    } else if (lead === 0) {
      s3 = stepRow(3, '토론 준비', '', '<span class="stp-off">위에서 진행 주제를 고르면 열려요</span>', false, true);
    } else {
      s3 = stepRow(3, '토론 준비', '', g.prepDone
        ? '<button class="stp-a" type="button" data-card="' + t.num + '">진행 카드</button>'
        : '<button class="stp-link" type="button" data-prep="' + t.num + '">진행 주제가 아니라 안 해도 돼요 · 대타면 준비</button>', g.prepDone, !g.prepDone);
    }
    var view = (g.prepDone || isAdmin())
      ? '<button class="tc-link" type="button" data-view="' + t.num + '">다른 리더들의 준비 보기 ›</button>' : '';
    return '<article class="tc' + (g.done ? ' tc-done' : '') + '">' + head + myBadge(g) + '</div>' +
      '<h3 class="tc-title"><span class="tc-num num">' + t.num + '</span>' + esc(t.title) + '</h3>' +
      '<div class="stps">' + s1 + s2 + s3 + '</div>' + view + '</article>';
  }

  function statusTable(w) {
    if (!w || (!w.t1 && !w.t2)) return '';
    if (tp.recWeek !== tp.week) return '<section class="st"><div class="sk sk-line w60"></div><div class="sk sk-block"></div></section>';
    var names = staff.slice().sort();
    function quizCell(x, n) {
      if (!n) return '<td class="c-na">—</td>';
      var r = recOf(x, n);
      if (r && r.passed) return '<td class="c-done">완료 <span class="num">' + r.first_score + '/' + r.total + '</span><small>' + fmtWhen(r.passed_at) + '</small></td>';
      if (r) return '<td class="c-try">푸는 중</td>';
      return '<td class="c-wait">아직</td>';
    }
    var leadCount = 0, prepCount = 0;
    var rows = names.map(function (x) {
      var lead = leadOf(x), slot = SLOTS.filter(function (s) { return w[s.key] === lead; })[0];
      var leadTd = slot ? '<td>' + slot.label + '</td>' : lead === -1 ? '<td class="c-wait">안 함</td>' : '<td class="c-wait">미선택</td>';
      var prepTd;
      if (slot) {
        leadCount++;
        var p = prepOf(x, lead), ok = progress(x, lead).prepDone;
        if (ok) prepCount++;
        prepTd = ok ? '<td class="c-done">완료' + (p.thoughts != null ? '<small>내 생각 ' + p.thoughts + '개</small>' : '') +
                      '<small>' + fmtWhen(p.saved_at) + '</small></td>' : '<td class="c-wait">아직</td>';
      } else prepTd = '<td class="c-na">—</td>';
      return '<tr' + (x === me ? ' class="me-row"' : '') + '><th>' + esc(x) + (tp.streaks ? streakChip(tp.streaks[x] || 0) : '') + '</th>' + leadTd +
             quizCell(x, w.t1) + quizCell(x, w.t2) + prepTd + '</tr>';
    }).join('');
    var sum = SLOTS.map(function (s) {
      var n = w[s.key];
      if (!n) return '';
      var done = names.filter(function (x) { var r = recOf(x, n); return r && r.passed; }).length;
      return s.label + ' 퀴즈 ' + done + '/' + names.length;
    }).filter(Boolean).join(' · ') + ' · 토론 준비 ' + prepCount + '/' + leadCount;
    return '<section class="st"><div class="mlist-h"><b>숙지 · 준비 현황</b><span class="num">' + sum + '</span></div>' +
      '<div class="tbl-scroll"><table class="st-t"><thead><tr><th></th><th>진행</th>' +
      SLOTS.map(function (s) {
        var t = topicOf(w[s.key]);
        return '<th>' + s.label + ' 퀴즈' + (t ? '<small>' + t.num + '번</small>' : '') + '</th>';
      }).join('') + '<th>토론 준비<small>진행 주제</small></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">퀴즈 숫자는 첫 시도 점수, 아래는 끝낸 시각입니다. 토론 준비는 각자 진행하는 주제만 봅니다.</p></section>';
  }

  /* 달력 위에 뜨는 알림: 이번 주 주제에서 남은 단계가 있으면 */
  function renderNudge() {
    var n = el('nudge');
    var w = tp.state === 'ok' && me ? weekOf(tp.week) : null;
    var left = [];
    if (w) {
      SLOTS.forEach(function (s) { var num = w[s.key]; if (num && !progress(me, num).quiz) left.push(s.label + ' 퀴즈'); });
      var lead = leadOf(me);
      if (lead === 0 && (w.t1 || w.t2)) left.push('진행 주제 고르기');
      else if (lead > 0 && !progress(me, lead).prepDone) left.push('토론 준비');
    }
    if (!left.length) { n.hidden = true; return; }
    n.hidden = false;
    n.innerHTML = '<span>' + (weekTag(tp.week) || weekLabel(tp.week)) + ' 주제 · 남은 것: ' + left.join(', ') +
                  '</span><span class="nudge-go">하러 가기 ›</span>';
  }

  /* ── 퀴즈 ── */
  var qz = null;
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* 내용 3 + 표현 9개 중 1 + 팝퀴즈 3개 중 2 = 6문제. 보기 순서는 매번 섞는다 */
  function buildItems(q) {
    function mk(kind, x) {
      var order = shuffle(x.options.map(function (_, i) { return i; }));
      return { kind: kind, q: x.q, where: x.where, answer: order.indexOf(x.answer),
               options: order.map(function (i) { return x.options[i]; }), picked: null, wrong: null, done: false };
    }
    return [].concat(
      q.content.map(function (x) { return mk('뒷면 · 내용', x); }),
      shuffle(q.expr).slice(0, 1).map(function (x) { return mk('뒷면 · 표현', x); }),
      shuffle(q.pop).slice(0, 2).map(function (x) { return mk('앞면 · 팝퀴즈', x); })
    );
  }

  function openQuiz(num) {
    var t = topicOf(num);
    if (!t) return;
    el('quiz-wrap').hidden = false;
    el('qz-title').textContent = t.num + '. ' + t.title;
    el('qz-pdf').href = pdfUrl(t);
    el('qz-body').innerHTML = skel();
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
    if (passed) {
      res.innerHTML = CHECK + '<span><b>숙지 완료!</b><small>첫 시도 ' + qz.first + '/' + total + (qz.first === total ? ' · 한 번에 다 맞혔어요' : '') + '</small></span>';
      tp.flash = { topic: qz.topic, kind: 'quiz', at: Date.now() };
      setTimeout(function () { celebrate(res.querySelector('.ok-mark')); }, 250);
    } else res.textContent = right + '/' + total + ' · 틀린 ' + (total - right) + '개는 PDF를 다시 보고 골라주세요';
    el('qz-go').textContent = '다시 채점하기';
    el('qz-go').hidden = passed;
    el('qz-next').hidden = !(passed && leadOf(me) === qz.topic);
    if (passed) res.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
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
          saveCache(tp.recWeek);
        }
        renderTopic(); renderNudge();
      }).catch(function (e) { if (qz) qz.sending = false; showError(e); });
  });

  /* ── 토론 준비 (영어) ──
     진행하는 주제의 메인 질문을 하나씩 읽고 내 생각을 영어로 쓴다 (최소 3개) → 확인 → 제출 → 진행 카드.
     v7까지 있던 "이끌 질문 고르기 · 여는 질문 · 대화 잇기"는 뺐다. 주제를 잘 읽고 메인 질문에 내 답이 있으면
     꼬리 질문은 수업 중에 리더가 알아서 한다. 그때 제출된 여는 질문·꼬리 줄은 "다른 리더들의 준비 보기"에서만 읽는다.
     꼬리 줄은 시트에 {if, then}으로 저장돼 있다. 원어민·연결·(멤버 답 없는)되묻기는 if 자리에 [원어민]·[연결]·[되묻기]. */
  var pp = null;
  var LINE_T = { ask: '되묻기', native: '원어민에게', bridge: '멤버에게 연결' };
  var STARTERS = ["I'd probably ___ because ___.", 'Honestly, I think ___.', 'In my case, ___.',
                  "It depends. If ___, I'd ___.", 'I used to think ___, but now ___.'];
  function thinkMin() { return Math.max(tp.thinkMin || 3, 1); }
  function draftKey(topic) { return 'thebox.prep4.' + tp.week + '.' + topic + '.' + me; }
  function cardKey(topic) { return 'thebox.card.' + tp.week + '.' + topic + '.' + me; }
  function D(no) { return pp.data[no] || (pp.data[no] = { thought: '' }); }
  function hangulRatio(s) {
    var h = (s.match(/[가-힣]/g) || []).length, l = (s.match(/[A-Za-z]/g) || []).length;
    return h + l ? h / (h + l) : 0;
  }
  function isEnglish(s) { return hangulRatio(s) <= 0.3; }
  function words(s) { return (s.toLowerCase().match(/[a-z']+/g) || []); }
  function norm(s) { return words(s).join(' '); }
  function decodeLines(follow) {
    return (follow || []).map(function (f) {
      if (f.if === '[원어민]') return { t: 'native', a: '', b: f.then };
      if (f.if === '[연결]') return { t: 'bridge', a: '', b: f.then };
      if (f.if === '[되묻기]') return { t: 'ask', a: '', b: f.then };
      return { t: 'ask', a: f.if || '', b: f.then };
    });
  }
  function loadQuestions(topic) {
    return tp.qnCache[topic] ? Promise.resolve(tp.qnCache[topic])
      : call({ action: 'questions', topic: topic }).then(function (d) { return (tp.qnCache[topic] = d.questions || []); });
  }
  /* 주제지 문장: 퀴즈 표현 문제 보기에 그 주제의 단어 6개와 문장 3개가 들어 있다. 문장만 쓴다 */
  function topicSentences(topic) {
    var q = tp.quizCache[topic], seen = {}, out = [];
    ((q && q.expr) || []).forEach(function (x) {
      x.options.forEach(function (o) { if (o && words(o).length >= 5 && !seen[o]) { seen[o] = 1; out.push(o); } });
    });
    return out;
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey(pp.topic), JSON.stringify({ data: pp.data, step: pp.step, qi: pp.qi })); } catch (e) {}
  }
  function stopPrep(m) { el('pp-err').textContent = m; el('pp-err').hidden = false; }
  function answered() { return pp.qs.filter(function (q) { return D(q.no).thought.trim(); }); }

  /* 내 생각 한 칸 검사: 영어인지, 틀을 그대로 두지 않았는지, 질문을 베끼지 않았는지, 다른 답과 같지 않은지 */
  function checkThought(q) {
    var t = D(q.no).thought.trim();
    if (!t) return '';
    if (t.indexOf('___') !== -1) return 'Q' + q.no + ' 빈칸(___)을 채워주세요';
    if (!isEnglish(t)) return 'Q' + q.no + ' 내 생각을 영어로 적어주세요 — 한국어로 썼다면 "영어로 바꾸기"를 눌러주세요';
    if (words(t).length < 4) return 'Q' + q.no + ' 내 생각을 조금 더 적어주세요 (네 단어 이상)';
    var qw = {}, tw = words(t), same = 0;
    words(q.en || '').forEach(function (w) { qw[w] = 1; });
    tw.forEach(function (w) { if (qw[w]) same++; });
    if (tw.length && same / tw.length > 0.8) return 'Q' + q.no + ' 질문을 옮겨 적지 말고 내 생각을 적어주세요';
    var dup = pp.qs.filter(function (x) { return x.no !== q.no && norm(D(x.no).thought) === norm(t); })[0];
    if (dup) return 'Q' + q.no + '와 Q' + dup.no + '에 같은 문장이 있어요. 질문마다 따로 생각해 주세요';
    return '';
  }

  function openPrep(num) {
    var t = topicOf(num);
    if (!t) return;
    el('quiz-wrap').hidden = true; qz = null;
    el('card-wrap').hidden = true;
    el('prep-wrap').hidden = false;
    el('pp-title').textContent = t.num + '. ' + t.title;
    el('pp-steps').innerHTML = '';
    el('pp-body').innerHTML = skel();
    el('pp-err').hidden = true;
    pp = null;
    var mine = progress(me, num).prepDone;
    var needQuiz = tp.quizCache[num] ? null : call({ action: 'quiz', topic: num }).then(function (d) { tp.quizCache[num] = d.quiz; }).catch(function () {});
    Promise.all([loadQuestions(num), mine ? call({ action: 'prepView', week: tp.week, topic: num, name: me }).catch(function () { return null; }) : null, needQuiz])
      .then(function (r) {
        var qs = (r[0] || []).filter(function (q) { return q.no < 100; });
        if (!qs.length) { el('pp-body').innerHTML = '<p class="empty">이 주제는 아직 토론 질문이 없습니다.</p>'; return; }
        pp = { topic: num, qs: qs, data: {}, step: 'think', qi: 0, back: false };
        var saved = (r[1] && r[1].preps || []).filter(function (x) { return x.week === tp.week && x.name === me; });
        var local = null;
        try { local = JSON.parse(localStorage.getItem(cardKey(num)) || 'null'); } catch (e) {}
        var src = saved.length ? saved : (local || []);
        if (src.length) {
          src.forEach(function (x) { if (x.thought) pp.data[x.no] = { thought: x.thought }; });
          pp.step = 'review';
        } else {
          try {
            var d = JSON.parse(localStorage.getItem(draftKey(num)) || 'null');
            if (d && d.data) { pp.data = d.data; pp.step = d.step === 'review' ? 'review' : 'think'; pp.qi = Math.min(d.qi || 0, qs.length - 1); }
          } catch (e) {}
        }
        renderPrep();
      }).catch(function (e) {
        el('pp-body').innerHTML = '<p class="empty">질문을 불러오지 못했습니다.</p>';
        showError(e);
      });
  }

  var STEP_L = ['내 생각', '확인'];
  function renderSteps() {
    var n = pp.step === 'review' ? 2 : 1;
    el('pp-steps').innerHTML = '<div class="wz-bar">' + STEP_L.map(function (l, i) {
      return '<span class="wz-s' + (i + 1 < n ? ' done' : i + 1 === n ? ' on' : '') + '"><i></i>' + l + '</span>';
    }).join('') + '</div>';
  }
  function trBtn() { return '<button type="button" class="tr" data-tr hidden>영어로 바꾸기</button>'; }
  function goLabel() {
    if (pp.back) return '확인으로';
    if (pp.qi < pp.qs.length - 1) return D(pp.qs[pp.qi].no).thought.trim() ? '다음 질문' : '건너뛰기';
    return '확인하기';
  }

  function renderPrep() {
    renderSteps();
    el('pp-err').hidden = true;
    var body = el('pp-body'), back = el('pp-back'), go = el('pp-go');
    var h = '';
    if (pp.step === 'think') {
      var q = pp.qs[pp.qi], d = D(q.no), k = answered().length, min = thinkMin();
      h = '<p class="wz-count">질문 <b>' + (pp.qi + 1) + '</b> / ' + pp.qs.length + ' · 생각 쓴 질문 <b>' + k + '</b>개' +
          (k < min ? ' (최소 ' + min + '개)' : ' ✓') + '</p>' +
        '<div class="wz-q"><p class="wz-qen">' + esc(q.en || q.kr) + '</p>' + (q.en ? '<p class="wz-qkr">' + esc(q.kr) + '</p>' : '') + '</div>' +
        '<p class="wz-ask">이 질문에 대한 내 생각은?</p>' +
        '<div class="fx"><textarea class="input" rows="3" data-f="thought" placeholder="Write your own answer in English">' + esc(d.thought) + '</textarea>' + trBtn() + '</div>' +
        '<p class="wz-hint">시작 문장을 눌러서 빈칸을 채워도 돼요. 생각은 꼭 내 말로요.</p>' +
        '<div class="wz-chips">' + STARTERS.map(function (s, i) { return '<button type="button" class="chip2" data-st="' + i + '">' + esc(s) + '</button>'; }).join('') + '</div>';
      var ts = topicSentences(pp.topic);
      if (ts.length) h += '<p class="wz-hint">주제지 문장</p><div class="wz-chips">' + ts.map(function (s, i) { return '<button type="button" class="chip2" data-ts="' + i + '">' + esc(s) + '</button>'; }).join('') + '</div>';
      h += '<p class="wz-hint">폰 키보드의 마이크 버튼을 누르고 영어로 말해도 적혀요.</p>';
      back.textContent = pp.qi > 0 ? '이전 질문' : '닫기';
      go.textContent = goLabel();
    } else {
      var list = answered();
      h = '<p class="wz-ask" style="margin-top:4px">내 생각 ' + list.length + '개 — 수업 때 진행 카드에 이렇게 보여요</p>' +
        list.map(function (q2) {
          return '<button type="button" class="rv-row" data-goto="' + pp.qs.indexOf(q2) + '"><b class="rv-no">Q' + q2.no + '</b>' +
            '<span class="rv-qt">' + esc(q2.en || q2.kr) + '</span>' + esc(D(q2.no).thought) + '</button>';
        }).join('') +
        '<p class="wz-hint" style="margin-top:10px">고칠 곳을 누르면 그 질문으로 가요. 안 쓴 질문도 더 채울 수 있어요.</p>';
      back.textContent = '이전'; go.textContent = '제출하기';
    }
    body.innerHTML = h;
    el('prep-wrap').querySelector('.sheet').scrollTop = 0;
    bindPrep();
  }

  function bindPrep() {
    var body = el('pp-body');
    function syncTr(n) { var b = n.parentNode.querySelector('[data-tr]'); if (b) b.hidden = !/[가-힣]/.test(n.value); }
    Array.prototype.forEach.call(body.querySelectorAll('textarea[data-f]'), function (n) {
      syncTr(n);
      n.addEventListener('input', function () {
        D(pp.qs[pp.qi].no).thought = n.value;
        el('pp-err').hidden = true; syncTr(n); saveDraft();
        el('pp-go').textContent = goLabel();
      });
    });
    function insert(txt) {
      var n = body.querySelector('textarea[data-f="thought"]');
      if (!n.value.trim()) n.value = txt;
      else { var s = n.selectionStart != null ? n.selectionStart : n.value.length; n.value = n.value.slice(0, s) + (/\s$/.test(n.value.slice(0, s)) ? '' : ' ') + txt + n.value.slice(s); }
      n.dispatchEvent(new Event('input', { bubbles: true }));
      n.focus();
      var b = n.value.indexOf('___'); if (b !== -1) n.setSelectionRange(b, b + 3);
    }
    Array.prototype.forEach.call(body.querySelectorAll('[data-st]'), function (b) { b.addEventListener('click', function () { insert(STARTERS[+b.dataset.st]); }); });
    Array.prototype.forEach.call(body.querySelectorAll('[data-ts]'), function (b) { b.addEventListener('click', function () { insert(topicSentences(pp.topic)[+b.dataset.ts]); }); });
    Array.prototype.forEach.call(body.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () {
        pp.step = 'think'; pp.qi = +b.dataset.goto; pp.back = true; saveDraft(); renderPrep();
      });
    });
    Array.prototype.forEach.call(body.querySelectorAll('[data-tr]'), function (b) {
      b.addEventListener('click', function () {
        var n = b.parentNode.querySelector('textarea, input');
        if (tp.v < 6) { toast('시트 스크립트를 새 버전으로 바꾸면 쓸 수 있어요'); return; }
        b.disabled = true; b.textContent = '바꾸는 중…';
        call({ action: 'translate', text: n.value }).then(function (d) {
          n.value = d.text || n.value; n.dispatchEvent(new Event('input', { bubbles: true }));
          b.disabled = false; b.textContent = '영어로 바꾸기';
          toast('영어로 바꿨어요. 어색한 곳만 다듬어 주세요');
        }).catch(function (e) { b.disabled = false; b.textContent = '영어로 바꾸기'; showError(e); });
      });
    });
  }

  function checkAll() {
    var min = thinkMin(), k = answered().length;
    if (k < min) return '내 생각을 ' + min + '개 질문 이상 적어주세요 (지금 ' + k + '개)';
    for (var i = 0; i < pp.qs.length; i++) { var e = checkThought(pp.qs[i]); if (e) return e; }
    return '';
  }
  function goNext() {
    if (pp.step === 'think') {
      var m = checkThought(pp.qs[pp.qi]);
      if (m) return stopPrep(m);
      if (pp.back) { pp.back = false; pp.step = 'review'; saveDraft(); return renderPrep(); }
      if (pp.qi < pp.qs.length - 1) { pp.qi++; saveDraft(); return renderPrep(); }
      var e = checkAll();
      if (e) return stopPrep(e + (answered().length < thinkMin() ? ' — 이전 질문으로 돌아가 채워주세요' : ''));
      pp.step = 'review'; saveDraft(); return renderPrep();
    }
    submitPrep();
  }
  function goBack() {
    el('pp-err').hidden = true;
    if (pp.step === 'think') { if (pp.qi > 0) { pp.qi--; return renderPrep(); } el('prep-wrap').hidden = true; pp = null; return; }
    pp.step = 'think'; pp.qi = pp.qs.length - 1; renderPrep();
  }
  el('pp-go').addEventListener('click', function () { if (pp) goNext(); });
  el('pp-back').addEventListener('click', function () { if (pp) goBack(); else el('prep-wrap').hidden = true; });

  function submitPrep() {
    var btn = el('pp-go');
    var e = checkAll();
    if (e) return stopPrep(e);
    /* v7 시트 스크립트는 이끌 질문이 없으면 받지 않는다 */
    if (tp.v < 8) return stopPrep('시트 스크립트를 새 버전(v8)으로 바꿔야 제출돼요. 한남에게 알려주세요');
    var all = answered().map(function (q) { return { no: q.no, thought: D(q.no).thought.trim(), ask: '', follow: [] }; });
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.textContent = '제출하는 중…'; el('pp-err').hidden = true;
    var topic = pp.topic, week = tp.week;
    call({ action: 'prepSave', week: week, topic: topic, name: me, items: all }).then(function (d) {
      delete btn.dataset.busy; btn.textContent = '제출하기';
      try { localStorage.removeItem(draftKey(topic)); localStorage.setItem(cardKey(topic), JSON.stringify(all)); } catch (e) {}
      if (week === tp.recWeek) {
        var sv = d.saved || {};
        tp.preps = tp.preps.filter(function (p) { return !(p.name === me && p.topic === topic); })
          .concat([{ name: me, topic: topic, count: 0, thoughts: sv.thoughts || all.length, saved_at: sv.saved_at }]);
        saveCache(week);
      }
      tp.flash = { topic: topic, kind: 'prep', at: Date.now() };
      renderTopic(); renderNudge();
      openCard(topic, true);
    }).catch(function (e) { delete btn.dataset.busy; btn.textContent = '제출하기'; showError(e); });
  }

  /* ── 진행 카드: 수업 중에 폰으로 보는 화면 ──
     맨 위에 주제지의 쉬운 질문(가볍게 시작), 그 아래 메인 질문을 순서대로 — 내 생각을 쓴 질문은 내 답과 함께 */
  var cd = null;
  function openCard(num, fresh) {
    var t = topicOf(num);
    if (!t) return;
    el('prep-wrap').hidden = true; pp = null;
    el('card-wrap').hidden = false;
    el('cd-title').textContent = t.num + '. ' + t.title;
    el('cd-body').innerHTML = skel();
    var local = null;
    try { local = JSON.parse(localStorage.getItem(cardKey(num)) || 'null'); } catch (e) {}
    var get = local ? Promise.resolve(local)
      : call({ action: 'prepView', week: tp.week, topic: num, name: me }).then(function (d) {
          return (d.preps || []).filter(function (x) { return x.week === tp.week && x.name === me; })
            .map(function (x) { return { no: x.no, thought: x.thought }; });
        });
    Promise.all([loadQuestions(num), get]).then(function (r) {
      var mine = {};
      (r[1] || []).forEach(function (x) { if (x.thought) mine[x.no] = x.thought; });
      if (!Object.keys(mine).length) { el('cd-body').innerHTML = '<p class="empty">아직 준비한 내용이 없습니다.</p>'; return; }
      cd = { topic: num, qs: r[0] || [], mine: mine };
      renderCard();
      if (fresh) {
        el('cd-body').insertAdjacentHTML('afterbegin', '<div class="cd-done">' + CHECK + '<span><b>제출했어요</b><small>수업 때 이 카드를 켜두세요</small></span></div>');
        setTimeout(function () { celebrate(el('cd-body').querySelector('.ok-mark')); }, 250);
      }
    }).catch(function (e) { el('cd-body').innerHTML = '<p class="empty">불러오지 못했습니다.</p>'; showError(e); });
  }
  function renderCard() {
    var main = cd.qs.filter(function (q) { return q.no < 100; });
    var easy = cd.qs.filter(function (q) { return q.no > 100 && q.en; });
    var k = main.filter(function (q) { return cd.mine[q.no]; }).length;
    el('cd-body').innerHTML =
      (easy.length ? '<div class="cd-say"><p class="cd-lab">가볍게 시작하기 · 주제지 쉬운 질문</p>' +
        easy.map(function (q) { return '<p class="cd-easy">' + esc(q.en) + '</p>'; }).join('') + '</div>' : '') +
      '<p class="cd-pos">메인 질문 ' + main.length + '개 · 내 생각 ' + k + '개</p>' +
      main.map(function (q) {
        var t = cd.mine[q.no];
        return '<div class="cd-step' + (t ? '' : ' is-off') + '"><p class="cd-q"><span class="num">Q' + q.no + '</span> ' + esc(q.en || q.kr) + '</p>' +
          (q.en ? '<p class="cd-qk">' + esc(q.kr) + '</p>' : '') +
          (t ? '<p class="cd-lab cd-me">내 생각</p><p class="cd-mid strong">' + esc(t) + '</p>' : '') + '</div>';
      }).join('');
  }
  el('cd-edit').addEventListener('click', function () { if (cd) openPrep(cd.topic); });
  el('cd-others').addEventListener('click', function () { if (cd) openView(cd.topic); });

  /* ── 준비 모아보기: 질문별로, 이번 주 먼저 · 지난 준비도 함께 ── */
  function openView(num) {
    var t = topicOf(num);
    if (!t) return;
    el('prep-wrap').hidden = true; pp = null;
    el('card-wrap').hidden = true;
    el('pv-wrap').hidden = false;
    el('pv-title').textContent = t.num + '. ' + t.title;
    el('pv-body').innerHTML = skel();
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
          return '<section class="pv-q"><p class="pv-qt"><span class="num">Q' + q.no + '</span> ' + esc(q.en || q.kr) + '</p>' +
            list.map(function (p) {
              return '<div class="pv-item' + (p.name === me ? ' is-me' : '') + '">' +
                '<p class="pv-who">' + esc(p.name) + (p.name === me ? ' <span class="dim">(나)</span>' : '') +
                (p.week !== tp.week ? '<span class="pv-wk">' + md(p.week) + ' 주 준비</span>' : '') + '</p>' +
                (p.ask ? '<p><b>여는 질문</b>' + esc(p.ask) + '</p>' : '') +
                '<p><b>' + (p.ask ? '내 답' : '내 생각') + '</b>' + esc(p.thought) + '</p>' +
                decodeLines(p.follow).map(function (x) {
                  return '<p class="pv-f"><b><span class="lt lt-' + x.t + '">' + LINE_T[x.t] + '</span></b>' +
                    (x.t === 'ask' && x.a ? '"' + esc(x.a) + '" → ' : '') + esc(x.b) + '</p>';
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
      if (pk.week === tp.week) loadStatus();          /* 새 주제의 퀴즈·질문을 미리 받아 둔다 */
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
      navigator.clipboard.writeText(txt).then(function () {
        var b = el('pk-copy'), was = b.dataset.label || (b.dataset.label = b.textContent);
        b.textContent = '복사됨 ✓ 단톡방에 붙여넣으세요'; b.classList.add('is-copied');
        clearTimeout(b._t); b._t = setTimeout(function () { b.textContent = was; b.classList.remove('is-copied'); }, 2200);
      }, fallback);
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

  /* ───────── 창(아래에서 올라오는 시트) ─────────
     닫는 길은 네 가지: 바깥 누르기 · Esc · 아래로 끌어내리기 · 폰의 뒤로가기 */
  var MODALS = ['sheet-wrap', 'form-wrap', 'who-wrap', 'quiz-wrap', 'pick-wrap', 'prep-wrap', 'pv-wrap', 'card-wrap'];
  function anyModal() { return MODALS.some(function (id) { return !el(id).hidden; }); }
  function closeAll() {
    MODALS.forEach(function (id) { el(id).hidden = true; });
    sheetDate = null; qz = null; pp = null;
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (n) { n.addEventListener('click', closeAll); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  /* 뒤로가기: 창이 열리면 방문 기록을 하나 쌓고, 뒤로가기가 그걸 먹으면서 창을 닫는다 */
  var popSkip = false;
  var modalWatch = new MutationObserver(function () {
    var open = anyModal(), mark = history.state && history.state.sheet;
    if (open && !mark) history.pushState({ sheet: 1 }, '');
    else if (!open && mark) { popSkip = true; history.back(); }
    MODALS.forEach(function (id) { if (el(id).hidden) { var sh = el(id).querySelector('.sheet'); sh.style.transform = ''; sh.style.transition = ''; } });
  });
  MODALS.forEach(function (id) { modalWatch.observe(el(id), { attributes: true, attributeFilter: ['hidden'] }); });
  window.addEventListener('popstate', function () {
    if (popSkip) { popSkip = false; return; }
    if (anyModal()) closeAll();
  });

  /* 아래로 끌어내리기: 창 내용이 맨 위에 있을 때 아래로 끌면 따라 내려오고, 충분히 끌면 닫힌다 */
  MODALS.forEach(function (id) {
    var wrap = el(id), sh = wrap.querySelector('.sheet'), bg = wrap.querySelector('.modal-bg');
    var y0 = null, dy = 0, t0 = 0, drag = false;
    sh.addEventListener('touchstart', function (e) {
      y0 = null;
      if (e.touches.length !== 1 || innerWidth >= 560) return;
      if (e.target.closest('textarea, input, select')) return;
      if (sh.scrollTop > 0) return;
      y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); drag = false;
    }, { passive: true });
    sh.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      var d = e.touches[0].clientY - y0;
      if (!drag) {
        if (d < -4 || sh.scrollTop > 0) { y0 = null; return; }   /* 위로 밀면 평소처럼 스크롤 */
        if (d < 8) return;
        drag = true; sh.style.transition = 'none';
      }
      dy = Math.max(0, d - 8);
      sh.style.transform = 'translateY(' + dy + 'px)';
      if (bg) bg.style.opacity = String(1 - Math.min(dy / 500, 0.5));
      e.preventDefault();
    }, { passive: false });
    function end() {
      if (y0 === null) return;
      y0 = null;
      if (!drag) return;
      var fast = dy / Math.max(1, Date.now() - t0) > 0.7;
      sh.style.transition = 'transform .2s ease';
      if (bg) { bg.style.transition = 'opacity .2s'; bg.style.opacity = ''; }
      if (dy > 120 || (fast && dy > 40)) {
        sh.style.transform = 'translateY(105%)';
        setTimeout(closeAll, 170);
      } else sh.style.transform = '';
    }
    sh.addEventListener('touchend', end);
    sh.addEventListener('touchcancel', end);
  });

  /* ───────── 탭 ───────── */
  var TABS = ['cal', 'topic', 'mine'];
  function curTab() { return TABS.filter(function (t) { return !el('tab-' + t).hidden; })[0] || 'cal'; }
  function moveInk() {
    var on = document.querySelector('.tab.is-on'), ink = document.querySelector('.tab-ink');
    if (!on || !ink) return;
    ink.style.width = on.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }
  function switchTab(on) {
    var from = TABS.indexOf(curTab()), to = TABS.indexOf(on);
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
      x.classList.toggle('is-on', x.dataset.tab === on);
    });
    el('tab-cal').hidden = on !== 'cal';
    el('tab-topic').hidden = on !== 'topic';
    el('tab-mine').hidden = on !== 'mine';
    moveInk();
    if (from !== to && from !== -1) {
      var pn = el('tab-' + on);
      pn.classList.remove('slide-l', 'slide-r'); void pn.offsetWidth;
      pn.classList.add(to > from ? 'slide-l' : 'slide-r');
    }
    el('fab').style.display = on === 'cal' ? '' : 'none';
    if (on === 'mine') renderMine();
    if (on === 'topic') { if (tp.state === 'ok') { renderTopic(); loadStatus(); } else loadTopic(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });
  window.addEventListener('resize', moveInk);

  /* 좌우로 밀어서 탭 넘기기. 달력 칸 위에서 밀면 달이 넘어간다.
     옆으로 스크롤되는 표·입력칸 위에서는 건드리지 않는다 */
  (function () {
    var x0 = null, y0 = 0, t0 = 0, onCal = false;
    var app = el('view-app');
    app.addEventListener('touchstart', function (e) {
      x0 = null;
      if (e.touches.length !== 1 || anyModal()) return;
      var tg = e.target;
      if (tg.closest('input, textarea, select, .tbl-scroll, .tabs')) return;
      for (var n = tg; n && n !== app; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return;
      }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
      onCal = !!tg.closest('#cal');
    }, { passive: true });
    app.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Date.now() - t0 > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      if (onCal) { el(dx < 0 ? 'next-m' : 'prev-m').click(); return; }
      var i = TABS.indexOf(curTab()) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < TABS.length) switchTab(TABS[i]);
    }, { passive: true });
  })();
  /* iOS 사파리는 이게 있어야 버튼 눌림(:active) 모양이 보인다 */
  document.addEventListener('touchstart', function () {}, { passive: true });
  el('toast').addEventListener('click', function () { el('toast').hidden = true; });

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
    if (!el('tab-topic').hidden && tp.state === 'ok' && el('quiz-wrap').hidden && el('prep-wrap').hidden && el('card-wrap').hidden) loadStatus();
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
