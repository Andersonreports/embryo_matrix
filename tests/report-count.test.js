// A report is issued PER PATIENT. The REPORT RELEASED / REPORT PREPARATION tiles must therefore
// count distinct patients - never sample IDs, never sheet rows, never embryos. Keying on the
// sample ID is what once made REPORT RELEASED (4,667) come out larger than PATIENTS (4,465),
// which is impossible: a released report belongs to a patient who is already in that total.
// Run after any change to the stat tiles:   node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');

const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
// Pull whole-line `const name=...;` definitions straight out of app.js, so the test runs against
// the shipped code rather than a copy that can drift away from it.
const grabConst=name=>{
 const m=src.match(new RegExp('^const '+name+'=.*$','m'));
 assert.ok(m,`${name} not found in app.js`);
 return m[0];
};
const grabFn=name=>{
 const i=src.indexOf(`function ${name}(`);assert.ok(i>=0,`${name} not found in app.js`);
 let depth=0;
 for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')depth++;else if(src[k]==='}'&&!--depth)return src.slice(i,k+1)}
};
const{reportCount,countPatients}=new Function(
 `${grabFn('field')}\n${grabConst('patientKey')}\n${grabFn('levDistance')}\n${grabFn('namesLikelySamePatient')}\n${grabConst('sampleIdOf')}\n${grabConst('rowFallbackKey')}\n${grabFn('makePatientIdentity')}\n${grabFn('countPatients')}\n${grabConst('reportCount')}\nreturn{reportCount,countPatients}`
)();

// A released-stage entry as stageRows() builds it: the sheet row, its case, its embryo count.
const staged=(patient,sampleId,n=1)=>({row:{'patient name':patient,'sample id':sampleId},c:{patient},n});
// A plain embryo row as allEmbryos() builds it: the row with its case attached.
const plain=(patient,sampleId)=>({'patient name':patient,'sample id':sampleId,_case:{patient}});

test('one patient across several rows sharing a Sample ID is one report', () => {
 // A re-biopsy, a second cycle, a batch split across runs - all billed and entered again under
 // the SAME Anderson ID (team confirmed 23-10-2026). Each used to count as its own report.
 const rows=[staged('KOMAL RAMPELLI','DCC0000008547'),staged('KOMAL RAMPELLI','DCC0000008547'),staged('KOMAL RAMPELLI','DCC0000008547')];
 assert.strictEqual(reportCount(rows),1);
});

test('a typo in the name does not split a Sample ID into two patients', () => {
 // A second entry's name is often typed slightly differently - a dropped middle name, a
 // one-letter slip (real sheet examples: "SHRINIDHI RAMESH"/"SHRINIDHI",
 // "PARAMJEET"/"PARANJEET KHANDPUR", both confirmed by the team as one patient each).
 const rows=[staged('Shrinidhi Ramesh','ADK0000006102'),staged('Shrinidhi','ADK0000006102')];
 assert.strictEqual(reportCount(rows),1);
});

test('one patient across several embryo rows, same Sample ID, is still one report', () => {
 const rows=[staged('DIVYA MALAIYA','AN-1'),staged('DIVYA MALAIYA','AN-1'),staged('DIVYA MALAIYA','AN-1',5)];
 assert.strictEqual(reportCount(rows),1);
});

test('different patients each count once', () => {
 const rows=[staged('ARUNA','AP1'),staged('AKANKSHA KUMARI','AN1'),staged('GURULAKSHMI','GS1')];
 assert.strictEqual(reportCount(rows),3);
});

test('the SAME Sample ID with different case or spacing in the name is one patient', () => {
 const rows=[staged('Ruby  Mangala','A1'),staged('RUBY MANGALA','A1'),staged('ruby mangala','A1')];
 assert.strictEqual(reportCount(rows),1);
});

test('an identical name on DIFFERENT Sample IDs is never merged', () => {
 // The real finding behind this rule: common first names ("priyanka", "kavitha", "saranya")
 // recur across the sheet as different women. Without a shared Sample ID there is no evidence
 // they are the same patient, so the name alone - however exactly it matches - must not merge
 // them. (This is also why patient mode on the overview charts tallies rows directly rather
 // than deduping by name - see tests/chart-units.test.js.)
 const rows=[staged('Ruby Mangala','A1'),staged('Ruby Mangala','B2'),staged('Ruby Mangala','C3')];
 assert.strictEqual(reportCount(rows),3);
});

test('an ID shared by names with no resemblance is never merged', () => {
 // The sheet's day-based registration numbers ("REG12022026") are reused across unrelated
 // patients booked the same day. Merging on the ID alone here would attach one patient's
 // results to a stranger's.
 const rows=[staged('Jyoti Pawandeep','REG31122025'),staged('Divya K','REG31122025')];
 assert.strictEqual(reportCount(rows),2);
});

test('rows with no patient name are skipped, not counted one each', () => {
 // The old key fell back to Math.random() for a nameless row, so every one of them added 1.
 const rows=[staged('','X1'),staged('','X2'),staged('','X3'),staged('ARUNA','AP1')];
 assert.strictEqual(reportCount(rows),1);
});

test('a row carrying the name only on its case still counts', () => {
 const rows=[{row:{'sample id':'X1'},c:{patient:'ARUNA'},n:1},{row:{'sample id':'X1'},c:{patient:'ARUNA'},n:1}];
 assert.strictEqual(reportCount(rows),1);
});

test('plain embryo rows (the coordinator view) count per patient too', () => {
 const rows=[plain('ARUNA','AP1'),plain('ARUNA','AP1'),plain('HARIKA AKULA','HS1')];
 assert.strictEqual(reportCount(rows),2);
});

test('released reports can never outnumber the patients they belong to', () => {
 // The invariant the dashboard broke: every released row belongs to a patient in the total,
 // so counting the two on the same basis must leave released <= patients.
 const everyone=[plain('ARUNA','AP1'),plain('ARUNA','AP1'),plain('AKANKSHA KUMARI','AN1'),
                 plain('AKANKSHA KUMARI','AN1'),plain('DIVYA MALAIYA','DN1'),plain('HARIKA AKULA','HS1')];
 const released=everyone.filter(r=>r['patient name']!=='HARIKA AKULA');
 assert.ok(reportCount(released)<=countPatients(everyone),
  `released ${reportCount(released)} must not exceed patients ${countPatients(everyone)}`);
 assert.strictEqual(countPatients(everyone),4);
 assert.strictEqual(reportCount(released),3);
});

// --- Report-preparation scope (team's call, 23-10-2026) ------------------------------------
// Report prep is PGT-A, PGT-SR, NIPGT/NIPGS and Embryo Sure. PGT-A+M, PGT-M, HLA-C typing and
// Embryology validation are add-on tests and must never be counted as awaiting a report; MaReCs,
// NOT REPORTING and non-embryo material (POC, AF, CVS, karyotyping) are in neither bucket.
// canonicalTestName() is a big lookup table over the sheet's spellings; the scope rule only needs
// the raw name, so it is stubbed to the identity here and the three real predicates are pulled in.
const {isReportPrepTest}=new Function(
 `const canonicalTestName=t=>String(t||'');
  const field=(r,names)=>{for(const n of names){const k=Object.keys(r).find(x=>x===n||x.includes(n));if(k&&r[k])return String(r[k]).trim()}return''};
  const testNameOf=e=>field(e,['test','test name'])||e._case.test;
  ${grabConst('REPORT_PREP_TESTS')}
  ${grabConst('reportTestKey')}
  ${grabConst('isReportPrepTest')}
  return{isReportPrepTest}`
)();
const t=name=>isReportPrepTest({'test name':name,_case:{}});

test('the three reporting tests are in scope', () => {
 for(const name of ['PGT-A','PGTA','PGT_A','PGT-SR','PGTSR','EMBRYO SURE','EmbryoSure','PGT-A/EmbryoSure'])
  assert.strictEqual(t(name),true,`${name} should count in REPORT RELEASED and OVERDUE`);
});

test('NIPGS, karyotyping and validation are out of released and overdue', () => {
 for(const name of ['NIPGT','NIPGS','Express molecular karyotyping NGS','POC','AF','CVS','Embryo validation','VALIDATION'])
  assert.strictEqual(t(name),false,`${name} must not count in REPORT RELEASED or OVERDUE`);
});

test('add-on tests are never counted as awaiting a report', () => {
 for(const name of ['PGT-A+M','PGTA+M','PGT-M','PGTM','PGT-M only','HLA C typing','PGT-A+HLA C','PGT-A  HLA C TYPING'])
  assert.strictEqual(t(name),false,`${name} is an add-on test, not report preparation`);
});

test('MaReCs and non-embryo material are in neither bucket', () => {
 for(const name of ['MaReCs','MARECS','POC','AF','CVS','Express Molecular Karyotyping by NGS','NGS KARYOTYPING',''])
  assert.strictEqual(t(name),false,`${name} must not be counted as awaiting a report`);
});
