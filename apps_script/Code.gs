/**
 * EmbryoMatrix — read-only Google Sheets API.
 *
 * Paste this whole file into Extensions > Apps Script (from any one of the
 * three source spreadsheets), then deploy it as a Web App. It never writes
 * to the sheet — only SpreadsheetApp.openById(...).getValues() reads.
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
