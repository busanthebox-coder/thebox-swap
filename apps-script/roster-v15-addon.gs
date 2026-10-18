/**
 * THEBOX v15: role-scoped, read-only fixed-weekday roster.
 *
 * INSTALL: In the existing bound Apps Script project, add this as a NEW
 * script file and add ONE case in the existing handle(e) switch:
 *   case 'secureRoster': return json(v15SecureRoster(req));
 * Then manually run v15InitializeAccess() once as the owner and redeploy
 * the EXISTING web app to a NEW VERSION (keep same /exec URL).
 *
 * Do not publish the resulting "리더_접근_v15" tab or copy codes to GitHub.
 * No changes are made to the current member or cover sheets.
 */
var V15_ACCESS_SHEET = '리더_접근_v15';
var V15_LEADERS = {
  mw: ['이가영','유선민','박소현','김찬결','조성재','진보리'],
  tt: ['김조은','김민영','김나연','이유림','박새미','이창환','김범주'],
  we: ['심은','이정은','황민지','전은지']
};
var V15_GROUP_CONFIG = {
  mw: {tab:'월수', a:{nameColumn:3,firstRow:5}, b:{nameColumn:15,firstRow:5}},
  tt: {tab:'화목', a:{nameColumn:16,firstRow:7}, b:{nameColumn:28,firstRow:7}},
  we: {tab:'주말', a:{nameColumn:3,firstRow:6}, b:{nameColumn:15,firstRow:6}}
};
function v15NormalizeDay(raw) {
  return String(raw==null?'':raw).trim().replace(/\s+/g,'');
}
function v15InitializeAccess() {
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss) throw new Error('스터디 스프레드시트에서 실행해주세요');
  var existing=ss.getSheetByName(V15_ACCESS_SHEET);
  if(existing && existing.getLastRow()>0) {
    throw new Error('이미 접근 코드 시트가 있습니다. 코드가 바뀌지 않도록 중단합니다.');
  }
  var sh=existing||ss.insertSheet(V15_ACCESS_SHEET);
  var rows=[['리더','그룹','접속코드','사용상태','발급시각']];
  Object.keys(V15_LEADERS).forEach(function(group){
    V15_LEADERS[group].forEach(function(name){
      rows.push([name,group,Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''),'active',new Date().toISOString()]);
    });
  });
  sh.getRange(1,1,rows.length,5).setValues(rows);
  sh.getRange(1,1,1,5).setFontWeight('bold');
  sh.setFrozenRows(1);
  try {sh.hideSheet();} catch(e){}
  return '17개의 리더 코드 발급 완료. 숨겨진 "'+V15_ACCESS_SHEET+'" 시트를 관리자만 열어 확인하고 코드 개별 전달.';
}
function v15FindLeader(token) {
  if(typeof token!=='string'||!(/^[a-f0-9]{64}$/i.test(token))) return null;
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var sh=ss.getSheetByName(V15_ACCESS_SHEET);
  if(!sh||sh.getLastRow()<2) return null;
  var rows=sh.getRange(2,1,sh.getLastRow()-1,4).getDisplayValues();
  for(var i=0;i<rows.length;i++){
    if(rows[i][2]===token && rows[i][3]==='active'){
      var group=rows[i][1],name=rows[i][0];
      if(V15_LEADERS[group] && V15_LEADERS[group].indexOf(name)!==-1) return {name:name,group:group};
    }
  }
  return null;
}
function v15RosterCohort(ss, config,level) {
  var sh=ss.getSheetByName(config.tab);
  if(!sh) throw new Error('운영 시트 없음: '+config.tab);
  var spec=level==='A'?config.a:config.b;
  var start=spec.firstRow,nameCol=spec.nameColumn;
  var last=Math.min(sh.getLastRow(),start+19); // Up to 20 numbered cohort positions; never read waitlist sections.
  if(last<start) return [];
  // Name; note: fixed weekday is exactly 7 columns after name.
  var vals=sh.getRange(start,nameCol,last-start+1,9).getDisplayValues();
  var out=[];
  vals.forEach(function(r){
    var name=String(r[0]||'').trim(),days=v15NormalizeDay(r[7]),note=String(r[8]||'').trim();
    if(!name||name==='이름'||name==='대기자'||name.indexOf('대기자')===0) return;
    // The rows after the numbered cohort grid contain headings; exclude them.
    if(['결제완료 / 시작예정','월요일만','수요일만','주1회'].indexOf(name)>=0) return;
    // Respect the official fixed-weekday cell; do not infer from notes.
    out.push({name:name,level:level,fixedDays:days||null,needsReview:!days||(name==='이하경'&&days==='목토'&&note.indexOf('목일')>=0)});
  });
  return out;
}
function v15SecureRoster(req) {
  var leader=v15FindLeader(req&&req.accessCode);
  if(!leader) return {ok:false,error:'접속 코드가 유효하지 않습니다'};
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  var cfg=V15_GROUP_CONFIG[leader.group];
  return {ok:true,source:'study-sheet',group:leader.group,leader:leader.name,
    fetchedAt:new Date().toISOString(),
    cohorts:{A:v15RosterCohort(ss,cfg,'A'),B:v15RosterCohort(ss,cfg,'B')}};
}
