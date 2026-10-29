// The patient identity rule (team confirmed 23-10-2026): a patient is identified by Sample ID
// (the Anderson ID) when present, matching across a close name variant, not only an exact one -
// a repeat biopsy keeps the same ID but is often re-typed with a dropped middle name or a
// one-letter slip. An ID shared by names with NO resemblance (the sheet's day-based "REG..."
// registration numbers colliding across different patients) is never merged. A row with no
// Sample ID is always its own patient.
//   node --test tests/*.test.js
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');

const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
const grabConst=name=>{const m=src.match(new RegExp('^const '+name+'=.*$','m'));assert.ok(m,`${name} not found`);return m[0]};
const grabFn=name=>{const i=src.indexOf(`function ${name}(`);assert.ok(i>=0,`${name} not found`);let d=0;
 for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&!--d)return src.slice(i,k+1)}};
const {makePatientIdentity,namesLikelySamePatient,duplicateSampleIdMismatches,allEmbryosMock}=new Function(`
 ${grabFn('field')}
 ${grabConst('patientKey')}
 ${grabFn('levDistance')}
 ${grabFn('namesLikelySamePatient')}
 ${grabConst('sampleIdOf')}
 ${grabConst('rowFallbackKey')}
 ${grabFn('makePatientIdentity')}
 let __rows=[];
 function allEmbryos(){return __rows}
 function setMockRows(r){__rows=r}
 ${grabFn('duplicateSampleIdMismatches')}
 return {makePatientIdentity,namesLikelySamePatient,
  duplicateSampleIdMismatches:rows=>{setMockRows(rows);return duplicateSampleIdMismatches()}}
`)();

const row=(name,sid)=>({'patient name':name,'sample id':sid});

test('same Sample ID, exact same name -> one identity', () => {
 const id=makePatientIdentity();
 assert.strictEqual(id(row('Komal Rampelli','DCC0000008547')),id(row('Komal Rampelli','DCC0000008547')));
});

test('same Sample ID, a dropped middle name -> one identity (real example)', () => {
 const id=makePatientIdentity();
 assert.strictEqual(id(row('Shrinidhi Ramesh','ADK0000006102')),id(row('Shrinidhi','ADK0000006102')));
});

test('same Sample ID, a one-letter typo -> one identity (real example)', () => {
 const id=makePatientIdentity();
 assert.strictEqual(id(row('Paramjeet Khandpur','ADB0000066533')),id(row('Paranjeet Khandpur','ADB0000066533')));
});

test('same Sample ID, totally different names -> NOT merged', () => {
 // The sheet's day-based "REG..." numbers collide across unrelated patients booked the same day.
 const id=makePatientIdentity();
 assert.notStrictEqual(id(row('Jyoti Pawandeep','REG31122025')),id(row('Divya K','REG31122025')));
});

test('different Sample IDs, identical name -> NOT merged', () => {
 // A name match alone is never enough - common first names recur across different patients.
 const id=makePatientIdentity();
 assert.notStrictEqual(id(row('Priyanka','A1')),id(row('Priyanka','B2')));
});

test('no Sample ID, same name, different received dates -> NOT merged (realistic case)', () => {
 // A real sheet row with no Sample ID still carries a box/received date/embryo name, which is
 // what keeps two different, identically-named, ID-less patients from colliding - this is what
 // "one row is one patient" means by default, with no ID to say otherwise.
 const id=makePatientIdentity();
 const a={'patient name':'Priyanka','date sample received':'04-01-2026'};
 const b={'patient name':'Priyanka','date sample received':'12-08-2026'};
 assert.notStrictEqual(id(a),id(b));
});

test('no Sample ID, same name, and no other distinguishing field -> a known limitation', () => {
 // With literally nothing but a name to go on, the fallback key collapses two different rows.
 // This does not occur in practice - a received date or box number is present on virtually
 // every named row (5,427 and 5,213 of 5,532 respectively, in the live sheet) - but it is worth
 // knowing about rather than silently assuming perfect behaviour.
 const id=makePatientIdentity();
 assert.strictEqual(id(row('Priyanka','')),id(row('Priyanka','')));
});

test('a nameless row has no identity at all', () => {
 const id=makePatientIdentity();
 assert.strictEqual(id(row('','SID1')),null);
});

test('namesLikelySamePatient rejects unrelated names of similar length', () => {
 // A pure edit-distance threshold without a length check would wrongly match short unrelated
 // names; this must stay false.
 assert.strictEqual(namesLikelySamePatient('Divya K','Priya K'),false);
});

test('duplicateSampleIdMismatches finds the real-data collision pattern', () => {
 const rows=[row('Jyoti Pawandeep','REG31122025'),row('Divya K','REG31122025'),
             row('Shrinidhi Ramesh','ADK0000006102'),row('Shrinidhi','ADK0000006102')];
 const out=duplicateSampleIdMismatches(rows);
 assert.strictEqual(out.length,1,'only the genuinely different pair should be flagged');
 assert.strictEqual(out[0].sampleId,'REG31122025');
 assert.strictEqual(out[0].rows.length,2);
});
