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
let monthFilterDefaulted=false;let sortNewestFirst=false;let frozenColumnKeys=new Set();let registryViewMode='patient';
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
function reportStatus(r={}){const has=k=>!!field(r,[k]);return has('attune upload')&&has('ngs report')?'Completed':'Pending'}
function progressStage(r={}){const has=k=>!!field(r,[k]);if(has('date sample received')&&has('wga done on')&&has('seq date')&&has('attune upload')&&has('ngs report'))return 4;if(has('date sample received')&&has('wga done on')&&has('seq date'))return 3;if(has('date sample received')&&has('wga done on'))return 2;if(has('date sample received'))return 1;return 0}
function caseProgressStage(c){const list=c.embryos?.length?c.embryos:[{}];return Math.min(...list.map(progressStage))}
function progressStepper(stage,r={}){const labels=['Received','WGA','Sequencing','Report preparation','Report send'];const dateFields=['date sample received','wga done on','seq date','attune upload','ngs report'];const states=({0:['active','pending','pending','pending','pending'],1:['done','active','pending','pending','pending'],2:['done','done','active','pending','pending'],3:['done','done','done','active','pending']})[stage]||['done','done','done','done','done'];const check='<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';return `<div class="progress-stepper">${labels.map((label,i)=>{const date=states[i]==='done'?field(r,[dateFields[i]]):'';return `${i?`<div class="progress-line ${states[i-1]==='done'?'done':'pending'}"></div>`:''}<div class="progress-step ${states[i]}"><span class="progress-dot">${states[i]==='done'?check:i+1}</span><span class="progress-label">${label}</span>${date?`<span class="progress-date">${escapeHtml(date)}</span>`:''}</div>`}).join('')}</div>`}
function caseMatchesMonth(c,month){if(!month)return true;return c.embryos?.length?c.embryos.some(e=>recordMonth(e)===month):false}
// Each sheet row's own standard test name (a sample can span rows with different tests).
function rowTestName(e){return canonicalTestName(field(e,['test name','test']))||'Not recorded'}
function filteredCases(){const keys=['embryologist','client','region','result'],test=$('#testFilter')?.value||'',q=$('#patientSearch').value.toLowerCase(),
  // Searching means "I don't know which month sheet this is in" - so a search term
  // overrides the month filter instead of being narrowed by it, across every sheet.
  month=q?'':($('#samplesMonthFilter')?.value||''),storage=$('#storageFilter')?.value||'',transfer=$('#transferFilter')?.value||'',report=$('#reportStatusFilter')?.value||'';return cases.filter(c=>(!q||(c.patient+' '+c.id+' '+c.test+' '+c.client).toLowerCase().includes(q))&&keys.every(k=>!$(`#${k}Filter`).value||c[k]===$(`#${k}Filter`).value)&&(!test||(c.embryos?.length?c.embryos.some(e=>rowTestName(e)===test):c.test===test))&&caseMatchesMonth(c,month)&&(!storage||c.embryos?.some(e=>storageInfo(e).status===storage))&&(!transfer||c.embryos?.some(e=>transferInfo(e).status===transfer))&&(!report||(report==='prep'?c.embryos?.some(e=>isReportPrep(e)):c.embryos?.some(e=>reportStatus(e)===report))))}
// DNA readings are stored per sample as "AS1: 18.8, AS2: 25"; an embryo row shows only its own.
const DNA_FIELDS=['dna conc unpurified','dna conc purified','dna conc'];
function ownDnaValue(text,embryo){const t=String(text||'').trim();if(t==='-')return'-';const want=cleanId(embryo),num=(/(\d+)\D*$/.exec(String(embryo))||[])[1];for(const part of t.split(',')){const m=/^\s*([^:]+):\s*(.+?)\s*$/.exec(part);if(!m)continue;const tag=m[1].trim();if(cleanId(tag)===want||(/^\d+$/.test(tag)&&num&&Number(tag)===Number(num)))return m[2]}return''}
function withOwnDna(e){const name=field(e,['embryo name','embryo id']),out={...e};delete out['wga conc'];DNA_FIELDS.forEach(f=>{if(f in out)out[f]=ownDnaValue(out[f],name)});return out}
// Purified DNA conc. shows the result file's WGA conc., which only the Inconclusive tab
// carries, per embryo ("SV1: 0.157, SV2: -"); embryos without one show "-". The sheet's
// "DNA Conc." stays in the unpurified column.
function withResultDna(r){const out={...r};delete out['wga conc'];const own=r._embryoResults||{},vals=expandEmbryoTags(field(r,['embryo name','embryo id'])).map(t=>[t,String(own[t]?.['wga conc']||'').trim()]);out['dna conc purified']=vals.some(([,v])=>v)?vals.map(([t,v])=>`${t}: ${v||'-'}`).join(', '):'-';return out}
// Karyotype column for the registry: each embryo's own call (MWF for a normal/mosaic
// result, NORMAL WF for abnormal - same priority as the patient dialog), one per tag.
function withKaryotype(r){const out={...r},own=r._embryoResults||{},vals=expandEmbryoTags(field(r,['embryo name','embryo id'])).map(t=>[t,String(own[t]?.['karyotype mwf']||own[t]?.['karyotype normal wf']||'').trim()]);out['karyotype']=vals.some(([,v])=>v)?vals.map(([t,v])=>`${t}: ${v||'-'}`).join(', '):'-';return out}
function embryoDataset(){const q=$('#patientSearch')?.value.toLowerCase()||'',month=q?'':($('#samplesMonthFilter')?.value||''),test=$('#testFilter')?.value||'';const rows=filteredCases().flatMap(c=>(c.embryos?.length?c.embryos.filter(e=>(!month||recordMonth(e)===month)&&(!test||rowTestName(e)===test)):[{}]).map((e,i)=>({case:c,embryo:e,identity:c.embryos?.length?resultIdentity(e):{embryo:`Sample ${i+1}`},outcome:e._outcome||c.result})));
  const expanded=registryViewMode==='embryo'?rows.flatMap(x=>{const variants=expandEmbryoRow(x.embryo);if(variants.length<=1)return[x];const numKey=Object.keys(x.embryo).find(k=>k.includes('number of embryos'));return variants.map(v=>{const own=withOwnDna(v);return {...x,embryo:numKey?{...own,[numKey]:'1'}:own}})}):rows;
  return expanded.sort((a,b)=>(a.embryo._seq??0)-(b.embryo._seq??0))}
const MIN_COLUMN_FILL_RATE=0.10,ALWAYS_SHOW_COLUMNS=new Set(['hospital clinic name']),PINNED_COLUMNS=['dna conc unpurified','dna conc purified','embryo grade','karyotype','pgt result','transferred','transfer details'];
function embryoColumns(rows){const seen=new Set(),cols=[];rows.forEach(x=>Object.keys(x.embryo||{}).forEach(k=>{if(k.startsWith('_')||seen.has(k))return;seen.add(k);cols.push(k)}));PINNED_COLUMNS.forEach(k=>{if(!seen.has(k)){seen.add(k);cols.push(k)}});const total=rows.length||1;let filtered=cols.filter(k=>{if(PINNED_COLUMNS.includes(k))return true;const filled=rows.reduce((n,x)=>n+(String(x.embryo?.[k]??'').trim()!==''?1:0),0);return filled>0&&(ALWAYS_SHOW_COLUMNS.has(k)||/dna.*conc|conc.*dna|pgt result|embryo grade|wga conc/.test(k)||filled/total>=MIN_COLUMN_FILL_RATE)});const reorder=(afterPattern,keyPattern)=>{const afterKey=filtered.find(k=>afterPattern.test(k)),movedKey=filtered.find(k=>keyPattern.test(k));if(afterKey&&movedKey&&afterKey!==movedKey){filtered=filtered.filter(k=>k!==movedKey);filtered.splice(filtered.indexOf(afterKey)+1,0,movedKey)}};reorder(/embryo name|embryo id/,/dna conc unpurified/);reorder(/dna conc unpurified/,/dna conc purified/);reorder(/dna conc purified/,/^embryo grade$/);reorder(/^embryo grade$/,/^karyotype$/);reorder(/^karyotype$/,/pgt result/);reorder(/^transferred$/,/^transfer details$/);return filtered}
const PIN_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
function fitTableHeight(el){if(!el)return;const top=el.getBoundingClientRect().top;let h=Math.max(240,window.innerHeight-top-24);el.style.maxHeight=`${h}px`;const overflow=document.documentElement.scrollHeight-window.innerHeight;if(overflow>0){h=Math.max(240,h-overflow);el.style.maxHeight=`${h}px`}}
window.addEventListener('resize',()=>{fitTableHeight($('#caseTable .embryo-columns-table'));fitTableHeight($('#rebiopsyTableWrap'))});
function renderCases(){const datasetRows=embryoDataset(),rows=sortNewestFirst?[...datasetRows].reverse():datasetRows,empty='<div class="empty-action"><h3>No records available</h3><p>Import the monthly register and embryo result files, or clear the current filters.</p><button class="primary" data-view="import">Import data</button></div>',naturalCols=embryoColumns(rows),cols=[...naturalCols.filter(k=>frozenColumnKeys.has(k)),...naturalCols.filter(k=>!frozenColumnKeys.has(k))],chipCols=new Set(['sample id','box number','case id']);if($('#registryCount'))$('#registryCount').textContent=rows.length?`· ${rows.length.toLocaleString()} records`:'';const caseCountEl=$('#caseCount');if(caseCountEl)caseCountEl.textContent=registryViewMode==='embryo'?allEmbryos().flatMap(expandEmbryoRow).length:allEmbryos().length;$('#caseTable').innerHTML=`<div class="embryo-columns-table"><table><thead><tr>${cols.map(k=>`<th>${escapeHtml(k.toUpperCase())}<button class="col-freeze-btn${frozenColumnKeys.has(k)?' pinned':''}" data-freeze-col="${escapeHtml(k)}" title="${frozenColumnKeys.has(k)?'Unfreeze this column':'Freeze this column'}">${PIN_ICON}</button></th>`).join('')}</tr></thead><tbody>${rows.map(x=>{const focus=registryViewMode==='embryo'?embryoDisplayId(x.embryo):'';return `<tr data-case="${escapeHtml(x.case.id)}"${focus?` data-embryo-focus="${escapeHtml(focus)}"`:''}>${cols.map(k=>{const v=String(x.embryo[k]??'');if(chipCols.has(k))return `<td>${v?`<span class="id-chip">${escapeHtml(v)}</span>`:''}</td>`;return `<td${v.length>40?` class="wrap-cell" title="${escapeHtml(v)}"`:''}>${escapeHtml(v)}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div>`+(rows.length?'':empty);$$('[data-case]').forEach(r=>r.onclick=()=>openPatient(cases.find(c=>c.id===r.dataset.case),r.dataset.embryoFocus||''));$$('#caseTable [data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));$$('#caseTable [data-freeze-col]').forEach(b=>b.onclick=e=>{e.stopPropagation();const k=b.dataset.freezeCol;if(frozenColumnKeys.has(k))frozenColumnKeys.delete(k);else frozenColumnKeys.add(k);renderCases()});applyColumnFreeze($('#caseTable'),frozenColumnKeys.size);const freezeBtn=$('#freezeToggle');if(freezeBtn){freezeBtn.classList.toggle('active',frozenColumnKeys.size>0);$('#freezeToggleLabel').textContent=frozenColumnKeys.size?`Freeze columns (${frozenColumnKeys.size})`:'Freeze columns'}updateFiltersBadge();fitTableHeight($('#caseTable .embryo-columns-table'))}
function updateFiltersBadge(){const ids=['samplesMonthFilter','testFilter','clientFilter','embryologistFilter','regionFilter','resultFilter','storageFilter','transferFilter','reportStatusFilter'],active=ids.filter(id=>$(`#${id}`)?.value).length,badge=$('#filtersBadge');if(!badge)return;badge.textContent=active;badge.classList.toggle('has-active',active>0)}
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
async function importedCases(){const rows=((await kvGet('embryomatrix-imported-cases'))||[]).filter(r=>!r._stale).map(withResultDna).map(withKaryotype),clientCounts={},resolved=new Map();for(const r of rows){const res=clientFromDirectory(r);if(res){resolved.set(r,res);continue}const c=normalizeClientName(field(r,['center name','hospital clinic name','client']));if(c)clientCounts[c]=(clientCounts[c]||0)+1}const clientCanonical=buildClientCanonicalMap(clientCounts),groups=new Map;for(const r of rows){const patient=field(r,['patient name','patient'])||resultIdentity(r).patient||'Unnamed patient',caseId=field(r,['case id']),sampleId=field(r,['sample id','sample no','box number']),received=field(r,['date sample received']),center=field(r,['center name','hospital clinic name','client']),embryoTag=field(r,['embryo name','embryo id','embryo']),id=caseId||sampleId||`IM-${groups.size+1}`,uniquePart=cleanId(caseId||sampleId||'')||cleanId(`${center||''}${received||''}${embryoTag||''}`)||`AUTO${groups.size+1}`,key=`${patient.toLowerCase().replace(/\s+/g,'')}|${uniquePart}`;if(!groups.has(key))groups.set(key,{id,patient,embryologist:field(r,['embryologist name','embryologist'])||'Not assigned',...caseClientFields(resolved.get(r),clientCanonical[normalizeClientName(field(r,['center name','hospital clinic name','client']))]),test:canonicalTestName(field(r,['test name','test']))||'Not recorded',region:field(r,['location','region'])||'Not assigned',result:'Normal',samples:0,images:0,nabl:field(r,['nabl'])||'Pending',source:'Merged',embryos:[]});const c=groups.get(key),outcome=clinicalOutcome(r);if(c.test==='Not recorded'){const t=canonicalTestName(field(r,['test name','test']));if(t)c.test=t}c.samples++;c.embryos.push({...r,_outcome:outcome});if(outcome==='Inconclusive')c.result='Inconclusive';else if(['Abnormal','Fail'].includes(outcome)&&c.result!=='Inconclusive')c.result=outcome}return [...groups.values()]}
async function setupCases(){cases=[...cases.filter(c=>c.source!=='Merged'),...await importedCases()];$('#caseCount').textContent=allEmbryos().length;['embryologist','client','test','region'].forEach(k=>{const s=$(`#${k}Filter`);s.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());[...new Set(cases.map(c=>c[k]))].sort().forEach(v=>s.add(new Option(v,v)));s.onchange=()=>renderCases()});const ss=$('#storageFilter'),storageSelected=ss.value;ss.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());const statuses=[...new Set(cases.flatMap(c=>(c.embryos||[]).map(e=>storageInfo(e).status)))].sort();statuses.forEach(v=>ss.add(new Option(v,v)));ss.value=statuses.includes(storageSelected)?storageSelected:'';ss.onchange=()=>renderCases();const ts=$('#transferFilter'),transferSelected=ts.value;ts.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());const transferStatuses=[...new Set(cases.flatMap(c=>(c.embryos||[]).map(e=>transferInfo(e).status)))].sort();transferStatuses.forEach(v=>ts.add(new Option(v,v)));ts.value=transferStatuses.includes(transferSelected)?transferSelected:'';ts.onchange=()=>renderCases();const sms=$('#samplesMonthFilter');let samplesSelected=sms?.value||'';const monthValues=cases.flatMap(c=>(c.embryos||[]).map(recordMonth)).filter(Boolean);const months=[...[...new Set(monthValues.filter(isDateMonth))].sort(),...new Set(monthValues.filter(v=>!isDateMonth(v)))];if(!monthFilterDefaulted){monthFilterDefaulted=true;if(months.includes('Pending'))samplesSelected='Pending'}if(sms){sms.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());months.forEach(v=>sms.add(new Option(monthLabel(v),v)));sms.value=months.includes(samplesSelected)?samplesSelected:'';sms.onchange=()=>renderCases()}const CHART_RENDERERS={volumeMonthFilter:renderVolumeChart,testMonthFilter:renderTestChart,outcomeMonthFilter:renderOutcomeChart,clientMonthFilter:renderClientChart,regionMonthFilter:renderRegionChart,platformMonthFilter:renderPlatformChart,qualityMonthFilter:renderQualitySection};Object.entries(CHART_RENDERERS).forEach(([id,renderFn])=>{const sel=$(`#${id}`);if(!sel)return;const current=sel.value;sel.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());months.forEach(v=>sel.add(new Option(monthLabel(v),v)));sel.value=months.includes(current)?current:'';sel.onchange=()=>renderFn(overviewRows())});const clientLegendEl=$('#clientLegend');if(clientLegendEl)clientLegendEl.onclick=e=>{const row=e.target.closest('.legend-row');if(!row)return;toggleLegendSlice(row.dataset.pieId,row.dataset.label,()=>renderClientChart(allEmbryos()))};$('#resultFilter').onchange=()=>renderCases();$('#reportStatusFilter').onchange=()=>renderCases();const prepCard=$('#reportPrepCard');if(prepCard){const openPrep=()=>showView('reportprep');prepCard.onclick=openPrep;prepCard.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPrep()}}}$('#patientSearch').oninput=()=>renderCases();$('#clearFilters').onclick=()=>{['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';if(sms)sms.value='';renderCases()};$('#downloadCsv').onclick=e=>{e.stopPropagation();$('#exportMenu').classList.toggle('hidden')};$('#exportMenu').onclick=e=>{const b=e.target.closest('[data-format]');if(!b)return;downloadRegistry(b.dataset.format);$('#exportMenu').classList.add('hidden')};$('#sortToggle').onclick=()=>{sortNewestFirst=!sortNewestFirst;$('#sortToggleLabel').textContent=sortNewestFirst?'Reversed':'Sheet order';renderCases()};$('#freezeToggle').onclick=()=>{frozenColumnKeys.clear();renderCases()};$('#filtersToggle').onclick=e=>{e.stopPropagation();$('#filtersPanel').classList.toggle('hidden');$('#filtersToggle').classList.toggle('active');fitTableHeight($('#caseTable .embryo-columns-table'))};$('#filtersPanel').onclick=e=>e.stopPropagation();const viewToggle=$('#registryViewToggle');if(viewToggle)viewToggle.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;registryViewMode=b.dataset.mode;viewToggle.querySelectorAll('.prep-seg').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b))});renderCases()};renderCases();renderAnalytics()}
function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`}
function exportDataset(){const rows=embryoDataset(),cols=embryoColumns(rows);return{headers:cols.map(k=>k.toUpperCase()),rows:rows.map(x=>cols.map(k=>x.embryo[k]??''))}}
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
function renderTestNameGrid(id,entries){const el=$(id);if(!el)return;if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}el.innerHTML=entries.map(([name,count])=>`<div class="test-name-item test-color-${testColorFamily(name)}" data-test="${escapeHtml(name)}"><span class="test-name-dot"></span><span class="test-name-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="test-name-count">${count.toLocaleString()}</span></div>`).join('');el.onclick=e=>{const item=e.target.closest('[data-test]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value='';$('#testFilter').value=item.dataset.test;showView('cases');renderCases()}}
function renderNameCountList(id,entries,filterId){const el=$(id);if(!el)return;if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}const max=Math.max(1,...entries.map(([,v])=>v));el.innerHTML=`<div class="rank-list">${entries.map(([name,count],i)=>`<div class="rank-row" data-name="${escapeHtml(name)}"><span class="rank-index${i<3?' rank-top':''}">${i+1}</span><span class="rank-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="rank-bar-track"><span class="rank-bar-fill" style="width:${Math.max(2,count/max*100)}%"></span></span><span class="rank-count">${count.toLocaleString()}</span></div>`).join('')}</div>`;el.onclick=e=>{const item=e.target.closest('[data-name]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>$(`#${k}Filter`).value='');$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value='';$(`#${filterId}`).value=item.dataset.name;showView('cases');renderCases()}}
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
  const hole=pie.querySelector('.pie-hole');if(hole){const sl=label&&[...pie.querySelectorAll('.pie-slice')].find(n=>n.dataset.label===label);hole.classList.toggle('focus',!!sl);hole.innerHTML=sl?`<strong>${Number(sl.dataset.value).toLocaleString()}</strong><span class="hole-name">${escapeHtml(label)}</span><span>${sl.dataset.pct}% of ${escapeHtml(pie.dataset.centerLabel||'samples')}</span>`:`<strong>${Number(pie.dataset.total||0).toLocaleString()}</strong><span>${escapeHtml(pie.dataset.centerLabel||'samples')}</span>`}
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
function allClientsMarkup(){return `<div class="ac-kpis" id="acKpis"></div><div class="ac-top3" id="acTop3"></div><section class="ac-panel"><div class="ac-toolbar"><div class="ac-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="acSearch" type="search" placeholder="Search clients or branches…" aria-label="Search clients or branches"></div><div class="ac-total" id="acTotal" aria-live="polite"></div><div class="prep-segments" id="acSort" role="tablist"><button type="button" class="prep-seg active" data-sort="desc">Most samples</button><button type="button" class="prep-seg" data-sort="asc">Fewest</button><button type="button" class="prep-seg" data-sort="az">A–Z</button></div><select id="acMonth" class="chart-filter" aria-label="Filter clients by month"><option value="">All months</option></select></div><div class="ac-scope prep-segments" id="acScope" role="tablist" aria-label="Client list coverage"></div><div class="ac-head" aria-hidden="true"><span>#</span><span>Client</span><span>Volume</span><span>Samples</span><span></span></div><div class="ac-list" id="acList"></div><div class="ac-foot" id="acFoot"></div></section>`}
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
 const openClient=name=>{['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>{const el=$(`#${k}Filter`);if(el)el.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=monthSel.value||'';const cf=$('#clientFilter');if(cf){if(![...cf.options].some(o=>o.value===name))cf.add(new Option(name,name));cf.value=name}showView('cases');renderCases()};
 const toggle=name=>{open.has(name)?open.delete(name):open.add(name);draw()};
 const onPick=e=>{const t=e.target.closest('[data-toggle]');if(t){e.stopPropagation();toggle(t.dataset.toggle);return}if(e.target.closest('.ac-detail'))return;const it=e.target.closest('[data-name]');if(!it)return;const ent=entries.find(x=>x.name===it.dataset.name);if(ent&&!ent.n)toggle(ent.name);else openClient(it.dataset.name)};
 list.onclick=onPick;$('#acTop3').onclick=onPick;list.onkeydown=e=>{if(e.key==='Enter'&&!e.target.closest('[data-toggle]'))onPick(e)};
 sortEl.onclick=e=>{const b=e.target.closest('[data-sort]');if(!b)return;sort=b.dataset.sort;sortEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));draw()};
 scopeEl.onclick=e=>{const b=e.target.closest('[data-scope]');if(!b)return;scope=b.dataset.scope;scopeEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));draw()};
 search.oninput=draw;monthSel.onchange=load;load();
}
// All regions page: ranked table of monthly sample counts per region.
function regionsMarkup(){return `<article class="rg-card rg-wide"><div class="rg-head rg-list-head"><div><small>RANKING</small><h3>All regions</h3><p>Monthly samples for every region · click a number to open those samples</p></div><select id="regionSortOrder" class="chart-filter" aria-label="Sort regions by sample volume"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></div><div id="allRegionChart"></div></article>`}
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
 el.onclick=e=>{const item=e.target.closest('[data-name]');if(!item)return;['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>{const f=$(`#${k}Filter`);if(f)f.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=item.dataset.month||'';const rf=$('#regionFilter');if(rf){if(![...rf.options].some(o=>o.value===item.dataset.name))rf.add(new Option(item.dataset.name,item.dataset.name));rf.value=item.dataset.name}showView('cases');renderCases()};
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
function embryologistQcStats(rows){const byName={};rows.forEach(e=>{const name=e._case.embryologist||'Not assigned';if(name==='Not assigned')return;const verdict=qcVerdict(e),q=byName[name]||(byName[name]={name,total:0,pass:0,fail:0});q.total++;if(verdict==='PASS')q.pass++;else if(verdict==='FAIL')q.fail++});return Object.values(byName).map(q=>({...q,pending:q.total-q.pass-q.fail,successRate:(q.pass+q.fail)?Math.round(q.pass/(q.pass+q.fail)*100):null})).sort((a,b)=>{const aResolved=a.successRate!==null,bResolved=b.successRate!==null;if(aResolved!==bResolved)return aResolved?-1:1;if(aResolved)return b.successRate-a.successRate||b.total-a.total;return b.total-a.total})}
function renderEmbryologistBarChart(id,stats,limit=10){
 const el=$(id);if(!el)return;
 const shown=limit?stats.slice(0,limit):stats;
 if(!shown.length){el.innerHTML=`<div class="chart-empty">No ${unitWord()} in this period.</div>`;return}
 const series=[['pass',QUALITY_GOOD,'QC Pass'],['fail',QUALITY_CRITICAL,'QC Fail'],['pending',QUALITY_PENDING,'Awaiting result']];
 const fitW=Math.max(320,el.clientWidth||760),w=fitW,height=300;
 const padL=48,padR=16,padT=24,padB=76,innerW=w-padL-padR,innerH=height-padT-padB,n=shown.length,groupSlot=innerW/n;
 const gap=4,barW=Math.max(10,Math.min(40,(groupSlot*0.88-gap*(series.length-1))/series.length)),clusterW=barW*series.length+gap*(series.length-1);
 const max=Math.max(1,...shown.flatMap(d=>[d.pass,d.fail,d.pending])),niceMax=niceMaxOf(max);
 const yFor=v=>padT+innerH-(v/niceMax)*innerH;
 const ticks=[0,0.25,0.5,0.75,1].map(t=>Math.round(niceMax*t));
 const grid=ticks.map(t=>{const gy=yFor(t).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="11" fill="#8b968f" text-anchor="end">${t.toLocaleString()}</text>`}).join('');
 const bars=shown.map((d,i)=>{const sx=padL+groupSlot*i,groupCx=sx+groupSlot/2,startX=groupCx-clusterW/2,labelY=height-padB+14;
  const barsSvg=series.map(([key,color],si)=>{const v=d[key],bx=startX+si*(barW+gap),by=yFor(v),bh=Math.max(1,padT+innerH-by);return `<rect class="ch-bar" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"/>`}).join('');
  return `<g class="ch-col" data-col="${i}"><rect class="ch-band" x="${(sx+2).toFixed(1)}" y="${padT-8}" width="${Math.max(0,groupSlot-4).toFixed(1)}" height="${(innerH+8).toFixed(1)}" rx="8"/>${barsSvg}<text class="ch-axis" x="0" y="0" transform="translate(${groupCx.toFixed(1)},${labelY}) rotate(-40)" text-anchor="end" font-size="11" fill="#6b7d76">${escapeHtml(truncateLabel(d.name,16))}</text></g>`}).join('');
 const hits=shown.map((d,i)=>{const sx=padL+groupSlot*i,top=Math.min(...series.map(([key])=>yFor(d[key])));return `<rect class="ch-hit" data-col="${i}" x="${sx.toFixed(1)}" y="0" width="${groupSlot.toFixed(1)}" height="${height}" fill="transparent" data-x="${(sx+groupSlot/2).toFixed(1)}" data-y="${top.toFixed(1)}" data-tip="${chartTipAttr({t:d.name,r:series.map(([key,color,label])=>[color,label,`${d[key].toLocaleString()} (${d.total?Math.round(d[key]/d.total*100):0}%)`]),n:d.successRate!==null&&d.successRate!==undefined?`QC pass rate ${d.successRate}% · ${d.total.toLocaleString()} tests`:`No QC results yet · ${d.total.toLocaleString()} tests`})}"/>`}).join('');
 const baseline=`<line x1="${padL}" y1="${(padT+innerH).toFixed(1)}" x2="${w-padR}" y2="${(padT+innerH).toFixed(1)}" stroke="#c9d3ce" stroke-width="1"/>`;
 const legend=`<div style="display:flex;gap:16px;font-size:11px;color:#52625a;margin-bottom:6px">${series.map(([,color,label])=>`<span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block"></i>${label}</span>`).join('')}</div>`;
 el.innerHTML=legend+`<svg viewBox="0 0 ${w} ${height+24}" width="${w}" height="${height+24}" class="vbar-chart-svg">${grid}${baseline}${bars}${hits}</svg>`;
}
function renderEmbryologistRankList(id,stats){
 const el=$(id);if(!el)return;
 if(!stats.length){el.innerHTML='<div class="chart-empty">No samples in this period.</div>';return}
 const peak=Math.max(1,...stats.map(q=>q.total)),seg=(v,c)=>v?`<span style="width:${(v/peak*100).toFixed(2)}%;background:${c}"></span>`:'';
 const head=`<div class="emb-row emb-head" aria-hidden="true"><span>S.No</span><span>Embryologist</span><span>Samples</span><span>Total</span><span>Passed</span><span>Failed</span><span>Awaiting</span></div>`;
 const legend=`<div class="rg-legend emb-legend"><span><i style="background:${QUALITY_GOOD}"></i>QC Pass</span><span><i style="background:${QUALITY_CRITICAL}"></i>QC Fail</span><span><i style="background:${QUALITY_PENDING}"></i>Awaiting result</span></div>`;
 el.innerHTML=legend+`<div class="emb-list">${head}${stats.map((q,i)=>`<div class="emb-row" title="${escapeHtml(q.name)}: ${q.total} total · ${q.pass} passed · ${q.fail} failed · ${q.pending} awaiting"><span class="rank-index${i<3?' rank-top':''}">${i+1}</span><span class="emb-name">${escapeHtml(q.name)}</span><span class="emb-bar">${seg(q.pass,QUALITY_GOOD)}${seg(q.fail,QUALITY_CRITICAL)}${seg(q.pending,QUALITY_PENDING)}</span><strong class="emb-num">${q.total.toLocaleString()}</strong><span class="emb-num${q.pass?' emb-pass':''}">${q.pass.toLocaleString()}</span><span class="emb-num${q.fail?' emb-fail':''}">${q.fail.toLocaleString()}</span><span class="emb-num emb-wait">${q.pending.toLocaleString()}</span></div>`).join('')}</div>`;
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
function renderVolumeChart(allRows){const sel=$('#volumeMonthFilter')?.value||'',rows=monthFiltered(allRows,sel),months=countBy(allRows,e=>recordMonth(e)||'Unspecified'),dateEntries=Object.entries(months).filter(([k])=>isDateMonth(k)).sort((a,b)=>a[0].localeCompare(b[0])),otherEntries=Object.entries(months).filter(([k])=>!isDateMonth(k)&&k!=='Unspecified').sort((a,b)=>b[1]-a[1]);$('#monthlyTotal').innerHTML=`<span class="rate-kpis"><span><strong>${rows.length.toLocaleString()}</strong>${unitWord()}</span></span>`;const el=$('#monthlyChart'),w=Math.max(360,el.clientWidth||760);el.innerHTML=svgLineChart(dateEntries.map(([k,v])=>({key:k,label:monthLabel(k,{month:'short'}),value:v})),sel,w,220);const otherEl=$('#monthlyOther');if(otherEl)otherEl.innerHTML=''}
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
function canonicalTestName(raw){const t=String(raw||'').trim();return t?TEST_CANON_BY_KEY.get(testNormKey(t))||t:''}
function testNameOf(e){return canonicalTestName(field(e,['test','test name']))||e._case.test}
function mergeTestNameVariants(counts){const groups=new Map;for(const[name,count]of Object.entries(counts)){const normKey=testNormKey(name),key=TEST_NAME_ALIAS_KEY.get(normKey)||normKey;const g=groups.get(key);if(g){g.total+=count;if(count>g.bestCount){g.bestCount=count;g.canonical=name}}else groups.set(key,{canonical:name,bestCount:count,total:count})}const merged={};for(const g of groups.values())merged[g.canonical]=g.total;return merged}
function renderTestChart(allRows){const rows=monthFiltered(allRows,$('#testMonthFilter')?.value||'');lastTestCounts=countBy(rows,testNameOf);renderTestBarList('#testChart',lastTestCounts,rows.length)}
// Test-wise overview: one horizontal bar per standard test name, with count and share; click opens those samples.
function renderTestBarList(id,counts,total){
 const el=$(id);if(!el)return;
 const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 if(!entries.length){el.innerHTML='<div class="chart-empty">No records in this period.</div>';return}
 const peak=entries[0][1]||1,pct=v=>total?(v/total*100):0;
 el.innerHTML=`<div class="tw-list" style="--tw-rows:${Math.ceil(entries.length/2)}">${entries.map(([k,v],i)=>`<button type="button" class="tw-row" data-test="${escapeHtml(k)}" title="${escapeHtml(k)}: ${v.toLocaleString()} ${unitWord()} (${pct(v).toFixed(1)}%)"><span class="tw-name">${escapeHtml(k)}</span><span class="tw-bar"><span style="width:${Math.max(1.5,v/peak*100).toFixed(1)}%"></span></span><strong class="tw-count">${v.toLocaleString()}</strong><span class="tw-pct">${pct(v)<0.1&&v?'<0.1':pct(v).toFixed(1)}%</span></button>`).join('')}</div>`;
 el.onclick=e=>{const row=e.target.closest('[data-test]');if(!row)return;['embryologist','client','test','region','result','storage','transfer','reportStatus'].forEach(k=>{const f=$(`#${k}Filter`);if(f)f.value=''});$('#patientSearch').value='';const sms=$('#samplesMonthFilter');if(sms)sms.value=$('#testMonthFilter')?.value||'';const tf=$('#testFilter');if(tf){if(![...tf.options].some(o=>o.value===row.dataset.test))tf.add(new Option(row.dataset.test,row.dataset.test));tf.value=row.dataset.test}showView('cases');renderCases()};
}
function svgMultiLineChart(points,series,w,h){if(!points.length)return '<div class="chart-empty">No data yet.</div>';const padL=44,padR=16,padT=26,padB=30,max=Math.max(1,...points.flatMap(p=>series.map(s=>p[s.key]))),niceMax=niceMaxOf(max),innerW=w-padL-padR,innerH=h-padT-padB,stepX=points.length>1?innerW/(points.length-1):0,x=i=>padL+i*stepX,y=v=>padT+innerH-(v/niceMax)*innerH;const grid=[0,0.25,0.5,0.75,1].map(t=>{const gy=(padT+innerH-t*innerH).toFixed(1);return `<line x1="${padL}" y1="${gy}" x2="${w-padR}" y2="${gy}" stroke="#edf1ee" stroke-width="1"/><text x="${padL-8}" y="${(Number(gy)+3).toFixed(1)}" font-size="9" fill="#9aa6a0" text-anchor="end">${Math.round(niceMax*t).toLocaleString()}</text>`}).join('');const lines=[...series].reverse().map(s=>{let pen=false;const path=points.map((p,i)=>{if(p.empty&&!s.always&&!s.full){pen=false;return''}const cmd=pen?'L':'M';pen=true;return `${cmd}${x(i).toFixed(1)},${y(p[s.key]).toFixed(1)}`}).filter(Boolean).join(' ');if(!path)return'';const area=s.always&&points.length>1?`<path d="${path} L${x(points.length-1).toFixed(1)},${(padT+innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT+innerH).toFixed(1)} Z" fill="${s.color}" opacity="0.08"/>`:'';return `${area}<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.dash?2:2.5}"${s.dash?' stroke-dasharray="5 4"':''} stroke-linecap="round" stroke-linejoin="round"/>`}).join('');const base=(padT+innerH).toFixed(1),colW=points.length>1?stepX:innerW;const cols=points.map((p,i)=>{const cx=x(i).toFixed(1),top=Math.min(...series.map(sr=>y(p[sr.key]))).toFixed(1),hx=Math.max(0,x(i)-colW/2),hw=Math.min(w,x(i)+colW/2)-hx,rows=series.map(sr=>({label:sr.label,color:sr.color,value:p[sr.key]})),full=p.key&&/^\d{4}-\d{2}$/.test(p.key)?monthLabel(p.key):p.label;const pts=series.filter(sr=>sr.always||sr.full||!p.empty).map(sr=>{const cy=y(p[sr.key]).toFixed(1);return `<circle class="lc-halo" cx="${cx}" cy="${cy}" r="10" fill="${sr.color}"/><circle class="lc-dot" cx="${cx}" cy="${cy}" r="3.5" fill="${sr.color}" stroke="white" stroke-width="1.5"/>`}).join('');return `<g class="lc-pt" data-i="${i}"><line class="lc-guide" x1="${cx}" y1="${padT}" x2="${cx}" y2="${base}" stroke="#6b7a73" stroke-width="1" stroke-dasharray="3 3"/>${pts}<rect class="lc-hit" x="${hx.toFixed(1)}" y="0" width="${hw.toFixed(1)}" height="${h}" fill="transparent" data-x="${cx}" data-y="${top}" data-label="${escapeHtml(full)}" data-series="${escapeHtml(JSON.stringify(rows)).replace(/"/g,'&quot;')}"/></g>`}).join('');const xLabels=points.map((p,i)=>`<text x="${x(i).toFixed(1)}" y="${h-8}" font-size="9" fill="#7b8c93" text-anchor="middle">${escapeHtml(p.label)}</text>`).join('');return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="volume-line-chart">${grid}${lines}${xLabels}${cols}</svg>`}
function renderOutcomeChart(allRows){const monthKeys=[...new Set(allRows.map(recordMonth))].filter(isDateMonth).sort(),series=[{key:'pass',label:'QC Pass',color:QUALITY_GOOD,full:true},{key:'fail',label:'QC Fail',color:QUALITY_CRITICAL,full:true},{key:'awaiting',label:'Awaiting result',color:'#98a4a0',dash:true,always:true}];let totalPass=0,totalFail=0;const points=monthKeys.map(m=>{const rows=allRows.filter(e=>recordMonth(e)===m);let pass=0,fail=0;rows.forEach(e=>{const v=qcVerdict(e);if(v==='PASS')pass++;else if(v==='FAIL')fail++});totalPass+=pass;totalFail+=fail;return {key:m,label:monthLabel(m,{month:'short'}),pass,fail,awaiting:rows.length-pass-fail,empty:pass+fail===0}});const resolved=totalPass+totalFail,pending=allRows.length-resolved;$('#resultTotal').innerHTML=`<span class="rate-kpis"><span><strong>${allRows.length.toLocaleString()}</strong>${unitWord()}</span><span><strong>${pending.toLocaleString()}</strong>awaiting result</span></span>`;const el=$('#resultStack'),w=Math.max(360,el.clientWidth||760);el.innerHTML=svgMultiLineChart(points,series,w,220);$('#resultLegend').innerHTML=series.map(s=>`<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#52625a"><i style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block"></i>${s.label}</span>`).join('')}
function renderClientChart(allRows){const rows=monthFiltered(allRows,$('#clientMonthFilter')?.value||'');lastClientCounts=countBy(rows,e=>e._case.client);const major=Object.fromEntries(Object.entries(lastClientCounts).filter(([,v])=>v>=CLIENT_MIN_SAMPLES)),hasMajor=Object.keys(major).length>0,shown=hasMajor?major:lastClientCounts,note=$('#clientChartNote');if(note)note.textContent=hasMajor?`Clients with ${CLIENT_MIN_SAMPLES}+ ${unitWord()} · ${Object.keys(major).length} of ${Object.keys(lastClientCounts).length} clients`:`No client has ${CLIENT_MIN_SAMPLES}+ ${unitWord()} in this period, so all are shown`;renderFullPieChart('#clientDonut','#clientLegend',shown,manyColorPalette(Object.keys(shown).length))}
function renderRegionChart(allRows){const rows=monthFiltered(allRows,$('#regionMonthFilter')?.value||'');lastRegionCounts=countBy(rows,e=>e._case.region);renderVerticalBarChart('#regionChart',Object.entries(lastRegionCounts).sort((a,b)=>b[1]-a[1]).slice(0,10),{total:Object.values(lastRegionCounts).reduce((a,b)=>a+b,0),of:`${unitWord()} (all regions)`})}
function renderPlatformChart(allRows){const rows=monthFiltered(allRows,$('#platformMonthFilter')?.value||''),platformMap=seqPlatformCanonicalMap(rows),platforms=countBy(rows,e=>{const raw=field(e,['seq platform']);return raw?platformMap.canonical[platformMap.compactKey(raw)]:''});renderVerticalBarChart('#platformChart',Object.entries(platforms).sort((a,b)=>b[1]-a[1]),{of:`${unitWord()} with a platform recorded`})}
function renderQualitySection(allRows){const rows=monthFiltered(allRows,$('#qualityMonthFilter')?.value||'');let pass=0,fail=0;rows.forEach(e=>{const v=qcVerdict(e);if(v==='PASS')pass++;else if(v==='FAIL')fail++});const pending=rows.length-pass-fail;$('#failureRate').textContent=`${(pass+fail)?Math.round(fail/(pass+fail)*100):0}%`;$('#inconclusiveRate').textContent=`${rows.length?Math.round(pending/rows.length*100):0}%`;renderEmbryologistBarChart('#qualityChart',embryologistQcStats(rows),5)}
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
// Re-biopsy list: every sample whose Remarks column mentions a re-biopsy.
function rebiopsyMarkup(){return `<div class="filters-inline hidden" id="rebiopsyFiltersPanel"><label class="filter-field"><span>Month</span><select id="rebiopsyMonthFilter"><option value="">All months</option></select></label><label class="filter-field"><span>Test</span><select id="rebiopsyTestFilter"><option value="">All tests</option></select></label><label class="filter-field"><span>Client</span><select id="rebiopsyClientFilter"><option value="">All clients</option></select></label><label class="filter-field"><span>Embryologist</span><select id="rebiopsyEmbryologistFilter"><option value="">All embryologists</option></select></label><button class="text-button filters-clear" id="rebiopsyClearFilters">Clear all</button></div><div class="prep-table-wrap" id="rebiopsyTableWrap"><div class="chart-empty">Loading…</div></div>`}
function setupRebiopsyView(){
 const rows=allEmbryos().filter(isRebiopsy).map(e=>({e,patient:e._case.patient||field(e,['patient name'])||'—',sampleId:field(e,['sample id'])||e._case.id||'—',embryos:field(e,['embryo name'])||'—',test:canonicalTestName(field(e,['test name']))||e._case.test||'—',client:e._case.client||'—',embryologist:e._case.embryologist||'—',received:field(e,['date sample received'])||'—',remarks:field(e,['remarks'])||'—',month:recordMonth(e)})).sort((a,b)=>(b.month||'').localeCompare(a.month||''));
 // Patient view: one row per case, its re-biopsied records merged. Embryo view: one row per embryo tag.
 const byPatient=list=>{const m=new Map();for(const r of list){const c=r.e._case;let g=m.get(c);if(!g)m.set(c,g={...r,sampleIds:new Set(),embryoList:[],remarkSet:new Set()});g.sampleIds.add(r.sampleId);g.embryoList.push(r.embryos);g.remarkSet.add(r.remarks)}return[...m.values()].map(g=>({...g,sampleId:[...g.sampleIds].join(', '),embryos:g.embryoList.join(', '),remarks:[...g.remarkSet].join(' | ')}))};
 const byEmbryo=list=>list.flatMap(r=>{const tags=expandEmbryoTags(r.embryos);return tags.length>1?tags.map(t=>({...r,embryos:t})):[r]});
 let q='',frozen=false,mode='patient';
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
function renderStatCards(allRows){
 const total=allRows.length,ongoing=allRows.filter(e=>e._importSource==='Pending').length,embryos=allRows.reduce((s,e)=>s+embryoRowsOf(e).length,0),completed=allRows.filter(e=>reportStatus(e)==='Completed').length;
 countUp($('#totalSamplesStat'),total);countUp($('#activeStat'),ongoing);countUp($('#trackedStat'),embryos);countUp($('#completedStat'),completed);const rebiopsyNav=$('#rebiopsyNavCount');if(rebiopsyNav)rebiopsyNav.textContent=allRows.filter(isRebiopsy).length.toLocaleString();const prepMonths=reportPrepMonths(),prep=allRows.filter(e=>isReportPrep(e,prepMonths)).length;countUp($('#reportPrepStat'),prep);const prepNav=$('#reportPrepNavCount');if(prepNav)prepNav.textContent=prep.toLocaleString();$('#reportPrepSub').innerHTML=`In <b>${escapeHtml(monthLabel(prepMonths[0],{month:'short'}))}</b> &amp; <b>${escapeHtml(monthLabel(prepMonths[1],{month:'short'}))}</b> · Attune &amp; NGS report pending`;
 const months=[...new Set(allRows.map(recordMonth).filter(isDateMonth))].sort(),latest=months[months.length-1],latestCount=latest?allRows.filter(e=>recordMonth(e)===latest).length:0;
 $('#totalSamplesSub').innerHTML=latest?`<b>+${latestCount.toLocaleString()}</b> in ${escapeHtml(monthLabel(latest,{month:'long'}))}`:'All sample records';

}
// Overview charts count either sample records or individual embryos. A record
// whose embryo names split ("SS-1,2") contributes one row per embryo with its
// own result; one whose names can't be split falls back to "number of embryos".
let overviewUnit=(()=>{try{return localStorage.getItem('em-overview-unit')==='embryos'?'embryos':'samples'}catch{return'samples'}})();
const unitWord=(cap=false)=>overviewUnit==='embryos'?(cap?'Embryos':'embryos'):(cap?'Samples':'samples');
// One row per embryo of a record. How many comes from the sheet's "Number of embryos" column
// (blank = 1); the embryo names only supply each row's own result, so extra names are dropped
// and missing ones padded. The Embryos Tracked card counts the same rows, so both always agree.
function embryoRowsOf(e){const n=Math.max(1,Math.round(embryoUnits(e))),split=expandEmbryoRow(e);if(split.length>=n)return split.slice(0,n);const pad=split.length===1?split[0]:e;return[...split,...Array.from({length:n-split.length},()=>pad)]}
function overviewRows(){const rows=allEmbryos();return overviewUnit==='embryos'?rows.flatMap(embryoRowsOf):rows}
function syncOverviewUnitUi(){document.querySelectorAll('#overviewUnitToggle [data-unit]').forEach(b=>{const on=b.dataset.unit===overviewUnit;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});document.querySelectorAll('[data-unit-text]').forEach(el=>{el.textContent=el.dataset.unitText.replace('{Unit}',unitWord(true)).replace('{unit}',unitWord())})}
function setOverviewUnit(unit){overviewUnit=unit==='embryos'?'embryos':'samples';try{localStorage.setItem('em-overview-unit',overviewUnit)}catch{}renderAnalytics()}
document.addEventListener('click',e=>{const b=e.target.closest('#overviewUnitToggle [data-unit]');if(b)setOverviewUnit(b.dataset.unit)});
function renderAnalytics(){syncOverviewUnitUi();const allRows=overviewRows();renderStatCards(allEmbryos());const testTypeCountEl=$('#testTypeCount');if(testTypeCountEl)testTypeCountEl.textContent=new Set(allRows.map(testNameOf).filter(Boolean)).size;renderVolumeChart(allRows);renderTestChart(allRows);renderOutcomeChart(allRows);renderClientChart(allRows);renderRegionChart(allRows);renderPlatformChart(allRows);renderQualitySection(allRows)}
async function storeImages(caseId,embryo,files){const form=new FormData();form.append('embryo_label',embryo||'');for(const file of files)form.append('files',file);const res=await fetch(`/api/cases/${encodeURIComponent(caseId)}/images`,{method:'POST',body:form});if(!res.ok)throw new Error('Upload failed')}
async function patientImages(caseId){try{const r=await fetch(`/api/cases/${encodeURIComponent(caseId)}/images`);if(!r.ok)return[];return await r.json()}catch(e){return[]}}
async function deleteImage(id){await fetch(`/api/images/${id}`,{method:'DELETE'})}
function embryoTableRows(c,list=resolvedEmbryos(c)){if(!list.length)return Array.from({length:c.samples},(_,i)=>`<tr class="embryo-row"><td><strong>${escapeHtml(c.id)}-S0${i+1}</strong></td><td>—</td><td>—</td><td>—</td><td><span class="result-pill ${i?'normal':c.result.toLowerCase()}">${i?'Normal':c.result}</span></td></tr>`).join('');return list.map(r=>{const identity=resultIdentity(r),out=conclusionClass(r)||((field(r,['conclusion'])||field(r,['result'])||field(r,['qc']))?(r._outcome||clinicalOutcome(r)):'N/A'),s=storageInfo(r),t=transferInfo(r),location=[s.freezer&&`Freezer ${s.freezer}`,s.rack&&`Rack ${s.rack}`,s.box&&`Box ${s.box}`,s.position&&`Position ${s.position}`].filter(Boolean).join(' · '),name=identity.patient?`${identity.patient}-${identity.embryo}`:(identity.embryo||field(r,['embryo name'])||field(r,['sample name'])),mapd=field(r,['mapd'])||'—',mtcopy=field(r,['mtcopy'])||'—',uniquereads=field(r,['uniquereads'])||'—',bincv=field(r,['bincv'])||'—',cnvmergecv=field(r,['cnvmergecv'])||'—',cnvpq=field(r,['cnvpq'])||'—',autosomes=field(r,['autosomes'])||'—',conclusion=field(r,['conclusion']),storageDetail=[s.barcode,location||'Location not recorded',s.date?`Stored ${s.date}`:'Stored date not recorded',s.notes].filter(Boolean).join(' · '),transferDetail=[t.purpose&&t.purpose!=='Not transferred'&&t.purpose!==t.status?t.purpose:null,t.details||null,t.department?`To ${t.department}`:null,t.sentDate?`Sent ${t.sentDate}`:null,t.sentBy?`By ${t.sentBy}`:null,t.receivedBy?`Received by ${t.receivedBy}`:null,t.receivedDate?`on ${t.receivedDate}`:null,t.returnDate?`Returned ${t.returnDate}`:null,t.remarks].filter(Boolean).join(' · ')||'No transfer details recorded';return `<tr class="embryo-row"><td><strong>${escapeHtml(name)}</strong></td><td>${escapeHtml(qcVerdict(r)==='FAIL'?'FAIL':(field(r,['qc'])||'—'))}</td><td>${escapeHtml(field(r,['karyotype mwf','karyotype normal wf'])||'—')}</td><td><span class="result-pill ${out.toLowerCase().replace(/[^a-z]/g,'')}">${out}</span></td></tr><tr class="embryo-subrow"><td colspan="4"><p class="${conclusion?'':'result-conclusion'}">${escapeHtml(conclusion||'No conclusion provided')}</p><div class="embryo-kv-wrap"><table class="embryo-kv"><thead><tr>${['MAPD','MTcopy','Unique reads','BinCV','CNVMergeCV','CNVpq','Autosomes'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody><tr>${[mapd,mtcopy,uniquereads,bincv,cnvmergecv,cnvpq,autosomes].map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr></tbody></table></div><div class="embryo-trace-line"><span class="mini-badge">${escapeHtml(s.status)}</span>${escapeHtml(storageDetail)}</div><div class="embryo-trace-line"><span class="mini-badge${t.status==='Transferred'?' mini-badge-ok':''}">${escapeHtml(t.status)}</span>${escapeHtml(transferDetail)}</div></td></tr>`}).join('')}
const ICON_COPY='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const ICON_X='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_DNA='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/></svg>';
// Result class from an embryo's Conclusion in the result file; null when it has no result yet.
function conclusionClass(r){const t=field(r,['conclusion']).toLowerCase();if(field(r,['qc'])&&qcVerdict(r)==='FAIL')return'Inconclusive';if(!t)return null;if(t.includes('no dna'))return'Inconclusive';if(t.includes('mosaic'))return'Mosaic';if(t.includes('inconclusive')||QC_FAIL_SIGNALS.some(x=>t.includes(x)))return'Inconclusive';if(t.includes('no copy number'))return'Normal';if(t.includes('abnormal')||t.includes('aneuploid'))return'Abnormal';if(t.includes('euploid')||t.includes('normal'))return'Normal';return null}
function openPatient(c,focusEmbryo){const resolvedAll=resolvedEmbryos(c),resolved=focusEmbryo?resolvedAll.filter(r=>embryoDisplayId(r)===focusEmbryo):resolvedAll,classes=resolved.map(conclusionClass),hasResults=classes.some(Boolean),classCount=k=>hasResults?classes.filter(x=>x===k).length:'-',normal=classCount('Normal'),mosaic=classCount('Mosaic'),abnormal=classCount('Abnormal'),inc=classCount('Inconclusive'),noResult=resolved.length?classes.filter(x=>!x).length:(c.samples||0),embryos=(resolved.length?resolved.map(r=>{const id=resultIdentity(r);return id.patient?`${id.patient}-${id.embryo}`:id.embryo}):Array.from({length:c.samples},(_,i)=>`Embryo ${i+1}`)).filter(Boolean),platform=resolved.map(r=>field(r,['seq platform'])).find(Boolean),embryoCount=resolved.length||c.samples;$('#patientDetail').innerHTML=`<div class="patient-detail patient-detail-v2"><div class="case-top-v2"><div class="case-badges"><span class="case-id-badge">${escapeHtml(c.id)}</span><span class="case-test-badge">${escapeHtml(c.test)}</span></div><div class="case-top-actions"><button class="icon-btn" id="copyPatientId" title="Copy case ID" aria-label="Copy case ID">${ICON_COPY}</button><button class="icon-btn" id="closePatient" title="Close" aria-label="Close">${ICON_X}</button></div></div><h2 class="patient-name-v2">${escapeHtml(c.patient)}</h2><div class="patient-meta-v2">${escapeHtml(c.client)}${c.clientBranch?` (${escapeHtml(c.clientBranch)})`:""} · ${escapeHtml(c.region)} · Embryologist: ${escapeHtml(c.embryologist)}</div>${progressStepper(caseProgressStage(c),c.embryos?.[0]||{})}<div class="summary-strip summary-cards"><div class="sum-card tone-teal${Number(embryoCount)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="9.5" cy="10" r="2.2"/><circle cx="14.5" cy="10" r="2.2"/><circle cx="12" cy="14.8" r="2.2"/></svg></span><strong>${embryoCount}</strong><small>Total embryos</small></div><div class="sum-card tone-green${Number(normal)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg></span><strong>${normal}</strong><small>Normal</small></div><div class="sum-card tone-blue${Number(mosaic)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none"/></svg></span><strong>${mosaic}</strong><small>Mosaic</small></div><div class="sum-card tone-red${Number(abnormal)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg></span><strong>${abnormal}</strong><small>Abnormal</small></div><div class="sum-card tone-amber${Number(inc)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg></span><strong>${inc}</strong><small>Inconclusive</small></div><div class="sum-card tone-grey${Number(noResult)?'':' is-zero'}"><span class="sum-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span><strong>${noResult}</strong><small>N/A result</small></div></div><div class="embryo-table-card"><div class="embryo-table-head"><div class="embryo-table-title">${ICON_DNA}<h3>Individual embryo results <span class="count-badge">(${embryoCount})</span></h3></div>${platform?`<span class="platform-tag">${escapeHtml(platform)}</span>`:''}</div><div class="embryo-table-scroll"><table class="embryo-table"><thead><tr><th>Embryo</th><th>QC</th><th>Karyotype</th><th>Result</th></tr></thead><tbody>${embryoTableRows(c,resolved)}</tbody></table></div></div><section class="detail-card image-vault-v2"><div class="vault-heading"><div><h3>Patient image vault</h3><small>Stored on the server</small></div></div><label>Attach to embryo<select id="imageEmbryo">${embryos.map(x=>`<option>${escapeHtml(x)}</option>`).join('')}<option>General / patient</option></select></label><div class="capture-actions"><label class="primary capture-button">📷 Take photo<input id="cameraInput" type="file" accept="image/*" capture="environment" hidden></label><label class="secondary capture-button">＋ Choose images<input id="imageInput" type="file" accept="image/*" multiple hidden></label></div><p class="storage-note">Images are uploaded to the lab server and linked to this case.</p><div class="real-image-grid" id="patientImageGrid"><div class="image-loading">Loading images…</div></div></section></div>`;$('#patientDialog').showModal();$('#closePatient').onclick=()=>$('#patientDialog').close();$('#copyPatientId').onclick=async()=>{try{await navigator.clipboard.writeText(c.id);toast('Case ID copied')}catch(err){toast('Could not copy case ID')}};const add=async e=>{const files=[...e.target.files];if(!files.length)return;try{await storeImages(c.id,$('#imageEmbryo').value,files);toast(`${files.length} image${files.length===1?'':'s'} stored for ${c.patient}`)}catch(err){toast('Image upload failed')}await renderPatientImages(c)};$('#imageInput').onchange=add;$('#cameraInput').onchange=add;renderPatientImages(c)}
async function renderPatientImages(c){const grid=$('#patientImageGrid');if(!grid)return;const images=await patientImages(c.id);const ic=$('#patientImageCount');if(ic){ic.textContent=images.length;ic.closest('.sum-card')?.classList.toggle('is-zero',!images.length)}grid.innerHTML=images.length?images.map(x=>`<figure class="stored-image" data-image-id="${x.id}"><img src="${x.url}" alt="${escapeHtml(x.embryo||'')} sample image"><figcaption><strong>${escapeHtml(x.embryo||'General')}</strong><span>${new Date(x.addedAt).toLocaleString()}</span></figcaption><button class="image-delete" aria-label="Delete image">×</button></figure>`).join(''):'<div class="image-empty">No images yet.<br>Take the first sample photo above.</div>';$$('.image-delete').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this image?'))return;await deleteImage(b.closest('[data-image-id]').dataset.imageId);await renderPatientImages(c);toast('Image deleted')})}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
function showView(view){
 $('#mainHeader')?.classList.toggle('hidden',view==='overview');
 $('.nav-item[data-view="reportprep"]').classList.toggle('hidden',view!=='reportprep');
 $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view||(view==='cases'&&n.dataset.view==='samples')));
 $('#registryViewToggle')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#registryHeaderLeft')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#genericHeaderLeft')?.classList.toggle('hidden',view==='overview'||view==='cases'||view==='samples');
 $('#rebiopsyHeaderSearch')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#rebiopsyHeaderActions')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#rebiopsyViewToggle')?.classList.toggle('hidden',view!=='rebiopsy');
 $('#registrySearchWrap')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 $('#registryHeaderActions')?.classList.toggle('hidden',!(view==='cases'||view==='samples'));
 if(view==='overview'){ $('#overviewView').classList.remove('hidden');$('#samplesView').classList.add('hidden');$('#genericView').classList.add('hidden');return }
 if(view==='cases'||view==='samples'){ $('#overviewView').classList.add('hidden');$('#genericView').classList.add('hidden');$('#samplesView').classList.remove('hidden');fitTableHeight($('#caseTable .embryo-columns-table'));return }
 $('#overviewView').classList.add('hidden');$('#samplesView').classList.add('hidden');const g=$('#genericView');g.classList.remove('hidden');
 const data={experiments:['Molecular tests','Every PGT run, decision, and result—linked and searchable.'],images:['Embryo image vault','Keep embryo images separate while every file remains linked to its patient and sample.'],protocols:['PGT protocols',''],reportprep:['Report preparation','Samples whose Attune upload and NGS report dates are both still empty, from the current and previous month tabs.'],rebiopsy:['Re-biopsy cases',''],activity:['Activity log','Every sign-in, upload and change: who did it, what they did and when.'],import:['',''],embryologists:['All embryologists','Every embryologist with their total samples and how many passed or failed QC.'],regions:['All regions','Monthly sample volume for every region.'],clients:['All clients','Every client and their sample volume. Click a client to open their samples.'],tests:['All tests','Every test type in the current reporting period.']}[view];
 $('#genericHeaderTitle').textContent=data[0];
 g.innerHTML=`<div class="generic-card${view==='tests'||view==='protocols'||view==='images'||view==='activity'||view==='clients'||view==='reportprep'||view==='rebiopsy'?' wide-card':view==='regions'||view==='clients'||view==='embryologists'?' rank-card':''}${view==='protocols'?' protocols-view':''}${view==='images'?' images-view':''}${view==='import'?' import-view':''}"><p>${data[1]}</p>${view==='experiments'?'<div class="experiment-list" id="allExperimentList"></div><button class="primary" id="newExperimentAlt">＋ New test record</button>':view==='import'?importMarkup():view==='activity'?activityMarkup():view==='reportprep'?reportPrepMarkup():view==='rebiopsy'?rebiopsyMarkup():view==='protocols'?protocolsMarkup():view==='images'?'<div class="vault-groups" id="imageVaultGroups"><div class="chart-empty">Loading images…</div></div>':view==='embryologists'?'<div class="prep-segments emb-sort" id="embryologistSortOrder" role="tablist" aria-label="Sort embryologists"><button type="button" class="prep-seg active" data-sort="pass">Most QC passed</button><button type="button" class="prep-seg" data-sort="total">Most samples</button><button type="button" class="prep-seg" data-sort="fail">Most failed</button><button type="button" class="prep-seg" data-sort="asc">Fewest samples</button></div><div id="allQualityChart"></div>':view==='regions'?regionsMarkup():view==='clients'?allClientsMarkup():view==='tests'?'<div class="test-name-grid" id="allTestList"></div>':'<div class="empty-action"><h3>This workspace is ready to grow</h3><p>The core structure is in place for your lab records.</p><button class="primary" data-view="overview">Return to overview</button></div>'}</div>`;
 if(view==='experiments'){const target=$('#allExperimentList');experiments.forEach((x,i)=>{const temp=document.createElement('div');temp.className='experiment-row';temp.innerHTML=`<span class="exp-avatar ${['a','b','c','d'][i%4]}">${x.owner}</span><div><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.project)} · ${escapeHtml(x.next)}</p></div><small class="tag green-tag">${x.status}</small>`;target.append(temp)});$('#newExperimentAlt').onclick=()=>$('#experimentDialog').showModal()}
 if(view==='import'){setupImporter()}
 if(view==='activity'){setupActivityView()}
 if(view==='reportprep'){setupReportPrepView()}
 if(view==='rebiopsy'){setupRebiopsyView()}
 if(view==='protocols'){setupProtocolsView()}
 if(view==='images'){setupImageVaultView()}
 if(view==='embryologists'){const sortEl=$('#embryologistSortOrder');let order='pass';const render=()=>{const stats=embryologistQcStats(allEmbryos()),key=order==='asc'?'total':order;stats.sort((a,b)=>(order==='asc'?a.total-b.total:b[key]-a[key])||b.total-a.total||a.name.localeCompare(b.name));renderEmbryologistRankList('#allQualityChart',stats)};render();if(sortEl)sortEl.onclick=e=>{const b=e.target.closest('[data-sort]');if(!b)return;order=b.dataset.sort;sortEl.querySelectorAll('.prep-seg').forEach(x=>x.classList.toggle('active',x===b));render()}}
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
async function init(){experiments=(await kvGet('embryomatrix-experiments'))||[];renderExperiments();await setupCases();const status=await syncSheetNow();if(status){if(status.changed!==false)await setupCases();updateIssueStat(status)}}
loadWhoAmI().then(init);
if(document.modelContext?.registerTool){document.modelContext.registerTool({name:'filter_patient_cases',title:'Filter patient cases',description:'Filter the visible patient registry by embryologist, client, test, region, or result.',inputSchema:{type:'object',properties:{embryologist:{type:'string'},client:{type:'string'},test:{type:'string'},region:{type:'string'},result:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){for(const key of ['embryologist','client','test','region','result'])if(input[key]!==undefined)$(`#${key}Filter`).value=input[key];renderCases();return{visibleCases:$$('[data-case]').length,filters:input}}})}
window.addEventListener('beforeinstallprompt',e=>e.preventDefault());

function uploadedProtocolCard(d){return `<article class="protocol-card"><div class="protocol-card-head"><div><h3>${escapeHtml(d.title)}</h3><div class="protocol-meta">${escapeHtml(d.filename)} · Uploaded ${new Date(d.uploadedAt).toLocaleDateString()}</div></div><a class="primary protocol-download" href="${d.url}" download>⬇ Download</a></div></article>`}
let vaultGalleryGroups=[];
function openVaultGallery(group){if(!group)return;$('#lightboxImg').classList.add('hidden');const title=$('#lightboxTitle');title.textContent=`${group.patient} · all sample images`;title.classList.remove('hidden');const gallery=$('#lightboxGallery');gallery.innerHTML=group.imgs.map(x=>`<figure><img src="${x.url}" alt="${escapeHtml(x.embryo||'General / patient')} sample image"><figcaption>${escapeHtml(x.embryo||'General / patient')} · ${new Date(x.addedAt).toLocaleString()}</figcaption></figure>`).join('');gallery.classList.remove('hidden');$('#imageLightbox').showModal()}
async function setupImageVaultView(){const el=$('#imageVaultGroups');if(!el)return;let images;try{const res=await fetch('/api/images');images=res.ok?await res.json():[]}catch(err){el.innerHTML='<div class="chart-empty">Could not load images.</div>';return}if(!images.length){el.innerHTML='<div class="empty-action"><h3>No images yet</h3><p>Photos attached to an embryo from a patient case will appear here, grouped by sample.</p></div>';return}const byCase=new Map();images.forEach(img=>{if(!byCase.has(img.caseId))byCase.set(img.caseId,new Map());const embryoMap=byCase.get(img.caseId);const key=img.embryo||'General / patient';if(!embryoMap.has(key))embryoMap.set(key,[]);embryoMap.get(key).push(img)});vaultGalleryGroups=[];el.innerHTML=[...byCase.entries()].map(([caseId,embryoMap])=>{const c=cases.find(x=>x.id===caseId);const patient=c?c.patient:'Unknown patient';const allCaseImgs=[...embryoMap.values()].flat();const embryoBlocks=[...embryoMap.entries()].map(([label,imgs])=>{const groupId=vaultGalleryGroups.length;vaultGalleryGroups.push({patient,label,imgs:allCaseImgs});const layers=imgs.length>1?'<span class="stack-layer"></span><span class="stack-layer"></span>':'';return `<div class="vault-embryo-block"><h4>${escapeHtml(label)} <span class="count-badge">(${imgs.length})</span></h4><div class="image-stack" data-group="${groupId}" title="View all ${imgs.length} image(s)">${layers}<span class="stack-front"><img src="${imgs[0].url}" alt="${escapeHtml(label)} sample image"></span>${imgs.length>1?`<span class="stack-count">×${imgs.length}</span>`:''}</div></div>`}).join('');return `<article class="vault-group" data-case="${escapeHtml(caseId)}"><div class="vault-group-head"><div class="vault-group-heading"><strong>${escapeHtml(patient)}</strong><span class="case-id-badge">${escapeHtml(caseId)}</span></div>${c?'<button class="primary vault-open-btn">Open case →</button>':''}</div><div class="vault-embryo-row">${embryoBlocks}</div></article>`}).join('');$$('#imageVaultGroups .vault-group').forEach(g=>{const c=cases.find(x=>x.id===g.dataset.case);if(!c)return;const btn=g.querySelector('.vault-open-btn');if(btn)btn.onclick=()=>openPatient(c)});$$('#imageVaultGroups .image-stack').forEach(s=>s.onclick=()=>openVaultGallery(vaultGalleryGroups[+s.dataset.group]))}
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
function importMarkup(){return `<section class="universal-import"><div><h2>Attach a sequencing result file</h2><p>CSV or Excel, any sheet layout (e.g. a RUN analysis file). Matches by patient + embryo identity and adds QC/result data to existing samples.</p></div><div class="import-controls"><label class="file-button">Choose result file<input id="resultAttachFile" type="file" accept=".csv,.xlsx,.xls,text/csv" multiple hidden></label><button class="primary compact" id="resultUploadBtn" disabled>Upload</button></div><small id="resultAttachStatus">No files selected</small></section><section class="upload-log-section"><div class="log-head"><h3>Uploaded result files</h3><small class="rf-hint">One result file per embryo. To upload new results for a sample, delete its earlier file here first.</small></div><div id="resultFilesList" class="upload-log-list"><div class="chart-empty">Loading…</div></div></section>`}
function renderUploadLog(){const el=$('#uploadLogList');if(!el)return;const log=uploadLogCache||[];if(!log.length){el.innerHTML='<div class="chart-empty">No uploads yet.</div>';return}const rows=log.map((e,i)=>{const files=escapeHtml(e.files.join(', '));const by=e.by?`<span class="upload-log-by">${escapeHtml(e.by)}</span>`:'<span class="upload-log-by unknown">Unknown</span>';return `<tr><td>${i+1}</td><td class="left upload-log-files" title="${files}">${files}</td><td class="upload-log-count">${e.matched}</td><td>${by}</td><td class="upload-log-role">${e.role?escapeHtml(e.role):'—'}</td><td><span class="activity-action tone-result">${ACTIVITY_LABELS.result_upload}</span></td><td class="upload-log-time">${new Date(e.at).toLocaleDateString()}</td><td class="upload-log-time">${new Date(e.at).toLocaleTimeString()}</td></tr>`}).join('');el.innerHTML=`<table class="upload-log-table"><colgroup><col class="c-sno"><col><col class="c-count"><col class="c-by"><col class="c-role"><col class="c-action"><col class="c-date"><col class="c-time"></colgroup><thead><tr><th>S.No</th><th class="left">File</th><th>Samples matched</th><th>Uploaded by</th><th>Role</th><th>Action</th><th>Date</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`}
let uploadLogCache=[];
function sessionRole(){return currentUser.role||''}
const isAdmin=()=>sessionRole()==='admin';
const ACTIVITY_LABELS={login:'Signed in',logout:'Signed out',result_upload:'Result file upload',image_upload:'Embryo image upload',image_delete:'Embryo image deleted',protocol_upload:'Protocol upload',protocol_delete:'Protocol deleted',sheet_sync:'Sheet sync',log_reset:'Log reset',result_delete:'Result file deleted'};
const ACTIVITY_TONES={login:'tone-in',logout:'tone-out',result_upload:'tone-result',image_upload:'tone-image',image_delete:'tone-delete',protocol_upload:'tone-protocol',protocol_delete:'tone-delete',sheet_sync:'tone-sync',log_reset:'tone-delete',result_delete:'tone-delete'};
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
function recordsFrom(rows){if(!rows.length)return[];const signals=['patient name','sample id','sample name','embryo name','test','qc','conclusion','result','mapd'];let hi=-1,best=0;rows.slice(0,20).forEach((r,i)=>{const cells=r.map(c=>String(c).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()),score=signals.filter(s=>cells.includes(s)).length;if(score>best){best=score;hi=i}});if(hi<0||best<2)return[];const heads=rows[hi].map(h=>String(h).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim());return rows.slice(hi+1).filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(heads.map((h,i)=>[h||`column ${i+1}`,r[i]||''])))}
function field(r,names){for(const n of names){const k=Object.keys(r).find(x=>x===n||x.includes(n));if(k&&r[k])return String(r[k]).trim()}return''}
function embryoUnits(e){const n=parseFloat(field(e,['number of embryos']));return Number.isFinite(n)&&n>0?n:1}
function cleanId(v){return String(v||'').toUpperCase().replace(/_L\d+$/,'').replace(/[^A-Z0-9]/g,'')}
function resultIdentity(r){const raw=field(r,['sample name','embryo name','embryo']),clean=String(raw).replace(/_L\d+$/i,'').trim(),cut=clean.lastIndexOf('-');return cut>0?{patient:clean.slice(0,cut).replace(/[^a-z0-9]/gi,''),embryo:clean.slice(cut+1).replace(/[^a-z0-9]/gi,'')}:{patient:'',embryo:cleanId(clean)}}
function fieldKey(r,names){for(const n of names){const k=Object.keys(r).find(x=>x===n||x.includes(n));if(k&&r[k])return k}return null}
// A sheet row can hold several embryos ("AS-1,2,3,4"); results merged from the result
// file are kept per embryo in _embryoResults, so each split-out embryo shows its own.
function withEmbryoResult(r,embryo){if(!r._embryoResults)return r;const own=r._embryoResults[cleanId(embryo)];if(own){const{_fileId,...vals}=own;return {...r,...vals}}
 // No result of its own yet: show only what the sample sheet had, not another embryo's result.
 const out={...r},orig=r._resultOriginals||{};RESULT_FIELDS.forEach(f=>{if(orig[f]!=null)out[f]=orig[f];else if(f in orig)delete out[f]});return out}
function expandEmbryoRow(r){const key=fieldKey(r,['sample name','embryo name','embryo']);if(!key)return[r];const clean=String(r[key]||'').replace(/_L\d+$/i,'').trim(),cut=clean.lastIndexOf('-');
 if(cut>0){const list=clean.slice(cut+1);if(list.includes(',')){const nums=list.split(',').map(s=>s.trim()).filter(Boolean);if(nums.length>=2){const prefix=clean.slice(0,cut+1);return nums.map(n=>withEmbryoResult({...r,[key]:`${prefix}${n}`},`${prefix}${n}`))}}return[withEmbryoResult(r,clean)]}
 // No hyphen (e.g. a plain "1,2,3,4" with no patient-prefix tag): still split on commas,
 // matching expandEmbryoTags - otherwise this row never lines up with its own result-file data.
 if(clean.includes(',')){const parts=clean.split(',').map(s=>s.trim()).filter(Boolean);if(parts.length>=2)return parts.map(p=>withEmbryoResult({...r,[key]:p},p))}
 return[withEmbryoResult(r,clean)]}
function resolvedEmbryos(c){if(!c.embryos?.length)return[];const idxMap=new Map,out=[];for(const r of c.embryos)for(const er of expandEmbryoRow(r)){const id=resultIdentity(er),ek=`${cleanId(id.patient)}|${cleanId(id.embryo)}`;if(idxMap.has(ek)){const existing=out[idxMap.get(ek)];for(const[k,v]of Object.entries(er))if(v!=null&&String(v).trim()!==''&&(existing[k]==null||String(existing[k]).trim()===''))existing[k]=v;if(!existing._outcome&&er._outcome)existing._outcome=er._outcome}else{idxMap.set(ek,out.length);out.push({...er})}}return out}
function embryoDisplayId(r){const id=resultIdentity(r);return id.patient?`${id.patient}-${id.embryo}`:id.embryo}
function expandEmbryoTags(embryo){return [...new Set(String(embryo||'').split(/[,;/]+/).flatMap((part,i,a)=>{const prefix=(part.match(/[A-Za-z]+/)||a[0]?.match(/[A-Za-z]+/)||[''])[0],nums=part.match(/\d+/g)||[];return nums.map(n=>cleanId(prefix+n))}).filter(Boolean))]}
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
  const clean=String(raw||'').replace(/_L\d+$/i,'').trim();
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
function buildAndersonIndex(detailsRows){
  const idx=new Map();
  for(const r of detailsRows){
    const sampleId=field(r,['sample id']),patient=field(r,['patient name']),embryoField=field(r,['embryo name']);
    if(!sampleId||!patient||!embryoField)continue;
    for(const tag of expandEmbryoTags(embryoField)){
      const list=idx.get(tag)||[];
      list.push({patientClean:cleanId(patient),patient,sampleId});
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
async function loadResultFiles(rows){const saved=(await kvGet('embryomatrix-result-files'))||[];resultFilesCache=[...legacyResultFiles(rows||(await kvGet('embryomatrix-imported-cases'))||[]),...saved].sort((a,b)=>String(b.at).localeCompare(String(a.at)));return resultFilesCache}
// Read one result file: Summary rows matched to confirmed Anderson IDs via the Details tab,
// with Inconclusive-tab details folded in. Returns results keyed patient|embryo tag|sample id.
async function parseResultFile(f,trackerTags=new Map){
 let summaryRows=[],detailsRows=[],inconclusiveRows=[];
 const sheets=await gridsFromFile(f);
 for(const {name,rows} of sheets){
  const records=recordsFrom(rows);
  if(!records.length)continue;
  const label=name.toLowerCase();
  if(label.includes('inconclusive'))inconclusiveRows.push(...records);
  else if(label.includes('detail'))detailsRows.push(...records);
  else summaryRows.push(...records);
 }
 const resultRows=summaryRows.filter(r=>field(r,['sample name'])&&(field(r,['result'])||field(r,['qc'])));
 const andersonIndex=buildAndersonIndex(detailsRows);
 const inconclusiveIndex=buildInconclusiveIndex(inconclusiveRows,andersonIndex);
 // byKey: rows confirmed through a Details-tab Anderson ID. byName: rows without one,
 // matched later against the tracker by patient name + embryo tag alone.
 const byKey=new Map,byName=new Map;
 resultRows.forEach(r=>{
  const id=resolveSampleIdentity(field(r,['sample name']),andersonIndex);
  if(!id.embryo)return;
  const inconclusiveDetails=inconclusiveIndex.get(`${cleanId(id.patient)}|${id.embryo}`);
  const row={...r,...inconclusiveDetails,_computedResult:computeEmbryoResult(r,!!inconclusiveDetails)};
  const match=resolveAndersonId(id.patient,id.embryo,andersonIndex);
  if(match){byKey.set(`${match.patientClean}|${id.embryo}|${cleanId(match.sampleId)}`,row);return}
  // No Details-tab entry: split the sample name using the embryo tags the tracker knows.
  const own=cleanId(id.patient)?id:resolveSampleIdentity(field(r,['sample name']),trackerTags);
  if(cleanId(own.patient)&&own.embryo)byName.set(`${cleanId(own.patient)}|${own.embryo}`,row);
 });
 return {file:f,byKey,byName,count:resultRows.length,unverified:0};
}
function matchResultsByName(parsed,known){const byTag=new Map;for(const k of known){const [pat,tag]=k.split('|');if(!byTag.has(tag))byTag.set(tag,[]);byTag.get(tag).push({pat,key:k})}
 parsed.forEach(p=>p.byName.forEach((r,nk)=>{const [pat,tag]=nk.split('|'),hits=[...new Set((byTag.get(tag)||[]).filter(c=>c.pat&&(c.pat.includes(pat)||pat.includes(c.pat))).map(c=>c.key))];if(hits.length===1&&!p.byKey.has(hits[0]))p.byKey.set(hits[0],r);else p.unverified++}))}
async function handleResultAttach(files){
 const status=$('#resultAttachStatus');
 status.textContent=`Reading ${files.length} file(s)…`;
 const allRows=(await kvGet('embryomatrix-imported-cases'))||[],known=new Set(allRows.flatMap(rowResultKeys));
 const trackerTags=new Map([...known].map(k=>[k.split('|')[1],true]));
 const parsed=[];
 for(const f of files){try{parsed.push(await parseResultFile(f,trackerTags))}catch(e){toast(`${f.name} could not be read`)}}
 if(!parsed.some(p=>p.byKey.size||p.byName.size)){status.textContent='No result rows with a Sample Name and QC/Result value were found.';return}
 // Rows without an Anderson ID: take the tracker embryo whose patient name matches (loosely,
 // as the file often shortens it) and whose tag is the same. If that fits more than one
 // tracker sample (e.g. a re-biopsy with the same tag), the row is skipped rather than guessed.
 matchResultsByName(parsed,known);
 const unverified=parsed.reduce((n,p)=>n+p.unverified,0),skippedNote=unverified?` · ${unverified} row(s) skipped (no single matching patient + embryo in the tracker).`:'';
 await loadResultFiles(allRows);
 const owner=new Map;resultFilesCache.forEach(e=>e.samples.forEach(k=>owner.set(k,e)));
 // Refuse the whole upload if any embryo already has results from another file (or twice in this batch).
 const conflicts=[];
 parsed.forEach(p=>{p.keys=[...p.byKey.keys()].filter(k=>known.has(k));p.keys.forEach(k=>{const prev=owner.get(k);if(prev)conflicts.push({name:field(p.byKey.get(k),['sample name']),prev});else owner.set(k,{fileName:p.file.name,run:runNumberOf(p.file.name)})})});
 if(conflicts.length){
  const byPrev=new Map;conflicts.forEach(c=>{const label=`${c.prev.run||'No run no.'} · ${c.prev.fileName}`;byPrev.set(label,[...(byPrev.get(label)||[]),c.name])});
  status.innerHTML=`<span class="rf-blocked">Upload blocked: ${conflicts.length} embryo(s) already have results. Delete the earlier file below first, then upload again.</span>${[...byPrev].map(([label,names])=>`<span class="rf-blocked-line"><b>${escapeHtml(label)}</b>: ${escapeHtml(names.slice(0,8).join(', '))}${names.length>8?` and ${names.length-8} more`:''}</span>`).join('')}`;
  toast('Upload blocked: results already exist for these samples');return}
 const mergedAt=new Date().toISOString(),entries=parsed.filter(p=>p.keys.length).map(p=>({id:`rf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,file:p.file,byKey:p.byKey,keys:p.keys}));
 if(!entries.length){status.textContent='None of the result rows matched a sample in the tracker.'+skippedNote;return}
 const fileOfKey=new Map;entries.forEach(e=>e.keys.forEach(k=>fileOfKey.set(k,e)));
 let matchedRows=0;
 const updated=allRows.map(row=>{
  const keys=rowResultKeys(row).filter(k=>fileOfKey.has(k));if(!keys.length)return row;matchedRows++;
  const originals=row._resultOriginals||Object.fromEntries(RESULT_FIELDS.map(f=>[f,f in row?row[f]:null])),own={...(row._embryoResults||{})};
  keys.forEach(k=>{const e=fileOfKey.get(k);own[k.split('|')[1]]={...resultPatchOf(e.byKey.get(k)),_fileId:e.id}});
  return recomputeRowResults({...row,_embryoResults:own,_resultOriginals:originals,_resultMergedAt:mergedAt});
 });
 await kvSet('embryomatrix-imported-cases',updated);
 for(const e of entries){const fd=new FormData();fd.append('id',e.id);fd.append('fileName',e.file.name);fd.append('run',runNumberOf(e.file.name));fd.append('at',mergedAt);fd.append('samples',JSON.stringify(e.keys));fd.append('sampleNames',JSON.stringify(e.keys.map(k=>field(e.byKey.get(k),['sample name']))));fd.append('matched',String(e.keys.length));fd.append('file',e.file);try{await fetch('/api/result-files',{method:'POST',body:fd})}catch(err){}}
 try{const r=await fetch('/api/upload-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{files:entries.map(e=>e.file.name),matched:matchedRows,at:mergedAt}})});if(r.ok)uploadLogCache=(await r.json()).value||uploadLogCache}catch(err){}
 await setupCases();await loadResultFiles(updated);renderResultFiles();
 const embryos=entries.reduce((n,e)=>n+e.keys.length,0);
 status.textContent=`${entries.length} file(s) uploaded · results added for ${embryos} embryo(s) across ${matchedRows} sample row(s).`+skippedNote;
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
function renderResultFiles(){const el=$('#resultFilesList');if(!el)return;const list=resultFilesCache||[];
 if(!list.length){el.innerHTML='<div class="chart-empty">No result files uploaded yet.</div>';return}
 el.innerHTML=`<table class="upload-log-table rf-table"><thead><tr><th>S.No</th><th>Run no.</th><th class="left">File</th><th>Embryos</th><th>Uploaded by</th><th>Date</th><th>Time</th><th></th></tr></thead><tbody>${list.map((e,i)=>{const d=new Date(e.at),names=escapeHtml((e.sampleNames||[]).join(', '));return `<tr><td>${i+1}</td><td><span class="rf-run${e.run?'':' none'}">${escapeHtml(e.run||'Not in name')}</span></td><td class="left upload-log-files" title="${escapeHtml(e.fileName)}">${escapeHtml(e.fileName)}${e.legacy?' <span class="rf-legacy">earlier upload</span>':''}</td><td class="upload-log-count" title="${names}">${e.samples.length}</td><td>${e.by?`<span class="upload-log-by">${escapeHtml(e.by)}</span>`:'<span class="upload-log-by unknown">Unknown</span>'}</td><td class="upload-log-time">${isNaN(d)?'—':d.toLocaleDateString()}</td><td class="upload-log-time">${isNaN(d)?'—':d.toLocaleTimeString()}</td><td><button type="button" class="rf-delete" data-id="${escapeHtml(e.id)}">Delete</button></td></tr>`}).join('')}</tbody></table>`;
 el.onclick=ev=>{const b=ev.target.closest('.rf-delete');if(b)deleteResultFile(b.dataset.id)}}
async function setupImporter(){let pendingFiles=[];const btn=$('#resultUploadBtn'),status=$('#resultAttachStatus');uploadLogCache=(await kvGet('embryomatrix-upload-log'))||[];renderUploadLog();loadResultFiles().then(renderResultFiles);const resetBtn=$('#uploadLogReset');if(resetBtn)resetBtn.onclick=async()=>{if(!confirm('Clear the result upload log? This cannot be undone.'))return;const r=await fetch('/api/upload-log',{method:'DELETE'}).catch(()=>null);if(r&&r.ok){uploadLogCache=[];renderUploadLog();toast('Upload log cleared')}else toast('Could not reset the log')};$('#resultAttachFile').onchange=e=>{pendingFiles=[...e.target.files];status.textContent=pendingFiles.length?`${pendingFiles.length} file(s) selected: ${pendingFiles.map(f=>f.name).join(', ')}`:'No files selected';btn.disabled=!pendingFiles.length};btn.onclick=async()=>{if(!pendingFiles.length)return;btn.disabled=true;await handleResultAttach(pendingFiles);pendingFiles=[];$('#resultAttachFile').value=''}}
