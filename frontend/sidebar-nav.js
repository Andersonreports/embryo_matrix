// Sidebar navigation (trial). NAV_LAYOUT='sidebar' turns the top bar into a left
// rail with nested children:
//   Run status  → Overview / Embryo registry / Upload result
//   Run reports → Run summary / QC check / Embryologists (the report's layout modes)
// The rail can be collapsed (state remembered; open by default).
// Set NAV_LAYOUT='topbar' to restore the original top navigation — nothing else changes.
// Loaded after app.js so showView() exists.
(function(){
 const NAV_LAYOUT='sidebar'; // 'topbar' = original top navigation
 if(NAV_LAYOUT!=='sidebar')return;
 document.body.classList.add('sidebar-nav');
 const nav=document.querySelector('.topnav'),topbar=document.querySelector('.topbar');
 if(!nav||!topbar||nav._hier)return;
 nav._hier=true;
 const sub=(parent,html)=>{if(!parent)return null;const d=document.createElement('div');d.className='nav-sub';d.innerHTML=html;parent.after(d);return d};
 const item=(attrs,icon,label)=>`<button type="button" class="nav-item nav-subitem" ${attrs}><span><img class="ico" src="/static/assets/icons/${icon}" alt=""></span> ${label}</button>`;

 // Run status children: plain views. app.js marks them active by data-view.
 const rs=sub(document.getElementById('runStatusNav'),[['overview','navigation__overview.png','Overview'],['samples','navigation__samples.png','Embryo registry'],['import','navigation__upload-result.png','Upload result']].map(([v,ic,l])=>item(`data-view="${v}"`,ic,l)).join(''));
 rs?.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));

 // Run reports children: the three report layouts (#rrMode). No data-view, so app.js
 // never marks all three active at once; syncRR() highlights the current one.
 const RR=[['summary','navigation__run-reports.png','Run summary'],['qc','stages-results__qc-pass.png','QC check'],['emb','run-summary__patients.png','Embryologists']];
 const rr=sub(nav.querySelector('[data-view="runreports"]'),RR.map(([m,ic,l])=>item(`data-rr-mode="${m}"`,ic,l)).join(''));
 const setMode=m=>{const s=document.getElementById('rrMode');if(s&&s.value!==m){s.value=m;s.dispatchEvent(new Event('change',{bubbles:true}))}};
 const syncRR=view=>{const mode=document.getElementById('rrMode')?.value||'summary';rr?.querySelectorAll('[data-rr-mode]').forEach(b=>b.classList.toggle('active',view==='runreports'&&b.dataset.rrMode===mode))};
 let curView='';
 rr?.querySelectorAll('[data-rr-mode]').forEach(b=>b.addEventListener('click',()=>{if(curView!=='runreports')showView('runreports');setMode(b.dataset.rrMode);syncRR('runreports')}));
 document.addEventListener('change',e=>{if(e.target.id==='rrMode')syncRR(curView)});
 // Track the current view so the report-type highlight follows navigation.
 const base=window.showView;
 window.showView=function(v){const r=base.apply(this,arguments);curView=v;syncRR(v);return r};

 // Collapse / reopen the rail (default open, remembered per browser).
 const KEY='em-sidebar-collapsed',setCollapsed=v=>{document.body.classList.toggle('sidebar-collapsed',v);try{localStorage.setItem(KEY,v?'1':'0')}catch{}};
 try{if(localStorage.getItem(KEY)==='1')document.body.classList.add('sidebar-collapsed')}catch{}
 const cbtn=document.createElement('button');cbtn.type='button';cbtn.className='sb-collapse';cbtn.title='Hide sidebar';cbtn.setAttribute('aria-label','Hide sidebar');
 cbtn.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';
 topbar.insertBefore(cbtn,topbar.firstChild);
 const obtn=document.createElement('button');obtn.type='button';obtn.className='sb-open';obtn.title='Show sidebar';obtn.setAttribute('aria-label','Show sidebar');
 obtn.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>';
 document.body.appendChild(obtn);
 cbtn.addEventListener('click',()=>setCollapsed(true));
 obtn.addEventListener('click',()=>setCollapsed(false));
})();
