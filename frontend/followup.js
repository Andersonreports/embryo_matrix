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
let editorSeq=0;
function editorHtml(embryos,om){
 const uid='oe'+(++editorSeq);
 if(!embryos.length)return'<div class="chart-empty">No embryos are listed for this patient.</div>';
 return `<div class="oe-list" data-uid="${uid}">${embryos.map((e,i)=>{const o=om[norm(e.label)]||{};
  return `<div class="oe-card" data-label="${esc(e.label)}"><div class="oe-head"><strong>${esc(e.label)}</strong>${resChip(e.result)}<button type="button" class="oe-clear" title="Clear this embryo's outcome">Clear</button></div>
  <div class="oe-groups">${GROUPS.map(([g,list])=>`<div class="oe-group"><small>${g}</small><div class="oe-opts">${list.map(s=>`<label class="oe-chip fu-os-${norm(s).toLowerCase()}"><input type="radio" name="${uid}-${i}" value="${esc(s)}"${o.status===s?' checked':''}><span>${esc(s)}</span></label>`).join('')}</div></div>`).join('')}</div>
  <div class="oe-extra"><label class="fu-f"><span>Date of this outcome</span><input class="oe-date" type="date" value="${esc(o.date||'')}"></label><label class="fu-f"><span>Note</span><input class="oe-note" value="${esc(o.note||'')}" placeholder="Optional"></label></div></div>`}).join('')}</div>`}
const readEditor=root=>[...root.querySelectorAll('.oe-card')].map(c=>({embryo:c.dataset.label,status:c.querySelector('input[type=radio]:checked')?.value||'',date:c.querySelector('.oe-date').value,note:c.querySelector('.oe-note').value}));
function wireEditor(root,onChange){
 root.addEventListener('change',()=>onChange&&onChange());
 root.addEventListener('click',e=>{const b=e.target.closest('.oe-clear');if(!b)return;const c=b.closest('.oe-card');c.querySelectorAll('input[type=radio]').forEach(r=>r.checked=false);onChange&&onChange()})}
const sumCards=(out)=>{const n=out.length,c=l=>out.filter(x=>l.includes(x.status)).length,rec=out.filter(x=>x.status).length;
 return [['Embryos',n],['Transferred',c(TRANSFERRED)],['Implantation +',c(IMPLANTED)],['Clinical pregnancy',c(CLINICAL)],['Live birth',c(['Live birth'])],['Not recorded',n-rec]].map(([l,v])=>`<div class="fu-sc"><strong>${v}</strong><small>${l}</small></div>`).join('')};

// ---------------- Patient outcome dialog (opened from the task queue and from the patient page) ----------------
function dlgEl(){let d=document.getElementById('fuDialog');if(!d){d=document.createElement('dialog');d.id='fuDialog';d.className='vu-dialog vu-dialog-wide fu-dialog';document.body.append(d);d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()})}return d}
function openRecordDialog(f,after){
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
 if(!d.open)d.showModal()}
async function postSave(body){
 const r=await fetch('/api/followups/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Save failed');
 const i=FU.items.findIndex(x=>x.caseKey===j.caseKey);if(i>=0)FU.items[i]=j;else FU.items.unshift(j);return j}

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
 root.querySelector('.fu-tasks').onclick=e=>{const tr=e.target.closest('tr[data-key]');if(!tr)return;const f=FU.items.find(x=>x.caseKey===tr.dataset.key);if(f)openRecordDialog(f,()=>redraw())}}

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
 const inSet=l=>rows.filter(r=>l.includes(r.status)),tr=inSet(TRANSFERRED),im=inSet(IMPLANTED),cp=inSet(CLINICAL),mc=inSet(['Miscarriage']),lb=inSet(['Live birth']),recorded=rows.filter(r=>r.status).length;
 const patients=new Set(rows.map(r=>r.f.caseKey)).size;
 const count=(label,n,sub,tone)=>`<article class="fu-cnt fu-k-${tone}"><strong>${n.toLocaleString()}</strong><small>${label}</small><p>${sub}</p></article>`;
 const kpi=(label,n,d,sub,tone)=>`<article class="fu-kpi fu-k-${tone}"><small>${label}</small><strong>${pct(n,d)}</strong><p>${sub}</p></article>`;
 // funnel: how many embryos reach each stage
 const stages=[['Embryos tracked',rows.length],['Transferred',tr.length],['Implantation positive',im.length],['Clinical pregnancy',cp.length],['Live birth',lb.length]];
 const funnel=stages.map(([l,n],i)=>{const prev=i?stages[i-1][1]:0,w=rows.length?n/rows.length*100:0;return `<div class="fu-fn"><span>${l}</span><div class="fu-fn-bar"><i style="width:${Math.max(w,n?3:0).toFixed(1)}%"></i></div><b>${n}</b><em>${i?pct(n,prev)+' of previous':'100%'}</em></div>`}).join('');
 const dist=[...STATUSES,''].map(s=>[s,rows.filter(r=>r.status===s).length]);
 const grp=(keyFn)=>{const m=new Map();rows.forEach(r=>{const k=keyFn(r)||'—',x=m.get(k)||{k,patients:new Set(),n:0,t:0,i:0,p:0,l:0};x.patients.add(r.f.caseKey);x.n++;if(TRANSFERRED.includes(r.status))x.t++;if(IMPLANTED.includes(r.status))x.i++;if(CLINICAL.includes(r.status))x.p++;if(r.status==='Live birth')x.l++;m.set(k,x)});return[...m.values()]};
 const table=(title,list,first)=>`<section class="fu-card"><h3>${title}</h3><div class="fu-table-wrap fu-clinics"><table class="fu-table"><thead><tr><th>${first}</th><th>Patients</th><th>Embryos</th><th>Transferred</th><th>Implant.</th><th>Clin. preg.</th><th>Live birth</th></tr></thead><tbody>${list.map(x=>`<tr><td class="strong">${esc(first==='Month'?monthLabel(x.k):x.k)}</td><td>${x.patients.size}</td><td>${x.n}</td><td>${x.t}</td><td>${pct(x.i,x.t)}</td><td>${pct(x.p,x.t)}</td><td>${pct(x.l,x.t)}</td></tr>`).join('')||'<tr><td colspan="7" class="chart-empty">No data for these filters.</td></tr>'}</tbody></table></div></section>`;
 const clinics=grp(r=>r.f.clinic).sort((a,b)=>b.n-a.n),months=grp(r=>r.f.month).sort((a,b)=>String(b.k).localeCompare(String(a.k)));
 const peak=Math.max(1,...dist.map(x=>x[1]));
 return `<div class="fu-filters">${sel('month','Month',monthLabel)}${sel('clinic','Clinic')}${sel('region','Region')}${sel('embryologist','Embryologist')}${sel('test','Test')}${sel('age','Age group')}${sel('result','Embryo result')}<button type="button" class="secondary compact" id="fuClear">Clear filters</button></div>
 <h4 class="fu-h">Counts</h4>
 <div class="fu-cnts">${count('Patients followed',patients,`${rows.length} embryos`,'teal')}${count('Embryos with an outcome',recorded,`${rows.length-recorded} not recorded yet`,'slate')}${count('Transferred',tr.length,'embryos','blue')}${count('Implantation positive',im.length,'embryos','blue')}${count('Clinical pregnancies',cp.length,'embryos','violet')}${count('Miscarriages',mc.length,'embryos','red')}${count('Live births',lb.length,'embryos','green')}</div>
 <h4 class="fu-h">Rates</h4>
 <div class="fu-kpis">
  ${kpi('Transfer rate',tr.length,rows.length,`${tr.length} of ${rows.length} embryos tracked`,'teal')}
  ${kpi('Implantation rate',im.length,tr.length,`${im.length} of ${tr.length} transferred`,'blue')}
  ${kpi('Clinical pregnancy rate',cp.length,tr.length,`${cp.length} of ${tr.length} transferred`,'violet')}
  ${kpi('Miscarriage rate',mc.length,cp.length,`${mc.length} of ${cp.length} clinical pregnancies`,'red')}
  ${kpi('Live-birth rate',lb.length,tr.length,`${lb.length} of ${tr.length} transferred`,'green')}
 </div>
 <div class="fu-two">
  <section class="fu-card"><h3>Outcome funnel</h3>${funnel}</section>
  <section class="fu-card"><h3>Outcome status <small>${rows.length} embryos</small></h3>${dist.map(([s,n])=>`<div class="fu-bar"><span>${esc(s||'Not recorded')}</span><div><i style="width:${(n/peak*100).toFixed(1)}%"></i></div><b>${n}</b></div>`).join('')}</section>
 </div>
 <div class="fu-two fu-two-eq">${table('By clinic',clinics,'Clinic')}${table('By month',months,'Month')}</div>
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
