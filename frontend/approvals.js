// Approve results: every embryo result uploaded through "Upload result" waits here until it is approved.
// Clients see a result only after approval. Each result file is shown with its OWN columns (exactly the
// headers of the uploaded file), one row per embryo. Approve one row, or tick several (or all) and approve together.
(function(){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=iso=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
 const say=m=>{if(typeof toast==='function')toast(m)};
 let pollTimer,data={files:[],canApprove:false},filter='pending',q='',picked=new Set,openFiles=new Set,container=null,busy=false;
 const id=(f,s)=>`${f.id}\u0001${s.key}`;
 const matches=(f,s)=>{if(filter==='pending'&&s.approved)return false;if(filter==='approved'&&!s.approved)return false;
  if(!q)return true;return [f.fileName,f.run,s.name,...(s.values||[])].join(' ').toLowerCase().includes(q)};
 const visible=()=>data.files.map(f=>({f,rows:f.samples.filter(s=>matches(f,s))})).filter(x=>x.rows.length);

 async function load(){
  try{const r=await fetch('/api/result-approvals');if(!r.ok)throw new Error(r.status);data=await r.json()}
  catch(e){container.innerHTML='<div class="generic-card wide-card"><div class="chart-empty">Could not load results waiting for approval.</div></div>';return}
  // drop selections that are gone / already approved
  clearTimeout(pollTimer);if(data.stillReading)pollTimer=setTimeout(()=>{if(container&&container.querySelector('.ap-card'))load()},1500);
  const live=new Set;data.files.forEach(f=>f.samples.forEach(s=>{if(!s.approved)live.add(id(f,s))}));picked=new Set([...picked].filter(k=>live.has(k)));
  render()}

 async function send(items,approve){
  if(busy||!items.length)return;busy=true;render();
  try{const r=await fetch('/api/result-approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{items,approve}})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.detail||'Could not save');
   say(approve?`${d.changed} result(s) approved`:`Approval withdrawn for ${d.changed} result(s)`);items.forEach(it=>picked.delete(`${it.fileId}\u0001${it.key}`))}
  catch(e){say(e.message||'Could not save')}
  busy=false;await load()}

 function render(){
  const all=data.files.flatMap(f=>f.samples),pending=all.filter(s=>!s.approved).length,approved=all.length-pending,groups=visible(),can=data.canApprove;
  const selectable=groups.flatMap(({f,rows})=>rows.filter(s=>!s.approved).map(s=>id(f,s)));
  const allOn=selectable.length&&selectable.every(k=>picked.has(k));
  container.innerHTML=`<div class="generic-card wide-card ap-card">
   <p class="ap-intro">Results from uploaded files reach the client only after they are approved here. Each file shows its own columns.${can?'':' <b>Only an admin or senior executive can approve.</b>'}</p>
   ${data.stillReading?`<div class="ap-reading">Reading the columns of ${data.stillReading} earlier result file(s)… this happens only once.</div>`:''}
   <div class="ap-toolbar">
    <div class="ap-tabs" role="tablist">${[['pending','Pending',pending],['approved','Approved',approved],['all','All',all.length]].map(([k,l,n])=>`<button type="button" class="ap-tab${filter===k?' on':''}" data-filter="${k}">${l} <b>${n}</b></button>`).join('')}</div>
    <div class="search-wrap ap-search"><span>⌕</span><input id="apSearch" placeholder="Search file, run, patient or any value…" value="${esc(q)}"></div>
    ${can?`<label class="ap-all"><input type="checkbox" id="apAll"${allOn?' checked':''}${selectable.length?'':' disabled'}> Select all shown</label>
    <button type="button" class="primary" id="apApproveSel"${picked.size&&!busy?'':' disabled'}>Approve selected${picked.size?` (${picked.size})`:''}</button>`:''}
   </div>
   ${groups.length?groups.map(({f,rows})=>fileBlock(f,rows,can)).join(''):`<div class="chart-empty ap-empty">${data.files.length?(filter==='pending'&&!q?'Every uploaded result is approved.':'Nothing matches.'):'No result files that need approval yet. New uploads will appear here.'}</div>`}
  </div>`;
 }

 function fileBlock(f,rows,can){
  const open=openFiles.has(f.id)||rows.length<=60,shown=open?rows:rows.slice(0,60),pend=rows.filter(s=>!s.approved),cols=f.columns||[];
  const fileOn=pend.length&&pend.every(s=>picked.has(id(f,s)));
  return `<section class="ap-file">
   <header class="ap-file-head">
    <div><span class="rf-run${f.run?'':' none'}">${esc(f.run||'No run no.')}</span> <strong title="${esc(f.fileName)}">${esc(f.fileName)}</strong>
     <small>Uploaded ${esc(fmt(f.at))}${f.by?` by ${esc(f.by)}`:''} · ${f.samples.filter(s=>s.approved).length}/${f.samples.length} approved${f.columnsNote?` · <span class="ap-note">Columns not shown: ${esc(f.columnsNote)}</span>`:''}</small></div>
    ${can&&pend.length?`<button type="button" class="secondary compact" data-approve-file="${esc(f.id)}"${busy?' disabled':''}>Approve all ${pend.length} in this file</button>`:''}
   </header>
   <div class="ap-scroll"><table class="ap-table${can?"":" ro"}"><thead><tr>
    ${can?`<th class="ap-chk"><input type="checkbox" data-file-all="${esc(f.id)}"${fileOn?' checked':''}${pend.length?'':' disabled'} title="Select every pending embryo of this file"></th>`:''}
    <th class="ap-status">Status</th>${cols.length?cols.map(c=>`<th>${esc(c)}</th>`).join(''):'<th>Sample</th>'}${can?'<th class="ap-act"></th>':''}
   </tr></thead><tbody>${shown.map(s=>{const k=id(f,s),vals=s.values||[];return `<tr class="${s.approved?'ap-done':''}${picked.has(k)?' ap-picked':''}">
    ${can?`<td class="ap-chk">${s.approved?'':`<input type="checkbox" data-pick="${esc(k)}"${picked.has(k)?' checked':''}>`}</td>`:''}
    <td class="ap-status">${s.approved?`<span class="ap-pill ok" title="${esc(`Approved by ${s.approved.by||'unknown'} · ${fmt(s.approved.at)}`)}">Approved</span>`:'<span class="ap-pill wait">Pending</span>'}</td>
    ${cols.length?cols.map((c,i)=>{const v=vals[i]??'';return `<td${v.length>40?` class="ap-wrap" title="${esc(v)}"`:''}>${esc(v)}</td>`}).join(''):`<td>${esc(s.name||s.key)}</td>`}
    ${can?`<td class="ap-act">${s.approved?`<button type="button" class="ap-undo" data-unapprove="${esc(k)}"${busy?' disabled':''}>Undo</button>`:`<button type="button" class="ap-btn" data-approve="${esc(k)}"${busy?' disabled':''}>Approve</button>`}</td>`:''}
   </tr>`}).join('')}</tbody></table></div>
   ${shown.length<rows.length?`<button type="button" class="text-button ap-more" data-open-file="${esc(f.id)}">Show all ${rows.length} rows</button>`:''}
  </section>`}

 const itemOf=k=>{const i=k.indexOf('\u0001');return{fileId:k.slice(0,i),key:k.slice(i+1)}};
 function wire(){
  container.addEventListener('click',e=>{
   if(!e.target.closest('.ap-card'))return;const t=e.target.closest('button');if(!t)return;
   if(t.dataset.filter){filter=t.dataset.filter;render();return}
   if(t.id==='apApproveSel'){const n=picked.size;if(n>1&&!confirm(`Approve ${n} embryo results? The client will be able to see them.`))return;send([...picked].map(itemOf),true);return}
   if(t.dataset.approve){send([itemOf(t.dataset.approve)],true);return}
   if(t.dataset.unapprove){if(confirm('Withdraw approval? The client will no longer see this result.'))send([itemOf(t.dataset.unapprove)],false);return}
   if(t.dataset.approveFile){const f=data.files.find(x=>x.id===t.dataset.approveFile);if(!f)return;const items=f.samples.filter(s=>!s.approved).map(s=>({fileId:f.id,key:s.key}));
    if(confirm(`Approve all ${items.length} pending result(s) in ${f.fileName}? The client will be able to see them.`))send(items,true);return}
   if(t.dataset.openFile){openFiles.add(t.dataset.openFile);render()}});
  container.addEventListener('change',e=>{const t=e.target;if(!t.closest('.ap-card'))return;
   if(t.dataset.pick){t.checked?picked.add(t.dataset.pick):picked.delete(t.dataset.pick);render();return}
   if(t.dataset.fileAll){const f=data.files.find(x=>x.id===t.dataset.fileAll);(visible().find(g=>g.f===f)?.rows||[]).filter(s=>!s.approved).forEach(s=>t.checked?picked.add(id(f,s)):picked.delete(id(f,s)));render();return}
   if(t.id==='apAll'){visible().forEach(({f,rows})=>rows.filter(s=>!s.approved).forEach(s=>t.checked?picked.add(id(f,s)):picked.delete(id(f,s))));render()}});
  let timer;container.addEventListener('input',e=>{if(e.target.id!=='apSearch')return;clearTimeout(timer);const v=e.target.value;timer=setTimeout(()=>{q=v.trim().toLowerCase();const pos=e.target.selectionStart;render();const s=container.querySelector('#apSearch');if(s){s.focus();try{s.setSelectionRange(pos,pos)}catch{}}},200)})}

 window.renderApproveResultsView=function(g){
  container=g;if(!g._apWired){wire();g._apWired=true}
  g.innerHTML='<div class="generic-card wide-card"><div class="chart-empty">Loading…</div></div>';load()};
})();
