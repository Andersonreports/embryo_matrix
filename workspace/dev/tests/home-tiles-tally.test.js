// PATIENTS, REPORT RELEASED and REPORT ONGOING on the Run-status header are one partition of one
// population: released + ongoing must equal patients, exactly. They were once counted
// independently - released from stageRows(), ongoing from the two-month report-prep window,
// patients from allEmbryos() - and 4,200 + 270 came to 4,470 against 4,465 patients.
//
// renderHomeStats() is DOM-bound, so these are deliberately source-level assertions: they pin the
// SHAPE that makes the arithmetic impossible to break - one writer per tile, released restricted
// to the patient population, ongoing derived by subtraction. If you restructure renderHomeStats,
// keep those three properties and update the patterns here.
//   node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');

const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');

test('exactly one place writes each of the three tiles', () => {
 // A second writer elsewhere in app.js would silently win depending on render order - that is
 // how the old two-month report-prep count kept reappearing in REPORT ONGOING.
 for(const id of ['homePatientsStat','homeReleasedStat','homeReportPrepStat']){
  const n=src.split(`'#${id}'`).length-1;
  assert.strictEqual(n,1,`#${id} is written in ${n} places, expected exactly 1`);
 }
});

test('released is a subset of the reporting population by construction', () => {
 // Same loop, same rows, same identity matcher, so REPORT RELEASED can never climb above the
 // reporting patient count - which is what produced 4,667 released against 4,465 patients.
 assert.match(src,/const homeId=makePatientIdentity\(\),reportKeys=new Set\(\),releasedKeys=new Set\(\);/,
  'both sets must be declared together, sharing one identity matcher, for the single-pass build');
 assert.match(src,/reportKeys\.add\(k\);if\(rowStage\(r\)==='released'\)releasedKeys\.add\(k\)/,
  'released must be added inside the same loop that adds the patient');
});

test('PATIENTS is never scoped by test', () => {
 // The headline figure counts every patient in the period. Scoping it to the reporting tests
 // silently dropped 263 add-on patients out of a tile labelled PATIENTS.
 assert.match(src,/set\('#homePatientsStat',countPatients\(rows\)\)/,
  'PATIENTS must count every patient, not just the reporting ones');
});

test('the tiles count only samples that will have a report prepared', () => {
 // MaReCs, PGT-A+M, PGT-M, HLA, Embryo Sure, validation and NOT REPORTING rows never get a
 // report, so they belong to none of the three tiles - they used to sit in REPORT ONGOING.
 assert.match(src,/rows\.filter\(r=>needsReport\(r,r\._case\)\)/,
  'the tile population must be filtered by needsReport()');
 assert.match(src,/const needsReport=\(e,c\)=>isReportPrepTest\(e\)/,
  'needsReport must be gated on the report-prep allow-list');
 assert.match(src,/const REPORT_PREP_TESTS=\/\^\(PGTA\|PGTSR\|EMBRYOSURE\)\//,
  'released + overdue cover PGT-A, PGT-SR and Embryo Sure - nothing else');
 assert.match(src,/!k\.includes\('\+M'\)&&!k\.includes\('HLA'\)/,
  'PGT-A+M and PGT-A+HLA C start with PGTA and must be excluded as add-ons');
});

test('ongoing is derived by subtraction within the reporting population', () => {
 assert.match(src,/set\('#homeReportPrepStat',reportKeys\.size-releasedKeys\.size\)/,
  'REPORT ONGOING must be reporting patients minus released');
});

test('released and overdue share one scope rule', () => {
 assert.match(src,/set\('#homeReleasedStat',releasedKeys\.size\)/,'RELEASED comes from releasedKeys');
 assert.match(src,/function overdueEligible\(e,c\)\{return needsReport\(e,c\)&&/,
  'overdue must use needsReport(), so it can never disagree with REPORT RELEASED about scope');
});

test('the REPORT ONGOING tile opens a list of the same thing it counts', () => {
 // The tile used to open the two-month Report-preparation view, whose count is a third number.
 const html=fs.readFileSync(path.join(__dirname,'..','frontend','index.html'),'utf8');
 assert.match(html,/id="homeReportPrepCard" data-stage="ongoing"/,
  'the REPORT ONGOING tile must be wired to the "ongoing" stage list');
 assert.ok(!src.includes("go('homeReportPrepCard','reportprep')"),
  'the tile must no longer open the report-preparation view');
 assert.match(src,/stage==='ongoing'\?\[\.\.\.sr\.pending,\.\.\.sr\.wga,\.\.\.sr\.seq\]\.filter\(x=>needsReport\(x\.row,x\.c\)\)/,
  'the ongoing list must be pending + WGA + sequencing, filtered by the same needsReport()');
});
