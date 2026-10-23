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

test('released patients are restricted to the counted patient population', () => {
 // Without this guard a released row whose patient is filtered out of the PATIENTS population
 // would push released above patients again.
 assert.match(src,/releasedKeys=new Set\(\)/,'releasedKeys set not found');
 assert.match(src,/if\(k&&patientKeys\.has\(k\)\)releasedKeys\.add\(k\)/,
  'released keys must be guarded by patientKeys.has(k)');
});

test('ongoing is derived by subtraction, never counted on its own', () => {
 assert.match(src,/set\('#homeReportPrepStat',patientKeys\.size-releasedKeys\.size\)/,
  'REPORT ONGOING must be patients minus released, so the three tiles always add up');
});

test('all three tiles read from the same patient set', () => {
 assert.match(src,/set\('#homePatientsStat',patientKeys\.size\)/,
  'PATIENTS must come from the same Set the other two are derived from');
 assert.match(src,/set\('#homeReleasedStat',releasedKeys\.size\)/,
  'REPORT RELEASED must come from releasedKeys');
});

test('the REPORT ONGOING tile opens a list of the same thing it counts', () => {
 // The tile used to open the two-month Report-preparation view, whose count is a third number.
 const html=fs.readFileSync(path.join(__dirname,'..','frontend','index.html'),'utf8');
 assert.match(html,/id="homeReportPrepCard" data-stage="ongoing"/,
  'the REPORT ONGOING tile must be wired to the "ongoing" stage list');
 assert.ok(!src.includes("go('homeReportPrepCard','reportprep')"),
  'the tile must no longer open the report-preparation view');
 assert.match(src,/stage==='ongoing'\?\[\.\.\.sr\.pending,\.\.\.sr\.wga,\.\.\.sr\.seq\]/,
  'the ongoing list must be pending + WGA + sequencing, i.e. everything not released');
});
