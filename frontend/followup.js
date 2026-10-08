// Clinical outcome follow-up: task queue, "Record outcome" dialog, outcomes dashboard and the patient-page section.
// Data comes from /api/followups (a snapshot of each patient's embryos is kept with the record, so these pages work
// for the embryologist role too, which cannot read the sample sheet).
(function(){
const STATUSES=['Not transferred','Transferred','Implantation successful','Implantation unsuccessful','Clinical pregnancy','Miscarriage','Live birth','Outcome unknown'];
const TRANSFERRED=['Transferred','Implantation successful','Implantation unsuccessful','Clinical pregnancy','Miscarriage','Live birth'];
const IMPLANTED=['Implantation successful','Clinical pregnancy','Miscarriage','Live birth'];
const CLINICAL=['Clinical pregnancy','Miscarriage','Live birth'];
const ACTIVE=['Transferred','Implantation successful','Clinical pregnancy'];
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
const GROUPS=[['Before transfer',['Not transferred']],['Transfer',['Transferred']],['Implantation',['Implantation successful','Implantation unsuccessful']],['Pregnancy',['Clinical pregnancy','Miscarriage','Live birth']],['Other',['Outcome unknown']]];
const histItem=h=>`<li><span class="hi-dot"></span><div><b>${h.status?statusChip(h.status):'<span class="fu-os fu-os-none">Cleared</span>'}</b>${h.previous?`<small>was ${esc(h.previous)}</small>`:'<small>first entry</small>'}${h.date?`<small>outcome date ${fmtDate(h.date)}</small>`:''}${h.note?`<em>${esc(h.note)}</em>`:''}<span class="hi-by">${esc(h.by||'—')} · ${fmtWhen(h.at)}</span></div></li>`;
const fmtWhen=iso=>{if(!iso)return'';const d=new Date(iso);return isNaN(d)?'':d.toLocaleString([],{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})};
const histHtml=list=>list&&list.length?`<ol class="hist">${[...list].reverse().map(histItem).join('')}</ol>`:'<p class="fu-note" style="margin:0">No changes recorded yet.</p>';
const TERA_RESULTS=['Pre-receptive','Receptive','Post-receptive'];
const FURTHER=[['tera','TERA'],['nips','NIPS']];
const WHERE=[['','— Not recorded —'],['Not done','Not done'],['Anderson','Done at Anderson'],['Other lab','Done at other labs']];
function testsHtml(t){
 return `<div class="oe-tests"><small class="oe-tests-title">Further testing after PGT-A</small><div class="oe-tests-grid">${FURTHER.map(([k,label])=>{const v=t[k]||{},done=v.where==='Anderson'||v.where==='Other lab';
  return `<div class="oe-test" data-t="${k}"><h5>${label}</h5>
   <label class="fu-f"><span>Status</span><select class="ot-where">${WHERE.map(([val,l])=>`<option value="${esc(val)}"${(v.where||'')===val?' selected':''}>${l}</option>`).join('')}</select></label>
   <label class="fu-f ot-lab-wrap"${v.where==='Other lab'?'':' hidden'}><span>Lab name</span><input class="ot-lab" value="${esc(v.lab||'')}" placeholder="Name of the other lab"></label>
   <div class="ot-done${k==='tera'?' ot-tera':''}"${done?'':' hidden'}><label class="fu-f"><span>Date done</span><input class="ot-date" type="date" value="${esc(v.date||'')}"></label>
   ${k==='tera'?`<label class="fu-f"><span>Biopsy time</span><input class="ot-time" type="time" value="${esc(v.biopsyTime||'')}"></label>
   <label class="fu-f"><span>Result</span><select class="ot-result"><option value="">— Select —</option>${[...TERA_RESULTS,...(v.result&&!TERA_RESULTS.includes(v.result)?[v.result]:[])].map(r=>`<option${v.result===r?' selected':''}>${esc(r)}</option>`).join('')}</select></label>`:`<label class="fu-f"><span>Result</span><input class="ot-result" value="${esc(v.result||'')}" placeholder="Result"></label>`}
   <label class="fu-f"><span>Other details</span><input class="ot-note" value="${esc(v.note||'')}" placeholder="Report no., remarks…"></label></div></div>`}).join('')}</div></div>`}
const isClient=()=>currentUser&&currentUser.role==='embryologist';
const shareCtl=e=>isClient()?`<label class="oe-share${e.share==='Yes'?' yes':e.share==='No'?' no':''}" title="Anderson can see this embryo's follow-up only if you choose Yes"><span>Share with Anderson</span><select class="oe-share-sel">${e.share?'':'<option value="" selected disabled>Choose…</option>'}<option${e.share==='Yes'?' selected':''}>Yes</option><option${e.share==='No'?' selected':''}>No</option></select></label>`:'';
let editorSeq=0;
function editorHtml(embryos,om){
 const uid='oe'+(++editorSeq);
 if(!embryos.length)return'<div class="chart-empty">No embryos are listed for this patient.</div>';
 return `<div class="oe-list" data-uid="${uid}">${embryos.map((e,i)=>{const o=om[norm(e.label)]||{};
  return `<div class="oe-card" data-label="${esc(e.label)}"><div class="oe-head"><strong>${esc(e.label)}</strong>${resChip(e.result)}${shareCtl(e)}<button type="button" class="oe-clear" title="Clear this embryo's outcome">Clear</button></div>
  <div class="oe-status"><label class="fu-f"><span>Current status <small>(choose one)</small></span><select class="oe-sel">${`<option value="">— Not recorded —</option>`+GROUPS.map(([g,list])=>`<optgroup label="${g}">${list.map(s=>`<option${o.status===s?' selected':''}>${esc(s)}</option>`).join('')}</optgroup>`).join('')}</select></label><span class="oe-now">${statusChip(o.status||'')}</span></div>
  <div class="oe-extra"><label class="fu-f"><span>Date of this outcome</span><input class="oe-date" type="date" value="${esc(o.date||'')}"></label><label class="fu-f"><span>Note</span><input class="oe-note" value="${esc(o.note||'')}" placeholder="Optional"></label></div>${testsHtml(o.tests||{})}<div class="oe-foot"><button type="button" class="primary compact oe-rec">Record outcome</button><button type="button" class="oe-hist-btn">History <b>${(o.history||[]).length}</b></button><span class="oe-saved"></span></div><div class="oe-hist" hidden>${histHtml(o.history)}</div></div>`}).join('')}</div>`}
const readTests=c=>{const t={};c.querySelectorAll('.oe-test').forEach(b=>{t[b.dataset.t]={where:b.querySelector('.ot-where').value,lab:b.querySelector('.ot-lab').value,date:b.querySelector('.ot-date').value,biopsyTime:b.querySelector('.ot-time')?.value||'',result:b.querySelector('.ot-result').value,note:b.querySelector('.ot-note').value}});return t};
const readCard=c=>({embryo:c.dataset.label,status:c.querySelector('.oe-sel')?.value||'',date:c.querySelector('.oe-date').value,note:c.querySelector('.oe-note').value,tests:readTests(c)});
const readEditor=root=>[...root.querySelectorAll('.oe-card')].map(c=>({embryo:c.dataset.label,status:c.querySelector('.oe-sel')?.value||'',date:c.querySelector('.oe-date').value,note:c.querySelector('.oe-note').value,tests:readTests(c)}));
function wireEditor(root,onChange,onRecord,onShare){
 root.addEventListener('click',async e=>{const hb=e.target.closest('.oe-hist-btn');if(hb){const h=hb.closest('.oe-card').querySelector('.oe-hist');h.hidden=!h.hidden;return}const rb=e.target.closest('.oe-rec');if(rb&&onRecord){rb.disabled=true;try{await onRecord(rb.closest('.oe-card'))}finally{rb.disabled=false}}});
 root.addEventListener('change',e=>{const sh=e.target.closest('.oe-share-sel');if(sh){const lab=sh.closest('.oe-share');lab.classList.toggle('yes',sh.value==='Yes');lab.classList.toggle('no',sh.value==='No');if(onShare)onShare(sh.closest('.oe-card').dataset.label,sh.value);return}const sl=e.target.closest('.oe-sel');if(sl){const c=sl.closest('.oe-card');c.querySelector('.oe-now').innerHTML=statusChip(sl.value)}const w=e.target.closest('.ot-where');if(w){const b=w.closest('.oe-test'),v=w.value;b.querySelector('.ot-lab-wrap').hidden=v!=='Other lab';b.querySelector('.ot-done').hidden=!(v==='Anderson'||v==='Other lab')}onChange&&onChange()});
 root.addEventListener('click',e=>{const b=e.target.closest('.oe-clear');if(!b)return;const c=b.closest('.oe-card');c.querySelector('.oe-sel').value='';c.querySelector('.oe-now').innerHTML=statusChip('');onChange&&onChange()})}
const sumCards=(out)=>{const n=out.length,c=l=>out.filter(x=>l.includes(x.status)).length,rec=out.filter(x=>x.status).length;
 return [['Embryos',n],['Transferred',c(TRANSFERRED)],['Implantation +',c(IMPLANTED)],['Clinical pregnancy',c(CLINICAL)],['Live birth',c(['Live birth'])],['Not recorded',n-rec]].map(([l,v])=>`<div class="fu-sc"><strong>${v}</strong><small>${l}</small></div>`).join('')};

// ---------------- Patient outcome dialog (opened from the task queue and from the patient page) ----------------
function dlgEl(){let d=document.getElementById('fuDialog');if(!d){d=document.createElement('dialog');d.id='fuDialog';d.className='vu-dialog vu-dialog-wide fu-dialog';document.body.append(d);d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close()})}return d}
function openRecordDialog(f,after,focusLabel){
 const d=dlgEl(),om=outcomeMap(f),isNew=!!f._new,emb=f.embryos||[];
 d.innerHTML=`<div class="vu-dhead"><div><h3>${esc(f.patient||'Patient')}</h3><small>${esc(f.clinic||'')}${f.test?' · '+esc(f.test):''}${f.trfRef?' · '+esc(f.trfRef):''}</small></div><div>${isNew?'':chip(taskStatus(f))} <button type="button" class="secondary compact" data-close>Close</button></div></div>
 <div class="vu-dbody fu-body">
  <div class="fu-sum" id="fuSum"></div>
  <section class="fu-block"><div class="fu-block-head"><h4>Individual embryo outcomes</h4><small>Choose what happened to each embryo. Leave an embryo blank if nothing is known yet.</small>${isClient()?'<div class="fu-shareall"><span>Anderson sees the follow-up only for embryos you share.</span><button type="button" class="secondary compact" id="fuShareAll">Share all embryos</button></div>':''}</div><div id="fuEditor">${editorHtml(emb,om)}</div></section>
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
 refreshSum();wireEditor(ed,refreshSum,async card=>{
  const meta=isNew?{patient:f.patient,clinic:f.clinic,region:f.region,embryologist:f.embryologist,test:f.test,month:f.month,embryos:f.embryos,consent:'Yes',dueDate:f.dueDate}:{};
  try{const j=await postSave({caseKey:f.caseKey,followup:meta,outcomes:[readCard(card)]});f._new=false;const om2=outcomeMap(j),o2=om2[norm(card.dataset.label)]||{};
   card.querySelector('.oe-hist').innerHTML=histHtml(o2.history);card.querySelector('.oe-hist-btn b').textContent=(o2.history||[]).length;
   const sv=card.querySelector('.oe-saved');sv.textContent='Saved ✓';setTimeout(()=>{sv.textContent=''},2500);refreshSum();if(after)after(j,true)}catch(err){toast(err.message||'Could not save')}},
  async(label,val)=>{try{const j=await postSave({caseKey:f.caseKey,share:{[label]:val}});(f.embryos||[]).forEach(x=>{if(norm(x.label)===norm(label))x.share=val});toast(val==='Yes'?`${label} shared with Anderson`:`${label} not shared`);if(after)after(j,true)}catch(err){toast(err.message||'Could not save')}});
 const sa=d.querySelector('#fuShareAll');if(sa)sa.onclick=async()=>{const share={};(f.embryos||[]).forEach(x=>{share[x.label]='Yes'});try{const j=await postSave({caseKey:f.caseKey,share});(f.embryos||[]).forEach(x=>{x.share='Yes'});d.querySelectorAll('.oe-share').forEach(l=>{l.classList.add('yes');l.classList.remove('no');const sel=l.querySelector('select');sel.querySelector('[disabled]')?.remove();sel.value='Yes'});toast('All embryos shared with Anderson');if(after)after(j,true)}catch(err){toast(err.message||'Could not save')}};
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
 const i=FU.items.findIndex(x=>x.caseKey===j.caseKey),hidden=!(j.embryos&&j.embryos.length);if(hidden){if(i>=0)FU.items.splice(i,1)}else if(i>=0)FU.items[i]=j;else FU.items.unshift(j);return j}

// ---------------- Shared bits for the redesigned pages ----------------
const IC=n=>`<img class="ico" src="/static/icons/${n}.png" alt="">`;
const SVG={heart:'<svg viewBox="0 0 24 24" width="30" height="30" fill="#e0457b"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 5 6 5c2 0 3.4 1 4 2.2h4C14.600 6 16 5 18 5c3.300 0 5.100 3.400 3.600 6.800C19.500 16.400 12 21 12 21z"/></svg>'};
const relDue=(due)=>{if(!due)return'';const d=Math.round((new Date(due+'T00:00:00')-new Date(today()+'T00:00:00'))/864e5);return d<0?`Overdue by ${-d} day${d===-1?'':'s'}`:d===0?'Due today':d===1?'Due tomorrow':`Due in ${d} days`};
const TILES=[
 ['all','Total embryos','stages-results__total-embryos','Every embryo in your list','slate'],
 ['consent','With consent','navigation__notifications','Patient agreed to follow-up','amber'],
 ['recorded','Outcomes recorded','stages-results__qc-pass','Embryos with a status entered','green'],
 ['pending','Still to record','navigation__internal-transfer','No outcome entered yet','blue'],
 ['completed','Completed','stages-results__normal','Final outcome known','teal'],
 ['na','No consent','stages-results__na-result','Not followed up','grey']];
let clQ='',clAll=false,filtersOpen=false,dashHome=false,taskSort='due',taskView='patient',viewChosen=false,taskEmb='',onlyNeeds=false;

// ---------------- Tasks (card queue) ----------------
function tasksHtml(){
 const mine=currentUser&&currentUser.role==='embryologist';if(mine&&!viewChosen)taskView='embryo';
 const embs=[...new Set(FU.items.map(f=>f.embryologist).filter(Boolean))].sort();
 const items=FU.items.filter(f=>!taskEmb||f.embryologist===taskEmb).map(f=>({f,s:taskStatus(f)}));
 const emN=x=>(x.f.embryos||[]).length,recN=x=>{const om=outcomeMap(x.f);return(x.f.embryos||[]).filter(e=>om[norm(e.label)]?.status).length};
 const consent=x=>x.s!=='na',sum=(arr,fn)=>arr.reduce((t,x)=>t+fn(x),0);
 const cnt=k=>k==='all'?sum(items,emN):k==='consent'?sum(items.filter(consent),emN):k==='recorded'?sum(items.filter(consent),recN):k==='pending'?sum(items.filter(consent),x=>emN(x)-recN(x)):k==='completed'?sum(items.filter(x=>x.s==='completed'),emN):sum(items.filter(x=>x.s==='na'),emN);
 const keep=k=>x=>k==='all'||(k==='consent'&&consent(x))||(k==='recorded'&&consent(x)&&recN(x)>0)||(k==='pending'&&consent(x)&&recN(x)<emN(x))||(k==='completed'&&x.s==='completed')||(k==='na'&&x.s==='na');
 const q=taskQuery.trim().toLowerCase();
 if(!TILES.some(t=>t[0]===taskFilter))taskFilter='all';
 let list=items.filter(keep(taskFilter));
 if(q)list=list.filter(x=>`${x.f.patient} ${x.f.clinic} ${x.f.test} ${x.f.trfRef||''} ${x.f.contactName}`.toLowerCase().includes(q));
 const cmp={due:(a,b)=>(a.f.dueDate||'9999').localeCompare(b.f.dueDate||'9999'),patient:(a,b)=>a.f.patient.localeCompare(b.f.patient),clinic:(a,b)=>a.f.clinic.localeCompare(b.f.clinic)}[taskSort];
 list=[...list].sort(cmp);
 const attention=items.filter(x=>x.s==='due'||x.s==='overdue').length;
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
 const hero=mine?``:`<div class="fu-hero"><div><h2>${attention?`${attention} patient${attention===1?'':'s'} need${attention===1?'s':''} a follow-up`:'You are all caught up'}</h2><p>Ask each clinic what happened to the embryos after transfer, then record it with <b>Record outcome</b>.</p></div>${isStaff()?'<div class="hero-btns"><button type="button" class="hero-btn" id="fuFromSheet">＋ Add patients from the sheet</button></div>':''}</div>`;
 return `${hero}
 <div class="st-tiles">${tiles}</div>
 <div class="tk-bar"><div class="seg-toggle" id="fuView"><button type="button" class="${taskView==='patient'?'on':''}" data-v="patient">By patient</button><button type="button" class="${taskView==='embryo'?'on':''}" data-v="embryo">By embryo</button></div><div class="search-wrap fu-search"><span>⌕</span><input id="fuSearch" type="search" placeholder="Search patient, clinic or contact…" value="${esc(taskQuery)}"></div>${!mine&&embs.length>1?`<label class="tk-sort">Embryologist <select id="fuEmb"><option value="">All</option>${embs.map(n=>`<option${taskEmb===n?' selected':''}>${esc(n)}</option>`).join('')}</select></label>`:''}${taskView==='embryo'?`<label class="tk-sort"><input type="checkbox" id="fuNeeds"${onlyNeeds?' checked':''}> Only embryos needing details</label>`:''}<label class="tk-sort">Sort by <select id="fuSort"><option value="due"${taskSort==='due'?' selected':''}>Due date</option><option value="patient"${taskSort==='patient'?' selected':''}>Patient name</option><option value="clinic"${taskSort==='clinic'?' selected':''}>Clinic</option></select></label></div>
 ${taskView==='embryo'?embryoTable(list):`<div class="tk-list">${list.map(card).join('')||empty}</div>`}`}
function embryoTable(list){
 const rows=[];list.forEach(({f,s})=>{const om=outcomeMap(f);(f.embryos||[]).forEach(e=>{const o=om[norm(e.label)]||{};rows.push({f,s,e,o})})});
 const shown=rows.filter(r=>(!onlyNeeds||!r.o.status)&&(taskFilter!=='recorded'||!!r.o.status)&&(taskFilter!=='pending'||(!r.o.status&&r.s!=='na')));
 const tchip=(t,k)=>{const v=(t||{})[k];if(!v||!v.where)return'<span class="fu-os fu-os-none">—</span>';return v.where==='Not done'?'<span class="fu-os fu-os-none">Not done</span>':`<span class="fu-os">${v.where==='Anderson'?'Anderson':esc(v.lab||'Other lab')}${v.result?' · '+esc(v.result):''}</span>`};
 return `<div class="fu-table-wrap fu-tasks"><table class="fu-table"><thead><tr><th>Patient</th><th>Embryo</th><th>PGT-A result</th><th>Outcome</th><th>TERA</th><th>NIPS</th><th>Task</th><th></th></tr></thead><tbody>${shown.map(({f,s,e,o})=>`<tr data-key="${esc(f.caseKey)}" data-emb="${esc(e.label)}"><td class="strong">${esc(f.patient)}<small>${esc(f.clinic)}</small></td><td class="strong">${esc(e.label)}</td><td>${resChip(e.result)}</td><td>${statusChip(o.status)}</td><td>${tchip(o.tests,'tera')}</td><td>${tchip(o.tests,'nips')}</td><td>${chip(s)}</td><td><button type="button" class="primary compact" data-fill="1">Record outcome</button></td></tr>`).join('')||'<tr><td colspan="8" class="chart-empty">No embryos to show.</td></tr>'}</tbody></table></div>`}

function wireTasks(root,redraw){
 const tg=root.querySelector('#fuView');if(tg)tg.onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;taskView=b.dataset.v;viewChosen=true;redraw()};
 const ef=root.querySelector('#fuEmb');if(ef)ef.onchange=()=>{taskEmb=ef.value;redraw()};
 const nd=root.querySelector('#fuNeeds');if(nd)nd.onchange=()=>{onlyNeeds=nd.checked;redraw()};
 const fs=root.querySelector('#fuFromSheet');if(fs)fs.onclick=()=>openSheetImport(redraw);
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


// Click on the TERA / NIPS chip: every embryo it was done on, at Anderson or at other labs (with the lab name).
function openTestList(k,label,rows){
 const done=rows.filter(r=>['Anderson','Other lab'].includes(r.tests?.[k]?.where));
 let f='all';const d=dlgEl();d.classList.add('vu-dialog-wide');
 const draw=()=>{const list=done.filter(r=>f==='all'||(f==='Anderson'?r.tests[k].where==='Anderson':r.tests[k].where==='Other lab'));
  const nA=done.filter(r=>r.tests[k].where==='Anderson').length,nO=done.length-nA;
  d.innerHTML=`<div class="vu-dhead"><h3>${label} · ${done.length} embryo${done.length===1?'':'s'}</h3><button type="button" class="secondary compact" data-close>Close</button></div><div class="vu-dbody"><div class="seg-toggle" id="ftTog" style="margin-bottom:12px">${[['all',`All (${done.length})`],['Anderson',`At Anderson (${nA})`],['Other lab',`At other labs (${nO})`]].map(([v,l])=>`<button type="button" class="${f===v?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>
  <div class="fu-table-wrap emb-list-wrap"><table class="fu-table"><thead><tr><th>#</th><th>Patient</th><th>Embryo</th><th>Client</th><th>Done at</th>${k==='tera'?'<th>Biopsy time</th>':''}<th>Date</th><th>Result</th><th>Details</th></tr></thead><tbody>${list.map((r,i)=>{const t=r.tests[k];return `<tr><td>${i+1}</td><td class="strong">${esc(r.f.patient)}</td><td class="strong">${esc(r.label)}</td><td>${esc(r.f.clinic)}</td><td>${t.where==='Anderson'?'<span class="fu-os">Anderson</span>':`<span class="fu-os fu-os-lab">${esc(t.lab||'Another lab')}</span>`}</td>${k==='tera'?`<td>${esc(t.biopsyTime||'—')}</td>`:''}<td>${fmtDate(t.date)}</td><td>${t.result?esc(t.result):'—'}</td><td>${esc(t.note||'')}</td></tr>`}).join('')||'<tr><td colspan="9" class="chart-empty">Nothing here.</td></tr>'}</tbody></table></div></div>`;
  d.querySelector('#ftTog').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;f=b.dataset.v;draw()}};
 draw();if(!d.open)d.showModal()}

// ---------------- Dashboard ----------------
function embryoRows(){
 const out=[];
 FU.items.forEach(f=>{if(f.consent==='No'||f.state==='not_applicable')return;const om=outcomeMap(f);
  (f.embryos||[]).forEach(e=>out.push({f,label:e.label,result:e.result||'No result',status:om[norm(e.label)]?.status||'',tests:om[norm(e.label)]?.tests||{},age:ageGroup(f.age)}))});
 return out}
const pct=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
const ring=(n,d,color)=>{const p=d?n/d:0,r=34,c=2*Math.PI*r;return `<svg class="ring" viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="#e8efee" stroke-width="9"/>${p>0?`<circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c*p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)"/>`:''}<text x="42" y="47" text-anchor="middle" font-size="15" font-weight="700" fill="#17302f">${d?Math.round(p*100)+'%':'—'}</text></svg>`};
const OS_COLOR={'Not transferred':'#9aa6a0','Transferred':'#3b8fd0','Implantation successful':'#14b8a6','Implantation unsuccessful':'#e57373','Clinical pregnancy':'#7c5cbf','Miscarriage':'#d12f2f','Live birth':'#1f8a52','Outcome unknown':'#6b766f','':'#dfe6e4'};
const tileGrid=(segs,total)=>`<div class="tg">${segs.map(([n,col,l])=>`<div class="tg-t${n?'':' zero'}" style="--c:${col}"><strong>${n}</strong><span>${esc(l)}</span><em>${total?Math.round(n/total*100)+'% of '+total:'—'}</em></div>`).join('')}</div>`;
const colChart=(segs,total)=>{const peak=Math.max(1,...segs.map(x=>x[0]));
 return `<div class="cc">${segs.map(([n,col,l])=>`<div class="cc-col${n?'':' zero'}" title="${esc(l)}: ${n}"><b>${n}</b><div class="cc-track"><i style="height:${n?Math.max(n/peak*100,6):0}%;background:${col}"></i></div><span>${esc(l)}</span><em>${total?Math.round(n/total*100):0}%</em></div>`).join('')}</div>`};
const donut=(segs,center,sub)=>{const tot=segs.reduce((s,x)=>s+x[0],0),r=52,c=2*Math.PI*r;let off=0;
 const arcs=tot?segs.filter(x=>x[0]).map(([n,col,l])=>{const len=n/tot*c,el=`<circle cx="70" cy="70" r="${r}" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${Math.max(len-1.5,0.5).toFixed(2)} ${(c-len+1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(l)}: ${n}</title></circle>`;off+=len;return el}).join(''):'';
 return `<svg class="dn" viewBox="0 0 140 140" width="150" height="150"><circle cx="70" cy="70" r="${r}" fill="none" stroke="#eef2f1" stroke-width="22"/>${arcs}<text x="70" y="68" text-anchor="middle" font-size="26" font-weight="700" fill="#17302f" font-family="Lora,serif">${center}</text><text x="70" y="86" text-anchor="middle" font-size="10.5" fill="#76868a">${sub}</text></svg>`};
const dnLegend=(segs,total,hideZero)=>`<div class="dn-leg">${segs.filter(x=>!hideZero||x[0]).map(([n,col,l])=>`<div class="dn-row${n?'':' zero'}"><i style="background:${col}"></i><span>${esc(l)}</span><b>${n}</b><em>${total?Math.round(n/total*100):0}%</em></div>`).join('')}</div>`;
function dashHtml(){
 const all=embryoRows();
 const opts=k=>[...new Set(all.map(r=>k==='age'?r.age:k==='result'?r.result:k==='month'?r.f.month:r.f[k]).filter(Boolean))];
 const sorted={month:opts('month').sort().reverse(),clinic:opts('clinic').sort(),region:opts('region').sort(),embryologist:opts('embryologist').sort(),test:opts('test').sort(),age:AGE_ORDER.filter(a=>opts('age').includes(a)),result:opts('result').sort()};
 const sel=(k,label,fmt=v=>v)=>`<label class="db-f"><span>${label}</span><select data-flt="${k}"${flt[k]?' class="on"':''}><option value="">All</option>${sorted[k].map(v=>`<option value="${esc(v)}"${flt[k]===v?' selected':''}>${esc(fmt(v))}</option>`).join('')}</select></label>`;
 const rows=all.filter(r=>(!flt.month||r.f.month===flt.month)&&(!flt.clinic||r.f.clinic===flt.clinic)&&(!flt.region||r.f.region===flt.region)&&(!flt.embryologist||r.f.embryologist===flt.embryologist)&&(!flt.test||r.f.test===flt.test)&&(!flt.age||r.age===flt.age)&&(!flt.result||r.result===flt.result));
 const inSet=l=>rows.filter(r=>l.includes(r.status)),tr=inSet(TRANSFERRED),im=inSet(IMPLANTED),cp=inSet(CLINICAL),mc=inSet(['Miscarriage']),lb=inSet(['Live birth']),recorded=rows.filter(r=>r.status).length;
 const patients=new Set(rows.map(r=>r.f.caseKey)).size,filtersOn=Object.values(flt).some(Boolean);
 const LBL={month:'Month',clinic:'Clinic',region:'Region',embryologist:'Embryologist',test:'Test',age:'Age',result:'Result'},nOn=Object.values(flt).filter(Boolean).length,chips=Object.entries(flt).filter(([,v])=>v).map(([k,v])=>`<span class="db-chip">${LBL[k]}: <b>${esc(k==='month'?monthLabel(v):v)}</b><button type="button" data-x="${k}" aria-label="Remove filter">×</button></span>`).join('');
 const rate=(label,n,d,color,sub,help)=>{const p=d?n/d*100:0;return `<article class="db-rate2" style="--c:${color}"><small>${label}</small><div class="rt-n"><strong>${d?Math.round(p)+'<sup>%</sup>':'—'}</strong></div><div class="rt-bar"><i style="width:${p}%"></i></div><p><b>${n}</b> of ${d} ${sub}</p></article>`};
 const stages=[['Embryos tracked',rows.length,IC('stages-results__total-embryos'),'#0a7180'],['Transferred',tr.length,IC('tests-transfers__transferred-to-transfer'),'#3b8fd0'],['Implantation positive',im.length,IC('stages-results__normal'),'#14b8a6'],['Clinical pregnancy',cp.length,IC('navigation__patient'),'#7c5cbf'],['Live birth',lb.length,SVG.heart,'#1f8a52']];
 const journey=stages.map(([l,n,ic,col],i)=>`<div class="jy" style="--c:${col}"><div class="jy-ic">${ic}</div><strong>${n}</strong><span>${l}</span>${i?`<em>${pct(n,stages[i-1][1])} of ${stages[i-1][0].toLowerCase()}</em>`:`<em>${patients} patient${patients===1?'':'s'}</em>`}</div>${i<stages.length-1?'<div class="jy-arrow">›</div>':''}`).join('');
 const order=[...STATUSES,''],mix=order.map(s=>[s,rows.filter(r=>r.status===s).length]);
 const cntOf=s=>rows.filter(r=>r.status===s).length,stageCard=(title,list,sub,note)=>{const segs=list.map(s=>[cntOf(s),OS_COLOR[s],s]),tot=segs.reduce((t,x)=>t+x[0],0);return `<article class="db-card"><h3>${title} <small>${sub}</small></h3>${tileGrid(segs,tot)}${note?`<p class="dn-wait">${note}</p>`:''}</article>`};
 const unknownN=cntOf('Outcome unknown'),noOutN=rows.filter(r=>!r.status).length;
 const furtherCard=(k,label)=>{const g=w=>rows.filter(r=>(r.tests?.[k]?.where||'')===w).length,an=g('Anderson'),ot=g('Other lab'),nd=g('Not done'),nr=rows.length-an-ot-nd,labs={};rows.forEach(r=>{const t=r.tests?.[k];if(t?.where==='Other lab'&&t.lab)labs[t.lab]=(labs[t.lab]||0)+1});
  const seg=[[an,'#0a7180','Done at Anderson'],[ot,'#e08a1e','Done at other labs'],[nd,'#9aa6a0','Not done']],done=an+ot,tot=an+ot+nd;
  return `<article class="db-card db-further"><h3>${label} <small>after PGT-A</small></h3>${tileGrid(seg,tot)}<p class="dn-wait"><b>${nr}</b> of ${rows.length} embryos not recorded yet.</p>${Object.keys(labs).length?`<p class="db-labs">Other labs: ${Object.entries(labs).sort((a,b)=>b[1]-a[1]).map(([l,n])=>`<b>${esc(l)}</b> (${n})`).join(', ')}</p>`:''}</article>`};
 const isEmb=currentUser&&currentUser.role==='embryologist';
 const P=(n,d)=>d?Math.round(n/d*100):null;
 const byM=new Map();rows.forEach(r=>{const m=r.f.month||'';if(!/^\d{4}-\d{2}$/.test(m))return;const x=byM.get(m)||{m,n:0,tr:0,im:0,cp:0,lb:0};x.n++;if(TRANSFERRED.includes(r.status))x.tr++;if(IMPLANTED.includes(r.status))x.im++;if(CLINICAL.includes(r.status))x.cp++;if(r.status==='Live birth')x.lb++;byM.set(m,x)});
 const ms=[...byM.values()].sort((x,y)=>x.m.localeCompare(y.m));
 // headline cards with change against the previous month that has transfers
 const withTr=ms.filter(x=>x.tr>0),cur=withTr[withTr.length-1],prv=withTr[withTr.length-2];
 const delta=(f)=>{if(!cur||!prv)return '';const d=f(cur)-f(prv);if(!isFinite(d)||Math.abs(d)<0.5)return `<em class="dl flat">no change vs ${monthLabel(prv.m)}</em>`;return `<em class="dl ${d>0?'up':'down'}">${d>0?'▲':'▼'} ${Math.abs(Math.round(d))} pts vs ${monthLabel(prv.m)}</em>`};
 const kp=(label,n,d,col,fn)=>`<article class="kp" style="--c:${col}"><small>${label}</small><strong>${d?P(n,d)+'<sup>%</sup>':'—'}</strong><span>${n} of ${d}</span>${fn?delta(fn):''}</article>`;
 const kpis=kp('Live-birth rate',lb.length,tr.length,'#1f8a52',x=>x.tr?x.lb/x.tr*100:0)+kp('Clinical pregnancy',cp.length,tr.length,'#7c5cbf',x=>x.tr?x.cp/x.tr*100:0)+kp('Implantation',im.length,tr.length,'#14b8a6',x=>x.tr?x.im/x.tr*100:0)+kp('Transferred',tr.length,rows.length,'#3b8fd0',x=>x.n?x.tr/x.n*100:0)+kp('Outcomes recorded',recorded,rows.length,'#0a7180',null);
 const gauge=(label,n,d,col,fn)=>{const p=d?n/d:0,R=60,L=Math.PI*R,dash=`${(L*p).toFixed(1)} ${L.toFixed(1)}`;
  return `<div class="gg" style="--c:${col}"><svg viewBox="0 0 150 90" width="100%" class="gg-svg"><path d="M15,80 A60,60 0 0 1 135,80" fill="none" stroke="#e6eeed" stroke-width="14" stroke-linecap="round"/>${p>0?`<path d="M15,80 A60,60 0 0 1 135,80" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${dash}"/>`:''}<text x="75" y="74" text-anchor="middle" font-size="30" font-weight="700" fill="#17302f" font-family="Lora,serif">${d?Math.round(p*100)+'%':'—'}</text></svg><b>${label}</b><span>${n} of ${d}</span></div>`};
 const gauges=`<div class="gg-row">${gauge('Transfer rate',tr.length,rows.length,'#3b8fd0',x=>x.n?x.tr/x.n*100:0)}${gauge('Implantation rate',im.length,tr.length,'#14b8a6',x=>x.tr?x.im/x.tr*100:0)}${gauge('Clinical pregnancy rate',cp.length,tr.length,'#7c5cbf',x=>x.tr?x.cp/x.tr*100:0)}${gauge('Miscarriage rate',mc.length,cp.length,'#d12f2f',null)}${gauge('Live-birth rate',lb.length,tr.length,'#1f8a52',x=>x.tr?x.lb/x.tr*100:0)}</div>`;
 const trend=(()=>{const pts=ms.filter(x=>x.tr>0);if(pts.length<2)return '<div class="chart-empty">The trend appears once transfers are recorded in two or more months.</div>';
  const W=640,H=210,pl=40,pr=28,pt=12,pb=30,iw=W-pl-pr,ih=H-pt-pb,xs=i=>pl+i*iw/(pts.length-1),ys=v=>pt+ih-v/100*ih;
  const ser=[['lb','Live birth','#1f8a52'],['cp','Clinical pregnancy','#7c5cbf'],['im','Implantation','#14b8a6']];
  const grid=[0,25,50,75,100].map(t=>`<line x1="${pl}" x2="${W-pr}" y1="${ys(t)}" y2="${ys(t)}" stroke="#edf1ee"/><text x="${pl-6}" y="${ys(t)+3}" font-size="10" fill="#8a9a97" text-anchor="end">${t}%</text>`).join('');
  const lines=ser.map(([k,l,col])=>{const v=x=>x.tr?x[k]/x.tr*100:0;return `<polyline fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((x,i)=>xs(i)+','+ys(v(x))).join(' ')}"/>${pts.map((x,i)=>`<circle cx="${xs(i)}" cy="${ys(v(x))}" r="3.5" fill="${col}"><title>${l} · ${monthLabel(x.m)}: ${Math.round(v(x))}% (${x[k]} of ${x.tr})</title></circle>`).join('')}`}).join('');
  const labels=pts.map((x,i)=>`<text x="${xs(i)}" y="${H-9}" font-size="10.5" fill="#6b7d76" text-anchor="middle">${monthLabel(x.m).replace(' 20',' ’')}</text>`).join('');
  return `<div class="tr-leg">${ser.map(([,l,col])=>`<span><i style="background:${col}"></i>${l}</span>`).join('')}<span class="muted">% of transferred embryos</span></div><svg viewBox="0 0 ${W} ${H}" class="tr-svg">${grid}${lines}${labels}</svg>`})();
 const cmap=new Map();rows.forEach(r=>{const k=r.f.clinic||'—',x=cmap.get(k)||{k,n:0,rec:0,tr:0,im:0,lb:0};x.n++;if(r.status)x.rec++;if(TRANSFERRED.includes(r.status))x.tr++;if(IMPLANTED.includes(r.status))x.im++;if(r.status==='Live birth')x.lb++;cmap.set(k,x)});
 const clients=[...cmap.values()].sort((x,y)=>y.n-x.n);
 const attn=[...clients].map(x=>({...x,w:x.n-x.rec})).filter(x=>x.w>0).sort((x,y)=>y.w-x.w).slice(0,6);
 const attention=attn.length?`<ul class="at">${attn.map(x=>`<li data-clinic="${esc(x.k)}"><span class="at-n">${esc(x.k)}</span><div class="at-bar"><i style="width:${x.n?x.rec/x.n*100:0}%"></i></div><b>${x.w}</b><small>waiting</small></li>`).join('')}</ul>`:'<div class="chart-empty">Every embryo has an outcome. Nothing is waiting.</div>';
 const cq=clQ.trim().toLowerCase(),cl=clients.filter(x=>!cq||x.k.toLowerCase().includes(cq)),shownC=cq||clAll?cl:cl.slice(0,10);
 const clientTable=`<div class="fu-table-wrap"><table class="fu-table cl"><thead><tr><th>Client</th><th>Embryos</th><th>Outcomes recorded</th><th>Transferred</th><th>Implantation</th><th>Live birth</th></tr></thead><tbody>${shownC.map(x=>`<tr data-clinic="${esc(x.k)}"><td class="strong">${esc(x.k)}</td><td>${x.n}</td><td><div class="cl-bar"><i style="width:${x.n?x.rec/x.n*100:0}%"></i></div><small>${x.rec} of ${x.n}</small></td><td>${x.tr}</td><td>${x.tr?P(x.im,x.tr)+'%':'—'}</td><td>${x.tr?P(x.lb,x.tr)+'%':'—'}</td></tr>`).join('')||'<tr><td colspan="6" class="chart-empty">No client matches.</td></tr>'}</tbody></table></div>${!cq&&cl.length>10?`<div style="text-align:center;margin-top:10px"><button type="button" class="secondary compact" id="clAllBtn">${clAll?'Show top 10':`Show all ${cl.length} clients`}</button></div>`:''}<p class="fu-note" style="margin:8px 0 0">Click a client to filter the whole dashboard to it.</p>`;
 const ftChip=(k,label)=>{const an=rows.filter(r=>r.tests?.[k]?.where==='Anderson').length,ot=rows.filter(r=>r.tests?.[k]?.where==='Other lab').length;return `<button type="button" class="ft" data-ft="${k}" title="Click to list the embryos"><b>${label}</b><span><strong>${an+ot}</strong> done</span><small>${an} at Anderson · ${ot} at other labs</small><i class="ft-go">View list ›</i></button>`};
 window._ftRows=rows;
 return `<div class="db-h-row"><h3 class="db-h">The journey of the embryos</h3><div class="db-h-tools">${chips}${nOn?'<button type="button" class="db-fclear" id="fuClear">Clear all</button>':''}<button type="button" class="db-ftoggle${filtersOpen?' on':''}" id="fuFToggle" aria-expanded="${filtersOpen}">${IC('navigation__filter')}<span>Filters</span>${nOn?`<b>${nOn}</b>`:''}<i>${filtersOpen?'▴':'▾'}</i></button></div>
 <div class="db-pop"${filtersOpen?'':' hidden'}><div class="db-pop-head"><b>Filter the dashboard</b><button type="button" class="secondary compact" id="fuFClose">Done</button></div><div class="db-pop-grid">${sel('month','Month',monthLabel)}${sel('clinic','Clinic')}${sel('region','Region')}${sel('embryologist','Embryologist')}${sel('test','Test')}${sel('age','Age group')}${sel('result','Embryo result')}</div>${nOn?'<button type="button" class="db-fclear" id="fuClear2">Clear all filters</button>':''}</div>
</div>
 <div class="journey">${journey}</div>
 ${gauges}
 <div class="mk2"><article class="db-card"><h3>Month by month <small>${isEmb?'your embryos':filtersOn&&flt.clinic?esc(flt.clinic):'all clients together'}</small></h3>${trend}</article>
 <div class="ft-stack">${ftChip('tera','TERA')}${ftChip('nips','NIPS')}</div>
</div>
`}
function breakdownHtml(){
 const rows=embryoRows();
 const grp=(keyFn)=>{const m=new Map();rows.forEach(r=>{const k=keyFn(r)||'—',x=m.get(k)||{k,patients:new Set(),n:0,t:0,i:0,p:0,l:0};x.patients.add(r.f.caseKey);x.n++;if(TRANSFERRED.includes(r.status))x.t++;if(IMPLANTED.includes(r.status))x.i++;if(CLINICAL.includes(r.status))x.p++;if(r.status==='Live birth')x.l++;m.set(k,x)});return[...m.values()]};
 const table=(title,list,first)=>`<article class="db-card"><h3>${title}</h3><div class="fu-table-wrap fu-clinics"><table class="fu-table"><thead><tr><th>${first}</th><th>Patients</th><th>Embryos</th><th>Transferred</th><th>Implant.</th><th>Clin. preg.</th><th>Live birth</th></tr></thead><tbody>${list.map(x=>`<tr><td class="strong">${esc(first==='Month'?monthLabel(x.k):x.k)}</td><td>${x.patients.size}</td><td>${x.n}</td><td>${x.t}</td><td>${pct(x.i,x.t)}</td><td>${pct(x.p,x.t)}</td><td>${pct(x.l,x.t)}</td></tr>`).join('')||'<tr><td colspan="7" class="chart-empty">No data for these filters.</td></tr>'}</tbody></table></div></article>`;
 const clinics=grp(r=>r.f.clinic).sort((a,b)=>b.n-a.n),months=grp(r=>r.f.month).sort((a,b)=>String(b.k).localeCompare(String(a.k)));
 return `<div class="db-two db-two-eq">${table('By clinic',clinics,'Clinic')}${table('By month',months,'Month')}</div>`}
function wireDash(root,redraw){
 const cqi=root.querySelector('#clQ');if(cqi)cqi.oninput=()=>{clQ=cqi.value;const pos=cqi.selectionStart;redraw();const n=root.querySelector('#clQ');n.focus();n.setSelectionRange(pos,pos)};
 root.querySelectorAll('[data-ft]').forEach(b=>b.onclick=()=>openTestList(b.dataset.ft,b.dataset.ft==='tera'?'TERA':'NIPS',window._ftRows||[]));
 const cab=root.querySelector('#clAllBtn');if(cab)cab.onclick=()=>{clAll=!clAll;redraw()};
 root.querySelectorAll('[data-clinic]').forEach(el=>el.onclick=()=>{flt.clinic=el.dataset.clinic;redraw()});
 const gr=root.querySelector('#goRunStatus');if(gr)gr.onclick=()=>showView('home');
 root.querySelectorAll('[data-flt]').forEach(s=>s.onchange=()=>{flt[s.dataset.flt]=s.value;redraw()});
 const tg=root.querySelector('#fuFToggle');if(tg)tg.onclick=e=>{e.stopPropagation();filtersOpen=!filtersOpen;redraw()};
 const fc=root.querySelector('#fuFClose');if(fc)fc.onclick=()=>{filtersOpen=false;redraw()};
 const c2=root.querySelector('#fuClear2');if(c2)c2.onclick=()=>{Object.keys(flt).forEach(k=>flt[k]='');redraw()};
 if(filtersOpen){const away=e=>{if(e.target.closest('.db-pop')||e.target.closest('#fuFToggle'))return;filtersOpen=false;document.removeEventListener('mousedown',away);if(root.isConnected)redraw()};document.addEventListener('mousedown',away)}
 const cl=root.querySelector('#fuClear');if(cl)cl.onclick=()=>{Object.keys(flt).forEach(k=>flt[k]='');redraw()};
 root.querySelectorAll('.db-chip [data-x]').forEach(b=>b.onclick=()=>{flt[b.dataset.x]='';redraw()})}

// ---------------- Read-only state blocks (admin / team lead see what the embryologist entered) ----------------
const stepper=status=>`<div class="stp">${STATUSES.map(s=>{const on=s===status;return `<span class="stp-i${on?' on':''}"${on?` style="background:${OS_COLOR[s]};border-color:${OS_COLOR[s]}"`:''}>${esc(s)}</span>`}).join('')}${status?'':'<span class="stp-i on stp-none">Not entered yet</span>'}</div>`;
const WHERE_LBL={Anderson:'Done at Anderson','Other lab':'Done at other labs','Not done':'Not done'};
const testLine=(label,t)=>{if(!t||!t.where)return`<span class="es-t"><b>${label}</b> not recorded</span>`;if(t.where==='Not done')return`<span class="es-t"><b>${label}</b> not done</span>`;
 return `<span class="es-t"><b>${label}</b> ${t.where==='Anderson'?'done at Anderson':`done at ${esc(t.lab||'other labs')}`}${t.date?' · '+fmtDate(t.date):''}${t.biopsyTime?' · biopsy '+esc(t.biopsyTime):''}${t.result?' · result: '+esc(t.result):''}${t.note?' · '+esc(t.note):''}</span>`};
const whoWhen=o=>o&&o.at?`Updated${o.by?' by <b>'+esc(o.by)+'</b>':''} on ${fmtDate(String(o.at).slice(0,10))}`:'Not entered yet';
function embryoState(e,o){o=o||{};
 return `<div class="es"><div class="es-head"><strong>${esc(e.label)}</strong>${resChip(e.result)}<span class="es-who">${whoWhen(o)}</span></div>${stepper(o.status||'')}<div class="es-meta">${o.date?`<span class="es-t"><b>Outcome date</b> ${fmtDate(o.date)}</span>`:''}${o.note?`<span class="es-t"><b>Note</b> ${esc(o.note)}</span>`:''}${testLine('TERA',o.tests?.tera)}${testLine('NIPS',o.tests?.nips)}</div>${(o.history||[]).length?`<details class="es-hist"><summary>History (${o.history.length})</summary>${histHtml(o.history)}</details>`:''}</div>`}
function openResultDialog(f){
 const d=dlgEl(),om=outcomeMap(f);
 d.innerHTML=`<div class="vu-dhead"><div><h3>${esc(f.patient||'Patient')}</h3><small>${esc(f.clinic||'')}${f.test?' · '+esc(f.test):''}${f.embryologist?' · embryologist '+esc(f.embryologist):''}</small></div><div>${chip(taskStatus(f))} <button type="button" class="secondary compact" data-close>Close</button></div></div>
 <div class="vu-dbody"><div class="fu-sum">${sumCards((f.embryos||[]).map(e=>({status:om[norm(e.label)]?.status||''})))}</div>
 <section class="fu-block"><div class="fu-block-head"><h4>Outcome follow-up</h4><small>Filled in by the embryologist</small></div>${(f.embryos||[]).map(e=>embryoState(e,om[norm(e.label)])).join('')||'<div class="chart-empty">No embryos.</div>'}</section>
 ${f.contactName||f.contactDetail||f.note?`<section class="fu-block"><div class="fu-block-head"><h4>Clinic contact</h4></div><p style="margin:0">${esc(f.contactName)} ${esc(f.contactDetail)}</p>${f.note?`<p class="fu-note">${esc(f.note)}</p>`:''}</section>`:''}</div>`;
 if(!d.open)d.showModal()}

// ---------------- Admin / team lead: results entered by the embryologists ----------------
let monClient='',monEmb='',monGroupsAll=false,monQ='',monStatus='',monGroup='',monOnly='all',monLimit=100;
function monitorHtml(){
 const all=[];
 FU.items.forEach(f=>{if(f.consent==='No'||f.state==='not_applicable')return;const om=outcomeMap(f);(f.embryos||[]).forEach(e=>{const o=om[norm(e.label)]||{};all.push({f,e,o,s:o.status||'',g:f.embryologist||f.clinic||'—'})})});
 const filled=all.filter(r=>r.s).length,total=all.length;
 const groups=new Map();all.forEach(r=>{const x=groups.get(r.g)||{g:r.g,n:0,f:0,last:null,by:''};x.n++;if(r.s)x.f++;if(r.o.at&&(!x.last||r.o.at>x.last)){x.last=r.o.at;x.by=r.o.by||''}groups.set(r.g,x)});
 const glist=[...groups.values()].sort((a,b)=>(b.n-b.f)-(a.n-a.f));
 const q=monQ.trim().toLowerCase();
 let rows=all.filter(r=>(!monStatus||(monStatus==='__none'?!r.s:r.s===monStatus))&&(!monGroup||r.g===monGroup)&&(!monClient||r.f.clinic===monClient)&&(!monEmb||(r.f.embryologist||'')===monEmb)&&(monOnly==='all'||(monOnly==='filled'?!!r.s:!r.s))&&(!q||`${r.f.patient} ${r.f.clinic} ${r.e.label} ${r.o.by||''}`.toLowerCase().includes(q)));
 const shown=rows.slice(0,monLimit),cnt=s=>all.filter(r=>r.s===s).length;
 const tiles=STATUSES.map(s=>{const n=s==='__none'?total-filled:cnt(s),col=s==='__none'?'#dfe6e4':OS_COLOR[s];return `<button type="button" class="mt${monStatus===s?' on':''}" data-s="${esc(s)}" style="--c:${col}"><strong>${n}</strong><span>${s==='__none'?'Not entered yet':esc(s)}</span></button>`}).join('');
 const pctF=total?Math.round(filled/total*100):0;
 return ` <h3 class="db-h">Current state of the embryos</h3><div class="mon-tiles">${tiles}</div>
 <h3 class="db-h">Outcomes by clinic and by month</h3>${breakdownHtml()}
 <h3 class="db-h">Embryo by embryo</h3>
 <div class="tk-bar"><div class="seg-toggle" id="monOnly">${[['all','All'],['filled','Entered'],['waiting','Waiting']].map(([k,l])=>`<button type="button" class="${monOnly===k?'on':''}" data-v="${k}">${l}</button>`).join('')}</div><label class="mon-f"><span>Client</span><select id="monClient"><option value="">All clients</option>${[...new Set(all.map(r=>r.f.clinic).filter(Boolean))].sort().map(c=>`<option${monClient===c?' selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="mon-f"><span>Embryologist</span><select id="monEmb"><option value="">All embryologists</option>${[...new Set(all.map(r=>r.f.embryologist).filter(Boolean))].sort().map(c=>`<option${monEmb===c?' selected':''}>${esc(c)}</option>`).join('')}</select></label><div class="search-wrap fu-search"><span>⌕</span><input id="monSearch" type="search" placeholder="Search patient, clinic or embryo…" value="${esc(monQ)}"></div>${(monStatus||monGroup||monClient||monEmb)?'<button type="button" class="db-fclear" id="monClear">Clear filters</button>':''}</div>
 <div class="fu-table-wrap fu-tasks"><table class="fu-table"><thead><tr><th>Patient</th><th>Client</th><th>Embryo</th><th>PGT-A result</th><th>Current state</th><th>Date</th><th>TERA</th><th>NIPS</th><th>Updated by</th></tr></thead><tbody>${shown.map(({f,e,o,s})=>{const tc=k=>{const v=o.tests?.[k];return !v||!v.where?'<span class="fu-os fu-os-none">—</span>':v.where==='Not done'?'<span class="fu-os fu-os-none">Not done</span>':`<span class="fu-os">${v.where==='Anderson'?'Anderson':esc(v.lab||'Other lab')}${v.result?' · '+esc(v.result):''}</span>`};
  return `<tr data-key="${esc(f.caseKey)}"><td class="strong">${esc(f.patient)}</td><td><span class="cl-tag" title="${esc(f.clinic)}">${esc(f.clinic)||'—'}</span></td><td class="strong">${esc(e.label)}</td><td>${resChip(e.result)}</td><td>${statusChip(s)}</td><td>${fmtDate(o.date)}</td><td>${tc('tera')}</td><td>${tc('nips')}</td><td>${o.by?esc(o.by)+'<small>'+fmtDate(String(o.at||'').slice(0,10))+'</small>':'—'}</td></tr>`}).join('')||'<tr><td colspan="9" class="chart-empty">No embryos match.</td></tr>'}</tbody></table></div>
 ${rows.length>shown.length?`<div style="text-align:center;margin:12px"><button type="button" class="secondary" id="monMore">Show more (${rows.length-shown.length} left)</button></div>`:''}`}
function wireMonitor(root,redraw){
 root.querySelector('.mon-tiles').onclick=e=>{const b=e.target.closest('[data-s]');if(!b)return;monStatus=monStatus===b.dataset.s?'':b.dataset.s;monLimit=100;redraw()};
 const gp=root.querySelector('.mon-groups');if(gp)gp.onclick=e=>{const b=e.target.closest('[data-g]');if(!b)return;monGroup=monGroup===b.dataset.g?'':b.dataset.g;monLimit=100;redraw()};
 root.querySelector('#monOnly').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;monOnly=b.dataset.v;monLimit=100;redraw()};
 const s=root.querySelector('#monSearch');s.oninput=()=>{monQ=s.value;monLimit=100;const pos=s.selectionStart;redraw();const n=root.querySelector('#monSearch');n.focus();n.setSelectionRange(pos,pos)};
 const mc=root.querySelector('#monClient');if(mc)mc.onchange=()=>{monClient=mc.value;monLimit=100;redraw()};
 const me=root.querySelector('#monEmb');if(me)me.onchange=()=>{monEmb=me.value;monLimit=100;redraw()};
 const c=root.querySelector('#monClear');if(c)c.onclick=()=>{monStatus='';monGroup='';monClient='';monEmb='';redraw()};
 const gt=root.querySelector('#monGroupsToggle');if(gt)gt.onclick=()=>{monGroupsAll=!monGroupsAll;redraw()};
 const m=root.querySelector('#monMore');if(m)m.onclick=()=>{monLimit+=200;redraw()};
 const fs=root.querySelector('#fuFromSheet');if(fs)fs.onclick=()=>openSheetImport(redraw);
 root.querySelector('.fu-tasks').onclick=e=>{const tr=e.target.closest('tr[data-key]');if(!tr)return;const f=FU.items.find(x=>x.caseKey===tr.dataset.key);if(f)openResultDialog(f)}}

// ---------------- Views ----------------
window.renderFollowupView=async function(g,view){
 const title={followup:'Clinical follow-up',fuTasks:'Follow-up tasks',fuDash:'Outcomes',dashboard:'Home'}[view];
 const ht=document.getElementById('genericHeaderTitle');if(ht)ht.textContent=title;
 const mh=document.getElementById('mainHeader');if(mh)mh.classList.toggle('hidden',view==='dashboard'||view==='fuDash'||view==='fuTasks'||view==='followup');
 g.innerHTML='<div class="generic-card wide-card fu-view"><div class="chart-empty">Loading follow-up data…</div></div>';
 await loadFollowups(true);
 const card=g.querySelector('.fu-view');
 const draw=()=>{
  const tab=view==='followup'?'monitor':view==='fuTasks'?'tasks':'dash';
  dashHome=view==='dashboard';
  const seg='';
  card.innerHTML=seg+`<div class="fu-pane">${tab==='monitor'?monitorHtml():tab==='tasks'?tasksHtml():dashHtml()}</div>`;
  const sub=card.querySelector('#fuSub');if(sub)sub.onclick=e=>{const b=e.target.closest('[data-t]');if(!b)return;subTab=b.dataset.t;draw()};
  if(tab==='monitor')wireMonitor(card,draw);else if(tab==='tasks')wireTasks(card,draw);else wireDash(card,draw)};
 draw()};

// ---------------- Patient page section ----------------
window.renderPatientFollowup=async function(c,resolvedAll){
 if(typeof isStaff==='function'&&!isStaff())return;
 const anchor=document.querySelector('#patientDetail .embryo-table-card');if(!anchor)return;
 let sec=document.getElementById('fuSection');if(sec)sec.remove();
 sec=document.createElement('section');sec.id='fuSection';sec.className='fu-section';sec.innerHTML='<div class="chart-empty">Loading outcome follow-up…</div>';anchor.after(sec);
 await loadFollowups(true);
 const labels=(resolvedAll||[]).map(r=>{const id=resultIdentity(r);return{label:id.patient?`${id.patient}-${id.embryo}`:id.embryo,result:RESULT_NAME[conclusionClass(r)]||'No result'}}).filter(x=>x.label);
 const list=labels.length?labels:Array.from({length:c.samples||0},(_,i)=>({label:`Embryo ${i+1}`,result:'No result'}));
 const month=(c.embryos||[]).map(recordMonth).find(m=>/^\d{4}-\d{2}$/.test(m))||'';
 const draw=()=>{const f=FU.items.find(x=>x.caseKey===c.id),om=f?outcomeMap(f):{},emb=(f&&f.embryos&&f.embryos.length)?f.embryos:list;
  sec.innerHTML=`<div class="fu-sec-head"><div class="embryo-table-title"><h3>Outcome follow-up</h3>${f?chip(taskStatus(f)):'<span class="fu-chip fu-scheduled">Not started</span>'}</div>${f?'':'<button type="button" class="secondary compact" id="fuStart">Send to the embryologist</button>'}</div>
  <p class="fu-note" style="margin:0 0 10px">${f?'The embryologist fills in what happened to each embryo. This is its current state.':'Nothing recorded yet. Send this patient to the embryologist\'s list so they can fill in the outcomes.'}</p>
  <div class="fu-sum">${sumCards(emb.map(e=>({status:om[norm(e.label)]?.status||''})))}</div>
  ${emb.map(e=>embryoState(e,om[norm(e.label)])).join('')}`;
  const st=sec.querySelector('#fuStart');if(st)st.onclick=async()=>{st.disabled=true;try{await postSave({caseKey:c.id,followup:{patient:c.patient,clinic:c.client||'',region:c.region||'',embryologist:c.embryologist||'',test:c.test||'',month,embryos:list,consent:'Yes',dueDate:today()},outcomes:[]});toast('Added to the embryologist\'s list');draw()}catch(err){toast(err.message||'Could not add');st.disabled=false}}};
 draw()};
})();
