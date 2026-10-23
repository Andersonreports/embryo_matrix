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
 `${grabFn('field')}\n${grabConst('patientKey')}\n${grabFn('countPatients')}\n${grabConst('reportCount')}\nreturn{reportCount,countPatients}`
)();

// A released-stage entry as stageRows() builds it: the sheet row, its case, its embryo count.
const staged=(patient,sampleId,n=1)=>({row:{'patient name':patient,'sample id':sampleId},c:{patient},n});
// A plain embryo row as allEmbryos() builds it: the row with its case attached.
const plain=(patient,sampleId)=>({'patient name':patient,'sample id':sampleId,_case:{patient}});

test('one patient across several sample IDs is one report, not one per sample', () => {
 // Re-biopsy, a second cycle and a batch split across runs all give the same patient new
 // sample IDs. Each used to count as its own released report.
 const rows=[staged('KOMAL RAMPELLI','DCC0000008547'),staged('KOMAL RAMPELLI','483P9S26'),staged('KOMAL RAMPELLI','174P6J26')];
 assert.strictEqual(reportCount(rows),1);
});

test('one patient across several embryo rows is still one report', () => {
 const rows=[staged('DIVYA MALAIYA','AN-1'),staged('DIVYA MALAIYA','AN-1'),staged('DIVYA MALAIYA','AN-1',5)];
 assert.strictEqual(reportCount(rows),1);
});

test('different patients each count once', () => {
 const rows=[staged('ARUNA','AP1'),staged('AKANKSHA KUMARI','AN1'),staged('GURULAKSHMI','GS1')];
 assert.strictEqual(reportCount(rows),3);
});

test('the same name spelled with different case or spacing is one patient', () => {
 const rows=[staged('Ruby  Mangala','A1'),staged('RUBY MANGALA','B2'),staged('ruby mangala','C3')];
 assert.strictEqual(reportCount(rows),1);
});

test('rows with no patient name are skipped, not counted one each', () => {
 // The old key fell back to Math.random() for a nameless row, so every one of them added 1.
 const rows=[staged('','X1'),staged('','X2'),staged('','X3'),staged('ARUNA','AP1')];
 assert.strictEqual(reportCount(rows),1);
});

test('a row carrying the name only on its case still counts', () => {
 const rows=[{row:{'sample id':'X1'},c:{patient:'ARUNA'},n:1},{row:{'sample id':'X2'},c:{patient:'ARUNA'},n:1}];
 assert.strictEqual(reportCount(rows),1);
});

test('plain embryo rows (the coordinator view) count per patient too', () => {
 const rows=[plain('ARUNA','AP1'),plain('ARUNA','AP2'),plain('HARIKA AKULA','HS1')];
 assert.strictEqual(reportCount(rows),2);
});

test('released reports can never outnumber the patients they belong to', () => {
 // The invariant the dashboard broke: every released row belongs to a patient in the total,
 // so counting the two on the same basis must leave released <= patients.
 const everyone=[plain('ARUNA','AP1'),plain('ARUNA','AP2'),plain('AKANKSHA KUMARI','AN1'),
                 plain('AKANKSHA KUMARI','AN2'),plain('DIVYA MALAIYA','DN1'),plain('HARIKA AKULA','HS1')];
 const released=everyone.filter(r=>r['patient name']!=='HARIKA AKULA');
 assert.ok(reportCount(released)<=countPatients(everyone),
  `released ${reportCount(released)} must not exceed patients ${countPatients(everyone)}`);
 assert.strictEqual(countPatients(everyone),4);
 assert.strictEqual(reportCount(released),3);
});
