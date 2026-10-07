// Clinical outcome follow-up: task queue, "Record outcome" dialog, outcomes dashboard and the patient-page section.
// Data comes from /api/followups (a snapshot of each patient's embryos is kept with the record, so these pages work
// for the embryologist role too, which cannot read the sample sheet).
(function(){
const STATUSES=['Not transferred','Transfer planned','Transferred','Implantation successful','Implantation unsuccessful','Clinical pregnancy','Ongoing pregnancy','Miscarriage','Live birth','Outcome unknown'];
const TRANSFERRED=['Transferred','Implantation successful','Implantation unsuccessful','Clinical pregnancy','Ongoing pregnancy','Miscarriage','Live birth'];
const IMPLANTED=['Implantation successful','Clinical pregnancy','Ongoing pregnancy','Miscarriage','Live birth'];
const CLINICAL=['Clinical pregnancy','Ongoing pregnancy','Miscarriage','Live birth'];
const ACTIVE=['Transfer planned','Transferred','Implantation successful','Clinical pregnancy','Ongoing pregnancy'];
const TERMINAL=['Implantation unsuccessful','Miscarriage','Live birth','Outcome unknown'];
const PERIODS=['Within 1 month','1–3 months','3–6 months','6–12 months','Not known'];
const TASK_DEFS=[['due','Follow-up due'],['overdue','Overdue'],['awaiting','Awaiting clinic update'],['completed','Completed'],['na','Not applicable']];
const STATUS_LABEL={due:'Follow-up due',overdue:'Overdue',awaiting:'Awaiting clinic update',completed:'Completed',na:'Not applicable',scheduled:'Scheduled'};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>ymd(new Date());
const addDays=(iso,n)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return ymd(d)};
const fmtDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');return m?`${m[3]}-${m[2]}-${m[1]}`:'—'};
const monthLabel=k=>{const m=/^(\d{4})-(\d{2})$/.exec(k||'');return m?`${MONTHS[+m[2]-1]} ${m[1]}`:(k||'—')};
let FU={items:[],loaded:false};
let taskFilter='all',taskQuery='',subTab='tasks';
const flt={month:'',clinic:'',region:'',embryologist:'',test:'',age:'',result:''};

async function loadFollowups(force){
 if(FU.loaded&&!force)return FU;
 try{const r=await fetch('/api/followups');if(!r.ok)throw 0;const j=await r.json();FU={items:j.items||[],loaded:true}}catch(e){toast('Could not load follow-up data')}
 return FU}
const outcomeMap=f=>{const m={};(f.outcomes||[]).forEach(o=>{m[norm(o.embryo)]=o});return m};
function taskStatus(f){
 if(f.consent==='No'||f.state==='not_applicable')return'na';
 if(f.state==='completed')return'completed';
 const om=outcomeMap(f),vals=(f.embryos||[]).map(e=>om[norm(e.label)]?.status||'');
 if(vals.some(v=>TERMINAL.includes(v))&&!vals.some(v=>ACTIVE.includes(v)))return'completed';
 if(f.state==='awaiting')return'awaiting';
 const due=f.dueDate||'';
 if(due&&due<today())return'overdue';
 if(!due||due<=addDays(today(),14))return'due';
 return'scheduled'}
const chip=s=>`<span class="fu-chip fu-${s}">${STATUS_LABEL[s]}</span>`;
const resChip=r=>r?`<span class="fu-res fu-res-${norm(r).toLowerCase()}">${esc(r)}</span>`:'<span class="fu-res fu-res-none">—</span>';
const statusChip=s=>s?`<span class="fu-os fu-os-${norm(s).toLowerCase()}">${esc(s)}</span>`:'<span class="fu-os fu-os-none">Not recorded</span>';
const ageGroup=a=>a==null?'Unknown':a<30?'Under 30':a<=34?'30–34':a<=37?'35–37':a<=40?'38–40':'41 and over';
const AGE_ORDER=['Under 30','30–34','35–37','38–40','41 and over','Unknown'];

// ---------------- Per-embryo outcome editor (shared by the dialog and the patient page) ----------------
const GROUPS=[['Before transfer',['Not transferred','Transfer planned']],['Transfer',['Transferred']],['Implantation',['Implantation successful','Implantation unsuccessful']],['Pregnancy',['Clinical pregnancy','Ongoing pregnancy','Miscarriage','Live birth']],['Other',['Outcome unknown']]];
const FURTHER=[['tera','TERA'],['nips','NIPS']];
const WHERE=[['','— Not recorded —'],['Not done','Not done'],['Anderson','Done at Anderson'],['Other lab','Done at another lab']];
function testsHtml(t){
 return `<div class="oe-tests"><small class="oe-tests-title">Further testing after PGT-A</small><div class="oe-tests-grid">${FURTHER.map(([k,label])=>{const v=t[k]||{},done=v.where==='Anderson'||v.where==='Other lab';
  return `<div class="oe-test" data-t="${k}"><h5>${label}</h5>
   <label class="fu-f"><span>Status</span><select class="ot-where">${WHERE.map(([val,l])=>`<option value="${esc(val)}"${(v.where||'')===val?' selected':''}>${l}</option>`).join('')}</select></label>
   <label class="fu-f ot-lab-wrap"${v.where==='Other lab'?'':' hidden'}><span>Lab name</span><input class="ot-lab" value="${esc(v.lab||'')}" placeholder="Name of the other lab"></label>
   <div class="ot-done"${done?'':' hidden'}><label class="fu-f"><span>Date done</span><input class="ot-date" type="date" value="${esc(v.date||'')}"></label>
   <label class="fu-f"><span>Result</span><input class="ot-result" value="${esc(v.result||'')}" placeholder="Result"></label>
   <label class="fu-f"><span>Other details</span><input class="ot-note" value="${esc(v.note||'')}" placeholder="Report no., remarks…"></label></div></div>`}).join('')}</div></div>`}
let editorSeq=0;
function editorHtml(embryos,om){
 const uid='oe'+(++editorSeq);
 if(!embryos.length)return'<div class="chart-empty">No embryos are listed for this patient.</div>';
 return `<div class="oe-list" data-uid="${uid}">${embryos.map((e,i)=>{const o=om[norm(e.label)]||{};
  return `<div class="oe-card" data-label="${esc(e.label)}"><div class="oe-head"><strong>${esc(e.label)}</strong>${resChip(e.result)}<button type="button" class="oe-clear" title="Clear this embryo's outcome">Clear</button></div>
  <div class="oe-groups">${GROUPS.map(([g,list])=>`<div class="oe-group"><small>${g}</small><div class="oe-opts">${list.map(s=>`<label class="oe-chip fu-os-${norm(s).toLowerCase()}"><input type="radio" name="${uid}-${i}" value="${esc(s)}"${o.status===s?' checked':''}><span>${esc(s)}</span></label>`).join('')}</div></div>`).join('')}</div>
  <div class="oe-extra"><label class="fu-f"><span>Date of this outcome</span><input class="oe-date" type="date" value="${esc(o.date||'')}"></label><label class="fu-f"><span>Note</span><input class="oe-note" value="${esc(o.note||'')}" placeholder="Optional"></label></div>${testsHtml(o.tests||{})}</div>`}).join('')}</div>`}
const readTests=c=>{const t={};c.querySelectorAll('.oe-test').forEach(b=>{t[b.dataset.t]={where:b.querySelector('.ot-where').value,lab:b.querySelector('.ot-lab').value,date:b.querySelector('.ot-date').value,result:b.querySelector('.ot-result').value,note:b.querySelector('.ot-note').value}});return t};
const readEditor=root=>[...root.querySelectorAll('.oe-card')].map(c=>({embryo:c.dataset.label,status:c.querySelector('input[type=radio]:checked')?.value||'',date:c.querySelector('.oe-date').value,note:c.querySelector('.oe-note').value,tests:readTests(c)}));
function wireEditor(root,onChange){
 root.addEventListener('change',e=>{const w=e.target.closest('.ot-where');if(w){const b=w.closest('.oe-test'),v=w.value;b.querySelector('.ot-lab-wrap').hidden=v!=='Other lab';b.querySelector('.ot-done').hidden=!(v==='Anderson'||v==='Other lab')}onChange&&onChange()});
 root.addEventListener('click',e=>{const b=e.target.closest('.oe-clear');if(!b)return;const c=b.closest('.oe-card');c.querySelectorAll('input[type=radio]').forEach(r=>r.checked=false);onChange&&onChange()})}
const sumCards=(out)=>{const n=out.length,c=l=>out.filter(x=>l.includes(x.status)).length,rec=out.filter(x=>x.status).length;
 return [['Embryos',n],['Transferred',c(TRANSFERRED)],['Implantation +',c(IMPLANTED)],['Clinical pregnancy',c(CLINICAL)],['Live birth',c(['Live birth'])],['Not recorded',n-rec]].map(([l,v])=>`<div class="fu-sc"><strong>${v}</strong><small>${l}</small></div>`).join('')};

// ---------------- Patient outcome dialog (opened from the task queue and from the patient page) ----------------
function dlgEl(){let d=document.getElementById('fuDialog');if(!d){d=document.createElement('dialog');d.id='fuDialog';d.className='vu-dialog vu-dialog-wide fu-dialog';document.body.append(d);d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()})}return d}
function openRecordDialog(f,after,focusLabel){
 const d=dlgEl(),om=outcomeMap(f),isNew=!!f._new,emb=f.embryos||[];
 d.innerHTML=`<div class="vu-dhead"><div><h3>${esc(f.patient||'Patient')}</h3><small>${esc(f.clinic||'')}${f.test?' · '+esc(f.test):''}${f.trfRef?' · '+esc(f.trfRef):''}</small></div><div>${isNew?'':chip(taskStatus(f))} <button type="button" class="secondary compact" data-close>Close</button></div></div>
 <div class="vu-dbody fu-body">
  <div class="fu-sum" id="fuSum"></div>
  <section class="fu-block"><div class="fu-block-head"><h4>Individual embryo outcomes</h4><small>Choose what happened to each embryo. Leave an embryo blank if nothing is known yet.</small></div><div id="fuEditor">${editorHtml(emb,om)}</div></section>
  <section class="fu-block"><div class="fu-block-head"><h4>Clinic contact &amp; follow-up</h4></div>
  <div class="fu-grid">
   <label class="fu-f"><span>Clinic contact person</span><input id="fuContact" value="${esc(f.contactName)}"></label>
   <label class="fu-f"><span>Follow-up email / phone</span><input id="fuDetail" value="${esc(f.contactDetail)}"></label>
   <label class="fu-f"><span>Expected transfer period</span><select id="fuPeriod"><option value="">—</option>${PERIODS.map(p=>`<option${f.expectedPeriod===p?' selected':''}>${p}</option>`).join('')}</select></label>
   <label class="fu-f"><span>Patient age</span><input id="fuAge" type="number" min="10" max="80" value="${f.age??''}"></label>
   <label class="fu-f"><span>Next follow-up due</span><input id="fuDue" type="date" value="${esc(f.dueDate||'')}"></label>
   <label class="fu-f"><span>Follow-up consent</span><select id="fuConsent"><option${f.consent!=='No'?' selected':''}>Yes</option><option${f.consent==='No'?' selected':''}>No</option></select></label>
  </div>
  <label class="fu-f fu-wide"><span>Follow-up note (calls, clinic replies)</span><textarea id="fuNote" rows="2">${esc(f.note)}</textarea></label></section>
  <div class="fu-actions">
   <button type="button" class="primary" data-act="save">Save outcomes</button>
   <button type="button" class="secondary" data-act="awaiting">Awaiting clinic update</button>
   <button type="button" class="secondary" data-act="completed">Mark completed</button>
   <button type="button" class="secondary" data-act="not_applicable">Not applicable</button>
   ${f.state&&!isNew?'<button type="button" class="secondary" data-act="reopen">Reopen</button>':''}
  </div>
 </div>`;
 const ed=d.querySelector('#fuEditor'),refreshSum=()=>{d.querySelector('#fuSum').innerHTML=sumCards(readEditor(ed))};
 refreshSum();wireEditor(ed,refreshSum);
 const collect=state=>{
  const meta={contactName:d.querySelector('#fuContact').value,contactDetail:d.querySelector('#fuDetail').value,expectedPeriod:d.querySelector('#fuPeriod').value,age:d.querySelector('#fuAge').value,dueDate:d.querySelector('#fuDue').value,consent:d.querySelector('#fuConsent').value,note:d.querySelector('#fuNote').value};
  if(isNew)Object.assign(meta,{patient:f.patient,clinic:f.clinic,region:f.region,embryologist:f.embryologist,test:f.test,month:f.month,embryos:f.embryos});
  if(state!==undefined)meta.state=state;
  return{caseKey:f.caseKey,followup:meta,outcomes:readEditor(ed)}};
 d.querySelector('.fu-actions').onclick=async e=>{const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  const state=act==='save'?undefined:act==='reopen'?'':act;
  if(act==='not_applicable'&&!confirm('Mark this follow-up as not applicable?'))return;
  b.disabled=true;
  try{const j=await postSave(collect(state));toast('Follow-up saved');d.close();if(after)after(j)}catch(err){toast(err.message||'Could not save');b.disabled=false}};
 if(!d.open)d.showModal();
 if(focusLabel){const card=[...d.querySelectorAll('.oe-card')].find(c=>c.dataset.label===focusLabel);if(card){card.classList.add('oe-focus');setTimeout(()=>card.scrollIntoView({block:'center'}),60)}}}
async function postSave(body){
 const r=await fetch('/api/followups/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Save failed');
 const i=FU.items.findIndex(x=>x.caseKey===j.caseKey);if(i>=0)FU.items[i]=j;else FU.items.unshift(j);return j}

// ---------------- Shared bits for the redesigned pages ----------------
const IC=n=>`<img class="ico" src="/static/icons/${n}.png" alt="">`;
const SVG={heart:'<svg viewBox="0 0 24 24" width="30" height="30" fill="#e0457b"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 5 6 5c2 0 3.4 1 4 2.2h4C14.600 6 16 5 18 5c3.300 0 5.100 3.400 3.600 6.800C19.500 16.400 12 21 12 21z"/></svg>'};
const relDue=(due)=>{if(!due)return'';const d=Math.round((new Date(due+'T00:00:00')-new Date(today()+'T00:00:00'))/864e5);return d<0?`Overdue by ${-d} day${d===-1?'':'s'}`:d===0?'Due today':d===1?'Due tomorrow':`Due in ${d} days`};
const TILES=[
 ['all','All tasks','navigation__patient','Everything in the queue','slate'],
 ['due','Follow-up due','navigation__notifications','Contact the clinic soon','amber'],
 ['overdue','Overdue','stages-results__qc-fail','Past the due date','red'],
 ['awaiting','Awaiting clinic update','navigation__internal-transfer','Clinic has been asked','blue'],
 ['completed','Completed','stages-results__qc-pass','All outcomes known','green'],
 ['na','Not applicable','stages-results__na-result','No consent / not needed','grey']];
let dashHome=false,taskSort='due',taskView='patient',viewChosen=false,taskEmb='',onlyNeeds=false;

// ---------------- Tasks (card queue) ----------------
function tasksHtml(){
 const mine=currentUser&&currentUser.role==='embryologist';if(mine&&!viewChosen)taskView='embryo';
 const embs=[...new Set(FU.items.map(f=>f.embryologist).filter(Boolean))].sort();
 const items=FU.items.filter(f=>!taskEmb||f.embryologist===taskEmb).map(f=>({f,s:taskStatus(f)})),cnt=k=>k==='all'?items.length:items.filter(x=>x.s===k).length;
 const q=taskQuery.trim().toLowerCase();
 let list=taskFilter==='all'?items:items.filter(x=>x.s===taskFilter);
 if(q)list=list.filter(x=>`${x.f.patient} ${x.f.clinic} ${x.f.test} ${x.f.trfRef||''} ${x.f.contactName}`.toLowerCase().includes(q));
 const cmp={due:(a,b)=>(a.f.dueDate||'9999').localeCompare(b.f.dueDate||'9999'),patient:(a,b)=>a.f.patient.localeCompare(b.f.patient),clinic:(a,b)=>a.f.clinic.localeCompare(b.f.clinic)}[taskSort];
 list=[...list].sort(cmp);
 const attention=cnt('due')+cnt('overdue');
 const tiles=TILES.map(([k,l,ic,help,tone])=>`<button type="button" class="st-tile st-${tone}${k===taskFilter?' on':''}" data-k="${k}">${IC(ic)}<span class="st-n">${cnt(k)}</span><span class="st-l">${l}</span><small>${help}</small></button>`).join('');
 const card=({f,s})=>{const om=outcomeMap(f),total=(f.embryos||[]).length,rec=(f.embryos||[]).filter(e=>om[norm(e.label)]?.status).length,rel=relDue(f.dueDate),detail=f.contactDetail||'';
  const link=/@/.test(detail)?`<a href="mailto:${esc(detail)}">${esc(detail)}</a>`:/\d{6,}/.test(detail.replace(/\D/g,''))?`<a href="tel:${esc(detail.replace(/[^\d+]/g,''))}">${esc(detail)}</a>`:esc(detail);
  return `<article class="tk tk-${s}" data-key="${esc(f.caseKey)}" tabindex="0" role="button">
   <div class="tk-top"><div><h3>${esc(f.patient)||'Patient'}</h3><p>${esc(f.clinic)||'—'}${f.test?` · ${esc(f.test)}`:''}</p></div>${chip(s)}</div>
   <div class="tk-grid">
    <div><small>Follow-up due</small><b class="${s==='overdue'?'late':''}">${fmtDate(f.dueDate)}</b><em class="${s==='overdue'?'late':''}">${esc(s==='completed'||s==='na'?'':rel)}</em></div>
    <div><small>Clinic contact</small><b>${esc(f.contactName)||'—'}</b><em>${link||''}</em></div>
   </div>
   <div class="tk-prog"><div class="tk-prog-bar"><i style="width:${total?rec/total*100:0}%"></i></div><span>${rec} of ${total} embryo${total===1?'':'s'} recorded</span></div>
   <div class="tk-foot"><span class="tk-ref">${esc(f.trfRef||f.caseKey)}</span><button type="button" class="primary compact" data-rec="1">Record outcome</button></div>
  </article>`};
 const empty=FU.items.length?`<div class="tk-empty">${IC('stages-results__qc-pass')}<h3>Nothing here</h3><p>No tasks match this view.</p></div>`:`<div class="tk-empty">${IC('navigation__patient')}<h3>No follow-ups yet</h3><p>A task is created automatically when a TRF with follow-up consent is submitted, or when a team lead starts one from a patient page.</p></div>`;
 const embAll=items.flatMap(({f})=>{const om=outcomeMap(f);return(f.embryos||[]).map(e=>om[norm(e.label)]?.status?1:0)}),needN=embAll.filter(x=>!x).length;
 const hero=mine?`<div class="fu-hero"><div><h2>${embAll.length} embryo${embAll.length===1?'':'s'} assigned to you</h2><p>${needN?`<b>${needN}</b> still need their outcome details. Open a patient, or switch to <b>By embryo</b> to go through them one by one.`:'Every assigned embryo has its details filled in. Thank you!'}</p></div></div>`:`<div class="fu-hero"><div><h2>${attention?`${attention} patient${attention===1?'':'s'} need${attention===1?'s':''} a follow-up`:'You are all caught up'}</h2><p>Ask each clinic what happened to the embryos after transfer, then record it with <b>Record outcome</b>.</p></div>${canEditData()?'<div class="hero-btns"><button type="button" class="hero-btn" id="fuLinks">Embryologist logins</button><button type="button" class="hero-btn" id="fuFromSheet">＋ Add patients from the sheet</button></div>':''}</div>`;
 return `${hero}
 <div class="st-tiles">${tiles}</div>
 <div class="tk-bar"><div class="seg-toggle" id="fuView"><button type="button" class="${taskView==='patient'?'on':''}" data-v="patient">By patient</button><button type="button" class="${taskView==='embryo'?'on':''}" data-v="embryo">By embryo</button></div><div class="search-wrap fu-search"><span>⌕</span><input id="fuSearch" type="search" placeholder="Search patient, clinic or contact…" value="${esc(taskQuery)}"></div>${!mine&&embs.length>1?`<label class="tk-sort">Embryologist <select id="fuEmb"><option value="">All</option>${embs.map(n=>`<option${taskEmb===n?' selected':''}>${esc(n)}</option>`).join('')}</select></label>`:''}${taskView==='embryo'?`<label class="tk-sort"><input type="checkbox" id="fuNeeds"${onlyNeeds?' checked':''}> Only embryos needing details</label>`:''}<label class="tk-sort">Sort by <select id="fuSort"><option value="due"${taskSort==='due'?' selected':''}>Due date</option><option value="patient"${taskSort==='patient'?' selected':''}>Patient name</option><option value="clinic"${taskSort==='clinic'?' selected':''}>Clinic</option></select></label></div>
 ${taskView==='embryo'?embryoTable(list):`<div class="tk-list">${list.map(card).join('')||empty}</div>`}`}
function embryoTable(list){
 const rows=[];list.forEach(({f,s})=>{const om=outcomeMap(f);(f.embryos||[]).forEach(e=>{const o=om[norm(e.label)]||{};rows.push({f,s,e,o})})});
 const shown=rows.filter(r=>!onlyNeeds||!r.o.status);
 const tchip=(t,k)=>{const v=(t||{})[k];if(!v||!v.where)return'<span class="fu-os fu-os-none">—</span>';return v.where==='Not done'?'<span class="fu-os fu-os-none">Not done</span>':`<span class="fu-os">${v.where==='Anderson'?'Anderson':esc(v.lab||'Other lab')}${v.result?' · '+esc(v.result):''}</span>`};
 return `<div class="fu-table-wrap fu-tasks"><table class="fu-table"><thead><tr><th>Patient</th><th>Embryo</th><th>PGT-A result</th><th>Outcome</th><th>TERA</th><th>NIPS</th><th>Task</th><th></th></tr></thead><tbody>${shown.map(({f,s,e,o})=>`<tr data-key="${esc(f.caseKey)}" data-emb="${esc(e.label)}"><td class="strong">${esc(f.patient)}<small>${esc(f.clinic)}</small></td><td class="strong">${esc(e.label)}</td><td>${resChip(e.result)}</td><td>${statusChip(o.status)}</td><td>${tchip(o.tests,'tera')}</td><td>${tchip(o.tests,'nips')}</td><td>${chip(s)}</td><td><button type="button" class="primary compact" data-fill="1">${o.status?'Edit details':'Fill details'}</button></td></tr>`).join('')||'<tr><td colspan="8" class="chart-empty">No embryos to show.</td></tr>'}</tbody></table></div>`}

function wireTasks(root,redraw){
 const tg=root.querySelector('#fuView');if(tg)tg.onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;taskView=b.dataset.v;viewChosen=true;redraw()};
 const ef=root.querySelector('#fuEmb');if(ef)ef.onchange=()=>{taskEmb=ef.value;redraw()};
 const nd=root.querySelector('#fuNeeds');if(nd)nd.onchange=()=>{onlyNeeds=nd.checked;redraw()};
 const fs=root.querySelector('#fuFromSheet');if(fs)fs.onclick=()=>openSheetImport(redraw);
 const fl=root.querySelector('#fuLinks');if(fl)fl.onclick=()=>openLinks();
 root.querySelector('.st-tiles').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;taskFilter=b.dataset.k;redraw()};
 const s=root.querySelector('#fuSearch');s.oninput=()=>{taskQuery=s.value;const pos=s.selectionStart;redraw();const n=root.querySelector('#fuSearch');n.focus();n.setSelectionRange(pos,pos)};
 root.querySelector('#fuSort').onchange=e=>{taskSort=e.target.value;redraw()};
 const open=el=>{const f=FU.items.find(x=>x.caseKey===el.dataset.key);if(f)openRecordDialog(f,()=>redraw())};
 const list=root.querySelector('.tk-list');
 if(list){list.onclick=e=>{if(e.target.closest('a'))return;const t=e.target.closest('.tk');if(t)open(t)};list.onkeydown=e=>{if(e.key==='Enter'){const t=e.target.closest('.tk');if(t)open(t)}}}
 const tbl=root.querySelector('.fu-tasks');
 if(tbl)tbl.onclick=e=>{const tr=e.target.closest('tr[data-key]');if(!tr)return;const f=FU.items.find(x=>x.caseKey===tr.dataset.key);if(f)openRecordDialog(f,()=>redraw(),tr.dataset.emb)}}


// Team lead / admin: start follow-ups for all the patients listed under one embryologist in the sheet.
function openSheetImport(redraw){
 if(typeof cases==='undefined'||!cases.length){toast('Sheet data is still loading');return}
 const names=[...new Set(cases.map(c=>c.embryologist).filter(n=>n&&n!=='Not assigned'))].sort();
 const d=document.createElement('dialog');d.className='vu-dialog fu-dialog';document.body.append(d);d.addEventListener('close',()=>d.remove());
 const monthsOf=n=>[...new Set(cases.filter(c=>c.embryologist===n).flatMap(c=>(c.embryos||[]).map(recordMonth)).filter(m=>/^\d{4}-\d{2}$/.test(m)))].sort().reverse();
 d.innerHTML=`<div class="vu-dhead"><h3>Add patients from the sheet</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><p class="fu-note" style="margin-top:0">Lists every patient of the chosen embryologist in the follow-up queue, so they can open each embryo and fill in the outcome details. Patients already in the queue are skipped.</p>
 <div class="fu-grid"><label class="fu-f"><span>Embryologist</span><select id="siEmb"><option value="">Choose…</option>${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><label class="fu-f"><span>Month</span><select id="siMonth"><option value="">All months</option></select></label></div>
 <p id="siInfo" class="fu-note"></p><div class="fu-actions"><button type="button" class="primary" id="siGo" disabled>Add to follow-up</button></div></div>`;
 const pick=()=>{const n=d.querySelector('#siEmb').value,m=d.querySelector('#siMonth').value;return cases.filter(c=>c.embryologist===n&&(!m||(c.embryos||[]).some(e=>recordMonth(e)===m)))};
 d.querySelector('#siEmb').onchange=e=>{const n=e.target.value;d.querySelector('#siMonth').innerHTML='<option value="">All months</option>'+(n?monthsOf(n).map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join(''):'');upd()};
 d.querySelector('#siMonth').onchange=()=>upd();
 const upd=()=>{const n=d.querySelector('#siEmb').value,list=n?pick():[],have=new Set(FU.items.map(f=>f.caseKey)),fresh=list.filter(c=>!have.has(c.id));d.querySelector('#siInfo').textContent=n?`${list.length} patient${list.length===1?'':'s'} found · ${fresh.length} new, ${list.length-fresh.length} already in the queue.`:'';d.querySelector('#siGo').disabled=!fresh.length};
 d.querySelector('#siGo').onclick=async ev=>{const b=ev.currentTarget;b.disabled=true;
  const items=pick().map(c=>{const emb=resolvedEmbryos(c).map(r=>{const id=resultIdentity(r);return{label:id.patient?`${id.patient}-${id.embryo}`:id.embryo,result:RESULT_NAME[conclusionClass(r)]||'No result'}}).filter(x=>x.label);
   const month=(c.embryos||[]).map(recordMonth).find(m=>/^\d{4}-\d{2}$/.test(m))||'';
   return{caseKey:c.id,followup:{patient:c.patient,clinic:c.client||'',region:c.region||'',embryologist:c.embryologist||'',test:c.test||'',month,embryos:emb.length?emb:Array.from({length:c.samples||0},(_,i)=>({label:`Embryo ${i+1}`,result:'No result'})),dueDate:today()}}});
  try{const r=await fetch('/api/followups/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Failed');await loadFollowups(true);toast(`${j.created} patient${j.created===1?'':'s'} added`);d.close();redraw()}catch(err){toast(err.message||'Could not add');b.disabled=false}};
 d.showModal()}
const RESULT_NAME={Normal:'Euploid',Abnormal:'Aneuploid',Mosaic:'Mosaic',Inconclusive:'Inconclusive'};

// Admin / team lead: which sheet embryologist name each embryologist login sees the embryos of.
async function openLinks(){
 let list=[];try{const r=await fetch('/api/embryologist-links');if(!r.ok)throw 0;list=await r.json()}catch(e){toast('Could not load the embryologist logins');return}
 const names=typeof cases!=='undefined'?[...new Set(cases.map(c=>c.embryologist).filter(n=>n&&n!=='Not assigned'))].sort():[];
 const d=document.createElement('dialog');d.className='vu-dialog fu-dialog';document.body.append(d);d.addEventListener('close',()=>d.remove());
 d.innerHTML=`<div class="vu-dhead"><h3>Embryologist logins</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><p class="fu-note" style="margin-top:0">Choose the name each login has in the sheet's <b>Embryologist</b> column. That login then sees (and fills in) the embryos of every patient listed under that name.</p>
 <datalist id="lkNames">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
 <div class="fu-table-wrap"><table class="fu-table"><thead><tr><th>Login</th><th>Name in the sheet</th><th></th></tr></thead><tbody>${list.map(u=>`<tr data-u="${esc(u.username)}"><td class="strong">${esc(u.username)}</td><td><input list="lkNames" class="lk-name" value="${esc(u.name)}" placeholder="Start typing a name…" style="width:100%;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:10px"></td><td><button type="button" class="primary compact" data-save="1">Save</button></td></tr>`).join('')||'<tr><td colspan="3" class="chart-empty">No embryologist logins yet.</td></tr>'}</tbody></table></div></div>`;
 d.querySelector('tbody').onclick=async e=>{const b=e.target.closest('[data-save]');if(!b)return;const tr=b.closest('tr');b.disabled=true;
  try{const r=await fetch('/api/embryologist-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:tr.dataset.u,name:tr.querySelector('.lk-name').value})});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).detail||'Failed');toast(`${tr.dataset.u} linked`)}catch(err){toast(err.message||'Could not save')}b.disabled=false};
 d.showModal()}

// ---------------- Dashboard ----------------
function embryoRows(){
 const out=[];
 FU.items.forEach(f=>{if(f.consent==='No'||f.state==='not_applicable')return;const om=outcomeMap(f);
  (f.embryos||[]).forEach(e=>out.push({f,label:e.label,result:e.result||'No result',status:om[norm(e.label)]?.status||'',tests:om[norm(e.label)]?.tests||{},age:ageGroup(f.age)}))});
 return out}
const pct=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
const ring=(n,d,color)=>{const p=d?n/d:0,r=34,c=2*Math.PI*r;return `<svg class="ring" viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="#e8efee" stroke-width="9"/>${p>0?`<circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c*p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>`:''}<text x="42" y="47" text-anchor="middle" font-size="15" font-weight="700" fill="#17302f">${d?Math.round(p*100)+'%':'—'}</text></svg>`};
const OS_COLOR={'Not transferred':'#9aa6a0','Transfer planned':'#c9b458','Transferred':'#3b8fd0','Implantation successful':'#14b8a6','Implantation unsuccessful':'#e57373','Clinical pregnancy':'#7c5cbf','Ongoing pregnancy':'#5a4aa8','Miscarriage':'#d12f2f','Live birth':'#1f8a52','Outcome unknown':'#6b766f','':'#dfe6e4'};
function dashHtml(){
 const all=embryoRows();
 const opts=k=>[...new Set(all.map(r=>k==='age'?r.age:k==='result'?r.result:k==='month'?r.f.month:r.f[k]).filter(Boolean))];
 const sorted={month:opts('month').sort().reverse(),clinic:opts('clinic').sort(),region:opts('region').sort(),embryologist:opts('embryologist').sort(),test:opts('test').sort(),age:AGE_ORDER.filter(a=>opts('age').includes(a)),result:opts('result').sort()};
 const sel=(k,label,fmt=v=>v)=>`<label class="db-f"><span>${label}</span><select data-flt="${k}"${flt[k]?' class="on"':''}><option value="">All</option>${sorted[k].map(v=>`<option value="${esc(v)}"${flt[k]===v?' selected':''}>${esc(fmt(v))}</option>`).join('')}</select></label>`;
 const rows=all.filter(r=>(!flt.month||r.f.month===flt.month)&&(!flt.clinic||r.f.clinic===flt.clinic)&&(!flt.region||r.f.region===flt.region)&&(!flt.embryologist||r.f.embryologist===flt.embryologist)&&(!flt.test||r.f.test===flt.test)&&(!flt.age||r.age===flt.age)&&(!flt.result||r.result===flt.result));
 const inSet=l=>rows.filter(r=>l.includes(r.status)),tr=inSet(TRANSFERRED),im=inSet(IMPLANTED),cp=inSet(CLINICAL),mc=inSet(['Miscarriage']),lb=inSet(['Live birth']),recorded=rows.filter(r=>r.status).length;
 const patients=new Set(rows.map(r=>r.f.caseKey)).size,filtersOn=Object.values(flt).some(Boolean);
 const rate=(label,n,d,color,sub,help)=>`<article class="db-rate">${ring(n,d,color)}<div><h4>${label}</h4><p><b>${n}</b> of ${d} ${sub}</p><small>${help}</small></div></article>`;
 const stages=[['Embryos tracked',rows.length,IC('stages-results__total-embryos'),'#0a7180'],['Transferred',tr.length,IC('tests-transfers__transferred-to-transfer'),'#3b8fd0'],['Implantation positive',im.length,IC('stages-results__normal'),'#14b8a6'],['Clinical pregnancy',cp.length,IC('navigation__patient'),'#7c5cbf'],['Live birth',lb.length,SVG.heart,'#1f8a52']];
 const journey=stages.map(([l,n,ic,col],i)=>`<div class="jy" style="--c:${col}"><div class="jy-ic">${ic}</div><strong>${n}</strong><span>${l}</span>${i?`<em>${pct(n,stages[i-1][1])} of ${stages[i-1][0].toLowerCase()}</em>`:`<em>${patients} patient${patients===1?'':'s'}</em>`}</div>${i<stages.length-1?'<div class="jy-arrow">›</div>':''}`).join('');
 const order=[...STATUSES,''],mix=order.map(s=>[s,rows.filter(r=>r.status===s).length]);
 const stack=`<div class="mix-bar">${mix.filter(x=>x[1]).map(([s,n])=>`<i style="flex:${n};background:${OS_COLOR[s]}" title="${esc(s||'Not recorded')}: ${n}"></i>`).join('')||'<i style="flex:1;background:#eef2f1"></i>'}</div><div class="mix-legend">${mix.map(([s,n])=>`<span class="${n?'':'zero'}"><i style="background:${OS_COLOR[s]}"></i>${esc(s||'Not recorded')}<b>${n}</b></span>`).join('')}</div>`;
 const furtherCard=(k,label)=>{const g=w=>rows.filter(r=>(r.tests?.[k]?.where||'')===w).length,an=g('Anderson'),ot=g('Other lab'),nd=g('Not done'),nr=rows.length-an-ot-nd,labs={};rows.forEach(r=>{const t=r.tests?.[k];if(t?.where==='Other lab'&&t.lab)labs[t.lab]=(labs[t.lab]||0)+1});
  const seg=[[an,'#0a7180','At Anderson'],[ot,'#e08a1e','Another lab'],[nd,'#9aa6a0','Not done'],[nr,'#dfe6e4','Not recorded']];
  return `<article class="db-card db-further"><h3>${label} <small>after PGT-A</small></h3><div class="mix-bar">${seg.filter(x=>x[0]).map(([n,c,l])=>`<i style="flex:${n};background:${c}" title="${l}: ${n}"></i>`).join('')||'<i style="flex:1;background:#eef2f1"></i>'}</div><div class="mix-legend">${seg.map(([n,c,l])=>`<span class="${n?'':'zero'}"><i style="background:${c}"></i>${l}<b>${n}</b></span>`).join('')}</div>${Object.keys(labs).length?`<p class="db-labs">Other labs: ${Object.entries(labs).sort((a,b)=>b[1]-a[1]).map(([l,n])=>`<b>${esc(l)}</b> (${n})`).join(', ')}</p>`:''}</article>`};
 const grp=(keyFn)=>{const m=new Map();rows.forEach(r=>{const k=keyFn(r)||'—',x=m.get(k)||{k,patients:new Set(),n:0,t:0,i:0,p:0,l:0};x.patients.add(r.f.caseKey);x.n++;if(TRANSFERRED.includes(r.status))x.t++;if(IMPLANTED.includes(r.status))x.i++;if(CLINICAL.includes(r.status))x.p++;if(r.status==='Live birth')x.l++;m.set(k,x)});return[...m.values()]};
 const table=(title,list,first)=>`<article class="db-card"><h3>${title}</h3><div class="fu-table-wrap fu-clinics"><table class="fu-table"><thead><tr><th>${first}</th><th>Patients</th><th>Embryos</th><th>Transferred</th><th>Implant.</th><th>Clin. preg.</th><th>Live birth</th></tr></thead><tbody>${list.map(x=>`<tr><td class="strong">${esc(first==='Month'?monthLabel(x.k):x.k)}</td><td>${x.patients.size}</td><td>${x.n}</td><td>${x.t}</td><td>${pct(x.i,x.t)}</td><td>${pct(x.p,x.t)}</td><td>${pct(x.l,x.t)}</td></tr>`).join('')||'<tr><td colspan="7" class="chart-empty">No data for these filters.</td></tr>'}</tbody></table></div></article>`;
 const clinics=grp(r=>r.f.clinic).sort((a,b)=>b.n-a.n),months=grp(r=>r.f.month).sort((a,b)=>String(b.k).localeCompare(String(a.k)));
 return `<div class="fu-hero db-hero"><div><h2>Pregnancy outcomes</h2><p>What happened after transfer, for <b>${rows.length}</b> embryo${rows.length===1?'':'s'} from <b>${patients}</b> patient${patients===1?'':'s'} who agreed to follow-up${filtersOn?' <span class="db-on">· filtered</span>':''}.</p></div><div class="db-hero-stats"><div><strong>${recorded}</strong><small>outcomes recorded</small></div><div><strong>${rows.length-recorded}</strong><small>still unknown</small></div>${dashHome?'<button type="button" class="hero-btn" id="goRunStatus">Run-wise status ›</button>':''}</div></div>
 <div class="db-filters">${sel('month','Month',monthLabel)}${sel('clinic','Clinic')}${sel('region','Region')}${sel('embryologist','Embryologist')}${sel('test','Test')}${sel('age','Age group')}${sel('result','Embryo result')}<button type="button" class="secondary compact" id="fuClear"${filtersOn?'':' disabled'}>Clear filters</button></div>
 <h3 class="db-h">The journey of the embryos</h3>
 <div class="journey">${journey}</div>
 <h3 class="db-h">Success rates</h3>
 <div class="db-rates">
  ${rate('Transfer rate',tr.length,rows.length,'#3b8fd0','embryos were transferred','Transferred ÷ embryos tracked')}
  ${rate('Implantation rate',im.length,tr.length,'#14b8a6','transferred embryos implanted','Implanted ÷ transferred')}
  ${rate('Clinical pregnancy rate',cp.length,tr.length,'#7c5cbf','transferred embryos gave a clinical pregnancy','Clinical pregnancies ÷ transferred')}
  ${rate('Miscarriage rate',mc.length,cp.length,'#d12f2f','clinical pregnancies ended in miscarriage','Miscarriages ÷ clinical pregnancies')}
  ${rate('Live-birth rate',lb.length,tr.length,'#1f8a52','transferred embryos led to a live birth','Live births ÷ transferred')}
 </div>
 <div class="db-two"><article class="db-card"><h3>What happened to each embryo</h3>${stack}</article>${furtherCard('tera','TERA')}${furtherCard('nips','NIPS')}</div>
 <div class="db-two db-two-eq">${table('By clinic',clinics,'Clinic')}${table('By month',months,'Month')}</div>
 <p class="fu-note">"Outcome unknown" and "Not transferred" embryos count only in the embryos tracked. Patients who declined follow-up are left out.</p>`}
function wireDash(root,redraw){
 const gr=root.querySelector('#goRunStatus');if(gr)gr.onclick=()=>showView('home');
 root.querySelectorAll('[data-flt]').forEach(s=>s.onchange=()=>{flt[s.dataset.flt]=s.value;redraw()});
 root.querySelector('#fuClear').onclick=()=>{Object.keys(flt).forEach(k=>flt[k]='');redraw()}}

// ---------------- Views ----------------
window.renderFollowupView=async function(g,view){
 const title={followup:'Clinical follow-up',fuTasks:'Follow-up tasks',fuDash:'Outcomes',dashboard:'Home'}[view];
 const ht=document.getElementById('genericHeaderTitle');if(ht)ht.textContent=title;
 g.innerHTML='<div class="generic-card wide-card fu-view"><div class="chart-empty">Loading follow-up data…</div></div>';
 await loadFollowups(true);
 const card=g.querySelector('.fu-view');
 const draw=()=>{
  const tab=view==='followup'?subTab:view==='fuTasks'?'tasks':'dash';
  dashHome=view==='dashboard';
  const seg=view==='followup'?`<div class="fu-switch" id="fuSub"><button type="button" class="${tab==='tasks'?'on':''}" data-t="tasks">${IC('navigation__patient')}<span><b>Follow-up tasks</b><small>Who to call, what to record</small></span></button><button type="button" class="${tab==='dash'?'on':''}" data-t="dash">${IC('navigation__embryo-results')}<span><b>Outcomes dashboard</b><small>Rates, counts and trends</small></span></button></div>`:'';
  card.innerHTML=seg+`<div class="fu-pane">${tab==='tasks'?tasksHtml():dashHtml()}</div>`;
  const sub=card.querySelector('#fuSub');if(sub)sub.onclick=e=>{const b=e.target.closest('[data-t]');if(!b)return;subTab=b.dataset.t;draw()};
  if(tab==='tasks')wireTasks(card,draw);else wireDash(card,draw)};
 draw()};

// ---------------- Patient page section ----------------
window.renderPatientFollowup=async function(c,resolvedAll){
 if(typeof canEditData==='function'&&!canEditData())return;
 const anchor=document.querySelector('#patientDetail .embryo-table-card');if(!anchor)return;
 let sec=document.getElementById('fuSection');if(sec)sec.remove();
 sec=document.createElement('section');sec.id='fuSection';sec.className='fu-section';sec.innerHTML='<div class="chart-empty">Loading outcome follow-up…</div>';anchor.after(sec);
 await loadFollowups(true);
 const labels=(resolvedAll||[]).map(r=>{const id=resultIdentity(r);return{label:id.patient?`${id.patient}-${id.embryo}`:id.embryo,result:RESULT_NAME[conclusionClass(r)]||'No result'}}).filter(x=>x.label);
 const list=labels.length?labels:Array.from({length:c.samples||0},(_,i)=>({label:`Embryo ${i+1}`,result:'No result'}));
 const month=(c.embryos||[]).map(recordMonth).find(m=>/^\d{4}-\d{2}$/.test(m))||'';
 const draft={_new:true,caseKey:c.id,patient:c.patient,clinic:c.client||'',region:c.region||'',embryologist:c.embryologist||'',test:c.test||'',month,age:null,embryos:list,consent:'Yes',contactName:'',contactDetail:'',expectedPeriod:'',dueDate:addDays(today(),90),state:'',note:'',outcomes:[]};
 const draw=()=>{const f=FU.items.find(x=>x.caseKey===c.id),base=f||draft,emb=(base.embryos&&base.embryos.length)?base.embryos:list;
  sec.innerHTML=`<div class="fu-sec-head"><div class="embryo-table-title"><h3>Outcome follow-up</h3>${f?chip(taskStatus(f)):'<span class="fu-chip fu-scheduled">Not started</span>'}</div><button type="button" class="secondary compact" id="fuMore">Contact &amp; task details</button></div>
  <div class="fu-sum" id="fuInlineSum"></div>
  <div id="fuInlineEditor">${editorHtml(emb,f?outcomeMap(f):{})}</div>
  <div class="fu-actions"><button type="button" class="primary" id="fuInlineSave">Save outcomes</button></div>`;
  const ed=sec.querySelector('#fuInlineEditor'),sum=()=>{sec.querySelector('#fuInlineSum').innerHTML=sumCards(readEditor(ed))};sum();wireEditor(ed,sum);
  sec.querySelector('#fuInlineSave').onclick=async e=>{const b=e.currentTarget;b.disabled=true;
   try{const body={caseKey:c.id,followup:f?{}:{patient:draft.patient,clinic:draft.clinic,region:draft.region,embryologist:draft.embryologist,test:draft.test,month:draft.month,embryos:draft.embryos,consent:'Yes',dueDate:draft.dueDate},outcomes:readEditor(ed)};
    await postSave(body);toast('Outcomes saved');draw()}catch(err){toast(err.message||'Could not save');b.disabled=false}};
  sec.querySelector('#fuMore').onclick=()=>{const cur=FU.items.find(x=>x.caseKey===c.id)||draft;openRecordDialog(cur._new?cur:{...cur,embryos:(cur.embryos&&cur.embryos.length)?cur.embryos:list},draw)}};
 draw()};
})();
