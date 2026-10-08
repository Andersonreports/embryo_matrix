// Digital TRF: the PGT test requisition form laid out like the paper template (page 1
// requisition, page 2 biopsy worksheet). The same layout is used two ways:
// - editable (trfPagesHtml(data, meta, {edit:true})): the lab/clinic types into the template
//   in the app's TRFs tab, and trfCollect() reads the values back;
// - read-only, for reviewing and printing / saving a submitted TRF as PDF (printTrf).
(function(global){
const TRF_TEST_LABELS={
 'PGT-A':'Preimplantation Genetic Testing - Aneuploidies (PGT-A)',
 'EMBRYO_SURE':'Embryo Sure - PGT-A (CNV with SNP)',
 'PGT-SR':'Preimplantation Genetic Testing - Structural Rearrangements (PGT-SR)',
 'PGT-HLA':'Preimplantation Genetic Testing - HLA C typing'
};
// PGT-M requisition form (mutation testing): its own test list.
const TRF_TEST_LABELS_M={
 'PGT-M':'Preimplantation Genetic Testing - Mutation only',
 'PGT-A+M':'Preimplantation Genetic Testing - Aneuploidies + Mutation (PGT-A+ M)',
 'PGT-A+M+HLA':'Preimplantation Genetic Testing - Aneuploidies + Mutation + HLA matching (PGT-A+ M + HLA)'
};
const trfLabelsFor=type=>type==='PGT-M'?TRF_TEST_LABELS_M:TRF_TEST_LABELS;
// Required to submit (marked * on the form); the server checks the same list.
const TRF_REQUIRED={hospital:'Hospital / IVF centre',referringDoctor:'Referring doctor',phone:'Phone',email:'Email (approval status is emailed here)',patientName:'Patient name',biopsyDate:'Date of biopsy'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// "2026-09-25" -> "25 / 09 / 2026", the template's date style.
const fmtDate=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v||''));return m?`${m[3]} / ${m[2]} / ${m[1]}`:esc(v)};

function trfPagesHtml(d,meta={},opts={}){
 d=d||{};const isM=d.formType==='PGT-M',edit=!!opts.edit,tests=d.tests||[],gametes=d.gametes||[],embryos=d.embryos||[];
 const req=k=>edit&&TRF_REQUIRED[k]?' <b class="td-req">*</b>':'';
 // One "Label: ______" line; editable it becomes an input of the given type.
 const line=(label,key,type='text',extra='')=>`<div class="td-line${key==='hospital'?' td-line-wrap':''}"><span class="td-label">${label}${req(key)}</span>${edit
  ?`<input class="td-input" data-f="${key}" type="${type}" value="${esc(d[key])}"${extra}>`
  :`<span class="td-value${type==='email'?' td-email':''}">${d[key]?(type==='date'?fmtDate(d[key]):esc(d[key])):'&nbsp;'}</span>`}</div>`;
 const para=key=>edit?`<textarea class="td-input td-area" data-f="${key}" rows="3">${esc(d[key])}</textarea>`:`<p class="td-para">${esc(d[key])||'&nbsp;'}</p>`;
 // Checkbox (group = array field) or radio (single-value field).
 const box=(group,value,label,on,radio=false)=>edit
  ?`<label class="td-check"><input type="${radio?'radio':'checkbox'}" ${radio?`name="trf-${group}"`:''} data-g="${group}" value="${esc(value)}"${on?' checked':''}>${esc(label)}</label>`
  :`<span class="td-check"><span class="td-box${radio?' td-radio':''}${on?' on':''}">${on?'✓':''}</span>${esc(label)}</span>`;
 // A blank filled in *inline*, mid-sentence (Form G's fill-in-the-blank legal wording).
 const blank=(key,ch=16)=>edit
  ?`<input class="td-input td-inline" data-f="${key}" style="width:${ch}ch;${fitStyle(d[key],ch)}" value="${esc(d[key])}">`
  :`<span class="td-blank"${fitAttr(d[key])}>${d[key]?esc(d[key]):''}</span>`;
 // Mirrors a value entered elsewhere on the form (e.g. patientName from Patient Information); never its own input.
 const mirror=(key,type)=>`<span class="td-blank"${type==='date'?'':fitAttr(d[key])}>${d[key]?(type==='date'?fmtDate(d[key]):esc(d[key])):''}</span>`;
 const section=(title,body)=>`<section class="td-section"><h3>${title}</h3><div class="td-body">${body}</div></section>`;
 // Groups sections into one continuous outlined panel, like the paper form's single bordered column.
 const panel=(...sections)=>`<div class="td-panel">${sections.join('')}</div>`;
 const curves=`<div class="td-curve-top"></div><div class="td-curve-bottom"></div>`,curveBottom='<div class="td-curve-bottom"></div>';
 const footer=n=>`<img class="td-footer-img" src="/static/trf-footer-${n===1?(isM?'1m':'1a'):n===2?(isM?'2m':'2a'):'3'}.png" alt="">`;
 const logoRow=`<img class="td-header-img" src="/static/trf-header-${isM?'m':'a'}.png" alt="Anderson Diagnostics &amp; Labs - Preimplantation Genetic Testing">`;
 const titleRow=(title,noteHtml,boxHtml)=>`<div class="td-titlerow"><div><h2 class="td-title">${title}</h2>${noteHtml||''}</div><div class="td-titlebox">${boxHtml||''}</div></div>`;
 const refInfo=meta.ref?`TRF ref: <b>${esc(meta.ref)}</b>`:(edit?'<i>Reference number is given on submit</i>':'');
 const refBox=`<div class="td-refbox"><div>${line('Date of Biopsy:','biopsyDate','date')}</div>${(refInfo||meta.submittedAt)?`<div class="td-ref">${refInfo}${meta.submittedAt?`<span>Submitted ${esc(new Date(meta.submittedAt).toLocaleString())}</span>`:''}</div>`:''}</div>`;
 const barcodeBox=`<div class="td-barcode"><i>Affix barcode label here</i></div>`;
 const page1=`<div class="td-page td-hdr">${logoRow}
  ${titleRow('Test Requisition Form','<p class="td-note-strong">ALL Sections of this form must be completed.</p>',refBox+barcodeBox)}
  <div class="td-grid">
   ${panel(
     section('Referring details',line('Referring Doctor:','referringDoctor')+line('Name of Hospital /IVF Centre:','hospital','text',edit?' autocomplete="off"':'')+line('Address:','address')+line('Phone:','phone','tel')+line('Email:','email','email')),
     section('Test requested'+(edit?' <b class="td-req">*</b>':''),Object.entries(trfLabelsFor(d.formType)).map(([k,l])=>`<div>${box('tests',k,l,tests.includes(k))}</div>`).join('')),
     section('Specimen details',(isM?`<div class="td-line"><span class="td-label">Biopsy Date:</span><span class="td-value td-mirror-date">${d.biopsyDate?fmtDate(d.biopsyDate):'&nbsp;'}</span></div>`+line('Biopsy Time:','biopsyTime','time'):line('Specimen Collection Date:','collectionDate','date')+line('Specimen Collection Time:','collectionTime','time'))+`<div class="td-row">${(isM?['Day 5','Day 6']:['Day 3','Day 5','Day 6']).map(x=>box('biopsyDay',x,x+' Biopsy',d.biopsyDay===x,true)).join('')}</div><p class="td-label td-sublabel">IVF Cycle details:</p><div class="td-row"><span class="td-label">Gametes:</span>${['Self','Donor Sperm','Donor Oocyte'].map(x=>box('gametes',x,x,gametes.includes(x))).join('')}</div>`+line('If Donor is used: Age of Donor;','donorAge'))
   )}
   ${panel(
     section('Patient Information',line('Patient Name:','patientName')+line('Date of Birth:','patientDob','date')+line('UHID:','uhid')+line('Aadhaar Card No:','aadhaar','text',edit?' inputmode="numeric" maxlength="14" placeholder="12 digits"':'')+line("Husband's Name:",'husbandName')+line('Date of Birth:','husbandDob','date')+line('Email:','patientEmail','email')),
     section('Test Indication',para('testIndication')),
     section('Patient Clinical History',para('clinicalHistory')),
     isM?section('Mutation Details',line('Maternal Genotype','maternalGenotype')+line('Paternal Genotype','paternalGenotype')):section('Karyotyping Details',line('Maternal Karyotype:','maternalKaryotype')+line('Paternal Karyotype:','paternalKaryotype'))
   )}
  </div>
  <div class="td-sign"><div>Patient Signature: <span></span></div><div>Clinician Signature: <span></span><br>Clinician Seal:</div></div>
  ${footer(1)}</div>`;
 const cellIn=(k,v,type='text')=>`<input class="td-cell" data-e="${k}" type="${type}" value="${esc(v)}">`;
 const cellSel=(k,v,choices)=>`<select class="td-cell" data-e="${k}"><option value=""></option>${choices.map(c=>`<option${v===c?' selected':''}>${c}</option>`).join('')}</select>`;
 const embryoRow=(e,i)=>edit
  ?`<tr><td class="td-n">${i+1}</td><td>${cellIn('label',e.label)}</td><td>${cellIn('grade',e.grade)}</td><td>${cellIn('cells',e.cells)}</td>${isM?'':`<td>${cellSel('day',e.day,['Day 5','Day 6'])}</td>`}<td>${cellSel('intact',e.intact,['Yes','No'])}</td><td>${cellIn('comments',e.comments)}</td><td class="td-x"><button type="button" class="td-remove" aria-label="Remove this embryo">×</button></td></tr>`
  :`<tr><td>${i<embryos.length?i+1:''}</td><td>${esc(e.label)}</td><td>${esc(e.grade)}</td><td>${esc(e.cells)}</td>${isM?'':`<td>${esc(e.day)}</td>`}<td>${esc(e.intact)}</td><td>${esc(e.comments)}</td></tr>`;
 const rows=edit?(embryos.length?embryos:[{},{},{}]):[...embryos,...Array(Math.max(0,11-embryos.length)).fill({})];
 const page2=`<div class="td-page td-hdr">${logoRow}
  ${titleRow('Biopsy worksheet','',barcodeBox)}
  <table class="td-meta"><tr><td><div class="td-line"><span class="td-label">Patient name:</span><span class="td-value td-mirror">${esc(d.patientName)||'&nbsp;'}</span></div></td><td><div class="td-line"><span class="td-label">Date of Biopsy:</span><span class="td-value td-mirror-date">${d.biopsyDate?fmtDate(d.biopsyDate):'&nbsp;'}</span></div></td></tr><tr><td>${line('IVF Lab contact No.:','ivfLabContact','tel')}</td><td><span class="td-label">Re-biopsy included in this case:</span> ${box('rebiopsy','Yes','Yes',d.rebiopsy==='Yes',true)}${box('rebiopsy','No','No',d.rebiopsy==='No',true)}</td></tr></table>
  <table class="td-embryos"><thead><tr><th>Sl No.</th><th>${isM?'Embryo tags':'Embryo label'}${edit?' <b class="td-req">*</b>':''}</th><th>Embryo Grade</th><th>No. of cells biopsied</th>${isM?'':'<th>Day 5/ Day 6</th>'}<th>Intact cells observed (Yes/No)</th><th>Comments</th>${edit?'<th></th>':''}</tr></thead><tbody class="td-embryo-rows">${rows.map(embryoRow).join('')}</tbody></table>
  ${edit?'<button type="button" class="td-add">＋ Add embryo row</button>':''}
  <p class="td-small">• All negative controls should be labeled NC1, NC2, etc. If sending multiple negative controls, please specify which embryo samples correspond to each NC.</p>
  ${isM?`<p class="td-biopsy-by">Biopsy performed by</p><p>Embryologist Signature: <span class="td-signline"></span></p>${line('Email address:','embryologistEmail','email')}`
  :`<p>${box('dryRun','yes','Embryo Biopsy dry run',!!d.dryRun)}</p>
  <div class="td-grid td-grid-tight"><div>${line('Embryologist Name:','embryologistName')}</div><div>Embryologist Signature: <span class="td-signline"></span></div></div>
  ${line('Embryologist email address:','embryologistEmail','email')}`}
  ${footer(2)}</div>`;
 const relationInline=edit
  ?`${box('consentRelation','Wife','Wife',d.consentRelation==='Wife',true)}${box('consentRelation','Daughter','Daughter',d.consentRelation==='Daughter',true)}`
  :`<b>${d.consentRelation?esc(d.consentRelation.toLowerCase()):'wife/daughter'}</b>`;
 const page3=`<div class="td-page td-page-g">${curves}
  <div class="td-formg-title"><h2>FORM G – FORM OF CONSENT</h2><p>[See Rule 10]</p></div>
  <p class="td-legal">I, ${mirror('patientName')}, ${relationInline} of ${blank('consentGuardianName',22)}. Age ${blank('consentAge',4)} years residing at ${blank('patientAddress',42)}, hereby state that I have been explained fully the probable side effects and after effects of the pre-natal diagnostic procedures. I wish to undergo the pre-natal diagnostic procedures in my interest to find out the possibility of any abnormality (i.e. deformity or disorder) in the child I am carrying.</p>
  <p class="td-legal">I undertake not to terminate the pregnancy if the pre-natal procedure and any pre-natal tests conducted show the absence of deformity or disorders. I understand that the sex of the fetus will not be disclosed to me.</p>
  <p class="td-legal">I understand that breach of this undertaking will make me liable to penalty as prescribed in the Pre-natal Diagnostic Techniques (Regulation and Prevention of Misuse) Act, 1994 (57 of 1994).</p>
  <div class="td-grid td-grid-tight"><div>Patient Signature: <span class="td-signline"></span></div><div>${line('Date:','consentDate','date')}</div></div>
  ${line('Place:','consentPlace')}
  <p class="td-legal">I have explained the contents of the above consent to the patient and her companion (Name ${blank('companionName',18)} Address ${blank('companionAddress',24)} Relationship with patient ${blank('companionRelation',14)}) in a language she/they understand.</p>
  <p class="td-legal-label">Name, Signature and/Registration number of Gynaecologist</p>
  <div class="td-grid td-grid-tight">${line('Name:','gynaecologistName')}${line('Registration No.:','gynaecologistRegNo')}</div>
  ${line('Date:','explanationDate','date')}
  <p class="td-legal-label">Name, Address and Registration number of Genetic Clinic</p>
  <div class="td-grid td-grid-tight">${line('Name:','geneticClinicName')}${line('Registration No.:','geneticClinicRegNo')}</div>
  ${line('Address:','geneticClinicAddress')}
  ${footer(3)}</div>`;
 // Page 4 (both forms): outcome follow-up consent, worded like Form G with the values in inline blanks.
 const FU_PERIODS=['Within 1 month','1–3 months','3–6 months','6–12 months','Not known'];
 const fuPeriod=edit?`<select class="td-input td-inline" data-f="followupExpected"><option value=""></option>${FU_PERIODS.map(x=>`<option${d.followupExpected===x?' selected':''}>${x}</option>`).join('')}</select>`:`<span class="td-blank">${d.followupExpected?esc(d.followupExpected.toLowerCase()):''}</span>`;
 const page4=`<div class="td-page td-page-g td-page-fu">${curves}
  <div class="td-formg-title"><h2>OUTCOME FOLLOW-UP CONSENT</h2></div>
  <p class="td-legal">I, ${mirror('patientName')}, hereby give my consent to Anderson Diagnostics &amp; Labs to obtain information on the embryo transfer and the pregnancy outcome following this Preimplantation Genetic Testing from my treating clinic.</p>
  <p class="td-legal">I understand that only my consent and the clinic's contact details are recorded in this form. The outcome itself will be collected later by the laboratory and will be kept confidential.</p>
  <p class="td-legal td-fu-opts">${box('followupConsent','Yes','I agree',d.followupConsent==='Yes',true)}${box('followupConsent','No','I do not agree',d.followupConsent==='No',true)} to this outcome follow-up.</p>
  <p class="td-legal">The clinic may be contacted through ${blank('followupContact',22)} at ${blank('followupPhoneEmail',26)}. The expected period of embryo transfer, if known, is ${fuPeriod}.</p>
  <div class="td-grid td-grid-tight"><div>Patient Signature: <span class="td-signline"></span></div><div>Date: <span class="td-signline"></span></div></div>
  ${footer(3)}<span class="td-fu-pg">Pg.4</span></div>`;
 // The consent page goes into the preview / PDF only when the patient agreed (Yes); the editable template always has it.
 return page1+page2+page3+(edit||d.followupConsent==='Yes'?page4:'');
}
// Reads an editable template back into the same data shape the server stores.
function trfCollect(root){const d={};
 root.querySelectorAll('[data-f]').forEach(el=>d[el.dataset.f]=el.value.trim());
 const checked=g=>[...root.querySelectorAll(`[data-g="${g}"]:checked`)].map(x=>x.value);
 d.formType=d.formType==='PGT-M'?'PGT-M':'PGT-A';d.tests=checked('tests');d.gametes=checked('gametes');d.biopsyDay=checked('biopsyDay')[0]||'';d.rebiopsy=checked('rebiopsy')[0]||'';d.dryRun=checked('dryRun').length>0;d.followupConsent=checked('followupConsent')[0]||'';
 d.embryos=[...root.querySelectorAll('.td-embryo-rows tr')].map(tr=>{const e=Object.fromEntries([...tr.querySelectorAll('[data-e]')].map(x=>[x.dataset.e,x.value.trim()]));let im=[];try{im=JSON.parse(tr.dataset.images||'[]')}catch{}if(im.length)e.images=im;return e}).filter(e=>Object.values(e).some(Boolean));
 return d}
// The digital form: the template's sections and fields as a normal web form (labels above
// inputs, sections as cards, one row per embryo). Same data-f / data-g / data-e names as the
// template, so trfCollect, trfProblems and printTrf work on it unchanged.
function trfEmbryoRowHtml(e={},i=0,type='PGT-A'){
 const inp=(k,ph='',mode='')=>`<input class="tf-cell" data-e="${k}" value="${esc(e[k])}"${ph?` placeholder="${ph}"`:''}${mode?` inputmode="${mode}"`:''}>`;
 const sel=(k,choices)=>`<select class="tf-cell" data-e="${k}"><option value="">—</option>${choices.map(c=>`<option${e[k]===c?' selected':''}>${c}</option>`).join('')}</select>`;
 return `<tr data-images="${esc(JSON.stringify(e.images||[]))}"><td class="tf-n">${i+1}</td><td>${inp('label','e.g. SS1')}</td><td>${inp('grade','e.g. 4AA')}</td><td>${inp('cells','','numeric')}</td>${type==='PGT-M'?'':`<td>${sel('day',['Day 5','Day 6'])}</td>`}<td>${sel('intact',['Yes','No'])}</td><td>${inp('comments')}</td><td class="tf-img">${trfThumbsHtml(e.images||[])}<div class="tf-photo-btns"><button type="button" class="tf-photo-btn" title="Choose photos of this embryo from the gallery">🖼 Select</button><button type="button" class="tf-photo-btn tf-cam-btn" data-cam="1" title="Open the camera and take a photo of this embryo">📷 Capture</button></div></td><td class="tf-x"><button type="button" class="td-remove" aria-label="Remove embryo ${i+1}">×</button></td></tr>`}
// Photos attached to an embryo row (ids returned by /api/trf-image). Local previews are kept for this page session only.
const TRF_LOCAL_THUMBS={};
function trfThumbsHtml(ids){return `<span class="tf-thumbs">${ids.map(id=>`<span class="tf-thumb" data-id="${esc(id)}">${TRF_LOCAL_THUMBS[id]?`<img src="${TRF_LOCAL_THUMBS[id]}" alt="Embryo photo">`:'<i>📷</i>'}<button type="button" class="tf-thumb-x" aria-label="Remove photo">×</button></span>`).join('')}</span>`}
// A JPEG no larger than 1600px on its long side keeps uploads quick on clinic connections.
async function trfShrinkImage(file){try{const bmp=await createImageBitmap(file),k=Math.min(1,1600/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));return b||file}catch{return file}}
// Follow-up consent summary for the reviewer (lab users).
function trfFollowupHtml(d){if(!d||!d.followupConsent)return'';const yes=d.followupConsent==='Yes',cell=(l,v)=>`<div class="fu-cell"><small>${l}</small><b>${v?esc(v):'—'}</b></div>`;return `<section class="trf-followup"><div class="fu-head"><h3>Outcome follow-up</h3><span class="fu-chip ${yes?'fu-yes':'fu-no'}">${yes?'Consent given':'Consent declined'}</span></div>${yes?`<div class="fu-cells">${cell('Contact person',d.followupContact)}${cell('Email / phone',d.followupPhoneEmail)}${cell('Expected transfer',d.followupExpected)}</div>`:'<p class="fu-none">The patient declined outcome follow-up.</p>'}</section>`}
// Read-only gallery of the photos attached to each embryo, for whoever reviews the TRF (lab users only - the images are served to them alone).
function trfImagesHtml(d){const rows=(d?.embryos||[]).filter(e=>(e.images||[]).length);if(!rows.length)return'';
 return `<section class="trf-photos"><h3>Embryo photos</h3>${rows.map(e=>`<div class="trf-photo-row"><strong>${esc(e.label||'Embryo')}</strong><div>${e.images.map(id=>`<a href="/api/trf-image/${esc(id)}" target="_blank" rel="noopener"><img src="/api/trf-image/${esc(id)}" alt="Photo of ${esc(e.label||'embryo')}" loading="lazy"></a>`).join('')}</div></div>`).join('')}</section>`}
function trfFormHtml(d={}){
 const isM=d.formType==='PGT-M',type=isM?'PGT-M':'PGT-A',tests=d.tests||[],gametes=d.gametes||[],embryos=d.embryos?.length?d.embryos:[{},{},{}];
 const f=(key,label,type='text',extra='')=>`<label class="tf-field"><span>${esc(label)}${TRF_REQUIRED[key]?' <b class="td-req">*</b>':''}</span><input data-f="${key}" type="${type}" value="${esc(d[key])}"${extra}></label>`;
 const area=(key,label,ph='')=>`<label class="tf-field tf-wide"><span>${esc(label)}</span><textarea data-f="${key}" rows="3" placeholder="${esc(ph)}">${esc(d[key])}</textarea></label>`;
 const opt=(group,value,label,on,radio=false)=>`<label class="tf-opt"><input type="${radio?'radio':'checkbox'}"${radio?` name="tf-${group}"`:''} data-g="${group}" value="${esc(value)}"${on?' checked':''}><span>${esc(label)}</span></label>`;
 const card=(n,title,body,note='')=>`<section class="tf-card"><header><span class="tf-step">${n}</span><div><h3>${title}</h3>${note?`<p>${note}</p>`:''}</div></header>${body}</section>`;
 return `<div class="tf-form" data-type="${type}">
 <input type="hidden" data-f="formType" value="${type}">
 ${card(1,'Referring details',`<div class="tf-grid tf-grid-2">${f('hospital','Name of Hospital / IVF Centre','text',' autocomplete="off" placeholder="Start typing the hospital / centre name"')}${f('referringDoctor','Referring Doctor')}${f('phone','Phone','tel',' inputmode="tel"')}${f('email','Email','email')}<label class="tf-field tf-wide tf-full"><span>Address</span><textarea data-f="address" rows="2">${esc(d.address)}</textarea></label></div>`)}
 ${card(2,'Patient information',`<div class="tf-grid">${f('patientName','Patient Name')}${f('patientDob','Date of Birth','date')}${f('uhid','UHID')}${f('aadhaar','Aadhaar Card No','text',' inputmode="numeric" maxlength="14" placeholder="12 digits"')}${f('husbandName',"Husband's Name")}${f('husbandDob',"Husband's Date of Birth",'date')}${f('patientEmail','Patient Email','email')}</div>`)}
 ${card(3,'Test requested <b class="td-req">*</b>',`<div class="tf-opts tf-opts-col">${Object.entries(trfLabelsFor(type)).map(([k,l])=>opt('tests',k,l,tests.includes(k))).join('')}</div>`,'Tick every test needed.')}
 ${card(4,'Specimen details',`<div class="tf-grid">${f('biopsyDate','Date of Biopsy','date')}${isM?f('biopsyTime','Biopsy Time','time'):f('collectionDate','Specimen Collection Date','date')+f('collectionTime','Specimen Collection Time','time')}<div class="tf-field"><span>Biopsy day</span><div class="tf-opts">${(isM?['Day 5','Day 6']:['Day 3','Day 5','Day 6']).map(x=>opt('biopsyDay',x,x,d.biopsyDay===x,true)).join('')}</div></div><div class="tf-field"><span>IVF cycle — gametes</span><div class="tf-opts">${['Self','Donor Sperm','Donor Oocyte'].map(x=>opt('gametes',x,x,gametes.includes(x))).join('')}</div></div>${f('donorAge','If donor is used: Age of donor','text',' inputmode="numeric"')}</div>`)}
 ${card(5,'Test indication &amp; clinical history',`<div class="tf-grid tf-grid-2">${area('testIndication','Test Indication','Why is PGT being requested?')}${area('clinicalHistory','Patient Clinical History')}${isM?f('maternalGenotype','Maternal Genotype')+f('paternalGenotype','Paternal Genotype'):f('maternalKaryotype','Maternal Karyotype')+f('paternalKaryotype','Paternal Karyotype')}</div>`,isM?'Mutation details included.':'Karyotyping details included.')}
 ${card(6,'Biopsy worksheet',`<div class="tf-grid">${f('ivfLabContact','IVF Lab contact No.','tel',' inputmode="tel"')}<div class="tf-field"><span>Re-biopsy included in this case?</span><div class="tf-opts">${opt('rebiopsy','Yes','Yes',d.rebiopsy==='Yes',true)}${opt('rebiopsy','No','No',d.rebiopsy==='No',true)}</div></div></div>
  <div class="tf-table-wrap"><table class="tf-table"><thead><tr><th>Sl No.</th><th>${isM?'Embryo tags':'Embryo label'} <b class="td-req">*</b></th><th>Embryo grade</th><th>No. of cells biopsied</th>${isM?'':'<th>Day 5 / Day 6</th>'}<th>Intact cells observed</th><th>Comments</th><th>Photos</th><th></th></tr></thead><tbody class="td-embryo-rows">${embryos.map((e,i)=>trfEmbryoRowHtml(e,i,type)).join('')}</tbody></table></div>
  <button type="button" class="td-add tf-add">＋ Add embryo</button>
  <p class="tf-hint">Label negative controls NC1, NC2, etc. If sending several, say in Comments which embryos each NC belongs to.</p>
  <div class="tf-grid tf-row-end">${isM?'':opt('dryRun','yes','Embryo Biopsy dry run',!!d.dryRun)+f('embryologistName','Embryologist Name')}${f('embryologistEmail',isM?'Biopsy performed by — email address':'Embryologist email address','email')}</div>`,'One row per embryo biopsied.')}
 ${card(7,'Consent (Form G)',`<div class="tf-grid tf-grid-consent">
  <div class="tf-field"><span>Patient is</span><div class="tf-opts">${opt('consentRelation','Wife','Wife',d.consentRelation==='Wife',true)}${opt('consentRelation','Daughter','Daughter',d.consentRelation==='Daughter',true)}</div></div>
  ${f('consentGuardianName','Name of husband / father')}
  ${f('consentAge','Age (years)','text',' inputmode="numeric"')}
  ${f('consentDate','Date of consent','date')}
  ${f('consentPlace','Place')}
  <label class="tf-field tf-wide"><span>Residing address</span><textarea data-f="patientAddress" rows="2">${esc(d.patientAddress)}</textarea></label>
  ${f('companionName',"Companion's name")}
  ${f('companionRelation',"Companion's relationship to patient")}
  <label class="tf-field tf-wide"><span>Companion's address</span><textarea data-f="companionAddress" rows="2">${esc(d.companionAddress)}</textarea></label>
  ${f('gynaecologistName',"Gynaecologist's name")}
  ${f('gynaecologistRegNo',"Gynaecologist's registration no.")}
  ${f('explanationDate','Date explained to patient','date')}
  ${f('geneticClinicName','Genetic clinic name')}
  ${f('geneticClinicRegNo','Genetic clinic registration no.')}
  <label class="tf-field tf-wide"><span>Genetic clinic address</span><textarea data-f="geneticClinicAddress" rows="2">${esc(d.geneticClinicAddress)}</textarea></label>
 </div>`,'Statutory PNDT Act consent (Form G). Signatures are still signed on the printed copy.')}
 ${card(8,'Outcome follow-up consent <b class="td-req">*</b>',`<div class="tf-grid tf-grid-2">
  <div class="tf-field tf-wide"><span>Patient consent for outcome follow-up (transfer / pregnancy outcome will be requested from the clinic later)</span><div class="tf-opts">${opt('followupConsent','Yes','Yes',d.followupConsent==='Yes',true)}${opt('followupConsent','No','No',d.followupConsent==='No',true)}</div></div>
  ${f('followupContact','Clinic contact person')}
  ${f('followupPhoneEmail','Follow-up email / phone')}
  <label class="tf-field"><span>Expected transfer period, if known</span><select data-f="followupExpected"><option value="">—</option>${['Within 1 month','1–3 months','3–6 months','6–12 months','Not known'].map(x=>`<option${d.followupExpected===x?' selected':''}>${x}</option>`).join('')}</select></label>
 </div>`,'Only permission and contact details are collected here. Pregnancy results are recorded later by the lab, not in this form.')}
 <p class="tf-foot">Storage and transport: store and ship refrigerated at -20ºC. CONFIDENTIAL WHEN COMPLETED — the personal health information is collected for clinical laboratory testing only.</p>
 </div>`}
// Wires the digital form: add / remove embryo rows (always keeping one).
// A name typed into a fill-in-the-blank gets a smaller font the longer it is, so it stays inside its blank.
const fitPct=(v,ch=16)=>{const n=String(v||'').length;return n<=ch?100:Math.max(60,Math.floor(ch/n*100))};
const fitStyle=(v,ch=16)=>{const p=fitPct(v,ch);return p<100?`font-size:${p}%`:''};
const fitAttr=v=>{const p=fitPct(v);return p<100?` style="font-size:${p}%;white-space:nowrap"`:''};
function trfWire(root,onChange=()=>{}){
 root.addEventListener('input',e=>{const i=e.target.closest?.('input.td-inline');if(i){const ch=parseInt(i.style.width)||16,p=fitPct(i.value,ch);i.style.fontSize=p<100?p+'%':''}});
 const rowsEl=root.querySelector('.td-embryo-rows'),renumber=()=>[...rowsEl.rows].forEach((r,i)=>{r.cells[0].textContent=i+1});
 const blankRow=()=>{const t=document.createElement('tbody');t.innerHTML=trfEmbryoRowHtml({},rowsEl.rows.length,root.querySelector('.tf-form')?.dataset.type||'PGT-A');return t.firstElementChild};
 root.querySelector('.td-add').onclick=()=>{rowsEl.appendChild(blankRow());renumber();rowsEl.lastElementChild.querySelector('input')?.focus();onChange()};
 rowsEl.addEventListener('click',e=>{const b=e.target.closest('.td-remove');if(!b)return;b.closest('tr').remove();if(!rowsEl.rows.length)rowsEl.appendChild(blankRow());renumber();onChange()});
 const setImgs=(tr,ids)=>{tr.dataset.images=JSON.stringify(ids);tr.querySelector('.tf-thumbs').outerHTML=trfThumbsHtml(ids);onChange()};
 rowsEl.addEventListener('click',e=>{const tr=e.target.closest('tr');if(!tr)return;const x=e.target.closest('.tf-thumb-x');if(x){const id=x.closest('.tf-thumb').dataset.id;setImgs(tr,JSON.parse(tr.dataset.images||'[]').filter(i=>i!==id));return}
  const pb=e.target.closest('.tf-photo-btn');if(!pb)return;const have=JSON.parse(tr.dataset.images||'[]');if(have.length>=6){alert('Up to 6 photos per embryo.');return}
  const inp=document.createElement('input');inp.type='file';inp.accept='image/*';if(pb.dataset.cam)inp.setAttribute('capture','environment');else inp.multiple=true;inp.onchange=async()=>{const btn=pb,label=btn.textContent;btn.disabled=true;let ids=JSON.parse(tr.dataset.images||'[]');
   for(const f of [...inp.files].slice(0,6-ids.length)){btn.textContent='Uploading…';try{const blob=await trfShrinkImage(f),fd=new FormData();fd.append('file',blob,'embryo.jpg');const r=await fetch('/api/trf-image',{method:'POST',body:fd}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||'Upload failed');TRF_LOCAL_THUMBS[j.id]=URL.createObjectURL(blob);ids=[...ids,j.id];setImgs(tr,ids)}catch(err){alert(`${f.name}: ${err.message||'could not be uploaded'}`)}}
   btn.disabled=false;btn.textContent=label};inp.click()});
 root.addEventListener('input',()=>onChange());root.addEventListener('change',()=>onChange());
}
function trfProblems(d){const p=Object.entries(TRF_REQUIRED).filter(([k])=>!d[k]).map(([,l])=>l);
 if(!d.tests.length)p.push('Test requested');if(!d.embryos.some(e=>e.label))p.push('At least one embryo label in the biopsy worksheet');
 if(d.email&&String(d.email).split(/[,;\s]+/).filter(Boolean).some(x=>!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))p.push('Email (enter a valid email address)');
 const a=String(d.aadhaar||'').replace(/\D/g,'');if(a&&a.length!==12)p.push('Aadhaar number (must be 12 digits)');
 if(!d.followupConsent)p.push('Patient consent for outcome follow-up (Yes / No)');else if(d.followupConsent==='Yes'&&(!d.followupContact||!d.followupPhoneEmail))p.push('Clinic contact person and follow-up email / phone (needed when follow-up consent is Yes)');return p}
// Opens the TRF in a new window laid out for A4 and brings up the print dialog (Save as PDF).
// Preview / Print: the server fills the lab's original paper template with the data and returns a PDF,
// which opens in the browser's PDF viewer (print or save from there). If that fails, the HTML layout is printed instead.
async function printTrf(d,meta={}){
 const w=window.open('','_blank');if(!w){alert('Allow pop-ups for this site to print the TRF.');return}
 w.document.write('<!doctype html><title>Preparing…</title><p style="font:14px Arial;padding:24px">Preparing the TRF…</p>');
 try{
  const submittedAtText=meta.submittedAt?new Date(meta.submittedAt).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).toUpperCase():'';
  const res=await fetch('/api/trf/preview-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d,meta:{ref:meta.ref||'',submittedAtText}})});
  if(!res.ok)throw new Error('render failed');
  w.location.href=URL.createObjectURL(await res.blob());
 }catch{printTrfHtml(d,meta,w)}
}
function printTrfHtml(d,meta={},existing){
 const w=existing||window.open('','_blank');if(!w){alert('Allow pop-ups for this site to print the TRF.');return}
 const title=`TRF ${meta.ref||''} ${d?.patientName||''}`.trim();
 w.document.write('<!doctype html><title>Preparing…</title><p style="font:14px Arial;padding:24px">Preparing the TRF…</p>');
 // The stylesheet is embedded (not linked) so the print window can never render before it has loaded;
 // <base> lets its relative artwork URLs resolve against the app.
 fetch('/static/trf-doc.css?v=20261007p').then(r=>r.text()).catch(()=>'').then(css=>{
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/static/"><title>${esc(title)}</title><style>${css}</style></head><body class="td-print">${trfPagesHtml(d,meta)}</body></html>`);
  w.document.close();
  let done=false;const go=()=>{if(done)return;done=true;w.focus();w.print()};
  const imgs=[...w.document.querySelectorAll('img')].map(el=>new Promise(r=>{if(el.complete)r();else{el.onload=r;el.onerror=r}}));
  Promise.all(imgs).then(()=>setTimeout(go,300));setTimeout(go,8000);
 });
}
Object.assign(global,{trfFollowupHtml,TRF_TEST_LABELS,TRF_TEST_LABELS_M,TRF_REQUIRED,trfPagesHtml,trfFormHtml,trfCollect,trfWire,trfProblems,printTrf,trfImagesHtml});
})(window);
