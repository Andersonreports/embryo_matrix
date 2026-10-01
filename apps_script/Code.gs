/**
 * EmbryoMatrix — Google Sheets API.
 *
 * Paste this whole file into Extensions > Apps Script (from any one of the
 * three source spreadsheets), then deploy it as a Web App. It never writes
 * to the three source sheets — only SpreadsheetApp.openById(...).getValues()
 * reads them. The ONE spreadsheet it writes to is its own separate workbook,
 * "EmbryoMatrix – Edited samples", created in your Drive by createEditsSheet()
 * (see "Edited samples sheet" at the bottom): one row per embryo edited in
 * the app, holding its whole Samples > Embryo view row.
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
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
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
// Edited samples sheet (the only spreadsheet this script writes to).
//
// When a lab user edits an editable value in the app (WGA conc, karyotype,
// PGT result), the server POSTs that embryo's whole Samples > Embryo view row
// here. The row is upserted into the "Edits" tab of a spreadsheet this script
// creates on first use and remembers in Script Properties (EDITS_SHEET_ID).
// The app reads the edited values back with GET ?action=edits.
//
// Columns: the tracking columns below, then every Embryo view column, in the
// order the app sends them. "Edited columns" lists which values were changed
// in the app (semicolon-separated column keys) - only those are read back.
// ---------------------------------------------------------------------------
var EDITS_SHEET_NAME = 'EmbryoMatrix – Edited samples';
var EDITS_TAB = 'Edits';
var EDITS_META = ['Record key', 'Sample ID', 'Embryo', 'Edited columns', 'Last edited by', 'Last edited at'];
// Column key -> its header in the Embryo view (the app labels these two differently).
var EDITS_HEADER_FOR = { 'dna conc unpurified': 'WGA CONC UNPURIFIED', 'dna conc purified': 'WGA CONC PURIFIED' };

// Samples > Embryo view columns, in table order - the headers a new edits workbook starts with.
// (Any column the app adds later is appended automatically on the next edit.)
var EDITS_VIEW_COLUMNS = ['DATE OF BIOPSY', 'DATE SAMPLE RECEIVED', 'DATE TRF RECEIVED', 'RECEIVED BY', 'BOX NUMBER', 'SAMPLE ID', 'REMARKS', 'PATIENT NAME', 'NUMBER OF EMBRYOS', 'EMBRYO NAME', 'WGA CONC UNPURIFIED', 'WGA CONC PURIFIED', 'EMBRYO GRADE', 'KARYOTYPE', 'PGT RESULT', 'CONTROLS WGA SEQ CONTROLS', 'TEST NAME', 'CENTER NAME', 'LOCATION', 'EMBRYOLOGIST NAME', 'WGA DONE ON', 'WGA DONE BY', 'TRANSFERRED', 'TRANSFER DETAILS', 'KIT DETAIL', 'TAT'];

// Run this once from the editor (function dropdown -> createEditsSheet -> Run) to create the
// separate "EmbryoMatrix – Edited samples" workbook in your Drive right away, with all the
// Embryo view headers. Its link is printed in the Execution log. Safe to run again: if the
// workbook already exists it just prints the link - it never makes a second one.
function createEditsSheet() {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  editsHeaders_(tab, EDITS_VIEW_COLUMNS);
  tab.getRange(1, 1, 1, tab.getLastColumn()).setFontWeight('bold').setBackground('#d9ead3').setWrap(true);
  tab.setFrozenRows(1);
  tab.setColumnWidths(1, tab.getLastColumn(), 150);
  Logger.log('EmbryoMatrix – Edited samples: ' + ss.getUrl());
  return ss.getUrl();
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return jsonOutput_({ error: 'Bad JSON' }); }
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
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
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('EDITS_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* deleted or no access - make a new one */ }
  }
  var ss = SpreadsheetApp.create(EDITS_SHEET_NAME);
  ss.getSheets()[0].setName(EDITS_TAB);
  props.setProperty('EDITS_SHEET_ID', ss.getId());
  return ss;
}

function editsTab_(ss) {
  var tab = ss.getSheetByName(EDITS_TAB) || ss.insertSheet(EDITS_TAB);
  if (tab.getLastRow() === 0) {
    tab.appendRow(EDITS_META);
    tab.setFrozenRows(1);
    tab.getRange(1, 1, 1, EDITS_META.length).setFontWeight('bold');
  }
  return tab;
}

// Headers in the sheet, adding any Embryo view column the sheet doesn't have yet at the end.
function editsHeaders_(tab, wanted) {
  var lastCol = Math.max(tab.getLastColumn(), 1);
  var headers = tab.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  var added = [];
  for (var i = 0; i < wanted.length; i++) if (headers.indexOf(wanted[i]) < 0 && added.indexOf(wanted[i]) < 0) added.push(wanted[i]);
  if (added.length) {
    tab.getRange(1, headers.length + 1, 1, added.length).setValues([added]).setFontWeight('bold');
    headers = headers.concat(added);
  }
  return headers;
}

function editsFindRow_(tab, key) {
  var last = tab.getLastRow();
  if (last < 2) return -1;
  var keys = tab.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) return i + 2;
  return -1;
}

function editsUpsert_(body) {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  var row = body.row || []; // [[header, value], ...] in Embryo view order
  var headers = editsHeaders_(tab, row.map(function (p) { return String(p[0]); }));
  var at = editsFindRow_(tab, body.key);
  var current = at > 0 ? tab.getRange(at, 1, 1, headers.length).getValues()[0] : headers.map(function () { return ''; });
  var editedCols = String(current[3] || '').split(';').map(function (x) { return x.trim(); }).filter(String);
  if (editedCols.indexOf(body.column) < 0) editedCols.push(body.column);
  var values = current.slice();
  var meta = [body.key, body.sampleId, body.embryo, editedCols.join('; '), body.editedBy || '', body.editedAt || new Date().toISOString()];
  for (var m = 0; m < meta.length; m++) values[m] = meta[m];
  for (var r = 0; r < row.length; r++) values[headers.indexOf(String(row[r][0]))] = row[r][1];
  // Plain text, so the sheet never re-reads "02-09-2026" or "1,2" as a date / number.
  var range = at > 0 ? tab.getRange(at, 1, 1, headers.length) : tab.getRange(tab.getLastRow() + 1, 1, 1, headers.length);
  range.setNumberFormat('@').setValues([values]);
  return { ok: true, sheetId: ss.getId(), url: ss.getUrl() };
}

// The app reverted an edit to the source-sheet value: drop that column from the row's
// "Edited columns", and remove the row once nothing in it is edited any more.
function editsRevert_(body) {
  var ss = editsSpreadsheet_(), tab = editsTab_(ss);
  var at = editsFindRow_(tab, body.key);
  if (at < 0) return { ok: true, url: ss.getUrl() };
  var cell = tab.getRange(at, 4);
  var left = String(cell.getValue() || '').split(';').map(function (x) { return x.trim(); }).filter(function (x) { return x && x !== body.column; });
  if (left.length) cell.setValue(left.join('; ')); else tab.deleteRow(at);
  return { ok: true, url: ss.getUrl() };
}

// GET ?action=edits - every edited value, for the app to apply over the source sheets.
function editsList_() {
  var id = PropertiesService.getScriptProperties().getProperty('EDITS_SHEET_ID');
  if (!id) return { edits: [], url: '' };
  var ss = SpreadsheetApp.openById(id), tab = ss.getSheetByName(EDITS_TAB);
  if (!tab || tab.getLastRow() < 2) return { edits: [], url: ss.getUrl() };
  var values = tab.getDataRange().getValues(), headers = values[0].map(String), edits = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r], cols = String(row[3] || '').split(';').map(function (x) { return x.trim(); }).filter(String);
    for (var c = 0; c < cols.length; c++) {
      var header = EDITS_HEADER_FOR[cols[c]] || String(cols[c]).toUpperCase(), idx = headers.indexOf(header);
      edits.push({ sampleId: String(row[1]), embryo: String(row[2]), column: cols[c], value: idx >= 0 ? formatCell_(row[idx]) : '', editedBy: String(row[4]), editedAt: String(row[5]) });
    }
  }
  return { edits: edits, url: ss.getUrl() };
}
