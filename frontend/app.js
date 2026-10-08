let currentUser={username:'',role:''};
function renderSessionUser(name,role){
  const el=document.getElementById('sessionUsername');if(!el)return;
  const label=role&&name.toLowerCase()!==role.toLowerCase()?`${name} · ${role}`:name;
  el.innerHTML=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span></span>`;
  el.querySelector('span').textContent=label;
  el.classList.toggle('hidden',!name);
}
async function loadWhoAmI(){
  // Identity comes from the parent app via X-Auth-User/X-Auth-Role headers it
  // attaches server-side; this just reflects back what the backend saw.
  try{
    const r=await fetch('/api/whoami');
    if(r.ok)currentUser=await r.json();
  }catch(e){}
  renderSessionUser(currentUser.username,currentUser.role);
  const lo=document.getElementById('logoutBtn');if(lo&&currentUser.username&&currentUser.signedIn){lo.hidden=false;lo.onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/login'}}
}
(function sessionMenu(){
  const btn=document.getElementById('sessionUsername'),menu=document.getElementById('sessionMenu');
  if(!btn||!menu)return;
  const setOpen=open=>{menu.classList.toggle('hidden',!open);btn.setAttribute('aria-expanded',String(open))};
  btn.addEventListener('click',e=>{e.stopPropagation();setOpen(menu.classList.contains('hidden'))});
  document.addEventListener('click',e=>{if(!menu.contains(e.target))setOpen(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
})();
document.querySelectorAll('.session-menu-item').forEach(b=>b.addEventListener('click',()=>{document.getElementById('sessionMenu')?.classList.add('hidden');document.getElementById('sessionUsername')?.setAttribute('aria-expanded','false')}));
let experiments=[];
let cases=[];
let lastRegionCounts={};
let lastClientCounts={};
let lastTestCounts={};
let monthFilterDefaulted=false;let sortNewestFirst=false;let frozenColumnKeys=new Set();let registryViewMode='embryo';
function applyColumnFreeze(container,n){const table=container?.querySelector('table');if(!table)return;table.querySelectorAll('[data-frozen]').forEach(el=>{el.style.position='';el.style.left='';el.style.zIndex='';el.removeAttribute('data-frozen');el.classList.remove('freeze-edge')});if(!n)return;const headCells=[...table.querySelectorAll('thead th')].slice(0,n);let offset=0;const offsets=headCells.map(c=>{const o=offset;offset+=c.getBoundingClientRect().width;return o});table.querySelectorAll('tr').forEach(tr=>{for(let i=0;i<offsets.length;i++){const cell=tr.children[i];if(!cell)continue;cell.style.position='sticky';cell.style.left=`${offsets[i]}px`;cell.style.zIndex=tr.closest('thead')?3:2;cell.setAttribute('data-frozen','1');cell.classList.toggle('freeze-edge',i===offsets.length-1)}})}
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
async function kvGet(key){try{const r=await fetch(`/api/store/${encodeURIComponent(key)}`);if(!r.ok)return null;const d=await r.json();return d.value}catch(e){return null}}
async function kvSet(key,value){try{await fetch(`/api/store/${encodeURIComponent(key)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})})}catch(e){}}
const save=async()=>{await kvSet('embryomatrix-experiments',experiments)};
function renderExperiments(items=experiments){
 const list=$('#experimentList'); if(!list)return; list.innerHTML='';
 items.slice(0,6).forEach((x,i)=>{const row=document.createElement('div');row.className='experiment-row';row.innerHTML=`<span class="exp-avatar ${['a','b','c','d'][i%4]}">${x.owner||'AP'}</span><div><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.project)} · ${escapeHtml(x.next||'No next action')}</p></div><div><time>${x.updated}</time><small class="tag ${x.status==='In progress'?'green-tag':x.status==='Planned'?'amber-tag':'blue-tag'}">${x.status}</small></div>`;list.append(row)});
 $('#noteExperiment').innerHTML=experiments.map(x=>`<option>${escapeHtml(x.name)}</option>`).join('');
}
function escapeHtml(s=''){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function safeClass(s=''){return String(s).toLowerCase().replace(/[^a-z0-9_-]/g,'')}
const MONTH_TAB_NAMES=['january','february','march','april','may','june','july','august','september','october','november','december'];
function tabMonthKey(label){const m=/^([a-z]+)\s+(\d{4})$/i.exec(String(label||'').trim());if(!m)return'';const idx=MONTH_TAB_NAMES.indexOf(m[1].toLowerCase());return idx<0?'':`${m[2]}-${String(idx+1).padStart(2,'0')}`}
function recordMonth(r){const label=String(r._importSource||'').trim();if(!label)return'';return tabMonthKey(label)||label}
function isDateMonth(v){return /^\d{4}-\d{2}$/.test(v)}
function monthLabel(v,fmt={month:'long',year:'numeric'}){return isDateMonth(v)?new Date(`${v}-02`).toLocaleDateString('en',fmt):v}
function storageInfo(r={}){return{barcode:field(r,['barcode','tube id','tube number','sample tube id']),freezer:field(r,['freezer','storage freezer','freezer name']),rack:field(r,['rack','rack number','storage rack']),box:field(r,['storage box','box id','box number']),position:field(r,['position','box position','slot','well position']),status:field(r,['storage status','sample status','inventory status'])||'Not recorded',date:field(r,['stored date','storage date','date stored']),notes:field(r,['movement notes','storage notes','retrieval notes'])}}
function transferInfo(r={}){const flag=field(r,['transferred']).trim().toUpperCase(),sheetStatus=flag==='YES'?'Transferred':flag==='NO'?'Not transferred':'';return{purpose:field(r,['transfer purpose','internal test purpose','purpose'])||'Not transferred',department:field(r,['destination department','transfer department','department']),status:field(r,['transfer status','internal transfer status'])||sheetStatus||'Not transferred',details:field(r,['transfer details']),sentDate:field(r,['transfer sent date','sent date','dispatch date']),sentBy:field(r,['sent by','transferred by','handover by']),receivedBy:field(r,['transfer received by','accepted by']),receivedDate:field(r,['transfer received date']),returnDate:field(r,['return date','returned date']),remarks:field(r,['transfer remarks','chain of custody notes','handover notes'])}}
function seqPlatformCanonicalMap(embryos){const compactKey=s=>s.trim().toUpperCase().replace(/[\s-]+/g,''),variantCounts={};embryos.forEach(e=>{const raw=field(e,['seq platform']);if(!raw)return;const key=compactKey(raw);(variantCounts[key]=variantCounts[key]||{})[raw]=(variantCounts[key][raw]||0)+1});const canonical={};Object.entries(variantCounts).forEach(([key,variants])=>{canonical[key]=Object.entries(variants).sort((a,b)=>b[1]-a[1])[0][0]});return{compactKey,canonical}}
function reportStatus(r={}){const has=k=>!!field(r,[k]);return (has('attune upload')&&has('ngs report'))||isCompleteOnSeq(r,r._case)?'Completed':'Pending'}
function progressStage(r={}){const has=k=>!!field(r,[k]);if(has('date sample received')&&has('wga done on')&&((has('seq date')&&has('attune upload')&&has('ngs report'))||isCompleteOnSeq(r,r._case)))return 4;if(has('date sample received')&&has('wga done on')&&has('seq date'))return 3;if(has('date sample received')&&has('wga done on'))return 2;if(has('date sample received'))return 1;return 0}
function caseProgressStage(c){const list=c.embryos?.length?c.embryos:[{}];return Math.min(...list.map(progressStage))}
function progressStepper(stage,r={}){const labels=['Received','WGA','Sequencing','Report preparation','Report send'];const dateFields=['date sample received','wga done on','seq date','attune upload','ngs report'];const states=({0:['active','pending','pending','pending','pending'],1:['done','active','pending','pending','pending'],2:['done','done','active','pending','pending'],3:['done','done','done','active','pending']})[stage]||['done','done','done','done','done'];const check='<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';return `<div class="progress-stepper">${labels.map((label,i)=>{const date=states[i]==='done'?field(r,[dateFields[i]]):'';return `${i?`<div class="progress-line ${states[i-1]==='done'?'done':'pending'}"></div>`:''}<div class="progress-step ${states[i]}"><span class="progress-dot">${states[i]==='done'?check:i+1}</span><span class="progress-label">${label}</span>${date?`<span class="progress-date">${escapeHtml(date)}</span>`:''}</div>`}).join('')}</div>`}
function caseMatchesMonth(c,month){if(!month)return true;return c.embryos?.length?c.embryos.some(e=>recordMonth(e)===month):false}
// Each sheet row's own standard test name (a sample can span rows with different tests).
function rowTestName(e){return canonicalTestName(field(e,['test name','test']))||'Not recorded'}
// Sequencing run(s) of a sample, from the batch record sheet's "Run ID" ("101A, 106A").
function caseKnownRuns(c){const set=new Set;(c.embryos||[]).forEach(e=>runsOf(e).forEach(r=>set.add(r)));return [...set]}
function runsOf(e){return String(field(e,['run id'])||'').split(',').map(x=>x.trim()).filter(Boolean)}
function filteredCases(){const keys=['embryologist','client','region','result'],test=$('#testFilter')?.value||'',q=$('#patientSearch').value.toLowerCase(),
  // Searching means "I don't know which month sheet this is in" - so a search term
  // overrides the month filter instead of being narrowed by it, across every sheet.
  month=q?'':($('#samplesMonthFilter')?.value||''),storage=$('#storageFilter')?.value||'',transfer=$('#transferFilter')?.value||'',report=$('#reportStatusFilter')?.value||'',run=$('#runFilter')?.value||'';return cases.filter(c=>(!q||(c.patient+' '+c.id+' '+c.test+' '+c.client).toLowerCase().includes(q))&&keys.every(k=>!$(`#${k}Filter`).value||c[k]===$(`#${k}Filter`).value)&&(!test||(c.embryos?.length?c.embryos.some(e=>rowTestName(e)===test):c.test===test))&&caseMatchesMonth(c,month)&&(!storage||c.embryos?.some(e=>storageInfo(e).status===storage))&&(!transfer||c.embryos?.some(e=>transferInfo(e).status===transfer))&&(!report||(report==='prep'?c.embryos?.some(e=>isReportPrep(e)):c.embryos?.some(e=>reportStatus(e)===report)))&&(!run||c.embryos?.some(e=>runsOf(e).includes(run))))}
// DNA readings are stored per sample as "AS1: 18.8, AS2: 25"; an embryo row shows only its own.
// Display names for registry / export column headings; the stored field names stay as they are.
const COLUMN_LABELS={'dna conc unpurified':'WGA CONC UNPURIFIED','dna conc purified':'WGA CONC PURIFIED','tat date':'TAT'};
function columnLabel(k){return COLUMN_LABELS[k]||String(k).toUpperCase()}
const DNA_FIELDS=['dna conc unpurified','dna conc purified','dna conc'];
function ownDnaValue(text,embryo){const t=String(text||'').trim();if(t==='-')return'-';const want=cleanId(embryo),num=(/(\d+)\D*$/.exec(String(embryo))||[])[1];for(const part of t.split(',')){const m=/^\s*([^:]+):\s*(.+?)\s*$/.exec(part);if(!m)continue;const tag=m[1].trim();if(cleanId(tag)===want||(/^\d+$/.test(tag)&&num&&Number(tag)===Number(num)))return m[2]}return''}
function withOwnDna(e){const name=field(e,['embryo name','embryo id']),out={...e};delete out['wga conc'];DNA_FIELDS.forEach(f=>{if(f in out)out[f]=ownDnaValue(out[f],name)});return out}
// Per embryo, a concentration shows in one column only:
// - inconclusive in the result file's summary (result says INCONCLUSIVE or NA): unpurified
//   "-", purified = its WGA conc. from the Inconclusive tab ("-" if that tab has none);
// - every other embryo: unpurified = the batch sheet's DNA Conc., purified "-".
// Rows are written per tag ("SV1: 0.157, SV2: -"), or a plain "-" when nothing applies.
const isInconclusiveResult=p=>!!p&&(/inconclusive/i.test(p['pgt result']||'')||/^n\/?a$/i.test(String(p['pgt result']||'').trim())||!!String(p['wga conc']||'').trim());
function withResultDna(r){const out={...r};delete out['wga conc'];const own=r._embryoResults||{},tags=expandEmbryoTags(field(r,['embryo name','embryo id'])),unp=r['dna conc unpurified'];
 const inc=new Set(tags.filter(t=>isInconclusiveResult(own[t])));
 const pur=tags.map(t=>[t,inc.has(t)?String(own[t]['wga conc']||'').trim():'']);
 out['dna conc purified']=pur.some(([,v])=>v)?pur.map(([t,v])=>`${t}: ${v||'-'}`).join(', '):'-';
 if(inc.size&&unp){const vals=tags.map(t=>[t,inc.has(t)?'':ownDnaValue(unp,t)]);out['dna conc unpurified']=vals.some(([,v])=>v&&v!=='-')?vals.map(([t,v])=>`${t}: ${v||'-'}`).join(', '):'-'}
 return out}
// Karyotype column for the registry: each embryo's own call (MWF for a normal/mosaic
// result, NORMAL WF for abnormal - same priority as the patient dialog), one per tag.
function withKaryotype(r){const out={...r},own=r._embryoResults||{},vals=expandEmbryoTags(field(r,['embryo name','embryo id'])).map(t=>[t,String(own[t]?.['karyotype mwf']||own[t]?.['karyotype normal wf']||'').trim()]);out['karyotype']=vals.some(([,v])=>v)?vals.map(([t,v])=>`${t}: ${v||'-'}`).join(', '):'-';return out}
// Manual corrections (saved via /api/cell-edits, stored in cell_edits.xlsx - not the
// database) override a specific embryo's value within these joined per-row columns.
let cellEditsMap=new Map();
async function loadCellEdits(){try{const r=await fetch('/api/cell-edits');const list=r.ok?await r.json():[];cellEditsMap=new Map(list.map(e=>[`${cleanId(e.sampleId)}|${cleanId(e.embryo)}|${e.column}`,e.value]))}catch(e){cellEditsMap=new Map()}}
const CELL_EDIT_EXISTING={
 'dna conc unpurified':(r,t)=>ownDnaValue(r['dna conc unpurified'],t)||'',
 'dna conc purified':(r,t)=>String((r._embryoResults||{})[t]?.['wga conc']||'').trim(),
 'karyotype':(r,t)=>String((r._embryoResults||{})[t]?.['karyotype mwf']||(r._embryoResults||{})[t]?.['karyotype normal wf']||'').trim(),
 'pgt result':(r,t)=>String((r._embryoResults||{})[t]?.['pgt result']||'').trim(),
};
// The ID an edit is saved under: the sheet's sample ID / box number, or - for rows with
// neither (e.g. some re-biopsy and POC rows) - the patient name + date received, so every
// embryo row can be edited.
function editSampleId(r){return field(r,['sample id','sample no','box number'])||[field(r,['patient name'])||r._case?.patient||'',field(r,['date sample received'])].filter(Boolean).join(' ')}
// The embryo an edit is saved under: the single tag in the embryo name ("DS-1" -> DS1), or -
// when the name doesn't read as exactly one tag ("SR-2.1", "APA", blank) - the whole name.
function editEmbryoTag(name){const tags=expandEmbryoTags(name);return tags.length===1?tags[0]:String(name||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
function withCellEdits(r){
 if(!cellEditsMap.size)return r;
 const sampleId=editSampleId(r),name=field(r,['embryo name','embryo id','embryo']),whole=editEmbryoTag(name);let tags=expandEmbryoTags(name);
 if(!sampleId)return r;
 const sid=cleanId(sampleId);let out=null,perEmbryo=null;
 // Names that don't read as tags are keyed by each comma-separated part's whole name
 // ("APA,APB" -> APA, APB; blank -> ""), like the Embryo view splits them (see editEmbryoTag).
 const hasEdit=t=>Object.keys(CELL_EDIT_EXISTING).some(c=>cellEditsMap.has(`${sid}|${t}|${c}`));
 if(!tags.length)tags=[...new Set(String(name||'').split(',').map(p=>editEmbryoTag(p.trim())))];
 else if(tags.length!==1&&hasEdit(whole))tags=[whole];
 for(const col of Object.keys(CELL_EDIT_EXISTING)){
  const editedTags=tags.filter(t=>cellEditsMap.has(`${sid}|${t}|${col}`));
  if(!editedTags.length)continue;
  const vals=tags.map(t=>{const ek=`${sid}|${t}|${col}`;return[t,cellEditsMap.has(ek)?cellEditsMap.get(ek):CELL_EDIT_EXISTING[col](r,t)]});
  if(!out)out={...r};
  out[col]=vals.some(([,v])=>v)?(tags.length===1&&!tags[0]?(vals[0][1]||'-'):vals.map(([t,v])=>`${t}: ${v||'-'}`).join(', ')):'-';
  // Embryo view / the patient dialog read karyotype and pgt result per-tag from
  // _embryoResults rather than re-parsing the joined string (unlike the DNA columns),
  // so the edit needs to land there too or it won't show up outside Patient view.
  if(col==='karyotype'||col==='pgt result'){
   if(!perEmbryo)perEmbryo={...(r._embryoResults||{})};
   editedTags.forEach(t=>{const val=cellEditsMap.get(`${sid}|${t}|${col}`);perEmbryo[t]={...(perEmbryo[t]||{})};if(col==='karyotype'){perEmbryo[t]['karyotype mwf']=val;delete perEmbryo[t]['karyotype normal wf']}else{perEmbryo[t]['pgt result']=val}});
  }
 }
 if(perEmbryo)out._embryoResults=perEmbryo;
 return out||r;
}
// PGT-M tab: the Samples table limited to PGT-M and HLA-C typing tests (PGT-A+M is not included).
let samplesScope='';
const pgtmTestKey=e=>String(field(e,['test name','test'])||'').toUpperCase().replace(/[^A-Z+]/g,'');
const hasPgtM=e=>/PGTM|PGTA\+M/.test(pgtmTestKey(e)),hasHlaC=e=>/HLA|HLC/.test(pgtmTestKey(e));
const isPgtmSample=e=>hasPgtM(e)||hasHlaC(e);
// Samples and PGT-M tabs: one button per sheet tab (Pending, month tabs, NOT REPORTING...) above the table, driving the month/sheet filter.
let pgtmSavedMonth=null;
function renderSheetTabs(){let bar=$('#sheetTabs');const table=$('#caseTable');if(!table)return;if(!bar){bar=document.createElement('div');bar.id='sheetTabs';bar.className='prep-segments sheet-tabs';table.parentNode.insertBefore(bar,table);bar.onclick=e=>{const b=e.target.closest('[data-sheet]');if(!b)return;const sms=$('#samplesMonthFilter');if(sms)sms.value=b.dataset.sheet;renderCases()}}
 bar.classList.remove('hidden');const sel=$('#samplesMonthFilter')?.value||'',counts={};allEmbryos().filter(e=>!samplesScope||isPgtmSample(e)).forEach(e=>{const m=recordMonth(e);if(m)counts[m]=(counts[m]||0)+1});
 const keys=Object.keys(counts),tabs=[...keys.filter(k=>k==='Pending'),...keys.filter(isDateMonth).sort().reverse(),...keys.filter(k=>k!=='Pending'&&!isDateMonth(k)).sort()];
 bar.innerHTML=[['','All',tabs.reduce((n,k)=>n+counts[k],0)],...tabs.map(k=>[k,monthLabel(k),counts[k]])].map(([k,l,n])=>`<button type="button" class="prep-seg${k===sel?' active':''}" data-sheet="${escapeHtml(k)}">${escapeHtml(l)} <b>${n}</b></button>`).join('')}
// Test dropdown lists only the tests present in the current tab (PGT-M tab: tests containing PGT-M / HLA-C).
function refreshTestFilterOptions(){const sel=$('#testFilter');if(!sel)return;const cur=sel.value,names=[...new Set(allEmbryos().filter(e=>!samplesScope||isPgtmSample(e)).map(rowTestName))].sort();sel.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());names.forEach(v=>sel.add(new Option(v,v)));sel.value=names.includes(cur)?cur:''}
// PGT-M tab: these samples are not reported by the PGT-A team - PGT-M goes to the Microarray team, HLA-C typing to the HLA team.
// The cards count, per team, how many were handed over and how many are still to transfer; a card click filters the table.
let pgtmCard=null;
const teamsOf=e=>{const a=[];if(hasPgtM(e))a.push('Microarray');if(hasHlaC(e))a.push('HLA');return a};
const isTransferred=e=>transferInfo(e).status==='Transferred';
const pgtmCardOk=e=>!pgtmCard||(teamsOf(e).includes(pgtmCard.team)&&isTransferred(e)===(pgtmCard.status==='done'));
function renderTransferCards(){const old=$('#samplesView .stats-3col:not(#transferCards)'),host=old?.parentNode;if(!host)return;let el=$('#transferCards');if(!samplesScope){if(el)el.style.display='none';old.style.display='';return}
 old.style.display='none';if(!el){el=document.createElement('div');el.id='transferCards';el.className='stats stats-3col transfer-cards';host.insertBefore(el,old);el.onclick=e=>{const a=e.target.closest('[data-team]');if(!a)return;const same=pgtmCard&&pgtmCard.team===a.dataset.team&&pgtmCard.status===a.dataset.status;pgtmCard=same?null:{team:a.dataset.team,status:a.dataset.status};renderCases()}}
 el.style.display='';const rows=allEmbryos().filter(e=>isPgtmSample(e)&&!isNotReporting(e)),n=(team,done)=>rows.filter(e=>teamsOf(e).includes(team)&&isTransferred(e)===done).length;
 const defs=[['Microarray','done','PGT-M Team · transferred','#1f8a52'],['Microarray','todo','PGT-M Team · need to transfer','#c07a1d'],['HLA','done','HLA team · transferred','#1f8a52'],['HLA','todo','HLA team · need to transfer','#c07a1d']];
 el.innerHTML=defs.map(([t,st,l,c])=>`<article class="stat-card stat-card-link${pgtmCard&&pgtmCard.team===t&&pgtmCard.status===st?' stat-active':''}" data-team="${t}" data-status="${st}" role="button" tabindex="0" style="--c:${c}" title="Click to list these samples"><div class="tc-row"><strong>${n(t,st==='done').toLocaleString()}</strong><img class="ico" src="/static/icons/departments__${t==='HLA'?'hla':'microarray'}.png" alt=""></div><small class="tc-label">${l}</small></article>`).join('')}
function embryoDataset(){const q=$('#patientSearch')?.value.toLowerCase()||'',month=q?'':($('#samplesMonthFilter')?.value||''),test=$('#testFilter')?.value||'',run=$('#runFilter')?.value||'';const rows=filteredCases().flatMap(c=>(c.embryos?.length?c.embryos.filter(e=>(!samplesScope||(isPgtmSample(e)&&pgtmCardOk(e)))&&(!month||recordMonth(e)===month)&&(!test||rowTestName(e)===test)&&(!run||runsOf(e).includes(run))):(samplesScope?[]:[{}])).map((e,i)=>({case:c,embryo:e,identity:c.embryos?.length?resultIdentity(e):{embryo:`Sample ${i+1}`},outcome:e._outcome||c.result})));
  const expanded=registryViewMode==='embryo'?rows.flatMap(x=>{const variants=expandEmbryoRow(x.embryo);if(variants.length<=1)return[x];const numKey=Object.keys(x.embryo).find(k=>k.includes('number of embryos'));return variants.map(v=>{const own=withOwnDna(v);return {...x,embryo:numKey?{...own,[numKey]:'1'}:own}})}):rows;
  return expanded.sort((a,b)=>(a.embryo._seq??0)-(b.embryo._seq??0))}
const MIN_COLUMN_FILL_RATE=0.10,ALWAYS_SHOW_COLUMNS=new Set(['hospital clinic name']),PINNED_COLUMNS=['dna conc unpurified','dna conc purified','embryo grade','karyotype','pgt result','transferred','transferred on','transferred department','transfer details'];
function embryoColumns(rows){const seen=new Set(),cols=[];rows.forEach(x=>Object.keys(x.embryo||{}).forEach(k=>{if(k.startsWith('_')||seen.has(k))return;seen.add(k);cols.push(k)}));PINNED_COLUMNS.forEach(k=>{if(!seen.has(k)){seen.add(k);cols.push(k)}});const total=rows.length||1;let filtered=cols.filter(k=>{if(PINNED_COLUMNS.includes(k))return true;const filled=rows.reduce((n,x)=>n+(String(x.embryo?.[k]??'').trim()!==''?1:0),0);return filled>0&&(ALWAYS_SHOW_COLUMNS.has(k)||/dna.*conc|conc.*dna|pgt result|embryo grade|wga conc/.test(k)||filled/total>=MIN_COLUMN_FILL_RATE)});const reorder=(afterPattern,keyPattern)=>{const afterKey=filtered.find(k=>afterPattern.test(k)),movedKey=filtered.find(k=>keyPattern.test(k));if(afterKey&&movedKey&&afterKey!==movedKey){filtered=filtered.filter(k=>k!==movedKey);filtered.splice(filtered.indexOf(afterKey)+1,0,movedKey)}};reorder(/embryo name|embryo id/,/dna conc unpurified/);reorder(/dna conc unpurified/,/dna conc purified/);reorder(/dna conc purified/,/^embryo grade$/);reorder(/^embryo grade$/,/^karyotype$/);reorder(/^karyotype$/,/pgt result/);reorder(/^transferred$/,/^transfer details$/);if(filtered.includes('date sample received'))filtered.push('tat date');return filtered}
// TAT date: received date + 21 days for Embryo Sure and HLA tests, + 10 days for everything else.
function tatDate(e,c){const rec=parseSheetDate(field(e,['date sample received']));if(!rec)return'';const test=canonicalTestName(field(e,['test','test name']))||c?.test||'',d=new Date(rec);d.setDate(d.getDate()+(/embryo\s*sure|hla/i.test(test)?21:10));return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`}
const cellValue=(x,k)=>k==='tat date'?tatDate(x.embryo,x.case):x.embryo[k]
// Overdue: TAT date has passed and the NGS report date is still empty.
// Samples in the NOT REPORTING sheet are cancelled, so they are never counted as overdue.
const isNotReporting=e=>/not\s*reporting/i.test(String(e._importSource||''));
// Embryo Sure and Embryology Validation complete on the WGA date alone (no SEQ date needed).
// These need no separate report date: once the SEQ date is filled they count as completed (PGT-A+M, PGT-M, Embryo validation, HLA-C typing,
// and anything in the MaReCs or NOT REPORTING sheets).
const SEQ_ONLY_TESTS=/A\+M|PGTM|HLA/;
const WGA_ONLY_TESTS=/EMBRYOSURE|VALIDATION/;
function isCompleteOnSeq(e,c){const t=String(field(e,['test','test name'])||c?.test||'').toUpperCase().replace(/[^A-Z+]/g,'');if(field(e,['wga done on'])&&WGA_ONLY_TESTS.test(t))return true;if(!field(e,['seq date']))return false;return SEQ_ONLY_TESTS.test(t)||/mare?cs/i.test(String(e._importSource||''))||isNotReporting(e)}
function isOverdue(e,c){if(isNotReporting(e)||isCompleteOnSeq(e,c))return false;const tat=parseSheetDate(tatDate(e,c));if(!tat||field(e,['ngs report']))return false;const today=new Date();today.setHours(0,0,0,0);return tat<today}
let homeUnit=(()=>{try{return localStorage.getItem('em-home-unit')==='samples'?'samples':'embryos'}catch{return'embryos'}})();
const homeCount=list=>homeUnit==='samples'?list.length:list.reduce((s,e)=>s+embryoRowsOf(e).length,0);
function syncOverdueCard(){const stat=$('#overdueStat');if(stat)stat.textContent=homeCount(allEmbryos().filter(e=>isOverdue(e,e._case))).toLocaleString()}
const PIN_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
function fitTableHeight(el){if(!el)return;const top=el.getBoundingClientRect().top;let h=Math.max(240,window.innerHeight-top-24);el.style.maxHeight=`${h}px`;const overflow=document.documentElement.scrollHeight-window.innerHeight;if(overflow>0){h=Math.max(240,h-overflow);el.style.maxHeight=`${h}px`}}
window.addEventListener('resize',()=>{fitTableHeight($('#caseTable .embryo-columns-table'));fitTableHeight($('#rebiopsyTableWrap'))});
const EDITABLE_REGISTRY_COLS=new Set(['dna conc unpurified','dna conc purified','karyotype','pgt result']);
function renderCases(){if(editingCell()&&$('#caseTable')?.contains(document.activeElement)){casesRefreshWaiting=true;return}syncOverdueCard();renderSheetTabs();renderTransferCards();casesRender={rows:[],cols:[]};const datasetRows=embryoDataset(),rows=sortNewestFirst?[...datasetRows].reverse():datasetRows,empty='<div class="empty-action"><h3>No records available</h3><p>Import the monthly register and embryo result files, or clear the current filters.</p><button class="primary" data-view="import">Upload result</button></div>',naturalCols=embryoColumns(rows),cols=[...naturalCols.filter(k=>frozenColumnKeys.has(k)),...naturalCols.filter(k=>!frozenColumnKeys.has(k))],chipCols=new Set(['sample id','box number','case id']);if(samplesScope){const tc=['transferred','transferred on','transferred department','transfer details'].filter(k=>cols.includes(k));if(tc.length){const rest=cols.filter(k=>!tc.includes(k)),i=rest.indexOf('test name');cols.splice(0,cols.length,...rest.slice(0,i+1),...tc,...rest.slice(i+1))}}{const pc=$('#pgtmCount');if(pc)pc.textContent=(samplesScope?rows.length:allEmbryos().filter(isPgtmSample).length).toLocaleString()}if($('#registryCount'))$('#registryCount').textContent=rows.length?`· ${rows.length.toLocaleString()} records`:'';const embryoStat=$('#samplesEmbryoStat');if(embryoStat)embryoStat.textContent=rows.reduce((s,x)=>s+embryoRowsOf(x.embryo).length,0).toLocaleString();const caseCountEl=$('#caseCount');if(caseCountEl)caseCountEl.textContent=registryViewMode==='embryo'?allEmbryos().flatMap(expandEmbryoRow).length:allEmbryos().length;casesRender={rows,cols};$('#caseTable').innerHTML=`<div class="embryo-columns-table"><table><thead><tr>${cols.map(k=>`<th>${escapeHtml(columnLabel(k))}<button class="col-freeze-btn${frozenColumnKeys.has(k)?' pinned':''}" data-freeze-col="${escapeHtml(k)}" title="${frozenColumnKeys.has(k)?'Unfreeze this column':'Freeze this column'}">${PIN_ICON}</button></th>`).join('')}</tr></thead><tbody>${rows.map((x,ri)=>{const focus=registryViewMode==='embryo'?embryoDisplayId(x.embryo):'';return `<tr data-ri="${ri}" data-case="${escapeHtml(x.case.id)}"${focus?` data-embryo-focus="${escapeHtml(focus)}"`:''}>${cols.map(k=>{const v=String(cellValue(x,k)??'');if(chipCols.has(k))return `<td>${v?`<span class="id-chip">${escapeHtml(v)}</span>`:''}</td>`;if(registryViewMode==='embryo'&&EDITABLE_REGISTRY_COLS.has(k)&&canEditResults()){const sampleId=editSampleId(x.embryo),tag=editEmbryoTag(field(x.embryo,['embryo name','embryo id','embryo']));if(sampleId)return `<td class="editable-cell" contenteditable="true" spellcheck="false" title="Click to edit" data-sample-id="${escapeHtml(sampleId)}" data-embryo="${escapeHtml(tag)}" data-column="${escapeHtml(k)}" data-original="${escapeHtml(v)}">${escapeHtml(v)}</td>`}return `<td${v.length>40?` class="wrap-cell" title="${escapeHtml(v)}"`:''}>${escapeHtml(v)}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div>`+(rows.length?'':empty);$$('[data-case]').forEach(r=>r.onclick=()=>openPatient(cases.find(c=>c.id===r.dataset.case),r.dataset.embryoFocus||''));$$('#caseTable [data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));$$('#caseTable [data-freeze-col]').forEach(b=>b.onclick=e=>{e.stopPropagation();const k=b.dataset.freezeCol;if(frozenColumnKeys.has(k))frozenColumnKeys.delete(k);else frozenColumnKeys.add(k);renderCases()});applyColumnFreeze($('#caseTable'),frozenColumnKeys.size);updateFiltersBadge();fitTableHeight($('#caseTable .embryo-columns-table'));wireEditableCells()}
// Samples > Embryo view rows as last rendered - an edit sends its whole row to the edits sheet.
let casesRender={rows:[],cols:[]};
function editRowPayload(td,column,value){const x=casesRender.rows[+td.closest('tr')?.dataset.ri];if(!x)return[];const row=casesRender.cols.map(k=>[columnLabel(k),k===column?value:String(cellValue(x,k)??'')]);if(!casesRender.cols.includes('run id'))row.push(['RUN ID',runsOf(x.embryo).join(', ')]);return row}
// "Edits sheet" link beside Export data, once the Apps Script has created the sheet.
async function syncEditsSheetLink(){try{const r=await fetch('/api/edits-sheet');if(!r.ok)return;const st=await r.json(),a=$('#editsSheetLink');if(!a)return;a.classList.toggle('hidden',!st.url&&!st.error);if(st.url)a.href=st.url;a.title=st.error?`Edits are NOT reaching the sheet: ${st.error}`:st.pending?`${st.pending} edit${st.pending===1?'':'s'} waiting to be sent to the sheet`:'Open the Edited samples Google Sheet';a.classList.toggle('edits-sheet-error',!!st.error);const b=a.querySelector('b');if(b){b.textContent=st.pending||'';b.classList.toggle('hidden',!st.pending)}}catch{}}
syncEditsSheetLink();
// Editing a cell must never lose what the user is typing: the table is not rebuilt while a
// cell has focus (the refresh waits until editing stops), and a rebuild keeps the scroll place.
function editingCell(){return !!document.activeElement?.classList?.contains('editable-cell')}
var casesRefreshWaiting=false;
async function refreshCasesKeepingPlace(){if(editingCell()){casesRefreshWaiting=true;return}casesRefreshWaiting=false;const w=$('#caseTable .embryo-columns-table'),top=w?.scrollTop||0,left=w?.scrollLeft||0,pageY=window.scrollY;await setupCases();if(editingCell()){casesRefreshWaiting=true;return}const w2=$('#caseTable .embryo-columns-table');if(w2){w2.scrollTop=top;w2.scrollLeft=left}window.scrollTo(window.scrollX,pageY)}
function wireEditableCells(){$$('#caseTable .editable-cell').forEach(td=>{td.onclick=e=>e.stopPropagation();
 // "-" is only the empty-cell placeholder: clear it on focus so typing doesn't append to it.
 td.onfocus=()=>{if(td.textContent.trim()==='-'){td.textContent='';td.dataset.placeholder='1'}};td.oninput=()=>{td.dataset.dirty='1'};
 td.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();td.blur()}else if(e.key==='Escape'){td.textContent=td.dataset.original;td.blur()}};
 td.onblur=async()=>{const after=()=>setTimeout(()=>{if(casesRefreshWaiting&&!editingCell())refreshCasesKeepingPlace()},0);let val=td.textContent.trim();const orig=td.dataset.original;
  // Only a real typed change is saved: a click in and out (or blank <-> "-") never sends the row to the sheet.
  const typed=td.dataset.dirty,blank=v=>!v||v==='-';delete td.dataset.dirty;delete td.dataset.placeholder;
  if(!typed||val===String(orig).trim()||(blank(val)&&blank(String(orig).trim()))){td.textContent=orig;after();return}const{sampleId,embryo,column}=td.dataset;td.classList.add('cell-saving');
  try{const res=await fetch('/api/cell-edits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId,embryo,column,value:val,row:editRowPayload(td,column,val)})});if(!res.ok)throw new Error('save failed');const saved=await res.json().catch(()=>({}));
   td.dataset.original=val;td.classList.remove('cell-saving');cellEditsMap.set(`${cleanId(sampleId)}|${cleanId(embryo)}|${column}`,val);
   const st=saved.sheet?.status;toast(st==='sending'||st==='saved'?'Edit saved · sending to the PGS & NIPGS updates sheet':'Edit saved');setTimeout(syncEditsSheetLink,8000);refreshCasesKeepingPlace()}
  catch(err){toast('Could not save edit');td.textContent=orig;td.classList.remove('cell-saving');after()}}})}
function updateFiltersBadge(){const ids=['testFilter','runFilter','clientFilter','embryologistFilter','regionFilter','resultFilter','storageFilter','transferFilter','reportStatusFilter'],active=ids.filter(id=>$(`#${id}`)?.value).length,badge=$('#filtersBadge');if(!badge)return;badge.textContent=active;badge.classList.toggle('has-active',active>0)}
function clinicalOutcome(r){const supplied=field(r,['outcome','overall result']),qc=field(r,['qc']).toUpperCase(),conclusion=field(r,['conclusion']).toLowerCase(),result=field(r,['result']).toLowerCase();if(supplied)return supplied;if(qc==='FAIL'||result.includes('inconclusive'))return'Inconclusive';if(conclusion.includes('no copy number abnormality')||result==='euploid')return'Normal';if(conclusion.includes('abnormal')||conclusion.includes('mosaic')||result.includes('abnormal')||result.startsWith('g-')||result.startsWith('sml-'))return'Abnormal';return field(r,['conclusion','result'])||(qc?'Inconclusive':'N/A')}
// Master client list (clients.js): brand + branch for rows whose center / clinic name we recognise.
function clientFromDirectory(r){return typeof resolveClient==='function'?resolveClient(field(r,['center name']),field(r,['hospital clinic name']),field(r,['location'])):null}
function titleCaseClient(s){return String(s||'').toLowerCase().replace(/(^|[\s(&/-])([a-z])/g,(m,p,c)=>p+c.toUpperCase()).replace(/\b(Ivf|Pvt|Ltd|Llp)\b/g,w=>w.toUpperCase())}
function caseClientFields(res,fallback){if(res)return{client:res.brand,clientBranch:res.branch?.branch||'',clientCode:res.branch?.code||'',clientListed:res.listed};return{client:fallback?titleCaseClient(fallback):'Not assigned',clientBranch:'',clientCode:'',clientListed:false}}
function normalizeClientName(raw){let s=String(raw||'').trim().replace(/\s+/g,' ');if(!s)return'';s=s.toUpperCase().replace(/[-–—.,]+$/,'').trim();s=s.replace(/\bAND\b/g,'&').replace(/\bCENTER\b/g,'CENTRE').replace(/\s+/g,' ').trim();return s}
function levenshtein(a,b){if(a===b)return 0;const m=a.length,n=b.length;if(Math.abs(m-n)>3)return 99;let prev=Array.from({length:n+1},(_,i)=>i);for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++){const cost=a[i-1]===b[j-1]?0:1;cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+cost)}prev=cur}return prev[n]}
function clientTokenSimilar(t1,t2){if(t1===t2)return true;const d=levenshtein(t1,t2),L=Math.max(t1.length,t2.length);if(L<=3)return false;if(L<=6)return d<=1;return d<=2}
const CLIENT_GENERIC_SUFFIXES=new Set(['CENTRE','CLINIC']);
function clientGenericExtension(shortTok,longTok){if(shortTok.length>=longTok.length)return false;for(let i=0;i<shortTok.length;i++)if(shortTok[i]!==longTok[i])return false;return longTok.slice(shortTok.length).every(t=>CLIENT_GENERIC_SUFFIXES.has(t))}
function clientNamesMatch(a,b){const ta=a.split(' '),tb=b.split(' ');if(ta.length===tb.length&&ta.every((t,i)=>clientTokenSimilar(t,tb[i])))return true;if(clientGenericExtension(ta,tb)||clientGenericExtension(tb,ta))return true;const ca=a.replace(/ /g,''),cb=b.replace(/ /g,'');return Math.abs(ca.length-cb.length)<=1&&levenshtein(ca,cb)<=1}
function buildClientCanonicalMap(countsByName){const names=Object.keys(countsByName),parent={};names.forEach(n=>parent[n]=n);const find=x=>{while(parent[x]!==x)x=parent[x];return x};const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent[ra]=rb};for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){const a=names[i],b=names[j];if(Math.abs(a.length-b.length)>14)continue;if(clientNamesMatch(a,b))union(a,b)}const clusters={};names.forEach(n=>{const r=find(n);(clusters[r]=clusters[r]||[]).push(n)});const canonicalFor={};Object.values(clusters).forEach(members=>{const canonical=members.slice().sort((x,y)=>countsByName[y]-countsByName[x])[0];members.forEach(m=>canonicalFor[m]=canonical)});return canonicalFor}
// Embryologist names confirmed by the team to be the same person: every spelling (letters/digits only, upper case) -> the name to show.
const EMBRYOLOGIST_ALIASES={SINDHUJA:'SINDHUJA N S',SINDHIYA:'SINDHUJA N S',SINDHIYANS:'SINDHUJA N S',SIADHUDA:'SINDHUJA N S',DRNSSINDHUJA:'SINDHUJA N S',SINOHUJANS:'SINDHUJA N S',SINDHUJANS:'SINDHUJA N S',
 CHITRAKAMBIR:'CHITRA KAMBLE',SNEHAHALDARKAR:'SNEHA HALDANKAR',SNEHAHALDAKAR:'SNEHA HALDANKAR',HALDARKAR:'SNEHA HALDANKAR',JAYARAMANR:'JAYARAMAN',RJAYARAMAN:'JAYARAMAN',RAJASHEKHARU:'RAJASHEKAR U',RAJSHEKARU:'RAJASHEKAR U',RAJASHEKAR:'RAJASHEKAR U',RAJASHEKHAR:'RAJASHEKAR U',RAJSHEKAR:'RAJASHEKAR U',RAJSHEKHAR:'RAJASHEKAR U',RAJASHEKHARV:'RAJASHEKAR U',NISHANTHSINGH:'NISHANTH SINGH',NISHNTHSINGH:'NISHANTH SINGH',NISHANTH:'NISHANTH SINGH',ARCHANAMANIKUE:'ARCHANA MANIKERE',ARCHANAMANIKUR:'ARCHANA MANIKERE',ARCHANAMARIKERE:'ARCHANA MANIKERE',RAJPRIYAPANDIAN:'RAJ PRIYA PANDIAN',RAJPRIYA:'RAJ PRIYA PANDIAN',UDAYKIRAN:'UDAY KIRAN',UDAYAKIRAN:'UDAY KIRAN',UDHAYKIRAN:'UDAY KIRAN',UADYAKIRAN:'UDAY KIRAN',UDAYKIRAND:'UDAY KIRAN',UDAYAKIRAND:'UDAY KIRAN',TEJANISHUKLA:'TEJASVI SHUKLA',TEJASISHUKLA:'TEJASVI SHUKLA',TEJASSHUKLA:'TEJASVI SHUKLA',TEJASWISHUKLA:'TEJASVI SHUKLA',TEJASVISUKLA:'TEJASVI SHUKLA',TEJASISURKCA:'TEJASVI SHUKLA',VIDYALAKSHMIRBHAT:'VIDYA LAKSHMI R BHAT',VIDHYALAKSHMIRBHAT:'VIDYA LAKSHMI R BHAT',MADUSUDHAN:'MADHUSUDHAN RAO',MADUSUDAN:'MADHUSUDHAN RAO',MADUSUDANRAO:'MADHUSUDHAN RAO',MADHUSUDHAN:'MADHUSUDHAN RAO',MADHUSUDAN:'MADHUSUDHAN RAO',MADHUSUDANRAO:'MADHUSUDHAN RAO',MOHDABDAS:'MOHD AQDAS',MOHDADDAS:'MOHD AQDAS',MOHDABDOS:'MOHD AQDAS'};
function applyEmbryologistAliases(rows){rows.forEach(r=>{const k=fieldKey(r,['embryologist name','embryologist']);if(!k)return;const alias=EMBRYOLOGIST_ALIASES[String(r[k]).toUpperCase().replace(/[^A-Z0-9]/g,'')];if(alias)r[k]=alias});return rows}
async function importedCases(){await loadCellEdits();const rows=applyEmbryologistAliases(((await kvGet('embryomatrix-imported-cases'))||[]).filter(r=>!r._stale).map(withResultDna).map(withKaryotype).map(withCellEdits)),clientCounts={},resolved=new Map();for(const r of rows){const res=clientFromDirectory(r);if(res){resolved.set(r,res);continue}const c=normalizeClientName(field(r,['center name','hospital clinic name','client']));if(c)clientCounts[c]=(clientCounts[c]||0)+1}const clientCanonical=buildClientCanonicalMap(clientCounts),groups=new Map;for(const r of rows){const patient=field(r,['patient name','patient'])||resultIdentity(r).patient||'Unnamed patient',caseId=field(r,['case id']),sampleId=field(r,['sample id','sample no','box number']),received=field(r,['date sample received']),center=field(r,['center name','hospital clinic name','client']),embryoTag=field(r,['embryo name','embryo id','embryo']),id=caseId||sampleId||`IM-${groups.size+1}`,uniquePart=cleanId(caseId||sampleId||'')||cleanId(`${center||''}${received||''}${embryoTag||''}`)||`AUTO${groups.size+1}`,key=`${patient.toLowerCase().replace(/\s+/g,'')}|${uniquePart}`;if(!groups.has(key))groups.set(key,{id,patient,embryologist:field(r,['embryologist name','embryologist'])||'Not assigned',...caseClientFields(resolved.get(r),clientCanonical[normalizeClientName(field(r,['center name','hospital clinic name','client']))]),test:canonicalTestName(field(r,['test name','test']))||'Not recorded',region:field(r,['location','region'])||'Not assigned',result:'Normal',samples:0,images:0,nabl:field(r,['nabl'])||'Pending',source:'Merged',embryos:[]});const c=groups.get(key),outcome=clinicalOutcome(r);if(c.test==='Not recorded'){const t=canonicalTestName(field(r,['test name','test']));if(t)c.test=t}c.samples++;c.embryos.push({...r,_outcome:outcome});if(outcome==='Inconclusive')c.result='Inconclusive';else if(['Abnormal','Fail'].includes(outcome)&&c.result!=='Inconclusive')c.result=outcome}return [...groups.values()]}
async function setupCases(){cases=[...cases.filter(c=>c.source!=='Merged'),...await importedCases()];{const rs=$('#runFilter');if(rs){const cur=rs.value;rs.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());[...new Set(allEmbryos().flatMap(runsOf))].sort((a,b)=>(parseInt(b)||0)-(parseInt(a)||0)||b.localeCompare(a)).forEach(v=>rs.add(new Option(`Run ${v}`,v)));rs.value=[...rs.options].some(o=>o.value===cur)?cur:'';rs.onchange=()=>renderCases()}}$('#caseCount').textContent=allEmbryos().length;['embryologist','client','test','region'].forEach(k=>{const s=$(`#${k}Filter`);s.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());[...new Set(cases.map(c=>c[k]))].sort().forEach(v=>s.add(new Option(v,v)));s.onchange=()=>renderCases()});const ss=$('#storageFilter'),storageSelected=ss.value;ss.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());const statuses=[...new Set(cases.flatMap(c=>(c.embryos||[]).map(e=>storageInfo(e).status)))].sort();statuses.forEach(v=>ss.add(new Option(v,v)));ss.value=statuses.includes(storageSelected)?storageSelected:'';ss.onchange=()=>renderCases();const ts=$('#transferFilter'),transferSelected=ts.value;ts.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());const transferStatuses=[...new Set(cases.flatMap(c=>(c.embryos||[]).map(e=>transferInfo(e).status)))].sort();transferStatuses.forEach(v=>ts.add(new Option(v,v)));ts.value=transferStatuses.includes(transferSelected)?transferSelected:'';ts.onchange=()=>renderCases();const sms=$('#samplesMonthFilter');let samplesSelected=sms?.value||'';const monthValues=cases.flatMap(c=>(c.embryos||[]).map(recordMonth)).filter(Boolean);const months=[...[...new Set(monthValues.filter(isDateMonth))].sort(),...new Set(monthValues.filter(v=>!isDateMonth(v)))];if(!monthFilterDefaulted){monthFilterDefaulted=true;if(months.includes('Pending'))samplesSelected='Pending'}if(sms){sms.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());months.forEach(v=>sms.add(new Option(monthLabel(v),v)));sms.value=months.includes(samplesSelected)?samplesSelected:'';sms.onchange=()=>renderCases()}const CHART_RENDERERS={volumeMonthFilter:renderVolumeChart,testMonthFilter:renderTestChart,outcomeMonthFilter:renderOutcomeChart,clientMonthFilter:renderClientChart,regionMonthFilter:renderRegionChart,platformMonthFilter:renderPlatformChart,qualityMonthFilter:renderQualitySection};Object.entries(CHART_RENDERERS).forEach(([id,renderFn])=>{const sel=$(`#${id}`);if(!sel)return;const current=sel.value;sel.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());months.forEach(v=>sel.add(new Option(monthLabel(v),v)));sel.value=months.includes(current)?current:'';sel.onchange=()=>renderFn(overviewRows())});const clientLegendEl=$('#clientLegend');if(clientLegendEl)clientLegendEl.onclick=e=>{const row=e.target.closest('.legend-row');if(!row)return;toggleLegendSlice(row.dataset.pieId,row.dataset.label,()=>renderClientChart(allEmbryos()))};$('#resultFilter').onchange=()=>renderCases();$('#reportStatusFilter').onchange=()=>renderCases();const prepCard=$('#reportPrepCard');if(prepCard){const openPrep=()=>showView('reportprep');prepCard.onclick=openPrep;prepCard.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPrep()}}}const rebiopsyCard=$('#rebiopsyCard');if(rebiopsyCard){const openRebiopsy=()=>showView('rebiopsy');rebiopsyCard.onclick=openRebiopsy;rebiopsyCard.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openRebiopsy()}}}$('#patientSearch').oninput=()=>renderCases();$('#clearFilters').onclick=()=>{['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';if(sms)sms.value='';renderCases()};$('#downloadCsv').onclick=e=>{e.stopPropagation();$('#exportMenu').classList.toggle('hidden')};$('#exportMenu').onclick=e=>{const b=e.target.closest('[data-format]');if(!b)return;if(b.dataset.format==='excel-all')downloadRegistry('excel',fullRegistryDataset(),'full-registry');else downloadRegistry(b.dataset.format);$('#exportMenu').classList.add('hidden')};$('#filtersToggle').onclick=e=>{e.stopPropagation();$('#filtersPanel').classList.toggle('hidden');$('#filtersToggle').classList.toggle('active');fitTableHeight($('#caseTable .embryo-columns-table'))};$('#filtersPanel').onclick=e=>e.stopPropagation();const viewToggle=$('#registryViewToggle');if(viewToggle)viewToggle.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;registryViewMode=b.dataset.mode;viewToggle.querySelectorAll('.prep-seg').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b))});renderCases()};refreshTestFilterOptions();renderCases();renderAnalytics();renderQcAlerts()}
function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}
function exportDataset(){const rows=embryoDataset(),cols=embryoColumns(rows);return{headers:cols.map(columnLabel),rows:rows.map(x=>cols.map(k=>cellValue(x,k)??''))}}
// Every row currently in the registry, ignoring search/filters/month - "the whole sheet as of now",
// with any manual cell edits already applied (cases is built with the edits overlay).
function fullRegistryDataset(){const rows=cases.flatMap(c=>c.embryos?.length?c.embryos.map((e,i)=>({case:c,embryo:e,identity:resultIdentity(e),outcome:e._outcome||c.result})):[{case:c,embryo:{},identity:{embryo:'Sample 1'},outcome:c.result}]),cols=embryoColumns(rows);return{headers:cols.map(columnLabel),rows:rows.map(x=>cols.map(k=>cellValue(x,k)??''))}}
function downloadFile(content,type,extension,name='registry'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`EmbryoMatrix-${name}-report-${new Date().toISOString().slice(0,10)}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}
function downloadRegistry(format,dataset,name='registry'){if(format==='pdf'){window.print();return}const{headers,rows}=dataset||exportDataset();if(format==='json'){const data=rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])));downloadFile(JSON.stringify({exportedAt:new Date().toISOString(),records:data},null,2),'application/json;charset=utf-8','json',name)}else if(format==='excel'){const cellStyle=` style="mso-number-format:'\\@';"`,table=`<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1"><colgroup>${headers.map(()=>'<col style="width:130px">').join('')}</colgroup><thead><tr>${headers.map(h=>`<th${cellStyle}>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td${cellStyle}>${escapeHtml(String(v??''))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;downloadFile('﻿'+table,'application/vnd.ms-excel','xls',name)}else{const csv='﻿'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');downloadFile(csv,'text/csv;charset=utf-8','csv',name)}toast(`${rows.length} records exported as ${format==='excel'?'Excel':format.toUpperCase()}`)}
function countBy(items,keyFn){return items.reduce((a,x)=>{const k=keyFn(x)||'Unknown';a[k]=(a[k]||0)+1;return a},{})}
function allEmbryos(){return cases.flatMap(c=>c.embryos?.length?c.embryos.map(e=>({...e,_case:c})):Array.from({length:c.samples||1},()=>({_case:c,_outcome:c.result})))}
function truncateLabel(s,n){return s.length>n?s.slice(0,n-1)+'…':s}
function niceMaxOf(max){const magnitude=Math.pow(10,Math.floor(Math.log10(max||1))),residual=(max||1)/magnitude;let niceResidual;if(residual<=1)niceResidual=1;else if(residual<=2)niceResidual=2;else if(residual<=5)niceResidual=5;else niceResidual=10;return niceResidual*magnitude}
// Shared hover for bar-style charts: column band, other columns fade, and a
// tooltip (data-tip JSON: {t:title, r:[[color,label,value]], n:note}) glides along.
function chartTipAttr(o){return escapeHtml(JSON.stringify(o)).replace(/"/g,'&quot;')}
(function barChartHover(){
 let active=null;
 const clear=()=>{if(!active)return;active.svg.classList.remove('ch-hovering');active.svg.querySelectorAll('.ch-col.active,.ch-dot.active').forEach(n=>n.classList.remove('active'));active.tip.classList.remove('show');active=null};
 document.addEventListener('mouseover',e=>{
  const hit=e.target.closest?.('.ch-hit');
  if(!hit){if(active&&!e.target.closest?.('svg.ch-hovering'))clear();return}
  const svg=hit.ownerSVGElement,box=svg.parentElement,col=hit.dataset.col;
  if(active&&active.svg!==svg)clear();
  let tip=box.querySelector(':scope > .lc-tip');if(!tip){tip=document.createElement('div');tip.className='lc-tip';box.append(tip)}
  if(getComputedStyle(box).position==='static')box.style.position='relative';
  svg.classList.add('ch-hovering');
  svg.querySelectorAll('.ch-col,.ch-dot').forEach(n=>n.classList.toggle('active',n.dataset.col===col));
  let d={};try{d=JSON.parse(hit.dataset.tip||'{}')}catch(_){}
  tip.innerHTML=`<span class="lc-month">${escapeHtml(d.t||'')}</span>${(d.r||[]).map(([c,l,v])=>`<span class="lc-row"><i style="background:${c}"></i>${escapeHtml(l)}<b>${escapeHtml(v)}</b></span>`).join('')}${d.n?`<span class="lc-delta">${escapeHtml(d.n)}</span>`:''}`;
  const sx=svg.getBoundingClientRect(),bx=box.getBoundingClientRect(),scale=sx.width/(svg.viewBox.baseVal.width||sx.width),px=sx.left-bx.left+box.scrollLeft+Number(hit.dataset.x)*scale,py=sx.top-bx.top+Number(hit.dataset.y)*scale;
  const tw=tip.offsetWidth||200,th=tip.offsetHeight||70,minL=box.scrollLeft+4,maxL=box.scrollLeft+bx.width-tw-4,left=Math.min(Math.max(px-tw/2,minL),Math.max(minL,maxL)),top=Math.max(py-th-14,0);
  if(!tip.classList.contains('show'))tip.style.transition='opacity .18s ease';
  tip.style.transform=`translate(${left}px,${top}px)`;
  requestAnimationFrame(()=>{tip.style.transition='';tip.classList.add('show')});
  active={svg,tip};
 });
 document.addEventListener('scroll',e=>{if(active&&!(e.target instanceof Element&&e.target.contains(active.svg)&&e.target.classList?.contains('vbar-scroll')))clear()},true);
})();
function renderVerticalBarChart(id,entries,{color='#0a7180',gradientTo='#20aaa6',height=290,scroll=false,minSlot=44,total:grandTotal=null,of=unitWord()}={}){
 const el=$(id);if(!el)return;
 if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';el.classList.remove('vbar-scroll');return}
 el.classList.toggle('vbar-scroll',scroll);
 const fitW=Math.max(320,el.clientWidth||760),w=scroll?Math.max(fitW,entries.length*minSlot):fitW;
 const max=Math.max(1,...entries.map(([,v])=>v)),niceMax=niceMaxOf(max);
 const padL=48,padR=16,padT=22,padB=76,innerW=w-padL-padR,innerH=height-padT-padB,n=entries.length,slot=innerW/n,barW=Math.max(8,Math.min(46,slot*0.55));
 const ticks=[0,0.25,0.5,0.75,1].map(t=>Math.round(niceMax*t));
 const y=v=>padT+innerH-(v/niceMax)*innerH;
 const gid=`vbarFill${id.replace(/[^a-zA-Z0-9]/g,'')}`;
 const grid=ticks.map(t=>{const gy=y(t).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="11" fill="#8b968f" text-anchor="end">${t.toLocaleString()}</text>`}).join('');
 const total=grandTotal||entries.reduce((a,[,v])=>a+v,0)||1;
 const bars=entries.map(([k,v],i)=>{const sx=padL+slot*i,cx=sx+slot/2,bx=(cx-barW/2).toFixed(1),by=y(v),bh=Math.max(2,padT+innerH-by),labelY=height-padB+14;return `<g class="ch-col" data-col="${i}"><rect class="ch-band" x="${(sx+2).toFixed(1)}" y="${padT-8}" width="${Math.max(0,slot-4).toFixed(1)}" height="${(innerH+8).toFixed(1)}" rx="8"/><rect class="ch-bar" x="${bx}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(6,barW/2).toFixed(1)}" fill="url(#${gid})"/><text class="ch-val" x="${cx.toFixed(1)}" y="${(by-6).toFixed(1)}" font-size="12" font-weight="700" fill="#0b5660" text-anchor="middle">${v.toLocaleString()}</text><text class="ch-axis" x="0" y="0" transform="translate(${cx.toFixed(1)},${labelY}) rotate(-40)" text-anchor="end" font-size="11" fill="#6b7d76">${escapeHtml(truncateLabel(k,16))}</text></g>`}).join('');
 const hits=entries.map(([k,v],i)=>{const sx=padL+slot*i;return `<rect class="ch-hit" data-col="${i}" x="${sx.toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}" fill="transparent" data-x="${(sx+slot/2).toFixed(1)}" data-y="${y(v).toFixed(1)}" data-tip="${chartTipAttr({t:k,r:[[gradientTo,unitWord(true),v.toLocaleString()]],n:`${(v/total*100).toFixed(1)}% of ${total.toLocaleString()} ${of} · rank #${i+1}`})}"/>`}).join('');
 el.innerHTML=`<svg viewBox="0 0 ${w} ${height+24}" width="${w}" height="${height+24}" class="vbar-chart-svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${gradientTo}"/><stop offset="100%" stop-color="${color}"/></linearGradient></defs>${grid}<line x1="${padL}" y1="${(padT+innerH).toFixed(1)}" x2="${w-padR}" y2="${(padT+innerH).toFixed(1)}" stroke="#c9d3ce" stroke-width="1"/>${bars}${hits}</svg>`;
}
function testColorFamily(name){const n=String(name).toLowerCase();if(n.includes('nip'))return'blue';if(n.includes('pgt'))return'teal';if(n.includes('embryo'))return'green';if(n.includes('af')||n.includes('cvs'))return'amber';return'violet'}
function renderTestNameGrid(id,entries){const el=$(id);if(!el)return;if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}el.innerHTML=entries.map(([name,count])=>`<div class="test-name-item test-color-${testColorFamily(name)}" data-test="${escapeHtml(name)}"><span class="test-name-dot"></span><span class="test-name-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="test-name-count">${count.toLocaleString()}</span></div>`).join('');el.onclick=e=>{const item=e.target.closest('[data-test]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value='';$('#testFilter').value=item.dataset.test;showView('cases');renderCases()}}
function renderNameCountList(id,entries,filterId){const el=$(id);if(!el)return;if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}const max=Math.max(1,...entries.map(([,v])=>v));el.innerHTML=`<div class="rank-list">${entries.map(([name,count],i)=>`<div class="rank-row" data-name="${escapeHtml(name)}"><span class="rank-index${i<3?' rank-top':''}">${i+1}</span><span class="rank-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="rank-bar-track"><span class="rank-bar-fill" style="width:${Math.max(2,count/max*100)}%"></span></span><span class="rank-count">${count.toLocaleString()}</span></div>`).join('')}</div>`;el.onclick=e=>{const item=e.target.closest('[data-name]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value='';$(`#${filterId}`).value=item.dataset.name;showView('cases');renderCases()}}
const CATEGORICAL_PALETTE=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#4a3aa7','#e34948','#008300'];
function renderTestParetoChart(id,counts,limit=8){
 const el=$(id);if(!el)return;
 const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
 if(!sorted.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}
 const shown=sorted.slice(0,limit),restTotal=sorted.slice(limit).reduce((s,[,v])=>s+v,0);
 const items=shown.map(([k,v])=>({key:k,value:v,isOther:false}));
 if(restTotal>0)items.push({key:'Other',value:restTotal,isOther:true});
 const grandTotal=items.reduce((s,d)=>s+d.value,0)||1;
 let running=0;const cum=items.map(d=>{running+=d.value;return running/grandTotal*100});
 const BAR_COLOR=CATEGORICAL_PALETTE[0],OTHER_COLOR='#c3c2b7',LINE_COLOR=CATEGORICAL_PALETTE[1];
 const scroll=items.length>9,minSlot=78,fitW=Math.max(320,el.clientWidth||760),w=scroll?Math.max(fitW,items.length*minSlot):fitW,height=300;
 const padL=48,padR=40,padT=24,padB=78,innerW=w-padL-padR,innerH=height-padT-padB,n=items.length,slot=innerW/n,barW=Math.max(10,Math.min(40,slot*0.5));
 const max=Math.max(1,...items.map(d=>d.value)),niceMax=niceMaxOf(max);
 const yFor=v=>padT+innerH-(v/niceMax)*innerH,yForPct=p=>padT+innerH-(p/100)*innerH;
 const ticks=[0,0.25,0.5,0.75,1].map(t=>Math.round(niceMax*t));
 const grid=ticks.map(t=>{const gy=yFor(t).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="11" fill="#8b968f" text-anchor="end">${t.toLocaleString()}</text>`}).join('');
 const bars=items.map((d,i)=>{const sx=padL+slot*i,cx=sx+slot/2,bx=(cx-barW/2).toFixed(1),by=yFor(d.value),bh=Math.max(2,padT+innerH-by),color=d.isOther?OTHER_COLOR:BAR_COLOR,labelY=height-padB+14;return `<g class="ch-col" data-col="${i}"><rect class="ch-band" x="${(sx+2).toFixed(1)}" y="${padT-8}" width="${Math.max(0,slot-4).toFixed(1)}" height="${(innerH+8).toFixed(1)}" rx="8"/><rect class="ch-bar" x="${bx}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${color}"/><text class="ch-val" x="${cx.toFixed(1)}" y="${(by-6).toFixed(1)}" font-size="11" font-weight="700" fill="#0b5660" text-anchor="middle">${d.value.toLocaleString()}</text><text class="ch-axis" x="0" y="0" transform="translate(${cx.toFixed(1)},${labelY}) rotate(-40)" text-anchor="end" font-size="11" fill="#6b7d76">${escapeHtml(truncateLabel(d.key,16))}</text></g>`}).join('');
 const pts=items.map((d,i)=>({x:padL+slot*i+slot/2,y:yForPct(cum[i]),pct:cum[i],key:d.key}));
 const pathD=pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
 const crossIdx=pts.findIndex(p=>p.pct>=80),labelIdxs=new Set([pts.length-1]);if(crossIdx>=0)labelIdxs.add(crossIdx);
 const dots=pts.map((p,i)=>{const label=labelIdxs.has(i)?`<text x="${p.x.toFixed(1)}" y="${(p.y-10).toFixed(1)}" font-size="11" font-weight="700" fill="${LINE_COLOR}" text-anchor="middle">${Math.round(p.pct)}%</text>`:'';return `<g class="ch-dot" data-col="${i}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${LINE_COLOR}" stroke="#fff" stroke-width="2"/>${label}</g>`}).join('');
 const hits=items.map((d,i)=>{const sx=padL+slot*i;return `<rect class="ch-hit" data-col="${i}" x="${sx.toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}" fill="transparent" data-x="${(sx+slot/2).toFixed(1)}" data-y="${Math.min(yFor(d.value),pts[i].y).toFixed(1)}" data-tip="${chartTipAttr({t:d.key,r:[[d.isOther?OTHER_COLOR:BAR_COLOR,unitWord(true),d.value.toLocaleString()],[LINE_COLOR,'Cumulative',`${cum[i].toFixed(1)}%`]],n:`${(d.value/grandTotal*100).toFixed(1)}% of all ${unitWord()}`})}"/>`}).join('');
 const baseline=`<line x1="${padL}" y1="${(padT+innerH).toFixed(1)}" x2="${w-padR}" y2="${(padT+innerH).toFixed(1)}" stroke="#c9d3ce" stroke-width="1"/>`;
 const legend=`<div style="display:flex;gap:16px;font-size:11px;color:#52625a;margin-bottom:6px"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:2px;background:${BAR_COLOR};display:inline-block"></i>${unitWord(true).slice(0,-1)} count</span><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:14px;height:2px;background:${LINE_COLOR};display:inline-block"></i>Cumulative % of total</span></div>`;
 el.classList.toggle('vbar-scroll',scroll);
 el.innerHTML=legend+`<svg viewBox="0 0 ${w} ${height+24}" width="${w}" height="${height+24}" class="vbar-chart-svg">${grid}${baseline}${bars}<path d="${pathD}" fill="none" stroke="${LINE_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${hits}</svg>`;
}
const pieDisabledSlices=new Map();
const PLATFORM_PALETTE=['#3aada2','#cd6338','#874fe0','#34a5c0','#ca3d5f','#81b439','#b27e34','#655cd4'];
const PIE_OTHERS_LABEL='Others',CLIENT_MIN_SAMPLES=50,PIE_POP=3.2;
// The 8 base colours first, then golden-angle hues so hundreds of slices stay distinguishable from their neighbours.
const CLIENT_TOP_COLORS=[...PLATFORM_PALETTE,'#e0a526','#2f8f5b','#d0579b','#4f7fb8'],CLIENT_REST_COLORS=['#d3dbd7','#c3ccc8'];
function topThenGreyPalette(n){return Array.from({length:Math.max(n,1)},(_,i)=>i<CLIENT_TOP_COLORS.length?CLIENT_TOP_COLORS[i]:CLIENT_REST_COLORS[i%2])}
function manyColorPalette(n){return Array.from({length:Math.max(n,1)},(_,i)=>i<PLATFORM_PALETTE.length?PLATFORM_PALETTE[i]:`hsl(${Math.round((i*137.508)%360)},${55+(i%3)*10}%,${42+(i%4)*6}%)`)}
function polarToCartesian(cx,cy,r,angleDeg){const rad=(angleDeg-90)*Math.PI/180;return {x:cx+r*Math.cos(rad),y:cy+r*Math.sin(rad)}}
// Smooth pie hover: slice eases outward, others fade, a tooltip follows the
// cursor, and the matching legend row highlights (and vice versa).
(function pieHover(){
 const tip=document.createElement('div');tip.className='pie-tooltip';tip.setAttribute('role','tooltip');document.body.append(tip);
 let activePie=null,activeLabel=null,raf=0,mx=0,my=0;
 const legendRows=pie=>[...document.querySelectorAll('.pie-legend .legend-row')].filter(r=>r.dataset.pieId==='#'+pie.id);
 const setActive=(pie,label)=>{
  if(activePie&&activePie!==pie)setActive(activePie,null);
  activePie=label?pie:null;activeLabel=label;
  pie.classList.toggle('is-hovering',!!label);
  pie.querySelectorAll('.pie-slice,.pie-label,.tm-tile').forEach(n=>n.classList.toggle('active',!!label&&n.dataset.label===label));
  legendRows(pie).forEach(r=>r.classList.toggle('legend-hover',!!label&&r.dataset.label===label));
  if(label){const row=legendRows(pie).find(r=>r.dataset.label===label);if(row&&pie.classList.contains('treemap')&&!row.matches(':hover')){const box=row.parentElement;if(box&&(row.offsetTop<box.scrollTop||row.offsetTop>box.scrollTop+box.clientHeight-row.offsetHeight))box.scrollTo({top:row.offsetTop-box.clientHeight/2,behavior:'smooth'})}}
  const hole=pie.querySelector('.pie-hole');if(hole){const sl=label&&[...pie.querySelectorAll('.pie-slice')].find(n=>n.dataset.label===label);hole.classList.toggle('focus',!!sl);hole.innerHTML=sl?`<strong>${Number(sl.dataset.value).toLocaleString()}</strong><span class="hole-name">${escapeHtml(label)}</span><span>${sl.dataset.pct}% of ${escapeHtml(pie.dataset.centerLabel||unitWord())}</span>`:`<strong>${Number(pie.dataset.total||0).toLocaleString()}</strong><span>${escapeHtml(pie.dataset.centerLabel||unitWord())}</span>`}
 };
 const place=()=>{raf=0;const w=tip.offsetWidth,h=tip.offsetHeight;let x=mx+16,y=my+16;if(x+w>innerWidth-8)x=mx-w-16;if(y+h>innerHeight-8)y=my-h-16;tip.style.transform=`translate(${x}px,${y}px)`};
 const showTip=(slice,e)=>{const {label,value,pct,color}=slice.dataset;tip.innerHTML=`<i style="background:${color}"></i><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong><em>${pct}%</em>`;mx=e.clientX;my=e.clientY;if(!tip.classList.contains('show')){place()}tip.classList.add('show')};
 document.addEventListener('mouseover',e=>{
  const slice=e.target.closest?.('.pie-slice,.tm-tile');
  if(slice){const pie=slice.closest('.pie,.treemap');if(pie){setActive(pie,slice.dataset.label);if(pie.classList.contains('pie-donut'))tip.classList.remove('show');else showTip(slice,e)}return}
  const row=e.target.closest?.('.pie-legend .legend-row');
  if(row){const pie=document.querySelector(row.dataset.pieId);if(pie)setActive(pie,row.dataset.label);tip.classList.remove('show');return}
  if(activePie){setActive(activePie,null);tip.classList.remove('show')}
 });
 document.addEventListener('mousemove',e=>{if(!tip.classList.contains('show'))return;mx=e.clientX;my=e.clientY;if(!raf)raf=requestAnimationFrame(place)});
 document.addEventListener('scroll',()=>{if(activePie){setActive(activePie,null);tip.classList.remove('show')}},true);
})();
// Squarified treemap: rectangles sized by value, laid out to stay close to square.
function treemapLayout(values,x,y,w,h){const total=values.reduce((a,b)=>a+b,0);if(!total||w<=0||h<=0)return[];const areas=values.map(v=>v*w*h/total),rects=[];let i=0;
 while(i<areas.length){const side=Math.min(w,h),worst=(sum,mx,mn)=>Math.max(side*side*mx/(sum*sum),(sum*sum)/(side*side*mn));let sum=areas[i],mx=areas[i],mn=areas[i],j=i+1;
  while(j<areas.length){const a=areas[j],ns=sum+a,nmx=Math.max(mx,a),nmn=Math.min(mn,a);if(worst(ns,nmx,nmn)>worst(sum,mx,mn))break;sum=ns;mx=nmx;mn=nmn;j++}
  if(w>=h){const cw=sum/h;let cy=y;for(let k=i;k<j;k++){const ch=areas[k]/cw;rects.push({x,y:cy,w:cw,h:ch});cy+=ch}x+=cw;w-=cw}
  else{const ch=sum/w;let cx=x;for(let k=i;k<j;k++){const cw=areas[k]/ch;rects.push({x:cx,y,w:cw,h:ch});cx+=cw}y+=ch;h-=ch}
  i=j}
 return rects}
// All clients page: summary tiles, top-3 cards and a sortable, searchable ranked table.
function allClientsMarkup(){return `<div class="ac-kpis" id="acKpis"></div><div class="ac-top3" id="acTop3"></div><section class="ac-panel"><div class="ac-scope prep-segments" id="acScope" role="tablist" aria-label="Client list coverage"></div><div class="ac-head" aria-hidden="true"><span>#</span><span>Client</span><span>Volume</span><span>Samples</span><span></span></div><div class="ac-list" id="acList"></div><div class="ac-foot" id="acFoot"></div></section>`}
function setupAllClientsView(){
 const monthSel=$('#acMonth'),search=$('#acSearch'),sortEl=$('#acSort'),scopeEl=$('#acScope'),list=$('#acList');
 [...new Set(allEmbryos().map(recordMonth).filter(isDateMonth))].sort().forEach(v=>monthSel.add(new Option(monthLabel(v),v)));
 const directory=new Map((typeof clientDirectory==='function'?clientDirectory():[]).map(d=>[d.brand,d.branches]));
 let sort='desc',scope='all',entries=[],rankOf=new Map();const open=new Set();
 const tile=(label,value,sub='')=>`<div class="ac-kpi"><small>${label}</small><strong>${value}</strong>${sub?`<span>${sub}</span>`:''}</div>`;
 const SCOPES=[['all','All clients'],['listed','In client list'],['unlisted','Not in client list'],['dormant','No samples']];
 const inScope=(e,s)=>s==='all'?e.n>0:s==='listed'?e.listed&&e.n>0:s==='unlisted'?!e.listed&&e.n>0:e.listed&&e.n===0;
 // One entry per client (brand): sample count plus per-branch counts; listed clients with no samples in the period are kept for the "No samples" view.
 const load=()=>{const stats=new Map();
  for(const e of monthFiltered(allEmbryos(),monthSel.value)){const c=e._case,k=c.client;let s=stats.get(k);if(!s)stats.set(k,s={name:k,n:0,listed:directory.has(k),byBranch:new Map()});s.n++;const b=c.clientCode||'';s.byBranch.set(b,(s.byBranch.get(b)||0)+1)}
  for(const k of directory.keys())if(!stats.has(k))stats.set(k,{name:k,n:0,listed:true,byBranch:new Map()});
  entries=[...stats.values()].sort((a,b)=>b.n-a.n||a.name.localeCompare(b.name));rankOf=new Map(entries.filter(e=>e.n>0).map((e,i)=>[e.name,i+1]));
  const active=entries.filter(e=>e.n>0),n=active.length,total=active.reduce((a,e)=>a+e.n,0),big=active.filter(e=>e.n>=CLIENT_MIN_SAMPLES).length,single=active.filter(e=>e.n===1).length;
  $('#acKpis').innerHTML=tile('Clients',n.toLocaleString())+tile('Samples',total.toLocaleString())+tile('Avg per client',n?(total/n).toFixed(1):'0','samples')+tile(`${CLIENT_MIN_SAMPLES}+ sample clients`,big.toLocaleString(),`${single.toLocaleString()} with a single sample`);
  const peak=active[0]?.n||1;
  $('#acTop3').innerHTML=active.slice(0,3).map((e,i)=>`<button type="button" class="ac-top-card" data-name="${escapeHtml(e.name)}"><span class="ac-medal m${i+1}">${i+1}</span><span class="ac-top-name" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span><strong>${e.n.toLocaleString()}<small> samples</small></strong><span class="ac-top-bar"><span style="width:${(e.n/peak*100).toFixed(1)}%"></span></span></button>`).join('');
  scopeEl.innerHTML=SCOPES.map(([k,label])=>`<button type="button" class="prep-seg${k===scope?' active':''}" data-scope="${k}">${label} <span class="ac-scope-n">${entries.filter(e=>inScope(e,k)).length.toLocaleString()}</span></button>`).join('');
  draw()};
 const branchLabel=b=>b.branch||b.name;
 const detail=e=>{if(!e.listed)return `<div class="ac-detail"><p class="ac-detail-note">Not in the client list. Samples are grouped by the center name typed in the sheet.</p></div>`;
  const branches=directory.get(e.name)||[],unknown=e.byBranch.get('')||0;
  const rows=branches.map(b=>({b,n:e.byBranch.get(b.code)||0})).sort((x,y)=>y.n-x.n||branchLabel(x.b).localeCompare(branchLabel(y.b)));
  return `<div class="ac-detail"><table class="ac-branches"><thead><tr><th>Branch</th><th>Code</th><th>Samples</th></tr></thead><tbody>${rows.map(({b,n})=>`<tr class="${n?'':'is-zero'}"><td title="${escapeHtml(b.name)}">${escapeHtml(branchLabel(b))}</td><td class="mono">${escapeHtml(b.code)}</td><td>${n.toLocaleString()}</td></tr>`).join('')}${unknown?`<tr class="is-unknown"><td colspan="2">Branch not identified from the sheet</td><td>${unknown.toLocaleString()}</td></tr>`:''}</tbody></table></div>`};
 const sub=e=>{if(!e.listed)return '<small class="ac-sub ac-tag-unlisted">Not in client list</small>';const br=directory.get(e.name)||[],act=br.filter(b=>e.byBranch.get(b.code)).length;return `<small class="ac-sub">${br.length>1?`${act} of ${br.length} branches active`:act?'1 branch':'Listed · no samples'}</small>`};
 const draw=()=>{const q=search.value.trim().toLowerCase(),inView=entries.filter(e=>inScope(e,scope)),peak=Math.max(1,...inView.map(e=>e.n));
  const matches=e=>!q||e.name.toLowerCase().includes(q)||(directory.get(e.name)||[]).some(b=>(b.name+' '+b.branch+' '+b.code).toLowerCase().includes(q));
  let rows=inView.filter(matches);
  if(sort==='asc')rows=[...rows].sort((a,b)=>a.n-b.n||a.name.localeCompare(b.name));else if(sort==='az')rows=[...rows].sort((a,b)=>a.name.localeCompare(b.name));
  list.innerHTML=rows.length?rows.map(e=>{const r=rankOf.get(e.name),isOpen=open.has(e.name);return `<div class="ac-item${isOpen?' open':''}"><div class="ac-row${r&&r<=3?' top':''}${e.n?'':' is-zero'}" data-name="${escapeHtml(e.name)}" tabindex="0" role="button"><span class="ac-rank">${r||'—'}</span><span class="ac-name" title="${escapeHtml(e.name)}"><span class="ac-name-text">${escapeHtml(e.name)}</span>${sub(e)}</span><span class="ac-bar"><span style="width:${e.n?Math.max(1.5,e.n/peak*100).toFixed(1):0}%"></span></span><span class="ac-count">${e.n.toLocaleString()}</span><button type="button" class="ac-toggle" data-toggle="${escapeHtml(e.name)}" aria-expanded="${isOpen}" aria-label="${isOpen?'Hide':'Show'} branches for ${escapeHtml(e.name)}">▾</button></div>${isOpen?detail(e):''}</div>`}).join(''):`<div class="chart-empty">${q?'No clients match your search.':'No clients in this view.'}</div>`;
  $('#acTotal').innerHTML=`<small>${scope==='dormant'?'Listed, no samples':'Total clients'}</small><strong>${(q?rows.length:inView.length).toLocaleString()}</strong>${q?`<span>of ${inView.length.toLocaleString()}</span>`:''}`;
  const unlisted=entries.filter(e=>!e.listed&&e.n>0),unlistedSamples=unlisted.reduce((a,e)=>a+e.n,0);
  $('#acFoot').textContent=(q?`Showing ${rows.length.toLocaleString()} of ${inView.length.toLocaleString()} clients`:`${inView.length.toLocaleString()} clients`)+` · client list has ${directory.size.toLocaleString()} clients${unlisted.length?` · ${unlisted.length.toLocaleString()} names (${unlistedSamples.toLocaleString()} samples) not in the client list`:''}`};
 const openClient=name=>{['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>{const el=$(`#${k}Filter`);if(el)el.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=monthSel.value||'';const cf=$('#clientFilter');if(cf){if(![...cf.options].some(o=>o.value===name))cf.add(new Option(name,name));cf.value=name}showView('cases');renderCases()};
 const toggle=name=>{open.has(name)?open.delete(name):open.add(name);draw()};
 const onPick=e=>{const t=e.target.closest('[data-toggle]');if(t){e.stopPropagation();toggle(t.dataset.toggle);return}if(e.target.closest('.ac-detail'))return;const it=e.target.closest('[data-name]');if(!it)return;const ent=entries.find(x=>x.name===it.dataset.name);if(ent&&!ent.n)toggle(ent.name);else openClient(it.dataset.name)};
 list.onclick=onPick;$('#acTop3').onclick=onPick;list.onkeydown=e=>{if(e.key==='Enter'&&!e.target.closest('[data-toggle]'))onPick(e)};
 sortEl.onclick=e=>{const b=e.target.closest('[data-sort]');if(!b)return;sort=b.dataset.sort;sortEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));draw()};
 scopeEl.onclick=e=>{const b=e.target.closest('[data-scope]');if(!b)return;scope=b.dataset.scope;scopeEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));draw()};
 search.oninput=draw;monthSel.onchange=load;load();
}
// All regions page: ranked table of monthly sample counts per region.
function regionsMarkup(){return `<article class="rg-card rg-wide"><div id="allRegionChart"></div></article>`}
function setupRegionsView(){
 const sortSel=$('#regionSortOrder'),render=()=>renderRegionMonthTable('#allRegionChart',allEmbryos(),sortSel.value||'desc');
 sortSel.onchange=render;render();
}
// Ranked table: one row per region with its sample count in every month and the overall total.
function renderRegionMonthTable(id,rows,order){
 const el=$(id);if(!el)return;
 const months=[...new Set(rows.map(recordMonth).filter(isDateMonth))].sort(),grid={};
 rows.forEach(e=>{const r=e._case.region||'Unknown',m=recordMonth(e);const g=grid[r]||(grid[r]={total:0});g.total++;if(isDateMonth(m))g[m]=(g[m]||0)+1});
 const entries=Object.entries(grid).sort((a,b)=>b[1].total-a[1].total||a[0].localeCompare(b[0]));
 if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}
 const rank=new Map(entries.map(([k],i)=>[k,i+1])),shown=order==='asc'?[...entries].reverse():entries,peak=entries[0][1].total||1;
 const cols=`56px minmax(150px,1.4fr) repeat(${months.length},minmax(56px,1fr)) minmax(150px,1.3fr)`;
 const cell=(r,m,v)=>v?`<button type="button" class="rgt-num" data-name="${escapeHtml(r)}" data-month="${m}" title="${escapeHtml(r)} · ${escapeHtml(monthLabel(m))}: ${v.toLocaleString()} samples">${v.toLocaleString()}</button>`:'<span class="rgt-num rgt-zero">–</span>';
 el.innerHTML=`<div class="rgt-scroll"><div class="rgt" style="--rgt-cols:${cols}"><div class="rgt-row rgt-head"><span>S.No</span><span>Region</span>${months.map(m=>`<span>${escapeHtml(monthLabel(m,{month:'short',year:'2-digit'}))}</span>`).join('')}<span>Total</span></div>${shown.map(([r,g])=>{const n=rank.get(r);return `<div class="rgt-row"><span class="rank-index${n<=3?' rank-top':''}">${n}</span><button type="button" class="rgt-name" data-name="${escapeHtml(r)}" title="${escapeHtml(r)}">${escapeHtml(r)}</button>${months.map(m=>cell(r,m,g[m]||0)).join('')}<span class="rgt-total"><span class="rank-bar-track"><span class="rank-bar-fill" style="width:${Math.max(2,g.total/peak*100).toFixed(1)}%"></span></span><strong>${g.total.toLocaleString()}</strong></span></div>`}).join('')}</div></div>`;
 el.onclick=e=>{const item=e.target.closest('[data-name]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>{const f=$(`#${k}Filter`);if(f)f.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=item.dataset.month||'';const rf=$('#regionFilter');if(rf){if(![...rf.options].some(o=>o.value===item.dataset.name))rf.add(new Option(item.dataset.name,item.dataset.name));rf.value=item.dataset.name}showView('cases');renderCases()};
}
function renderClientTreemap(mapId,legendId,counts){
 const el=mapId?$(mapId):null,leg=$(legendId);if(!leg)return;
 const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]),total=entries.reduce((n,[,v])=>n+v,0),palette=topThenGreyPalette(entries.length),peak=Math.max(1,...entries.map(([,v])=>v));
 if(!entries.length){if(el)el.innerHTML='';leg.innerHTML='<div class="chart-empty">No records in this period.</div>';return}
 const W=el?.clientWidth||900,H=el?.clientHeight||440,rects=el?treemapLayout(entries.map(([,v])=>v),0,0,W,H):[];
 if(el)el.innerHTML=rects.map((r,i)=>{const [k,v]=entries[i],color=palette[i],pct=total?(v/total*100).toFixed(1):'0.0',grey=i>=CLIENT_TOP_COLORS.length,big=r.w>92&&r.h>46,mid=!big&&r.w>54&&r.h>26;
  return `<div class="tm-tile${grey?' tm-grey':''}" data-label="${escapeHtml(k)}" data-value="${v}" data-pct="${pct}" data-color="${color}" style="left:${(r.x/W*100).toFixed(3)}%;top:${(r.y/H*100).toFixed(3)}%;width:${(r.w/W*100).toFixed(3)}%;height:${(r.h/H*100).toFixed(3)}%;--c:${color}">${big?`<span class="tm-name">${escapeHtml(k)}</span><span class="tm-val">${v.toLocaleString()} · ${pct}%</span>`:mid?`<span class="tm-val">${v.toLocaleString()}</span>`:''}</div>`}).join('');
 leg.innerHTML=entries.map(([k,v],i)=>`<div class="legend-row" data-pie-id="${mapId}" data-label="${escapeHtml(k)}"><b class="legend-rank">${i+1}</b><i style="background:${palette[i]}"></i><span title="${escapeHtml(k)}">${escapeHtml(k)}</span><u class="legend-bar"><span style="width:${(v/peak*100).toFixed(1)}%;background:${palette[i]}"></span></u><strong>${v.toLocaleString()}</strong><em>${total?(v/total*100).toFixed(1):'0.0'}%</em></div>`).join('')}
function renderFullPieChart(pieId,legendId,counts,palette=CATEGORICAL_PALETTE,opts={}){const donut=!!opts.donut,labelR=donut?40:38;const disabled=pieDisabledSlices.get(pieId)||new Set(),entries=Object.entries(counts).sort((a,b)=>((a[0]===PIE_OTHERS_LABEL)-(b[0]===PIE_OTHERS_LABEL))||b[1]-a[1]),colorFor=i=>palette[i%palette.length],active=entries.filter(([k])=>!disabled.has(k)),total=active.reduce((s,[,v])=>s+v,0),colorByLabel=new Map(entries.map(([k],i)=>[k,colorFor(i)]));let stop=0;const labels=[],wedges=active.map(([k,v])=>{const start=stop,pct=total?v/total*100:0;stop+=pct;const color=colorByLabel.get(k),midRad=((start+stop)/2/100*360-90)*Math.PI/180,dx=(Math.cos(midRad)*PIE_POP).toFixed(2),dy=(Math.sin(midRad)*PIE_POP).toFixed(2),data=`data-label="${escapeHtml(k)}" data-value="${v}" data-pct="${pct.toFixed(1)}" data-color="${color}" style="--dx:${dx}px;--dy:${dy}px"`,tip='';if(pct>(donut?2.5:1.5)){const x=50+labelR*Math.cos(midRad),y=50+labelR*Math.sin(midRad);labels.push(`<span class="pie-label" data-label="${escapeHtml(k)}" style="left:${x}%;top:${y}%;--dx:${dx}%;--dy:${dy}%">${v.toLocaleString()}</span>`)}if(active.length===1)return `<circle class="pie-slice" ${data} cx="50" cy="50" r="50" fill="${color}"></circle>`;const startAngle=start/100*360,endAngle=stop/100*360,s=polarToCartesian(50,50,50,endAngle),e=polarToCartesian(50,50,50,startAngle),largeArc=endAngle-startAngle>180?1:0;return `<path d="M50 50 L${s.x.toFixed(2)} ${s.y.toFixed(2)} A50 50 0 ${largeArc} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z" class="pie-slice" ${data} fill="${color}" stroke="${pct>=0.8?'#fff':'none'}" stroke-width="${pct>=0.8?0.6:0}"></path>`}).join('');$(pieId).style.background='none';$(pieId).classList.toggle('pie-donut',donut);$(pieId).dataset.total=total;$(pieId).dataset.centerLabel=opts.center||unitWord();$(pieId).innerHTML=(active.length?`<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block;overflow:visible">${wedges}</svg>`:'')+labels.join('')+(donut?`<div class="pie-hole"><strong>${total.toLocaleString()}</strong><span>${escapeHtml(opts.center||unitWord())}</span></div>`:'');const grand=entries.reduce((n,[,v])=>n+v,0),peak=Math.max(1,...entries.map(([,v])=>v));$(legendId).innerHTML=entries.map(([k,v],i)=>{const isOff=disabled.has(k);return `<div class="legend-row${isOff?' legend-off':''}" data-pie-id="${pieId}" data-label="${escapeHtml(k)}"><b class="legend-rank">${i+1}</b><i style="background:${isOff?'#c3c2b7':colorByLabel.get(k)}"></i><span title="${escapeHtml(k)}">${escapeHtml(k)}</span><u class="legend-bar"><span style="width:${(v/peak*100).toFixed(1)}%;background:${isOff?'#c3c2b7':colorByLabel.get(k)}"></span></u><strong>${v.toLocaleString()}</strong><em>${grand?(v/grand*100).toFixed(1):'0.0'}%</em></div>`}).join('')||'<div class="chart-empty">No records in this period.</div>'}
function toggleLegendSlice(pieId,label,rerender){const set=pieDisabledSlices.get(pieId)||new Set();if(set.has(label))set.delete(label);else set.add(label);pieDisabledSlices.set(pieId,set);rerender()}
const QUALITY_GOOD='#0ca30c',QUALITY_SERIOUS='#ec835a',QUALITY_CRITICAL='#d03b3b',QUALITY_PENDING='#c3c2b7';
function qualityStatusColor(pct){if(pct<20)return QUALITY_CRITICAL;if(pct<50)return QUALITY_SERIOUS;return QUALITY_GOOD}
const QC_FAIL_SIGNALS=['inconclusive','low dna concentration','low reads','no dna detected','no dna'];
// No DNA detected / low DNA / low reads / inconclusive in the conclusion or result is always a QC fail;
// otherwise the QC column decides, and a recorded result with no QC value counts as a pass.
function qcVerdict(e){const text=`${field(e,['conclusion'])} ${field(e,['result'])}`.toLowerCase().trim();if(text&&QC_FAIL_SIGNALS.some(s=>text.includes(s)))return'FAIL';const qc=field(e,['qc']).toUpperCase();if(qc==='FAIL'||qc==='PASS')return qc;return text?'PASS':null}
function embryologistQcStats(rows){const byName={};rows.forEach(e=>{const name=e._case.embryologist||'Not assigned';if(name==='Not assigned'||/^(n\/?a|`)$/i.test(name.trim()))return;const q=byName[name]||(byName[name]={name,total:0,pass:0,fail:0});embryoRowsOf(e).forEach(er=>{const verdict=qcVerdict(er);q.total++;if(verdict==='PASS')q.pass++;else if(verdict==='FAIL')q.fail++})});return Object.values(byName).map(q=>({...q,pending:q.total-q.pass-q.fail,successRate:(q.pass+q.fail)?Math.round(q.pass/(q.pass+q.fail)*100):null})).sort((a,b)=>{const aResolved=a.successRate!==null,bResolved=b.successRate!==null;if(aResolved!==bResolved)return aResolved?-1:1;if(aResolved)return b.successRate-a.successRate||b.total-a.total;return b.total-a.total})}
// Stacked bar per embryologist: QC pass (green) at the base, QC fail (red) on top.
function renderEmbryologistBarChart(id,stats,limit=10){
 const el=$(id);if(!el)return;
 const shown=limit?stats.slice(0,limit):stats;
 if(!shown.length){el.innerHTML=`<div class="chart-empty">No ${unitWord()} in this period.</div>`;return}
 const series=[['pass',QUALITY_GOOD,'QC Pass'],['fail','#e11d2e','QC Fail']];
 const stackTotal=d=>d.pass+d.fail;
 const fitW=Math.max(320,el.clientWidth||760),w=fitW,height=300;
 const padL=48,padR=16,padT=24,padB=76,innerW=w-padL-padR,innerH=height-padT-padB,n=shown.length,slot=innerW/n;
 const barW=Math.max(24,Math.min(64,slot*0.55));
 const max=Math.max(1,...shown.map(stackTotal)),niceMax=Math.ceil((max+50)/40)*40;
 const yFor=v=>padT+innerH-(v/niceMax)*innerH;
 const ticks=[0,0.25,0.5,0.75,1].map(t=>Math.round(niceMax*t));
 const grid=ticks.map(t=>{const gy=yFor(t).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="11" fill="#8b968f" text-anchor="end">${t.toLocaleString()}</text>`}).join('');
 const bars=shown.map((d,i)=>{const sx=padL+slot*i,cx=sx+slot/2,bx=(cx-barW/2).toFixed(1),labelY=height-padB+14;
  let cursor=padT+innerH;
  const segs=series.map(([key,color])=>{const v=d[key];if(!v)return'';const segH=Math.max(3,(v/niceMax)*innerH),top=cursor-segH,rect=`<rect class="ch-bar" x="${bx}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${color}"/>`;cursor=top;return rect}).join('');
  const lbl='';
  return `<g class="ch-col" data-col="${i}"><rect class="ch-band" x="${(sx+2).toFixed(1)}" y="${padT-8}" width="${Math.max(0,slot-4).toFixed(1)}" height="${(innerH+8).toFixed(1)}" rx="8"/>${segs}${lbl}<text class="ch-axis" x="0" y="0" transform="translate(${cx.toFixed(1)},${labelY}) rotate(-40)" text-anchor="end" font-size="11" fill="#6b7d76">${escapeHtml(truncateLabel(d.name,16))}</text></g>`}).join('');
 const hits=shown.map((d,i)=>{const sx=padL+slot*i,top=yFor(stackTotal(d)),total=stackTotal(d);return `<rect class="ch-hit" data-col="${i}" x="${sx.toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}" fill="transparent" data-x="${(sx+slot/2).toFixed(1)}" data-y="${top.toFixed(1)}" data-tip="${chartTipAttr({t:d.name,r:series.map(([key,color,label])=>[color,label,`${d[key].toLocaleString()} (${total?Math.round(d[key]/total*100):0}%)`]),n:d.successRate!==null&&d.successRate!==undefined?`QC pass rate ${d.successRate}% · ${d.total.toLocaleString()} tests`:`No QC results yet · ${d.total.toLocaleString()} tests`})}"/>`}).join('');
 const baseline=`<line x1="${padL}" y1="${(padT+innerH).toFixed(1)}" x2="${w-padR}" y2="${(padT+innerH).toFixed(1)}" stroke="#c9d3ce" stroke-width="1"/>`;
 const legend=`<div style="display:flex;gap:16px;font-size:11px;color:#52625a;margin-bottom:6px">${series.map(([,color,label])=>`<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block"></i>${label}</span>`).join('')}</div>`;
 el.innerHTML=legend+`<svg viewBox="0 0 ${w} ${height+24}" width="${w}" height="${height+24}" class="vbar-chart-svg">${grid}${baseline}${bars}${hits}</svg>`;
}
function resultText(er){const v=field(er,['conclusion','result']);if(v&&typeof v==='object')return String(v.result||v.conclusion||v.final||v.text||Object.values(v).find(x=>typeof x==='string'&&x.trim())||'');return v==null?'':String(v)}
function openEmbryologistEmbryos(name,sampleRows,periodLabel){
 let dlg=$('#embListDialog');if(!dlg){dlg=document.createElement('dialog');dlg.id='embListDialog';dlg.className='vu-dialog vu-dialog-wide';document.body.append(dlg);dlg.addEventListener('click',e=>{if(e.target===dlg||e.target.closest('[data-close]'))dlg.close()})}
 const rows=sampleRows.flatMap(e=>embryoRowsOf(e).map(er=>({e,er}))),kind=x=>{const v=qcVerdict(x.er);return v==='PASS'?'pass':v==='FAIL'?'fail':'wait'},label={pass:'QC pass',fail:'QC fail',wait:'Awaiting result'};
 const cnt={all:rows.length,pass:0,fail:0,wait:0};rows.forEach(x=>cnt[kind(x)]++);
 let f='all';
 const draw=()=>{const list=rows.filter(x=>f==='all'||kind(x)===f);
  dlg.innerHTML=`<div class="vu-dhead"><h3>${escapeHtml(name)} · ${escapeHtml(periodLabel)} · ${cnt.all} embryos</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><div class="prep-segments sheet-tabs emb-list-tabs">${[['all','All'],['pass','QC pass'],['fail','QC fail'],['wait','Awaiting']].map(([k,l])=>`<button type="button" class="prep-seg${k===f?' active':''}" data-f="${k}">${l}<b>${cnt[k]}</b></button>`).join('')}</div><div class="emb-list-wrap"><table class="emb-list-table"><thead><tr><th>#</th><th>Patient</th><th>Sample ID</th><th>Embryo</th><th>Test</th><th>Client</th><th>Month</th><th>Result</th><th>QC</th></tr></thead><tbody>${list.map((x,i)=>{const {e,er}=x;return `<tr><td>${i+1}</td><td class="strong">${escapeHtml(field(e,['patient name','patient'])||e._case.patient||'')}</td><td>${escapeHtml(field(e,['sample id'])||e._case.id||'')}</td><td class="strong">${escapeHtml(field(er,['sample name','embryo name','embryo id','embryo'])||'')}</td><td>${escapeHtml(canonicalTestName(field(e,['test name','test']))||e._case.test||'')}</td><td>${escapeHtml(e._case.client||'')}</td><td>${escapeHtml(recordMonth(e)||'')}</td><td>${escapeHtml(resultText(er))}</td><td><span class="emb-q ${kind(x)}">${label[kind(x)]}</span></td></tr>`}).join('')||'<tr><td colspan="9" class="chart-empty">Nothing in this group.</td></tr>'}</tbody></table></div></div>`;
  dlg.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{f=b.dataset.f;draw()})};
 draw();if(!dlg.open)dlg.showModal()}
function renderEmbryologistRankList(id,stats){
 const el=$(id);if(!el)return;
 if(!stats.length){el.innerHTML='<div class="chart-empty">No samples in this period.</div>';return}
 const peak=Math.max(1,...stats.map(q=>q.total)),seg=(v,c)=>v?`<span style="width:${(v/peak*100).toFixed(2)}%;background:${c}"></span>`:'';
 const head=`<div class="emb-row emb-head" aria-hidden="true"><span>S.No</span><span>Embryologist</span><span>Embryos</span><span>Total</span><span>Passed</span><span>Failed</span><span>Awaiting</span><span title="${escapeHtml(embInc?.period||'')} report">Report embryos</span><span>Inconclusive</span><span>Inc. %</span></div>`;
 const incBy=new Map((embInc?.rows||[]).map(r=>[nameKey(r.name),r])),incTone=v=>v>=10?'high':v>=5?'mid':v>0?'low':'zero';
 const legend=`<div class="rg-legend emb-legend"><span><i style="background:${QUALITY_GOOD}"></i>QC Pass</span><span><i style="background:${QUALITY_CRITICAL}"></i>QC Fail</span><span><i style="background:${QUALITY_PENDING}"></i>Awaiting result</span></div>`;
 el.innerHTML=legend+`<div class="emb-list">${head}${stats.map((q,i)=>`<div class="emb-row" title="${escapeHtml(q.name)}: ${q.total} total · ${q.pass} passed · ${q.fail} failed · ${q.pending} awaiting"><span class="rank-index${i<3?' rank-top':''}">${i+1}</span><span class="emb-name">${escapeHtml(q.name)}</span><span class="emb-bar">${seg(q.pass,QUALITY_GOOD)}${seg(q.fail,QUALITY_CRITICAL)}${seg(q.pending,QUALITY_PENDING)}</span><strong class="emb-num">${q.total.toLocaleString()}</strong><span class="emb-num${q.pass?' emb-pass':''}">${q.pass.toLocaleString()}</span><span class="emb-num${q.fail?' emb-fail':''}">${q.fail.toLocaleString()}</span><span class="emb-num emb-wait">${q.pending.toLocaleString()}</span>${(()=>{const r=incBy.get(nameKey(q.name));if(!r)return'<span class="emb-num emb-wait">—</span><span class="emb-num emb-wait">—</span><span class="emb-num emb-wait">—</span>';const pct=r.total?r.inconclusive/r.total*100:0;return `<span class="emb-num">${r.total}</span><span class="emb-num">${r.inconclusive}</span><span class="emb-num"><span class="inc-pct ${incTone(pct)}">${pct.toFixed(2)}%</span></span>`})()}</div>`).join('')}</div>`;
}
function monthFiltered(rows,val){return val?rows.filter(e=>recordMonth(e)===val):rows}
// Smooth hover for the monthly line chart: guide line, growing point,
// fading labels and a tooltip that glides between months.
(function lineChartHover(){
 let active=null;
 const clear=()=>{if(!active)return;const {svg,tip}=active;svg.classList.remove('is-hovering');svg.querySelectorAll('.active').forEach(n=>n.classList.remove('active'));tip?.classList.remove('show');active=null};
 document.addEventListener('mouseover',e=>{
  const hit=e.target.closest?.('.volume-line-chart .lc-hit');
  if(!hit){if(active&&!e.target.closest?.('.volume-line-chart'))clear();return}
  const svg=hit.ownerSVGElement,box=svg.parentElement,i=hit.parentNode.dataset.i;
  if(active&&active.svg!==svg)clear();
  let tip=box.querySelector(':scope > .lc-tip');if(!tip){tip=document.createElement('div');tip.className='lc-tip';box.append(tip)}
  if(getComputedStyle(box).position==='static')box.style.position='relative';
  svg.classList.add('is-hovering');
  svg.querySelectorAll('.lc-pt,.lc-label').forEach(n=>n.classList.toggle('active',n.dataset.i===i));
  const {label,value,prev,x,y,series}=hit.dataset,v=Number(value),pv=prev===''||prev==null?null:Number(prev);
  let delta='';if(pv!=null){const d=v-pv,pc=pv?Math.round(d/pv*100):0;delta=`<span class="lc-delta ${d>0?'up':d<0?'down':''}">${d>0?'▲':d<0?'▼':'•'} ${d>0?'+':''}${d.toLocaleString()} (${d>0?'+':''}${pc}%) vs previous month</span>`}
  if(series){const rows=JSON.parse(series),sum=rows.filter(r=>/pass|fail/i.test(r.label)).reduce((n,r)=>n+r.value,0),pass=rows.find(r=>/pass/i.test(r.label));tip.innerHTML=`<span class="lc-month">${escapeHtml(label)}</span>${rows.map(r=>`<span class="lc-row"><i style="background:${r.color}"></i>${escapeHtml(r.label)}<b>${r.value.toLocaleString()}</b></span>`).join('')}${pass?`<span class="lc-delta">${sum?`Pass rate <b>${Math.round(pass.value/sum*100)}%</b> of ${sum.toLocaleString()} QC'd`:'No QC results yet'}</span>`:''}`}else tip.innerHTML=`<span class="lc-month">${escapeHtml(label)}</span><strong>${v.toLocaleString()} <small>samples</small></strong>${delta}`;
  const sx=svg.getBoundingClientRect(),bx=box.getBoundingClientRect(),scale=sx.width/(svg.viewBox.baseVal.width||sx.width),px=sx.left-bx.left+Number(x)*scale,py=sx.top-bx.top+Number(y)*scale;
  const tw=tip.offsetWidth||180,left=Math.min(Math.max(px-tw/2,4),bx.width-tw-4),top=Math.max(py-(tip.offsetHeight||64)-18,0);
  if(!tip.classList.contains('show'))tip.style.transition='opacity .18s ease';
  tip.style.transform=`translate(${left}px,${top}px)`;
  requestAnimationFrame(()=>{tip.style.transition='';tip.classList.add('show')});
  active={svg,tip};
 });
 document.addEventListener('scroll',clear,true);
})();
function svgLineChart(points,selectedKey,w,h){if(!points.length)return '<div class="chart-empty">Upload monthly files to see volume.</div>';const padL=44,padR=16,padT=26,padB=30,max=Math.max(1,...points.map(p=>p.value)),niceMax=niceMaxOf(max),innerW=w-padL-padR,innerH=h-padT-padB,stepX=points.length>1?innerW/(points.length-1):0,x=i=>padL+i*stepX,y=v=>padT+innerH-(v/niceMax)*innerH;const grid=[0,0.25,0.5,0.75,1].map(t=>{const gy=(padT+innerH-t*innerH).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="9" fill="#9aa6a0" text-anchor="end">${Math.round(niceMax*t).toLocaleString()}</text>`}).join('');const linePath=points.map((p,i)=>`${i===0?'M':'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');const areaPath=`${linePath} L${x(points.length-1).toFixed(1)},${(padT+innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT+innerH).toFixed(1)} Z`;const base=(padT+innerH).toFixed(1),colW=points.length>1?stepX:innerW;const dots=points.map((p,i)=>{const isSel=p.key===selectedKey,cx=x(i).toFixed(1),cy=y(p.value).toFixed(1),prev=i?points[i-1].value:null,hx=Math.max(0,x(i)-colW/2),hw=Math.min(w,x(i)+colW/2)-hx;return `<g class="lc-pt" data-i="${i}"><line class="lc-guide" x1="${cx}" y1="${padT}" x2="${cx}" y2="${base}" stroke="#0a7180" stroke-width="1" stroke-dasharray="3 3"/><circle class="lc-halo" cx="${cx}" cy="${cy}" r="11" fill="#0a7180"/><circle class="lc-dot" cx="${cx}" cy="${cy}" r="${isSel?6:4}" fill="${isSel?'#0b5660':'#0a7180'}" stroke="white" stroke-width="2"/><rect class="lc-hit" x="${hx.toFixed(1)}" y="0" width="${hw.toFixed(1)}" height="${h}" fill="transparent" data-x="${cx}" data-y="${cy}" data-label="${escapeHtml(p.key&&/^\d{4}-\d{2}$/.test(p.key)?monthLabel(p.key):p.label)}" data-value="${p.value}" data-prev="${prev??''}"/></g>`}).join('');const valueLabels=points.map((p,i)=>`<text class="lc-label" data-i="${i}" x="${x(i).toFixed(1)}" y="${(y(p.value)-12).toFixed(1)}" font-size="10" font-weight="700" fill="#0b5660" text-anchor="middle">${p.value.toLocaleString()}</text>`).join('');const xLabels=points.map((p,i)=>`<text x="${x(i).toFixed(1)}" y="${h-8}" font-size="9" fill="#7b8c93" text-anchor="middle">${escapeHtml(p.label)}</text>`).join('');return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="volume-line-chart"><defs><linearGradient id="volAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0a7180" stop-opacity="0.25"/><stop offset="100%" stop-color="#0a7180" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${areaPath}" fill="url(#volAreaFill)"/><path d="${linePath}" fill="none" stroke="#0a7180" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${valueLabels}${xLabels}${dots}</svg>`}
function renderVolumeChart(allRows){const sel=$('#volumeMonthFilter')?.value||'',rows=monthFiltered(allRows,sel),months=countBy(allRows,e=>recordMonth(e)||'Unspecified'),dateEntries=Object.entries(months).filter(([k])=>isDateMonth(k)).sort((a,b)=>a[0].localeCompare(b[0])),otherEntries=Object.entries(months).filter(([k])=>!isDateMonth(k)&&k!=='Unspecified').sort((a,b)=>b[1]-a[1]);$('#monthlyTotal').innerHTML=`<span class="rate-kpis"><span><strong>${rows.length.toLocaleString()}</strong>${unitWord()}</span></span>`;const el=$('#monthlyChart'),w=Math.max(360,el.clientWidth||760);el.innerHTML=svgLineChart(dateEntries.map(([k,v])=>({key:k,label:monthLabel(k,{month:'short'}),value:v})),sel,w,300);const otherEl=$('#monthlyOther');if(otherEl)otherEl.innerHTML=''}
function testNormKey(name){return String(name).toUpperCase().replace(/[^A-Z0-9]/g,'')}
const TEST_NAME_ALIAS_GROUPS=[['PGT-A HLA C typing','PGT-A+HLA C','PGT-A+ HLA C TYPING'],['VALIDATION','VALIDATON']];
const TEST_NAME_ALIAS_KEY=new Map(TEST_NAME_ALIAS_GROUPS.flatMap(group=>{const groupKey=testNormKey(group[0]);return group.map(n=>[testNormKey(n),groupKey])}));
// Standard test names (the lab's list) and every spelling seen in the sheets that
// means the same test. Matching ignores case, spaces and punctuation.
const TEST_CANONICAL=[
 ['PGT-A',['PGT-A','PGTA','PGT_A']],
 ['PGT-SR',['PGT-SR','PGT SR','PGTSR','PGT-A/PGT-SR','PGT-SR analysis only']],
 ['PGT-M',['PGT-M','PGT M','PGTM','PGT-M only','PGTM first','PGT-M first']],
 ['Embryo Sure',['Embryo Sure','Embryosure','PGT-A plus','PGT A plus','PGT/Embryosure','PGT-A/Embryosure','PGT-A+Embryo sure']],
 ['PGT-HLA-C Typing',['PGT-HLA-C typing','PGT HLA C typing']],
 ['Express Molecular Karyotyping by NGS',['Express molecular karyotyping by NGS','Express molecular typing by NGS','NGS karyotyping','AF','AF-NGS','CVS','POC']],
 ['NIPGS',['NIPGS','NIPGT']],
 ['PGT-M/Embryo Sure',['PGT-M/Embryosure','Embryosure/PGT-M','PGT-M+Embryosure']],
 ['Embryo Sure/HLA-C Typing',['Embryosure/HLA-C typing','Embryosure+HLA-C','Embryosure+HLC-C','Embryosure HLA C typing']],
 // PGT-A together with HLA-C typing is reported under PGT-A/M/HLA-C Typing.
 ['PGT-A/M/HLA-C Typing',['PGT-A/M/HLA-C typing','PGT-A+M+HLA','PGT-A+M+HLA-C','PGT-A+M+HLA C typing','PGT-A HLA C typing','PGT-A+HLA C','PGT-A+HLA C typing','PGT-A/HLA-C typing','PGTA HLA C']],
 ['PGT-A+M',['PGT-A+M','PGT-M+A','PGTA+M','PGT-A/M']],
 ['Embryology Validation',['Embryology validation','Embryo validation','Validation','Validaton']],
 ['Test Pending',['Test pending','TP','T.P','TET','N/A','NA']]
];
const TEST_CANON_BY_KEY=new Map(TEST_CANONICAL.flatMap(([name,variants])=>[name,...variants].map(v=>[testNormKey(v),name])));
function testIconFor(name){const t=String(name||'').toUpperCase().replace(/[^A-Z+]/g,'');const k=!t?'':/EMBRYOSURE/.test(t)?'embryosure':/HLA/.test(t)?'hla-c-typing':/NIPGS|NICS/.test(t)?'nipgs':/VALIDATION/.test(t)?'embryology-validation':/KARYO/.test(t)?'molecular-karyotyping':/POC/.test(t)?'poc':/PGTSR/.test(t)?'pgt-sr':/A\+M|PGTM/.test(t)?'pgt-m':/PGTA/.test(t)?'pgt-a':'';return k?`<img class="ico test-ico" src="/static/icons/tests-transfers__${k}.png" alt="">`:''}
function canonicalTestName(raw){const t=String(raw||'').trim();return t?TEST_CANON_BY_KEY.get(testNormKey(t))||t:''}
function testNameOf(e){return canonicalTestName(field(e,['test','test name']))||e._case.test}
function mergeTestNameVariants(counts){const groups=new Map;for(const[name,count]of Object.entries(counts)){const normKey=testNormKey(name),key=TEST_NAME_ALIAS_KEY.get(normKey)||normKey;const g=groups.get(key);if(g){g.total+=count;if(count>g.bestCount){g.bestCount=count;g.canonical=name}}else groups.set(key,{canonical:name,bestCount:count,total:count})}const merged={};for(const g of groups.values())merged[g.canonical]=g.total;return merged}
function renderTestChart(allRows){const rows=monthFiltered(allRows,$('#testMonthFilter')?.value||'');lastTestCounts=countBy(rows,testNameOf);if($('#testChart'))renderTestBarList('#testChart',lastTestCounts,rows.length)}
// Test-wise overview: one horizontal bar per standard test name, with count and share; click opens those samples.
function renderTestBarList(id,counts,total){
 const el=$(id);if(!el)return;
 const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}
 const peak=entries[0][1]||1,pct=v=>total?(v/total*100):0;
 el.innerHTML=`<div class="tw-list" style="--tw-rows:${Math.ceil(entries.length/2)}">${entries.map(([k,v],i)=>`<button type="button" class="tw-row" data-test="${escapeHtml(k)}" title="${escapeHtml(k)}: ${v.toLocaleString()} ${unitWord()} (${pct(v).toFixed(1)}%)"><span class="tw-name">${escapeHtml(k)}</span><span class="tw-bar"><span style="width:${Math.max(1.5,v/peak*100).toFixed(1)}%"></span></span><strong class="tw-count">${v.toLocaleString()}</strong><span class="tw-pct">${pct(v)<0.1&&v?'<0.1':pct(v).toFixed(1)}%</span></button>`).join('')}</div>`;
 el.onclick=e=>{const row=e.target.closest('[data-test]');if(!row)return;['embryologist','client','test','region','result','storage','transfer','reportStatus','run'].forEach(k=>{const f=$(`#${k}Filter`);if(f)f.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=$('#testMonthFilter')?.value||'';const tf=$('#testFilter');if(tf){if(![...tf.options].some(o=>o.value===row.dataset.test))tf.add(new Option(row.dataset.test,row.dataset.test));tf.value=row.dataset.test}showView('cases');renderCases()};
}
function svgMultiLineChart(points,series,w,h){if(!points.length)return '<div class="chart-empty">No data yet.</div>';const padL=44,padR=16,padT=26,padB=30,max=Math.max(1,...points.flatMap(p=>series.map(s=>p[s.key]))),niceMax=Math.max(500,Math.ceil(max/500)*500),nSteps=niceMax/500,fr=nSteps<=6?Array.from({length:nSteps+1},(_,k)=>k/nSteps):[0,0.25,0.5,0.75,1],innerW=w-padL-padR,innerH=h-padT-padB,stepX=points.length>1?innerW/(points.length-1):0,x=i=>padL+i*stepX,y=v=>padT+innerH-(v/niceMax)*innerH;const grid=fr.map(t=>{const gy=(padT+innerH-t*innerH).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="9" fill="#9aa6a0" text-anchor="end">${Math.round(niceMax*t).toLocaleString()}</text>`}).join('');const lines=[...series].reverse().map(s=>{let pen=false;const path=points.map((p,i)=>{if(p.empty&&!s.always&&!s.full){pen=false;return''}const cmd=pen?'L':'M';pen=true;return `${cmd}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`}).filter(Boolean).join(' ');if(!path)return'';const area=s.always&&points.length>1?`<path d="${path} L${x(points.length-1).toFixed(1)},${(padT+innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT+innerH).toFixed(1)} Z" fill="${s.color}" opacity="0.08"/>`:'';return `${area}<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.dash?2:2.5}"${s.dash?' stroke-dasharray="5 4"':''} stroke-linecap="round" stroke-linejoin="round"/>`}).join('');const base=(padT+innerH).toFixed(1),colW=points.length>1?stepX:innerW;const cols=points.map((p,i)=>{const cx=x(i).toFixed(1),top=Math.min(...series.map(sr=>y(p[sr.key]))).toFixed(1),hx=Math.max(0,x(i)-colW/2),hw=Math.min(w,x(i)+colW/2)-hx,rows=series.map(sr=>({label:sr.label,color:sr.color,value:p[sr.key]})),full=p.key&&/^\d{4}-\d{2}$/.test(p.key)?monthLabel(p.key):p.label;const pts=series.filter(sr=>sr.always||sr.full||!p.empty).map(sr=>{const cy=y(p[sr.key]).toFixed(1);return `<circle class="lc-halo" cx="${cx}" cy="${cy}" r="10" fill="${sr.color}"/><circle class="lc-dot" cx="${cx}" cy="${cy}" r="3.5" fill="${sr.color}" stroke="white" stroke-width="1.5"/>`}).join('');return `<g class="lc-pt" data-i="${i}"><line class="lc-guide" x1="${cx}" y1="${padT}" x2="${cx}" y2="${base}" stroke="#6b7a73" stroke-width="1" stroke-dasharray="3 3"/>${pts}<rect class="lc-hit" x="${hx.toFixed(1)}" y="0" width="${hw.toFixed(1)}" height="${h}" fill="transparent" data-x="${cx}" data-y="${top}" data-label="${escapeHtml(full)}" data-series="${escapeHtml(JSON.stringify(rows)).replace(/"/g,'&quot;')}"/></g>`}).join('');const xLabels=points.map((p,i)=>`<text x="${x(i).toFixed(1)}" y="${h-8}" font-size="9" fill="#7b8c93" text-anchor="middle">${escapeHtml(p.label)}</text>`).join('');return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="volume-line-chart">${grid}${lines}${xLabels}${cols}</svg>`}
function renderOutcomeChart(allRows){const monthKeys=[...new Set(allRows.map(recordMonth))].filter(isDateMonth).sort(),series=[{key:'pass',label:'QC Pass',color:QUALITY_GOOD,full:true},{key:'fail',label:'QC Fail',color:QUALITY_CRITICAL,full:true},{key:'awaiting',label:'Awaiting result',color:'#98a4a0',dash:true,always:true}];let totalPass=0,totalFail=0;const points=monthKeys.map(m=>{const rows=allRows.filter(e=>recordMonth(e)===m);let pass=0,fail=0;rows.forEach(e=>{const v=qcVerdict(e);if(v==='PASS')pass++;else if(v==='FAIL')fail++});totalPass+=pass;totalFail+=fail;return {key:m,label:monthLabel(m,{month:'short'}),pass,fail,awaiting:rows.length-pass-fail,empty:pass+fail===0}});const resolved=totalPass+totalFail,pending=allRows.length-resolved;$('#resultTotal').innerHTML=`<span class="rate-kpis"><span><strong>${allRows.length.toLocaleString()}</strong>${unitWord()}</span><span><strong>${pending.toLocaleString()}</strong>awaiting result</span></span>`;const el=$('#resultStack'),w=Math.max(360,el.clientWidth||760);el.innerHTML=svgMultiLineChart(points,series,w,220);$('#resultLegend').innerHTML=series.map(s=>`<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#52625a"><i style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block"></i>${s.label}</span>`).join('')}
function renderClientChart(allRows){const rows=monthFiltered(allRows,$('#clientMonthFilter')?.value||'');lastClientCounts=countBy(rows,e=>e._case.client);const major=Object.fromEntries(Object.entries(lastClientCounts).filter(([,v])=>v>=CLIENT_MIN_SAMPLES)),hasMajor=Object.keys(major).length>0,shown=hasMajor?major:lastClientCounts,note=$('#clientChartNote');if(note)note.textContent=hasMajor?`Clients with ${CLIENT_MIN_SAMPLES}+ ${unitWord()} · ${Object.keys(major).length} of ${Object.keys(lastClientCounts).length} clients`:`No client has ${CLIENT_MIN_SAMPLES}+ ${unitWord()} in this period, so all are shown`;renderFullPieChart('#clientDonut','#clientLegend',shown,manyColorPalette(Object.keys(shown).length))}
function renderRegionChart(allRows){const rows=monthFiltered(allRows,$('#regionMonthFilter')?.value||'');lastRegionCounts=countBy(rows,e=>e._case.region);renderVerticalBarChart('#regionChart',Object.entries(lastRegionCounts).sort((a,b)=>b[1]-a[1]).slice(0,10),{total:Object.values(lastRegionCounts).reduce((a,b)=>a+b,0),of:`${unitWord()} (all regions)`})}
function renderPlatformChart(allRows){const rows=monthFiltered(allRows,$('#platformMonthFilter')?.value||''),platformMap=seqPlatformCanonicalMap(rows),platforms=countBy(rows,e=>{const raw=field(e,['seq platform']);if(!raw)return'';const k=platformMap.compactKey(raw);if(k==='SURFSEQ'||k==='SURFSSEQ')return'SurfSeq';if(k==='S5'||k==='IONS5')return'ION S5';return platformMap.canonical[k]});renderVerticalBarChart('#platformChart',Object.entries(platforms).sort((a,b)=>b[1]-a[1]),{of:`${unitWord()} with a platform recorded`})}
function renderQualitySection(allRows){const rows=monthFiltered(allRows,$('#qualityMonthFilter')?.value||'');let pass=0,fail=0;rows.forEach(e=>{const v=qcVerdict(e);if(v==='PASS')pass++;else if(v==='FAIL')fail++});const pending=rows.length-pass-fail;$('#failureRate').textContent=`${(pass+fail)?Math.round(fail/(pass+fail)*100):0}%`;$('#inconclusiveRate').textContent=`${rows.length?Math.round(pending/rows.length*100):0}%`;const mv=$('#qualityMonthFilter')?.value||'';renderEmbryologistBarChart('#qualityChart',embryologistQcStats(allEmbryos().filter(e=>mv?recordMonth(e)===mv:isDateMonth(recordMonth(e)))).sort((x,y)=>y.pass-x.pass||y.total-x.total||x.name.localeCompare(y.name)),10)}
// Overview stat cards: animated counts plus a line of context under each.
function countUp(el,to){if(!el)return;const from=Number(el.dataset.v||0);el.dataset.v=to;if(from===to||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){el.textContent=to.toLocaleString();return}const t0=performance.now(),dur=700;const step=t=>{const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=Math.round(from+(to-from)*e).toLocaleString();if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)}
function setMeter(id,pct){const el=$(id);if(el)el.style.width=`${Math.max(0,Math.min(100,pct))}%`}
// Report preparation = Attune upload and NGS report dates both still empty,
// counted over the current and previous month tabs (by today's date).
function reportPrepMonths(){const d=new Date(),key=(y,m)=>`${y}-${String(m+1).padStart(2,'0')}`,prev=new Date(d.getFullYear(),d.getMonth()-1,1);return [key(d.getFullYear(),d.getMonth()),key(prev.getFullYear(),prev.getMonth())]}
function isReportPrep(e,months=reportPrepMonths()){return !e._stale&&months.includes(recordMonth(e))&&!field(e,['attune upload'])&&!field(e,['ngs report'])}
function isRebiopsy(e){return !e._stale&&/re.?biopsy/i.test(field(e,['remarks']))}
// Report preparation page: every sample counted by the Overview card.
function parseSheetDate(v){const m=/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(String(v||'').trim());if(!m)return null;const d=new Date(+m[3],+m[2]-1,+m[1]);return isNaN(d)?null:d}
function reportPrepMarkup(){return `<div class="prep-toolbar"><div class="prep-segments" id="prepSegments" role="tablist"></div><div class="prep-search"><input id="prepSearch" type="search" placeholder="Search patient, sample ID, client, embryologist…" aria-label="Search report preparation samples"></div></div><div class="prep-table-wrap" id="prepTableWrap"><div class="chart-empty">Loading…</div></div>`}
function setupReportPrepView(){
 const months=reportPrepMonths(),today=new Date();today.setHours(0,0,0,0);
 const rows=allEmbryos().filter(e=>isReportPrep(e,months)).map(e=>{const rec=parseSheetDate(field(e,['date sample received'])),days=rec?Math.max(0,Math.round((today-rec)/864e5)):null;return{e,patient:e._case.patient||field(e,['patient name'])||'—',sampleId:field(e,['sample id'])||e._case.id||'—',embryos:field(e,['embryo name'])||'—',count:embryoUnits(e),test:canonicalTestName(field(e,['test name']))||e._case.test||'—',client:e._case.client||'—',embryologist:e._case.embryologist||'—',received:field(e,['date sample received'])||'—',wga:field(e,['wga done on'])||'',seq:field(e,['seq date'])||'',month:recordMonth(e),days}}).sort((a,b)=>(b.days??-1)-(a.days??-1));
 let seg='',q='';
 const segEl=$('#prepSegments'),wrap=$('#prepTableWrap'),search=$('#prepSearch');
 const segs=[['',`All · ${rows.length}`],...months.map(m=>[m,`${monthLabel(m,{month:'long'})} · ${rows.filter(r=>r.month===m).length}`])];
 const drawSegs=()=>{segEl.innerHTML=segs.map(([k,l])=>`<button type="button" role="tab" class="prep-seg${k===seg?' active':''}" data-seg="${k}" aria-selected="${k===seg}">${escapeHtml(l)}</button>`).join('')};
 const stage=r=>r.seq?['Ready for report','ready']:r.wga?['Awaiting sequencing','seq']:['Awaiting WGA','wga'];
 const draw=()=>{const needle=q.trim().toLowerCase(),list=rows.filter(r=>(!seg||r.month===seg)&&(!needle||[r.patient,r.sampleId,r.client,r.embryologist,r.test,r.embryos].join(' ').toLowerCase().includes(needle)));
  if(!list.length){wrap.innerHTML='<div class="chart-empty">No samples match.</div>';return}
  wrap.innerHTML=`<table class="prep-table"><thead><tr><th class="num">S.No</th><th>Patient</th><th>Sample ID</th><th>Embryos</th><th>Test</th><th>Client</th><th>Embryologist</th><th>Received</th><th>Seq date</th><th>Stage</th><th class="num">Waiting</th></tr></thead><tbody>${list.map((r,i)=>{const [st,cls]=stage(r),late=r.days!=null&&r.days>21;return `<tr data-i="${rows.indexOf(r)}" tabindex="0"><td class="num muted">${i+1}</td><td class="strong">${escapeHtml(r.patient)}</td><td class="mono">${escapeHtml(r.sampleId)}</td><td title="${escapeHtml(r.embryos)}">${escapeHtml(r.embryos)} <small>(${r.count})</small></td><td>${escapeHtml(r.test)}</td><td class="clip" title="${escapeHtml(r.client)}">${escapeHtml(r.client)}</td><td class="clip" title="${escapeHtml(r.embryologist)}">${escapeHtml(r.embryologist)}</td><td class="muted">${escapeHtml(r.received)}</td><td class="muted">${r.seq?escapeHtml(r.seq):'—'}</td><td><span class="prep-stage ${cls}">${st}</span></td><td class="num"><span class="prep-days${late?' late':''}">${r.days==null?'—':`${r.days} d`}</span></td></tr>`}).join('')}</tbody></table>`};
 segEl.onclick=e=>{const b=e.target.closest('.prep-seg');if(!b)return;seg=b.dataset.seg;drawSegs();draw()};
 search.oninput=()=>{q=search.value;draw()};
 const open=tr=>{const r=rows[+tr.dataset.i];if(r)openPatient(r.e._case)};
 wrap.onclick=e=>{const tr=e.target.closest('tbody tr');if(tr)open(tr)};
 wrap.onkeydown=e=>{if(e.key==='Enter'){const tr=e.target.closest('tbody tr');if(tr)open(tr)}};
 drawSegs();draw();
}
// Digital TRFs tab: "New TRF" is the requisition form laid out like the paper template,
// typed into directly (the draft stays on this device until submitted); "Submitted" lists
// every TRF sent, to review, print or mark received.
function trfsMarkup(){return `<div class="trf-tabbar"><div class="prep-segments" id="trfModeSeg" role="tablist" aria-label="TRF view"><button type="button" class="prep-seg active" data-mode="new">New TRF</button><button type="button" class="prep-seg" data-mode="list">Submitted <span class="ac-scope-n" id="trfListCount">0</span></button></div><label class="trf-type-pick" id="trfTypePick"><span>Form</span><select id="trfFormType" aria-label="TRF form type"><option value="PGT-A">PGT-A / PGT-SR / Embryo Sure</option><option value="PGT-M">PGT-M (mutation testing)</option></select></label><div class="trf-newbar" id="trfNewBar"><span class="trf-formbar-note">Fields marked <b class="td-req">*</b> are required. Signatures and clinician seal are signed on the printed copy.</span><div class="trf-formbar-actions"><button type="button" class="secondary compact" id="trfPreview">Preview</button><button type="button" class="secondary compact" id="trfClear">Clear form</button></div></div></div>
<div id="trfNewPane"><div class="trf-sign-pending hidden" id="trfSignPending"></div><div class="trf-error hidden" id="trfError" role="alert"></div><div class="trf-sheet" id="trfSheet"></div><div class="trf-submit-row"><button type="button" class="primary compact" id="trfSubmit">Submit TRF</button></div><datalist id="trfClinicList"></datalist></div>
<div id="trfListPane" class="hidden"><div class="prep-toolbar"><div class="prep-segments" id="trfStatusSeg" role="tablist" aria-label="Filter TRFs by status"></div><div class="search-wrap"><span>⌕</span><input id="trfSearch" type="search" placeholder="Search patient, clinic, doctor, reference…" aria-label="Search TRFs"></div></div><div class="prep-table-wrap" id="trfTableWrap"><div class="chart-empty">Loading…</div></div></div>`}
let clinicNames=[];
async function setupTrfsView(){
 const DRAFT='em-trf-draft',sheet=$('#trfSheet'),wrap=$('#trfTableWrap'),seg=$('#trfStatusSeg'),search=$('#trfSearch');let rows=[],status='New';
 // Clinic suggestions from the client list (clients.js); any other name can be typed.
 try{const names=new Set();clientDirectory().forEach(({brand,branches})=>branches.forEach(b=>names.add(b.branch?`${brand} – ${b.branch}`:brand)));clinicNames=[...names].sort()}catch{}
 // Clinic suggestions appear only for what the person types (never the whole client list - one client must not see the others).
 {const box=document.createElement('div');box.className='trf-suggest hidden';document.body.appendChild(box);let cur=null,idx=-1;
  const hide=()=>{box.classList.add('hidden');idx=-1},pick=v=>{if(!cur)return;cur.value=v;cur.dispatchEvent(new Event('input',{bubbles:true}));hide()},mark=()=>[...box.children].forEach((c,i)=>c.classList.toggle('on',i===idx));
  sheet.addEventListener('input',e=>{const t=e.target;if(t.dataset?.f!=='hospital')return;cur=t;const q=t.value.trim().toLowerCase();if(q.length<2){hide();return}const words=q.split(/\s+/),hits=clinicNames.filter(n=>{const l=n.toLowerCase();return words.every(w=>l.includes(w))}).slice(0,8);if(!hits.length){hide();return}const r=t.getBoundingClientRect();box.style.cssText=`left:${r.left}px;top:${r.bottom+4}px;width:${r.width}px`;box.innerHTML=hits.map(n=>`<button type="button" tabindex="-1">${escapeHtml(n)}</button>`).join('');box.classList.remove('hidden');idx=-1});
  box.addEventListener('mousedown',e=>{const b=e.target.closest('button');if(!b)return;e.preventDefault();pick(b.textContent)});
  sheet.addEventListener('keydown',e=>{if(e.target.dataset?.f!=='hospital'||box.classList.contains('hidden'))return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();idx=(idx+(e.key==='ArrowDown'?1:-1)+box.children.length)%box.children.length;mark()}else if(e.key==='Enter'&&idx>=0){e.preventDefault();pick(box.children[idx].textContent)}else if(e.key==='Escape')hide()});
  sheet.addEventListener('focusout',e=>{if(e.target.dataset?.f==='hospital')setTimeout(hide,120)});window.addEventListener('scroll',hide,true)}
 const saveDraft=()=>{try{localStorage.setItem(DRAFT,JSON.stringify(trfCollect(sheet)))}catch{}};
 const renderForm=d=>{sheet.innerHTML=trfFormHtml(d||{});trfWire(sheet,saveDraft)};
 // Switching between the PGT-A and PGT-M requisition forms rebuilds the form around what is already typed.
 const typeSel=$('#trfFormType'),syncType=d=>{typeSel.value=d.formType==='PGT-M'?'PGT-M':'PGT-A'};
 typeSel.onchange=()=>{const d=trfCollect(sheet);d.formType=typeSel.value;d.tests=[];renderForm(d);saveDraft()};
 let draft={};try{draft=JSON.parse(localStorage.getItem(DRAFT)||'{}')||{}}catch{}
 renderForm(draft);syncType(draft);
 const showError=msg=>{const el=$('#trfError');el.textContent=msg;el.classList.toggle('hidden',!msg);if(msg)el.scrollIntoView({block:'center',behavior:'smooth'})};
 $('#trfClear').onclick=()=>{if(!confirm('Clear everything typed into this TRF?'))return;try{localStorage.removeItem(DRAFT)}catch{}renderForm({});syncType({});showError('')};
 $('#trfPreview').onclick=()=>openTrfDialog({data:trfCollect(sheet),ref:'',patient:'',status:'Draft',submittedAt:''});
 $('#trfSubmit').onclick=async()=>{const d=trfCollect(sheet),p=trfProblems(d);
  sheet.querySelectorAll('.invalid').forEach(x=>x.classList.remove('invalid'));
  Object.keys(TRF_REQUIRED).forEach(k=>{if(!d[k])sheet.querySelector(`[data-f="${k}"]`)?.classList.add('invalid')});
  if(p.length){showError('Please fill in: '+p.join(', ')+'.');return}
  showError('');const btn=$('#trfSubmit');btn.disabled=true;btn.textContent='Submitting…';
  try{const r=await fetch('/api/trf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}),body=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(typeof body.detail==='string'?body.detail:'The TRF could not be submitted. Please try again.');
   try{localStorage.removeItem(DRAFT)}catch{}
   renderForm({});syncType({});toast(`TRF ${body.ref} submitted`);
   await load();await trfSignedDialog({id:body.id,ref:body.ref,submittedAt:body.submittedAt,patient:d.patientName},d);await loadPending()}
  catch(err){showError(err.message)}finally{btn.disabled=false;btn.textContent='Submit TRF'}};
 const loadPending=async()=>{const box=$('#trfSignPending');if(!box)return;let list=[];try{const r=await fetch('/api/my-trfs');if(r.ok)list=(await r.json()).filter(x=>!x.signedUrl&&x.status!=='Rejected')}catch{}
  if(!list.length){box.classList.add('hidden');box.innerHTML='';return}
  box.classList.remove('hidden');box.innerHTML=`<div class="tsp-head"><strong>Signed copy still needed</strong><span>${list.length} TRF${list.length===1?'':'s'} · print, get the patient's signature, scan and upload within 24 hours of submitting</span></div>${list.map(x=>`<div class="tsp-row${x.signedOverdue?' late':''}" data-id="${x.id}"><div><b>${escapeHtml(x.ref)}</b> · ${escapeHtml(x.patient)}<small>${escapeHtml(new Date(x.submittedAt).toLocaleString([],{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}${x.signedOverdue?' · <em>overdue</em>':''}</small></div><div class="tsp-actions"><button type="button" class="secondary compact" data-print>Print</button><label class="primary compact tsp-up">Upload signed copy<input type="file" accept="application/pdf,image/*" hidden></label></div></div>`).join('')}`;
  box.querySelectorAll('.tsp-row').forEach(row=>{const id=row.dataset.id,x=list.find(v=>String(v.id)===id);
   row.querySelector('[data-print]').onclick=async()=>{const r=await fetch(`/api/trf/${id}`);if(!r.ok){toast('Could not open this TRF to print');return}const t=await r.json();printTrf(t.data,{ref:t.ref,submittedAt:t.submittedAt})};
   row.querySelector('input').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await uploadSignedTrf(id,f);toast(`Signed copy received for ${x.ref}`);await loadPending()}catch(err){toast(err.message)}}})};
 loadPending();
 // Submitted list
 const STATUSES=['New','Approved','Rejected','Unsigned','All'],inSeg=(s,r)=>s==='All'||(s==='Unsigned'?!r.signedUrl&&r.status!=='Rejected':r.status===s);
 const fmt=iso=>iso?new Date(iso).toLocaleString([],{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 const testNames=t=>(t||[]).map(k=>({'PGT-A':'PGT-A','EMBRYO_SURE':'Embryo Sure','PGT-SR':'PGT-SR','PGT-HLA':'HLA C typing','PGT-M':'PGT-M','PGT-A+M':'PGT-A+M','PGT-A+M+HLA':'PGT-A+M+HLA'}[k]||k)).join(', ');
 const draw=()=>{const q=search.value.trim().toLowerCase();
  seg.innerHTML=STATUSES.map(s=>`<button type="button" class="prep-seg${s===status?' active':''}" data-status="${s}">${s} <span class="ac-scope-n">${rows.filter(r=>inSeg(s,r)).length}</span></button>`).join('');
  const list=rows.filter(r=>inSeg(status,r)&&(!q||[r.ref,r.patient,r.clinic,r.doctor].join(' ').toLowerCase().includes(q)));
  if(!list.length){wrap.innerHTML=`<div class="chart-empty">${rows.length?'No TRFs match.':'No TRFs submitted yet.'}</div>`;return}
  wrap.innerHTML=`<table class="prep-table"><thead><tr><th>Reference</th><th>Submitted</th><th>Patient</th><th>Clinic</th><th>Referring doctor</th><th>Tests</th><th>Biopsy date</th><th class="num">Embryos</th><th>Status</th><th>Signed copy</th><th>Action</th></tr></thead><tbody>${list.map(r=>`<tr data-id="${r.id}" tabindex="0"><td class="mono">${escapeHtml(r.ref)}</td><td class="muted">${escapeHtml(fmt(r.submittedAt))}</td><td class="strong">${escapeHtml(r.patient)}</td><td class="clip" title="${escapeHtml(r.clinic)}">${escapeHtml(r.clinic)}</td><td>${escapeHtml(r.doctor)}</td><td>${escapeHtml(testNames(r.tests))}</td><td class="muted">${escapeHtml(r.biopsyDate||'—')}</td><td class="num">${r.embryos}</td><td><span class="trf-status s-${r.status.toLowerCase()}">${escapeHtml(r.status)}</span>${r.statusNote?`<small class="trf-note" title="${escapeHtml(r.statusNote)}">${escapeHtml(r.statusNote)}</small>`:''}</td><td>${trfSignedCell(r)}</td><td class="trf-row-actions">${r.status!=='Approved'?`<button type="button" class="secondary compact" data-set="Approved" data-id="${r.id}">Approve</button>`:''}${r.status!=='Rejected'?`<button type="button" class="secondary compact" data-set="Rejected" data-id="${r.id}">Reject</button>`:''}<button type="button" class="secondary compact trf-del" data-del="${r.id}" data-ref="${escapeHtml(r.ref)}" title="Delete this TRF" aria-label="Delete ${escapeHtml(r.ref)}">Delete</button></td></tr>`).join('')}</tbody></table>`};
 const load=async()=>{try{const res=await fetch('/api/trf');if(!res.ok)throw 0;rows=await res.json();const n=rows.filter(r=>r.status==='New').length,nav=$('#trfNavCount');if(nav)nav.textContent=n;$('#trfListCount').textContent=rows.length;draw()}catch{wrap.innerHTML='<div class="chart-empty">Submitted TRFs could not be loaded. Try again.</div>'}};
 $('#trfModeSeg').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;$('#trfModeSeg').querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));$('#trfNewPane').classList.toggle('hidden',b.dataset.mode!=='new');$('#trfListPane').classList.toggle('hidden',b.dataset.mode!=='list');$('#trfTypePick').classList.toggle('hidden',b.dataset.mode!=='new');$('#trfNewBar').classList.toggle('hidden',b.dataset.mode!=='new')};
 seg.onclick=e=>{const b=e.target.closest('[data-status]');if(b){status=b.dataset.status;draw()}};
 search.oninput=draw;
 const decide=async(id,s,ref)=>{const note=await trfRemarkDialog(s,ref);if(note===null)return;const r=await fetch(`/api/trf/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{status:s,note}})});if(r.ok){const j=await r.json().catch(()=>({}));toast(`TRF marked ${s}`+({sending:' · email sent to the client',"no-address":' · no client email on this TRF (nobody was emailed)',"not-configured":' · email is not set up on the server'}[j.emailStatus]||''));await load()}else{const j=await r.json().catch(()=>({}));toast(j.detail||'Status could not be changed')}};
 const open=async id=>{const res=await fetch(`/api/trf/${id}`);if(!res.ok){toast('This TRF could not be opened');return}openTrfDialog(await res.json(),async s=>{await decide(id,s)},load)};
 wrap.onclick=async e=>{if(e.target.closest('a[data-signed]')){e.stopPropagation();return}const del=e.target.closest('button[data-del]');if(del){e.stopPropagation();if(!confirm(`Delete ${del.dataset.ref} permanently? This removes the TRF and its PDF and cannot be undone.`))return;del.disabled=true;const r=await fetch(`/api/trf/${del.dataset.del}`,{method:'DELETE'});if(r.ok){toast(`${del.dataset.ref} deleted`);await load()}else{toast('TRF could not be deleted');del.disabled=false}return}const b=e.target.closest('button[data-set]');if(b){e.stopPropagation();b.disabled=true;await decide(b.dataset.id,b.dataset.set,b.closest('tr')?.querySelector('.mono')?.textContent);b.disabled=false;return}const tr=e.target.closest('tbody tr');if(tr)open(tr.dataset.id)};
 wrap.onkeydown=e=>{if(e.key==='Enter'){const tr=e.target.closest('tbody tr');if(tr)open(tr.dataset.id)}};
 await load();
}
async function uploadSignedTrf(id,file){const fd=new FormData();fd.append('file',file);const r=await fetch(`/api/trf/${id}/signed`,{method:'POST',body:fd}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:'The signed copy could not be uploaded');return j}
const trfFmtWhen=iso=>iso?new Date(iso).toLocaleString([],{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
function trfSignedCell(r){if(r.signedUrl)return `<a class="trf-signed ok" data-signed href="${escapeHtml(r.signedUrl)}" target="_blank" rel="noopener" title="Open the signed copy">Received</a><small class="trf-note">${escapeHtml(trfFmtWhen(r.signedAt))}</small>`;if(r.status==='Rejected')return '<span class="muted">—</span>';return r.signedOverdue?'<span class="trf-signed late">Overdue</span>':'<span class="trf-signed wait">Awaiting</span>'}
function trfSignedBar(t){const up=`<label class="secondary compact tsp-up">${t.signedUrl?'Replace':'Upload signed copy'}<input type="file" id="trfSignedUp" accept="application/pdf,image/*" hidden></label>`;
 if(t.signedUrl)return `<div class="trf-signedbar ok"><span><b>Patient-signed copy received</b> · ${escapeHtml(trfFmtWhen(t.signedAt))}${t.signedBy?` · by ${escapeHtml(t.signedBy)}`:''}</span><span class="tsb-actions"><a class="secondary compact" href="${escapeHtml(t.signedUrl)}" target="_blank" rel="noopener">View signed copy</a>${up}</span></div>`;
 return `<div class="trf-signedbar ${t.signedOverdue?'late':''}"><span><b>${t.signedOverdue?'Signed copy overdue':'Signed copy not received yet'}</b> · due within 24 hours of submission</span><span class="tsb-actions">${up}</span></div>`}
// Shown right after a TRF is submitted: print it, get the patient's signature, scan and upload it back.
function trfSignedDialog(t,d){return new Promise(resolve=>{const dlg=document.createElement('dialog');dlg.className='trf-remark-dialog trf-sign-dialog';
 dlg.innerHTML=`<form method="dialog"><h3>TRF submitted · ${escapeHtml(t.ref)}</h3><p class="tsd-lead">Please upload the <b>patient-signed copy</b> as soon as possible. It is mandatory.</p><ol class="tsd-steps"><li>Print the TRF</li><li>Get the patient to sign it</li><li>Scan the signed copy and upload it here</li></ol><div class="tsd-actions"><button type="button" class="secondary compact" data-print>Print TRF</button><label class="primary compact tsp-up">Upload signed copy<input type="file" accept="application/pdf,image/*" hidden></label></div><p class="tsd-note">The team is notified if the signed copy has not been received within 24 hours.</p><p class="trf-remark-err hidden" data-err></p><div class="trf-remark-actions"><button type="button" class="secondary compact" data-later>I'll upload it later</button></div></form>`;
 document.body.appendChild(dlg);const done=()=>{dlg.close();dlg.remove();resolve()};
 dlg.querySelector('[data-print]').onclick=()=>printTrf(d,{ref:t.ref,submittedAt:t.submittedAt});
 dlg.querySelector('[data-later]').onclick=done;dlg.addEventListener('cancel',e=>{e.preventDefault();done()});
 dlg.querySelector('input').onchange=async e=>{const f=e.target.files[0];if(!f)return;const err=dlg.querySelector('[data-err]');err.classList.add('hidden');try{await uploadSignedTrf(t.id,f);toast(`Signed copy received for ${t.ref}`);done()}catch(x){err.textContent=x.message;err.classList.remove('hidden')}};
 dlg.showModal()})}
// Asks the approver for a remark before a TRF is approved (optional) or rejected (required). Resolves to the text, or null if cancelled.
function trfRemarkDialog(status,ref){return new Promise(resolve=>{const need=status==='Rejected',dlg=document.createElement('dialog');dlg.className='trf-remark-dialog';
 dlg.innerHTML=`<form method="dialog"><h3>${status==='New'?'Move back to New':status==='Approved'?'Approve TRF':'Reject TRF'}${ref?` · ${escapeHtml(ref)}`:''}</h3><label>Remark${need?' <b class="td-req">*</b>':' <small>(optional)</small>'}<textarea rows="4" maxlength="1000" placeholder="${need?'Why is this TRF being rejected?':'Add a note for the clinic / lab (optional)'}"></textarea></label><p class="trf-remark-err hidden">Please give a reason for rejecting.</p><div class="trf-remark-actions"><button type="button" class="secondary compact" data-x>Cancel</button><button type="button" class="primary compact" data-ok>${status==='Rejected'?'Reject':status==='Approved'?'Approve':'Confirm'}</button></div></form>`;
 document.body.appendChild(dlg);const ta=dlg.querySelector('textarea'),done=v=>{dlg.close();dlg.remove();resolve(v)};
 dlg.querySelector('[data-x]').onclick=()=>done(null);dlg.addEventListener('cancel',e=>{e.preventDefault();done(null)});
 dlg.querySelector('[data-ok]').onclick=()=>{const v=ta.value.trim();if(need&&!v){dlg.querySelector('.trf-remark-err').classList.remove('hidden');ta.focus();return}done(v)};
 dlg.showModal();ta.focus()})}
// One TRF shown the way it prints, with Print/PDF and status buttons.
function openTrfDialog(t,setStatus,onChange){let dlg=$('#trfDialog');
 if(!dlg){dlg=document.createElement('dialog');dlg.id='trfDialog';dlg.className='trf-dialog';document.body.appendChild(dlg);dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()})}
 const meta={ref:t.ref,submittedAt:t.submittedAt};
 const header=t.ref?`<strong>${escapeHtml(t.ref)}</strong> · ${escapeHtml(t.patient)} <span class="trf-status s-${t.status.toLowerCase()}">${escapeHtml(t.status)}</span>${t.statusBy?`<small> by ${escapeHtml(t.statusBy)}</small>`:''}`:`<strong>Preview</strong> <span class="muted">— not yet submitted</span>`;
 const statusButtons=t.ref?`${t.status!=='Approved'?'<button type="button" class="secondary compact" data-set="Approved">Approve</button>':''}${t.status!=='Rejected'?'<button type="button" class="secondary compact" data-set="Rejected">Reject</button>':''}${t.status!=='New'?'<button type="button" class="secondary compact" data-set="New">Move back to New</button>':''}`:'';
 const pdfLink=t.pdfUrl?`<a class="secondary compact" href="${escapeHtml(t.pdfUrl)}" download>Download PDF</a>`:'';
 // A submitted TRF has no reliable link to a case (the clinic just types a patient name) - a lab
 // user confirms the match here, which is what lets the lab-PC sync route this TRF's PDF correctly.
 const caseLink=t.ref?`<div class="trf-case-link"><span class="crb-label">CASE</span>${t.caseCode?`<span class="trf-case-linked">${escapeHtml(t.caseCode)}</span>`:`<input list="trfCaseList" id="trfCaseInput" placeholder="Search case ID or patient…" autocomplete="off"><datalist id="trfCaseList">${(typeof cases!=='undefined'?cases:[]).map(c=>`<option value="${escapeHtml(c.id)} — ${escapeHtml(c.patient)}">`).join('')}</datalist><button type="button" class="secondary compact" id="trfLinkCase">Link</button>`}</div>`:'';
 dlg.innerHTML=`<div class="trf-dialog-bar"><div>${header}${caseLink}</div><div class="trf-dialog-actions">${statusButtons}${pdfLink}<button type="button" class="primary compact" id="trfPrint">Print / PDF</button><button type="button" class="close" aria-label="Close">×</button></div></div>${t.ref?trfSignedBar(t):''}${t.statusNote?`<div class="trf-remark"><b>${escapeHtml(t.status)} remark</b>${t.statusBy?` · ${escapeHtml(t.statusBy)}`:''}<p>${escapeHtml(t.statusNote)}</p></div>`:''}${t.ref?trfFollowupHtml(t.data)+trfImagesHtml(t.data):''}<div class="trf-dialog-doc trf-dialog-pdf"><p class="trf-pdf-loading">Preparing the form…</p></div>`;
 // Show the real filled paper form (the same PDF that is printed and filed); the HTML layout is only a fallback.
 (async()=>{const box=dlg.querySelector('.trf-dialog-doc');try{let res;if(t.pdfUrl)res=await fetch(t.pdfUrl);else res=await fetch('/api/trf/preview-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:t.data,meta:{ref:t.ref||'',submittedAtText:t.submittedAt?new Date(t.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).toUpperCase():''}})});
   if(!res.ok)throw 0;const url=URL.createObjectURL(new Blob([await res.arrayBuffer()],{type:'application/pdf'}));if(!dlg.open&&!dlg.isConnected)return;box.innerHTML=`<iframe class="trf-pdf-frame" src="${url}#toolbar=0&navpanes=0&statusbar=0&messages=0&view=FitH" title="TRF"></iframe>`}catch{box.classList.remove('trf-dialog-pdf');box.innerHTML=trfPagesHtml(t.data,meta)}})();
 dlg.querySelector('.close').onclick=()=>dlg.close();
 dlg.querySelector('#trfSignedUp')?.addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const u=await uploadSignedTrf(t.id,f);toast('Signed copy saved');if(typeof onChange==='function')await onChange();if(typeof loadTrfOverdue==='function')loadTrfOverdue();openTrfDialog({...t,...u},setStatus,onChange)}catch(err){toast(err.message)}});
 dlg.querySelector('#trfPrint').onclick=()=>printTrf(t.data,meta);
 dlg.querySelectorAll('[data-set]').forEach(b=>b.onclick=async()=>{dlg.close();await setStatus(b.dataset.set)});
 const linkBtn=dlg.querySelector('#trfLinkCase');
 if(linkBtn)linkBtn.onclick=async()=>{const raw=dlg.querySelector('#trfCaseInput').value.trim(),caseCode=raw.split(' — ')[0].trim();if(!caseCode){toast('Type or pick a case first');return}
  try{const res=await fetch(`/api/trf/${t.id}/case`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{caseCode}})});if(!res.ok)throw new Error();toast(`Linked to case ${caseCode}`);dlg.close()}catch{toast('Could not link this TRF to that case')}};
 dlg.showModal();
}
// Re-biopsy list: every sample whose Remarks column mentions a re-biopsy.
function rebiopsyMarkup(){return `<div class="filters-inline hidden" id="rebiopsyFiltersPanel"><label class="filter-field"><span>Month</span><select id="rebiopsyMonthFilter"><option value="">All months</option></select></label><label class="filter-field"><span>Test</span><select id="rebiopsyTestFilter"><option value="">All tests</option></select></label><label class="filter-field"><span>Client</span><select id="rebiopsyClientFilter"><option value="">All clients</option></select></label><label class="filter-field"><span>Embryologist</span><select id="rebiopsyEmbryologistFilter"><option value="">All embryologists</option></select></label><button class="text-button filters-clear" id="rebiopsyClearFilters">Clear all</button></div><div class="prep-table-wrap" id="rebiopsyTableWrap"><div class="chart-empty">Loading…</div></div>`}
function setupRebiopsyView(){
 const rows=allEmbryos().filter(isRebiopsy).map(e=>({e,patient:e._case.patient||field(e,['patient name'])||'—',sampleId:field(e,['sample id'])||e._case.id||'—',embryos:field(e,['embryo name'])||'—',test:canonicalTestName(field(e,['test name']))||e._case.test||'—',client:e._case.client||'—',embryologist:e._case.embryologist||'—',received:field(e,['date sample received'])||'—',remarks:field(e,['remarks'])||'—',month:recordMonth(e)})).sort((a,b)=>(b.month||'').localeCompare(a.month||''));
 // Patient view: one row per case, its re-biopsied records merged. Embryo view: one row per embryo tag.
 const byPatient=list=>{const m=new Map();for(const r of list){const c=r.e._case;let g=m.get(c);if(!g)m.set(c,g={...r,sampleIds:new Set(),embryoList:[],remarkSet:new Set()});g.sampleIds.add(r.sampleId);g.embryoList.push(r.embryos);g.remarkSet.add(r.remarks)}return[...m.values()].map(g=>({...g,sampleId:[...g.sampleIds].join(', '),embryos:g.embryoList.join(', '),remarks:[...g.remarkSet].join(' | ')}))};
 const byEmbryo=list=>list.flatMap(r=>{const tags=expandEmbryoTags(r.embryos);return tags.length>1?tags.map(t=>({...r,embryos:t})):[r]});
 let q='',frozen=false,mode='embryo';
 const wrap=$('#rebiopsyTableWrap'),search=$('#rebiopsySearch'),monthSel=$('#rebiopsyMonthFilter'),testSel=$('#rebiopsyTestFilter'),clientSel=$('#rebiopsyClientFilter'),embSel=$('#rebiopsyEmbryologistFilter'),badge=$('#rebiopsyFiltersBadge'),viewToggle=$('#rebiopsyViewToggle');
 const fillOptions=(sel,values)=>{const current=sel.value;sel.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());[...new Set(values)].filter(Boolean).sort().forEach(v=>sel.add(new Option(v,v)));sel.value=[...sel.options].some(o=>o.value===current)?current:''};
 fillOptions(monthSel,rows.map(r=>r.month));fillOptions(testSel,rows.map(r=>r.test));fillOptions(clientSel,rows.map(r=>r.client));fillOptions(embSel,rows.map(r=>r.embryologist));
 const updateBadge=()=>{const active=[monthSel,testSel,clientSel,embSel].filter(s=>s.value).length;badge.textContent=active;badge.classList.toggle('has-active',active>0)};
 const draw=()=>{const needle=q.trim().toLowerCase(),base=mode==='embryo'?byEmbryo(byPatient(rows)):byPatient(rows),list=base.filter(r=>(!needle||[r.patient,r.sampleId,r.client,r.embryologist,r.test,r.embryos,r.remarks].join(' ').toLowerCase().includes(needle))&&(!monthSel.value||r.month===monthSel.value)&&(!testSel.value||r.test===testSel.value)&&(!clientSel.value||r.client===clientSel.value)&&(!embSel.value||r.embryologist===embSel.value));
  updateBadge();
  if(!list.length){wrap.innerHTML='<div class="chart-empty">No re-biopsy samples match.</div>';return}
  wrap.innerHTML=`<table class="prep-table"><thead><tr><th class="num">S.No</th><th>Patient</th><th>Sample ID</th><th>Embryos</th><th>Test</th><th>Client</th><th>Embryologist</th><th>Received</th><th>Remarks</th></tr></thead><tbody>${list.map((r,i)=>`<tr data-i="${i}" tabindex="0"><td class="num muted">${i+1}</td><td class="strong">${escapeHtml(r.patient)}</td><td class="mono">${escapeHtml(r.sampleId)}</td><td title="${escapeHtml(r.embryos)}">${escapeHtml(r.embryos)}</td><td>${escapeHtml(r.test)}</td><td class="clip" title="${escapeHtml(r.client)}">${escapeHtml(r.client)}</td><td class="clip" title="${escapeHtml(r.embryologist)}">${escapeHtml(r.embryologist)}</td><td class="muted">${escapeHtml(r.received)}</td><td class="clip" title="${escapeHtml(r.remarks)}">${escapeHtml(r.remarks)}</td></tr>`).join('')}</tbody></table>`;
  wrap._list=list;applyColumnFreeze(wrap,frozen?3:0);
  fitTableHeight(wrap)};
 search.oninput=()=>{q=search.value;draw()};
 [monthSel,testSel,clientSel,embSel].forEach(s=>s.onchange=draw);
 $('#rebiopsyClearFilters').onclick=()=>{[monthSel,testSel,clientSel,embSel].forEach(s=>s.value='');q='';search.value='';draw()};
 if(viewToggle)viewToggle.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;viewToggle.querySelectorAll('.prep-seg').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b))});draw()};
 const freezeBtn=$('#rebiopsyFreezeToggle');
 freezeBtn.onclick=()=>{frozen=!frozen;freezeBtn.classList.toggle('active',frozen);$('#rebiopsyFreezeLabel').textContent=frozen?'Freeze columns (3)':'Freeze columns';draw()};
 const filtersBtn=$('#rebiopsyFiltersToggle'),filtersPanel=$('#rebiopsyFiltersPanel');
 filtersBtn.onclick=e=>{e.stopPropagation();filtersPanel.classList.toggle('hidden');filtersBtn.classList.toggle('active');fitTableHeight(wrap)};
 filtersPanel.onclick=e=>e.stopPropagation();
 const open=tr=>{const r=wrap._list?.[+tr.dataset.i];if(r)openPatient(r.e._case)};
 wrap.onclick=e=>{const tr=e.target.closest('tbody tr');if(tr)open(tr)};
 wrap.onkeydown=e=>{if(e.key==='Enter'){const tr=e.target.closest('tbody tr');if(tr)open(tr)}};
 draw();
}
// A "batch"/"run" is one Run ID block of the Sequencing Batch Record sheet (synced into
// embryomatrix-sequencing-runs). Each sheet sample (patient + embryo tag) is matched to its
// tracker embryo so result-file QC/conclusions show once uploaded; unmatched ones still list.
let seqRunsCache=[],seqRunsView=[],wgaCache=[],wgaView=[],homeBatchKind='seq';
const BATCH_KIND={seq:{title:id=>`RUN ${id}`,empty:'No runs in the Sequencing Batch Record sheet yet.'},wga:{title:id=>`BATCH ${id}`,empty:'No batches in the WGA batch record sheet yet.'}};
const sampleKey=s=>`${nameKey(s.patient)}|${cleanId(s.embryo)}`;
const nameKey=v=>String(v||'').toUpperCase().replace(/[^A-Z]/g,'');
function buildSampleIndex(){const idx=new Map;cases.forEach(c=>(c.embryos||[]).forEach(row=>{const k=nameKey(field(row,['patient name'])||c.patient);if(!k)return;expandEmbryoRow(row).forEach(x=>{const tag=cleanId(field(x,['sample name','embryo name','embryo']));if(!tag)return;if(!idx.has(k))idx.set(k,[]);idx.get(k).push({case:c,row,tag,data:x})})}));return idx}
function matchRunSample(idx,s){const k=nameKey(s.patient),tag=cleanId(s.embryo);if(!k||!tag)return null;
 // Sheet names carry suffixes the tracker doesn't ("RAGINI GANNOJU-RPT"), so fall back to containment.
 let pool=idx.get(k)||[];if(!pool.length&&k.length>=4)idx.forEach((list,key)=>{if(key.length>=4&&(key.includes(k)||k.includes(key)))pool=pool.concat(list)});
 const hits=pool.filter(x=>x.tag===tag);if(hits.length<2)return hits[0]||null;
 // A re-sequenced embryo can have one tracker row per run. Only trust a confirmed
 // received-date match - never guess by "whichever row already has a result", which
 // leaks an older run's stored result onto a newer, still-pending run.
 return hits.find(x=>s.received&&field(x.row,['date sample received'])===s.received)||null}
function runResultFiles(run){const id=`RUN${String(run.runId).toUpperCase()}`;return resultFilesCache.filter(f=>runNumberOf(f.fileName)===id||String(f.run||'').toUpperCase()===id)}
// Only results merged from an uploaded result file count - not the tracker's own "PGT result" text.
const runResult=m=>m&&m.row._embryoResults?.[m.tag]?m.data:null;
// Test columns of the Home run table: PGT A / PGT A+M / POC / PGT SR.
function runTestBucket(raw){const t=String(raw||'').toUpperCase().replace(/\s+/g,'');if(!t)return'';if(t.includes('POC'))return'POC';if(t.includes('SR'))return'PGT SR';if(t.includes('A+M')||t.includes('PGT-M')||t.includes('PGTM'))return'PGT A+M';if(t.includes('PGT-A')||t.includes('PGTA'))return'PGT A';return''}
function runBreakdown(items){const res=items.map(x=>runResult(x.m)).filter(Boolean),cls=res.map(conclusionClass),qc=res.map(qcVerdict);const tests={};items.forEach(x=>{const t=x.m&&runTestBucket(field(x.m.row,['test name','test']));if(t)tests[t]=(tests[t]||0)+1});const mosaic=cls.filter(c=>c==='Mosaic').length,inconclusive=cls.filter(c=>c==='Inconclusive').length;return{total:items.length,patients:new Set(items.map(x=>nameKey(x.s.patient))).size,euploid:cls.filter(c=>c==='Normal').length,aneuploid:cls.filter(c=>c==='Abnormal').length,mosaic,inconclusive,mosaicInc:mosaic+inconclusive,tests,pass:qc.filter(v=>v==='PASS').length,fail:qc.filter(v=>v==='FAIL').length}}
function buildRunsView(){const idx=buildSampleIndex(),view=(list,kind)=>list.map(r=>{const lastRec={},items=(r.samples||[]).map(s0=>{
   // The sheet only fills "received" on a patient's first embryo row; later rows inherit it so a re-sequenced patient's rows can still be told apart.
   const k=nameKey(s0.patient);let s=s0;if(s0.received)lastRec[k]=s0.received;else if(k&&lastRec[k])s={...s0,received:lastRec[k]};return{s,m:matchRunSample(idx,s)}});
  // Still ambiguous (several tracker rows hold this embryo tag): take the tracker row this patient's other embryos in the run matched.
  items.forEach(it=>{if(it.m)return;const k=nameKey(it.s.patient),tag=cleanId(it.s.embryo),sib=items.find(o=>o.m&&nameKey(o.s.patient)===k);if(!sib)return;const pool=idx.get(k)||[];it.m=pool.find(x=>x.tag===tag&&x.row===sib.m.row)||null});
  return{...r,kind,items,files:kind==='seq'?runResultFiles(r):[],b:runBreakdown(items)}});seqRunsView=view(seqRunsCache,'seq');wgaView=view(wgaCache,'wga');
 // Cross-link the two sheets by patient + embryo tag: which WGA batch fed which sequencing run.
 const runsOf=new Map,wgaOf=new Map,add=(m,k,v)=>{if(!m.has(k))m.set(k,new Set);m.get(k).add(v)};seqRunsView.forEach(r=>r.items.forEach(x=>add(runsOf,sampleKey(x.s),r.runId)));wgaView.forEach(w=>w.items.forEach(x=>add(wgaOf,sampleKey(x.s),w.runId)));
 const link=(v,map)=>v.forEach(r=>{const all=new Set;r.items.forEach(x=>{x.linked=[...(map.get(sampleKey(x.s))||[])];x.linked.forEach(id=>all.add(id))});r.linked=[...all]});link(wgaView,runsOf);link(seqRunsView,wgaOf)}
// Distinct runs across the uploaded result files (the run recorded on upload, else read from the file name).
const resultFileRuns=()=>[...new Set(resultFilesCache.map(f=>String(f.run||'').toUpperCase().replace(/\s+/g,'')||runNumberOf(f.fileName)).filter(Boolean))];
// Live pipeline strip: every sample in the PGS-NGS sheet by where it is right now. Click a stage to list its samples.
const FUNNEL_STAGES=[['pending','Awaiting WGA','received, no WGA date','#6b766f'],['wga','Awaiting sequencing','WGA done, no SEQ date','#2f6b98'],['seq','Report preparation','sequenced, report not finished','#c07a1d'],['released','Report released','NGS report + Attune upload','#1f8a52']];
function stageRows(){const out={pending:[],wga:[],seq:[],released:[]};cases.forEach(c=>(c.embryos||[]).forEach(row=>{if(isNotReporting(row))return;out[rowStage(row)].push({row,c,n:embryoRowsOf(row).length})}));return out}
function renderStageFunnel(){const el=$('#stageFunnel');if(!el)return;const st=stageRows(),count=k=>st[k].reduce((n,x)=>n+x.n,0),total=FUNNEL_STAGES.reduce((n,[k])=>n+count(k),0)||1;
 el.innerHTML=FUNNEL_STAGES.map(([k,label,hint,color])=>`<button type="button" class="sf-step" data-stage="${k}" style="--c:${color}" title="${escapeHtml(hint)} - click to list"><strong>${count(k).toLocaleString()}</strong><span>${label}</span><small>${hint}</small><i style="width:${Math.max(2,Math.round(count(k)/total*100))}%"></i></button>`).join('');
 el.onclick=e=>{const b=e.target.closest('[data-stage]');if(b)openStageList(b.dataset.stage)}}
function openStageList(stage){const def=FUNNEL_STAGES.find(x=>x[0]===stage),list=stageRows()[stage].slice().sort((a,b)=>(dmyKey(lastDmy(field(a.row,['date sample received']),a.row))||'').localeCompare(dmyKey(lastDmy(field(b.row,['date sample received']),b.row))||'')),LIMIT=400;
 let dlg=$('#stageDialog');if(!dlg){dlg=document.createElement('dialog');dlg.id='stageDialog';dlg.className='stage-dialog';document.body.appendChild(dlg);dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()})}
 const draw=q=>{const needle=q.trim().toLowerCase(),rows=list.filter(x=>!needle||[field(x.row,['patient name']),field(x.row,['sample id']),field(x.row,['center name','hospital clinic name']),field(x.row,['embryologist name']),field(x.row,['test name','test'])].join(' ').toLowerCase().includes(needle)),shown=rows.slice(0,LIMIT);
  dlg.querySelector('tbody').innerHTML=shown.map((x,i)=>`<tr data-i="${list.indexOf(x)}" tabindex="0"><td class="strong">${escapeHtml(field(x.row,['patient name'])||x.c.patient)}</td><td class="mono">${escapeHtml(field(x.row,['sample id'])||'—')}</td><td>${escapeHtml(canonicalTestName(field(x.row,['test name','test']))||'—')}</td><td class="clip">${escapeHtml(x.c.client||'—')}</td><td>${escapeHtml(x.c.embryologist||'—')}</td><td>${escapeHtml(field(x.row,['date sample received'])||'—')}</td><td>${escapeHtml(field(x.row,['wga done on'])||'—')}</td><td>${escapeHtml(field(x.row,['seq date'])||'—')}</td></tr>`).join('')||'<tr><td colspan="8" class="muted">No samples.</td></tr>';
  dlg.querySelector('.sd-note').textContent=rows.length>LIMIT?`Showing the first ${LIMIT} of ${rows.length.toLocaleString()} - use search to narrow.`:`${rows.length.toLocaleString()} sample row${rows.length===1?'':'s'} · ${rows.reduce((n,x)=>n+x.n,0).toLocaleString()} embryos`};
 dlg.innerHTML=`<div class="sd-bar"><div><strong>${escapeHtml(def[1])}</strong> <span class="muted">${escapeHtml(def[2])}</span></div><input type="search" class="sd-search" placeholder="Search patient, sample ID, client…"><span class="sd-note muted"></span><button type="button" class="close" aria-label="Close">×</button></div><div class="sd-wrap"><table class="prep-table"><thead><tr><th>Patient</th><th>Sample ID</th><th>Test</th><th>Client</th><th>Embryologist</th><th>Received</th><th>WGA done</th><th>SEQ date</th></tr></thead><tbody></tbody></table></div>`;
 draw('');dlg.querySelector('.close').onclick=()=>dlg.close();dlg.querySelector('.sd-search').oninput=e=>draw(e.target.value);
 dlg.querySelector('tbody').onclick=e=>{const tr=e.target.closest('tr[data-i]');if(!tr)return;const x=list[+tr.dataset.i];if(x){dlg.close();openPatient(x.c)}};
 dlg.showModal()}
function wireStageCards(){document.querySelectorAll('#homeStats [data-stage]').forEach(el=>{if(el._w)return;el._w=1;const go=()=>openStageList(el.dataset.stage);el.addEventListener('click',go);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})})}
function renderHomeStats(){wireStageCards();{const st=stageRows(),cnt=k=>st[k].reduce((n,x)=>n+(homeUnit==='samples'?1:x.n),0),put=(id,v)=>{const el=$(id);if(el)el.textContent=v.toLocaleString()};put('#homeSeqStat',cnt('wga'));put('#homeReleasedStat',cnt('released'))}const rows=allEmbryos(),set=(id,v)=>{const el=$(id);if(el)el.textContent=v.toLocaleString()};set('#homeBatchesStat',homeBatchKind==='wga'?homeCards().length:resultFileRuns().length);const bs=$('#homeBatchesSub');if(bs)bs.textContent=homeBatchKind==='wga'?'WGA batches in the batch record':'Runs with an uploaded result file';set('#homeEmbryosStat',homeCount(rows));{const l=document.querySelector('#homeEmbryosStat')?.parentElement?.querySelector('small');if(l)l.textContent=homeUnit==='samples'?'TOTAL SAMPLES':'TOTAL EMBRYOS'}document.querySelectorAll('#homeUnitToggle [data-unit]').forEach(b=>{const on=b.dataset.unit===homeUnit;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});const cards=homeCards();set('#homeOngoingStat',cards.filter(c=>runStatusOf(c)!=='released').length);set('#homeCompletedStat',cards.filter(c=>runStatusOf(c)==='released').length);syncRunFilterUi()}
// Home cards: live runs/batches from the batch-record sheets only. The lab's typed monthly run
// reports (embryomatrix-run-history) are still loaded but no longer merged into Home counts.
let runHistory=[],embInc=null;
const runIdNorm=v=>String(v||'').toUpperCase().replace(/^RUN/,'').replace(/[^A-Z0-9]/g,'');
const dmyKey=d=>{const m=/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(String(d||'').trim());return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''};
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
function tabMonth(tab){const m=/([a-z]+)\s+(\d{4})/i.exec(String(tab||''));const i=m?MONTHS.indexOf(m[1].toLowerCase()):-1;return i<0?'':`${m[2]}-${String(i+1).padStart(2,'0')}`}
// ---- Home batches, built from the PGS-NGS sheet alone (no Sequencing Batch Record needed) ----
// Samples sequenced together share a SEQ date + platform -> one "Sequencing" batch (titled with the
// Run ID when the sheet has one). Samples with a WGA date but no SEQ date are grouped by WGA date +
// kit; samples with only a received date by received date. The lane comes from the rows' own dates.
function lastDmy(v,row){let tab=row?recordMonth(row):'';if(!/^\d{4}-\d{2}$/.test(tab))tab='';const now=Date.now();let best=null;
 // The sheet's day/month order is unreliable (a "07-12-2026" in the July tab is really 12 July): flip a date when only the flipped reading fits the row's own sheet tab, or when it lands in the future and the flip does not.
 for(const m of String(v||'').matchAll(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/g)){let d=+m[1],mo=+m[2];const y=+m[3];if(mo>12){[d,mo]=[mo,d]}
  const key=(yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`;let flip=false;
  if(d<=12&&d!==mo){if(tab&&key(y,mo)!==tab&&key(y,d)===tab)flip=true;else if(!tab&&new Date(y,mo-1,d)>now&&new Date(y,d-1,mo)<=now)flip=true}
  if(flip)[d,mo]=[mo,d];const t=new Date(y,mo-1,d);if(isNaN(t))continue;if(!best||t>best)best=t}
 return best?`${String(best.getDate()).padStart(2,'0')}-${String(best.getMonth()+1).padStart(2,'0')}-${best.getFullYear()}`:''}
// Where one sample row stands: 'pending' (received only), 'wga' (WGA done, not sequenced), 'seq' (sequenced, report not finished), 'released'.
function rowStage(r){const has=k=>!!field(r,[k]);if((has('ngs report')&&has('attune upload'))||isCompleteOnSeq(r,r._case))return'released';if(has('seq date'))return'seq';if(has('wga done on'))return'wga';return'pending'}
let homeCardsMemo=null;
const isEmbryoSureRow=r=>/EMBRYO\s*SURE|EMBRYOSURE/i.test(String(field(r,['test name','test'])||''));
function homeCards(){if(homeCardsMemo&&homeCardsMemo.cases===cases&&homeCardsMemo.files===resultFilesCache)return homeCardsMemo.cards;
 const groups=new Map;
 cases.forEach(c=>(c.embryos||[]).forEach(row=>{if(isNotReporting(row))return;
  const seqD=lastDmy(field(row,['seq date']),row),wgaD=lastDmy(field(row,['wga done on']),row),recD=lastDmy(field(row,['date sample received']),row),plat=String(field(row,['seq platform'])||'').trim();
  let kind,date,key;if(seqD){kind='seq';date=seqD;key=`S|${seqD}|${plat.toUpperCase()}`}else if(wgaD){kind='wga';date=wgaD;key=`W|${wgaD}|${String(field(row,['kit detail'])||'').trim().toUpperCase()}`}else{kind='rec';date=recD;key=`R|${recD}`}
  let g=groups.get(key);if(!g)groups.set(key,g={key,kind,date,plat,kit:String(field(row,['kit detail'])||'').trim(),rows:[]});g.rows.push({row,c})}));
 const cards=[...groups.values()].map(g=>{
  const items=[];g.rows.forEach(({row,c})=>expandEmbryoRow(row).forEach(x=>{const label=field(x,['sample name','embryo name','embryo']);items.push({s:{patient:field(row,['patient name','patient'])||c.patient,embryo:label,received:field(row,['date sample received'])},m:{case:c,row,tag:cleanId(label),data:x},linked:[]})}));
  const b=runBreakdown(items),fileRes=b.euploid+b.aneuploid+b.mosaicInc>0,released=g.rows.filter(({row})=>rowStage(row)==='released').length;
  const stage=g.kind==='rec'?'pending':g.kind==='wga'?'wga':released===g.rows.length?'released':'seq';
  // The Run ID cell is often blank (or has a stray value); the run of each sample's uploaded result file counts too, so a lone mistyped cell can't name the whole batch.
  const runCount={};g.rows.forEach(({row})=>{const seen=new Set(runsOf(row));Object.values(row._embryoResults||{}).forEach(p=>{const f=(resultFilesCache||[]).find(x=>x.id===p._fileId),n=f&&(f.run||runNumberOf(f.fileName));if(n)seen.add(n)});seen.forEach(r=>{const k=runIdNorm(r);if(k)runCount[k]=(runCount[k]||0)+1})});const runId=Object.entries(runCount).sort((x,y)=>y[1]-x[1])[0]?.[0];
  // Embryo Sure samples sequenced on their own (per-patient files, no run number) are not a run: no batch card for them.
  if(g.kind==='seq'&&!runId&&g.rows.every(({row})=>isEmbryoSureRow(row)))return null;
  const title=runId?`RUN ${runId}`:g.kind==='seq'?`SEQ ${g.date}`:g.kind==='wga'?`WGA ${g.date}`:`RECEIVED ${g.date||'(no date)'}`;
  const platform=g.kind==='seq'?(g.plat||'Platform not recorded'):g.kind==='wga'?(g.kit?`Kit ${g.kit} · awaiting sequencing`:'Awaiting sequencing'):'Awaiting WGA';
  const fileIds=new Set;g.rows.forEach(({row})=>Object.values(row._embryoResults||{}).forEach(p=>{if(p._fileId)fileIds.add(p._fileId)}));
  const files=(resultFilesCache||[]).filter(f=>fileIds.has(f.id));
  const dk=dmyKey(g.date),live={kind:'seq',runId:g.key,title,runDate:g.date,platform:g.kind==='seq'?g.plat:'',items,b,files,tab:''};
  return{live,stage,title,platform,date:g.date,sortKey:`${dk}|${g.key}`,month:dk.slice(0,7),patients:b.patients,samples:b.total,
   res:fileRes?{euploid:b.euploid,aneuploid:b.aneuploid,mosaic:b.mosaic,inconclusive:b.inconclusive}:null,
   tests:b.tests,qc:fileRes?{pass:b.pass,fail:b.fail}:null,progress:g.kind==='seq'?{done:released,total:g.rows.length}:null,search:items.map(x=>x.s.patient).join(' ')}}).filter(Boolean);
 cards.sort((a,b)=>b.sortKey.localeCompare(a.sortKey));
 homeCardsMemo={cases,files:resultFilesCache,cards};return cards}
// Home: the run-search bar spans the same width as the Samples-through-Protocols nav range.
function alignHomeSearch(){}
window.addEventListener('load',()=>alignHomeSearch());document.fonts?.ready.then(()=>alignHomeSearch());
window.addEventListener('resize',()=>{if(!$('#homeView')?.classList.contains('hidden')){alignHomeSearch();capStatusColumns()}});
// Cards vary in height (a completed card's QC row, a pending card's shorter meta line, ...),
// so a fixed CSS max-height either clips a 4th card mid-way or leaves a gap. Measure the
// real bottom edge of the 3rd card instead and cap there - exactly 2 whole cards, no sliver.
function capStatusColumns(){document.querySelectorAll('.status-col-body').forEach(body=>{body.style.maxHeight='';body.style.overflowY='';body.scrollTop=0;const cards=[...body.children];if(cards.length<=2||body.closest('.cols-1'))return;const top=body.getBoundingClientRect().top,bottom=cards[1].getBoundingClientRect().bottom;body.style.maxHeight=`${Math.ceil(bottom-top)}px`;body.style.overflowY='auto'})}
// The cap is the height of the first two cards, so it has to be measured again once fonts / icons have loaded or the window is resized - otherwise it is too short and cuts the first card.
{let capT;const recap=()=>{clearTimeout(capT);capT=setTimeout(capStatusColumns,80)};window.addEventListener('resize',recap);document.fonts?.ready.then(recap);document.addEventListener('load',e=>{if(e.target.tagName==='IMG'&&e.target.closest?.('.status-col-body'))recap()},true)}
const RUN_STATUS_DEFS=[['pending','WGA in progress','#6b766f','#eceeed',''],['wga','WGA completed','#2f6b98','#e1ecf7','Proceeded for sequencing'],['seq','Sequencing completed','#c07a1d','#fbeed8','Sent for report preparation'],['released','Report released','#1f8a52','#dff3e7','']];
// WGA date filled -> WGA completed; + Seq date -> Sequencing completed; NGS report + Attune upload -> Report released.
const runStatusOf=c=>{if(c.stage)return c.stage;const its=c.live?.items||[],rows=its.map(x=>x.m?.row).filter(Boolean);// Samples that match no tracker row (usually a name spelled differently) can't be judged; a run is only 'in progress' on that basis when most of it is unmatched.
if(its.length&&rows.length<its.length/2)return'pending';if(!rows.length)return c.res?'released':c.live?.kind==='seq'&&!c.pending?'seq':'pending';const all=k=>rows.every(r=>!!field(r,[k]));if(!all('wga done on'))return'pending';if(rows.every(r=>(field(r,['ngs report'])&&field(r,['attune upload']))||isCompleteOnSeq(r,r._case)))return'released';if(all('seq date'))return'seq';return'wga'};
let homeRunFilter='all';
function syncRunFilterUi(){document.querySelectorAll('#homeStats [data-run-filter]').forEach(el=>{const on=el.dataset.runFilter===homeRunFilter;el.classList.toggle('stat-active',on);el.setAttribute('aria-pressed',String(on))});const t=$('#runFilterNote');if(t)t.textContent=homeRunFilter==='ongoing'?'Showing ongoing runs only':homeRunFilter==='completed'?'Showing completed runs only':''}
document.querySelectorAll('#homeStats [data-run-filter]').forEach(el=>{const go=()=>{homeRunFilter=el.dataset.runFilter===homeRunFilter?'all':el.dataset.runFilter;syncRunFilterUi();renderRunList()};el.addEventListener('click',go);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}})});
function renderRunList(){const list=$('#runList');if(!list)return;const q=($('#runSearch')?.value||'').trim().toLowerCase(),all=homeCards(),cards=all.filter(c=>(homeRunFilter==='all'||(homeRunFilter==='ongoing'?runStatusOf(c)!=='released':runStatusOf(c)==='released'))&&(!q||`${c.title} ${c.platform||''} ${c.date||''} ${c.search}`.toLowerCase().includes(q)));if(!cards.length){list.innerHTML=`<div class="chart-empty">${all.length?'No batches match.':BATCH_KIND[homeBatchKind].empty}</div>`;return}
 const num=v=>v==null?'—':v.toLocaleString(),stat=(label,n,cls='')=>`<div class="rc-stat ${cls}"><strong>${num(n)}</strong><small>${label}</small></div>`,sum=(list,f)=>{const v=list.map(f).filter(x=>x!=null);return v.length?v.reduce((a,b)=>a+b,0):null};
 const tstat=(label,n,ic)=>`<div class="rc-stat rc-test-stat"><img class="ico" src="/static/icons/tests-transfers__${ic}.png" alt=""><div><strong>${num(n)}</strong><small>${label}</small></div></div>`;
 const card=(c,i)=>{const r=c.res,t=k=>c.tests?c.tests[k]||0:null;
  // A batch still awaiting its sequencing run has no result to show yet - swap the
  // Results section for the sequencer/received-date info that's actually known now.
  const middle=c.pending?(c.sequencer||c.received?`<div class="rc-counts rc-meta-fill">${c.sequencer?stat('Sequencer',escapeHtml(c.sequencer)):''}${c.received?stat('Received',escapeHtml(c.received)):''}</div>`:''):(!r?`<div class="rc-section rc-noresult"><div class="rc-label">Results <span>· no result file uploaded yet</span></div></div>`:`<div class="rc-section"><div class="rc-label">Results</div><div class="rc-grid">${stat('Euploid',r?.euploid,'euploid')}${stat('Aneuploid',r?.aneuploid,'aneuploid')}${stat('Mosaic',r?.mosaic,'mosaic')}${stat('Inconclusive',r?.inconclusive,'inconclusive')}</div></div>`);
  const topStats=c.qc?`<div class="rc-counts rc-counts-4">${stat('Patients',c.patients)}${stat('Embryos',c.samples,'rc-main')}${stat('QC Pass',c.qc.pass,'qc-pass-stat')}${stat('QC Fail',c.qc.fail,'qc-fail-stat')}</div>`:`<div class="rc-counts">${stat('Patients',c.patients)}${stat('Embryos',c.samples,'rc-main')}</div>`;
  return `<article class="batch-card run-card${c.live?'':' run-card-static'}${c.pending?' run-card-pending':''}" data-i="${i}"${c.live?' tabindex="0" role="button"':''}><div class="batch-card-top"><div><strong class="batch-run">${escapeHtml(c.title)}</strong><small class="batch-file">${escapeHtml(c.platform||'—')}</small></div><span class="batch-date">${escapeHtml(c.date||'No date')}</span></div>${topStats}${c.progress?`<div class="rc-progress" title="Samples with both the Attune upload and NGS report dates filled"><div class="rc-progress-bar"><span style="width:${Math.round(c.progress.done/c.progress.total*100)}%"></span></div><small>${c.progress.done} of ${c.progress.total} samples released</small></div>`:''}${middle}<div class="rc-section"><div class="rc-label">Tests</div><div class="rc-grid">${tstat('PGT A',t('PGT A'),'pgt-a')}${tstat('PGT A+M',t('PGT A+M'),'pgt-m')}${tstat('POC',t('POC'),'poc')}${tstat('PGT SR',t('PGT SR'),'pgt-sr')}</div></div>${c.live?'':'<div class="rc-foot">From the monthly run report · no sample list</div>'}</article>`};
 const months=[...new Set(cards.map(c=>c.month||''))];let i=0;
 // Only columns that can actually hold a card under the active filter render -
 // a status a filter rules out entirely (e.g. Completed while "Ongoing" is picked)
 // would otherwise show as a permanently empty lane.
 const bucketsOf=mc=>RUN_STATUS_DEFS.map(([key,label,color,soft,desc])=>({key,label,color,soft,desc,items:mc.filter(c=>runStatusOf(c)===key)})).filter(b=>b.items.length||(homeRunFilter==='all'&&!q));
 const col=b=>`<div class="status-col"><div class="status-col-head"><span class="status-label" style="color:${b.color};background:${b.soft}"><img class="ico" src="/static/icons/stages-results__${({pending:'received',wga:'wga',seq:'sequencing',released:'report-sent'})[b.key]||'wga'}.png" alt="">${b.label}</span>${b.desc?`<span class="status-col-desc">- ${b.desc}</span>`:''}<span class="status-count">${b.items.length}</span></div><div class="status-col-body">${b.items.length?b.items.map(c=>card(c,i++)).join(''):'<div class="status-empty">No runs at this stage</div>'}</div></div>`;
 list.innerHTML=months.map(m=>{const mc=cards.filter(c=>(c.month||'')===m),buckets=bucketsOf(mc);
  return `<div class="run-month"><div class="run-month-head"><h3>${escapeHtml(m?monthLabel(m):'Undated')}</h3></div><div class="status-board cols-${buckets.length}">${buckets.map(col).join('')}</div></div>`}).join('');
 const order=months.flatMap(m=>bucketsOf(cards.filter(c=>(c.month||'')===m)).flatMap(b=>b.items));
 capStatusColumns();
 alignHomeSearch();
 list.querySelectorAll('.batch-card').forEach(el=>{const c=order[+el.dataset.i];if(!c.live)return;el.onclick=()=>openRun(c.live);el.onkeydown=e=>{if(e.key==='Enter')openRun(c.live)}})}
function renderEmbInc(target='#embIncTable'){const el=$(target);if(!el)return;const rows=embInc?.rows||[];const panel=target==='#embIncTable'?$('#embIncPanel'):null;if(!rows.length){panel?.classList.add('hidden');if(!panel)el.innerHTML='<div class="chart-empty">No embryologist report loaded yet.</div>';return}panel?.classList.remove('hidden');
 const keys=Object.keys(rows[0].months||{}).sort(),pctv=r=>r.total?r.inconclusive/r.total*100:0,tone=v=>v>=10?'high':v>=5?'mid':v>0?'low':'zero',sorted=[...rows].sort((a,b)=>pctv(b)-pctv(a)||b.total-a.total);
 const p=$('#embIncPeriod');if(p)p.textContent=embInc.period||'';
 el.innerHTML=`<table class="prep-table emb-inc-table"><thead><tr><th class="num">S.No</th><th>Embryologist</th><th>Client / Centre</th><th>Location</th><th class="num">Embryos</th><th class="num">Inconclusive</th><th class="num">Overall %</th>${keys.map(k=>`<th class="num">${escapeHtml(monthLabel(k,{month:'short'}))}</th><th class="num">${escapeHtml(monthLabel(k,{month:'short'}))} inc.</th>`).join('')}</tr></thead><tbody>${sorted.map((r,i)=>`<tr><td class="num muted">${i+1}</td><td class="strong">${escapeHtml(r.name)}</td><td>${escapeHtml(r.client)}</td><td class="clip" title="${escapeHtml(r.location)}">${escapeHtml(r.location)}</td><td class="num">${r.total}</td><td class="num">${r.inconclusive}</td><td class="num"><span class="inc-pct ${tone(pctv(r))}">${pctv(r).toFixed(2)}%</span></td>${keys.map(k=>{const [n,inc]=r.months[k]||[0,0];return `<td class="num">${n}</td><td class="num">${inc}</td>`}).join('')}</tr>`).join('')}</tbody></table>`}
const RUN_ICON_TOTAL='<img class="ico" src="/static/icons/run-summary__samples.png" alt="">';
const RUN_ICON_CHECK='<img class="ico" src="/static/icons/stages-results__normal.png" alt="">';
const RUN_ICON_MOSAIC='<img class="ico" src="/static/icons/stages-results__mosaic.png" alt="">';const RUN_ICON_INC='<img class="ico" src="/static/icons/stages-results__inconclusive.png" alt="">';
const RUN_ICON_X='<img class="ico" src="/static/icons/stages-results__abnormal.png" alt="">';
const RUN_ICON_Q='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>';
let currentRun=null;
function openRun(run){currentRun=run;showView('run')}
const RUN_ICON_PERSON='<img class="ico" src="/static/icons/run-summary__patients.png" alt="">';
const sumStrip=cards=>`<div class="run-stats">${cards.map(([label,v,tone,icon])=>`<article class="run-stat tone-${tone}${v?'':' is-zero'}"><div><small>${label}</small><strong>${v==null?'—':v.toLocaleString()}</strong></div><span class="run-stat-icon">${icon}</span></article>`).join('')}</div>`;
const RUN_BACK_BTN=`<button type="button" class="run-back-btn" id="runBack"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>Back</button>`;
const RESULT_ORDER=[['Normal','Euploid','pass'],['Abnormal','Aneuploid','fail'],['Mosaic','Mosaic','mosaic'],['Inconclusive','Inconclusive','inconclusive']];
const isDateText=v=>/^\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$/.test(String(v||''));
function renderRunView(target){const run=currentRun;if(!run){target.innerHTML='<div class="empty-action"><h3>No batch selected</h3><p>Go back to Home and pick a batch.</p><button class="primary" data-view="home">Back to Home</button></div>';target.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));return}
 const groups=new Map;run.items.forEach(x=>{if(!x.m)return;let g=groups.get(x.m.row);if(!g)groups.set(x.m.row,g={row:x.m.row,case:x.m.case,items:[],res:{},linked:new Set});g.items.push(x);(x.linked||[]).forEach(id=>g.linked.add(id));const d=runResult(x.m),c=d&&conclusionClass(d);if(c)g.res[c]=(g.res[c]||0)+1});
 const live=[...groups.values()].map(g=>({...g,linked:[...g.linked]})).sort((a,b)=>(a.row._seq??0)-(b.row._seq??0)),missing=run.items.filter(x=>!x.m);
 // Same numbers as this run's Home card (report counts where the monthly report has the run).
 const c=homeCards().find(x=>x.live&&x.live.kind===run.kind&&x.live.runId===run.runId)||(()=>{const q=run.b,has=q.euploid+q.aneuploid+q.mosaicInc>0;return{samples:q.total,patients:q.patients,tests:q.tests,res:has?{euploid:q.euploid,aneuploid:q.aneuploid,mosaic:q.mosaic,inconclusive:q.inconclusive}:null,qc:has?{pass:q.pass,fail:q.fail}:null}})(),tc=k=>c.tests?c.tests[k]||0:null;
 const b=run.b,K=BATCH_KIND[run.kind],wga=run.kind==='wga',meta=[run.runDate&&`${wga?'Processing':'Run'} date ${run.runDate}`,wga&&run.platform?`Instrument ${run.platform}`:run.platform,run.seqType,run.instrument&&`Instrument ${run.instrument}`,run.operator&&`Operator ${run.operator}`].filter(Boolean).map(escapeHtml).join(' · '),files=wga?'Awaiting sequencing · no Run ID yet':run.files.length?`Result file: ${run.files.map(f=>escapeHtml(f.fileName)).join(', ')}`:'No result file uploaded yet';
 $('#genericHeaderTitle').innerHTML=`<span class="run-head">${RUN_BACK_BTN}<span class="run-title">${escapeHtml(run.title||K.title(run.runId))}</span><span class="case-test-badge">${b.total} embryo${b.total===1?'':'s'}</span></span>`;
 target.innerHTML=`<div class="patient-detail patient-detail-v2 run-page">${sumStrip([['Samples',c.samples,'teal',RUN_ICON_TOTAL],['Patients',c.patients,'blue',RUN_ICON_PERSON],['Euploid',c.res?.euploid,'green',RUN_ICON_CHECK],['Aneuploid',c.res?.aneuploid,'red',RUN_ICON_X],['Mosaic',c.res?.mosaic,'amber',RUN_ICON_MOSAIC],['Inconclusive',c.res?.inconclusive,'grey',RUN_ICON_INC]])}<div class="embryo-table-card"><div class="embryo-table-scroll"><table class="embryo-table run-live-table"><thead><tr><th>S. No.</th><th>Patient</th><th>Embryo</th><th>Sample ID</th><th>Test</th><th>Client</th><th>Embryologist</th><th>Received</th><th>WGA done on</th><th>Seq date</th><th>Result</th></tr></thead><tbody>${run.items.map((x,i)=>{const r=x.m?.row||{},d=x.m&&runResult(x.m),cls=d&&conclusionClass(d),pill=cls?RESULT_ORDER.filter(([k])=>k===cls).map(([k,label,pc])=>`<span class="result-pill ${pc}">${label}</span>`).join(''):'',f=k=>escapeHtml(field(r,k)||'—');return `<tr class="embryo-row"${x.m?` data-case="${escapeHtml(x.m.case.id)}"`:''}><td>${i+1}</td><td><strong>${escapeHtml(isDateText(x.s.patient)?'':x.s.patient||field(r,['patient name'])||'')||'<span class="muted" title="Patient name is missing in the batch sheet">—</span>'}</strong></td><td>${escapeHtml(x.s.embryo||x.m?.tag||'—')}</td><td class="mono">${f(['sample id'])}</td><td>${x.m?`<span class="test-cell">${testIconFor(rowTestName(r))}${escapeHtml(rowTestName(r))}</span>`:'—'}</td><td class="clip" title="${f(['center name','hospital clinic name'])}">${f(['center name','hospital clinic name'])}</td><td>${f(['embryologist name'])}</td><td>${escapeHtml(x.s.received||field(r,['date sample received'])||'—')}</td><td>${f(['wga done on'])}</td><td>${f(['seq date'])}</td><td class="run-results">${pill||'—'}</td></tr>`}).join('')}</tbody></table></div></div></div>`;
 $('#runBack').onclick=()=>showView('home');
 target.querySelectorAll('[data-case]').forEach(tr=>tr.onclick=()=>{const c=cases.find(x=>x.id===tr.dataset.case);if(c)openPatient(c)})}
$('#runSearch')?.addEventListener('input',renderRunList);
function syncBatchKindUi(){document.querySelectorAll('#batchKindToggle [data-kind]').forEach(b=>{const on=b.dataset.kind===homeBatchKind;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))})}
document.querySelectorAll('#batchKindToggle [data-kind]').forEach(b=>b.addEventListener('click',()=>{homeBatchKind=b.dataset.kind;try{localStorage.setItem('em-home-batches',homeBatchKind)}catch{}syncBatchKindUi();renderHomeStats();renderRunList()}));
async function renderHomeCards(){await loadResultFiles();let hist;[seqRunsCache,wgaCache,hist,embInc]=await Promise.all([kvGet('embryomatrix-sequencing-runs'),kvGet('embryomatrix-wga-batches'),kvGet('embryomatrix-run-history'),kvGet('embryomatrix-embryologist-inconclusive')]);seqRunsCache=seqRunsCache||[];wgaCache=wgaCache||[];runHistory=hist?.runs||[];buildRunsView();syncBatchKindUi();renderEmbInc();renderHomeStats();renderRunList();if($('#rrBody'))setupRunReportsView()}
document.addEventListener('click',e=>{const b=e.target.closest('#homeUnitToggle [data-unit]');if(!b)return;homeUnit=b.dataset.unit==='samples'?'samples':'embryos';try{localStorage.setItem('em-home-unit',homeUnit)}catch{}renderStatCards(allEmbryos());syncOverdueCard();renderHomeStats()});
function renderStatCards(allRows){
 const total=allRows.length,ongoing=allRows.filter(e=>e._importSource==='Pending').length,embryos=allRows.reduce((s,e)=>s+embryoRowsOf(e).length,0),completed=allRows.filter(e=>reportStatus(e)==='Completed').length;
 countUp($('#totalSamplesStat'),total);countUp($('#activeStat'),ongoing);countUp($('#trackedStat'),embryos);countUp($('#completedStat'),completed);const rebiopsyNav=$('#rebiopsyNavCount');if(rebiopsyNav)rebiopsyNav.textContent=allRows.filter(isRebiopsy).length.toLocaleString();{const hr=$('#homeRebiopsyStat');if(hr)hr.textContent=homeCount(allRows.filter(isRebiopsy)).toLocaleString()}const prepMonths=reportPrepMonths(),prep=allRows.filter(e=>isReportPrep(e,prepMonths)).length;countUp($('#reportPrepStat'),prep);{const hp=$('#homeReportPrepStat');if(hp)hp.textContent=homeCount(allRows.filter(e=>isReportPrep(e,prepMonths))).toLocaleString()}const prepNav=$('#reportPrepNavCount');if(prepNav)prepNav.textContent=prep.toLocaleString();const prepSub=$('#reportPrepSub');if(prepSub)prepSub.innerHTML=`In <b>${escapeHtml(monthLabel(prepMonths[0],{month:'short'}))}</b> &amp; <b>${escapeHtml(monthLabel(prepMonths[1],{month:'short'}))}</b> · Attune &amp; NGS report pending`;
 const months=[...new Set(allRows.map(recordMonth).filter(isDateMonth))].sort(),latest=months[months.length-1],latestCount=latest?allRows.filter(e=>recordMonth(e)===latest).length:0;
 const totalSub=$('#totalSamplesSub');if(totalSub)totalSub.innerHTML=latest?`<b>+${latestCount.toLocaleString()}</b> in ${escapeHtml(monthLabel(latest,{month:'long'}))}`:'All sample records';

}
// Overview charts count either sample records or individual embryos. A record
// whose embryo names split ("SS-1,2") contributes one row per embryo with its
// own result; one whose names can't be split falls back to "number of embryos".
let overviewUnit=(()=>{try{return localStorage.getItem('em-overview-unit')==='embryos'?'embryos':'samples'}catch{return'samples'}})();
const unitWord=(cap=false)=>overviewUnit==='embryos'?(cap?'Embryos':'embryos'):(cap?'Patients':'patients');
// One row per embryo of a record. How many comes from the sheet's "Number of embryos" column
// (blank = 1); the embryo names only supply each row's own result, so extra names are dropped
// and missing ones padded. The Embryos Tracked card counts the same rows, so both always agree.
function embryoRowsOf(e){const n=Math.max(1,Math.round(embryoUnits(e))),split=expandEmbryoRow(e);if(split.length>=n)return split.slice(0,n);const pad=split.length===1?split[0]:e;return[...split,...Array.from({length:n-split.length},()=>pad)]}
function overviewRows(){const rows=allEmbryos();return overviewUnit==='embryos'?rows.flatMap(embryoRowsOf):rows}
function syncOverviewUnitUi(){document.querySelectorAll('#overviewUnitToggle [data-unit]').forEach(b=>{const on=b.dataset.unit===overviewUnit;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});document.querySelectorAll('[data-unit-text]').forEach(el=>{el.textContent=el.dataset.unitText.replace('{Unit}',unitWord(true)).replace('{unit}',unitWord())})}
function setOverviewUnit(unit){overviewUnit=unit==='embryos'?'embryos':'samples';try{localStorage.setItem('em-overview-unit',overviewUnit)}catch{}renderAnalytics()}
document.addEventListener('click',e=>{const b=e.target.closest('#overviewUnitToggle [data-unit]');if(b)setOverviewUnit(b.dataset.unit)});
function renderAnalytics(){syncOverviewUnitUi();const allRows=overviewRows();renderStatCards(allEmbryos());renderHomeCards();const testTypeCountEl=$('#testTypeCount');if(testTypeCountEl)testTypeCountEl.textContent=new Set(allRows.map(testNameOf).filter(Boolean)).size;renderVolumeChart(allRows);renderTestChart(allRows);renderOutcomeChart(allRows);renderClientChart(allRows);renderRegionChart(allRows);renderPlatformChart(allRows);renderQualitySection(allRows)}
// CSS alone can't cap this list to "however tall the Quality Comparison card next to it
// turns out to be" without a circular height dependency (height:100% of an auto-stretched
// flex parent resolves to auto, so the legend just grows to fit every row instead of
// scrolling) - so measure the sibling's real height and set an explicit max-height instead.
async function storeImages(caseId,embryo,files){const form=new FormData();form.append('embryo_label',embryo||'');for(const file of files)form.append('files',file);const res=await fetch(`/api/cases/${encodeURIComponent(caseId)}/images`,{method:'POST',body:form});if(!res.ok)throw new Error('Upload failed')}
async function patientImages(caseId){try{const r=await fetch(`/api/cases/${encodeURIComponent(caseId)}/images`);if(!r.ok)return[];return await r.json()}catch(e){return[]}}
// Embryo uploads take images; "General / patient" takes PDF / Word documents instead.
const DOC_ACCEPT='.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isGeneralLabel=v=>/^general/i.test(String(v||''));
const isDocFile=x=>/\.(pdf|docx?)$/i.test(String(x?.filename||x?.name||''));
function filesForTarget(embryo,files){const doc=isGeneralLabel(embryo),ok=files.filter(f=>doc?isDocFile(f):/^image\//.test(f.type)||/\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$/i.test(f.name));if(ok.length<files.length)toast(doc?'General / patient takes PDF or Word files only':'Embryos take image files only');return ok}
const storedMsg=(n,embryo,patient)=>`${n} ${isGeneralLabel(embryo)?'document':'image'}${n===1?'':'s'} stored for ${patient}`;
// A stored vault file: the image itself, or a document tile that opens the PDF / Word file.
function vaultThumb(x,alt){if(!isDocFile(x))return `<img src="${x.url}" alt="${escapeHtml(alt)}" loading="lazy">`;const ext=String(x.filename).split('.').pop().toUpperCase();return `<a class="doc-thumb" href="${x.url}" target="_blank" rel="noopener" title="${escapeHtml(x.filename)}"><b>${ext==='DOCX'?'DOC':ext}</b><small>${escapeHtml(x.filename)}</small></a>`}
// Image buttons for an embryo, the document button for General / patient.
function syncUploadButtons(sel,imgBtns,docBtn){const doc=isGeneralLabel(sel?.value);imgBtns.forEach(b=>b?.classList.toggle('hidden',doc));docBtn?.classList.toggle('hidden',!doc)}
async function deleteImage(id){const r=await fetch(`/api/images/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Delete failed')}
async function replaceImage(id,file){const form=new FormData();form.append('file',file);const r=await fetch(`/api/images/${id}/replace`,{method:'POST',body:form});if(!r.ok){let m='Replace failed';try{m=(await r.json()).detail||m}catch{}throw new Error(m)}return r.json()}
function embryoTableRows(c,list=resolvedEmbryos(c)){if(!list.length)return Array.from({length:c.samples},(_,i)=>`<tr class="embryo-row"><td><strong>${escapeHtml(c.id)}-S0${i+1}</strong></td><td>—</td><td>—</td><td>—</td><td><span class="result-pill ${i?'normal':c.result.toLowerCase()}">${i?'Normal':c.result}</span></td></tr>`).join('');return list.map(r=>{const identity=resultIdentity(r),out=conclusionClass(r)||((field(r,['conclusion'])||field(r,['result'])||field(r,['qc']))?(r._outcome||clinicalOutcome(r)):'N/A'),s=storageInfo(r),t=transferInfo(r),location=[s.freezer&&`Freezer ${s.freezer}`,s.rack&&`Rack ${s.rack}`,s.box&&`Box ${s.box}`,s.position&&`Position ${s.position}`].filter(Boolean).join(' · '),name=identity.patient?`${identity.patient}-${identity.embryo}`:(identity.embryo||field(r,['embryo name'])||field(r,['sample name'])),mapd=field(r,['mapd'])||'—',mtcopy=field(r,['mtcopy'])||'—',uniquereads=field(r,['uniquereads'])||'—',bincv=field(r,['bincv'])||'—',cnvmergecv=field(r,['cnvmergecv'])||'—',cnvpq=field(r,['cnvpq'])||'—',autosomes=field(r,['autosomes'])||'—',conclusion=field(r,['conclusion']),storageDetail=[s.barcode,location||'Location not recorded',s.date?`Stored ${s.date}`:'Stored date not recorded',s.notes].filter(Boolean).join(' · '),transferDetail=[t.purpose&&t.purpose!=='Not transferred'&&t.purpose!==t.status?t.purpose:null,t.details||null,t.department?`To ${t.department}`:null,t.sentDate?`Sent ${t.sentDate}`:null,t.sentBy?`By ${t.sentBy}`:null,t.receivedBy?`Received by ${t.receivedBy}`:null,t.receivedDate?`on ${t.receivedDate}`:null,t.returnDate?`Returned ${t.returnDate}`:null,t.remarks].filter(Boolean).join(' · ')||'No transfer details recorded';return `<tr class="embryo-headrow"><th>Embryo</th><th>QC</th><th>Karyotype</th><th>Result</th></tr><tr class="embryo-row"><td><strong>${escapeHtml(name)}</strong></td><td>${escapeHtml(qcVerdict(r)==='FAIL'?'FAIL':(field(r,['qc'])||'—'))}</td><td>${escapeHtml(field(r,['karyotype mwf','karyotype normal wf'])||'—')}</td><td><span class="result-pill ${out.toLowerCase().replace(/[^a-z]/g,'')}">${out}</span></td></tr><tr class="embryo-subrow"><td colspan="4"><p class="${conclusion?'':'result-conclusion'}">${escapeHtml(conclusion||'No conclusion provided')}</p><div class="embryo-kv-wrap"><table class="embryo-kv"><thead><tr>${['MAPD','MTcopy','Unique reads','BinCV','CNVMergeCV','CNVpq','Autosomes'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody><tr>${[mapd,mtcopy,uniquereads,bincv,cnvmergecv,cnvpq,autosomes].map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr></tbody></table></div><div class="embryo-trace-line">${s.status==='Not recorded'?'':`<span class="mini-badge">${escapeHtml(s.status)}</span>`}${escapeHtml(storageDetail)}</div><div class="embryo-trace-line">${t.status==='Not transferred'?'':`<span class="mini-badge${t.status==='Transferred'?' mini-badge-ok':''}">${escapeHtml(t.status)}</span>`}${escapeHtml(transferDetail)}</div></td></tr>`}).join('')}
const ICON_COPY='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const ICON_X='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_DNA='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/></svg>';
// Result class from an embryo's Conclusion in the result file; null when it has no result yet.
function conclusionClass(r){const t=field(r,['conclusion']).toLowerCase();if(field(r,['qc'])&&qcVerdict(r)==='FAIL')return'Inconclusive';if(!t)return null;if(t.includes('no dna'))return'Inconclusive';if(t.includes('mosaic'))return'Mosaic';if(t.includes('inconclusive')||QC_FAIL_SIGNALS.some(x=>t.includes(x)))return'Inconclusive';if(t.includes('no copy number'))return'Normal';if(t.includes('abnormal')||t.includes('aneuploid'))return'Abnormal';if(t.includes('euploid')||t.includes('normal'))return'Normal';return null}
// Which sheet(s) of the PGS-NGS workbook this patient's rows are in (Pending, January 2026, NOT REPORTING, ...).
function caseSheetBadge(c){const tabs=[...new Set((c.embryos||[]).map(r=>String(r._importSource||'').trim()).filter(Boolean))];if(!tabs.length)return'';const cancelled=tabs.some(t=>/not\s*reporting/i.test(t));return `<span class="case-sheet-badge${cancelled?' is-cancelled':''}" title="Sheet in the PGS-NGS workbook">Sheet: ${tabs.map(escapeHtml).join(', ')}</span>`}
function openPatient(c,focusEmbryo){const resolvedAll=resolvedEmbryos(c),resolved=focusEmbryo?resolvedAll.filter(r=>embryoDisplayId(r)===focusEmbryo):resolvedAll,classes=resolved.map(conclusionClass),hasResults=classes.some(Boolean),classCount=k=>hasResults?classes.filter(x=>x===k).length:'-',normal=classCount('Normal'),mosaic=classCount('Mosaic'),abnormal=classCount('Abnormal'),inc=classCount('Inconclusive'),noResult=resolved.length?classes.filter(x=>!x).length:(c.samples||0),embryos=(resolved.length?resolved.map(r=>{const id=resultIdentity(r);return id.patient?`${id.patient}-${id.embryo}`:id.embryo}):Array.from({length:c.samples},(_,i)=>`Embryo ${i+1}`)).filter(Boolean),platform=resolved.map(r=>field(r,['seq platform'])).find(Boolean),embryoCount=resolved.length||c.samples;$('#patientDetail').innerHTML=`<div class="patient-detail patient-detail-v2"><div class="case-top-v2"><div class="case-badges"><span class="case-id-badge">${escapeHtml(c.id)}</span><span class="case-test-badge">${testIconFor(c.test)}${escapeHtml(c.test)}</span>${caseSheetBadge(c)}${caseKnownRuns(c).length?`<span class="case-run-badge is-fixed"><span class="crb-label">RUN</span><span class="crb-value">${escapeHtml(caseKnownRuns(c).join(", "))}</span></span>`:`<span class="case-run-badge"><span class="crb-label">RUN</span><span class="crb-value" contenteditable="true" spellcheck="false" title="Click to set the assigned run - moves this case's TRF/images into that run's folder on the lab PC" data-case="${escapeHtml(c.id)}" data-original="${escapeHtml(caseRunMap[c.id]||'')}">${escapeHtml(caseRunMap[c.id]||'')}</span></span>`}</div><div class="case-top-actions"><button class="icon-btn" id="copyPatientId" title="Copy case ID" aria-label="Copy case ID">${ICON_COPY}</button><button class="icon-btn" id="closePatient" title="Close" aria-label="Close">${ICON_X}</button></div></div><h2 class="patient-name-v2">${escapeHtml(c.patient)}</h2><div class="patient-meta-v2">${escapeHtml(c.client)}${c.clientBranch?` (${escapeHtml(c.clientBranch)})`:""} · ${escapeHtml(c.region)} · Embryologist: ${escapeHtml(c.embryologist)}</div>${progressStepper(caseProgressStage(c),c.embryos?.[0]||{})}<div class="summary-strip summary-cards"><div class="sum-card tone-teal${Number(embryoCount)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__total-embryos.png" alt=""></span><strong>${embryoCount}</strong><small>Total embryos</small></div><div class="sum-card tone-green${Number(normal)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__normal.png" alt=""></span><strong>${normal}</strong><small>Normal</small></div><div class="sum-card tone-blue${Number(mosaic)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__mosaic.png" alt=""></span><strong>${mosaic}</strong><small>Mosaic</small></div><div class="sum-card tone-red${Number(abnormal)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__abnormal.png" alt=""></span><strong>${abnormal}</strong><small>Abnormal</small></div><div class="sum-card tone-amber${Number(inc)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__inconclusive.png" alt=""></span><strong>${inc}</strong><small>Inconclusive</small></div><div class="sum-card tone-grey${Number(noResult)?'':' is-zero'}"><span class="sum-icon"><img class="ico" src="/static/icons/stages-results__na-result.png" alt=""></span><strong>${noResult}</strong><small>N/A result</small></div></div><div class="embryo-table-card"><div class="embryo-table-head"><div class="embryo-table-title">${ICON_DNA}<h3>Individual embryo results <span class="count-badge">(${embryoCount})</span></h3></div>${platform?`<span class="platform-tag">${escapeHtml(platform)}</span>`:''}</div><div class="embryo-table-scroll"><table class="embryo-table"><tbody>${embryoTableRows(c,resolved)}</tbody></table></div></div><section class="detail-card image-vault-v2"><div class="vault-heading"><div><h3>Patient image vault</h3><small>Stored on the server</small></div></div><label>Attach to embryo<select id="imageEmbryo">${embryos.map(x=>`<option>${escapeHtml(x)}</option>`).join('')}<option>General / patient</option></select></label><div class="capture-actions"><label class="primary capture-button" id="cameraBtn">📷 Take photo<input id="cameraInput" type="file" accept="image/*" capture="environment" hidden></label><label class="secondary capture-button" id="imageBtn">＋ Choose images<input id="imageInput" type="file" accept="image/*" multiple hidden></label><label class="secondary capture-button hidden" id="docBtn">📄 Choose PDF / Word<input id="docInput" type="file" accept="${DOC_ACCEPT}" multiple hidden></label></div><p class="storage-note">Images are uploaded to the lab server and linked to this case.</p><div class="real-image-grid" id="patientImageGrid"><div class="image-loading">Loading images…</div></div></section></div>`;$('#patientDialog').showModal();$('#closePatient').onclick=()=>$('#patientDialog').close();$('#copyPatientId').onclick=async()=>{try{await navigator.clipboard.writeText(c.id);toast('Case ID copied')}catch(err){toast('Could not copy case ID')}};const runEl=$('.crb-value');if(runEl){runEl.onclick=e=>e.stopPropagation();runEl.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runEl.blur()}else if(e.key==='Escape'){runEl.textContent=runEl.dataset.original;runEl.blur()}};runEl.onblur=async()=>{const val=runEl.textContent.trim(),orig=runEl.dataset.original;if(val===orig)return;if(!val){runEl.textContent=orig;toast('Run number can\'t be cleared here - assign a different one instead');return}runEl.classList.add('cell-saving');try{const res=await fetch(`/api/cases/${encodeURIComponent(c.id)}/run`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{runId:val}})});if(!res.ok)throw new Error('save failed');caseRunMap[c.id]=val;runEl.dataset.original=val;toast(`Assigned to RUN ${val}`)}catch(err){toast('Could not assign run');runEl.textContent=orig}finally{runEl.classList.remove('cell-saving')}}}const add=async e=>{const embryo=$('#imageEmbryo').value,files=filesForTarget(embryo,[...e.target.files]);e.target.value='';if(!files.length)return;try{await storeImages(c.id,embryo,files);toast(storedMsg(files.length,embryo,c.patient))}catch(err){toast('Upload failed')}await renderPatientImages(c)};$('#imageInput').onchange=add;$('#cameraInput').onchange=add;$('#docInput').onchange=add;{const sync=()=>syncUploadButtons($('#imageEmbryo'),[$('#cameraBtn'),$('#imageBtn')],$('#docBtn'));$('#imageEmbryo').onchange=sync;sync()}renderPatientImages(c);if(typeof renderPatientFollowup==='function')renderPatientFollowup(c,resolvedAll)}
async function renderPatientImages(c){const grid=$('#patientImageGrid');if(!grid)return;const images=await patientImages(c.id);const ic=$('#patientImageCount');if(ic){ic.textContent=images.length;ic.closest('.sum-card')?.classList.toggle('is-zero',!images.length)}grid.innerHTML=images.length?images.map(x=>`<figure class="stored-image" data-image-id="${x.id}">${vaultThumb(x,`${x.embryo||''} sample image`)}<figcaption><strong>${escapeHtml(x.embryo||'General')}</strong><span>${new Date(x.addedAt).toLocaleString()}</span></figcaption><label class="image-replace" title="Replace this file with another">⟳ Replace<input type="file" accept="${isDocFile(x)?DOC_ACCEPT:'image/*'}" hidden></label><button class="image-delete" aria-label="Delete image" title="Remove this image">×</button></figure>`).join(''):'<div class="image-empty">No images yet.<br>Take the first sample photo above.</div>';$$('.image-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this image? This cannot be undone.'))return;try{await deleteImage(b.closest('[data-image-id]').dataset.imageId);await renderPatientImages(c);toast('Image removed')}catch(err){toast('Could not remove the image')}});
 $$('.image-replace input').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{await replaceImage(inp.closest('[data-image-id]').dataset.imageId,f);await renderPatientImages(c);toast('Image replaced')}catch(err){toast(err.message||'Could not replace the image')}})}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
// Which views each role may open (admin and team lead: all). The server enforces the same split on the API.
// Staff (admin, senior executive, team lead) see everything. Only admin and senior executive may edit
// result cells or manage users; team leads can upload but not edit (the API enforces it too).
const isStaff=()=>!currentUser.signedIn||['admin','senior_executive','team_lead'].includes(currentUser.role);
const canEditResults=()=>!currentUser.signedIn||['admin','senior_executive'].includes(currentUser.role);
const canManageUsers=()=>currentUser.signedIn&&['admin','senior_executive'].includes(currentUser.role);
const ROLE_VIEWS={member:['samples','pgtm','cases','images'],embryologist:['fuTasks','fuDash','trfs'],coordinator:['coord']};
const viewAllowed=v=>{const r=currentUser.role;if(v==='users')return !currentUser.signedIn||canManageUsers();return !currentUser.signedIn||!ROLE_VIEWS[r]&&isStaff()||!!ROLE_VIEWS[r]&&ROLE_VIEWS[r].includes(v)};
const roleHomeView=()=>(ROLE_VIEWS[currentUser.role]||[])[0]||'home';
function applyRoleAccess(){
  const r=currentUser.role;
  // Clinical follow-up: one tab for admin / team lead; the embryologist gets its two pages as separate tabs.
  const fu=document.getElementById('fuNav');if(fu)fu.hidden=!(isStaff());
  document.querySelectorAll('.session-menu-item[data-view="users"]').forEach(n=>n.hidden=!canManageUsers());
  const sn=document.getElementById('samplesNav');if(sn&&isStaff())sn.hidden=true;  // admin / team lead reach Samples from the Run status page
  if(!currentUser.signedIn||!ROLE_VIEWS[r])return;
  document.body.classList.add('role-'+r);
  document.querySelectorAll('.nav-item').forEach(n=>{n.hidden=!ROLE_VIEWS[r].includes(n.dataset.view)});
  document.querySelectorAll('.session-menu-item[data-view],#qcAlerts,.import-data-btn').forEach(n=>{if(!ROLE_VIEWS[r].includes(n.dataset.view))n.style.display='none'});
}
function showView(view){if(!viewAllowed(view))view=roleHomeView();
 {const gt=$('#genericHeaderTitle');if(gt)gt.textContent=''}  // header buttons (Image vault, Protocols) belong to one view only
 let scope='';if(view==='pgtm'){view='samples';scope='pgtm'}if(!scope)pgtmCard=null;
 if(view==='samples'||view==='cases'){const changed=samplesScope!==scope;samplesScope=scope;const h=$('#registryHeaderLeft h2');if(h?.firstChild)h.firstChild.nodeValue=scope?'PGT-M & HLA-C samples':'Patient & embryo registry';$('#registryHeaderLeft')?.classList.toggle('no-title',!scope);if(changed){refreshTestFilterOptions();const sms=$('#samplesMonthFilter');if(sms){if(scope){pgtmSavedMonth=sms.value;sms.value=allEmbryos().some(e=>isPgtmSample(e)&&recordMonth(e)==='Pending')?'Pending':''}else if(pgtmSavedMonth!==null){sms.value=pgtmSavedMonth;pgtmSavedMonth=null}}renderCases()}}
 const navView=scope?'pgtm':view;
 $('#mainHeader')?.classList.toggle('hidden',view==='home');$('#overviewTitle')?.classList.toggle('hidden',view!=='overview');
 $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===navView||(!scope&&['cases','reportprep','rebiopsy'].includes(view)&&n.dataset.view==='samples')||(n.id==='runStatusNav'&&isStaff()&&!scope&&['samples','cases','reportprep','rebiopsy','overdue','run','overview'].includes(view))));
 $('#registryViewToggle')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#registryHeaderLeft')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#genericHeaderLeft')?.classList.toggle('hidden',view==='overview'||view==='home'||view==='cases'||view==='samples');
 $('#rebiopsyHeaderSearch')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#rebiopsyHeaderActions')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#vaultHeaderActions')?.classList.toggle('hidden',view!=='images'||isStaff());
 $('#rebiopsyViewToggle')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#registrySearchWrap')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#registryHeaderActions')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#embryologistSortOrder')?.classList.toggle('hidden',view!=='embryologists');
 $('#embSearchWrap')?.classList.toggle('hidden',view!=='embryologists');
 $('#clientsToolbar')?.classList.toggle('hidden',view!=='clients');
 $('#regionSortHeader')?.classList.toggle('hidden',view!=='regions');
 if(view==='home'){ $('#homeView').classList.remove('hidden');$('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');$('#genericView').classList.add('hidden');requestAnimationFrame(()=>{alignHomeSearch();capStatusColumns()});return }
 $('#homeView').classList.add('hidden');
 if(view==='overview'){ $('#overviewView').classList.remove('hidden');$('#samplesView').classList.add('hidden');$('#genericView').classList.add('hidden');return }
 if(view==='cases'||view==='samples'){ $('#overviewView').classList.add('hidden');$('#genericView').classList.add('hidden');$('#samplesView').classList.remove('hidden');fitTableHeight($('#caseTable .embryo-columns-table'));return }
 if(view==='coord'){ $('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');const g=$('#genericView');g.classList.remove('hidden');renderCoordView(g);return }
 if(view==='followup'||view==='fuTasks'||view==='fuDash'||view==='dashboard'){ $('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');const g=$('#genericView');g.classList.remove('hidden');renderFollowupView(g,view);return }
 if(view==='run'){ $('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');const g=$('#genericView');g.classList.remove('hidden');renderRunView(g);return }
 $('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');const g=$('#genericView');g.classList.remove('hidden');
 const data={experiments:['Molecular tests','Every PGT run, decision, and result—linked and searchable.'],images:['Embryo image vault','Keep embryo images separate while every file remains linked to its patient and sample.'],protocols:['PGT protocols',''],runreports:['Run reports',''],overdue:['Overdue samples','Samples past their TAT date (received + 21 days for Embryo Sure / HLA tests, + 10 days for all other tests) with no NGS report date yet.'],reportprep:['Report preparation','Samples whose Attune upload and NGS report dates are both still empty, from the current and previous month tabs.'],rebiopsy:['Re-biopsy cases',''],trfs:['Digital TRFs',''],users:['User management','Add or remove logins and change what each person can do.'],activity:['Activity log','Every sign-in, upload and change: who did it, what they did and when.'],import:['',''],embryologists:['All embryologists','Embryo counts and QC per embryologist — choose a month, or All for the whole year.'],regions:['All regions','Monthly sample volume for every region.'],clients:['All clients','Every client and their sample volume. Click a client to open their samples.'],tests:['All tests','Every test type in the current reporting period.']}[view];
 if(view==='overdue')$('#genericHeaderTitle').innerHTML=`${escapeHtml(data[0])}<span class="od-source" id="overdueSource" title="${escapeHtml(data[1])}">Source: PGS-NGS sheet</span>`;else if(view==='runreports')$('#genericHeaderTitle').innerHTML='<span>Run reports</span><button type="button" class="secondary compact" id="openProtocols"><img class="ico btn-ico-img" src="/static/icons/navigation__protocols.png" alt="">Protocols</button>';else if(view==='import')$('#genericHeaderTitle').innerHTML='<button type="button" class="secondary compact" id="openImageVault">Image vault</button>';else $('#genericHeaderTitle').textContent=data[0];
 g.innerHTML=`<div class="generic-card${view==='tests'||view==='protocols'||view==='images'||view==='activity'||view==='users'||view==='clients'||view==='reportprep'||view==='overdue'||view==='runreports'||view==='rebiopsy'||view==='trfs'?' wide-card':view==='regions'||view==='clients'||view==='embryologists'?' rank-card':''}${view==='protocols'?' protocols-view':''}${view==='images'?' images-view':''}${view==='import'?' import-view':''}">${view==='embryologists'||view==='regions'||view==='clients'||view==='overdue'||view==='runreports'||view==='images'?'':`<p>${data[1]}</p>`}${view==='experiments'?'<div class="experiment-list" id="allExperimentList"></div><button class="primary" id="newExperimentAlt">＋ New test record</button>':view==='import'?importMarkup():view==='activity'?activityMarkup():view==='users'?usersMarkup():view==='runreports'?runReportsMarkup():view==='overdue'?overdueMarkup():view==='reportprep'?reportPrepMarkup():view==='rebiopsy'?rebiopsyMarkup():view==='trfs'?trfsMarkup():view==='protocols'?protocolsMarkup():view==='images'?'<div class="vault-groups" id="imageVaultGroups"><div class="chart-empty">Loading images…</div></div>':view==='embryologists'?'<div class="emb-rank-wrap" id="allQualityChart"><div class="chart-empty">Loading…</div></div>':view==='regions'?regionsMarkup():view==='clients'?allClientsMarkup():view==='tests'?'<div class="test-name-grid" id="allTestList"></div>':'<div class="empty-action"><h3>This workspace is ready to grow</h3><p>The core structure is in place for your lab records.</p><button class="primary" data-view="overview">Return to overview</button></div>'}</div>`;
 if(view==='experiments'){const target=$('#allExperimentList');experiments.forEach((x,i)=>{const temp=document.createElement('div');temp.className='experiment-row';temp.innerHTML=`<span class="exp-avatar ${['a','b','c','d'][i%4]}">${x.owner}</span><div><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.project)} · ${escapeHtml(x.next)}</p></div><small class="tag green-tag">${x.status}</small>`;target.append(temp)});$('#newExperimentAlt').onclick=()=>$('#experimentDialog').showModal()}
 if(view==='import'){setupImporter();$('#openImageVault')?.addEventListener('click',()=>showView('images'))}
 if(view==='activity'){setupActivityView()}
 if(view==='users'){setupUsersView()}
 if(view==='reportprep'){setupReportPrepView()}if(view==='overdue'){setupOverdueView()}if(view==='runreports'){setupRunReportsView();$('#openProtocols')?.addEventListener('click',()=>showView('protocols'))}
 if(view==='rebiopsy'){setupRebiopsyView()}
 if(view==='trfs'){setupTrfsView()}
 if(view==='protocols'){setupProtocolsView()}
 if(view==='images'){setupImageVaultView()}
 if(view==='embryologists'){const sortEl=$('#embryologistSortOrder');let order='pass';if(!embInc)kvGet('embryomatrix-embryologist-inconclusive').then(v=>{if(v){embInc=v;render()}});let month='';const mLabel=k=>{const m=/^(\d{4})-(\d{2})$/.exec(k||'');return m?`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]} ${m[1]}`:k};
 if(!$('#embMonthTabs')){const t=document.createElement('div');t.id='embMonthTabs';t.className='prep-segments sheet-tabs';$('#allQualityChart').parentNode.insertBefore(t,$('#allQualityChart'));t.onclick=ev=>{const b=ev.target.closest('[data-m]');if(!b)return;month=b.dataset.m;drawTabs();render()}}
 const drawTabs=()=>{const cnt={};allEmbryos().forEach(e=>{const m=recordMonth(e);if(m)cnt[m]=(cnt[m]||0)+Math.max(1,Math.round(embryoUnits(e)))});const ms=Object.keys(cnt).filter(isDateMonth).sort();$('#embMonthTabs').innerHTML=[['','All']].concat(ms.map(m=>[m,mLabel(m)])).map(([m,l])=>`<button type="button" class="prep-seg${m===month?' active':''}" data-m="${escapeHtml(m)}">${escapeHtml(l)}</button>`).join('')};
 drawTabs();
 const render=()=>{const nq=($('#embSearch')?.value||'').trim().toLowerCase(),stats=embryologistQcStats(allEmbryos().filter(e=>month?recordMonth(e)===month:isDateMonth(recordMonth(e)))).filter(q=>!nq||q.name.toLowerCase().includes(nq));stats.sort((a,b)=>(order==='asc'?a.total-b.total:b[order]-a[order])||b.total-a.total||a.name.localeCompare(b.name));renderEmbryologistRankList('#allQualityChart',stats)};{const chart=$('#allQualityChart');if(chart)chart.onclick=ev=>{const row=ev.target.closest('.emb-row:not(.emb-head)');if(!row)return;const name=row.querySelector('.emb-name')?.textContent;if(!name)return;openEmbryologistEmbryos(name,allEmbryos().filter(e=>(e._case.embryologist||'Not assigned')===name&&(month?recordMonth(e)===month:isDateMonth(recordMonth(e)))),month?mLabel(month):'All months')}}
 {const si=$('#embSearch');if(si){si.value='';si.oninput=()=>render()}}render();if(sortEl)sortEl.onclick=ev=>{const b=ev.target.closest('[data-sort]');if(!b)return;order=b.dataset.sort;sortEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));render()}}
 if(view==='regions'){setupRegionsView()}
 if(view==='tests'){const testCounts=countBy(allEmbryos(),testNameOf);const sortedTests=Object.entries(testCounts).sort((a,b)=>a[0].localeCompare(b[0]));renderTestNameGrid('#allTestList',sortedTests)}
 if(view==='clients'){setupAllClientsView()}
 g.querySelectorAll('[data-view="overview"]').forEach(b=>b.addEventListener('click',()=>showView('overview')));
}
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{showView(b.dataset.view);$('.topbar').classList.remove('open')}));
$('#quickNote')?.addEventListener('click',()=>$('#noteDialog').showModal());$('.menu-button').onclick=()=>$('.topbar').classList.toggle('open');document.addEventListener('click',()=>{$('#filtersPanel')?.classList.add('hidden');$('#filtersToggle')?.classList.remove('active');$('#rebiopsyFiltersPanel')?.classList.add('hidden');$('#rebiopsyFiltersToggle')?.classList.remove('active');$('#exportMenu')?.classList.add('hidden');fitTableHeight($('#caseTable .embryo-columns-table'));fitTableHeight($('#rebiopsyTableWrap'))});
$('#saveExperiment').addEventListener('click',async e=>{const form=$('#experimentForm');if(!form.reportValidity()){e.preventDefault();return}const d=new FormData(form);experiments.unshift({id:Date.now(),name:d.get('name'),project:d.get('project'),owner:(d.get('owner')||'AP').toUpperCase(),status:d.get('status'),next:d.get('next')||'Add next action',objective:d.get('objective'),updated:'Just now'});await save();renderExperiments();form.reset();toast('Experiment saved to your workspace')});
$('#saveNote').addEventListener('click',async e=>{if(!$('#noteForm').reportValidity()){e.preventDefault();return}await kvSet('embryomatrix-last-note',{note:new FormData($('#noteForm')).get('note'),savedAt:new Date().toISOString()});$('#noteForm').reset();toast('Bench note captured')});
document.addEventListener('click',e=>{const img=e.target.closest('.stored-image img');if(!img)return;$('#lightboxGallery').classList.add('hidden');$('#lightboxTitle').classList.add('hidden');$('#lightboxImg').classList.remove('hidden');$('#lightboxImg').src=img.src;$('#lightboxImg').alt=img.alt;$('#imageLightbox').showModal()});
$('#lightboxClose').onclick=()=>$('#imageLightbox').close();
$('#imageLightbox').addEventListener('click',e=>{if(e.target.id==='imageLightbox')$('#imageLightbox').close()});
$('#patientDialog').addEventListener('click',e=>{if(e.target.id==='patientDialog')$('#patientDialog').close()});
async function syncSheetNow(){try{const r=await fetch('/api/sync-sheet',{method:'POST'});if(!r.ok)return null;return await r.json()}catch(e){return null}}
function updateIssueStat(status){const issue=$('#issueStat');if(issue)issue.textContent=((status?.skipped||0)+(status?.errors?.length||0))}
let caseRunMap={};
async function loadCaseRuns(){try{const rows=await fetch('/api/case-runs').then(r=>r.json());caseRunMap=Object.fromEntries(rows.map(r=>[r.caseCode,r.runId]))}catch{}}
async function init(){experiments=(await kvGet('embryomatrix-experiments'))||[];renderExperiments();await Promise.all([setupCases(),loadCaseRuns()]);const status=await syncSheetNow();if(status){if(status.changed!==false)await setupCases();updateIssueStat(status)}}
loadWhoAmI().then(()=>{applyRoleAccess();if(currentUser.role==='coordinator'&&currentUser.signedIn)$('#homeView')?.classList.add('hidden');if(currentUser.role==='embryologist'&&currentUser.signedIn){showView('fuTasks');return}if(isStaff())showView('dashboard');return init().catch(()=>{}).then(()=>{if(ROLE_VIEWS[currentUser.role]&&currentUser.signedIn)showView(roleHomeView())})});
if(document.modelContext?.registerTool){document.modelContext.registerTool({name:'filter_patient_cases',title:'Filter patient cases',description:'Filter the visible patient registry by embryologist, client, test, region, or result.',inputSchema:{type:'object',properties:{embryologist:{type:'string'},client:{type:'string'},test:{type:'string'},region:{type:'string'},result:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){for(const key of ['embryologist','client','test','region','result'])if(input[key]!==undefined)$(`#${key}Filter`).value=input[key];renderCases();return{visibleCases:$$('[data-case]').length,filters:input}}})}
window.addEventListener('beforeinstallprompt',e=>e.preventDefault());

function uploadedProtocolCard(d){return `<article class="protocol-card"><div class="protocol-card-head"><div><h3>${escapeHtml(d.title)}</h3><div class="protocol-meta">${escapeHtml(d.filename)} · Uploaded ${new Date(d.uploadedAt).toLocaleDateString()}</div></div><a class="primary protocol-download" href="${d.url}" download>⬇ Download</a></div></article>`}
let vaultGalleryGroups=[];
function openVaultGallery(group){if(!group)return;$('#lightboxImg').classList.add('hidden');const title=$('#lightboxTitle');title.textContent=`${group.patient} · all sample images`;title.classList.remove('hidden');const gallery=$('#lightboxGallery');gallery.innerHTML=group.imgs.map(x=>`<figure>${vaultThumb(x,`${x.embryo||'General / patient'} sample image`)}<figcaption>${escapeHtml(x.embryo||'General / patient')} · ${new Date(x.addedAt).toLocaleString()}</figcaption><div class="vg-actions" data-image-id="${x.id}"><label class="vg-btn" title="Replace this file with another">⟳ Replace<input type="file" accept="${isDocFile(x)?DOC_ACCEPT:'image/*'}" hidden></label><button type="button" class="vg-btn vg-remove" title="Remove this image">🗑 Remove</button></div></figure>`).join('');
 const done=async msg=>{$('#imageLightbox').close();await setupImageVaultView();toast(msg)};
 gallery.querySelectorAll('.vg-remove').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this image? This cannot be undone.'))return;try{await deleteImage(b.closest('[data-image-id]').dataset.imageId);await done('Image removed')}catch(err){toast('Could not remove the image')}});
 gallery.querySelectorAll('.vg-btn input').forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;try{await replaceImage(inp.closest('[data-image-id]').dataset.imageId,f);await done('Image replaced')}catch(err){toast(err.message||'Could not replace the image')}});gallery.classList.remove('hidden');$('#imageLightbox').showModal()}
function vaultUploadBar(el){document.body.classList.toggle('vault-staff',isStaff());if(isStaff())return;if($('#vaultUpload'))return;const bar=document.createElement('div');bar.id='vaultUpload';bar.className='vault-upload';
 const mName=k=>{const m=/^(\d{4})-(\d{2})$/.exec(k||'');return m?`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]} ${m[1]}`:k};
 const info=cases.map(c=>{const es=c.embryos||[];return{c,months:[...new Set(es.map(recordMonth).filter(Boolean))],runs:[...new Set([...es.flatMap(runsOf),...(caseRunMap[c.id]?[String(caseRunMap[c.id])]:[])])],hay:`${c.patient} ${c.id} ${es.map(e=>field(e,['sample id','box number'])).join(' ')}`.toLowerCase()}});
 const opts=(f)=>[...new Set(info.flatMap(f).filter(Boolean))];
 const months=opts(x=>x.months).sort((p,q)=>isDateMonth(q)-isDateMonth(p)||String(q).localeCompare(String(p))),runs=opts(x=>x.runs).sort((p,q)=>(parseInt(q)||0)-(parseInt(p)||0)),clients=opts(x=>[x.c.client]).sort(),tests=opts(x=>[x.c.test]).sort(),embs=opts(x=>[x.c.embryologist]).sort();
 const sel=(id,label,vals,fmt=v=>v)=>`<label class="vu-f"><span>${label}</span><select id="${id}"><option value="">All</option>${vals.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(fmt(v))}</option>`).join('')}</select></label>`;
 bar.innerHTML=`<div class="vu-filters">${sel('vuMonth','Month / sheet',months,mName)}${sel('vuRun','Run',runs,v=>'Run '+v)}${sel('vuClient','Client',clients)}${sel('vuTest','Test',tests)}${sel('vuEmbryologist','Embryologist',embs)}<label class="vu-f vu-search"><span>Search</span><input id="vuSearch" placeholder="Patient name or sample ID" autocomplete="off"></label><button type="button" class="secondary compact" id="vuReset">Clear</button></div><div class="vu-count" id="vuCount"></div><div class="vu-list" id="vuList"></div>`;
 el.parentNode.insertBefore(bar,el);
 let chosen=null;const g=id=>$('#'+id).value,LIMIT=100;
 const draw=()=>{const q=g('vuSearch').trim().toLowerCase(),m=g('vuMonth'),r=g('vuRun'),cl=g('vuClient'),t=g('vuTest'),em=g('vuEmbryologist');
  const hits=info.filter(x=>(!m||x.months.includes(m))&&(!r||x.runs.includes(r))&&(!cl||x.c.client===cl)&&(!t||x.c.test===t)&&(!em||x.c.embryologist===em)&&(!q||x.hay.includes(q)));
  $('#vuCount').textContent=hits.length?'':'No patients match these filters';
  $('#vuList').innerHTML=(hits.length?'<div class="vu-row vu-head"><span>Patient</span><span>Sample ID</span><span>Test</span><span>Client</span><span>Month / run</span></div>':'')+hits.slice(0,LIMIT).map(x=>`<button type="button" class="vu-row${chosen===x.c.id?' on':''}" data-id="${escapeHtml(x.c.id)}"><strong>${escapeHtml(x.c.patient)}</strong><span>${escapeHtml(x.c.id)}</span><span>${escapeHtml(x.c.test||'')}</span><span>${escapeHtml(x.c.client||'')}</span><span>${escapeHtml(x.months.map(mName).join(', '))}${x.runs.length?' · Run '+escapeHtml(x.runs.join(', ')):''}</span></button>`).join('')};
 bar.addEventListener('input',e=>{if(e.target.id!=='vuEmbryo'&&e.target.id!=='vuFiles')draw()});
 $('#vuReset').onclick=()=>{bar.querySelectorAll('select').forEach(s=>{if(s.id!=='vuEmbryo')s.value=''});$('#vuSearch').value='';draw()};
 const host=el.parentNode,vd=document.createElement('dialog');vd.id='vaultDialog';vd.className='vu-dialog vu-dialog-wide';vd.innerHTML='<div class="vu-dhead"><h3>Image vault · run-wise, patient-wise</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody" id="vaultDialogBody"></div>';
 const pd=document.createElement('dialog');pd.id='vuDialog';pd.className='vu-dialog';pd.innerHTML='<div class="vu-dhead"><h3 id="vuDTitle"></h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><div class="vu-upload-row"><label class="vu-f"><span>Embryo</span><select id="vuEmbryo"></select></label><label class="primary compact vu-btn" id="vuCamBtn">📷 Take photo<input id="vuCam" type="file" accept="image/*" capture="environment" hidden></label><label class="primary compact vu-btn" id="vuFilesBtn">🖼 Upload images<input id="vuFiles" type="file" accept="image/*" multiple hidden></label><label class="primary compact vu-btn hidden" id="vuDocsBtn">📄 Upload PDF / Word<input id="vuDocs" type="file" accept="'+DOC_ACCEPT+'" multiple hidden></label></div><div class="vu-images" id="vuImages"></div></div>';
 host.append(vd,pd);[vd,pd].forEach(d=>d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()}));
 {const vb=$('#vuOpenVault');if(vb)vb.onclick=()=>{$('#vaultDialogBody').append(el);vd.showModal()}}
 vd.addEventListener('close',()=>host.append(el));
 const showImgs=async c=>{const imgs=await patientImages(c.id);$('#vuImages').innerHTML=imgs.length?imgs.map(x=>`<figure>${isDocFile(x)?vaultThumb(x,''):`<a href="${x.url}" target="_blank" rel="noopener">${vaultThumb(x,x.embryo||'General')}</a>`}<figcaption>${escapeHtml(x.embryo||'General / patient')}</figcaption></figure>`).join(''):'<div class="chart-empty">No files for this patient yet.</div>'};
 const syncVu=()=>syncUploadButtons($('#vuEmbryo'),[$('#vuCamBtn'),$('#vuFilesBtn')],$('#vuDocsBtn'));$('#vuEmbryo').onchange=syncVu;
 $('#vuList').onclick=e=>{const b=e.target.closest('.vu-row:not(.vu-head)');if(!b)return;const c=cases.find(x=>x.id===b.dataset.id);if(!c)return;chosen=c.id;
  const labels=resolvedEmbryos(c).map(r=>{const id=resultIdentity(r);return id.patient?`${id.patient}-${id.embryo}`:id.embryo}).filter(Boolean);
  const list=labels.length?labels:Array.from({length:c.samples||0},(_,i)=>`Embryo ${i+1}`);
  $('#vuEmbryo').innerHTML=[...list,'General / patient'].map(x=>`<option>${escapeHtml(x)}</option>`).join('');syncVu();
  $('#vuDTitle').textContent=`${c.patient} · ${c.id} · ${c.test||''}`;$('#vuImages').innerHTML='';showImgs(c);pd.showModal()};
 const send=async e=>{const embryo=$('#vuEmbryo').value,files=filesForTarget(embryo,[...e.target.files]);e.target.value='';if(!files.length)return;const c=cases.find(x=>x.id===chosen);if(!c)return;
  try{await storeImages(c.id,embryo,files);toast(storedMsg(files.length,embryo,c.patient));await showImgs(c);await setupImageVaultView()}catch(err){toast('Image upload failed')}};
 $('#vuFiles').onchange=send;$('#vuCam').onchange=send;$('#vuDocs').onchange=send;
 draw()}
async function setupImageVaultView(){const el=$('#imageVaultGroups');if(!el)return;vaultUploadBar(el);let images;try{const res=await fetch('/api/images');images=res.ok?await res.json():[]}catch(err){el.innerHTML='<div class="chart-empty">Could not load images.</div>';return}if(!images.length){el.innerHTML='<div class="empty-action"><h3>No images yet</h3><p>Photos attached to an embryo from a patient case will appear here, grouped by sample.</p></div>';return}// Stack by run (year/month/run come from the server's file path), then patient, then embryo.
const runOf=img=>{const p=String(img.relPath||'').split('/');return p.length>=5&&/^RUN_/.test(p[2])?{key:p[2],label:p[2].replace('_',' '),month:`${p[0]} ${p[1].replace(/^\d+\s*-\s*/,'')}`,sort:`${p[0]}-${p[1].slice(0,2)}`}:{key:'_none',label:'No run yet',month:'Patient not found in any run',sort:''}};
const byRun=new Map();images.forEach(img=>{const r=runOf(img);if(!byRun.has(r.key))byRun.set(r.key,{...r,cases:new Map()});const cm=byRun.get(r.key).cases;if(!cm.has(img.caseId))cm.set(img.caseId,new Map());const em=cm.get(img.caseId),key=img.embryo||'General / patient';if(!em.has(key))em.set(key,[]);em.get(key).push(img)});
const runNum=k=>parseInt(String(k).replace(/\D/g,''))||0,runs=[...byRun.values()].sort((x,y)=>(x.key==='_none')-(y.key==='_none')||y.sort.localeCompare(x.sort)||runNum(y.key)-runNum(x.key)||y.key.localeCompare(x.key));
vaultGalleryGroups=[];
const caseCard=(caseId,embryoMap)=>{const c=cases.find(x=>x.id===caseId),patient=c?c.patient:'Unknown patient',allCaseImgs=[...embryoMap.values()].flat();const embryoBlocks=[...embryoMap.entries()].map(([label,imgs])=>{const groupId=vaultGalleryGroups.length;vaultGalleryGroups.push({patient,label,imgs:allCaseImgs});const layers=imgs.length>1?'<span class="stack-layer"></span><span class="stack-layer"></span>':'';return `<div class="vault-embryo-block"><h4>${escapeHtml(label)} <span class="count-badge">(${imgs.length})</span><button type="button" class="vault-del-btn" data-group="${groupId}" data-ids="${imgs.map(x=>x.id).join(',')}" title="${imgs.length>1?'Choose which image to delete':'Delete this image'}">🗑 Delete</button></h4><div class="image-stack" data-group="${groupId}" title="View all ${imgs.length} image(s)">${layers}<span class="stack-front">${vaultThumb(imgs[0],`${label} sample image`)}</span>${imgs.length>1?`<span class="stack-count">×${imgs.length}</span>`:''}</div></div>`}).join('');return `<article class="vault-group" data-case="${escapeHtml(caseId)}"><div class="vault-group-head"><div class="vault-group-heading"><strong>${escapeHtml(patient)}</strong><span class="case-id-badge">${escapeHtml(caseId)}</span></div>${c?'<button class="primary vault-open-btn">Open case →</button>':''}</div><div class="vault-embryo-row">${embryoBlocks}</div></article>`};
const nImgs=r=>[...r.cases.values()].reduce((n,em)=>n+[...em.values()].reduce((m,l)=>m+l.length,0),0);
const jump=`<nav class="vault-run-jump" aria-label="Jump to run">${runs.map(r=>`<a href="#vault-${escapeHtml(r.key)}" data-run="${escapeHtml(r.key)}">${escapeHtml(r.label)} <small>${nImgs(r)}</small></a>`).join('')}</nav>`;
el.innerHTML=jump+runs.map((r,i)=>`<details class="vault-run" id="vault-${escapeHtml(r.key)}"${i<2||runs.length<=3?' open':''}><summary><span class="vault-run-title">${escapeHtml(r.label)}</span><span class="vault-run-month">${escapeHtml(r.month)}</span><span class="vault-run-meta">${r.cases.size} patient${r.cases.size===1?'':'s'} · ${nImgs(r)} image${nImgs(r)===1?'':'s'}</span></summary><div class="vault-groups vault-run-body">${[...r.cases.entries()].map(([id,em])=>caseCard(id,em)).join('')}</div></details>`).join('');
$$('#imageVaultGroups .vault-run-jump a').forEach(a=>a.onclick=e=>{e.preventDefault();const d=$('#vault-'+a.dataset.run);if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'})}});
$$('#imageVaultGroups .vault-group').forEach(g=>{const c=cases.find(x=>x.id===g.dataset.case);if(!c)return;const btn=g.querySelector('.vault-open-btn');if(btn)btn.onclick=()=>openPatient(c)});$$('#imageVaultGroups .image-stack').forEach(s=>s.onclick=()=>openVaultGallery(vaultGalleryGroups[+s.dataset.group]));
$$('#imageVaultGroups .vault-del-btn').forEach(b=>b.onclick=async e=>{e.stopPropagation();const ids=b.dataset.ids.split(',');if(ids.length>1){openVaultGallery(vaultGalleryGroups[+b.dataset.group]);return}if(!confirm('Delete this image? This cannot be undone.'))return;try{await deleteImage(ids[0]);toast('Image deleted');await setupImageVaultView()}catch(err){toast('Could not delete the image')}})}
async function setupProtocolsView(){const list=$('#protocolList'),input=$('#protocolFileInput');if(!list||!input)return;try{const res=await fetch('/api/protocols');const docs=res.ok?await res.json():[];docs.forEach(d=>list.insertAdjacentHTML('beforeend',uploadedProtocolCard(d)))}catch(err){}input.onchange=async e=>{const file=e.target.files[0];if(!file)return;const form=new FormData();form.append('file',file);form.append('title',file.name.replace(/\.[^.]+$/,''));try{const res=await fetch('/api/protocols',{method:'POST',body:form});if(!res.ok)throw new Error('Upload failed');const doc=await res.json();list.insertAdjacentHTML('beforeend',uploadedProtocolCard(doc));toast('Protocol uploaded')}catch(err){toast('Protocol upload failed')}input.value=''}}
function protocolsMarkup(){return `<div class="protocol-upload-row"><label class="primary file-button" title="PDF or Word — shown as its own card below, with a download link.">＋ Upload protocol file<input id="protocolFileInput" type="file" accept=".pdf,.doc,.docx" hidden></label><a class="primary protocol-download" href="/static/protocols/PGS_Kit_Preparation_SOP.pdf" download>⬇ Download PDF</a></div><div class="protocol-list" id="protocolList"><article class="protocol-card"><div class="protocol-card-head"><div><h3>Preparation of PGS Embryo Biopsy Collection Kits</h3><div class="protocol-meta">SOP No. ADL/SOP/PGS/KIT/001 · Version 01</div></div></div><div class="protocol-body">

<h4>1. Purpose</h4>
<p>To describe the standardized preparation, sterilization, buffer aliquoting, assembly, labeling, quality-control and release of PGS embryo-biopsy collection kits intended for receipt and preservation of embryo-biopsy samples prior to downstream whole-genome amplification (WGA) and PGS testing.</p>

<h4>2. Scope</h4>
<p>This SOP applies to trained and authorized personnel preparing embryo-biopsy collection kits in the designated clean laboratory area. It covers preparation of sterile PCR tubes, DPBS-based preservation buffer, kit packing and lot traceability. It does not describe embryo biopsy, WGA, sequencing or clinical interpretation.</p>

<h4>3. Abbreviations</h4>
<table class="protocol-table"><thead><tr><th>Abbreviation</th><th>Full form</th></tr></thead><tbody>
<tr><td>PGS</td><td>Preimplantation Genetic Screening</td></tr>
<tr><td>DPBS</td><td>Dulbecco's Phosphate Buffered Saline</td></tr>
<tr><td>ICSI</td><td>Intracytoplasmic Sperm Injection medium</td></tr>
<tr><td>WGA</td><td>Whole Genome Amplification</td></tr>
<tr><td>PVDF</td><td>Polyvinylidene fluoride</td></tr>
<tr><td>QC</td><td>Quality Control</td></tr>
<tr><td>IFU</td><td>Instructions for Use</td></tr>
</tbody></table>

<h4>4. Responsibility</h4>
<ul>
<li>Laboratory Director / Technical Manager shall approve the procedure and any controlled changes.</li>
<li>Authorized laboratory personnel shall prepare kits according to the current approved SOP, maintain aseptic technique and complete all records contemporaneously.</li>
<li>Section supervisor / authorized reviewer shall verify reagent lots, expiry, sterility/QC status, labeling, counts and release of each prepared lot.</li>
</ul>

<h4>5. Safety and Contamination Control</h4>
<ul>
<li>Wear laboratory coat, gloves and mask as applicable. Change gloves whenever contamination is suspected.</li>
<li>Perform preparation only in a cleaned designated cabinet/work area. Separate kit preparation from amplified-DNA/post-PCR activities.</li>
<li>Use DNase/RNase-free, sterile disposables. Avoid touching the inner surface of tubes, caps, racks or bags.</li>
<li>Use UV only in accordance with the cabinet/equipment safety instructions. Do not expose personnel to UV radiation.</li>
<li>70% IPA or 70% ethanol may be used for surface disinfection as per the laboratory-approved cleaning procedure.</li>
</ul>

<h4>6. Equipment and Materials</h4>
<ul>
<li>Clean cabinet / laminar work area with UV facility</li>
<li>Calibrated micropipettes and sterile filtered tips</li>
<li>Vortex mixer</li>
<li>Refrigerator (2–8°C)</li>
<li>Sterile 1.5 mL tubes for preservation-buffer aliquots</li>
<li>Sterile PCR tubes, 0.2 mL, flat cap, DNase/RNase-free (Axygen PCR-02-C or validated equivalent)</li>
<li>PCR workstation rack with cover – Tarsons Cat. No. 241000 (or validated equivalent). Product type: PCR Workstation Rack with cover; polypropylene (PP). Blue rack with transparent lid; cover/lid included. 96 wells (12 × 8); compatible with 0.1 mL and 0.2 mL PCR tubes, strips and plates. Autoclavable; manufacturer specifies the rack as non-sterile. Clean/decontaminate according to the validated laboratory procedure before kit preparation.</li>
<li>Sterile zip-lock bags and kit cartons/boxes</li>
<li>Sterile 15 mL / 50 mL conical tubes as required</li>
<li>Sterile 0.2 µm PVDF syringe filter, 25 mm (Whatman GD/X Cat. No. 6900-2502 or validated equivalent)</li>
<li>Gibco DPBS (1X), calcium- and magnesium-free, REF 14190-144 or validated equivalent</li>
<li>Vitrolife ICSI medium, REF 10111, or the laboratory-validated equivalent</li>
<li>Approved labels, kit preparation worksheet, TRF/consent form and embryo-biopsy SOP/instructions</li>
</ul>

<h4>7. Reagent and Consumable Checks Before Preparation</h4>
<ul>
<li>Verify product name, catalogue/reference number, lot number, expiry date and package integrity for all reagents and consumables.</li>
<li>Do not use expired, damaged, visibly contaminated or improperly stored material.</li>
<li>Record DPBS lot, ICSI-medium lot, PCR-tube lot, Tarsons PCR-rack lot/batch (where available), and filter lot in the preparation record.</li>
<li>The supplied material photographs/product information show DPBS REF 14190-144, Whatman GD/X 0.2 µm PVDF filter Cat. No. 6900-2502, Axygen PCR-02-C PCR tubes, Vitrolife ICSI REF 10111, and Tarsons PCR Workstation Rack with cover Cat. No. 241000. Use the current approved/validated materials at the time of preparation.</li>
</ul>

<h4>8. Procedure</h4>
<p class="protocol-subhead">8.1 Work-area preparation</p>
<ol>
<li>Remove unnecessary materials from the cabinet/work area.</li>
<li>Clean the work surface with 70% IPA or 70% ethanol according to the approved laboratory cleaning procedure.</li>
<li>Wipe the external surfaces of racks, outer cartons/boxes, zip-lock bags and other materials before placing them in the clean area.</li>
<li>After cleaning and with the cabinet empty, expose the work area to UV for 20 minutes (or the validated cabinet cycle). Switch UV off before personnel begin work.</li>
</ol>
<p class="protocol-subhead">8.2 Arrangement and UV treatment of kit components</p>
<ol start="5">
<li>Arrange PCR-tube racks/boxes inside the clean cabinet.</li>
<li>Place fifteen (15) sterile 0.2 mL PCR tubes in each designated rack/kit box, unless a different count is specified in the current approved kit configuration.</li>
<li>Arrange required sterile conical tubes, racks and other UV-compatible components with caps/openings positioned as specified by the validated local procedure.</li>
<li>Expose arranged UV-compatible materials to UV for 40 minutes (or the validated cycle). Do not UV-irradiate reagents unless specifically validated.</li>
<li>After UV treatment, switch UV off and proceed using aseptic technique.</li>
</ol>
<p class="protocol-subhead">8.3 Preparation of preservation buffer</p>
<ol start="10">
<li>Transfer 20 mL DPBS (1X) into a sterile 50 mL conical tube.</li>
<li>Add 25 µL of ICSI medium to the DPBS and mix by gentle vortexing. NOTE: this volume is transcribed from the supplied preparation note and must be verified against the laboratory-approved validation/worksheet before controlled release of this SOP.</li>
<li>Keep the prepared buffer at 2–8°C during preparation when not actively handling it.</li>
<li>Immediately before filtration, use sterile filtered tips and a sterile syringe/filter assembly.</li>
<li>Filter the prepared preservation buffer through a sterile 0.2 µm PVDF filter into a sterile receiving tube using aseptic technique. Do not reuse the filter.</li>
<li>Label the filtered buffer with preparation date, preparer initials, component lot numbers and assigned preparation-lot number.</li>
</ol>
<p class="protocol-subhead">8.4 Aliquoting of preservation buffer</p>
<ol start="16">
<li>Label sterile 1.5 mL tubes according to the kit/lot plan.</li>
<li>Aliquot 800 µL of sterile-filtered preservation buffer into each 1.5 mL tube.</li>
<li>Close each tube immediately after aliquoting.</li>
<li>Visually inspect for leakage, particulate matter, turbidity or abnormal appearance. Reject any affected aliquot.</li>
<li>Keep aliquoted preservation buffer at 2–8°C until kit assembly/release, unless the validated stability study specifies another condition.</li>
</ol>
<p class="protocol-subhead">8.5 Kit assembly and packing</p>
<ol start="21">
<li>For each kit box, place the required rack containing fifteen (15) sterile 0.2 mL PCR tubes together with two labeled 1.5 mL preservation-buffer tube (800 µL), unless otherwise defined by the approved kit configuration.</li>
<li>Place each assembled kit in the designated clean protective packaging.</li>
<li>Pack five (5) parafilm pieces into small zip-lock bag, as described in the supplied preparation note.</li>
<li>Assign a kit lot number. For a batch of 10 kits, sequential numbering may be used (example: 1–10 followed by the preparation date/month-year code) according to the laboratory lot-numbering convention.</li>
<li>Include the applicable TRF/consent form, Form G (where required) and embryo-biopsy collection SOP/instructions with the dispatch pack.</li>
<li>Seal the final package and record the total number of kits prepared and released.</li>
</ol>

<h4>9. Quality Control / Sterility Check</h4>
<ul>
<li>From each newly prepared preservation-buffer lot, retain a representative aliquot for QC as defined by the laboratory quality plan.</li>
<li>Submit an aliquot for WGA preparation/microbiological sterility/growth assessment for bacterial and fungal contamination, as stated in the supplied preparation note.</li>
<li>Do not release the preparation lot for clinical sample collection until required QC/sterility acceptance is documented, unless an approved risk-based release procedure exists.</li>
<li>If growth/contamination is detected, quarantine the affected lot, investigate the source, document nonconformity and repeat preparation with new sterile materials/reagents as appropriate.</li>
</ul>

<h4>10. Acceptance / Rejection Criteria</h4>
<table class="protocol-table"><thead><tr><th>Parameter</th><th>Acceptance</th><th>Rejection / Action</th></tr></thead><tbody>
<tr><td>Materials</td><td>Correct product/lot, within expiry, intact packaging</td><td>Expired, damaged, incorrect or untraceable material</td></tr>
<tr><td>Buffer appearance</td><td>Clear; no visible particulate/turbidity</td><td>Turbidity, precipitate, particulate matter or leakage</td></tr>
<tr><td>Aliquot volume</td><td>800 µL per 1.5 mL tube</td><td>Incorrect volume outside validated tolerance</td></tr>
<tr><td>PCR tubes</td><td>15 sterile 0.2 mL tubes per kit/rack</td><td>Wrong count, damaged/open/contaminated tubes</td></tr>
<tr><td>Sterility QC</td><td>No bacterial/fungal growth according to approved microbiology method</td><td>Any growth: quarantine/reject lot and investigate</td></tr>
<tr><td>Documentation</td><td>Complete lot, date, preparer/reviewer and component traceability</td><td>Incomplete or non-traceable records</td></tr>
</tbody></table>

<h4>11. Storage and Dispatch</h4>
<ul>
<li>Store prepared preservation-buffer aliquots/kits at the laboratory-validated temperature. The supplied preparation note indicates 4–8°C during preparation/storage of buffer.</li>
<li>Protect kits from contamination, leakage, direct sunlight and temperature excursions.</li>
<li>Define kit expiry only from an approved stability/validation study; do not assign an arbitrary expiry solely from component expiry dates.</li>
<li>Record dispatch date, kit lot, quantity and receiving client/location for full traceability.</li>
</ul>

<h4>12. Records</h4>
<ul>
<li>PGS Kit Preparation Batch Record</li>
<li>Reagent and consumable lot/expiry record</li>
<li>Cleaning and UV record</li>
<li>Preservation-buffer preparation and aliquoting record</li>
<li>Microbiology sterility/QC report</li>
<li>Kit release and dispatch log</li>
<li>Deviation/nonconformity record, if applicable</li>
</ul>

<h4>13. References</h4>
<ul>
<li>Current manufacturer IFU/product information for Gibco DPBS (1X), REF 14190-144.</li>
<li>Current manufacturer IFU/product information for Vitrolife ICSI medium, REF 10111.</li>
<li>Current manufacturer product information for Whatman GD/X sterile 0.2 µm PVDF filter media, Cat. No. 6900-2502.</li>
<li>Current manufacturer product information for Axygen 0.2 mL PCR tubes, PCR-02-C.</li>
<li>Current manufacturer product information for Tarsons PCR Workstation Rack with cover, Cat. No. 241000.</li>
<li>Applicable laboratory biosafety, cleaning, environmental monitoring, sterility-testing, PGT sample-receipt and quality-management procedures.</li>
</ul>

<h4>Annexure 1 – PGS Kit Preparation Batch Record</h4>
<table class="protocol-table protocol-form-table"><tbody>
<tr><td>Preparation Date</td><td></td><td>Kit Lot No.</td><td></td></tr>
<tr><td>No. of Kits Prepared</td><td></td><td>No. Released</td><td></td></tr>
<tr><td>DPBS Lot / Expiry</td><td></td><td>ICSI Lot / Expiry</td><td></td></tr>
<tr><td>PCR Tube Lot / Expiry</td><td></td><td>Tarsons Rack Lot / Batch</td><td></td></tr>
<tr><td>Buffer Volume Prepared</td><td></td><td>Aliquot Volume</td><td>800 µL</td></tr>
<tr><td>UV Cycle – Initial</td><td></td><td>UV Cycle – Components</td><td></td></tr>
<tr><td>Sterility QC Result</td><td></td><td>QC Report No.</td><td></td></tr>
<tr><td>Prepared By / Sign</td><td></td><td>Reviewed By / Sign</td><td></td></tr>
</tbody></table>

</div></article></div>`}
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function resultMonthOptions(){const now=new Date();let o='<option value="">Auto (folder, else date in file name)</option>';for(let i=0;i<30;i++){const d=new Date(now.getFullYear(),now.getMonth()-i,1),v=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;o+=`<option value="${v}">${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}</option>`}return o}
// "Jan 2026", "1. Jan 2026", "April 2026", "5. May 2026" ... -> "2026-01"
// "...-24-07-2026.xlsx" -> "2026-07" (the last dd-mm-yyyy date written in the name)
function monthFromFileName(name){const d=fileDateOf(name);return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:''}
function monthFromFolder(path){const parts=String(path||'').split('/');parts.pop();for(let i=parts.length-1;i>=0;i--){const m=/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-_ ]?\s*(20\d{2})/i.exec(parts[i]);if(m)return `${m[2]}-${String(MONTH_NAMES.findIndex(x=>x.toLowerCase()===m[1].toLowerCase())+1).padStart(2,'0')}`}return''}
function importMarkup(){return `<section class="universal-import"><div><h2>Attach a sequencing result file</h2><p>CSV or Excel, any sheet layout (e.g. a RUN analysis file). Matches by patient + embryo identity and adds QC/result data to existing samples.</p></div><div class="import-controls"><label class="file-button">Choose result file<input id="resultAttachFile" type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden></label><label class="file-button" title="Pick a whole month folder - the month is read from the folder name (e.g. Jan 2026)">Choose folder<input id="resultAttachFolder" type="file" webkitdirectory directory multiple hidden></label><label class="rf-monthpick" title="The month these files belong to. Leave on Auto to use the folder name, else the date written in the file name, else the patients' received dates."><span>Month</span><select id="resultMonthPick">${resultMonthOptions()}</select></label><button class="primary compact" id="resultUploadBtn" disabled>Upload</button></div><small id="resultAttachStatus">No files selected</small></section><section class="upload-log-section"><div class="log-head"><h3>Uploaded result files</h3><small class="rf-hint">One result file per embryo. To upload new results for a sample, delete its earlier file here first.</small></div><div id="resultFilesList" class="upload-log-list"><div class="chart-empty">Loading…</div></div></section>`}
function renderUploadLog(){const el=$('#uploadLogList');if(!el)return;const log=uploadLogCache||[];if(!log.length){el.innerHTML='<div class="chart-empty">No uploads yet.</div>';return}const rows=log.map((e,i)=>{const files=escapeHtml(e.files.join(', '));const by=e.by?`<span class="upload-log-by">${escapeHtml(e.by)}</span>`:'<span class="upload-log-by unknown">Unknown</span>';return `<tr><td>${i+1}</td><td class="left upload-log-files" title="${files}">${files}</td><td class="upload-log-count">${e.matched}</td><td>${by}</td><td class="upload-log-role">${e.role?escapeHtml(e.role):'—'}</td><td><span class="activity-action tone-result">${ACTIVITY_LABELS.result_upload}</span></td><td class="upload-log-time">${new Date(e.at).toLocaleDateString()}</td><td class="upload-log-time">${new Date(e.at).toLocaleTimeString()}</td></tr>`}).join('');el.innerHTML=`<table class="upload-log-table"><colgroup><col class="c-sno"><col><col class="c-count"><col class="c-by"><col class="c-role"><col class="c-action"><col class="c-date"><col class="c-time"></colgroup><thead><tr><th>S.No</th><th class="left">File</th><th>Samples matched</th><th>Uploaded by</th><th>Role</th><th>Action</th><th>Date</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`}
let uploadLogCache=[];
function sessionRole(){return currentUser.role||''}
const isAdmin=()=>sessionRole()==='admin';
const ACTIVITY_LABELS={followup_save:'Follow-up update',export:'Data export',login:'Signed in',logout:'Signed out',result_upload:'Result file upload',image_upload:'Embryo image upload',image_delete:'Embryo image deleted',protocol_upload:'Protocol upload',protocol_delete:'Protocol deleted',sheet_sync:'Sheet sync',log_reset:'Log reset',result_delete:'Result file deleted',trf_signed:'Signed TRF copy uploaded',trf_email:'TRF email to client',user_manage:'User management'};
const ACTIVITY_TONES={followup_save:'tone-result',export:'tone-result',login:'tone-in',logout:'tone-out',result_upload:'tone-result',image_upload:'tone-image',image_delete:'tone-delete',protocol_upload:'tone-protocol',protocol_delete:'tone-delete',sheet_sync:'tone-sync',log_reset:'tone-delete',result_delete:'tone-delete',trf_signed:'tone-result',trf_email:'tone-sync',user_manage:'tone-sync'};
function activityMarkup(){return `<section class="activity-users"><h3>Users</h3><div id="activityUsers" class="activity-user-grid"><div class="chart-empty">Loading…</div></div></section><section class="activity-log-section"><div class="activity-log-head"><h3>Activity</h3><div class="activity-filters"><select id="activityActionFilter" class="chart-filter" aria-label="Filter by action"><option value="">All actions</option>${Object.entries(ACTIVITY_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><select id="activityUserFilter" class="chart-filter" aria-label="Filter by user"><option value="">All users</option></select><button type="button" class="toolbar-btn" id="activityRefresh">Refresh</button>${isAdmin()?`<button type="button" class="log-reset-btn" id="activityLogReset"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Reset log</button>`:''}</div></div><div id="activityLogList" class="upload-log-list"><div class="chart-empty">Loading…</div></div></section>`}
async function setupActivityView(){
 const usersEl=$('#activityUsers'),listEl=$('#activityLogList'),actionSel=$('#activityActionFilter'),userSel=$('#activityUserFilter');
 let data={users:[],events:[]};
 const who=name=>name?`<span class="upload-log-by">${escapeHtml(name)}</span>`:'<span class="upload-log-by unknown">Unknown</span>';
 const renderUsers=()=>{usersEl.innerHTML=data.users.length?data.users.map(u=>`<div class="activity-user"><div class="activity-user-top"><strong>${escapeHtml(u.username)}</strong><span class="activity-status ${u.active?'on':'off'}">${u.active?'Active now':'Not active'}</span></div><small class="activity-user-role">${escapeHtml(u.role)}</small><dl><dt>Last active</dt><dd>${u.lastSeen?new Date(u.lastSeen).toLocaleString():'—'}</dd></dl></div>`).join(''):'<div class="chart-empty">No activity yet.</div>'};
 const renderEvents=()=>{const a=actionSel.value,u=userSel.value;const rows=data.events.filter(e=>(!a||e.action===a)&&(!u||e.role===u));if(!rows.length){listEl.innerHTML='<div class="chart-empty">No activity yet.</div>';return}listEl.innerHTML=`<table class="upload-log-table activity-table"><colgroup><col class="c-sno"><col class="c-by"><col class="c-role"><col class="c-action"><col><col class="c-date"><col class="c-time"></colgroup><thead><tr><th>S.No</th><th>User</th><th>Role</th><th>Action</th><th class="left">Details</th><th>Date</th><th>Time</th></tr></thead><tbody>${rows.map((e,i)=>{const d=new Date(e.at);const det=escapeHtml(e.detail||'—');return `<tr><td>${i+1}</td><td>${who(e.username)}</td><td class="upload-log-role">${e.role?escapeHtml(e.role):'—'}</td><td><span class="activity-action ${ACTIVITY_TONES[e.action]||''}">${escapeHtml(ACTIVITY_LABELS[e.action]||e.action)}</span></td><td class="left upload-log-files" title="${det}">${det}</td><td class="upload-log-time">${d.toLocaleDateString()}</td><td class="upload-log-time">${d.toLocaleTimeString()}</td></tr>`}).join('')}</tbody></table>`};
 const load=async()=>{try{const r=await fetch('/api/activity-log');if(!r.ok)throw 0;data=await r.json()}catch(e){listEl.innerHTML='<div class="chart-empty">Could not load activity.</div>';return}const keep=userSel.value;userSel.innerHTML='<option value="">All users</option>'+data.users.map(u=>`<option value="${escapeHtml(u.role)}">${escapeHtml(u.username)}</option>`).join('');userSel.value=keep;renderUsers();renderEvents()};
 actionSel.onchange=renderEvents;userSel.onchange=renderEvents;$('#activityRefresh').onclick=load;
 const resetBtn=$('#activityLogReset');if(resetBtn)resetBtn.onclick=async()=>{if(!confirm('Clear the entire activity log? This cannot be undone.'))return;const r=await fetch('/api/activity-log',{method:'DELETE'}).catch(()=>null);if(r&&r.ok){toast('Activity log cleared');load()}else toast('Could not reset the log')};
 await load();
}
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quoted&&n==='"'){cell+='"';i++}else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=c}row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows}
function recordsFrom(rows){if(!rows.length)return[];const signals=['patient name','sample id','sample name','embryo name','test','qc','conclusion','result','mapd','embryo details','ir final results','test name','result summary','kinship result','cnv qc'];let hi=-1,best=0;rows.slice(0,20).forEach((r,i)=>{const cells=r.map(c=>String(c).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()),score=signals.filter(s=>cells.includes(s)).length;if(score>best){best=score;hi=i}});if(hi<0||best<2)return[];const heads=rows[hi].map(h=>String(h).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim());return rows.slice(hi+1).filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(heads.map((h,i)=>[h||`column ${i+1}`,r[i]||''])))}
function field(r,names){for(const n of names){const k=Object.keys(r).find(x=>x===n||x.includes(n));if(k&&r[k])return String(r[k]).trim()}return''}
function embryoUnits(e){const n=parseFloat(field(e,['number of embryos']));return Number.isFinite(n)&&n>0?n:1}
function cleanId(v){return String(v||'').toUpperCase().replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,'').replace(/[^A-Z0-9]/g,'')}
function resultIdentity(r){const raw=field(r,['sample name','embryo name','embryo']),clean=String(raw).replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,'').trim(),cut=clean.lastIndexOf('-');return cut>0?{patient:clean.slice(0,cut).replace(/[^a-z0-9]/gi,''),embryo:clean.slice(cut+1).replace(/[^a-z0-9]/gi,'')}:{patient:'',embryo:cleanId(clean)}}
function fieldKey(r,names){for(const n of names){const k=Object.keys(r).find(x=>x===n||x.includes(n));if(k&&r[k])return k}return null}
// A sheet row can hold several embryos ("AS-1,2,3,4"); results merged from the result
// file are kept per embryo in _embryoResults, so each split-out embryo shows its own.
function withEmbryoResult(r,embryo){if(!r._embryoResults)return r;const own=r._embryoResults[cleanId(embryo)];if(own){const{_fileId,...vals}=own,out={...r,...vals};if('karyotype mwf' in vals||'karyotype normal wf' in vals)out['karyotype']=vals['karyotype mwf']||vals['karyotype normal wf']||'';return out}
 // No result of its own yet: show only what the sample sheet had, not another embryo's result.
 const out={...r},orig=r._resultOriginals||{};RESULT_FIELDS.forEach(f=>{if(orig[f]!=null)out[f]=orig[f];else if(f in orig)delete out[f]});return out}
function expandEmbryoRow(r){const key=fieldKey(r,['sample name','embryo name','embryo']);if(!key)return[r];const clean=String(r[key]||'').replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,'').trim(),cut=clean.lastIndexOf('-');
 if(cut>0){const list=clean.slice(cut+1);if(list.includes(',')){const nums=list.split(',').map(s=>s.trim()).filter(Boolean);if(nums.length>=2){const prefix=clean.slice(0,cut+1);return nums.map(n=>withEmbryoResult({...r,[key]:`${prefix}${n}`},`${prefix}${n}`))}}return[withEmbryoResult(r,clean)]}
 // No hyphen (e.g. a plain "1,2,3,4" with no patient-prefix tag): still split on commas,
 // matching expandEmbryoTags - otherwise this row never lines up with its own result-file data.
 if(clean.includes(',')){const parts=clean.split(',').map(s=>s.trim()).filter(Boolean);if(parts.length>=2)return parts.map(p=>withEmbryoResult({...r,[key]:p},p))}
 return[withEmbryoResult(r,clean)]}
function resolvedEmbryos(c){if(!c.embryos?.length)return[];const idxMap=new Map,out=[];for(const r of c.embryos)for(const er of expandEmbryoRow(r)){const id=resultIdentity(er),ek=`${cleanId(id.patient)}|${cleanId(id.embryo)}`;if(idxMap.has(ek)){const existing=out[idxMap.get(ek)];for(const[k,v]of Object.entries(er))if(v!=null&&String(v).trim()!==''&&(existing[k]==null||String(existing[k]).trim()===''))existing[k]=v;if(!existing._outcome&&er._outcome)existing._outcome=er._outcome}else{idxMap.set(ek,out.length);out.push({...er})}}return out}
function embryoDisplayId(r){const id=resultIdentity(r);return id.patient?`${id.patient}-${id.embryo}`:id.embryo}
// "VV-1.1,1.2" means biopsy 1 / embryo 1, embryo 2; sample names write it "VV1-1", i.e. tag "VV11". The dotted tags are therefore also
// listed in joined form (VV11, VV12). The older split reading (VV1, VV2) is kept so earlier stored results still line up.
function expandEmbryoTags(embryo,dottedOnly){return [...new Set(String(embryo||'').split(/[,;/]+/).flatMap((part,i,a)=>{const lead=x=>String(x||'').match(/^[^0-9]*/)[0].replace(/[^A-Za-z]/g,''),prefix=lead(part)||lead(a[0]),nums=part.match(/\d+/g)||[],dotted=(part.match(/\d+\.\d+/g)||[]).map(n=>cleanId(prefix+n));if(!nums.length)return/[A-Za-z]/.test(part)?[cleanId(part)]:[];return dottedOnly&&dotted.length?dotted:[...nums.map(n=>cleanId(prefix+n)),...dotted]}).filter(Boolean))]}
function matchKeys(r){const patient=field(r,['patient name','patient']),embryo=field(r,['embryo name','embryo id','embryo']);if(field(r,['sample name'])){const x=resultIdentity(r);return [`${cleanId(x.patient)}|${cleanId(x.embryo)}`]}return expandEmbryoTags(embryo).map(e=>`${cleanId(patient)}|${e}`)}
let xlsxLibPromise=null;
function loadXlsxLib(){if(window.XLSX)return Promise.resolve();if(!xlsxLibPromise)xlsxLibPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});return xlsxLibPromise}
async function gridsFromFile(file){const name=file.name.toLowerCase();if(name.endsWith('.csv')||name.endsWith('.txt'))return [{name:file.name,rows:parseCsv(await file.text())}];await loadXlsxLib();const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true});return wb.SheetNames.map(n=>({name:n,rows:XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:''})}))}
const RESULT_MERGE_FIELDS=['qc','conclusion','gender','karyotype mwf','karyotype normal wf','mtcopy','uniquereads','mapd','bincv','cnvmergecv','cnvpq','autosomes','sex','embryo grade','wga conc'];
// Sample name" in the results sheet is usually "PATIENTPREFIX-TAG_L00", but some
// runs write the embryo tag itself with a hyphen ("SAMIKSHAGUPTA-SD-1_L00") or
// omit the separator entirely ("KUMUDHAKR1_L00"). Try every hyphen split (right
// to left) against the tags we actually know about from the Details tab before
// falling back to a plain suffix match, so those variants still resolve.
function resolveSampleIdentity(raw,knownTags){
  const clean=String(raw||'').replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,'').trim();
  const hyphens=[...clean].map((c,i)=>c==='-'?i:-1).filter(i=>i>=0);
  for(let i=hyphens.length-1;i>=0;i--){
    const cut=hyphens[i],tag=cleanId(clean.slice(cut+1));
    if(knownTags.has(tag))return {patient:clean.slice(0,cut).replace(/[^a-z0-9]/gi,''),embryo:tag};
  }
  const compact=cleanId(clean);
  for(const tag of [...knownTags.keys()].sort((a,b)=>b.length-a.length)){
    if(compact.length>tag.length&&compact.endsWith(tag))return {patient:compact.slice(0,compact.length-tag.length),embryo:tag};
  }
  if(hyphens.length){const cut=hyphens[hyphens.length-1];return {patient:clean.slice(0,cut).replace(/[^a-z0-9]/gi,''),embryo:cleanId(clean.slice(cut+1))}}
  return {patient:'',embryo:compact};
}
// Maps each embryo tag to the patient(s)/Anderson ID(s) the Details tab lists it
// under. A tag can belong to more than one patient across a run (e.g. two
// patients both having a "VA1"), which is exactly why the patient name is
// still checked before trusting a match.
// ---- Tying result-file rows to PGS-NGS tracker rows through every column they share ----
// The result file's Details tab (and the older PGT-M "Sheet 1" layout) repeat the PGS-NGS sheet's columns, but
// names are shortened or corrected, dates come in other formats / day-month order, and older files often have
// no Anderson ID. So each column is compared in a tolerant way and a tracker row is accepted only when one row
// clearly out-scores the rest.
const normCol=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const wordsOf=v=>String(v??'').toUpperCase().replace(/[^A-Z\s]/g,' ').split(/\s+/).filter(Boolean);
// 3 identical, 2.5 one name is the start of the other (truncated), 2 every word matches a word's start, 1 about half the words do.
function nameSim(a,b){const x=normCol(a),y=normCol(b);if(!x||!y)return 0;if(x===y)return 3;
 const [sh,lo]=x.length<=y.length?[x,y]:[y,x];if(sh.length>=4&&lo.startsWith(sh))return 2.5;
 const wa=wordsOf(a),wb=wordsOf(b),[ws,wl]=wa.length<=wb.length?[wa,wb]:[wb,wa];if(!ws.length)return 0;
 const hit=ws.filter(w=>w.length>=2&&wl.some(v=>v===w||(w.length>=3&&(v.startsWith(w)||w.startsWith(v)&&v.length>=3)))).length;
 return hit===ws.length&&hit>=2?2:hit/ws.length>=.5&&hit>=2?1:0}
// Every day a date cell could mean: ISO / dd-mm-yyyy / Excel serial, plus the day<->month flip.
function dayKeys(v){const out=new Set,t=String(v??'').trim();if(!t)return out;const add=(y,m,d)=>{if(y>2000&&y<2100&&m>=1&&m<=12&&d>=1&&d<=31)out.add(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)};
 for(const m of t.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)){add(+m[1],+m[2],+m[3]);add(+m[1],+m[3],+m[2])}
 for(const m of t.matchAll(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/g)){add(+m[3],+m[2],+m[1]);add(+m[3],+m[1],+m[2])}
 for(const m of t.matchAll(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})(?!\d)/g)){add(2000+ +m[3],+m[2],+m[1]);add(2000+ +m[3],+m[1],+m[2])}
 if(/^\d{5}(\.\d+)?$/.test(t)){const d=new Date(Date.UTC(1899,11,30)+Math.floor(+t)*864e5);add(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());add(d.getUTCFullYear(),d.getUTCDate(),d.getUTCMonth()+1)}
 return out}
const daysMeet=(a,b)=>{const x=dayKeys(a);if(!x.size)return false;for(const k of dayKeys(b))if(x.has(k))return true;return false};
function scoreTrackerRow(det,t){let sc=0;const sid=cleanId(field(det,['sample id'])),tsid=cleanId(field(t,['sample id']));
 if(sid&&tsid&&sid===tsid)sc+=4;
 const box=normCol(field(det,['box number'])),tbox=normCol(field(t,['box number']));if(box&&tbox&&box===tbox&&box!=='NA')sc+=3;
 const dEmb=field(det,['embryo name','embryo details','embryo id']),tEmb=field(t,['embryo name','embryo id','embryo']);
 if(normCol(dEmb)&&normCol(dEmb)===normCol(tEmb))sc+=3;else{const a=new Set(expandEmbryoTags(dEmb));if(expandEmbryoTags(tEmb).some(x=>a.has(x)))sc+=1.5}
 const ns=nameSim(field(det,['patient name','patient']),field(t,['patient name','patient']));sc+=ns>=3?3:ns>=2.5?2.5:ns>=2?2:ns>=1?1:0;
 if(daysMeet(field(det,['date sample received']),field(t,['date sample received'])))sc+=2;
 if(daysMeet(field(det,['date of biopsy']),field(t,['date of biopsy'])))sc+=1;
 const cs=nameSim(field(det,['center name','centre name','hospital/clinic name']),field(t,['center name','hospital clinic name']));sc+=cs>=2.5?1.5:cs>=1?.5:0;
 const dt=normCol(field(det,['test name','test'])),tt=normCol(field(t,['test name','test']));if(dt&&dt===tt)sc+=.5;
 if(nameSim(field(det,['embryologist name']),field(t,['embryologist name']))>=2)sc+=.5;
 return{sc,ns}}
function makeTrackerIndex(rows){const byTag=new Map;rows.forEach(r=>{if(r._stale)return;expandEmbryoTags(field(r,['embryo name','embryo id','embryo'])).forEach(tag=>{if(!byTag.has(tag))byTag.set(tag,[]);byTag.get(tag).push(r)})});return{byTag}}
let lastMatchWhy='';
const recvOf=t=>field(t,['date sample received']);
// Every reading of the tracker's received date falls after the run (+7 days of slack): the sample cannot belong to this run.
function receivedAfterRun(t,fileDate){if(!fileDate)return false;const ks=[...dayKeys(recvOf(t))];return ks.length>0&&ks.every(k=>(new Date(k)-fileDate)/864e5>7)}
function trustTracker(det,t,fileDate,x){const dr=field(det,['date sample received']),tr=recvOf(t);
 if(receivedAfterRun(t,fileDate))return 'that patient\'s sample was received after this run date - probably a different cycle';
 if(dr&&tr&&!daysMeet(dr,tr)){const sidEq=cleanId(field(det,['sample id']))&&cleanId(field(det,['sample id']))===cleanId(field(t,['sample id'])),boxEq=normCol(field(det,['box number']))&&normCol(field(det,['box number']))===normCol(field(t,['box number']));if(!(sidEq&&boxEq&&x.ns>=2.5))return 'received date differs between this file and the PGS-NGS sheet'}
 return ''}
function matchTrackerRow(det,tix,fileDate){const tags=expandEmbryoTags(field(det,['embryo name','embryo details','embryo id']));if(!tags.length)return null;
 const cand=new Set;tags.forEach(t=>(tix.byTag.get(t)||[]).forEach(r=>cand.add(r)));if(!cand.size)return null;
 const sid=cleanId(field(det,['sample id'])),box=normCol(field(det,['box number']));
 const scored=[...cand].map(t=>({t,...scoreTrackerRow(det,t),idEq:(sid&&cleanId(field(t,['sample id']))===sid)||(box&&box!=='NA'&&normCol(field(t,['box number']))===box)})).filter(x=>x.sc>=6&&(x.ns>=1||x.idEq));
 lastMatchWhy='';if(!scored.length){lastMatchWhy='no PGS-NGS row has this patient + embryo';return null}
 // Safety gate: a result must never land on a different patient who happens to share a name and embryo tag (re-biopsies, repeat
 // cycles). The tracker row's received date has to agree with the file's own copy of it, and cannot fall after the run itself.
 const trusted=scored.filter(x=>{const why=trustTracker(det,x.t,fileDate,x);if(why&&!lastMatchWhy)lastMatchWhy=why;return !why});
 if(!trusted.length)return null;trusted.sort((a,b)=>b.sc-a.sc);
 if(trusted.length>1&&trusted[0].sc-trusted[1].sc<1.5){lastMatchWhy='two PGS-NGS rows fit equally well';return null}
 lastMatchWhy='';return trusted[0].t}
// No Details row to lean on (older files): resolve "<name prefix>-<tag>" straight against the tracker. A name that fits several
// rows (re-biopsy, same tag) is settled by the received date closest before the run date taken from the file name.
function fileDateOf(name){const m=[...String(name||'').matchAll(/(\d{2})[-_.]?(\d{2})[-_.]?(20\d{2})/g)].pop();if(!m)return null;const d=new Date(+m[3],+m[2]-1,+m[1]);return isNaN(d)?null:d}
function matchByPrefix(prefix,tag,tix,fileDate,opts){lastMatchWhy='';const pn=normCol(prefix);if(pn.length<3){lastMatchWhy='name too short to match';return null}
 const c=(tix.byTag.get(tag)||[]).filter(t=>{if(opts&&opts.testRe&&!opts.testRe.test(field(t,['test name','test'])))return false;const tn=normCol(field(t,['patient name','patient']));if(!tn)return false;
  // The sample-name prefix is the patient name with spaces removed (possibly cut short, or with the surname/initial the sheet lacks).
  // Accept it only when the two differ by a trailing initial at most, or the prefix is most of the name - never a middle-of-name hit.
  return tn===pn||(tn.startsWith(pn)&&(pn.length>=14||pn.length>=tn.length*.75))||(pn.startsWith(tn)&&tn.length>=4&&pn.length-tn.length<=3)});
 if(!c.length){lastMatchWhy='no PGS-NGS row has this patient + embryo';return null}
 // Embryo Sure files (one per patient, no run date in the name): the test must be Embryo Sure / HLA, the name has to match in full and
 // only ONE such PGS-NGS row may exist for that name + embryo tag. The file's last-saved time (when known) only rules out samples that
 // arrived after it - it is not used to pick between rows.
 if(opts&&opts.testRe&&!opts.dated){const k=c.filter(t=>(normCol(field(t,['patient name','patient']))===pn||pn.length>=10)&&!receivedAfterRun(t,fileDate));
  if(k.length===1)return k[0];lastMatchWhy=k.length?'more than one Embryo Sure row has this name + embryo':'no Embryo Sure row has this patient + embryo (or it was received after this file was saved)';return null}
 // With no Details tab to confirm the row, the run date in the file name must back it up: the sample was received shortly before the run.
 if(!fileDate){lastMatchWhy='no run date in the file name to confirm the match';return null}
 const ranked=c.map(t=>{const gaps=[...dayKeys(recvOf(t))].map(k=>(fileDate-new Date(k))/864e5).filter(g=>g>=-3&&g<=45);return{t,gap:gaps.length?Math.min(...gaps):1e9}}).filter(x=>x.gap<1e9).sort((a,b)=>a.gap-b.gap);
 if(!ranked.length){lastMatchWhy='received date does not fit this run (not within 45 days before it) - possibly a different cycle of the same patient';return null}
 if(ranked.length>1&&ranked[1].gap-ranked[0].gap<7){lastMatchWhy='more than one PGS-NGS row fits';return null}
 return ranked[0].t}
function buildAndersonIndex(detailsRows){
  const idx=new Map();
  for(const [di,r] of detailsRows.entries()){
    const sampleId=field(r,['sample id']),patient=field(r,['patient name']),embryoField=field(r,['embryo name']);
    if(!patient||!embryoField)continue;   // Sample ID is optional: older files have none
    for(const tag of expandEmbryoTags(embryoField)){
      const list=idx.get(tag)||[];
      list.push({patientClean:cleanId(patient),patient,sampleId,row:r,di});
      idx.set(tag,list);
    }
  }
  return idx;
}
// Resolves a (patient prefix, tag) pair to a single Details-tab entry. Uses a
// loose substring match on the name because the results sheet's sample-name
// prefix is often a shortened form of the Details tab's full patient name
// (e.g. "ARADHANA" vs "V ARADHANA"). If the tag is ambiguous (shared by more
// than one patient this run) and the name doesn't clearly pick one, no match
// is returned rather than guessing.
// The sequencing lab sometimes names an embryo with different letters than the tracker ("MGM1" in the result file, "MGE-1,2" in the tracker).
// Only when the exact tag is unknown for this run, the patient name matches exactly and exactly one of that patient's tags ends in the same number, that tag is used.
function aliasEmbryoTag(patient,tag,andersonIndex){const pc=cleanId(patient),num=(String(tag).match(/\d+$/)||[])[0];if(!pc||!num||andersonIndex.has(tag))return tag;const hits=[...andersonIndex.entries()].filter(([t,l])=>t!==tag&&(t.match(/\d+$/)||[])[0]===num&&l.some(c=>c.patientClean===pc)).map(([t])=>t);return hits.length===1?hits[0]:tag}
function resolveAndersonId(patientPrefix,tag,andersonIndex){
  const prefixClean=cleanId(patientPrefix);
  if(!prefixClean)return null;
  const matches=(andersonIndex.get(tag)||[]).filter(c=>c.patientClean.includes(prefixClean)||prefixClean.includes(c.patientClean));
  return matches.length===1?matches[0]:null;
}
// The Inconclusive tab's "Patient Name" column actually holds the same
// sample-name format as the results sheet, so it's parsed the same way. It
// also carries Embryo grade and WGA conc., which only exist for embryos
// listed here (i.e. only inconclusive ones) and aren't on the summary sheet.
function buildInconclusiveIndex(rows,andersonIndex){
  const idx=new Map();
  for(const r of rows){
    const raw=field(r,['patient name']);
    if(!raw)continue;
    const id=resolveSampleIdentity(raw,andersonIndex);
    if(!id.embryo)continue;
    idx.set(`${cleanId(id.patient)}|${id.embryo}`,{
      'embryo grade':field(r,['embryo grade']),
      'wga conc':field(r,['wga conc']),
    });
  }
  return idx;
}
// Per the lab's reporting convention: an Inconclusive-tab embryo stays
// Inconclusive regardless of what the Conclusion column says; otherwise the
// reportable karyotype comes from "Karyotype MWF" for a normal or mosaic call,
// and from "Karyotype NORMAL WF" (the simplified, non-mosaic notation) for a
// plain abnormal call.
function computeEmbryoResult(row,isInconclusive){
  if(isInconclusive)return field(row,['result'])||'Inconclusive';
  const conclusion=field(row,['conclusion']).toLowerCase();
  if(conclusion.includes('no copy number abnormality'))return field(row,['karyotype mwf']);
  if(conclusion.includes('mosaic'))return field(row,['karyotype mwf']);
  if(conclusion.includes('abnormal'))return field(row,['karyotype normal wf']);
  return field(row,['result'])||'';
}
// Result files: every uploaded result file is registered with the embryos it filled in.
// An embryo can hold results from one file only; to replace them the old file is deleted
// first, which removes its results from every sample and restores the earlier values.
const RESULT_FIELDS=['pgt result',...RESULT_MERGE_FIELDS];
let resultFilesCache=[];
function runNumberOf(name){const m=/RUN[\s_-]*(\d+[A-Z]?)/i.exec(String(name||''));return m?`RUN${m[1].toUpperCase()}`:''}
// One key per embryo of a sample row: patient|embryo tag|sample id (the same identity the result matching uses).
// Rows with no sample (Anderson) ID still get keys, with an empty id part, so results can reach them.
function rowResultKeys(row){const sampleId=field(row,['sample id']),patient=field(row,['patient name','patient']);if(!patient)return[];const sid=cleanId(sampleId),pat=cleanId(patient);return expandEmbryoTags(field(row,['embryo name','embryo id','embryo'])).map(tag=>`${pat}|${tag}|${sid}`)}
function resultPatchOf(r){const p={},rv=r._computedResult||field(r,['result']);if(rv)p['pgt result']=rv;RESULT_MERGE_FIELDS.forEach(f=>{const v=field(r,[f]);if(v)p[f]=v});return p}
// Row-level result fields are the per-embryo values joined, so row-based charts keep working.
function recomputeRowResults(row){const own=Object.entries(row._embryoResults||{}).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([,v])=>v),orig=row._resultOriginals||{},out={...row};
 RESULT_FIELDS.forEach(f=>{const vals=[...new Set(own.map(p=>p[f]).filter(Boolean))];if(vals.length)out[f]=vals.join(', ');else if(f in orig){if(orig[f]==null)delete out[f];else out[f]=orig[f]}});
 if(!own.length){delete out._embryoResults;delete out._resultOriginals;delete out._resultMergedAt}
 return out}
// Uploads made before file tracking: rows merged at the same moment form one earlier upload.
function legacyResultFiles(rows){const log=uploadLogCache||[],groups=new Map;
 rows.forEach(row=>{if(!row._resultMergedAt)return;const own=Object.values(row._embryoResults||{});if(own.length&&own.every(p=>p._fileId))return;const g=groups.get(row._resultMergedAt)||{samples:[],names:[]};rowResultKeys(row).forEach(k=>{const tag=k.split('|')[1];if(!row._embryoResults?.[tag]?._fileId){g.samples.push(k);g.names.push(`${field(row,['patient name'])||''} ${tag}`.trim())}});groups.set(row._resultMergedAt,g)});
 return [...groups].map(([at,g])=>{const entry=log.find(e=>e.at===at),fileName=entry?entry.files.join(', '):'Earlier upload';return {id:`legacy-${at}`,legacy:true,fileName,run:runNumberOf(fileName),at,samples:g.samples,sampleNames:g.names,matched:g.samples.length,by:entry?.by||'',role:entry?.role||''}})}
async function loadResultFiles(rows){const saved=(await kvGet('embryomatrix-result-files'))||[];resultFilesCache=[...legacyResultFiles(rows||(await kvGet('embryomatrix-imported-cases'))||[]),...saved].sort((a,b)=>String(b.at).localeCompare(String(a.at)));await loadResultFileMonths();return resultFilesCache}
// Read one result file: Summary rows matched to confirmed Anderson IDs via the Details tab,
// with Inconclusive-tab details folded in. Returns results keyed patient|embryo tag|sample id.
// NIPGS / NICS (spent-medium) summaries: "Sample name | QC | Conclusion | Gender | Karyotype | NICSAI | Result", names like
// "ANUJA_POKHREL-APE1-NICS_L049_2026-04-16". Controls (NC, DC, ...CC) and rows with neither a result nor a conclusion carry no embryo result.
function nipgsRecords(records){const g=(r,...ks)=>{for(const k of ks){const v=r[k];if(v!==undefined&&v!==null&&String(v).trim()!==''&&String(v).trim().toUpperCase()!=='N/A'&&String(v).trim()!=='-')return String(v).trim()}return''};
 return records.map(r=>{const name=g(r,'sample name');if(!name)return null;const base=name.replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,''),i=base.lastIndexOf('-'),tag=(i>0?base.slice(i+1):'').trim().toUpperCase();
   if(!tag||/^(NC|DC|CC|PC|NTC|BLANK)\d*$/.test(tag)||/CC$/.test(tag))return null;
   const con=g(r,'conclusion').toLowerCase(),text=g(r,'result summary','result')||(/no copy number|^normal$/.test(con)?'Euploid':/mosaic/.test(con)?'Mosaic':/abnormal/.test(con)?'Abnormal':'');
   if(!text)return null;
   return{...r,'sample name':name,result:text,'karyotype mwf':text,'karyotype normal wf':text,qc:g(r,'qc'),_nips:true}}).filter(Boolean)}
// Embryo Sure sequencer output: one Excel per patient/couple, header "Sample | Kinship_result | ... | Result summary | ...". Embryos are
// "<NAME>-<TAG>"; rows without a tag, or tagged PB, are the parents' reference samples and carry no embryo result. The columns are
// re-labelled into the standard Summary layout so the same matching and safety checks apply.
function embryosureRecords(records){const g=(r,...ks)=>{for(const k of ks){const v=r[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim()}return''};
 return records.filter(r=>{const n=g(r,'sample'),i=n.lastIndexOf('-');if(!n||i<=0)return false;const tag=n.slice(i+1).trim().toUpperCase();return tag&&!/(^|-)(PB|BLOOD|DONOR|FATHER|MOTHER)(-|_|$)/i.test(n)&&(g(r,'result summary')||g(r,'cnv qc')||g(r,'karotype mwf'))})
  .map(r=>{const mwf=g(r,'karotype mwf'),res=g(r,'result summary')||(mwf&&!/^euploid$/i.test(mwf)?mwf:g(r,'heteroploid result')&&!/^normal$/i.test(g(r,'heteroploid result'))?g(r,'heteroploid result'):'Euploid'),qc=g(r,'cnv qc');
   return{'sample name':g(r,'sample'),test:'Embryo Sure',qc,conclusion:g(r,'heteroploid result'),gender:g(r,'sex chromosome karyotype'),'karyotype mwf':mwf,'karyotype normal wf':g(r,'karotype normal'),result:res,mtcopy:g(r,'mtcopy'),uniquereads:g(r,'unique reads'),mapd:g(r,'mapd'),bincv:g(r,'bincv'),cnvmergecv:g(r,'cnvmergecv'),cnvpq:g(r,'cnvpq'),autosomes:g(r,'autosomes','autosome'),sex:g(r,'sex'),'kinship result':g(r,'kinship result'),_es:true}})}
// Newer sequencer names end in the run date: "...-NICS_L049_2026-04-16".
function dateFromSampleNames(rows){const n={};rows.forEach(r=>{const all=[...String(r['sample name']||'').matchAll(/(\d{4})-(\d{2})-(\d{2})/g)],m=all[all.length-1];if(m)n[m[0]]=(n[m[0]]||0)+1});const top=Object.entries(n).sort((a,b)=>b[1]-a[1])[0];if(!top)return null;const m=/(\d{4})-(\d{2})-(\d{2})/.exec(top[0]),d=new Date(+m[1],+m[2]-1,+m[3]);return isNaN(d)?null:d}
async function parseResultFile(f,trackerTags=new Map,trackerRows=[]){
 let summaryRows=[],detailsRows=[],inconclusiveRows=[],pgtmRows=[];
 const sheets=await gridsFromFile(f);
 for(const {name,rows} of sheets){
  const records=recordsFrom(rows);
  if(!records.length)continue;
  const label=name.toLowerCase();
  if(label.includes('inconclusive'))inconclusiveRows.push(...records);
  else if(label.includes('detail'))detailsRows.push(...records);
  else if(records.some(r=>'karyotype' in r&&'conclusion' in r&&!('karyotype mwf' in r)))summaryRows.push(...nipgsRecords(records));
  else if(records.some(r=>'result summary' in r&&('kinship result' in r||'cnv qc' in r)))summaryRows.push(...embryosureRecords(records));
  else if(records.some(r=>field(r,['embryo details'])&&field(r,['patient name']))&&!records.some(r=>field(r,['sample name'])))pgtmRows.push(...records);
  else summaryRows.push(...records);
 }
 const resultRows=summaryRows.filter(r=>field(r,['sample name'])&&(field(r,['result'])||field(r,['qc'])));
 const andersonIndex=buildAndersonIndex(detailsRows);
 const inconclusiveIndex=buildInconclusiveIndex(inconclusiveRows,andersonIndex);
 // byKey: rows confirmed through a Details-tab Anderson ID. byName: rows without one,
 // matched later against the tracker by patient name + embryo tag alone.
 const byKey=new Map,byName=new Map,used=new Set,tix=makeTrackerIndex(trackerRows),unmatchedNames=[],review=[],
  // Embryo Sure files carry no date in their name; the file's own last-saved time stands in for the run date (the analysis is saved after the sample arrived).
  fileDate=fileDateOf(f.name)||dateFromSampleNames(summaryRows)||(summaryRows.some(r=>r._es)&&f.lastModified?new Date(f.lastModified):null);
 const trKey=(tr,tag)=>`${cleanId(field(tr,['patient name','patient']))}|${tag}|${cleanId(field(tr,['sample id']))}`,hasTag=(tr,tag)=>expandEmbryoTags(field(tr,['embryo name','embryo id','embryo'])).includes(tag);
 const rowByKey=new Map;trackerRows.forEach(t=>{if(t._stale)return;expandEmbryoTags(field(t,['embryo name','embryo id','embryo'])).forEach(tag=>rowByKey.set(trKey(t,tag),t))});
 // Every result is stored against ONE tracker key. If two different result rows in this file claim the same key (the same
 // embryo twice, or two similar names) neither is stored - it is listed for review instead of guessing which is right.
 const owner=new Map,dupKeys=new Set;let pgtmCount=0;
 const hold=(raw,reason,candidate)=>{review.push({raw,reason,candidate:candidate||''});unmatchedNames.push(raw)};
 const setKey=(key,row,raw,via,tr,det,prefix,tag)=>{
  if(dupKeys.has(key)){hold(raw,'the same embryo appears more than once in this file',field(tr,['patient name']));return false}
  if(owner.has(key)){const prev=owner.get(key);byKey.delete(key);owner.delete(key);dupKeys.add(key);hold(prev.raw,'the same embryo appears more than once in this file',field(tr,['patient name']));hold(raw,'the same embryo appears more than once in this file',field(tr,['patient name']));return false}
  // "Strong" = this really is the same sample row: the file's copy and the tracker agree on sample ID or box number AND on the received date.
  const eq=(a,b)=>a&&b&&a===b,strong=via==='details'&&!!det&&(eq(cleanId(field(det,['sample id'])),cleanId(field(tr,['sample id'])))||(eq(normCol(field(det,['box number'])),normCol(field(tr,['box number'])))&&normCol(field(det,['box number']))!=='NA'))&&daysMeet(field(det,['date sample received']),recvOf(tr));
  owner.set(key,{raw,via,tr,det,prefix,tag,strong});byKey.set(key,row);return true};
 // A sample name is "<patient>-<tag>"; both parts can contain hyphens ("CHAKKA-SAI-SOWMIYA-CS2", "VR1-1_L00"), so every split is tried,
 // right to left, and the first one that lands on a tracker row wins.
 const splitsOf=raw=>{const clean=String(raw||'').replace(/(?:-NICS.*|_L\d+(?:_R\d+)?(?:_\d{4}-\d{2}-\d{2})?)$/i,'').trim(),out=[];for(let i=clean.length-1;i>0;i--)if(clean[i]==='-'){const embryo=cleanId(clean.slice(i+1)),patient=clean.slice(0,i).replace(/[^a-z0-9]/gi,'');if(embryo&&patient)out.push({patient,embryo})}return out};
 resultRows.forEach(r=>{
  const raw=field(r,['sample name']);let firstDet=null,done=false,why='';
  for(const id0 of splitsOf(raw)){
   const id={...id0,embryo:aliasEmbryoTag(id0.patient,id0.embryo,andersonIndex)},inc=inconclusiveIndex.get(`${cleanId(id0.patient)}|${id0.embryo}`),row={...r,...inc,_computedResult:computeEmbryoResult(r,!!inc)},match=resolveAndersonId(id.patient,id.embryo,andersonIndex);
   if(match){used.add(`${match.di}|${id.embryo}`);let tr=matchTrackerRow(match.row,tix,fileDate);if(!tr&&!why)why=lastMatchWhy;
    if(tr&&hasTag(tr,id.embryo)){setKey(trKey(tr,id.embryo),row,raw,'details',tr,match.row,id.patient,id.embryo);done=true;break}
    if(!firstDet)firstDet={id,match,row}
   }else{const tr=matchByPrefix(id.patient,id.embryo,tix,fileDate,r._es?{testRe:/embryo\s*sure|hla/i}:r._nips?{testRe:/nipg|nics/i,dated:true}:null);if(tr){setKey(trKey(tr,id.embryo),row,raw,'prefix',tr,null,id.patient,id.embryo);done=true;break}else if(!why)why=lastMatchWhy}
  }
  if(done)return;
  // Details row found but no safe tracker row: only an exact patient + embryo + sample-ID hit that also passes the date gate is accepted.
  if(firstDet){const k=`${firstDet.match.patientClean}|${firstDet.id.embryo}|${cleanId(firstDet.match.sampleId)}`,tr=rowByKey.get(k);
   if(tr&&!trustTracker(firstDet.match.row,tr,fileDate,{ns:3})){setKey(k,firstDet.row,raw,'details-exact',tr,firstDet.match.row,firstDet.id.patient,firstDet.id.embryo);return}
   hold(raw,why||'no safe PGS-NGS match',field(firstDet.match.row,['patient name']));return}
  hold(raw,why||'no PGS-NGS row has this patient + embryo');
 });
 // Older PGT-M layout ("Sheet 1": centre, patient, test, embryo details, IR final results): one row per embryo that carries
 // the PGS-NGS columns itself, so it is tied to its tracker row directly.
 // Patient, centre, location, embryologist and test are only typed on a patient's first row; later rows inherit them.
 const carry={};['patient name','centre name','center name','location','embryologist name','test name'].forEach(k=>carry[k]='');
 pgtmRows.forEach(rec=>{Object.keys(carry).forEach(k=>{const key=Object.keys(rec).find(x=>x===k||x.includes(k));if(!key)return;if(String(rec[key]||'').trim())carry[k]=rec[key];else if(carry[k])rec[key]=carry[k]});const res=field(rec,['ir final results','final result']);if(!res)return;pgtmCount++;
  expandEmbryoTags(field(rec,['embryo details'])).forEach(tag=>{const det={...rec,'embryo name':field(rec,['embryo details'])},label=`${field(rec,['patient name'])}-${tag}`;let tr=matchTrackerRow(det,tix,fileDate),why=lastMatchWhy;
   // This layout has no received date of its own, so the run date in the file name must fit the tracker row.
   if(tr&&hasTag(tr,tag)&&nameSim(field(rec,['patient name']),field(tr,['patient name','patient']))<2.5){hold(label,'patient name only partly matches the PGS-NGS row',field(tr,['patient name']));return}
   if(tr&&hasTag(tr,tag)){const ok=fileDate&&[...dayKeys(recvOf(tr))].some(k=>{const g=(fileDate-new Date(k))/864e5;return g>=-3&&g<=45});
    if(ok)setKey(trKey(tr,tag),{'sample name':label,result:res,_computedResult:res},label,'pgtm',tr,rec,field(rec,['patient name']),tag);else hold(label,'received date does not fit this run',field(tr,['patient name']))}
   else hold(label,why||'no PGS-NGS row has this patient + embryo')})});
 // Embryos the Details tab lists that have no result row in this file.
 const missing=[];detailsRows.forEach((r,di)=>{const pt=field(r,['patient name']);expandEmbryoTags(field(r,['embryo name']),true).forEach(tag=>{if(!used.has(`${di}|${tag}`))missing.push(`${pt} ${tag}`.trim())})});
 const audit=[...owner.values()],strongKeys=new Set([...owner].filter(([,v])=>v.strong).map(([k])=>k));
 return {file:f,audit,strongKeys,review,fileDate,byKey,byName,count:resultRows.length+pgtmCount,unverified:0,unmatchedNames,missing,hasDetails:detailsRows.length>0};
}
function matchResultsByName(parsed,known){const byTag=new Map;for(const k of known){const [pat,tag]=k.split('|');if(!byTag.has(tag))byTag.set(tag,[]);byTag.get(tag).push({pat,key:k})}
 parsed.forEach(p=>p.byName.forEach((r,nk)=>{const [pat,tag]=nk.split('|'),hits=[...new Set((byTag.get(tag)||[]).filter(c=>c.pat&&(c.pat.includes(pat)||pat.includes(c.pat))).map(c=>c.key))];if(hits.length===1&&!p.byKey.has(hits[0]))p.byKey.set(hits[0],r);else{p.unverified++;p.unmatchedNames.push(field(r,['sample name'])||nk)}}))}
// ---- "Not added" report: a filterable table with Excel export ----
const REPORT_KINDS={review:'Not added',older:'Older run (newer kept)',disputed:'In two files, different results',already:'Already had a result',nodetail:'Listed in file, no result row'};
function reasonGroup(r){const t=String(r.reason||'');if(r.kind!=='review')return REPORT_KINDS[r.kind];
 if(/no PGS-NGS row/i.test(t))return 'Patient / embryo not in PGS-NGS sheet';
 if(/received after this run|does not fit this run|received date differs/i.test(t))return 'Received date does not fit (other cycle?)';
 if(/equally well|more than one|more than once/i.test(t))return 'Ambiguous / duplicate';
 return 'Other'}
function renderUploadReport(status,headline,report){
 report.forEach(r=>r.group=reasonGroup(r));
 const groups=[...new Set(report.map(r=>r.group))];let sel='',q='',shown=300;
 status.innerHTML=`<div class="ur-head">${escapeHtml(headline)}</div>${report.length?`<div class="ur-panel"><div class="ur-bar"><strong>${report.length.toLocaleString()} item(s) not added or needing a look</strong><input type="search" class="ur-search" placeholder="Search file, sample, patient…"><button type="button" class="secondary compact ur-export">↓ Export to Excel</button></div><div class="ur-chips"></div><div class="ur-wrap"></div></div>`:'<div class="ur-head ur-ok">Everything in the files was added.</div>'}`;
 if(!report.length)return;
 const chips=status.querySelector('.ur-chips'),wrap=status.querySelector('.ur-wrap');
 const list=()=>report.filter(r=>(!sel||r.group===sel)&&(!q||[r.file,r.sample,r.reason,r.closest,r.group].join(' ').toLowerCase().includes(q)));
 const draw=()=>{const l=list();chips.innerHTML=`<button type="button" class="ur-chip${sel?'':' on'}" data-g="">All <b>${report.length}</b></button>`+groups.map(g=>`<button type="button" class="ur-chip${sel===g?' on':''}" data-g="${escapeHtml(g)}">${escapeHtml(g)} <b>${report.filter(r=>r.group===g).length}</b></button>`).join('');
  wrap.innerHTML=`<table class="ur-table"><thead><tr><th>#</th><th>File</th><th>Sample</th><th>Why</th><th>Closest PGS-NGS patient</th></tr></thead><tbody>${l.slice(0,shown).map((r,i)=>`<tr><td class="num">${i+1}</td><td class="clip" title="${escapeHtml(r.file)}">${escapeHtml(r.file)}</td><td class="strong">${escapeHtml(r.sample)}</td><td><span class="ur-tag">${escapeHtml(r.group)}</span> ${escapeHtml(r.reason)}</td><td>${escapeHtml(r.closest||'—')}</td></tr>`).join('')}</tbody></table>${l.length>shown?`<button type="button" class="secondary compact ur-more">Show ${Math.min(300,l.length-shown)} more (${l.length-shown} hidden - export has all)</button>`:''}`};
 chips.onclick=e=>{const b=e.target.closest('.ur-chip');if(!b)return;sel=b.dataset.g;shown=300;draw()};
 status.querySelector('.ur-search').oninput=e=>{q=e.target.value.trim().toLowerCase();shown=300;draw()};
 wrap.onclick=e=>{if(e.target.closest('.ur-more')){shown+=300;draw()}};
 status.querySelector('.ur-export').onclick=async()=>{const l=list(),headers=['#','File','Sample','Category','Why','Closest PGS-NGS patient'],body=l.map((r,i)=>[i+1,r.file,r.sample,r.group,r.reason,r.closest||'']),stamp=new Date().toISOString().slice(0,10);
  try{await loadXlsxLib();const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headers,...body]);ws['!cols']=[5,52,36,34,70,30].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,'Not added');XLSX.writeFile(wb,`result-upload-not-added-${stamp}.xlsx`)}catch(err){downloadRegistry('excel',{headers,rows:body},`result-upload-not-added-${stamp}`)}};
 draw()}
async function handleResultAttach(files,opts={}){
 const status=$('#resultAttachStatus');
 status.textContent=`Reading ${files.length} file(s)…`;
 const allRows=(await kvGet('embryomatrix-imported-cases'))||[],known=new Set(allRows.flatMap(rowResultKeys));
 const trackerTags=new Map([...known].map(k=>[k.split('|')[1],true]));
 const parsed=[];
 const trackerRows=allRows.filter(r=>!r._stale);
 for(const f of files){try{parsed.push(await parseResultFile(f,trackerTags,trackerRows))}catch(e){toast(`${f.name} could not be read`)}}
 if(!parsed.some(p=>p.byKey.size||p.byName.size)){status.textContent='No result rows with a Sample Name and QC/Result value were found.';return}
 // Rows without an Anderson ID: take the tracker embryo whose patient name matches (loosely,
 // as the file often shortens it) and whose tag is the same. If that fits more than one
 // tracker sample (e.g. a re-biopsy with the same tag), the row is skipped rather than guessed.
 matchResultsByName(parsed,known);

 // Results are matched to the PGS-NGS (tracker) rows only; the Sequencing Batch Record is not consulted here.
 // Anything that can't be tied to exactly one tracker row is left out and listed after the upload.
 parsed.forEach(p=>{[...p.byKey].forEach(([k,r])=>{if(!known.has(k)){p.unmatchedNames.push(field(r,['sample name'])||k);p.byKey.delete(k)}})});
 // Everything that was NOT added is collected into one report (shown as a table, exportable) instead of long paragraphs.
 const report=[],listHtml=(file,kind,names)=>{names.forEach(n=>{const m=/^(.*?) — (.*?)(?: \(closest: (.*)\))?$/.exec(String(n));report.push({file,kind,sample:m?m[1]:String(n),reason:m?m[2]:'',closest:m&&m[3]||''})});return ''};
 let skippedHtml=parsed.map(p=>listHtml(p.file.name,'review',[...new Set([...(p.review||[]).map(x=>`${x.raw} — ${x.reason}${x.candidate?` (closest: ${x.candidate})`:''}`),...p.unmatchedNames.filter(n=>!(p.review||[]).some(x=>x.raw===n))])])).join('');
 const unverified=parsed.reduce((n,p)=>n+p.unverified,0),skippedNote=unverified?` · ${unverified} row(s) skipped (no single matching patient + embryo in the tracker).`:'';
 await loadResultFiles(allRows);
 const owner=new Map;resultFilesCache.forEach(e=>e.samples.forEach(k=>owner.set(k,e)));
 // Refuse the whole upload if any embryo already has results from another file (or twice in this batch).
 // An embryo that already has a result (from an earlier file, or from an earlier file in this same batch) keeps it: the repeat is
 // skipped and listed, so a big multi-file upload is never refused as a whole. To replace a result, delete its earlier file first.
 // The same embryo in two files of one batch (re-runs, A/B halves, copies): identical results keep the first file; DIFFERENT results
 // are never guessed - that embryo is left out of both files and listed, so you choose which file is right.
 const claims=new Map;parsed.forEach(p=>[...p.byKey].forEach(([k,r])=>{if(!known.has(k))return;const a=claims.get(k)||[];a.push({file:p.file.name,sig:JSON.stringify(resultPatchOf(r)),strong:p.strongKeys.has(k),date:p.fileDate});claims.set(k,a)}));
 // Same embryo, different results in two files = a re-test. When both files hold the SAME sample row (same sample ID / box number and
 // received date) the newer run replaces the older one; the older result is listed, not silently lost. With weaker evidence, or equal /
 // unknown run dates, nothing is guessed and the embryo is left out of both files.
 const disputed=new Map;claims.forEach((a,k)=>{if(a.length>1&&new Set(a.map(x=>x.sig)).size>1){const times=a.map(x=>x.date?+x.date:NaN),newest=Math.max(...times),ok=a.every(x=>x.strong)&&times.every(t=>!isNaN(t))&&times.filter(t=>t===newest).length===1;disputed.set(k,{winner:ok?a[times.indexOf(newest)].file:null,files:a.map(x=>x.file)})}});
 const conflicts=[];
 parsed.forEach(p=>{[...p.byKey].forEach(([k,r])=>{const dsp=disputed.get(k);if(!dsp||dsp.winner===p.file.name)return;const others=[...new Set(dsp.files)].filter(n=>n!==p.file.name),label=field(r,['sample name'])||k;
  if(dsp.winner)(p.supersededList=p.supersededList||[]).push(`${label} — replaced by the newer run in ${dsp.winner}`);else (p.disputedList=p.disputedList||[]).push(`${label} — also in ${others.join(', ')||'another file'}`);p.byKey.delete(k)})});
 skippedHtml+=parsed.map(p=>listHtml(p.file.name,'older',p.supersededList||[])).join('')+parsed.map(p=>listHtml(p.file.name,'disputed',p.disputedList||[])).join('');
 parsed.forEach(p=>{p.keys=[...p.byKey.keys()].filter(k=>known.has(k)).filter(k=>{const prev=owner.get(k);if(prev){conflicts.push({file:p.file.name,name:field(p.byKey.get(k),['sample name']),prev});return false}owner.set(k,{fileName:p.file.name,run:runNumberOf(p.file.name)});return true})});
 if(conflicts.length){conflicts.forEach(c=>report.push({file:c.file,kind:'already',sample:c.name,reason:`already has a result from ${c.prev.fileName} - kept; delete that file first to replace it`,closest:''}))}
 const mergedAt=new Date().toISOString(),entries=parsed.filter(p=>p.keys.length).map(p=>({id:`rf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,file:p.file,byKey:p.byKey,keys:p.keys}));
 if(!entries.length){renderUploadReport(status,'None of the result rows matched a sample in the tracker.'+skippedNote,report);return}
 const fileOfKey=new Map;entries.forEach(e=>e.keys.forEach(k=>fileOfKey.set(k,e)));
 let matchedRows=0;
 const updated=allRows.map(row=>{
  const keys=rowResultKeys(row).filter(k=>fileOfKey.has(k));if(!keys.length)return row;matchedRows++;
  const originals=row._resultOriginals||Object.fromEntries(RESULT_FIELDS.map(f=>[f,f in row?row[f]:null])),own={...(row._embryoResults||{})};
  keys.forEach(k=>{const e=fileOfKey.get(k);own[k.split('|')[1]]={...resultPatchOf(e.byKey.get(k)),_fileId:e.id}});
  return recomputeRowResults({...row,_embryoResults:own,_resultOriginals:originals,_resultMergedAt:mergedAt});
 });
 await kvSet('embryomatrix-imported-cases',updated);
 for(const e of entries){const fd=new FormData();fd.append('id',e.id);fd.append('fileName',e.file.name);fd.append('run',runNumberOf(e.file.name));fd.append('month',(opts.monthOf&&opts.monthOf(e.file))||monthFromFolder(e.file.webkitRelativePath)||opts.month||monthFromFileName(e.file.name)||'');fd.append('at',mergedAt);fd.append('samples',JSON.stringify(e.keys));fd.append('sampleNames',JSON.stringify(e.keys.map(k=>field(e.byKey.get(k),['sample name']))));fd.append('matched',String(e.keys.length));fd.append('file',e.file);try{await fetch('/api/result-files',{method:'POST',body:fd})}catch(err){}}
 try{const r=await fetch('/api/upload-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{files:entries.map(e=>e.file.name),matched:matchedRows,at:mergedAt}})});if(r.ok)uploadLogCache=(await r.json()).value||uploadLogCache}catch(err){}
 await setupCases();await loadResultFiles(updated);renderResultFiles();
 const embryos=entries.reduce((n,e)=>n+e.keys.length,0);
 parsed.filter(p=>p.hasDetails).forEach(p=>listHtml(p.file.name,'nodetail',p.missing));
 renderUploadReport(status,`${entries.length} file(s) uploaded · results added for ${embryos} embryo(s) across ${matchedRows} sample row(s).`+skippedNote,report);
 toast(`Results added for ${embryos} embryo(s)`);
}
async function deleteResultFile(id){
 const entry=resultFilesCache.find(e=>e.id===id);if(!entry)return;
 if(!confirm(`Delete ${entry.run||'this result file'} (${entry.fileName})?\n\nIts results will be removed from ${entry.samples.length} embryo(s). This cannot be undone.`))return;
 const status=$('#resultAttachStatus');status.textContent=`Removing results from ${entry.fileName}…`;
 const allRows=(await kvGet('embryomatrix-imported-cases'))||[];let touched=0;
 const updated=allRows.map(row=>{
  if(entry.legacy){if(row._resultMergedAt!==entry.at)return row;const own=Object.fromEntries(Object.entries(row._embryoResults||{}).filter(([,p])=>p._fileId));touched++;const out={...row};RESULT_MERGE_FIELDS.forEach(f=>delete out[f]);delete out._resultMergedAt;if(Object.keys(own).length){out._embryoResults=own;return recomputeRowResults(out)}delete out._embryoResults;return out}
  const own=row._embryoResults||{},left=Object.fromEntries(Object.entries(own).filter(([,p])=>p._fileId!==id));if(Object.keys(left).length===Object.keys(own).length)return row;touched++;return recomputeRowResults({...row,_embryoResults:left});
 });
 await kvSet('embryomatrix-imported-cases',updated);
 try{if(entry.legacy)await fetch('/api/result-files/log-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{fileName:entry.fileName,count:entry.samples.length}})});else await fetch(`/api/result-files/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(err){}
 await setupCases();await loadResultFiles(updated);renderResultFiles();
 status.textContent=`${entry.fileName} deleted · results removed from ${touched} sample row(s). You can now upload a new result file for these samples.`;toast('Result file deleted');
}
let resultFileMonths={};
async function loadResultFileMonths(){try{const r=await fetch('/api/result-file-months');if(r.ok)resultFileMonths=await r.json()}catch{}}
function renderResultFiles(){const el=$('#resultFilesList');if(!el)return;const list=resultFilesCache||[];
 if(!list.length){el.innerHTML='<div class="chart-empty">No result files uploaded yet.</div>';return}
 el.innerHTML=`<table class="upload-log-table rf-table"><thead><tr><th>S.No</th><th>Run no.</th><th>Month</th><th class="left">File</th><th>Embryos</th><th>Uploaded by</th><th>Date</th><th>Time</th><th></th></tr></thead><tbody>${list.map((e,i)=>{const d=new Date(e.at),names=escapeHtml((e.sampleNames||[]).join(', '));return `<tr><td>${i+1}</td><td><span class="rf-run${e.run?'':' none'}">${escapeHtml(e.run||'Not in name')}</span></td><td class="rf-month">${(()=>{const m=resultFileMonths[e.id];return m?`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m.month-1]} ${m.year}`:'—'})()}</td><td class="left upload-log-files" title="${escapeHtml(e.fileName)}">${escapeHtml(e.fileName)}${e.legacy?' <span class="rf-legacy">earlier upload</span>':''}</td><td class="upload-log-count" title="${names}">${e.samples.length}</td><td>${e.by?`<span class="upload-log-by">${escapeHtml(e.by)}</span>`:'<span class="upload-log-by unknown">Unknown</span>'}</td><td class="upload-log-time">${isNaN(d)?'—':d.toLocaleDateString()}</td><td class="upload-log-time">${isNaN(d)?'—':d.toLocaleTimeString()}</td><td><button type="button" class="rf-delete" data-id="${escapeHtml(e.id)}">Delete</button></td></tr>`}).join('')}</tbody></table>`;
 el.onclick=ev=>{const b=ev.target.closest('.rf-delete');if(b)deleteResultFile(b.dataset.id)}}
async function setupImporter(){let pendingFiles=[];const btn=$('#resultUploadBtn'),status=$('#resultAttachStatus');uploadLogCache=(await kvGet('embryomatrix-upload-log'))||[];renderUploadLog();loadResultFiles().then(renderResultFiles);const resetBtn=$('#uploadLogReset');if(resetBtn)resetBtn.onclick=async()=>{if(!confirm('Clear the result upload log? This cannot be undone.'))return;const r=await fetch('/api/upload-log',{method:'DELETE'}).catch(()=>null);if(r&&r.ok){uploadLogCache=[];renderUploadLog();toast('Upload log cleared')}else toast('Could not reset the log')};const pick=files=>{pendingFiles=[...files].filter(f=>/\.(xlsx|xls|csv)$/i.test(f.name)&&!f.name.startsWith('~$'));const mo=pendingFiles.map(f=>monthFromFolder(f.webkitRelativePath)).filter(Boolean),months=[...new Set(mo)];status.textContent=pendingFiles.length?`${pendingFiles.length} file(s) selected${months.length?` · month from folder: ${months.map(v=>MONTH_NAMES[+v.slice(5)-1]+' '+v.slice(0,4)).join(', ')}`:''}`:'No files selected';btn.disabled=!pendingFiles.length};
 $('#resultAttachFolder').onchange=e=>pick(e.target.files);$('#resultAttachFile').onchange=e=>{pendingFiles=[...e.target.files];status.textContent=pendingFiles.length?`${pendingFiles.length} file(s) selected: ${pendingFiles.map(f=>f.name).join(', ')}`:'No files selected';btn.disabled=!pendingFiles.length};btn.onclick=async()=>{if(!pendingFiles.length)return;btn.disabled=true;await handleResultAttach(pendingFiles,{month:$('#resultMonthPick').value});pendingFiles=[];$('#resultAttachFile').value='';$('#resultAttachFolder').value=''}}

// TRFs nav badge: how many submitted TRFs are still New (needs a signed-in lab user).
setTimeout(async()=>{try{const r=await fetch("/api/trf");if(!r.ok)return;const n=(await r.json()).filter(x=>x.status==="New").length,el=$("#trfNavCount");if(el)el.textContent=n}catch{}},1500);

// QC fail notifications (top bar bell): QC-fail embryos grouped by sample, newest received first.
// Read/unread is a per-browser convenience only (localStorage) - the list itself always comes from the data.
const QC_SEEN_KEY='em-qc-seen';
function qcSeen(){try{return new Set(JSON.parse(localStorage.getItem(QC_SEEN_KEY)||'[]'))}catch{return new Set}}
function qcMarkSeen(keys){const seen=qcSeen();keys.forEach(k=>seen.add(k));try{localStorage.setItem(QC_SEEN_KEY,JSON.stringify([...seen]))}catch{}}
function qcFailReason(e){const t=`${field(e,['conclusion'])} ${field(e,['result'])}`.toLowerCase();return t.includes('no dna')?'No DNA':t.includes('low dna')?'Low DNA':t.includes('low reads')?'Low reads':t.includes('inconclusive')?'Inconclusive':'QC fail'}
function qcFailRows(){const groups=new Map,keys=new Set;allEmbryos().flatMap(expandEmbryoRow).forEach(e=>{if(qcVerdict(e)!=='FAIL')return;const raw=embryoDisplayId(e)||field(e,['sample name','embryo name'])||'—',name=/^\d+$/.test(raw)?`Embryo ${raw}`:raw,id=field(e,['sample id'])||e._case?.id||'',key=`${id}|${name}`;if(keys.has(key))return;keys.add(key);const patient=e._case?.patient||field(e,['patient name'])||'Unknown patient',gk=`${id}|${patient}`;let g=groups.get(gk);if(!g)groups.set(gk,g={gk,case:e._case,patient,id,emb:field(e,['embryologist name','embryologist'])||e._case?.embryologist||'',seq:field(e,['seq platform']),runs:new Set,received:field(e,['date sample received']),rec:parseSheetDate(field(e,['date sample received'])),embryos:[]});runsOf(e).forEach(r=>g.runs.add(r));g.embryos.push({key,name,reason:qcFailReason(e)})});return[...groups.values()].sort((a,b)=>(b.rec||0)-(a.rec||0)||a.patient.localeCompare(b.patient))}
let qcAlertRows=[],qcQuery='',qcView='samples',trfOverdue=[];
async function loadTrfOverdue(){if(!isStaff())return;try{const r=await fetch('/api/trf');if(!r.ok)return;trfOverdue=(await r.json()).filter(x=>x.signedOverdue);renderQcAlerts()}catch{}}
setTimeout(loadTrfOverdue,2500);setInterval(loadTrfOverdue,300000);
// Embryologists tab: embryologists with more than QC_EMB_LIMIT QC-fail samples received in one month.
const QC_EMB_LIMIT=4;
function qcEmbryologistGroups(){const by=new Map;qcAlertRows.forEach(g=>{if(!g.emb||!g.rec)return;const m=`${g.rec.getFullYear()}-${String(g.rec.getMonth()+1).padStart(2,'0')}`,k=`${nameKey(g.emb)}|${m}`;let e=by.get(k);if(!e)by.set(k,e={key:k,emb:g.emb,month:m,samples:[]});e.samples.push(g)});return[...by.values()].filter(e=>e.samples.length>QC_EMB_LIMIT).sort((a,b)=>b.month.localeCompare(a.month)||b.samples.length-a.samples.length||a.emb.localeCompare(b.emb))}
const qcIsNew=(g,seen)=>g.embryos.some(x=>!seen.has(x.key));
function renderQcAlerts(){qcAlertRows=qcFailRows();const seen=qcSeen(),freshQc=qcAlertRows.filter(g=>qcIsNew(g,seen)).length,fresh=freshQc+trfOverdue.length,badge=$('#qcBadge'),bell=$('#qcBell');if(badge){badge.textContent=fresh>99?'99+':fresh;badge.classList.toggle('hidden',!fresh)}if(bell)bell.title=fresh?[freshQc&&`${freshQc} new QC fail${freshQc===1?'':'s'}`,trfOverdue.length&&`${trfOverdue.length} TRF${trfOverdue.length===1?'':'s'} without signed copy`].filter(Boolean).join(' · '):'Notifications';if(!$('#qcPanel')?.classList.contains('hidden'))renderQcPanel()}
function renderQcPanel(){const panel=$('#qcPanel');if(!panel)return;const seen=qcSeen(),fresh=qcAlertRows.filter(g=>qcIsNew(g,seen)),embryoCount=qcAlertRows.reduce((n,g)=>n+g.embryos.length,0),needle=qcQuery.trim().toLowerCase();
 const list=qcAlertRows.filter(g=>!needle||[g.patient,g.id,g.emb,g.seq,[...g.runs].join(' '),g.embryos.map(x=>x.name).join(' ')].join(' ').toLowerCase().includes(needle)).slice(0,100);
 const meta=(label,v)=>v?`<span><em>${label}</em> ${escapeHtml(v)}</span>`:'';
 const item=g=>{const isNew=qcIsNew(g,seen),runs=[...g.runs].join(', ');return `<button type="button" class="qc-item${isNew?' qc-new':''}" data-gk="${escapeHtml(g.gk)}"><div class="qc-item-head"><strong>${isNew?'<i class="qc-dot" aria-label="New"></i>':''}${escapeHtml(g.patient)}</strong><time>${escapeHtml(g.received||'No date')}</time></div><div class="qc-embryos">${g.embryos.map(x=>`<span class="qc-chip"><b>${escapeHtml(x.name)}</b>${escapeHtml(x.reason)}</span>`).join('')}</div><div class="qc-meta">${meta('ID',g.id)}${meta('Embryologist',g.emb)}${meta('Sequencer',g.seq)}${meta('Run',runs)}</div></button>`};
 const empty=needle?'No QC fails match your search.':'No QC fails.';
 const embGroups=qcEmbryologistGroups(),embList=embGroups.filter(e=>!needle||[e.emb,monthLabel(e.month),e.samples.map(g=>`${g.patient} ${g.id}`).join(' ')].join(' ').toLowerCase().includes(needle));
 const embItem=e=>{const n=e.samples.reduce((t,g)=>t+g.embryos.length,0);return `<div class="qc-item qc-emb-item"><div class="qc-item-head"><strong>${escapeHtml(e.emb)}</strong><time>${escapeHtml(monthLabel(e.month))}</time></div><p class="qc-emb-count"><b>${e.samples.length}</b> QC-fail samples · ${n} embryo${n===1?'':'s'}</p><div class="qc-embryos">${e.samples.map(g=>`<button type="button" class="qc-chip qc-patient-chip" data-gk="${escapeHtml(g.gk)}" title="Open ${escapeHtml(g.patient)}'s record"><b>${escapeHtml(g.patient)}</b>${g.embryos.length} embryo${g.embryos.length===1?'':'s'}</button>`).join('')}</div></div>`};
 const tabs=`<div class="qc-tabs" role="tablist"><button type="button" role="tab" data-qcview="samples" class="${qcView==='samples'?'active':''}" aria-selected="${qcView==='samples'}">Samples <b>${qcAlertRows.length}</b></button><button type="button" role="tab" data-qcview="emb" class="${qcView==='emb'?'active':''}" aria-selected="${qcView==='emb'}">Embryologists <b>${embGroups.length}</b></button><button type="button" role="tab" data-qcview="trf" class="${qcView==='trf'?'active':''}" aria-selected="${qcView==='trf'}">Signed TRFs <b>${trfOverdue.length}</b></button></div>`;
 const trfItems=trfOverdue.filter(x=>!needle||[x.ref,x.patient,x.clinic,x.submittedBy].join(' ').toLowerCase().includes(needle)),hrs=x=>Math.max(24,Math.floor((Date.now()-new Date(x.submittedAt))/36e5)),trfItem=x=>`<button type="button" class="qc-item qc-new" data-trf="${x.id}"><div class="qc-item-head"><strong>${escapeHtml(x.patient)}</strong><time>${escapeHtml(x.ref)}</time></div><p class="qc-emb-count">Signed copy not received · submitted ${hrs(x)>=48?Math.floor(hrs(x)/24)+' days':hrs(x)+' hours'} ago</p><div class="qc-meta">${meta('Clinic',x.clinic)}${meta('Submitted by',x.submittedBy)}</div></button>`;
 const body=qcView==='trf'?(trfItems.length?trfItems.map(trfItem).join(''):`<div class="qc-empty">${needle?'No TRFs match your search.':'Every TRF has its signed copy.'}</div>`):qcView==='emb'?(embList.length?embList.map(embItem).join(''):`<div class="qc-empty">${needle?'No embryologists match your search.':`No embryologist has more than ${QC_EMB_LIMIT} QC-fail samples in one month.`}</div>`):(list.length?list.map(item).join(''):`<div class="qc-empty">${empty}</div>`);
 const sub=qcView==='trf'?`${trfOverdue.length} TRF${trfOverdue.length===1?'':'s'} without the patient-signed copy 24 hours after submission`:qcView==='emb'?`Embryologists with more than ${QC_EMB_LIMIT} QC-fail samples received in the same month`:`${qcAlertRows.length} sample${qcAlertRows.length===1?'':'s'} \u00b7 ${embryoCount} embryo${embryoCount===1?'':'s'}`;
 panel.innerHTML=`<div class="qc-panel-head"><div><h3>${qcView==='trf'?'Signed TRF copies':'QC fails'}</h3><p>${sub}</p></div>${fresh.length&&qcView==='samples'?'<button type="button" class="qc-read-all" id="qcReadAll">Mark all as read</button>':''}</div>
 <div class="qc-tools">${tabs}<input type="search" id="qcSearch" placeholder="${qcView==='trf'?'Search patient, TRF, clinic\u2026':qcView==='emb'?'Search embryologist, month, patient\u2026':'Search patient, ID, embryologist, run\u2026'}" value="${escapeHtml(qcQuery)}" aria-label="Search QC fails"></div>
 <div class="qc-list">${body}</div><div class="qc-foot">${qcView==='trf'?'Click a TRF to open it and upload the signed copy':qcView==='emb'?'Click a patient to open their record':'Click a sample to open its patient record'}</div>`;
 panel.querySelectorAll('[data-qcview]').forEach(b=>b.onclick=()=>{qcView=b.dataset.qcview;renderQcPanel()});
 const search=$('#qcSearch');search.oninput=()=>{qcQuery=search.value;const pos=search.selectionStart;renderQcPanel();const s=$('#qcSearch');s.focus();s.setSelectionRange(pos,pos)};
 $('#qcReadAll')?.addEventListener('click',()=>{qcMarkSeen(qcAlertRows.flatMap(g=>g.embryos.map(x=>x.key)));renderQcAlerts();renderQcPanel()});
 panel.querySelectorAll('button[data-trf]').forEach(el=>el.onclick=async()=>{closeQcPanel();showView('trfs');const r=await fetch(`/api/trf/${el.dataset.trf}`);if(r.ok)openTrfDialog(await r.json(),async s=>{await fetch(`/api/trf/${el.dataset.trf}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{status:s}})}).catch(()=>{})},loadTrfOverdue)});
 panel.querySelectorAll('button.qc-item:not([data-trf]), .qc-patient-chip').forEach(el=>el.onclick=()=>{const g=qcAlertRows.find(x=>x.gk===el.dataset.gk);if(!g)return;qcMarkSeen(g.embryos.map(x=>x.key));closeQcPanel();renderQcAlerts();if(g.case)openPatient(g.case)})}
function closeQcPanel(){const panel=$('#qcPanel');if(panel&&!panel.classList.contains('hidden')){panel.classList.add('hidden');$('#qcBell')?.setAttribute('aria-expanded','false')}}
$('#qcBell')?.addEventListener('click',e=>{e.stopPropagation();const panel=$('#qcPanel');if(!panel.classList.contains('hidden')){closeQcPanel();return}qcQuery='';renderQcPanel();panel.classList.remove('hidden');$('#qcBell').setAttribute('aria-expanded','true')});
$('#qcPanel')?.addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',closeQcPanel);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeQcPanel()});
// Home's Overdue card opens its own page listing every overdue sample.
{const card=$('#overdueCard'),open=()=>showView('overdue');card?.addEventListener('click',open);card?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}})}
function overdueMarkup(){return `<div class="od-summary" id="overdueSummary"></div><div class="prep-toolbar"><div class="prep-search"><input id="overdueSearch" type="search" placeholder="Search patient, sample ID, client, embryologist…" aria-label="Search overdue samples"></div><button type="button" class="secondary compact" id="overdueFilterToggle" aria-expanded="true" aria-controls="overdueFilters">⚲ Filters <b class="filters-badge" id="overdueFilterBadge">0</b></button><button type="button" class="secondary compact" id="overdueExport" title="Download the list as shown (all filters applied) as an Excel file">↓ Export to Excel</button></div><div class="od-filters" id="overdueFilters"></div><div class="prep-table-wrap od-wrap" id="overdueTableWrap"><div class="chart-empty">Loading…</div></div>`}
// Lateness bands for the summary cards and the "Late by" pill.
const OD_BANDS=[['all','All overdue',()=>true,''],['pga','PGT-A overdue',r=>r.bucket==='PGT A','od-crit'],['pgm','PGT-M overdue',r=>r.bucket==='PGT A+M','od-high'],['hla','HLA overdue',r=>/hla/i.test(r.test||''),'od-mid']];
const odBandClass=d=>d>14?'od-crit':d>7?'od-high':'od-mid';
const odRowKey=r=>`${cleanId(field(r,['patient name','patient']))}|${cleanId(field(r,['sample id']))}|${cleanId(field(r,['embryo name','embryo id','embryo']))}`;
const odMonthKey=d=>{const t=parseSheetDate(d);return t?`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`:''};
function setupOverdueView(){
 const today=new Date();today.setHours(0,0,0,0);
 const blank=v=>!v||/^(not assigned|not recorded|—|-)$/i.test(String(v).trim())?'':v;
 const stageOf=e=>field(e,['attune upload'])&&!isCompleteOnSeq(e,e._case)?['Report pending','ready']:field(e,['seq date'])?['Sequenced','seq']:field(e,['wga done on'])?['Awaiting sequencing','seq']:['Awaiting WGA','wga'];
 // Run(s) of each sample: the tracker's Run ID, the Sequencing Batch Record run it sits in, and the run of any result file merged into it.
 const rowRuns=new Map,addRun=(k,r)=>{const l=`RUN ${runIdNorm(r)}`,a=rowRuns.get(k)||[];if(!a.includes(l))a.push(l);rowRuns.set(k,a)};
 seqRunsView.forEach(r=>r.items.forEach(x=>{if(x.m)addRun(odRowKey(x.m.row),r.runId)}));
 const rows=allEmbryos().filter(e=>isOverdue(e,e._case)).map(e=>{runsOf(e).forEach(r=>addRun(odRowKey(e),r));Object.values(e._embryoResults||{}).forEach(p=>{const f=(resultFilesCache||[]).find(x=>x.id===p._fileId),n=f&&(f.run||runNumberOf(f.fileName));if(n)addRun(odRowKey(e),n)});const tat=tatDate(e,e._case),test=canonicalTestName(field(e,['test','test name']))||e._case.test||'';return{e,patient:e._case.patient||field(e,['patient name'])||'—',sampleId:field(e,['sample id'])||e._case.id||'',embryos:field(e,['embryo name']),test:blank(test),long:/embryo\s*sure|hla/i.test(test),client:blank(e._case.client),embryologist:blank(e._case.embryologist),received:field(e,['date sample received']),tat,stage:stageOf(e),late:Math.round((today-parseSheetDate(tat))/864e5),bucket:runTestBucket(test),seqDate:field(e,['seq date']),wgaBy:blank(field(e,['wga done by'])),reportBy:blank(field(e,['report assigned','report assigned to','analysed by','analyzed by'])),runs:rowRuns.get(odRowKey(e))||[],monthKey:odMonthKey(field(e,['date sample received']))}}).sort((a,b)=>b.late-a.late);
 let seg='',band='all',q='';
 const flt={run:'',month:'',embryologist:'',wgaBy:'',reportBy:'',test:'',client:''},FLT=[['run','Run'],['month','Month'],['embryologist','Embryologist'],['wgaBy','WGA done by'],['reportBy','Report assigned'],['test','Test'],['client','Client']];
 const fval=(r,k)=>k==='run'?r.runs:k==='month'?[r.monthKey]:[r[k]];
 const okFlt=r=>FLT.every(([k])=>!flt[k]||fval(r,k).includes(flt[k]));
 const monthName=k=>{const m=/^(\d{4})-(\d{2})$/.exec(k||'');return m?`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]} ${m[1]}`:k};
 const optsOf=k=>{const set=new Set;rows.forEach(r=>fval(r,k).forEach(v=>{if(v)set.add(v)}));const a=[...set];return k==='month'?a.sort().reverse():k==='run'?a.sort((x,y)=>(parseInt(y.replace(/\D/g,''))||0)-(parseInt(x.replace(/\D/g,''))||0)||y.localeCompare(x)):a.sort((x,y)=>x.localeCompare(y))};
 const filtersEl=$('#overdueFilters');
 const drawFilters=()=>{const any=FLT.some(([k])=>flt[k]);filtersEl.innerHTML=FLT.map(([k,l])=>`<label class="od-filter"><span>${l}</span><select data-flt="${k}"${optsOf(k).length?'':' disabled title="No values for this column in the sheet yet"'}><option value="">${optsOf(k).length?'All':'No data'}</option>${optsOf(k).map(v=>`<option value="${escapeHtml(v)}"${flt[k]===v?' selected':''}>${escapeHtml(k==='month'?monthName(v):v)}</option>`).join('')}</select></label>`).join('')+(any?'<button type="button" class="od-clear" id="odClear">Clear filters</button>':'')};
 const wrap=$('#overdueTableWrap'),search=$('#overdueSearch'),sum=$('#overdueSummary');
 const inSeg=r=>(!seg||(seg==='long')===r.long)&&okFlt(r);
 const drawSummary=()=>{sum.innerHTML=OD_BANDS.map(([k,label,fn,cls])=>{const n=rows.filter(r=>inSeg(r)&&fn(r)).length;return `<button type="button" class="od-card ${cls}${k===band?' active':''}" data-band="${k}" aria-pressed="${k===band}"><strong>${n.toLocaleString()}</strong><span>${label}</span></button>`}).join('')};
 const cell=(v,cls='')=>v?`<td class="${cls}" title="${escapeHtml(v)}">${escapeHtml(v)}</td>`:`<td class="${cls} muted">—</td>`;
 const currentList=()=>{const fn=OD_BANDS.find(b=>b[0]===band)[2],needle=q.trim().toLowerCase();return rows.filter(r=>inSeg(r)&&fn(r)&&(!needle||[r.patient,r.sampleId,r.client,r.embryologist,r.test,r.embryos,r.wgaBy,r.reportBy,r.runs.join(' ')].join(' ').toLowerCase().includes(needle)))};
 const draw=()=>{const list=currentList();
  if(!list.length){wrap.innerHTML=`<div class="chart-empty">${rows.length?'No overdue samples match these filters.':'No overdue samples — everything is within TAT.'}</div>`;return}
  wrap.innerHTML=`<table class="prep-table od-table"><colgroup><col style="width:52px"><col style="width:112px"><col style="width:20%"><col style="width:175px"><col><col style="width:160px"><col><col><col style="width:140px"></colgroup><thead><tr><th class="num">#</th><th>Late by</th><th>Patient</th><th>Sample ID</th><th>Test</th><th>Stage</th><th>Client</th><th>Embryologist</th><th>TAT date</th></tr></thead><tbody>${list.map((r,i)=>`<tr data-i="${rows.indexOf(r)}" tabindex="0" title="Open patient record"><td class="num muted">${i+1}</td><td><span class="od-pill ${odBandClass(r.late)}">${r.late} day${r.late===1?'':'s'}</span></td><td class="od-patient"><strong>${escapeHtml(r.patient)}</strong>${r.embryos?`<small>${escapeHtml(r.embryos)}</small>`:''}</td>${cell(r.sampleId,'mono')}${cell(r.test)}<td><span class="prep-stage ${r.stage[1]}">${r.stage[0]}</span></td>${cell(r.client)}${cell(r.embryologist)}<td class="od-dates"><strong>${escapeHtml(r.tat)}</strong><small>Recd ${escapeHtml(r.received)}</small></td></tr>`).join('')}</tbody></table>`};
 const redraw=()=>{drawFilters();drawSummary();draw();syncToggle()};
 const toggleBtn=$('#overdueFilterToggle'),badge=$('#overdueFilterBadge');
 let fOpen=true;try{fOpen=localStorage.getItem('em-od-filters')!=='closed'}catch{}
 const syncToggle=()=>{filtersEl.classList.toggle('hidden',!fOpen);toggleBtn.setAttribute('aria-expanded',String(fOpen));toggleBtn.classList.toggle('active',fOpen);const n=FLT.filter(([k])=>flt[k]).length;badge.textContent=n;badge.classList.toggle('has-active',n>0)};
 toggleBtn.onclick=()=>{fOpen=!fOpen;try{localStorage.setItem('em-od-filters',fOpen?'open':'closed')}catch{}syncToggle()};
 // Where this list comes from: the PGS-NGS sheet, kept current by the Google Sheets sync.
 fetch('/api/sync-sheet/status').then(r=>r.json()).then(st=>{const el=$('#overdueSource');if(!el)return;const when=st.lastSyncedAt?new Date(st.lastSyncedAt).toLocaleString([],{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';el.innerHTML=`Source: <b>PGS-NGS sheet</b> · ${(st.total||allEmbryos().length).toLocaleString()} sample rows${when?` · last synced ${escapeHtml(when)}`:''}`}).catch(()=>{});
 filtersEl.onchange=e=>{const el=e.target.closest('[data-flt]');if(!el)return;flt[el.dataset.flt]=el.value;redraw()};
 filtersEl.onclick=e=>{if(e.target.closest('#odClear')){FLT.forEach(([k])=>flt[k]='');redraw()}};
 $('#overdueExport').onclick=async()=>{const list=currentList();if(!list.length){toast('Nothing to export - no samples match the filters');return}
  const headers=['#','Late by (days)','Patient','Embryos','Sample ID','Test','Stage','Client','Embryologist','WGA done by','Report assigned','Run','Received','TAT date'],body=list.map((r,i)=>[i+1,r.late,r.patient,r.embryos,r.sampleId,r.test,r.stage[0],r.client,r.embryologist,r.wgaBy,r.reportBy,r.runs.join(', '),r.received,r.tat]);
  const applied=[['Card',OD_BANDS.find(b=>b[0]===band)[1]],['Test group',seg==='long'?'Embryo Sure / HLA':seg==='short'?'Other tests':'All tests'],...FLT.map(([k,l])=>[l,flt[k]?(k==='month'?monthName(flt[k]):flt[k]):'All']),['Search',q.trim()||'—'],['Rows exported',list.length],['Exported on',new Date().toLocaleString()]],stamp=new Date().toISOString().slice(0,10);
  try{await loadXlsxLib();const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([headers,...body]);ws['!cols']=[5,13,28,16,18,26,18,28,22,16,18,12,13,13].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,'Overdue samples');const fs=XLSX.utils.aoa_to_sheet([['Filter','Value'],...applied]);fs['!cols']=[{wch:16},{wch:34}];XLSX.utils.book_append_sheet(wb,fs,'Filters applied');XLSX.writeFile(wb,`overdue-samples-${stamp}.xlsx`);toast(`Exported ${list.length} sample${list.length===1?'':'s'}`)}
  catch(err){downloadRegistry('excel',{headers,rows:body},`overdue-samples-${stamp}`)}};
 sum.onclick=e=>{const b=e.target.closest('.od-card');if(!b)return;band=b.dataset.band;redraw()};
 search.oninput=()=>{q=search.value;draw()};
 const open=tr=>{const r=rows[+tr.dataset.i];if(r)openPatient(r.e._case)};
 wrap.onclick=e=>{const tr=e.target.closest('tbody tr');if(tr)open(tr)};
 wrap.onkeydown=e=>{if(e.key==='Enter'){const tr=e.target.closest('tbody tr');if(tr)open(tr)}};
 redraw();
}

// Saves a Run reports table as a formatted .xlsx laid out like the lab's report sheets: bold
// bordered headers, centred figures, bold Total / Percentage rows, and dd-mm-yyyy text stored
// as real Excel dates (CSV let Excel re-read them in the PC's own date order). Uses
// xlsx-js-style - the same API as the SheetJS build loadXlsxLib() loads, plus cell styles.
let xlsxStyledPromise=null;
function loadStyledXlsx(){if(window.XLSX&&window.__xlsxStyled)return Promise.resolve();if(!xlsxStyledPromise)xlsxStyledPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';s.onload=()=>{window.__xlsxStyled=true;resolve()};s.onerror=reject;document.head.appendChild(s)});return xlsxStyledPromise}
const RR_XLSX={
 'run-report':{headers:{'S.No':'S.no','Sequencer':'Seq Name','Patients':'No.of Patients','Samples':'No.of samples','QC pass':'No.of QC Pass','QC fail':'No.of QC Fail','Inconclusive':'Inconclusive samples'},bold:['Batch','Seq Name'],head:{fill:'FFFFFF',font:'000000'}},
 'qc-check':{title:'SAMPLE PROCESSING QC CHECK',headers:{'S.No':'S.no','Samples':'No.of samples','Sequencer':'SEQ- Name','QC pass':'No.of QC Pass','QC fail':'No.of QC Fail','Euploid':'No.of Euploid','Aneuploid':'No.of Aneuploid','Mosaic':'No.of Mosaic','Inconclusive':'Inconclusive samples'},bold:['Batch','SEQ- Name'],head:{fill:'FFF2CC',font:'000000'},titleFill:'FFF2CC'},
 'embryologist-inconclusive':{headers:{'Total embryos':'Total Embryos','Total inconclusive':'Total Inconclusive'},bold:[],head:{fill:'C00000',font:'FFFFFF'},band:'DDEBF7',pctCol:'Overall %'}};
async function rrSaveXlsx(aoa,base){try{await loadStyledXlsx()}catch{toast('Could not load the Excel library - check the internet connection');return}
 const kind=Object.keys(RR_XLSX).find(k=>base.startsWith(k)),o=RR_XLSX[kind]||{headers:{},bold:[],head:{fill:'FFFFFF',font:'000000'}};
 const head=aoa[0].map(h=>o.headers[h]||h),body=aoa.slice(1),top=o.title?1:0,rows=[...(o.title?[[o.title]]:[]),head,...body],ncol=head.length;
 const ws=XLSX.utils.aoa_to_sheet(rows),thin={style:'thin',color:{rgb:'000000'}},border={top:thin,bottom:thin,left:thin,right:thin};
 const isFoot=r=>['Total','Percentage'].includes(String(r[1]??'').trim()),boldCols=new Set(o.bold.map(b=>head.indexOf(b)).filter(c=>c>=0)),pctCol=o.pctCol?head.indexOf(o.pctCol):-1;
 const pctFill=v=>{const n=parseFloat(v);return!Number.isFinite(n)?null:n>=10?'F4B6B0':n>=5?'FCE4B6':n>0?'FFF2CC':'C6EFCE'};
 rows.forEach((r,R)=>{for(let C=0;C<ncol;C++){const ref=XLSX.utils.encode_cell({r:R,c:C});let cell=ws[ref];if(!cell){cell=ws[ref]={t:'s',v:''}}
  const m=typeof cell.v==='string'&&/^(\d{2})-(\d{2})-(\d{4})$/.exec(cell.v);if(m){cell.t='n';cell.v=(Date.UTC(+m[3],+m[2]-1,+m[1])-Date.UTC(1899,11,30))/864e5;cell.z='dd-mm-yyyy'}
  const isTitle=R<top,isHead=R===top,foot=R>top&&isFoot(r),textCol=C>=1&&C<=3&&kind==='embryologist-inconclusive';
  const st={font:{name:'Times New Roman',sz:11},border,alignment:{horizontal:textCol?'left':'center',vertical:'center',wrapText:isHead}};
  if(isTitle){st.font={name:'Times New Roman',sz:12,bold:true};st.alignment={horizontal:'center',vertical:'center'};if(o.titleFill)st.fill={fgColor:{rgb:o.titleFill}}}
  else if(isHead){st.font={name:'Times New Roman',sz:11,bold:true,color:{rgb:o.head.font}};st.fill={fgColor:{rgb:o.head.fill}}}
  else{if(boldCols.has(C)||foot)st.font.bold=true;if(foot&&r[1]==='Percentage')st.font.color={rgb:'1F3FCC'};if(o.band&&(R-top)%2===1)st.fill={fgColor:{rgb:o.band}};if(C===pctCol){const f=pctFill(cell.v);if(f)st.fill={fgColor:{rgb:f}}}}
  cell.s=st}});
 if(o.title)ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:ncol-1}}];
 ws['!cols']=head.map((h,c)=>({wch:Math.min(40,Math.max(c===0?6:9,Math.ceil(String(h).length*0.7)+2,...body.map(r=>String(r[c]??'').length+2)))}));
 ws['!rows']=rows.map((_,R)=>R===top?{hpt:34}:{hpt:18});
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Report');XLSX.writeFile(wb,`${base}.xlsx`)}
// Embryologist-wise inconclusive table (Run reports > Embryologists), any set of months.
// Embryos per embryologist per month come from the PGS/NIPGS sheet month tabs; inconclusive
// embryos from the uploaded result files. Where the lab's typed embryologist report
// (embryomatrix-embryologist-inconclusive) covers an embryologist + month, its figures win.
function rrEmbryologistData(){const people=new Map,monthSet=new Set,get=(name,client,location)=>{const k=nameKey(name);if(!k)return null;let p=people.get(k);if(!p)people.set(k,p={name:String(name).trim(),clients:{},locations:{},months:{}});if(client)p.clients[client]=(p.clients[client]||0)+1;if(location)p.locations[location]=(p.locations[location]||0)+1;return p};
 allEmbryos().forEach(e=>{const m=recordMonth(e);if(!/^\d{4}-\d{2}$/.test(m))return;const name=field(e,['embryologist name','embryologist']);if(!name||/^not assigned$/i.test(name))return;const p=get(name,e._case?.client&&e._case.client!=='Not assigned'?e._case.client:field(e,['center name']),field(e,['location']));if(!p)return;monthSet.add(m);const c=p.months[m]=p.months[m]||[0,0,'sheet'];c[0]+=embryoRowsOf(e).length;c[1]+=expandEmbryoRow(e).filter(x=>conclusionClass(x)==='Inconclusive').length});
 (embInc?.rows||[]).forEach(r=>{const p=get(r.name);if(!p)return;p.typedClient=r.client;p.typedLocation=r.location;Object.entries(r.months||{}).forEach(([m,[emb,inc]])=>{monthSet.add(m);p.months[m]=[emb,inc,'report']})});
 const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
 return{months:[...monthSet].sort().reverse(),people:[...people.values()].map(p=>({name:p.name,client:p.typedClient||top(p.clients),location:p.typedLocation||top(p.locations),months:p.months}))}}
function drawRunReportsEmb(body,state){const data=state.embData||(state.embData=rrEmbryologistData()),months=data.months;
 if(!state.embMonths)state.embMonths=months.slice(0,3);
 const picked=months.filter(m=>state.embMonths.includes(m)).sort(),q=(state.embQuery||'').trim().toLowerCase();
 const chips=`<div class="rr-mchips" role="group" aria-label="Months">${months.map(m=>`<label class="rr-mchip${picked.includes(m)?' on':''}"><input type="checkbox" value="${m}"${picked.includes(m)?' checked':''}>${escapeHtml(monthLabel(m,{month:'short',year:'numeric'}))}</label>`).join('')}</div><div class="rr-mchip-actions"><button type="button" class="text-button" data-pick="3">Last 3 months</button><button type="button" class="text-button" data-pick="all">All</button><button type="button" class="text-button" data-pick="none">Clear</button></div>`;
 const rows=data.people.map(p=>{const cells=picked.map(m=>p.months[m]||null),emb=cells.reduce((s,c)=>s+(c?c[0]:0),0),inc=cells.reduce((s,c)=>s+(c?c[1]:0),0);return{...p,cells,emb,inc,pct:emb?inc/emb*100:0}}).filter(r=>r.emb>0&&r.emb>=(state.embMin||0)&&(!q||`${r.name} ${r.client} ${r.location}`.toLowerCase().includes(q))).sort((a,b)=>b.pct-a.pct||b.emb-a.emb||a.name.localeCompare(b.name));
 const tot=rows.reduce((a,r)=>({emb:a.emb+r.emb,inc:a.inc+r.inc}),{emb:0,inc:0}),fmtPct=v=>`${(Math.floor(v*100+1e-9)/100).toFixed(2)}%`,tone=v=>v>=10?'high':v>=5?'mid':v>0?'low':'zero';
 const usesReport=picked.some(m=>data.people.some(p=>p.months[m]?.[2]==='report')),usesSheet=picked.some(m=>data.people.some(p=>p.months[m]?.[2]==='sheet'));
 const head=`<tr class="rr-groups"><th colspan="4">Embryologist</th><th colspan="3" class="rr-g">All selected months</th>${picked.map(m=>`<th colspan="2" class="rr-g">${escapeHtml(monthLabel(m,{month:'long',year:'numeric'}))}</th>`).join('')}</tr><tr><th class="num">S.No</th><th>Embryologist</th><th>Client / Centre</th><th>Location</th><th class="num rr-g">Embryos</th><th class="num">Inconclusive</th><th class="num">Overall %</th>${picked.map(()=>'<th class="num rr-g">Embryos</th><th class="num">Inc.</th>').join('')}</tr>`;
 const tr=(r,i)=>`<tr><td class="num muted">${i+1}</td><td class="strong">${escapeHtml(r.name)}</td><td class="rr-clip" title="${escapeHtml(r.client)}">${escapeHtml(r.client||'—')}</td><td class="rr-clip" title="${escapeHtml(r.location)}">${escapeHtml(r.location||'—')}</td><td class="num rr-g strong">${r.emb.toLocaleString()}</td><td class="num">${r.inc.toLocaleString()}</td><td class="num"><span class="rr-heat ${tone(r.pct)}">${fmtPct(r.pct)}</span></td>${r.cells.map(c=>`<td class="num rr-g">${c?c[0].toLocaleString():'—'}</td><td class="num${c&&c[1]?' rr-inc':''}">${c?c[1].toLocaleString():'—'}</td>`).join('')}</tr>`;
 const notes=[usesReport?'Embryologists in the lab’s typed embryologist report use its figures for the months it covers.':'',usesSheet?'Other embryos are counted from the PGS/NIPGS sheet month tabs; inconclusive counts only include embryos with an uploaded result file.':''].filter(Boolean);
 body.innerHTML=`<div class="rr-emb-tools">${chips}<label class="rr-min"><span>Min. embryos</span><select id="rrEmbMin">${[0,5,10,20,50].map(n=>`<option value="${n}"${(state.embMin||0)===n?' selected':''}>${n?n+'+':'Any'}</option>`).join('')}</select></label><div class="rr-emb-right"><div class="prep-search"><input type="search" id="rrEmbSearch" placeholder="Search embryologist, client, location…" value="${escapeHtml(state.embQuery||'')}" aria-label="Search embryologists"></div></div></div>
  ${picked.length?`<div class="rr-top rr-top-emb"><div class="rr-stats">${`<div class="rr-stat"><strong>${rows.length.toLocaleString()}</strong><span>Embryologists</span></div><div class="rr-stat"><strong>${tot.emb.toLocaleString()}</strong><span>Embryos</span></div><div class="rr-stat rr-fail"><strong>${tot.inc.toLocaleString()}</strong><span>Inconclusive</span><small>${tot.emb?fmtPct(tot.inc/tot.emb*100):'—'}</small></div>`}</div></div>${notes.length?`<div class="rr-notes">${notes.map(n=>`<p>${n}</p>`).join('')}</div>`:''}
  <div class="rr-wrap"><table class="rr-table rr-emb-table"><thead>${head}</thead><tbody>${rows.length?rows.map(tr).join(''):`<tr><td colspan="${7+picked.length*2}" class="chart-empty">No embryologists match.</td></tr>`}</tbody></table></div>`:'<div class="chart-empty">Pick one or more months above.</div>'}`;
 body.querySelectorAll('.rr-mchip input').forEach(cb=>cb.onchange=()=>{state.embMonths=[...body.querySelectorAll('.rr-mchip input:checked')].map(x=>x.value);drawRunReportsEmb(body,state)});
 body.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{const k=b.dataset.pick;state.embMonths=k==='all'?months.slice():k==='none'?[]:months.slice(0,3);drawRunReportsEmb(body,state)});
 $('#rrEmbMin').onchange=e=>{state.embMin=+e.target.value;drawRunReportsEmb(body,state)};
 const s=$('#rrEmbSearch');s.oninput=()=>{state.embQuery=s.value;const pos=s.selectionStart;drawRunReportsEmb(body,state);const n=$('#rrEmbSearch');n.focus();n.setSelectionRange(pos,pos)};
 $('#rrExport').onclick=()=>{const cols=['S.No','Embryologist','Client / Centre','Location','Total embryos','Total inconclusive','Overall %',...picked.flatMap(m=>{const l=monthLabel(m,{month:'short',year:'numeric'});return[`${l} embryos`,`${l} inc.`]})],lines=rows.map((r,i)=>[i+1,r.name,r.client,r.location,r.emb,r.inc,fmtPct(r.pct),...r.cells.flatMap(c=>c?[c[0],c[1]]:['',''])]);rrSaveXlsx([cols,...lines],`embryologist-inconclusive-${picked[0]||''}${picked.length>1?'_to_'+picked[picked.length-1]:''}`)}}
// Run reports tab: month-wise run result table, like the lab's monthly run report sheet.
// Months with a typed lab report (embryomatrix-run-history) show those official rows, plus any
// Sequencing Batch Record runs the report doesn't have yet. Every other month is rebuilt from the
// PGS/NIPGS sheet: samples grouped by seq date + sequencer (the sheet has no batch-number column).
const RR_TESTS=['PGT A','PGT A+M','POC','PGT SR'];
function rrPlatform(raw){const k=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!k)return'';if(k.includes('GENOLAB'))return'Genolab M';if(k.includes('FASTA'))return'FastaSeq';if(k.includes('SURF'))return'SurfSeq';if(k==='S5'||k==='IONS5'||k.startsWith('S5'))return'ION S5';return String(raw).trim()}
// Seq date as dd-mm-yyyy + its month; a date that lands well after the row's own month tab is
// a day/month swap from the sheet locale, so it is read the other way round.
function rrSeqDate(e){const m=/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(field(e,['seq date']));if(!m)return null;let d=+m[1],mo=+m[2];const y=+m[3];if(y<2020||y>2035)return null;const tab=recordMonth(e),mk=(mm)=>`${y}-${String(mm).padStart(2,'0')}`;
 if(/^\d{4}-\d{2}$/.test(tab)&&d<=12){const next=new Date(+tab.slice(0,4),+tab.slice(5,7),1),nk=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;if(mk(mo)>nk&&mk(d)<=nk)[d,mo]=[mo,d]}
 if(d<=12&&new Date(y,mo-1,d)>new Date()&&new Date(y,d-1,mo)<=new Date())[d,mo]=[mo,d];
 if(mo<1||mo>12||d<1||d>31)return null;return{date:`${String(d).padStart(2,'0')}-${String(mo).padStart(2,'0')}-${y}`,month:mk(mo)}}
// Per-test split of a run (patients / samples / results), for the test filter.
function rrTally(){return{patients:new Set,samples:0,res:{euploid:0,aneuploid:0,mosaic:0,inconclusive:0},resN:0,qc:{pass:0,fail:0},qcN:0}}
function rrAddResult(t,x){const c=x&&conclusionClass(x);if(!c)return;t.resN++;t.res[{Normal:'euploid',Abnormal:'aneuploid',Mosaic:'mosaic',Inconclusive:'inconclusive'}[c]]++;const q=qcVerdict(x);if(q){t.qcN++;t.qc[q==='PASS'?'pass':'fail']++}}
const rrFinish=t=>({patients:t.patients.size,samples:t.samples,res:t.resN?t.res:null,qc:t.qcN?t.qc:null});
// A run = the run number of the result file that filled in the samples ("RUN 32"); samples with no result file yet fall back to seq date + sequencer.
function rrSheetRuns(){const groups=new Map,files=new Map((resultFilesCache||[]).map(f=>[f.id,f])),tally=(o,k)=>{if(k)o[k]=(o[k]||0)+1},top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
 allEmbryos().forEach(e=>{const sd=rrSeqDate(e),platform=rrPlatform(field(e,['seq platform'])),fr={},fm={};Object.values(e._embryoResults||{}).forEach(p=>{const f=files.get(p?._fileId||`legacy-${e._resultMergedAt}`),k=f&&runIdNorm(f.run||runNumberOf(f.fileName));if(k){tally(fr,k);tally(fm,f.month)}});const fileRun=top(fr),sheetRun=fileRun?'':(runsOf(e).map(runIdNorm).find(Boolean)||''),run=fileRun||sheetRun;if(!run&&!sd)return;
  // A run is one row: the run number of its result file, or - until that file is uploaded - the Run ID typed in the sheet. Uploading the file later just fills in the same row.
  const key=run?`R|${run}`:`S|${sd.date}|${platform}`;let g=groups.get(key);if(!g)groups.set(key,g={run,dates:{},months:{},platforms:{},patients:new Set,samples:0,tests:{},res:{euploid:0,aneuploid:0,mosaic:0,inconclusive:0},resN:0,qc:{pass:0,fail:0},qcN:0,ids:{},by:{}});
  tally(g.dates,sd?.date);tally(g.months,top(fm)||sd?.month);tally(g.platforms,platform);
  const units=embryoRowsOf(e).length,bucket=runTestBucket(field(e,['test name','test']));if(!isEmbryoSureRow(e))g.nonES=(g.nonES||0)+1;g.samples+=units;(g.erows=g.erows||[]).push(e);g.patients.add(nameKey(e._case?.patient||field(e,['patient name'])));const bt=bucket?(g.by[bucket]=g.by[bucket]||rrTally()):null;if(bt){bt.samples+=units;bt.patients.add(nameKey(e._case?.patient||field(e,['patient name'])))}if(bucket)g.tests[bucket]=(g.tests[bucket]||0)+units;if(!run)runsOf(e).forEach(r=>tally(g.ids,r));
  expandEmbryoRow(e).forEach(x=>{if(bt)rrAddResult(bt,x);const c=conclusionClass(x);if(!c)return;g.resN++;g.res[{Normal:'euploid',Abnormal:'aneuploid',Mosaic:'mosaic',Inconclusive:'inconclusive'}[c]]++;const q=qcVerdict(x);if(q){g.qcN++;g.qc[q==='PASS'?'pass':'fail']++}})});
 const liveOf=g=>{const items=[];(g.erows||[]).forEach(row=>{const c=row._case;expandEmbryoRow(row).forEach(x=>{const label=field(x,['sample name','embryo name','embryo']);items.push({s:{patient:field(row,['patient name','patient'])||c?.patient,embryo:label,received:field(row,['date sample received'])},m:{case:c,row,tag:cleanId(label),data:x},linked:[]})})});
  const fileIds=new Set;(g.erows||[]).forEach(row=>Object.values(row._embryoResults||{}).forEach(p=>{if(p._fileId)fileIds.add(p._fileId)}));
  const runId=g.run||top(g.ids);return{kind:'seq',runId:String(runId),title:`RUN ${runId}`,runDate:top(g.dates),platform:top(g.platforms),items,b:runBreakdown(items),files:(resultFilesCache||[]).filter(f=>fileIds.has(f.id)),tab:''}};
 return[...groups.values()].filter(g=>g.run||top(g.ids)).map(g=>({date:top(g.dates),month:top(g.months),runId:g.run||top(g.ids),platform:top(g.platforms),patients:g.patients.size,samples:g.samples,res:g.resN?g.res:null,tests:g.tests,qc:g.qcN?g.qc:null,byTest:Object.fromEntries(Object.entries(g.by).map(([k,t])=>[k,rrFinish(t)])),src:'pgs',live:liveOf(g)}))}
function runReportRows(){const hist=runHistory.map(h=>({date:h.date||'',runId:String(h.runId||''),platform:h.platform||'',patients:h.patients??null,samples:h.samples??null,res:{euploid:h.euploid,aneuploid:h.aneuploid,mosaic:h.mosaic,inconclusive:h.inconclusive},tests:h.tests||null,qc:h.qcPass!=null?{pass:h.qcPass,fail:h.qcFail}:null,month:dmyKey(h.date).slice(0,7),src:'report'})).filter(r=>r.month),have=new Set(hist.map(h=>runIdNorm(h.runId))),typed=new Set(hist.map(h=>h.month));
 const live=seqRunsView.filter(r=>!have.has(runIdNorm(r.runId))).map(r=>{const b=r.b,hasRes=b.euploid+b.aneuploid+b.mosaicInc>0;return{date:r.runDate||'',runId:String(r.runId),platform:r.platform||'',patients:b.patients,samples:b.total,res:hasRes?{euploid:b.euploid,aneuploid:b.aneuploid,mosaic:b.mosaic,inconclusive:b.inconclusive}:null,tests:b.tests,qc:hasRes?{pass:b.pass,fail:b.fail}:null,byTest:(()=>{const by={};r.items.forEach(x=>{const k=x.m&&runTestBucket(field(x.m.row,['test name','test']));if(!k)return;const t=by[k]=by[k]||rrTally();t.samples++;t.patients.add(nameKey(x.s.patient));rrAddResult(t,runResult(x.m))});return Object.fromEntries(Object.entries(by).map(([k,t])=>[k,rrFinish(t)]))})(),month:tabMonth(r.tab)||dmyKey(r.runDate).slice(0,7),src:'sheet',live:r}}).filter(r=>r.month);
 const now=new Date(),cur=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,sheet=rrSheetRuns().filter(r=>!typed.has(r.month)&&r.month<=cur),sheetIds=new Set(sheet.map(r=>runIdNorm(r.runId)).filter(Boolean));
 // One name per sequencer: "GENOLAB M", "Genolab M", "Genolab-M" ... all become the same filter option.
 return[...hist,...live.filter(r=>typed.has(r.month)||!sheetIds.has(runIdNorm(r.runId))),...sheet].map(r=>({...r,platform:rrPlatform(r.platform)||r.platform}))}
function runReportsMarkup(){return `<div class="rr-bar"><div class="rr-nav"><select id="rrMode" class="rr-mode" aria-label="Report layout"><option value="summary">Run summary</option><option value="qc">QC check</option><option value="emb">Embryologists</option></select><span class="rr-single" id="rrSingle"><button type="button" class="rr-step" id="rrPrev" aria-label="Previous month">‹</button><select id="rrMonth" aria-label="Report month"></select><button type="button" class="rr-step" id="rrNext" aria-label="Next month">›</button></span><div class="rr-filters" id="rrFilters"><label title="Run"><span>Run</span><select id="rrRun"></select></label><label><span>Sequencer</span><select id="rrSeq"></select></label><label><span>Test</span><select id="rrTest"></select></label><label><span>Result</span><select id="rrRes"></select></label><button type="button" class="text-button" id="rrClearFilters">Clear filters</button></div></div><div class="rr-actions"><button type="button" class="secondary compact rr-export" id="rrExport">⭳ Download Excel</button></div></div><div id="rrBody"><div class="chart-empty">Loading…</div></div>`}
function setupRunReportsView(){const sel=$('#rrMonth'),body=$('#rrBody');if(!sel||!body)return;const all=runReportRows(),months=[...new Set(all.map(r=>r.month))].sort().reverse();
 if(!months.length){body.innerHTML='<div class="chart-empty">No sequenced runs yet.</div>';sel.disabled=true;return}
 let month=months.includes(sel.dataset.keep)?sel.dataset.keep:months[0],test='',runF='',seqF='',resF='',mode=$('#rrMode')?.value||'summary';
 sel.innerHTML=months.map(m=>`<option value="${m}">${escapeHtml(monthLabel(m))}</option>`).join('');
 const num=v=>v==null||v===''?'—':Number(v).toLocaleString(),sum=(list,f)=>{const v=list.map(f).filter(x=>x!=null&&x!=='');return v.length?v.reduce((a,b)=>a+Number(b),0):null},pct=(n,d)=>n!=null&&d?`${(Math.floor(n/d*10000+1e-9)/100).toFixed(2)}%`:'—';// truncated like the lab's report sheet (1,219 / 1,300 = 93.76%)
 const dayKey=r=>{const k=dmyKey(r.date);return k&&k.startsWith(r.month)?k:'9999'},rowsFor=m=>all.filter(r=>r.month===m).sort((a,b)=>dayKey(a).localeCompare(dayKey(b))||a.runId.localeCompare(b.runId,undefined,{numeric:true}));
 const state={},draw=()=>{$('#rrSingle').classList.toggle('hidden',mode==='emb');$('#rrFilters').classList.toggle('hidden',mode==='emb');if(mode==='emb'){drawRunReportsEmb(body,state);return}sel.value=month;const i=months.indexOf(month);$('#rrPrev').disabled=i>=months.length-1;$('#rrNext').disabled=i<=0;
  const monthRows=rowsFor(month),runKey=r=>`${r.date}|${r.platform}|${r.runId}`;
  {// filter dropdowns follow the month; a choice that no longer exists in it is dropped
   const fill=(id,first,opts,cur)=>{const el=$(id);el.innerHTML=`<option value="">${first}</option>`+opts.map(([v,l])=>`<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');el.value=opts.some(o=>o[0]===cur)?cur:'';return el.value};
   runF=fill('#rrRun','All runs',monthRows.map(r=>[runKey(r),r.runId?`RUN ${r.runId} · ${r.date||''}`:`${r.date||'—'} · ${r.platform||'—'}`]),runF);
   seqF=fill('#rrSeq','All sequencers',[...new Set(monthRows.map(r=>r.platform).filter(Boolean))].sort().map(v=>[v,v]),seqF);
   test=fill('#rrTest','All tests',RR_TESTS.map(k=>[k,k]),test);
   resF=fill('#rrRes','All results',[['euploid','Euploid'],['aneuploid','Aneuploid'],['mosaic','Mosaic'],['inconclusive','Inconclusive']],resF);
   $('#rrClearFilters').classList.toggle('hidden',!(runF||seqF||test||resF))}
  const base=monthRows.filter(r=>(!runF||runKey(r)===runF)&&(!seqF||r.platform===seqF)&&(!resF||(r.res&&r.res[resF]>0))),tests=test?[test]:RR_TESTS;
  const rows=test?base.filter(r=>r.tests?.[test]>0).map(r=>{const b=r.byTest?.[test];return{...r,patients:b?b.patients:null,samples:r.tests[test],res:b?b.res:null,qc:b?b.qc:null,tests:{[test]:r.tests[test]},noSplit:!b}}):base,showQc=rows.some(r=>r.qc),fromPgs=rows.some(r=>r.src==='pgs'),withRes=rows.filter(r=>r.res);
  const t={patients:sum(rows,r=>r.patients),samples:sum(rows,r=>r.samples),pass:sum(rows,r=>r.qc?.pass),fail:sum(rows,r=>r.qc?.fail),euploid:sum(rows,r=>r.res?.euploid),aneuploid:sum(rows,r=>r.res?.aneuploid),mosaic:sum(rows,r=>r.res?.mosaic),inconclusive:sum(rows,r=>r.res?.inconclusive)};RR_TESTS.forEach(k=>t[k]=sum(rows,r=>r.tests?r.tests[k]||0:null));
  // Results as a share of embryos that have a result, so the four always add up to 100%.
  const resTotal=(t.euploid||0)+(t.aneuploid||0)+(t.mosaic||0)+(t.inconclusive||0),qcTotal=t.pass!=null?t.pass+(t.fail||0):null;
  const RES=[['euploid','Euploid'],['aneuploid','Aneuploid'],['mosaic','Mosaic'],['inconclusive','Inconclusive']];
  const stat=(label,v)=>`<div class="rr-stat"><strong>${num(v)}</strong><span>${label}</span></div>`;
  const resultsCard=`<div class="rr-results"><div class="rr-results-head"><span>Results</span><small>${resTotal?`${resTotal.toLocaleString()} embryos with a result`:'No result files uploaded for this month'}</small></div><div class="rr-bar-track">${resTotal?RES.map(([k])=>`<i class="rr-${k}" style="width:${(t[k]||0)/resTotal*100}%"></i>`).join(''):''}</div><div class="rr-legend">${RES.map(([k,l])=>`<div class="rr-leg rr-${k}"><b>${num(t[k])}</b><span>${l}</span><small>${pct(t[k],resTotal)}</small></div>`).join('')}</div></div>`;
  const pending=rows.length-withRes.length;
  const notes=[test&&rows.some(r=>r.noSplit)?`The typed monthly report only records how many ${escapeHtml(test)} embryos each run had - patients and results by test show as “—” for those runs.`:'',fromPgs?'Runs rebuilt from the PGS/NIPGS sheet - embryos grouped by the run number of their uploaded result file; embryos with no result file yet are grouped by seq date and sequencer.':'',pending?`${pending} of ${rows.length} runs have no result file uploaded - their results show as “—”.`:''].filter(Boolean);
  const cols=['S.No','Date','Batch','Sequencer','Patients',test?`${test} embryos`:'Embryos',...(showQc?['QC pass','QC fail']:[]),'Euploid','Aneuploid','Mosaic','Inconclusive',...(test?[]:RR_TESTS)];
  const batch=r=>r.runId?`RUN ${escapeHtml(r.runId)}`:'<span class="muted">—</span>';
  const tag=r=>r.src==='sheet'?' <span class="rr-src" title="Not in the typed monthly report yet - from the Sequencing Batch Record sheet">sheet</span>':'';
  const tr=(r,i)=>`<tr${r.live?` data-run="${i}" tabindex="0" class="rr-link" title="Open this run"`:''}><td class="num muted">${i+1}</td><td class="rr-date">${escapeHtml(r.date||'—')}</td><td class="strong">${batch(r)}${tag(r)}</td><td>${escapeHtml(r.platform||'—')}</td><td class="num">${num(r.patients)}</td><td class="num strong">${num(r.samples)}</td>${showQc?`<td class="num rr-g">${num(r.qc?.pass)}</td><td class="num">${num(r.qc?.fail)}</td>`:''}<td class="num rr-g rr-euploid">${num(r.res?.euploid)}</td><td class="num rr-aneuploid">${num(r.res?.aneuploid)}</td><td class="num rr-mosaic">${num(r.res?.mosaic)}</td><td class="num rr-inconclusive">${num(r.res?.inconclusive)}</td>${(test?[]:RR_TESTS).map((k,j)=>`<td class="num${j?'':' rr-g'}">${r.tests?num(r.tests[k]||0):'—'}</td>`).join('')}</tr>`;
  const foot=`<tr class="rr-total"><td></td><td colspan="3">Total</td><td class="num">${num(t.patients)}</td><td class="num">${num(t.samples)}</td>${showQc?`<td class="num rr-g">${num(t.pass)}</td><td class="num">${num(t.fail)}</td>`:''}<td class="num rr-g">${num(t.euploid)}</td><td class="num">${num(t.aneuploid)}</td><td class="num">${num(t.mosaic)}</td><td class="num">${num(t.inconclusive)}</td>${(test?[]:RR_TESTS).map((k,j)=>`<td class="num${j?'':' rr-g'}">${num(t[k])}</td>`).join('')}</tr><tr class="rr-pct"><td></td><td colspan="3">Percentage</td><td></td><td></td>${showQc?`<td class="num rr-g">${pct(t.pass,qcTotal)}</td><td class="num">${pct(t.fail,qcTotal)}</td>`:''}${RES.map(([k],j)=>`<td class="num${j?'':' rr-g'}">${pct(t[k],resTotal)}</td>`).join('')}${(test?[]:RR_TESTS).map((k,j)=>`<td class="num${j?'':' rr-g'}">${pct(t[k],t.samples)}</td>`).join('')}</tr>`;
  if(mode==='qc'){
   // "Sample processing QC check" template: every percentage is out of the embryos of the runs
   // that have that data (all of them for a typed QC report, so 1,219 / 1,300 = 93.76%).
   const qcRows=rows.filter(r=>r.qc),resRows=rows.filter(r=>r.res),qcBase=sum(qcRows,r=>r.samples),resBase=sum(resRows,r=>r.samples);
   const qcCols=['S.No','Date','Batch','Embryos','Sequencer','QC pass','QC fail','Euploid','Aneuploid','Mosaic','Inconclusive'];
   const qtr=(r,i)=>`<tr${r.live?` data-run="${i}" tabindex="0" class="rr-link" title="Open this run"`:''}><td class="num muted">${i+1}</td><td class="rr-date">${escapeHtml(r.date||'—')}</td><td class="strong">${batch(r)}${tag(r)}</td><td class="num strong">${num(r.samples)}</td><td>${escapeHtml(r.platform||'—')}</td><td class="num rr-g rr-pass">${num(r.qc?.pass)}</td><td class="num rr-fail">${num(r.qc?.fail)}</td><td class="num rr-g rr-euploid">${num(r.res?.euploid)}</td><td class="num rr-aneuploid">${num(r.res?.aneuploid)}</td><td class="num rr-mosaic">${num(r.res?.mosaic)}</td><td class="num rr-inconclusive">${num(r.res?.inconclusive)}</td></tr>`;
   const qfoot=`<tr class="rr-total"><td></td><td colspan="2">Total</td><td class="num">${num(t.samples)}</td><td></td><td class="num rr-g">${num(t.pass)}</td><td class="num">${num(t.fail)}</td><td class="num rr-g">${num(t.euploid)}</td><td class="num">${num(t.aneuploid)}</td><td class="num">${num(t.mosaic)}</td><td class="num">${num(t.inconclusive)}</td></tr><tr class="rr-pct"><td></td><td colspan="4">Percentage</td><td class="num rr-g">${pct(t.pass,qcBase)}</td><td class="num">${pct(t.fail,qcBase)}</td><td class="num rr-g">${pct(t.euploid,resBase)}</td><td class="num">${pct(t.aneuploid,resBase)}</td><td class="num">${pct(t.mosaic,resBase)}</td><td class="num">${pct(t.inconclusive,resBase)}</td></tr>`;
   const qnotes=[test&&rows.some(r=>r.noSplit)?`The typed monthly report only records how many ${escapeHtml(test)} embryos each run had - QC and results by test show as “—” for those runs.`:'',qcRows.length<rows.length?`${rows.length-qcRows.length} of ${rows.length} runs have no QC data (no QC report or result file) - shown as “—” and left out of the percentages.`:''].filter(Boolean);
   const qcCard=(label,v,cls,base)=>`<div class="rr-stat ${cls}"><strong>${num(v)}</strong><span>${label}</span><small>${pct(v,base)}</small></div>`;
   body.innerHTML=`<div class="rr-top"><div class="rr-stats">${stat(test?`${escapeHtml(test)} embryos`:'Embryos',t.samples)}${qcCard('QC pass',t.pass,'rr-pass',qcBase)}${qcCard('QC fail',t.fail,'rr-fail',qcBase)}</div>${resultsCard}</div>${qnotes.length?`<div class="rr-notes">${qnotes.map(n=>`<p>${n}</p>`).join('')}</div>`:''}
    <div class="rr-wrap"><table class="rr-table"><thead><tr class="rr-groups"><th colspan="5">Sample processing</th><th colspan="2" class="rr-g">QC check</th><th colspan="4" class="rr-g">Results</th></tr><tr>${qcCols.map((c,j)=>`<th class="${j===3||j>=5?'num':''}${c==='QC pass'||c==='Euploid'?' rr-g':''}">${c}</th>`).join('')}</tr></thead><tbody>${rows.map(qtr).join('')}</tbody><tfoot>${qfoot}</tfoot></table></div>`;
   body.querySelectorAll('[data-run]').forEach(el=>{const go=()=>openRun(rows[+el.dataset.run].live);el.onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()}});
   $('#rrExport').onclick=()=>{const v=x=>x==null?'':x,lines=rows.map((r,i)=>[i+1,r.date,r.runId?`RUN ${r.runId}`:'',v(r.samples),r.platform,v(r.qc?.pass),v(r.qc?.fail),v(r.res?.euploid),v(r.res?.aneuploid),v(r.res?.mosaic),v(r.res?.inconclusive)]);lines.push(['','Total','',v(t.samples),'',v(t.pass),v(t.fail),v(t.euploid),v(t.aneuploid),v(t.mosaic),v(t.inconclusive)],['','Percentage','','','',pct(t.pass,qcBase),pct(t.fail,qcBase),pct(t.euploid,resBase),pct(t.aneuploid,resBase),pct(t.mosaic,resBase),pct(t.inconclusive,resBase)]);rrSaveXlsx([qcCols,...lines],`qc-check-${month}${test?'-'+test.replace(/[^A-Z0-9]+/gi,''):''}`)};
   return}
  body.innerHTML=`<div class="rr-top"><div class="rr-stats">${stat('Runs',rows.length)}${stat('Patients',t.patients)}${stat(test?`${escapeHtml(test)} embryos`:'Embryos',t.samples)}</div>${resultsCard}</div>${notes.length?`<div class="rr-notes">${notes.map(n=>`<p>${n}</p>`).join('')}</div>`:''}
   <div class="rr-wrap"><table class="rr-table"><thead><tr class="rr-groups"><th colspan="4">Run</th><th colspan="2">Volume</th>${showQc?'<th colspan="2" class="rr-g">QC</th>':''}<th colspan="4" class="rr-g">Results</th>${test?'':'<th colspan="4" class="rr-g">Tests</th>'}</tr><tr>${cols.map((c,j)=>`<th class="${j>=4?'num':''}${['QC pass','Euploid','PGT A'].includes(c)?' rr-g':''}">${c}</th>`).join('')}</tr></thead><tbody>${rows.map(tr).join('')}</tbody><tfoot>${foot}</tfoot></table></div>`;
  body.querySelectorAll('[data-run]').forEach(el=>{const go=()=>openRun(rows[+el.dataset.run].live);el.onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()}});
  $('#rrExport').onclick=()=>{const v=x=>x==null?'':x,lines=rows.map((r,i)=>[i+1,r.date,r.runId?`RUN ${r.runId}`:'',r.platform,v(r.patients),v(r.samples),...(showQc?[v(r.qc?.pass),v(r.qc?.fail)]:[]),v(r.res?.euploid),v(r.res?.aneuploid),v(r.res?.mosaic),v(r.res?.inconclusive),...(test?[]:RR_TESTS).map(k=>r.tests?r.tests[k]||0:'')]);lines.push(['','Total','','',v(t.patients),v(t.samples),...(showQc?[v(t.pass),v(t.fail)]:[]),v(t.euploid),v(t.aneuploid),v(t.mosaic),v(t.inconclusive),...(test?[]:RR_TESTS).map(k=>v(t[k]))],['','Percentage','','','','',...(showQc?[pct(t.pass,qcTotal),pct(t.fail,qcTotal)]:[]),...RES.map(([k])=>pct(t[k],resTotal)),...(test?[]:RR_TESTS).map(k=>pct(t[k],t.samples))]);rrSaveXlsx([cols,...lines],`run-report-${month}${test?'-'+test.replace(/[^A-Z0-9]+/gi,''):''}`)}};
 const go=m=>{month=m;sel.dataset.keep=m;draw()};
 sel.onchange=()=>go(sel.value);
 $('#rrMode').onchange=e=>{mode=e.target.value;draw()};
 [['#rrRun',v=>runF=v],['#rrSeq',v=>seqF=v],['#rrTest',v=>test=v],['#rrRes',v=>resF=v]].forEach(([id,set])=>{$(id).onchange=e=>{set(e.target.value);draw()}});
 $('#rrClearFilters').onclick=()=>{runF=seqF=test=resF='';draw()};
 $('#rrPrev').onclick=()=>{const i=months.indexOf(month);if(i<months.length-1)go(months[i+1])};
 $('#rrNext').onclick=()=>{const i=months.indexOf(month);if(i>0)go(months[i-1])};
 draw()}

// Every file the app saves to the user's computer (registry, overdue, run report exports...) goes in the activity log.
(function logDownloads(){const orig=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){try{if(this.download&&String(this.href).startsWith('blob:'))fetch('/api/log-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{file:this.download}})}).catch(()=>{})}catch(e){}return orig.apply(this,arguments)}})();

// Run status page: report preparation / re-biopsy cards and the Samples button.
(function(){
 const go=(id,view)=>{const el=document.getElementById(id);if(!el)return;el.addEventListener('click',()=>showView(view));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showView(view)}})};
 go('homeReportPrepCard','reportprep');go('homeRebiopsyCard','rebiopsy');
 const src=document.getElementById('caseCount'),dst=document.getElementById('caseCount2');
 if(src&&dst){const mirror=()=>{dst.textContent=src.textContent};new MutationObserver(mirror).observe(src,{childList:true,characterData:true,subtree:true});mirror()}
})();

// Back button on every page: the top bar's Back returns to the page you came from. It is hidden only on the page you landed on (nothing to go back to).
(function(){
 const orig=showView;let cur=null;const stack=[];
 window.showView=function(view,backing){
  if(!backing&&cur&&cur!==view){if(stack[stack.length-1]!==cur)stack.push(cur);if(stack.length>30)stack.shift()}
  cur=view;orig(view);
  const t=document.getElementById('topBack');if(t)t.classList.toggle('hidden',!stack.length);
  const o=document.getElementById('backBtn');if(o)o.classList.toggle('hidden',!stack.length||['dashboard','home','pgtm','runreports','followup','trfs','fuTasks','fuDash'].includes(view)||(!isStaff()&&['samples','cases','images'].includes(view))||view==='run')};
 const go=()=>{const prev=stack.pop();if(prev)window.showView(prev,true)};
 const t=document.getElementById('topBack');if(t)t.onclick=go;
 const o=document.getElementById('backBtn');if(o)o.onclick=go;
})();

// Keep the headers fixed: the sticky page header and the Run status count cards sit just below the top bar, whatever its height.
(function(){
 const bar=document.querySelector('.topbar');if(!bar)return;
 const set=()=>document.documentElement.style.setProperty('--topbar-h',bar.offsetHeight+'px');
 set();window.addEventListener('resize',set);if(window.ResizeObserver)new ResizeObserver(set).observe(bar);
})();

// Run reports: decorate the KPI tiles, result legend, table headings and buttons with the icon library.
(function(){
 const I=n=>`<img class="ico rr-ic" src="/static/icons/${n}.png" alt="">`;
 const MAP={'runs':'run-summary__runs','run':'run-summary__runs','batch':'run-summary__runs','patients':'run-summary__patients','samples':'run-summary__samples','volume':'run-summary__samples','sequencer':'run-summary__sequencers',
  'qc':'stages-results__qc-pass','qc pass':'stages-results__qc-pass','qc fail':'stages-results__qc-fail','results':'navigation__embryo-results','euploid':'stages-results__normal','aneuploid':'stages-results__abnormal','mosaic':'stages-results__mosaic','inconclusive':'stages-results__inconclusive',
  'tests':'tests-transfers__pgt-a','pgt a':'tests-transfers__pgt-a','pgt a+m':'tests-transfers__pgt-m','poc':'tests-transfers__poc','pgt sr':'tests-transfers__pgt-sr','embryos':'run-summary__samples','embryologists':'navigation__patient','embryologist':'navigation__patient'};
 const key=t=>String(t||'').trim().toLowerCase().replace(/\s+(samples|embryos)$/,'').replace(/\s+/g,' ');
 let busy=false;
 const run=()=>{if(busy)return;busy=true;try{
  const root=document.getElementById('genericView');if(!root||!root.querySelector('#rrBody'))return;
  // (no icons inside the table headings - the tables are exported)
  root.querySelectorAll('#rrBody .rr-stat:not([data-ic])').forEach(el=>{el.dataset.ic='1';const k=MAP[key(el.querySelector('span')?.textContent)];if(k)el.insertAdjacentHTML('beforeend',`<img class="ico rr-stat-ic" src="/static/icons/${k}.png" alt="">`)});
  root.querySelectorAll('#rrBody .rr-leg:not([data-ic])').forEach(el=>{el.dataset.ic='1';const k=MAP[key(el.querySelector('span')?.textContent)];if(k)el.insertAdjacentHTML('afterbegin',`<img class="ico rr-leg-ic" src="/static/icons/${k}.png" alt="">`)});
  const ex=root.querySelector('#rrExport');if(ex&&!ex.dataset.ic){ex.dataset.ic='1';ex.innerHTML='<img class="ico btn-ico-img" src="/static/icons/navigation__download-export.png" alt="">Download Excel'}
 }finally{busy=false}};
 const g=document.getElementById('genericView');if(g)new MutationObserver(run).observe(g,{childList:true,subtree:true});
})();


// ---------------- User management (admin / senior executive) ----------------
const ROLE_LABELS={admin:'Admin',senior_executive:'Senior executive',team_lead:'Team lead',member:'Member',coordinator:'Coordinator',embryologist:'Embryologist'};
const ROLE_NOTES={admin:'Full access, edits results, manages users',senior_executive:'Same access as admin',team_lead:'Views all sheets, uploads results, images and protocols; cannot edit results',member:'Samples, PGT-M, cases and image vault only',coordinator:'Home page only: status cards and sample list (read-only)',embryologist:'Own follow-up tasks and TRFs'};
function usersMarkup(){return `<section class="users-admin"><div class="users-head"><div><h3>Logins</h3><span id="usersCount" class="users-count"></span></div><div class="users-tools"><input id="usersSearch" type="search" placeholder="Search users…" autocomplete="off"><button type="button" class="primary compact" id="userAddBtn">Add user</button></div></div><div class="users-form hidden" id="userForm"></div><div id="usersList"><div class="chart-empty">Loading…</div></div></section>`}
async function setupUsersView(){
 const listEl=$('#usersList'),formEl=$('#userForm');let data={roles:[],users:[]};
 const roleOpts=sel=>data.roles.map(r=>`<option value="${r}"${r===sel?' selected':''}>${ROLE_LABELS[r]||r}</option>`).join('');
 const api=async(url,method,body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Request failed');return j};
 const draw=()=>{const q=($('#usersSearch')?.value||'').trim().toLowerCase(),shown=data.users.filter(u=>!q||u.username.includes(q)||(ROLE_LABELS[u.role]||'').toLowerCase().includes(q)),linked=data.users.some(u=>u.name||u.client);$('#usersCount').textContent=`${data.users.length} ${data.users.length===1?'person':'people'}`;
  listEl.innerHTML=`<div class="users-table-wrap"><table class="users-table"><thead><tr><th>User</th><th>Role</th>${linked?'<th>Linked to</th>':''}<th></th></tr></thead><tbody>${shown.map(u=>{const me=u.username===currentUser.username;return `<tr data-u="${escapeHtml(u.username)}"><td class="user-col"><div class="user-cell"><span class="user-avatar">${escapeHtml(u.username.slice(0,2).toUpperCase())}</span><strong>${escapeHtml(u.username)}</strong>${me?'<em class="user-you">you</em>':''}</div></td><td><div class="user-role"><select class="user-role-sel" aria-label="Role of ${escapeHtml(u.username)}">${roleOpts(u.role)}</select><span class="user-role-note">${escapeHtml(ROLE_NOTES[u.role]||'')}</span></div></td>${linked?`<td class="user-link">${escapeHtml([u.name,u.client&&('centre: '+u.client)].filter(Boolean).join(' · '))||'<span class="user-dash">—</span>'}</td>`:''}<td class="user-actions"><button type="button" class="user-act user-pw">Reset password</button><button type="button" class="user-act user-del"${me?' disabled title="You cannot remove your own login"':''}>Remove</button></td></tr>`}).join('')||'<tr><td colspan="4" class="chart-empty">No users match.</td></tr>'}</tbody></table></div>`;
  listEl.querySelectorAll('tr[data-u]').forEach(tr=>{const name=tr.dataset.u;
   tr.querySelector('.user-role-sel').onchange=async e=>{try{await api('/api/users/'+encodeURIComponent(name),'PATCH',{role:e.target.value});toast(`${name} is now ${ROLE_LABELS[e.target.value]}`);await load()}catch(err){toast(err.message);await load()}};
   tr.querySelector('.user-pw').onclick=async()=>{const pw=prompt(`New password for ${name} (min 6 characters):`);if(!pw)return;try{await api('/api/users/'+encodeURIComponent(name),'PATCH',{password:pw});toast('Password updated')}catch(err){toast(err.message)}};
   tr.querySelector('.user-del').onclick=async()=>{if(!confirm(`Remove ${name}? They will no longer be able to sign in.`))return;try{await api('/api/users/'+encodeURIComponent(name),'DELETE');toast('User removed');await load()}catch(err){toast(err.message)}}})};
 const load=async()=>{try{data=await api('/api/users','GET');draw()}catch(err){listEl.innerHTML=`<div class="chart-empty">${escapeHtml(err.message||'Could not load users.')}</div>`}};
 $('#userAddBtn').onclick=()=>{formEl.classList.toggle('hidden');if(formEl.classList.contains('hidden'))return;formEl.innerHTML=`<input id="nuName" placeholder="Username" autocomplete="off"><input id="nuPass" type="text" placeholder="Password (min 6)" autocomplete="off"><select id="nuRole" class="chart-filter">${roleOpts('member')}</select><input id="nuSheet" placeholder="Sheet embryologist name (embryologist only)"><input id="nuClient" placeholder="Centre name (optional)"><button type="button" class="primary compact" id="nuSave">Create</button>`;
  $('#nuSave').onclick=async()=>{try{await api('/api/users','POST',{username:$('#nuName').value,password:$('#nuPass').value,role:$('#nuRole').value,name:$('#nuSheet').value,client:$('#nuClient').value});toast('User added');formEl.classList.add('hidden');await load()}catch(err){toast(err.message)}}};
 $('#usersSearch').oninput=draw;
 load();
}
