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
let root=null,kind='wga',list=[],sheetWga=[],sheetSeq=[],picked=new Set,q='',testF='';

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
    received,biopsy:field(e,['date of biopsy']),dnaConc:field(e,['wga conc unpurified','wga conc'])||'',
    wga:field(e,['wga done on'])||inWga.get(kk)||''})})}
 const first=new Map;out.forEach(r=>{const p=r.patient.toUpperCase(),d=dmyKey(r.received);if(!first.has(p)||first.get(p)>d)first.set(p,d)});
 return out.sort((a,b)=>first.get(a.patient.toUpperCase()).localeCompare(first.get(b.patient.toUpperCase()))||a.patient.localeCompare(b.patient)||a.embryo.localeCompare(b.embryo,undefined,{numeric:true}))}

function render(){
 const all=pending(kind),tests=[...new Set(all.map(r=>r.test).filter(Boolean))].sort(),needle=q.trim().toLowerCase();
 if(testF&&!tests.includes(testF))testF='';
 const rows=all.filter(r=>(!testF||r.test===testF)&&(!needle||[r.patient,r.embryo,r.sampleId,r.test].join(' ').toLowerCase().includes(needle)));
 const keys=new Set(all.map(r=>r.key));picked.forEach(k=>{if(!keys.has(k))picked.delete(k)});
 const groups=[];rows.forEach(r=>{const g=groups[groups.length-1];if(g&&g.patient===r.patient)g.rows.push(r);else groups.push({patient:r.patient,rows:[r]})});
 root.innerHTML=`<div class="bx">
  <div class="bx-top"><div class="prep-segments bx-kind" role="tablist">${Object.entries(KIND).map(([k,v])=>`<button type="button" class="prep-seg${k===kind?' active':''}" data-kind="${k}" role="tab" aria-selected="${k===kind}">${v.label}</button>`).join('')}</div>
   <div class="search-wrap bx-search"><span>⌕</span><input id="bxSearch" placeholder="Search patient, embryo or sample ID…" value="${esc(q)}"></div>
   <select id="bxTest" class="chart-filter" aria-label="Test"><option value="">All tests</option>${tests.map(t=>`<option${t===testF?' selected':''}>${esc(t)}</option>`).join('')}</select></div>
  <div class="bx-bar"><div><strong>${all.length}</strong> embryos waiting for ${kind==='wga'?'WGA':'sequencing'}${rows.length!==all.length?` · ${rows.length} shown`:''}</div>
   <div class="bx-bar-act"><span class="bx-count">${picked.size} selected</span><button type="button" class="secondary compact" id="bxClear"${picked.size?'':' disabled'}>Clear</button><button type="button" class="primary" id="bxMake"${picked.size?'':' disabled'}>Create ${kind==='wga'?'WGA batch':'sequencing run'}</button></div></div>
  <div class="bx-table-wrap" id="bxTable">${groups.length?`<table class="prep-table bx-table"><thead><tr><th class="bx-ck"><input type="checkbox" id="bxAll" aria-label="Select all shown"${rows.length&&rows.every(r=>picked.has(r.key))?' checked':''}></th><th>Patient</th><th>Embryo</th><th>Sample ID</th><th>Test</th><th>Received</th><th>Biopsy</th>${kind==='seq'?'<th>WGA</th>':''}</tr></thead><tbody>${groups.map(g=>{const on=g.rows.every(r=>picked.has(r.key));return g.rows.map((r,i)=>`<tr class="${picked.has(r.key)?'on':''}${i===0?' bx-first':''}" data-key="${esc(r.key)}"><td class="bx-ck"><input type="checkbox"${picked.has(r.key)?' checked':''} aria-label="Select ${esc(r.patient)} ${esc(r.embryo)}"></td>${i===0?`<td class="strong bx-pat" rowspan="${g.rows.length}"><label><input type="checkbox" class="bx-pck" data-patient="${esc(g.patient)}"${on?' checked':''}> ${esc(g.patient)}</label><small>${g.rows.length} embryo${g.rows.length>1?'s':''}</small></td>`:''}<td class="mono">${esc(r.embryo)}</td><td class="mono">${esc(r.sampleId||'—')}</td><td>${esc(r.test||'—')}</td><td class="muted">${esc(r.received)}</td><td class="muted">${esc(r.biopsy||'—')}</td>${kind==='seq'?`<td>${r.wga?`<span class="bx-wga ok">${esc(r.wga)}</span>`:'<span class="bx-wga">Not yet</span>'}</td>`:''}</tr>`).join('')}).join('')}</tbody></table>`:`<div class="chart-empty">No embryos waiting for ${kind==='wga'?'WGA':'sequencing'}${needle||testF?' match these filters':''}.</div>`}</div>
 </div>`;
 root._rows=rows;
 fitTableHeight($('#bxTable'))}

function nextNo(k){const nums=[...(k==='wga'?sheetWga:sheetSeq).map(b=>b.runId),...list.filter(b=>b.kind===k).map(b=>b.meta.batchNo)].map(v=>/^\d+$/.test(String(v||'').trim())?+v:0);return String(Math.max(0,...nums)+1)}
function lastKit(){const mine=list.filter(b=>b.kind==='wga'&&b.kit?.name).pop();if(mine)return mine.kit;const s=[...sheetWga].reverse().find(b=>b.kit?.name);return s?.kit||{}}

function openCreate(){
 const K=KIND[kind],sel=pending(kind).filter(r=>picked.has(r.key)),kit=lastKit(),d=document.createElement('dialog');
 d.className='vu-dialog fu-dialog bx-dlg';document.body.append(d);d.addEventListener('close',()=>d.remove());
 const f=(name,label,val='',type='text',extra='')=>`<label class="fu-f"><span>${label}</span><input name="${name}" type="${type}" value="${esc(val)}" autocomplete="off"${extra}></label>`;
 d.innerHTML=`<div class="vu-dhead"><h3>Create ${kind==='wga'?'WGA batch':'sequencing run'}</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody">
  <p class="fu-note" style="margin-top:0">${sel.length} embryo${sel.length>1?'s':''} from ${new Set(sel.map(r=>r.patient)).size} patient${new Set(sel.map(r=>r.patient)).size>1?'s':''}. It is saved here and in the edits sheet; download it to paste into the live batch sheet.</p>
  <h4 class="bx-sec">Batch identification</h4><div class="fu-grid">${f('batchNo',K.noLabel+' *',nextNo(kind))}${f('date',K.dateLabel,today(),'date')}${f('instrument',K.instLabel,K.instDefault)}${f('instrumentId','Instrument ID')}${kind==='seq'?f('seqType','Seq type')+f('operator','Operator'):''}</div>
  ${kind==='wga'?`<h4 class="bx-sec">Kit / reagent</h4><div class="fu-grid">${f('k_name','Kit / reagent',kit.name||'')}${f('k_manufacturer','Manufacturer',kit.manufacturer||'')}${f('k_lot','Lot no.',kit.lot||'')}${f('k_expiry','Expiry date',kit.expiry||'')}${f('k_qty','Qty used',String(sel.length),'number',' min="0"')}${f('k_preparedBy','Prepared by',kit.preparedBy||'')}${f('k_checkedBy','Checked by',kit.checkedBy||'')}</div>`:''}
  <h4 class="bx-sec">Samples</h4><div class="fu-grid">${f('sampleType','Sample type','EMBRYO BIOPSY D-5')}${kind==='wga'?f('indexStart','First barcode number (V…)','1','number',' min="1"'):f('indexStart','First index number (V…, blank = leave empty)','','number',' min="1"')}</div>
  <div class="fu-actions"><button type="button" class="primary" id="bxGo">Create and download</button></div><p class="fu-note" id="bxErr" role="alert" style="color:#b3261e;font-weight:600;margin:12px 0 0"></p></div>`;
 d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()});
 d.querySelector('#bxGo').onclick=async ev=>{const b=ev.currentTarget,v=n=>d.querySelector(`[name="${n}"]`)?.value.trim()||'',err=d.querySelector('#bxErr');
  const start=parseInt(v('indexStart'),10),meta={batchNo:v('batchNo'),date:dmy(v('date')),instrument:v('instrument'),instrumentId:v('instrumentId'),seqType:v('seqType'),operator:v('operator')};
  if(!meta.batchNo){err.textContent=K.noLabel+' is required';return}
  const kitOut=kind==='wga'?{process:'WGA',name:v('k_name'),manufacturer:v('k_manufacturer'),lot:v('k_lot'),expiry:v('k_expiry'),qty:v('k_qty'),preparedBy:v('k_preparedBy'),checkedBy:v('k_checkedBy')}:{};
  const samples=sel.map((r,i)=>({key:r.key,patient:r.patient,embryo:r.embryo,sampleId:r.sampleId,test:r.test,biopsy:r.biopsy,received:r.received,sampleType:v('sampleType'),
   dnaConc:kind==='seq'?r.dnaConc:'',index:Number.isFinite(start)?`V${String(start+i).padStart(3,'0')}`:''}));
  b.disabled=true;err.textContent='';
  try{const r=await fetch('/api/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,meta,kit:kitOut,samples})}),j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(typeof j.detail==='string'?j.detail:'Could not create (error '+r.status+')');
   const a=document.createElement('a');a.href=`/api/batches/${encodeURIComponent(j.id)}/xlsx`;a.download='';document.body.append(a);a.click();a.remove();
   toast(`${K.noun} ${j.meta.batchNo} created - ${j.samples.length} samples`);picked.clear();d.close();await load();render()}
  catch(x){err.textContent=x.message;b.disabled=false}};
 d.showModal()}

function onClick(e){
 const t=e.target;
 const kb=t.closest('[data-kind]');if(kb){if(kb.dataset.kind!==kind){kind=kb.dataset.kind;picked.clear();render()}return}
 if(t.id==='bxClear'){picked.clear();render();return}
 if(t.id==='bxMake'){openCreate();return}
 if(t.id==='bxAll'){(root._rows||[]).forEach(r=>t.checked?picked.add(r.key):picked.delete(r.key));render();return}
 if(t.classList.contains('bx-pck')){(root._rows||[]).filter(r=>r.patient===t.dataset.patient).forEach(r=>t.checked?picked.add(r.key):picked.delete(r.key));render();return}
 const tr=t.closest('tbody tr[data-key]');if(tr&&!t.closest('a,button,label')){const k=tr.dataset.key;if(t.type!=='checkbox'){picked.has(k)?picked.delete(k):picked.add(k)}else{t.checked?picked.add(k):picked.delete(k)}render()}}

window.addEventListener('resize',()=>fitTableHeight($('#bxTable')));
window.renderBatchCreationView=async function(container){
 root=container;root.innerHTML='<div class="chart-empty">Loading…</div>';
 if(!container._bxWired){container._bxWired=true;container.addEventListener('click',onClick);
  container.addEventListener('input',e=>{if(e.target.id==='bxSearch'){q=e.target.value;const pos=e.target.selectionStart;render();const s=$('#bxSearch');s.focus();s.setSelectionRange(pos,pos)}});
  container.addEventListener('change',e=>{if(e.target.id==='bxTest'){testF=e.target.value;render()}})}
 await load();if(root===container)render()};
})();
