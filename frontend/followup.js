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

// ---------------- Record outcome dialog ----------------
function dlgEl(){let d=document.getElementById('fuDialog');if(!d){d=document.createElement('dialog');d.id='fuDialog';d.className='vu-dialog vu-dialog-wide fu-dialog';document.body.append(d);d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()})}return d}
function openRecordDialog(f,after){
 const d=dlgEl(),om=outcomeMap(f),isNew=!!f._new,canEditMeta=true;
 const emb=(f.embryos||[]).length?f.embryos:[];
 d.innerHTML=`<div class="vu-dhead"><div><h3>${esc(f.patient||'Patient')}</h3><small>${esc(f.clinic||'')}${f.test?' · '+esc(f.test):''}${f.trfRef?' · '+esc(f.trfRef):''}</small></div><div>${isNew?'':chip(taskStatus(f))} <button type="button" class="secondary compact" data-close>Close</button></div></div>
 <div class="vu-dbody fu-body">
  <div class="fu-grid">
   <label class="fu-f"><span>Clinic contact person</span><input id="fuContact" value="${esc(f.contactName)}"></label>
   <label class="fu-f"><span>Follow-up email / phone</span><input id="fuDetail" value="${esc(f.contactDetail)}"></label>
   <label class="fu-f"><span>Expected transfer period</span><select id="fuPeriod"><option value="">—</option>${PERIODS.map(p=>`<option${f.expectedPeriod===p?' selected':''}>${p}</option>`).join('')}</select></label>
   <label class="fu-f"><span>Patient age</span><input id="fuAge" type="number" min="10" max="80" value="${f.age??''}"></label>
   <label class="fu-f"><span>Next follow-up due</span><input id="fuDue" type="date" value="${esc(f.dueDate||'')}"></label>
   <label class="fu-f"><span>Follow-up consent</span><select id="fuConsent"><option${f.consent!=='No'?' selected':''}>Yes</option><option${f.consent==='No'?' selected':''}>No</option></select></label>
  </div>
  <div class="fu-table-wrap"><table class="fu-table"><thead><tr><th>Embryo</th><th>Result</th><th>Outcome</th><th>Date</th><th>Note</th></tr></thead><tbody>
  ${emb.length?emb.map((e,i)=>{const o=om[norm(e.label)]||{};return `<tr data-i="${i}" data-label="${esc(e.label)}"><td class="strong">${esc(e.label)}</td><td>${resChip(e.result)}</td><td><select class="fu-st"><option value="">— Not recorded —</option>${STATUSES.map(s=>`<option${o.status===s?' selected':''}>${s}</option>`).join('')}</select></td><td><input class="fu-dt" type="date" value="${esc(o.date||'')}"></td><td><input class="fu-nt" value="${esc(o.note||'')}" placeholder="Optional"></td></tr>`}).join(''):'<tr><td colspan="5" class="chart-empty">No embryos listed for this patient.</td></tr>'}
  </tbody></table></div>
  <label class="fu-f fu-wide"><span>Follow-up note (calls, clinic replies)</span><textarea id="fuNote" rows="2">${esc(f.note)}</textarea></label>
  <div class="fu-actions">
   <button type="button" class="primary" data-act="save">Save outcomes</button>
   <button type="button" class="secondary" data-act="awaiting">Awaiting clinic update</button>
   <button type="button" class="secondary" data-act="completed">Mark completed</button>
   <button type="button" class="secondary" data-act="not_applicable">Not applicable</button>
   ${f.state&&!isNew?'<button type="button" class="secondary" data-act="reopen">Reopen</button>':''}
  </div>
 </div>`;
 const collect=state=>{
  const outcomes=[...d.querySelectorAll('tbody tr[data-label]')].map(tr=>({embryo:tr.dataset.label,status:tr.querySelector('.fu-st').value,date:tr.querySelector('.fu-dt').value,note:tr.querySelector('.fu-nt').value}));
  const meta={contactName:d.querySelector('#fuContact').value,contactDetail:d.querySelector('#fuDetail').value,expectedPeriod:d.querySelector('#fuPeriod').value,age:d.querySelector('#fuAge').value,dueDate:d.querySelector('#fuDue').value,consent:d.querySelector('#fuConsent').value,note:d.querySelector('#fuNote').value};
  if(isNew)Object.assign(meta,{patient:f.patient,clinic:f.clinic,region:f.region,embryologist:f.embryologist,test:f.test,month:f.month,embryos:f.embryos});
  if(state!==undefined)meta.state=state;
  return{caseKey:f.caseKey,followup:meta,outcomes}};
 d.querySelector('.fu-actions').onclick=async e=>{const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  const state=act==='save'?undefined:act==='reopen'?'':act;
  if(act==='not_applicable'&&!confirm('Mark this follow-up as not applicable?'))return;
  b.disabled=true;
  try{const r=await fetch('/api/followups/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(collect(state))});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Save failed');
   const i=FU.items.findIndex(x=>x.caseKey===j.caseKey);if(i>=0)FU.items[i]=j;else FU.items.unshift(j);
   toast('Follow-up saved');d.close();if(after)after(j)}catch(err){toast(err.message||'Could not save');b.disabled=false}};
 if(!d.open)d.showModal()}

// ---------------- Tasks ----------------
function tasksHtml(){
 const items=FU.items.map(f=>({f,s:taskStatus(f)})),cnt=k=>items.filter(x=>x.s===k).length;
 const q=taskQuery.trim().toLowerCase();
 let list=taskFilter==='all'?items:items.filter(x=>x.s===taskFilter);
 if(q)list=list.filter(x=>`${x.f.patient} ${x.f.clinic} ${x.f.test} ${x.f.trfRef||''} ${x.f.contactName}`.toLowerCase().includes(q));
 list=[...list].sort((a,b)=>(a.f.dueDate||'9999').localeCompare(b.f.dueDate||'9999'));
 const tabs=[['all','All',items.length],...TASK_DEFS.map(([k,l])=>[k,l,cnt(k)])];
 return `<div class="fu-toolbar"><div class="prep-segments sheet-tabs fu-tabs" id="fuTaskTabs">${tabs.map(([k,l,n])=>`<button type="button" class="prep-seg${k===taskFilter?' active':''}" data-k="${k}">${l}<b>${n}</b></button>`).join('')}</div><div class="search-wrap fu-search"><span>⌕</span><input id="fuSearch" type="search" placeholder="Search patient, clinic, contact…" value="${esc(taskQuery)}"></div></div>
 <div class="fu-table-wrap fu-tasks"><table class="fu-table"><thead><tr><th>Patient</th><th>Clinic</th><th>Test</th><th>Embryos</th><th>Clinic contact</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
 ${list.map(({f,s})=>{const om=outcomeMap(f),rec=(f.embryos||[]).filter(e=>om[norm(e.label)]?.status).length;return `<tr data-key="${esc(f.caseKey)}"><td class="strong">${esc(f.patient)}<small>${esc(f.trfRef||f.caseKey)}</small></td><td>${esc(f.clinic)}</td><td>${esc(f.test)}</td><td>${(f.embryos||[]).length}<small>${rec} recorded</small></td><td>${esc(f.contactName)||'—'}<small>${esc(f.contactDetail)}</small></td><td class="${s==='overdue'?'fu-late':''}">${fmtDate(f.dueDate)}</td><td>${chip(s)}</td><td><button type="button" class="primary compact" data-rec="1">Record outcome</button></td></tr>`}).join('')||`<tr><td colspan="8" class="chart-empty">${FU.items.length?'No tasks in this group.':'No follow-ups yet. They appear when a TRF with follow-up consent is submitted, or when a team lead starts one from a patient page.'}</td></tr>`}
 </tbody></table></div>`}
function wireTasks(root,redraw){
 root.querySelector('#fuTaskTabs').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;taskFilter=b.dataset.k;redraw()};
 const s=root.querySelector('#fuSearch');s.oninput=()=>{taskQuery=s.value;const pos=s.selectionStart;redraw();const n=root.querySelector('#fuSearch');n.focus();n.setSelectionRange(pos,pos)};
 root.querySelector('.fu-tasks').onclick=e=>{const b=e.target.closest('[data-rec]');if(!b)return;const f=FU.items.find(x=>x.caseKey===b.closest('tr').dataset.key);if(f)openRecordDialog(f,()=>redraw())}}

// ---------------- Dashboard ----------------
function embryoRows(){
 const out=[];
 FU.items.forEach(f=>{if(f.consent==='No'||f.state==='not_applicable')return;const om=outcomeMap(f);
  (f.embryos||[]).forEach(e=>out.push({f,label:e.label,result:e.result||'No result',status:om[norm(e.label)]?.status||'',age:ageGroup(f.age)}))});
 return out}
const pct=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
function dashHtml(){
 const all=embryoRows();
 const opts=k=>[...new Set(all.map(r=>k==='age'?r.age:k==='result'?r.result:k==='month'?r.f.month:r.f[k]).filter(Boolean))];
 const sorted={month:opts('month').sort().reverse(),clinic:opts('clinic').sort(),region:opts('region').sort(),embryologist:opts('embryologist').sort(),test:opts('test').sort(),age:AGE_ORDER.filter(a=>opts('age').includes(a)),result:opts('result').sort()};
 const sel=(k,label,fmt=v=>v)=>`<label class="fu-f"><span>${label}</span><select data-flt="${k}"><option value="">All</option>${sorted[k].map(v=>`<option value="${esc(v)}"${flt[k]===v?' selected':''}>${esc(fmt(v))}</option>`).join('')}</select></label>`;
 const rows=all.filter(r=>(!flt.month||r.f.month===flt.month)&&(!flt.clinic||r.f.clinic===flt.clinic)&&(!flt.region||r.f.region===flt.region)&&(!flt.embryologist||r.f.embryologist===flt.embryologist)&&(!flt.test||r.f.test===flt.test)&&(!flt.age||r.age===flt.age)&&(!flt.result||r.result===flt.result));
 const tr=rows.filter(r=>TRANSFERRED.includes(r.status)),im=rows.filter(r=>IMPLANTED.includes(r.status)),cp=rows.filter(r=>CLINICAL.includes(r.status)),mc=rows.filter(r=>r.status==='Miscarriage'),lb=rows.filter(r=>r.status==='Live birth');
 const kpi=(label,n,d,sub,tone)=>`<article class="fu-kpi fu-k-${tone}"><small>${label}</small><strong>${pct(n,d)}</strong><p>${sub}</p></article>`;
 const dist=[...STATUSES,''].map(s=>[s,rows.filter(r=>r.status===s).length]),peak=Math.max(1,...dist.map(x=>x[1]));
 const byClinic=new Map();rows.forEach(r=>{const c=r.f.clinic||'—',x=byClinic.get(c)||{c,patients:new Set(),n:0,t:0,i:0,p:0,l:0};x.patients.add(r.f.caseKey);x.n++;if(TRANSFERRED.includes(r.status))x.t++;if(IMPLANTED.includes(r.status))x.i++;if(CLINICAL.includes(r.status))x.p++;if(r.status==='Live birth')x.l++;byClinic.set(c,x)});
 const clinics=[...byClinic.values()].sort((a,b)=>b.n-a.n);
 return `<div class="fu-filters">${sel('month','Month',monthLabel)}${sel('clinic','Clinic')}${sel('region','Region')}${sel('embryologist','Embryologist')}${sel('test','Test')}${sel('age','Age group')}${sel('result','Embryo result')}<button type="button" class="secondary compact" id="fuClear">Clear</button></div>
 <div class="fu-kpis">
  ${kpi('Transfer rate',tr.length,rows.length,`${tr.length} of ${rows.length} embryos tracked`,'teal')}
  ${kpi('Implantation rate',im.length,tr.length,`${im.length} of ${tr.length} transferred`,'blue')}
  ${kpi('Clinical pregnancy rate',cp.length,tr.length,`${cp.length} of ${tr.length} transferred`,'violet')}
  ${kpi('Miscarriage rate',mc.length,cp.length,`${mc.length} of ${cp.length} clinical pregnancies`,'red')}
  ${kpi('Live-birth rate',lb.length,tr.length,`${lb.length} of ${tr.length} transferred`,'green')}
 </div>
 <div class="fu-two">
  <section class="fu-card"><h3>Outcome status <small>${rows.length} embryos</small></h3>${dist.map(([s,n])=>`<div class="fu-bar"><span>${esc(s||'Not recorded')}</span><div><i style="width:${(n/peak*100).toFixed(1)}%"></i></div><b>${n}</b></div>`).join('')}</section>
  <section class="fu-card"><h3>By clinic</h3><div class="fu-table-wrap fu-clinics"><table class="fu-table"><thead><tr><th>Clinic</th><th>Patients</th><th>Embryos</th><th>Transferred</th><th>Implant.</th><th>Clin. preg.</th><th>Live birth</th></tr></thead><tbody>${clinics.map(x=>`<tr><td class="strong">${esc(x.c)}</td><td>${x.patients.size}</td><td>${x.n}</td><td>${x.t}</td><td>${pct(x.i,x.t)}</td><td>${pct(x.p,x.t)}</td><td>${pct(x.l,x.t)}</td></tr>`).join('')||'<tr><td colspan="7" class="chart-empty">No data for these filters.</td></tr>'}</tbody></table></div></section>
 </div>
 <p class="fu-note">Transfer rate = transferred ÷ embryos tracked. Implantation, clinical pregnancy and live-birth rates = embryos reaching that stage ÷ transferred embryos. Miscarriage rate = miscarriages ÷ clinical pregnancies. "Outcome unknown" and "Not transferred" embryos count only in embryos tracked. Patients who declined follow-up are left out.</p>`}
function wireDash(root,redraw){
 root.querySelectorAll('[data-flt]').forEach(s=>s.onchange=()=>{flt[s.dataset.flt]=s.value;redraw()});
 root.querySelector('#fuClear').onclick=()=>{Object.keys(flt).forEach(k=>flt[k]='');redraw()}}

// ---------------- Views ----------------
window.renderFollowupView=async function(g,view){
 const title={followup:'Clinical follow-up',fuTasks:'Follow-up tasks',fuDash:'Outcomes'}[view];
 const ht=document.getElementById('genericHeaderTitle');if(ht)ht.textContent=title;
 g.innerHTML='<div class="generic-card wide-card fu-view"><div class="chart-empty">Loading follow-up data…</div></div>';
 await loadFollowups(true);
 const card=g.querySelector('.fu-view');
 const draw=()=>{
  const tab=view==='followup'?subTab:view==='fuTasks'?'tasks':'dash';
  const seg=view==='followup'?`<div class="prep-segments fu-subtabs" id="fuSub"><button type="button" class="prep-seg${tab==='tasks'?' active':''}" data-t="tasks">Tasks</button><button type="button" class="prep-seg${tab==='dash'?' active':''}" data-t="dash">Outcomes dashboard</button></div>`:'';
  card.innerHTML=seg+`<div class="fu-pane">${tab==='tasks'?tasksHtml():dashHtml()}</div>`;
  const sub=card.querySelector('#fuSub');if(sub)sub.onclick=e=>{const b=e.target.closest('[data-t]');if(!b)return;subTab=b.dataset.t;draw()};
  if(tab==='tasks')wireTasks(card,draw);else wireDash(card,draw)};
 draw()};

// ---------------- Patient page section ----------------
const RESULT_NAME={Normal:'Euploid',Abnormal:'Aneuploid',Mosaic:'Mosaic',Inconclusive:'Inconclusive'};
window.renderPatientFollowup=async function(c,resolvedAll){
 if(typeof canEditData==='function'&&!canEditData())return;
 const anchor=document.querySelector('#patientDetail .embryo-table-card');if(!anchor)return;
 let sec=document.getElementById('fuSection');if(sec)sec.remove();
 sec=document.createElement('section');sec.id='fuSection';sec.className='fu-section';sec.innerHTML='<div class="chart-empty">Loading outcome follow-up…</div>';anchor.after(sec);
 await loadFollowups(true);
 const labels=(resolvedAll||[]).map(r=>{const id=resultIdentity(r);return{label:id.patient?`${id.patient}-${id.embryo}`:id.embryo,result:RESULT_NAME[conclusionClass(r)]||'No result'}}).filter(x=>x.label);
 const list=labels.length?labels:Array.from({length:c.samples||0},(_,i)=>({label:`Embryo ${i+1}`,result:'No result'}));
 const f=FU.items.find(x=>x.caseKey===c.id);
 const month=(c.embryos||[]).map(recordMonth).find(m=>/^\d{4}-\d{2}$/.test(m))||'';
 const draft={_new:true,caseKey:c.id,patient:c.patient,clinic:c.client||'',region:c.region||'',embryologist:c.embryologist||'',test:c.test||'',month,age:null,embryos:list,consent:'Yes',contactName:'',contactDetail:'',expectedPeriod:'',dueDate:addDays(today(),90),state:'',note:'',outcomes:[]};
 const draw=()=>{const f2=FU.items.find(x=>x.caseKey===c.id),om=f2?outcomeMap(f2):{};
  sec.innerHTML=`<div class="fu-sec-head"><div class="embryo-table-title"><h3>Outcome follow-up</h3>${f2?chip(taskStatus(f2)):''}</div><button type="button" class="primary compact" id="fuRecord">${f2?'Record outcome':'Start follow-up'}</button></div>
  ${f2&&f2.consent==='No'?'<p class="fu-note">The patient has not consented to outcome follow-up.</p>':''}
  <div class="fu-table-wrap"><table class="fu-table"><thead><tr><th>Embryo</th><th>Result</th><th>Outcome</th><th>Date</th></tr></thead><tbody>${list.map(e=>{const o=om[norm(e.label)]||{};return `<tr><td class="strong">${esc(e.label)}</td><td>${resChip(e.result)}</td><td>${statusChip(o.status)}</td><td>${fmtDate(o.date)}</td></tr>`}).join('')||'<tr><td colspan="4" class="chart-empty">No embryos.</td></tr>'}</tbody></table></div>`;
  sec.querySelector('#fuRecord').onclick=()=>{const base=FU.items.find(x=>x.caseKey===c.id)||draft;openRecordDialog(base._new?base:{...base,embryos:(base.embryos&&base.embryos.length)?base.embryos:list},draw)}};
 draw()};
})();
