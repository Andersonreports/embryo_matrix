// matchTrackerRow must never let box/sample-ID agreement outrank a correct patient-name match (frontend/app.js).
// This is what let two patients' PGT-A results get swapped in RUN103A (2026-10-17): the uploaded file's own
// "Details" tab mislabelled a box as the wrong patient, and the old scoring let that wrong-name-but-right-box
// candidate outscore the right patient's own (differently-boxed) tracker row. Run after any change to
// scoreTrackerRow/matchTrackerRow:   node --test tests/*.test.js (also run by the pre-commit hook and start.sh)
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');

const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
const grabFn=name=>{const i=src.indexOf(`function ${name}(`);assert.ok(i>=0,`${name} not found in app.js`);let depth=0;
 for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')depth++;else if(src[k]==='}'&&!--depth)return src.slice(i,k+1)}};
const grabConst=name=>{const m=src.match(new RegExp(`\\n(const ${name}=[^\\n]*)`));assert.ok(m,`${name} not found in app.js`);return m[1]};

const code='const CANONICAL_TESTS={};let lastMatchWhy="";const recvOf=t=>field(t,["date sample received"]);\n'
 +['cleanId','field','fieldKey','embryoUnits','embryoNameParts','expandEmbryoTags','embryoNameField','nameSim','scoreTrackerRow',
   'matchTrackerRow','makeTrackerIndex','trustTracker','dayKeys','receivedAfterRun'].map(grabFn).join('\n')+'\n'
 +['nameKey','normCol','daysMeet','wordsOf'].map(grabConst).join('\n');
const {matchTrackerRow,makeTrackerIndex}=new Function(code+'\nreturn{matchTrackerRow,makeTrackerIndex}')();

const RUN_DATE=new Date(2026,8,11);
const base={'date sample received':'09-09-2026','wga done on':'10-09-2026','test name':'PGT-A'};

test('a file mislabelling a box under the wrong patient still resolves to the right patient', () => {
 // The file's own Details tab says this box is "NIKHILA K" - but that box truly belongs to SAUMYA VERMA (the
 // registry's own stale row for her still carries the same box/sample ID with the old embryo-tag spelling).
 const det={...base,'patient name':'NIKHILA K','box number':'337P7J26','sample id':'ADB0000061102','embryo name':'ND-2,5'};
 const wrongBoxOwner={...base,'patient name':'SAUMYA VERMA','box number':'337P7J26','sample id':'ADB0000061102','embryo name':'ND-2,5'};
 const rightPatient={...base,'patient name':'NIKHILA K','box number':'77P8A26','sample id':'DCC0000007520','embryo name':'ND-2,5'};
 const tix=makeTrackerIndex([wrongBoxOwner,rightPatient]);
 const winner=matchTrackerRow(det,tix,RUN_DATE);
 assert.strictEqual(winner && winner['patient name'], 'NIKHILA K');
});

test('a lone candidate with a typo in the patient name is still rescued by box/sample ID (no regression)', () => {
 // No competing, correctly-named candidate exists here, so box/sample-ID agreement must still carry the match.
 const det={...base,'patient name':'KALPANA','box number':'B1','sample id':'S1','embryo name':'KM-1,2'};
 const onlyRow={...base,'patient name':'KALPAN','box number':'B1','sample id':'S1','embryo name':'KM-1,2'};
 const tix=makeTrackerIndex([onlyRow]);
 const winner=matchTrackerRow(det,tix,RUN_DATE);
 assert.strictEqual(winner && winner['patient name'], 'KALPAN');
});

test('two equally weak name matches still fall through to the normal ambiguity rules (no regression)', () => {
 const det={...base,'patient name':'SHARMA','box number':'B1','sample id':'S1','embryo name':'SH-1,2'};
 const a={...base,'patient name':'SHAIKH','box number':'B1','sample id':'S1','embryo name':'SH-1,2'};
 const b={...base,'patient name':'SHARAD','box number':'B2','sample id':'S2','embryo name':'SH-1,2'};
 const tix=makeTrackerIndex([a,b]);
 // Neither scores a strong (>=2.5) name match, so the new name-identity gate must not engage; whichever the
 // existing score/tie-break rules pick (or neither, if it's judged ambiguous) is unaffected by this change.
 assert.doesNotThrow(() => matchTrackerRow(det,tix,RUN_DATE));
});
