/**
 * EmbryoMatrix — Google Sheets API.
 *
 * Paste this whole file into Extensions > Apps Script (from any one of the
 * three source spreadsheets), then deploy it as a Web App. It never writes
 * to the three source sheets — only SpreadsheetApp.openById(...).getValues()
 * reads them. The ONE spreadsheet it writes to is the "PGS & NIPGS updates"
 * Google Sheet set in EDITS_SHEET_ID_SETTING (see the section at the bottom):
 * one row per embryo edited in the app, holding its whole Samples > Embryo
 * view row.
 *
 * Why this exists: the server currently polls
 *   https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx
 * directly, which only works if every sheet is shared "Anyone with the
 * link". Once the app moves to the IT team's domain that may no longer be
 * true, and a server-side outbound request to docs.google.com can also get
 * blocked by a corporate proxy/firewall. This script runs on Google's own
 * infrastructure under YOUR account ("Execute as: Me"), so it can read the
 * sheets even if they're locked down to specific people, and it exposes a
 * small stable JSON endpoint instead.
 *
 * ---- One-time setup ----
 * 1. Open the spreadsheet -> Extensions -> Apps Script.
 * 2. Delete the boilerplate `myFunction` and paste this whole file in.
 * 3. Below, replace SHARED_SECRET's placeholder with your own long random
 *    string (this is what stops random people from hitting your URL).
 * 4. Run the `setup` function once (function dropdown at the top -> setup ->
 *    Run). Approve the permission prompts (it's your own script, so click
 *    "Advanced" -> "Go to <project name> (unsafe)" if Google warns you).
 * 5. Also run `installEditTriggers` once the same way (see below — this is
 *    what makes edits push to the server instantly instead of waiting for
 *    the 10-minute poll, once step 8 is done).
 * 6. Deploy -> New deployment -> gear icon -> "Web app".
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    Deploy, authorize again if asked, then copy the URL ending in /exec.
 * 7. Test it in a browser: <that URL>?token=<your secret>
 *    You should get back JSON, not an error page.
 * 8. Give the /exec URL and the secret to whoever configures the server
 *    (SHEET_API_URL / SHEET_API_TOKEN in .env — see app/config.py). Once the
 *    server has a real public URL (not localhost — Google can't reach
 *    that), set SERVER_WEBHOOK_URL_PLACEHOLDER below to
 *    "<that public URL>/api/sync-sheet", save, and run `setup` again (no
 *    redeploy needed) to turn on instant push. Until then it's a safe no-op
 *    and the 10-minute poll is what keeps things in sync.
 *
 * If you ever change the code here, you must create a NEW deployment
 * version (Deploy -> Manage deployments -> pencil icon -> New version) —
 * saving the file alone does not update the live /exec URL. Script
 * Properties (the secret, the webhook URL) are the one exception — those
 * apply immediately without a new deployment.
 */

// Set your own secret here, then run setup() once. Do not skip this —
// without it, anyone who finds the URL can read the sheet.
var SHARED_SECRET_PLACEHOLDER = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

// Leave blank until the app server has a real public URL (not localhost —
// Google's servers can't reach that). Once it does, set this to
// "https://your-public-domain/api/sync-sheet", save, and run `setup` again.
var SERVER_WEBHOOK_URL_PLACEHOLDER = '';

// Minimum seconds between pushes to the server, so a burst of edits (e.g.
// pasting many rows) doesn't hammer it — at most one push per this window.
var WEBHOOK_MIN_INTERVAL_SECONDS = 15;

// Same spreadsheet IDs as SHEET_SOURCES in the server's .env, so a plain
// call with no ?sheetId= param returns everything the server currently
// syncs. The real IDs are kept out of git (the sheets are link-readable);
// paste them here in the Apps Script editor when deploying.
var DEFAULT_SHEET_IDS = [
  'SHEET_ID_1',
  'SHEET_ID_2',
  'SHEET_ID_3',
];

// The secret every request must carry: the key written above when it's been filled in
// (so pasting the script + deploying is enough), else the one stored by setup().
function sharedSecret_() {
  if (SHARED_SECRET_PLACEHOLDER && SHARED_SECRET_PLACEHOLDER !== 'REPLACE_WITH_A_LONG_RANDOM_STRING') return SHARED_SECRET_PLACEHOLDER;
  return PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
}

function setup() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHARED_SECRET', SHARED_SECRET_PLACEHOLDER);
  props.setProperty('SERVER_WEBHOOK_URL', SERVER_WEBHOOK_URL_PLACEHOLDER);
}

// Run this once (function dropdown -> installEditTriggers -> Run) so every
// edit on the three source sheets pings the server. Safe to run again later
// (e.g. if a new sheet ID is added to DEFAULT_SHEET_IDS) — it clears any
// triggers this function already owns first, so it never creates duplicates.
function installEditTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onSheetEdited') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  for (var j = 0; j < DEFAULT_SHEET_IDS.length; j++) {
    ScriptApp.newTrigger('onSheetEdited').forSpreadsheet(DEFAULT_SHEET_IDS[j]).onEdit().create();
  }
}

// Fires on every edit to any of the three sheets. No-ops until
// SERVER_WEBHOOK_URL is set (see setup() above), so it's safe to install
// this before the app has a public URL.
function onSheetEdited(e) {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('SERVER_WEBHOOK_URL');
  if (!webhookUrl) return;

  var lastPing = Number(props.getProperty('LAST_WEBHOOK_PING_AT') || 0);
  var now = Date.now();
  if (now - lastPing < WEBHOOK_MIN_INTERVAL_SECONDS * 1000) return;
  props.setProperty('LAST_WEBHOOK_PING_AT', String(now));

  try {
    UrlFetchApp.fetch(webhookUrl, { method: 'post', muteHttpExceptions: true });
  } catch (err) {
    // Best-effort only — if this fails, the 10-minute poll still covers it.
  }
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var expected = sharedSecret_();
  if (expected && params.token !== expected) {
    return jsonOutput_({ error: 'Unauthorized' });
  }

  if (params.action === 'edits') {
    try { return jsonOutput_(editsList_()); } catch (err) { return jsonOutput_({ error: String(err) }); }
  }

  try {
    var sheetIds = params.sheetId ? [params.sheetId] : DEFAULT_SHEET_IDS;
    var sources = [];
    var errors = [];
    for (var i = 0; i < sheetIds.length; i++) {
      var id = sheetIds[i];
      try {
        sources.push({ sheetId: id, tabs: readSpreadsheet_(id) });
      } catch (err) {
        errors.push(id + ': ' + err);
      }
    }
    return jsonOutput_({ generatedAt: new Date().toISOString(), sources: sources, errors: errors });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function readSpreadsheet_(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var tabs = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var tab = readTab_(sheets[i]);
    if (tab.headers.length > 0) tabs.push(tab);
  }
  return tabs;
}

// Mirrors app/sheet_sync.py's header/cell normalization so rows coming
// through this API look identical to the current xlsx-export path.
function readTab_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) return { name: sheet.getName(), headers: [], rows: [] };

  var headers = [];
  for (var c = 0; c < values[0].length; c++) headers.push(normalizeHeader_(values[0][c], c));

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var hasContent = false;
    var record = {};
    for (var c2 = 0; c2 < headers.length; c2++) {
      var cell = formatCell_(row[c2]);
      if (cell !== '') hasContent = true;
      record[headers[c2]] = cell;
    }
    if (hasContent) rows.push(record);
  }
  return { name: sheet.getName(), headers: headers, rows: rows };
}

function normalizeHeader_(h, i) {
  var cleaned = String(h === null || h === undefined ? '' : h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return cleaned || ('column ' + (i + 1));
}

function formatCell_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var tz = Session.getScriptTimeZone();
    var hasTime = v.getHours() !== 0 || v.getMinutes() !== 0 || v.getSeconds() !== 0;
    return Utilities.formatDate(v, tz, hasTime ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy');
  }
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ---------------------------------------------------------------------------
// "PGS & NIPGS updates" sheet - the only spreadsheet this script writes to.
//
// When a lab user edits an editable value in the app (WGA conc, karyotype,
// PGT result), the server POSTs that embryo's whole Samples > Embryo view row
// here, and it is upserted into the first tab of the spreadsheet below: one
// row per edited embryo, under the sheet's own column headers only. The app
// reads the edited values back with GET ?action=edits.
//
// Which embryo a row belongs to, and which of its values were edited in the
// app, is kept in hidden row metadata (Developer metadata, key EDITS_MD_KEY) -
// nothing extra shows in the sheet, and it moves with the row if rows are
// sorted or moved. Every column is found by its header.
// ---------------------------------------------------------------------------

// The native Google Sheet to write to: the ID between /d/ and /edit in its link.
// Must be a Google Sheet (an uploaded .xlsx needs File > Save as Google Sheets first).
var EDITS_SHEET_ID_SETTING = 'PASTE_THE_GOOGLE_SHEET_ID_HERE';

var EDITS_MD_KEY = 'embryomatrix-edit';
// Visible tracking columns an earlier version of this script added - moved into the hidden
// metadata and removed automatically.
var EDITS_OLD_META = ['Record key', 'Edited columns', 'Edited sample ID', 'Edited embryo', 'Last edited by', 'Last edited at'];
// Column key -> its header in the Embryo view (the app labels these two differently).
var EDITS_HEADER_FOR = { 'dna conc unpurified': 'WGA CONC UNPURIFIED', 'dna conc purified': 'WGA CONC PURIFIED' };

// Samples > Embryo view columns, in table order - written as the header row if the sheet is empty.
// (Any column the app adds later is appended automatically on the next edit.)
var EDITS_VIEW_COLUMNS = ['DATE OF BIOPSY', 'DATE SAMPLE RECEIVED', 'DATE TRF RECEIVED', 'RECEIVED BY', 'BOX NUMBER', 'SAMPLE ID', 'REMARKS', 'PATIENT NAME', 'NUMBER OF EMBRYOS', 'EMBRYO NAME', 'WGA CONC UNPURIFIED', 'WGA CONC PURIFIED', 'EMBRYO GRADE', 'KARYOTYPE', 'PGT RESULT', 'CONTROLS WGA SEQ CONTROLS', 'TEST NAME', 'CENTER NAME', 'LOCATION', 'EMBRYOLOGIST NAME', 'WGA DONE ON', 'WGA DONE BY', 'TRANSFERRED', 'TRANSFER DETAILS', 'KIT DETAIL', 'RUN ID', 'TAT'];

// Optional, from the editor: tidies the sheet (moves any old tracking columns into the hidden
// metadata) and prints its link in the Execution log. Safe to run again.
function checkEditsSheet() {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  tab.setFrozenRows(1);
  Logger.log('Writing edits to "' + ss.getName() + '" / tab "' + tab.getName() + '": ' + ss.getUrl());
  return ss.getUrl();
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return jsonOutput_({ error: 'Bad JSON' }); }
  var expected = sharedSecret_();
  if (expected && body.token !== expected) return jsonOutput_({ error: 'Unauthorized' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'editsUpsert') return jsonOutput_(editsUpsert_(body));
    if (body.action === 'editsRevert') return jsonOutput_(editsRevert_(body));
    return jsonOutput_({ error: 'Unknown action' });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function editsSpreadsheet_() {
  if (!EDITS_SHEET_ID_SETTING || EDITS_SHEET_ID_SETTING.indexOf('PASTE_') === 0) {
    throw new Error('Set EDITS_SHEET_ID_SETTING in the script to the Google Sheet ID first');
  }
  try {
    return SpreadsheetApp.openById(EDITS_SHEET_ID_SETTING);
  } catch (err) {
    throw new Error('Cannot open the edits sheet - is it a native Google Sheet (not an uploaded .xlsx) and does this account have Editor access? ' + err);
  }
}

// The first tab of the edits sheet; an empty one gets the Embryo view headers. Old visible
// tracking columns are moved into the hidden row metadata and deleted.
function editsTab_(ss) {
  var tab = ss.getSheets()[0];
  if (tab.getLastRow() === 0) {
    tab.appendRow(EDITS_VIEW_COLUMNS);
    tab.setFrozenRows(1);
    tab.getRange(1, 1, 1, EDITS_VIEW_COLUMNS.length).setFontWeight('bold');
    return tab;
  }
  editsMigrateOldColumns_(tab);
  return tab;
}

function editsMigrateOldColumns_(tab) {
  var lastCol = tab.getLastColumn();
  var headers = tab.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var cols = EDITS_OLD_META.map(function (h) { return headers.indexOf(h); });
  if (cols.every(function (c) { return c < 0; })) return;
  var last = tab.getLastRow();
  if (last >= 2) {
    var values = tab.getRange(2, 1, last - 1, lastCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var v = values[i], get = function (n) { var c = cols[n]; return c >= 0 ? String(v[c] || '') : ''; };
      if (!get(0)) continue;
      editsSetMeta_(tab, i + 2, { key: get(0), edited: editsSplit_(get(1)), sampleId: get(2), embryo: get(3), by: get(4), at: get(5) });
    }
  }
  cols.filter(function (c) { return c >= 0; }).sort(function (a, b) { return b - a; })
    .forEach(function (c) { tab.deleteColumn(c + 1); });
}

// Hidden per-row record: { key, edited: [column keys], sampleId, embryo, by, at }.
function editsRowMeta_(tab) {
  var out = {};
  var found = tab.createDeveloperMetadataFinder().withKey(EDITS_MD_KEY).find();
  for (var i = 0; i < found.length; i++) {
    var md = found[i], loc = md.getLocation(), row = loc.getRow && loc.getRow();
    if (!row) continue;
    var info = {};
    try { info = JSON.parse(md.getValue() || '{}'); } catch (err) { continue; }
    out[row.getRow()] = { md: md, info: info };
  }
  return out;
}

function editsSetMeta_(tab, row, info) {
  var range = tab.getRange(row + ':' + row);
  var existing = range.getDeveloperMetadata().filter(function (m) { return m.getKey() === EDITS_MD_KEY; });
  if (existing.length) {
    existing[0].setValue(JSON.stringify(info));
    for (var i = 1; i < existing.length; i++) existing[i].remove();
  } else {
    range.addDeveloperMetadata(EDITS_MD_KEY, JSON.stringify(info));
  }
}

// Headers in the sheet (trimmed), adding any wanted column the sheet doesn't have yet at the end.
function editsHeaders_(tab, wanted) {
  var lastCol = Math.max(tab.getLastColumn(), 1);
  var headers = tab.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  var added = [];
  for (var i = 0; i < wanted.length; i++) if (wanted[i] && headers.indexOf(wanted[i]) < 0 && added.indexOf(wanted[i]) < 0) added.push(wanted[i]);
  if (added.length) {
    tab.getRange(1, headers.length + 1, 1, added.length).setValues([added]).setFontWeight('bold');
    headers = headers.concat(added);
  }
  return headers;
}

function editsCleanId_(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The row for this embryo: by its hidden record first; else (a row written before the hidden
// records existed, or typed in by hand) by SAMPLE ID / BOX NUMBER (or patient + date received)
// and EMBRYO NAME - the same identity the app uses - so it is updated instead of duplicated.
function editsFindRow_(tab, headers, meta, body) {
  for (var r in meta) if (meta[r].info.key === body.key) return Number(r);
  var last = tab.getLastRow();
  if (last < 2) return -1;
  var values = tab.getRange(2, 1, last - 1, headers.length).getValues(), col = function (h) { return headers.indexOf(h); };
  var want = editsCleanId_(body.sampleId), emb = editsCleanId_(body.embryo);
  for (var i = 0; i < values.length; i++) {
    if (meta[i + 2]) continue;
    var v = values[i], get = function (h) { var c = col(h); return c >= 0 ? String(v[c] || '').trim() : ''; };
    var id = get('SAMPLE ID') || get('BOX NUMBER') || [get('PATIENT NAME'), get('DATE SAMPLE RECEIVED')].filter(String).join(' ');
    if (editsCleanId_(id) === want && editsCleanId_(get('EMBRYO NAME')) === emb) return i + 2;
  }
  return -1;
}

function editsSplit_(v) {
  return String(v || '').split(';').map(function (x) { return x.trim(); }).filter(String);
}

function editsUpsert_(body) {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  var row = body.row || []; // [[header, value], ...] in Embryo view order
  var headers = editsHeaders_(tab, row.map(function (p) { return String(p[0]).trim(); }));
  var meta = editsRowMeta_(tab), at = editsFindRow_(tab, headers, meta, body);
  var values = at > 0 ? tab.getRange(at, 1, 1, headers.length).getValues()[0] : headers.map(function () { return ''; });
  for (var r = 0; r < row.length; r++) { var i = headers.indexOf(String(row[r][0]).trim()); if (i >= 0) values[i] = row[r][1]; }
  var info = at > 0 && meta[at] ? meta[at].info : { edited: [] };
  if ((info.edited || []).indexOf(body.column) < 0) info.edited = (info.edited || []).concat([body.column]);
  info.key = body.key; info.sampleId = body.sampleId; info.embryo = body.embryo;
  info.by = body.editedBy || ''; info.at = body.editedAt || new Date().toISOString();
  if (at < 0) at = tab.getLastRow() + 1;
  // Plain text, so the sheet never re-reads "02-09-2026" or "1,2" as a date / number.
  tab.getRange(at, 1, 1, headers.length).setNumberFormat('@').setValues([values]);
  editsSetMeta_(tab, at, info);
  return { ok: true, sheetId: ss.getId(), url: ss.getUrl() };
}

// The app reverted an edit to the source-sheet value: drop that column from the row's
// edited list, and remove the row once nothing in it is edited any more.
function editsRevert_(body) {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss), headers = editsHeaders_(tab, []);
  var meta = editsRowMeta_(tab), at = editsFindRow_(tab, headers, meta, body);
  if (at < 0) return { ok: true, url: ss.getUrl() };
  if (!meta[at]) { tab.deleteRow(at); return { ok: true, url: ss.getUrl() }; } // untracked row: its only edit is being undone
  var info = meta[at].info;
  info.edited = (info.edited || []).filter(function (x) { return x !== body.column; });
  if (info.edited.length) editsSetMeta_(tab, at, info); else tab.deleteRow(at);
  return { ok: true, url: ss.getUrl() };
}

// GET ?action=edits - every edited value, for the app to apply over the source sheets.
function editsList_() {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  if (tab.getLastRow() < 2) return { edits: [], url: ss.getUrl() };
  var values = tab.getDataRange().getValues(), headers = values[0].map(function (h) { return String(h).trim(); }), edits = [];
  var meta = editsRowMeta_(tab);
  for (var r in meta) {
    var info = meta[r].info, row = values[Number(r) - 1];
    if (!row) continue;
    for (var c = 0; c < (info.edited || []).length; c++) {
      var col = info.edited[c], idx = headers.indexOf(EDITS_HEADER_FOR[col] || String(col).toUpperCase());
      edits.push({ sampleId: String(info.sampleId || ''), embryo: String(info.embryo || ''), column: col, value: idx >= 0 ? formatCell_(row[idx]) : '', editedBy: String(info.by || ''), editedAt: String(info.at || '') });
    }
  }
  return { edits: edits, url: ss.getUrl() };
}
