// Coordinator home: the six status cards (embryo wise / sample wise) and the sample list below them.
let coView='embryos',coQ='',coLimit=200,coMonth='';
function coRows(){

 allEmbryos().forEach(e=>{if(e._stale)return;if(coMonth&&recordMonth(e)!==coMonth)return;(coView==='samples'?[e]:embryoRowsOf(e)).forEach(r=>out.push({r:Object.assign(r,{_case:e._case}),e}))});
 return out}
function renderCoordView(g){
 const ht=document.getElementById('genericHeaderTitle');if(ht)ht.textContent='Home';
 const mh=document.getElementById('mainHeader');if(mh)mh.classList.add('hidden');
 const all=allEmbryos().filter(e=>!e._stale),months=reportPrepMonths(),st=stageRows(),
  n=list=>homeCount(list),stage=k=>st[k].reduce((s,x)=>s+(homeUnit==='samples'?1:x.n),0),
  card=(label,v,sub,img)=>`<article><div><small>${label}</small><strong>${v.toLocaleString()}</strong><p>${sub}</p></div><span class="stat-icon has-img"><img class="ico" src="/static/icons/${img}.png" alt=""></span></article>`,
  seg=(id,a,b,cur)=>`<div class="prep-segments" id="${id}" role="tablist">${[a,b].map(([k,l])=>`<button type="button" class="prep-seg${cur===k?' active':''}" data-v="${k}" role="tab" aria-selected="${cur===k}">${l}</button>`).join('')}</div>`;
 const mc={};all.forEach(e=>{const m=recordMonth(e);if(m)mc[m]=(mc[m]||0)+(coView==='samples'?1:embryoRowsOf(e).length)});
 const mkeys=Object.keys(mc).filter(m=>m!=='Pending'&&isDateMonth(m)).sort().reverse(),other=Object.keys(mc).filter(m=>m!=='Pending'&&!isDateMonth(m)),tot=Object.values(mc).reduce((a,b)=>a+b,0),
  tabs=[['','All',tot],...(mc.Pending?[['Pending','Pending',mc.Pending]]:[]),...mkeys.map(m=>[m,monthLabel(m),mc[m]]),...other.map(m=>[m,m,mc[m]])].map(([k,l,c])=>`<button type="button" class="prep-seg${coMonth===k?' active':''}" data-m="${escapeHtml(k)}">${escapeHtml(l)} <b>${c.toLocaleString()}</b></button>`).join('');
 const rows=coRows(),q=coQ.trim().toLowerCase(),
  line=({r})=>{const t=testNameOf(r)||'',emb=coView==='samples'?(field(r,['sample name','embryo name','embryo'])):embryoDisplayId(r);return [field(r,['date of biopsy']),field(r,['date sample received']),field(r,['date trf received']),field(r,['received by']),field(r,['sample id']),field(r,['patient name']),String(Math.max(1,Math.round(embryoUnits(r)))),emb,t,field(r,['center name','centre name','hospital clinic name']),field(r,['location']),tatDate(r,r._case)]},
  lines=rows.map(line).filter(l=>!q||l.join(' ').toLowerCase().includes(q)),shown=lines.slice(0,coLimit),
  heads=['Date of biopsy','Date sample received','Date TRF received','Received by','Sample ID','Patient name','Number of embryos','Embryo name','Test name','Center name','Location','TAT'];
 g.innerHTML=`<div class="generic-card wide-card"><div class="co-bar"><h2 class="home-title">Home</h2>${seg('coUnit',['embryos','Embryo wise'],['samples','Sample wise'],homeUnit)}</div>
 <div class="stats" id="coStats">${card(homeUnit==='samples'?'TOTAL SAMPLES':'TOTAL EMBRYOS',n(all),'all samples','stages-results__total-embryos')}${card('SEQUENCING',stage('wga'),'awaiting sequencing','stages-results__sequencing')}${card('REPORT PREPARATION',n(all.filter(e=>isReportPrep(e,months))),'report pending','stages-results__report-preparation')}${card('REPORT RELEASED',stage('released'),'report sent','stages-results__report-sent')}${card('OVERDUE SAMPLES',n(all.filter(e=>isOverdue(e,e._case))),'past TAT date','tests-transfers__repeat-biopsy')}${card('RE-BIOPSY',n(all.filter(isRebiopsy)),'repeat biopsies','tests-transfers__repeat-biopsy')}</div>
 <div class="co-bar co-list-bar"><h3 class="db-h">${coView==='samples'?'Patient list':'Embryo list'} <small>${lines.length.toLocaleString()} rows</small></h3>${seg('coView',['samples','Patient view'],['embryos','Embryo view'],coView)}<div class="search-wrap"><span>⌕</span><input id="coSearch" type="search" placeholder="Search patient, sample ID, client…" value="${escapeHtml(coQ)}"></div></div>
 <div class="prep-segments sheet-tabs" id="coMonths">${tabs}</div>
 <div class="fu-table-wrap"><table class="fu-table co-table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${shown.map(l=>`<tr>${l.map((v,i)=>`<td${i===5||i===7?' class="strong"':''}>${escapeHtml(v||'—')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${heads.length}" class="chart-empty">No records.</td></tr>`}</tbody></table></div>
 ${lines.length>shown.length?`<div style="text-align:center;margin:12px"><button type="button" class="secondary" id="coMore">Show more (${(lines.length-shown.length).toLocaleString()} left)</button></div>`:''}</div>`;
 g.querySelector('#coUnit').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;homeUnit=b.dataset.v;try{localStorage.setItem('em-home-unit',homeUnit)}catch{}renderCoordView(g)};
 g.querySelector('#coMonths').onclick=e=>{const b=e.target.closest('[data-m]');if(!b)return;coMonth=b.dataset.m;coLimit=200;renderCoordView(g)};
 g.querySelector('#coView').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;coView=b.dataset.v;coLimit=200;renderCoordView(g)};
 const s=g.querySelector('#coSearch');s.oninput=()=>{coQ=s.value;coLimit=200;const p=s.selectionStart;renderCoordView(g);const n2=g.querySelector('#coSearch');n2.focus();n2.setSelectionRange(p,p)};
 const m=g.querySelector('#coMore');if(m)m.onclick=()=>{coLimit+=300;renderCoordView(g)}}
