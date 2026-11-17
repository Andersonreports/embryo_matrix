// Approve results: every embryo result uploaded through "Upload result" waits here until it is approved.
// Clients see a result only after approval. Each result file is shown with its OWN columns (exactly the
// headers of the uploaded file), one row per embryo. Files are grouped into month tabs (the last 4 months).
// Approve one row, or tick several (or all) and approve together.
(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=iso=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
 const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 const monLabel=ym=>{const [y,m]=String(ym).split('-');return MON[+m-1]?`${MON[+m-1]} ${y}`:'No month'};
 const say=m=>{if(typeof toast==='function')toast(m)};
 let pollTimer,data={files:[],canApprove:false},filter='pending',q='',month='',picked=new Set,openFiles=new Set,container=null,busy=false;
 const SEP='|~|',id=(f,s)=>`${f.id}${SEP}${s.key}`;
 const itemOf=k=>{const i=k.indexOf(SEP);return{fileId:k.slice(0,i),key:k.slice(i+SEP.length)}};
 const statusOk=s=>filter==='all'||(filter==='pending'?!s.approved:!!s.approved);
 const matches=(f,s)=>statusOk(s)&&(!q||[f.fileName,f.run,s.name,...(s.values||[])].join(' ').toLowerCase().includes(q));
 const inMonth=f=>!month||f.month===month;
 const visible=()=>data.files.filter(inMonth).map(f=>({f,rows:f.samples.filter(s=>matches(f,s))})).filter(x=>x.rows.length);
 // month tabs: the last 4 months (newest first), plus the month of any older upload still waiting
 const tabs=()=>{const t=[...(data.monthTabs||[])];data.files.forEach(f=>{if(!t.includes(f.month||''))t.push(f.month||'')});return t};

 async function load(){
  try{const r=await fetch('/api/result-approvals');if(!r.ok)throw new Error(r.status);data=await r.json()}
  catch(e){container.innerHTML='<div class="generic-card wide-card"><div class="chart-empty">Could not load results waiting for approval.</div></div>';return}
  clearTimeout(pollTimer);if(data.stillReading)pollTimer=setTimeout(()=>{if(container&&container.querySelector('.ap-card'))load()},1500);
  const live=new Set;data.files.forEach(f=>f.samples.forEach(s=>{if(!s.approved)live.add(id(f,s))}));picked=new Set([...picked].filter(k=>live.has(k)));
  // first open: the newest month that has something pending (else the newest month)
  if(!month||!tabs().includes(month)){const ts=tabs();month=ts.find(m=>data.files.some(f=>f.month===m&&f.samples.some(s=>!s.approved)))||ts[0]||''}
  render()}

 async function send(items,approve){
  if(busy||!items.length)return;busy=true;render();
  try{const r=await fetch('/api/result-approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{items,approve}})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.detail||'Could not save');
   say(approve?`${d.changed} result(s) approved`:`Approval withdrawn for ${d.changed} result(s)`);items.forEach(it=>picked.delete(`${it.fileId}${SEP}${it.key}`))}
  catch(e){say(e.message||'Could not save')}
  busy=false;await load()}

 function render(){
  const can=data.canApprove,mf=data.files.filter(inMonth),all=mf.flatMap(f=>f.samples),pending=all.filter(s=>!s.approved).length,groups=visible();
  const pendOf=m=>data.files.filter(f=>(f.month||'')===m).reduce((n,f)=>n+f.samples.filter(s=>!s.approved).length,0);
  container.innerHTML=`<div class="generic-card wide-card ap-card">
   <p class="ap-intro">Results from uploaded files reach the client only after they are approved here. Each file shows its own columns.${can?'':' <b>Only an admin or senior executive can approve.</b>'}</p>
   ${data.stillReading?`<div class="ap-reading">Reading the columns of ${data.stillReading} earlier result file(s)… this happens only once.</div>`:''}
   <div class="ap-months" role="tablist">${tabs().map(m=>{const n=pendOf(m),files=data.files.filter(f=>(f.month||'')===m).length;return `<button type="button" class="ap-month${m===month?' on':''}" data-month="${esc(m)}"><span>${esc(monLabel(m))}</span><small>${files?`${n} pending · ${files} file${files>1?'s':''}`:'no files'}</small></button>`}).join('')}</div>
   <div class="ap-toolbar">
    <div class="ap-tabs" role="tablist">${[['pending','Pending',pending],['approved','Approved',all.length-pending],['all','All',all.length]].map(([k,l,n])=>`<button type="button" class="ap-tab${filter===k?' on':''}" data-filter="${k}">${l} <b>${n}</b></button>`).join('')}</div>
    <div class="search-wrap ap-search"><span>⌕</span><input id="apSearch" placeholder="Search file, run, patient or any value…" value="${esc(q)}"></div>
    ${can?`<label class="ap-all"><input type="checkbox" id="apAll"> Select all shown</label>
    <button type="button" class="primary" id="apApproveSel" disabled>Approve selected</button>`:''}
   </div>
   ${groups.length?groups.map(({f,rows})=>fileBlock(f,rows,can)).join(''):`<div class="chart-empty ap-empty">${mf.length?(filter==='pending'&&!q?`Every result of ${esc(monLabel(month))} is approved.`:'Nothing matches.'):`No result files for ${esc(monLabel(month))}.`}</div>`}
  </div>`;
  syncPicks()}

 // Reflect the current selection on the page without redrawing it: row ticks, file / all boxes, button count.
 function syncPicks(){
  const card=container.querySelector('.ap-card');if(!card)return;
  card.querySelectorAll('input[data-pick]').forEach(cb=>{const on=picked.has(cb.dataset.pick);cb.checked=on;cb.closest('tr')?.classList.toggle('ap-picked',on)});
  const groups=visible(),sel=groups.flatMap(({f,rows})=>rows.filter(s=>!s.approved).map(s=>id(f,s)));
  card.querySelectorAll('input[data-file-all]').forEach(cb=>{const g=groups.find(x=>x.f.id===cb.dataset.fileAll),ks=(g?.rows||[]).filter(s=>!s.approved).map(s=>id(g.f,s));cb.checked=ks.length>0&&ks.every(k=>picked.has(k));cb.indeterminate=!cb.checked&&ks.some(k=>picked.has(k))});
  const all=card.querySelector('#apAll');if(all){all.disabled=!sel.length;all.checked=sel.length>0&&sel.every(k=>picked.has(k));all.indeterminate=!all.checked&&sel.some(k=>picked.has(k))}
  const b=card.querySelector('#apApproveSel');if(b){b.disabled=!picked.size||busy;b.textContent=`Approve selected${picked.size?` (${picked.size})`:''}`}}

 function fileBlock(f,rows,can){
  const open=openFiles.has(f.id)||rows.length<=60,shown=open?rows:rows.slice(0,60),pend=rows.filter(s=>!s.approved),cols=f.columns||[];
  return `<section class="ap-file">
   <header class="ap-file-head">
    <div><span class="rf-run${f.run?'':' none'}">${esc(f.run||'No run no.')}</span> <strong title="${esc(f.fileName)}">${esc(f.fileName)}</strong>
     <small>Uploaded ${esc(fmt(f.at))}${f.by?` by ${esc(f.by)}`:''} · ${f.samples.filter(s=>s.approved).length}/${f.samples.length} approved${f.columnsNote?` · <span class="ap-note">Columns not shown: ${esc(f.columnsNote)}</span>`:''}</small></div>
    ${can&&pend.length?`<button type="button" class="secondary compact" data-approve-file="${esc(f.id)}"${busy?' disabled':''}>Approve all ${pend.length} in this file</button>`:''}
   </header>
   <div class="ap-scroll"><table class="ap-table${can?'':' ro'}"><thead><tr>
    ${can?`<th class="ap-chk"><input type="checkbox" data-file-all="${esc(f.id)}"${pend.length?'':' disabled'} title="Select every pending embryo of this file"></th>`:''}
    <th class="ap-status">Status</th>${cols.length?cols.map(c=>`<th>${esc(c)}</th>`).join(''):'<th>Sample</th>'}${can?'<th class="ap-act"></th>':''}
   </tr></thead><tbody>${shown.map(s=>{const k=id(f,s),vals=s.values||[],red=new Set(s.red||[]);return `<tr class="${s.approved?'ap-done':''}">
    ${can?`<td class="ap-chk">${s.approved?'':`<input type="checkbox" data-pick="${esc(k)}" aria-label="Select ${esc(s.name||'embryo')}">`}</td>`:''}
    <td class="ap-status">${s.approved?`<span class="ap-pill ok" title="${esc(`Approved by ${s.approved.by||'unknown'} · ${fmt(s.approved.at)}`)}">Approved</span>`:'<span class="ap-pill wait">Pending</span>'}</td>
    ${cols.length?cols.map((c,i)=>{const v=vals[i]??'',cls=[v.length>40?'ap-wrap':'',red.has(i)?'ap-red':''].filter(Boolean).join(' ');return `<td${cls?` class="${cls}"`:''}${v.length>40?` title="${esc(v)}"`:''}>${esc(v)}</td>`}).join(''):`<td>${esc(s.name||s.key)}</td>`}
    ${can?`<td class="ap-act">${s.approved?`<button type="button" class="ap-undo" data-unapprove="${esc(k)}"${busy?' disabled':''}>Undo</button>`:`<button type="button" class="ap-btn" data-approve="${esc(k)}"${busy?' disabled':''}>Approve</button>`}</td>`:''}
   </tr>`}).join('')}</tbody></table></div>
   ${shown.length<rows.length?`<button type="button" class="text-button ap-more" data-open-file="${esc(f.id)}">Show all ${rows.length} rows</button>`:''}
  </section>`}

 const setMany=(keys,on)=>keys.forEach(k=>on?picked.add(k):picked.delete(k));
 function wire(){
  container.addEventListener('click',e=>{
   const card=e.target.closest('.ap-card');if(!card)return;
   // the whole tick-box cell toggles its box (a bigger target than the 16px box itself)
   const cell=e.target.closest('td.ap-chk');if(cell&&e.target.tagName!=='INPUT'){const cb=cell.querySelector('input[data-pick]');if(cb){cb.checked=!cb.checked;cb.dispatchEvent(new Event('change',{bubbles:true}))}return}
   const t=e.target.closest('button');if(!t)return;
   if(t.dataset.month!==undefined){if(t.dataset.month!==month){month=t.dataset.month;picked.clear()}render();return}
   if(t.dataset.filter){filter=t.dataset.filter;render();return}
   if(t.id==='apApproveSel'){const n=picked.size;if(n>1&&!confirm(`Approve ${n} embryo results? The client will be able to see them.`))return;send([...picked].map(itemOf),true);return}
   if(t.dataset.approve){send([itemOf(t.dataset.approve)],true);return}
   if(t.dataset.unapprove){if(confirm('Withdraw approval? The client will no longer see this result.'))send([itemOf(t.dataset.unapprove)],false);return}
   if(t.dataset.approveFile){const f=data.files.find(x=>x.id===t.dataset.approveFile);if(!f)return;const items=f.samples.filter(s=>!s.approved).map(s=>({fileId:f.id,key:s.key}));
    if(confirm(`Approve all ${items.length} pending result(s) in ${f.fileName}? The client will be able to see them.`))send(items,true);return}
   if(t.dataset.openFile){openFiles.add(t.dataset.openFile);render()}});
  container.addEventListener('change',e=>{const t=e.target;if(!t.closest||!t.closest('.ap-card'))return;
   if(t.dataset.pick){setMany([t.dataset.pick],t.checked);syncPicks();return}
   if(t.dataset.fileAll){const g=visible().find(x=>x.f.id===t.dataset.fileAll);if(g)setMany(g.rows.filter(s=>!s.approved).map(s=>id(g.f,s)),t.checked);syncPicks();return}
   if(t.id==='apAll'){setMany(visible().flatMap(({f,rows})=>rows.filter(s=>!s.approved).map(s=>id(f,s))),t.checked);syncPicks()}});
  let timer;container.addEventListener('input',e=>{if(e.target.id!=='apSearch')return;clearTimeout(timer);const v=e.target.value;timer=setTimeout(()=>{q=v.trim().toLowerCase();const pos=e.target.selectionStart;render();const s=container.querySelector('#apSearch');if(s){s.focus();try{s.setSelectionRange(pos,pos)}catch{}}},200)})}

 window.renderApproveResultsView=function(g){
  container=g;if(!g._apWired){wire();g._apWired=true}
  g.innerHTML='<div class="generic-card wide-card"><div class="chart-empty">Loading…</div></div>';load()};
})();
