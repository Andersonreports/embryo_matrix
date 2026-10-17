// Batch creation: pick pending embryos and make a WGA batch or a sequencing run of them. A batch is saved on the
// server, written to the edits sheet (WGA Batches / Sequencing Batches tab) and downloaded as an .xlsx laid out like
// the live batch record sheets, which the lab pastes in itself. The same embryo can go into a WGA batch and then a
// sequencing run - they are the two steps of PGT-A.
// Entry point: window.renderBatchCreationView(container). Uses app.js globals (allEmbryos, embryoRowsOf, field, …).
(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND={wga:{label:'WGA batch',noun:'WGA batch',plural:'WGA batches',noLabel:'WGA batch no',dateLabel:'Processing date',instLabel:'Instrument name',instDefault:'EFFENDORF'},
 seq:{label:'Sequencing batch',noun:'Sequencing run',plural:'Sequencing runs',noLabel:'Run ID',dateLabel:'Run date',instLabel:'Seq platform',instDefault:'GENOLAB M'}};
const SKIP_PATIENT=/^(buffer|ntc|nc|blank|control|neg|pos)\b/i;
const key=(patient,tag)=>`${String(patient||'').toUpperCase().replace(/[^A-Z]/g,'')}|${cleanId(tag)}`;
const dmy=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?`${m[3]}-${m[2]}-${m[1]}`:iso||''};
const dmyKey=v=>{const m=/(\d{1,2})\D(\d{1,2})\D(\d{4})/.exec(v||'');return m?`${m[3]}${m[2].padStart(2,'0')}${m[1].padStart(2,'0')}`:'00000000'};
const today=()=>new Date().toLocaleDateString('en-CA');
let root=null,kind='wga',list=[],sheetWga=[],sheetSeq=[],picked=new Set,q='',fOpen=false,lastKey='',idxStart=1,sampleType='EMBRYO BIOPSY D-5';
const idxLabel=n=>`V${String(n).padStart(3,'0')}`;
// Filter strip under the search bar. Received is a preset (or a custom from/to range); the rest are pick-lists
// built from the pending rows.
const flt={recv:'',from:'',to:'',test:'',client:'',embryologist:'',receivedBy:'',kit:'',wgaBy:'',platform:'',wgaState:''};
const FLT={wga:[['test','Test'],['client','Client'],['embryologist','Embryologist'],['receivedBy','Received by'],['kit','Kit']],
 seq:[['test','Test'],['client','Client'],['embryologist','Embryologist'],['kit','Kit'],['wgaBy','WGA by'],['wgaState','WGA'],['platform','Sequencer']]};
const RECV=[['','Any time'],['0','Today'],['3','Last 3 days'],['7','Last 7 days'],['30','Last 30 days'],['older7','Older than 7 days'],['custom','Custom range…']];
const isoKey=iso=>(iso||'').replace(/-/g,'');
// Whole days since the sample was received (dd-mm-yyyy), or null when the date can't be read.
const waitDays=v=>{const k=dmyKey(v);if(k==='00000000')return null;const d=new Date(+k.slice(0,4),+k.slice(4,6)-1,+k.slice(6,8)),t=new Date;t.setHours(0,0,0,0);return Math.round((t-d)/864e5)};
const waitChip=n=>n==null?'<span class="muted">—</span>':`<span class="bx-wait ${n>=7?'late':n>=4?'warn':''}">${n} day${n===1?'':'s'}</span>`;
const blankish=v=>!v||/^(not assigned|not recorded|na|n\/a|nil|—|-)$/i.test(String(v).trim())?'':String(v).trim();
// The sheet spells the same kit or sequencer several ways (SINGLE SEQ / SINGLESEQ, GENOLABM / GenoLab-M):
// group by letters and digits only and show the commonest spelling.
function unifySpellings(rows,f){const ck=v=>v.toUpperCase().replace(/[^A-Z0-9]/g,''),n={};
 rows.forEach(r=>{if(r[f])((n[ck(r[f])]=n[ck(r[f])]||{})[r[f]]=(n[ck(r[f])][r[f]]||0)+1)});
 const best={};Object.entries(n).forEach(([k,v])=>best[k]=Object.entries(v).sort((a,b)=>b[1]-a[1])[0][0]);
 rows.forEach(r=>{if(r[f])r[f]=best[ck(r[f])]})}

async function load(){
 const [mine,w,s]=await Promise.all([fetch('/api/batches').then(r=>r.ok?r.json():[]).catch(()=>[]),
  (typeof wgaCache!=='undefined'&&wgaCache?.length)?wgaCache:kvGet('embryomatrix-wga-batches'),
  (typeof seqRunsCache!=='undefined'&&seqRunsCache?.length)?seqRunsCache:kvGet('embryomatrix-sequencing-runs')]);
 list=Array.isArray(mine)?mine:[];sheetWga=w||[];sheetSeq=s||[]}

// Where each embryo already sits: {key -> label} for sheet batches and the batches made here.
function placed(k){const m=new Map,add=(arr,lab)=>arr.forEach(b=>(b.samples||[]).forEach(x=>{const kk=x.key||key(x.patient,x.embryo);if(kk&&!m.has(kk))m.set(kk,lab(b))}));
 if(k==='wga'){add(sheetWga,b=>`WGA batch ${b.runId}`);add(list.filter(b=>b.kind==='wga'),b=>`WGA batch ${b.meta.batchNo} (here)`)}
 else{add(sheetSeq,b=>`Run ${b.runId}`);add(list.filter(b=>b.kind==='seq'),b=>`Run ${b.meta.batchNo} (here)`)}
 return m}

// One row per embryo still waiting for this step, oldest received first, a patient's embryos together.
function pending(k){
 const done=placed(k),inWga=placed('wga'),out=[];
 for(const e of allEmbryos()){
  if(e._stale||field(e,['ngs report'])||field(e,['seq date']))continue;
  if(k==='wga'&&field(e,['wga done on']))continue;
  const patient=e._case?.patient||field(e,['patient name']),received=field(e,['date sample received']);
  if(!patient||!received||SKIP_PATIENT.test(patient))continue;
  const units=embryoRowsOf(e),names=units.map(u=>field(u,['sample name','embryo name','embryo'])),dup=new Set(names).size<names.length;
  units.forEach((u,i)=>{const tag=dup?`${names[i]||'E'}#${i+1}`:names[i]||'',kk=key(patient,tag);if(!tag||done.has(kk))return;
   out.push({key:kk,patient,embryo:tag,caseRef:e._case,sampleId:field(e,['sample id']),test:canonicalTestName(field(e,['test name']))||e._case?.test||'',
    received,biopsy:field(e,['date of biopsy']),dnaConc:field(u,['dna conc unpurified','wga conc unpurified','wga conc'])||field(e,['dna conc unpurified','wga conc unpurified','wga conc'])||'',
    purified:field(u,['dna conc purified','wga conc purified'])||field(e,['dna conc purified','wga conc purified'])||'',
    wga:field(e,['wga done on'])||inWga.get(kk)||'',
    client:blankish(e._case?.client||field(e,['center name'])),embryologist:blankish(e._case?.embryologist||field(e,['embryologist name'])),
    receivedBy:blankish(field(e,['received by'])),kit:blankish(field(e,['kit detail'])),wgaBy:blankish(field(e,['wga done by'])),platform:blankish(field(e,['seq platform']))})})}
 ['client','embryologist','receivedBy','kit','wgaBy','platform'].forEach(f=>unifySpellings(out,f));
 const first=new Map;out.forEach(r=>{const p=r.patient.toUpperCase(),d=dmyKey(r.received);if(!first.has(p)||first.get(p)>d)first.set(p,d)});
 return out.sort((a,b)=>first.get(a.patient.toUpperCase()).localeCompare(first.get(b.patient.toUpperCase()))||a.patient.localeCompare(b.patient)||a.embryo.localeCompare(b.embryo,undefined,{numeric:true}))}

function render(){
 const prevScroll=$('#bxTable')?.scrollTop||0;
 const all=pending(kind),needle=q.trim().toLowerCase();
 const defs=FLT[kind],val=(r,k)=>k==='wgaState'?(r.wga?'Done':'Not yet'):r[k],
  optsOf=k=>k==='wgaState'?['Done','Not yet']:[...new Set(all.map(r=>r[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 defs.forEach(([k])=>{if(flt[k]&&!optsOf(k).includes(flt[k]))flt[k]=''});
 const custom=flt.recv==='custom',fromK=custom?isoKey(flt.from):'',toK=custom?isoKey(flt.to):'',nFlt=defs.filter(([k])=>flt[k]).length+(flt.recv?1:0);
 const recvOk=r=>{if(!flt.recv)return true;if(custom)return(!fromK||dmyKey(r.received)>=fromK)&&(!toK||dmyKey(r.received)<=toK);const w=waitDays(r.received);return w!=null&&(flt.recv==='older7'?w>7:w<=+flt.recv)};
 const rows=all.filter(r=>recvOk(r)&&defs.every(([k])=>!flt[k]||val(r,k)===flt[k])&&(!needle||[r.patient,r.embryo,r.sampleId,r.test].join(' ').toLowerCase().includes(needle)));
 const keys=new Set(all.map(r=>r.key));picked.forEach(k=>{if(!keys.has(k))picked.delete(k)});
 const sel=all.filter(r=>picked.has(r.key)),selPatients=new Set(sel.map(r=>r.patient)).size,noWga=kind==='seq'?sel.filter(r=>!r.wga).length:0,
  selTests=Object.entries(sel.reduce((m,r)=>(m[r.test||'No test']=(m[r.test||'No test']||0)+1,m),{})).map(([t,n])=>`${t}: ${n}`).join(' · '),
  made=list.filter(b=>b.kind===kind).length;
 // Columns: the WGA tab follows the WGA batch sheet's Sample Details (S. No. and barcode fill in for the embryos
 // picked, in the order they'll be written), then a few columns that help choose.
 const selNo=new Map(sel.map((r,i)=>[r.key,i])),dash='<span class="muted">—</span>',td=(v,cls='')=>`<td class="${cls}">${v?esc(v):dash}</td>`;
 const C={sno:['S. No.',r=>`<td class="mono">${selNo.has(r.key)?selNo.get(r.key)+1:dash}</td>`],biopsy:['Biopsy Date',r=>td(r.biopsy,'muted')],received:['Received Date',r=>td(r.received,'muted')],
  type:['Sample Type',r=>`<td class="bx-type">${esc(sampleType)}</td>`],patient:['Patient Name','patient'],embryo:['Embryo Tag',r=>td(r.embryo,'mono')],
  index:['Barcode / Index',r=>`<td class="mono">${selNo.has(r.key)?esc(idxLabel(idxStart+selNo.get(r.key))):dash}</td>`],
  dna:['DNA Conc. (ng/µL)',r=>td(r.dnaConc,'mono')],pur:['Purified WGA Conc. (ng/µL)',r=>td(r.purified,'mono')],
  sid:['Sample ID',r=>td(r.sampleId,'mono')],test:['Test',r=>td(r.test)],client:['Client',r=>`<td class="bx-client" title="${esc(r.client)}">${r.client?esc(r.client):dash}</td>`],
  wait:['Waiting',r=>`<td>${waitChip(waitDays(r.received))}</td>`],
  wga:['WGA',r=>`<td>${r.wga?`<span class="bx-wga ok">${esc(r.wga)}</span>`:'<span class="bx-wga">Not yet</span>'}</td>`]};
 const cols=(kind==='wga'?['sno','biopsy','received','type','patient','embryo','index','dna','pur','sid','test','client','wait']
  :['patient','embryo','sid','test','client','received','wait','biopsy','wga']).map(k=>C[k]);
 const groups=[];rows.forEach(r=>{const g=groups[groups.length-1];if(g&&g.patient===r.patient)g.rows.push(r);else groups.push({patient:r.patient,rows:[r]})});
 root.innerHTML=`<div class="bx">
  <div class="bx-top"><div class="prep-segments bx-kind" role="tablist">${Object.entries(KIND).map(([k,v])=>`<button type="button" class="prep-seg${k===kind?' active':''}" data-kind="${k}" role="tab" aria-selected="${k===kind}">${v.label}</button>`).join('')}</div>
   <div class="search-wrap bx-search"><span>⌕</span><input id="bxSearch" placeholder="Search patient, embryo or sample ID…" value="${esc(q)}"></div>
   <button type="button" class="secondary compact${fOpen?' active':''}" id="bxFltToggle" aria-expanded="${fOpen}">⚲ Filters <b class="filters-badge${nFlt?' has-active':''}">${nFlt}</b></button></div>
  <div class="bx-filters${fOpen?'':' hidden'}">
   <select class="bx-pill${flt.recv?' on':''}" data-flt="recv" aria-label="Received">${RECV.map(([v,l])=>`<option value="${v}"${flt.recv===v?' selected':''}>Received: ${l}</option>`).join('')}</select>
   ${custom?`<span class="bx-range"><input type="date" data-flt="from" value="${esc(flt.from)}" aria-label="Received from"${flt.to?` max="${esc(flt.to)}"`:''}><span>to</span><input type="date" data-flt="to" value="${esc(flt.to)}" aria-label="Received to"${flt.from?` min="${esc(flt.from)}"`:''}></span>`:''}
   ${defs.map(([k,l])=>{const o=optsOf(k);return `<select class="bx-pill${flt[k]?' on':''}" data-flt="${k}" aria-label="${l}"${o.length?'':' disabled title="Not filled in the sheet for these embryos yet"'}><option value="">${l}: ${o.length?'All':'No data'}</option>${o.map(v=>`<option value="${esc(v)}"${flt[k]===v?' selected':''}>${flt[k]===v?`${esc(l)}: `:''}${esc(v)}</option>`).join('')}</select>`}).join('')}
   ${nFlt?'<button type="button" class="text-button bx-fclear" id="bxFltClear">Clear all</button>':''}</div>
  <div class="bx-bar"><div><strong>${all.length}</strong> embryos waiting for ${kind==='wga'?'WGA':'sequencing'}${rows.length!==all.length?` · ${rows.length} shown`:''}<button type="button" class="text-button bx-made-btn" id="bxMade">${KIND[kind].plural} made here (${made})</button></div>
   <div class="bx-bar-act"><span class="bx-count" title="${esc(selTests)}">${picked.size} selected${picked.size?` <small>· ${selPatients} patient${selPatients>1?'s':''}</small>`:''}</span>${noWga?`<span class="bx-warn" title="These embryos have no WGA date yet">${noWga} without WGA</span>`:''}<button type="button" class="secondary compact" id="bxClear"${picked.size?'':' disabled'}>Clear</button><button type="button" class="primary" id="bxMake"${picked.size?'':' disabled'}>Create ${kind==='wga'?'WGA batch':'sequencing run'}</button></div></div>
  <div class="bx-table-wrap" id="bxTable">${groups.length?`<table class="prep-table bx-table bx-${kind}"><thead><tr><th class="bx-ck"><input type="checkbox" id="bxAll" aria-label="Select all shown"${rows.length&&rows.every(r=>picked.has(r.key))?' checked':''}></th>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${groups.map(g=>{const on=g.rows.every(r=>picked.has(r.key));return g.rows.map((r,i)=>`<tr class="${picked.has(r.key)?'on':''}${i===0?' bx-first':''}" data-key="${esc(r.key)}"><td class="bx-ck"><input type="checkbox"${picked.has(r.key)?' checked':''} aria-label="Select ${esc(r.patient)} ${esc(r.embryo)}"></td>${cols.map(c=>c[1]!=='patient'?c[1](r):i===0?`<td class="strong bx-pat" rowspan="${g.rows.length}"><div class="bx-pat-in"><label><input type="checkbox" class="bx-pck" data-patient="${esc(g.patient)}"${on?' checked':''}> ${esc(g.patient)}</label><small>${g.rows.length} embryo${g.rows.length>1?'s':''}</small></div></td>`:'').join('')}</tr>`).join('')}).join('')}</tbody></table>`:`<div class="chart-empty">No embryos waiting for ${kind==='wga'?'WGA':'sequencing'}${needle||nFlt?' match these filters':''}.</div>`}</div>
 </div>`;
 root._rows=rows;
 const tw=$('#bxTable');fitTableHeight(tw);if(tw)tw.scrollTop=prevScroll}

function nextNo(k){const nums=[...(k==='wga'?sheetWga:sheetSeq).map(b=>b.runId),...list.filter(b=>b.kind===k).map(b=>b.meta.batchNo)].map(v=>/^\d+$/.test(String(v||'').trim())?+v:0);return String(Math.max(0,...nums)+1)}
function lastKit(){const mine=list.filter(b=>b.kind==='wga'&&b.kit?.name).pop();if(mine)return mine.kit;const s=[...sheetWga].reverse().find(b=>b.kit?.name);return s?.kit||{}}

// Batches made on this page, newest first: download the Excel block again, or delete one (its embryos return to the list).
function openMade(){
 const K=KIND[kind],d=document.createElement('dialog');d.className='vu-dialog fu-dialog bx-dlg';document.body.append(d);d.addEventListener('close',()=>d.remove());
 const draw=()=>{const mine=list.filter(b=>b.kind===kind).slice().reverse();
  d.innerHTML=`<div class="vu-dhead"><h3>${K.plural} made here</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><div class="bx-made">${mine.length?mine.map(b=>`<div class="bx-card"><div><strong>${esc(K.noun)} ${esc(b.meta.batchNo)}</strong><small>${esc(b.meta.date||'')} · ${b.samples.length} sample${b.samples.length>1?'s':''} · ${esc(b.createdBy)} · ${esc(b.createdAt)}</small></div><span class="bx-sent ${b.sent?'ok':''}" title="${esc(b.error||'')}">${b.sent?'In edits sheet':'Sending to edits sheet…'}</span><a class="secondary compact" href="/api/batches/${encodeURIComponent(b.id)}/xlsx" download>Download</a><button type="button" class="text-button bx-del" data-id="${esc(b.id)}">Delete</button></div>`).join(''):`<p class="muted">None yet - pick embryos and create one.</p>`}</div></div>`};
 draw();
 d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]')){d.close();return}
  const del=e.target.closest('.bx-del');if(!del)return;const b=list.find(x=>x.id===del.dataset.id);
  if(b&&confirm(`Delete ${KIND[b.kind].noun} ${b.meta.batchNo}? Its embryos go back to the pending list and its rows leave the edits sheet. The live batch sheet is not touched.`))
   fetch(`/api/batches/${encodeURIComponent(b.id)}`,{method:'DELETE'}).then(r=>{if(!r.ok)throw 0;toast('Batch deleted');return load()}).then(()=>{draw();render()}).catch(()=>toast('Could not delete'))});
 d.showModal()}

function openCreate(){
 const K=KIND[kind],sel=pending(kind).filter(r=>picked.has(r.key)),kit=lastKit(),d=document.createElement('dialog');
 d.className='vu-dialog fu-dialog bx-dlg';document.body.append(d);d.addEventListener('close',()=>d.remove());
 const f=(name,label,val='',type='text',extra='')=>`<label class="fu-f"><span>${label}</span><input name="${name}" type="${type}" value="${esc(val)}" autocomplete="off"${extra}></label>`;
 d.innerHTML=`<div class="vu-dhead"><h3>Create ${kind==='wga'?'WGA batch':'sequencing run'}</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody">
  <p class="fu-note" style="margin-top:0">${sel.length} embryo${sel.length>1?'s':''} from ${new Set(sel.map(r=>r.patient)).size} patient${new Set(sel.map(r=>r.patient)).size>1?'s':''}. It is saved here and in the edits sheet; download it to paste into the live batch sheet.</p>
  <h4 class="bx-sec">Batch identification</h4><div class="fu-grid">${f('batchNo',K.noLabel+' *',nextNo(kind))}${f('date',K.dateLabel,today(),'date')}${f('instrument',K.instLabel,K.instDefault)}${f('instrumentId','Instrument ID')}${kind==='seq'?f('seqType','Seq type')+f('operator','Operator'):''}</div>
  ${kind==='wga'?`<h4 class="bx-sec">Kit / reagent</h4><div class="fu-grid">${f('k_name','Kit / reagent',kit.name||'')}${f('k_manufacturer','Manufacturer',kit.manufacturer||'')}${f('k_lot','Lot no.',kit.lot||'')}${f('k_expiry','Expiry date',kit.expiry||'')}${f('k_qty','Qty used',String(sel.length),'number',' min="0"')}${f('k_preparedBy','Prepared by',kit.preparedBy||'')}${f('k_checkedBy','Checked by',kit.checkedBy||'')}</div>`:''}
  <h4 class="bx-sec">Samples</h4><div class="fu-grid">${f('sampleType','Sample type',sampleType)}${kind==='wga'?f('indexStart','First barcode number (V…)',String(idxStart),'number',' min="1"'):f('indexStart','First index number (V…, blank = leave empty)','','number',' min="1"')}</div>
  <div class="fu-actions"><button type="button" class="primary" id="bxGo">Create and download</button></div><p class="fu-note" id="bxErr" role="alert" style="color:#b3261e;font-weight:600;margin:12px 0 0"></p></div>`;
 d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()});
 d.querySelector('#bxGo').onclick=async ev=>{const b=ev.currentTarget,v=n=>d.querySelector(`[name="${n}"]`)?.value.trim()||'',err=d.querySelector('#bxErr');
  const start=parseInt(v('indexStart'),10),meta={batchNo:v('batchNo'),date:dmy(v('date')),instrument:v('instrument'),instrumentId:v('instrumentId'),seqType:v('seqType'),operator:v('operator')};
  if(!meta.batchNo){err.textContent=K.noLabel+' is required';return}
  const kitOut=kind==='wga'?{process:'WGA',name:v('k_name'),manufacturer:v('k_manufacturer'),lot:v('k_lot'),expiry:v('k_expiry'),qty:v('k_qty'),preparedBy:v('k_preparedBy'),checkedBy:v('k_checkedBy')}:{};
  const samples=sel.map((r,i)=>({key:r.key,patient:r.patient,embryo:r.embryo,sampleId:r.sampleId,test:r.test,biopsy:r.biopsy,received:r.received,sampleType:v('sampleType'),
   dnaConc:r.dnaConc,purified:kind==='wga'?r.purified:'',index:Number.isFinite(start)?idxLabel(start+i):''}));
  b.disabled=true;err.textContent='';
  try{const r=await fetch('/api/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,meta,kit:kitOut,samples})}),j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:'Could not create (error '+r.status+')');
   const a=document.createElement('a');a.href=`/api/batches/${encodeURIComponent(j.id)}/xlsx`;a.download='';document.body.append(a);a.click();a.remove();
   toast(`${K.noun} ${j.meta.batchNo} created - ${j.samples.length} samples`);if(kind==='wga'&&Number.isFinite(start))idxStart=start+samples.length;if(v('sampleType'))sampleType=v('sampleType');picked.clear();d.close();await load();render()}
  catch(x){err.textContent=x.message;b.disabled=false}};
 d.showModal()}

function onClick(e){
 const t=e.target;
 const kb=t.closest('[data-kind]');if(kb){if(kb.dataset.kind!==kind){kind=kb.dataset.kind;picked.clear();render()}return}
 if(t.closest('#bxFltToggle')){fOpen=!fOpen;render();return}
 if(t.id==='bxFltClear'){Object.keys(flt).forEach(k=>flt[k]='');render();return}
 if(t.id==='bxClear'){picked.clear();render();return}
 if(t.id==='bxMake'){openCreate();return}
 if(t.id==='bxMade'){openMade();return}
 if(t.id==='bxAll'){(root._rows||[]).forEach(r=>t.checked?picked.add(r.key):picked.delete(r.key));render();return}
 if(t.classList.contains('bx-pck')){(root._rows||[]).filter(r=>r.patient===t.dataset.patient).forEach(r=>t.checked?picked.add(r.key):picked.delete(r.key));render();return}
 const tr=t.closest('tbody tr[data-key]');if(tr&&!t.closest('a,button,label')){const k=tr.dataset.key,on=t.type==='checkbox'?t.checked:!picked.has(k);
  // Shift-click selects (or clears) every shown row between the last one clicked and this one.
  const rs=root._rows||[],i=rs.findIndex(r=>r.key===k),j=rs.findIndex(r=>r.key===lastKey);
  (e.shiftKey&&j>=0?rs.slice(Math.min(i,j),Math.max(i,j)+1):[{key:k}]).forEach(r=>on?picked.add(r.key):picked.delete(r.key));
  lastKey=k;render()}}

window.addEventListener('resize',()=>fitTableHeight($('#bxTable')));
window.renderBatchCreationView=async function(container){
 root=container;root.innerHTML='<div class="chart-empty">Loading…</div>';
 if(!container._bxWired){container._bxWired=true;container.addEventListener('click',onClick);
  container.addEventListener('input',e=>{if(e.target.id==='bxSearch'){q=e.target.value;const pos=e.target.selectionStart;render();const s=$('#bxSearch');s.focus();s.setSelectionRange(pos,pos)}});
  container.addEventListener('change',e=>{if(e.target.dataset.flt){flt[e.target.dataset.flt]=e.target.value;render()}})}
 await load();if(root===container)render()};
})();
