// How embryo names from the sample sheet are split into one tag per embryo (embryoNameParts in frontend/app.js).
// Every case below is a real spelling from the sheets. A wrong split shows the wrong number of embryos, attaches
// results to the wrong embryo, or lists embryos as "missing a result" that don't exist - so run this after any
// change to embryo-name handling:   node --test tests/*.test.js (also run by the pre-commit hook and start.sh)
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');

const src=fs.readFileSync(path.join(__dirname,'..','frontend','app.js'),'utf8');
const grab=name=>{const i=src.indexOf(`function ${name}(`);assert.ok(i>=0,`${name} not found in app.js`);let depth=0;
 for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')depth++;else if(src[k]==='}'&&!--depth)return src.slice(i,k+1)}};
const{cleanId,embryoNameParts}=new Function(`${grab('cleanId')}\n${grab('embryoNameParts')}\nreturn{cleanId,embryoNameParts}`)();
const tags=(name,n,known)=>embryoNameParts(name,n,known).map(cleanId);

// [sheet embryo name, Number of embryos, result tags already uploaded, expected tags]
const CASES=[
 // biopsy.embryo with commas between embryos
 ['FZ-3.1,3.2',2,['FZ31','FZ32'],['FZ31','FZ32']],
 ['DM-1.1,1.2',2,[],['DM11','DM12']],
 ['AR2.1,2.2,2.3',3,[],['AR21','AR22','AR23']],
 // dots between embryos
 ['SV-1.2.3',3,['SV1','SV2','SV3'],['SV1','SV2','SV3']],
 ['IS-9.16.6.13',4,[],['IS9','IS16','IS6','IS13']],
 ['IS-9.16,6.13',4,[],['IS9','IS16','IS6','IS13']],
 // one tag, commas between embryo numbers
 ['IS-9,16,6,13',4,['IS9','IS16','IS6','IS13'],['IS9','IS16','IS6','IS13']],
 ['IH-1,2',2,[],['IH1','IH2']],
 ['.MR-1,2,3',3,[],['MR1','MR2','MR3']],
 ['.PP-1,2,3,',3,[],['PP1','PP2','PP3']],
 ['DM-A,B,C,D',4,[],['DMA','DMB','DMC','DMD']],
 ['AS-E1,E2',2,['ASE1'],['ASE1','ASE2']],
 ['002E-1,2',2,[],['002E1','002E2']],
 ['K-1,2,3,4,5,6,GH1',7,[],['K1','K2','K3','K4','K5','K6','KGH1']],
 // no hyphen: bare numbers take the letters of the tag before them
 ['NV1,2,3,4,5',5,[],['NV1','NV2','NV3','NV4','NV5']],
 ['SN 1,2',2,[],['SN1','SN2']],
 ['NS1,2,NS4',3,[],['NS1','NS2','NS4']],
 ['SL#01,02,03',3,[],['SL01','SL02','SL03']],
 // every item written out in full
 ['JA-1, JA-2',2,['JA1','JA2'],['JA1','JA2']],
 ['SN-1,SN2',2,[],['SN1','SN2']],
 ['KM-1(H), KM-2(D)',2,[],['KM1H','KM2D']],
 ['PG,PG-1,2',3,[],['PG','PG1','PG2']],
 ['DS,DS-2,3',3,[],['DS','DS2','DS3']],
 ['VCB,VCC',2,[],['VCB','VCC']],
 ['MAA,MAB,MAC',3,[],['MAA','MAB','MAC']],
 ['SR1,SR1A,SR9,SR11,SR7,SR',6,[],['SR1','SR1A','SR9','SR11','SR7','SR']],
 // uploaded results settle a mixed spelling
 ['TL-2,5,10,M1',4,['TL2','TL5','TL10','M1'],['TL2','TL5','TL10','M1']],
 ['MS0-1,2,3,4',4,['MS1','MS2','MS3','MS4'],['MS1','MS2','MS3','MS4']],
 ['MS0-1,2,3,4',4,[],['MS01','MS02','MS03','MS04']],
 // a single embryo, and sequencer suffixes stripped
 ['IS1',1,['IS1'],['IS1']],
 ['AF/AFCC',1,[],['AFAFCC']],
 ['FZ-3.1,3.2-NICS',2,[],['FZ31','FZ32']],
 ['',1,[],[]],
 // the sheet's count is wrong: keep what the name says rather than invent or drop embryos
 ['KJE-1,2,3,4',1,[],['KJE1','KJE2','KJE3','KJE4']],
 ['SK1',2,[],['SK1']],
];

for(const[name,n,known,want]of CASES)
 test(`${JSON.stringify(name)} (${n} embryo${n>1?'s':''}${known.length?', results '+known.join('/'):''})`,()=>assert.deepStrictEqual(tags(name,n,known),want));

test('never lists the same embryo twice',()=>{for(const[name,n,known]of CASES){const t=tags(name,n,known);assert.strictEqual(new Set(t).size,t.length,name)}});
