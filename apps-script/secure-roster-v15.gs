/* THEBOX v15 secure read-only study roster. For deployment: add as new Apps Script file.
   The Code.gs handle() switch must include:
      case 'secureRoster': return json(secureRosterV15(req));
   Server-side role scoping: only a matching private 64-char code can read one group's A/B roster. */
var ROSTER_GROUPS_V15={'이가영':'mw','유선민':'mw','박소현':'mw','김찬결':'mw','조성재':'mw','진보리':'mw','김조은':'tt','김민영':'tt','김나연':'tt','이유림':'tt','박새미':'tt','이창환':'tt','김범주':'tt','심은':'we','이정은':'we','황민지':'we','전은지':'we'};
function rosterHashV15(str) {
 var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,str,Utilities.Charset.UTF_8);
 return digest.map(function(b){return ('0'+(b<0?b+256:b).toString(16)).slice(-2)}).join('');
}
function secureRosterV15(req) {
 var code=String((req||{}).accessCode||'').trim();
 if(!/^[0-9a-f]{64}$/i.test(code)) return {ok:false,error:'Invalid code format'};
 var hash=rosterHashV15(code),props=PropertiesService.getScriptProperties(),leader='',group='';
 for(var n in ROSTER_GROUPS_V15){
   var stored=props.getProperty('ROSTER_V15_'+n);
   if(stored&&stored===hash){leader=n;group=ROSTER_GROUPS_V15[n];break}
 }
 if(!leader)return {ok:false,error:'Invalid code'};
 var cfg={mw:{tab:'월수',A:[5,3,10],B:[5,15,22]},tt:{tab:'화목',A:[7,16,23],B:[7,28,35]},we:{tab:'주말',A:[6,3,10],B:[6,15,22]}}[group];
 var sh=book().getSheetByName(cfg.tab);
 if(!sh)return {ok:false,error:'Study sheet not found'};
 function rows(level){
  var r=cfg[level],start=r[0],nc=r[1],dc=r[2];
  if(sh.getMaxRows()<start)return [];
  var count=Math.min(22,sh.getMaxRows()-start+1);
  return sh.getRange(start,nc,count,dc-nc+1).getDisplayValues().map(function(row){
   var name=String(row[0]||'').trim(),days=String(row[dc-nc]||'').trim();
   return {name:name,fixedDays:days,needsReview:!days};
  }).filter(function(x){return x.name&&x.name.length<=25&&
   ['리더','이름','대기자','결제완료 / 시작예정'].indexOf(x.name)===-1});
 }
 return {ok:true,leader:leader,group:group,cohorts:{A:rows('A'),B:rows('B')},
  retrievedAt:new Date().toISOString()};
}
/* Issue one-time individual code privately from Apps Script Editor. Only hash is saved. */
function issueRosterCodeV15(name) {
 if(!ROSTER_GROUPS_V15[name])throw Error('Unknown leader');
 var code=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').toLowerCase();
 PropertiesService.getScriptProperties().setProperty('ROSTER_V15_'+name,rosterHashV15(code));
 return {leader:name,accessCode:code};
}
/* Change name before manually running this helper. Do not commit its output. */
function setupOneRosterCodeV15() {
 var code=issueRosterCodeV15('이가영');
 Logger.log(JSON.stringify(code));
}
