// Coordinator home: the six status cards (embryo wise / sample wise) and the sample list below them.
let coView='embryos',coQ='',coLimit=200,coMonth='',coFOpen=false,coMenu=false;
const coF={client:'',test:'',embryologist:'',location:'',receivedBy:''},CO_FILTERS=[['client','Client',9],['test','Test',8],['embryologist','Embryologist',-1],['location','Location',10],['receivedBy','Received by',3]];
let coCache={cases:null,unit:'',m:new Map()};
function coMemo(k,fn){if(coCache.cases!==cases||coCache.unit!==homeUnit)coCache={cases,unit:homeUnit,m:new Map()};if(!coCache.m.has(k))coCache.m.set(k,fn());return coCache.m.get(k)}
function coRows(){const out=[];

 allEmbryos().forEach(e=>{if(e._stale)return;if(coMonth&&recordMonth(e)!==coMonth)return;(coView==='samples'?[e]:embryoRowsOf(e)).forEach(r=>out.push({r:Object.assign(r,{_case:e._case}),e}))});
 return out}
function renderCoordView(g){
 try{renderCoord(g)}catch(err){console.error(err);g.innerHTML=`<div class="generic-card"><div class="chart-empty">Could not draw the Home page: ${escapeHtml(String(err&&err.message||err))}</div></div>`}}
function renderCoord(g){coView=homeUnit;
 const ht=document.getElementById('genericHeaderTitle');if(ht)ht.textContent='Home';
 const mh=document.getElementById('mainHeader');if(mh)mh.classList.add('hidden');
 const S=coMemo('stats',()=>{const all=allEmbryos().filter(e=>!e._stale),months=reportPrepMonths(),st=stageRows(),stage=k=>st[k].reduce((s,x)=>s+(homeUnit==='samples'?1:x.n),0);return{tot:homeCount(all),seq:stage('wga'),prep:homeCount(all.filter(e=>isReportPrep(e,months))),rel:stage('released')}}),
  card=(label,v,sub,img,c)=>`<div class="co-card" style="--c:${c}"><img class="ico" src="/static/icons/${img}.png" alt=""><strong>${v.toLocaleString()}</strong><span class="co-card-label">${label}</span><small>${sub}</small></div>`,
  seg=(id,a,b,cur)=>`<div class="prep-segments" id="${id}" role="tablist">${[a,b].map(([k,l])=>`<button type="button" class="prep-seg${cur===k?' active':''}" data-v="${k}" role="tab" aria-selected="${cur===k}">${l}</button>`).join('')}</div>`;
 const mc=coMemo('mc',()=>{const o={};allEmbryos().forEach(e=>{if(e._stale)return;const m=recordMonth(e);if(m)o[m]=(o[m]||0)+(coView==='samples'?1:embryoRowsOf(e).length)});return o});
 const mkeys=Object.keys(mc).filter(m=>m!=='Pending'&&isDateMonth(m)).sort().reverse(),other=Object.keys(mc).filter(m=>m!=='Pending'&&!isDateMonth(m)),tot=Object.values(mc).reduce((a,b)=>a+b,0),
  tabs=[['','All',tot],...(mc.Pending?[['Pending','Pending',mc.Pending]]:[]),...mkeys.map(m=>[m,monthLabel(m),mc[m]]),...other.map(m=>[m,m,mc[m]])].map(([k,l,c])=>`<button type="button" class="prep-seg${coMonth===k?' active':''}" data-m="${escapeHtml(k)}">${escapeHtml(l)} <b>${c.toLocaleString()}</b></button>`).join('');
 const q=coQ.trim().toLowerCase(),
  line=({r})=>{const t=testNameOf(r)||'',emb=coView==='samples'?(field(r,['sample name','embryo name','embryo'])):embryoDisplayId(r);return [field(r,['date of biopsy']),field(r,['date sample received']),field(r,['date trf received']),field(r,['received by']),field(r,['sample id']),field(r,['patient name']),String(Math.max(1,Math.round(embryoUnits(r)))),emb,t,field(r,['center name','centre name','hospital clinic name']),field(r,['location']),tatDate(r,r._case)]},
  base=coMemo('base|'+coMonth,()=>coRows().map(x=>{const l=line(x),emb=field(x.r,['embryologist name','embryologist']);return{l,c:x.r._case,emb,hay:(l.join(' ')+' '+emb).toLowerCase()}})),
  val=(o,i)=>i<0?o.emb:o.l[i],
  opts=Object.fromEntries(CO_FILTERS.map(([k,,i])=>[k,[...new Set(base.map(o=>val(o,i)).filter(Boolean))].sort()])),
  items=base.filter(o=>CO_FILTERS.every(([k,,i])=>!coF[k]||val(o,i)===coF[k])).filter(o=>!q||o.hay.includes(q)),lines=items,shown=items.slice(0,coLimit),nF=CO_FILTERS.filter(([k])=>coF[k]).length,
  heads=['Date of biopsy','Date sample received','Date TRF received','Received by','Sample ID','Patient name','Number of embryos','Embryo name','Test name','Center name','Location','TAT'];
 g.innerHTML=`<div class="generic-card wide-card"><div class="co-bar"><h2 class="home-title">Home</h2>${seg('coUnit',['embryos','Embryo wise'],['samples','Sample wise'],homeUnit)}</div>
 <div class="co-cards" id="coStats">${card(homeUnit==='samples'?'TOTAL SAMPLES':'TOTAL EMBRYOS',S.tot,'all samples','stages-results__total-embryos','#17789a')}${card('SEQUENCING',S.seq,'awaiting sequencing','stages-results__sequencing','#2f6b98')}${card('REPORT PREPARATION',S.prep,'report pending','stages-results__report-preparation','#c07a1d')}${card('REPORT RELEASED',S.rel,'report sent','stages-results__report-sent','#1f8a52')}</div>
 <div class="co-bar co-list-bar"><h3 class="db-h">${coView==='samples'?'Sample wise list':'Embryo wise list'} <small>${lines.length.toLocaleString()} rows</small></h3><div class="search-wrap"><span>⌕</span><input id="coSearch" type="search" placeholder="Search patient, sample ID, client…" value="${escapeHtml(coQ)}"></div><button type="button" class="toolbar-btn${coFOpen||nF?' active':''}" id="coFilters"><span class="btn-ico"><img class="ico" src="/static/icons/navigation__filter.png" alt=""></span> Filters <b class="filters-badge">${nF}</b></button><div class="export-wrap"><button type="button" class="secondary compact" id="coExport"><span class="btn-ico"><img class="ico" src="/static/icons/navigation__download-export.png" alt=""></span> Export data</button><div class="export-menu${coMenu?'':' hidden'}" id="coExportMenu"><button type="button" data-f="csv">CSV</button><button type="button" data-f="excel">Excel</button></div></div></div>
 ${coFOpen?`<div class="co-filters">${CO_FILTERS.map(([k,l])=>`<label class="mon-f"><span>${l}</span><select data-f="${k}"><option value="">All</option>${opts[k].map(v=>`<option${coF[k]===v?' selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>`).join('')}${nF?'<button type="button" class="db-fclear" id="coFClear">Clear filters</button>':''}</div>`:''}
 <div class="prep-segments sheet-tabs" id="coMonths">${tabs}</div>
 <div class="fu-table-wrap"><table class="fu-table co-table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${shown.map((o,i)=>`<tr data-i="${i}" class="co-row">${o.l.map((v,i)=>`<td${i===5||i===7?' class="strong"':''}>${escapeHtml(v||'—')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${heads.length}" class="chart-empty">No records.</td></tr>`}</tbody></table></div>
 ${lines.length>shown.length?`<div style="text-align:center;margin:12px"><button type="button" class="secondary" id="coMore">Show more (${(lines.length-shown.length).toLocaleString()} left)</button></div>`:''}</div>`;
 g.querySelector('#coUnit').onclick=e=>{const b=e.target.closest('[data-v]');if(!b)return;homeUnit=b.dataset.v;coLimit=200;try{localStorage.setItem('em-home-unit',homeUnit)}catch{}renderCoordView(g)};
 g.querySelector('#coMonths').onclick=e=>{const b=e.target.closest('[data-m]');if(!b)return;coMonth=b.dataset.m;coLimit=200;renderCoordView(g)};
 const s=g.querySelector('#coSearch');s.oninput=()=>{coQ=s.value;coLimit=200;const p=s.selectionStart;renderCoordView(g);const n2=g.querySelector('#coSearch');n2.focus();n2.setSelectionRange(p,p)};
 g.querySelector('.co-table tbody').onclick=e=>{const tr=e.target.closest('tr[data-i]');if(!tr)return;const o=shown[+tr.dataset.i];if(o&&o.c)openPatient(o.c)};
  g.querySelector('#coFilters').onclick=()=>{coFOpen=!coFOpen;renderCoordView(g)};
 g.querySelectorAll('.co-filters select').forEach(sel=>sel.onchange=()=>{coF[sel.dataset.f]=sel.value;coLimit=200;renderCoordView(g)});
 const fc=g.querySelector('#coFClear');if(fc)fc.onclick=()=>{Object.keys(coF).forEach(k=>coF[k]='');coLimit=200;renderCoordView(g)};
 g.querySelector('#coExport').onclick=ev=>{ev.stopPropagation();coMenu=!coMenu;g.querySelector('#coExportMenu').classList.toggle('hidden',!coMenu)};
 g.querySelector('#coExportMenu').onclick=ev=>{const b=ev.target.closest('[data-f]');if(!b)return;coMenu=false;g.querySelector('#coExportMenu').classList.add('hidden');coExport(b.dataset.f,heads,items.map(o=>o.l))};
 const m=g.querySelector('#coMore');if(m)m.onclick=()=>{coLimit+=300;renderCoordView(g)}}

function coExport(fmt,heads,rows){
 const name=`coordinator-${coView==='samples'?'sample':'embryo'}-list-${new Date().toISOString().slice(0,10)}`,BOM='\ufeff',NL='\r\n';let blob,ext;
 if(fmt==='excel'){const h=v=>escapeHtml(String(v??''));blob=new Blob([BOM+'<html><head><meta charset="utf-8"></head><body><table><tr>'+heads.map(x=>`<th>${h(x)}</th>`).join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(v=>`<td>${h(v)}</td>`).join('')+'</tr>').join('')+'</table></body></html>'],{type:'application/vnd.ms-excel'});ext='xls'}
 else{const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';blob=new Blob([BOM+[heads,...rows].map(r=>r.map(q).join(',')).join(NL)],{type:'text/csv;charset=utf-8'});ext='csv'}
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${name}.${ext}`;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
