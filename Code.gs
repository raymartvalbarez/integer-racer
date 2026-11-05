/**
 * Integer Racer leaderboard — optional upgrade over MantleDB.
 * 1) Create a Google Sheet, add tab "IntegerRacer" with headers:
 *    Timestamp (Manila) | Name | Grade | Section | Total | BestLevel | Unlocked | Key
 * 2) Extensions > Apps Script, paste this file, Save.
 * 3) Deploy > New deployment > Web app
 *    Execute as: Me · Who has access: Anyone
 * 4) Copy the /exec URL into game.js as GAS_URL (and leave MantleDB as fallback unused).
 */
var TAB = 'IntegerRacer';
var TZ = 'Asia/Manila';
var MAX = 4000;
function sh_(){
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.appendRow(['Timestamp (Manila)','Name','Grade','Section','Total','BestLevel','Unlocked','Key']);
    sh.setFrozenRows(1);
  }
  return sh;
}
function norm_(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48); }
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function rows_(){
  var sh = sh_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,8).getValues();
}
function doGet(e){
  var p = (e && e.parameter) || {};
  if (p.action === 'board') {
    var map = {};
    rows_().forEach(function(r){
      var key = String(r[7]||norm_(r[1])+'-g'+r[2]);
      var total = Number(r[4])||0;
      if (total > MAX) return;
      if (!map[key] || total > map[key].total) {
        map[key] = { name:String(r[1]), grade:String(r[2]), section:String(r[3]), total:total, bestLevel:Number(r[5])||0, unlocked:Number(r[6])||1, ts:String(r[0]) };
      }
    });
    var entries = Object.keys(map).map(function(k){ return map[k]; });
    return out_({ ok:true, entries:entries });
  }
  return out_({ ok:true, app:'Integer Racer' });
}
function doPost(e){
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action !== 'submit') return out_({ ok:false });
    var total = Number(d.total)||0;
    if (total < 0 || total > MAX) return out_({ ok:false, reason:'implausible' });
    var name = String(d.name||'').slice(0,80);
    var grade = String(d.grade||'').slice(0,4);
    var key = norm_(name) + '-g' + grade;
    var sh = sh_();
    var data = rows_();
    var found = -1, best = total;
    for (var i=0;i<data.length;i++){
      if (String(data[i][7]) === key) {
        found = i + 2;
        best = Math.max(Number(data[i][4])||0, total);
        break;
      }
    }
    var ts = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    var row = [ts, name, grade, String(d.section||'').slice(0,40), best, Math.max(Number(d.bestLevel)||0, found>0?Number(data[found-2][5])||0:0), Number(d.unlocked)||1, key];
    if (found > 0) sh.getRange(found,1,1,8).setValues([row]);
    else sh.appendRow(row);
    return out_({ ok:true, total:best });
  } finally { lock.releaseLock(); }
}
