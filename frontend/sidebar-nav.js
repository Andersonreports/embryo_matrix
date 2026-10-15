// Sidebar navigation (trial). NAV_LAYOUT='sidebar' turns the top bar into a left
// rail and nests the Run-status inner tabs (Overview / Embryo registry / Upload
// result) under "Run status". Set NAV_LAYOUT='topbar' to restore the original top
// navigation — nothing else changes. Loaded after app.js so showView() exists.
(function(){
 const NAV_LAYOUT='sidebar'; // 'topbar' = original top navigation
 if(NAV_LAYOUT!=='sidebar')return;
 document.body.classList.add('sidebar-nav');
 const nav=document.querySelector('.topnav'),runStatus=document.getElementById('runStatusNav');
 if(!nav||!runStatus||nav._hier)return;
 nav._hier=true;
 const sub=document.createElement('div');
 sub.className='nav-sub';
 const items=[['overview','navigation__overview.png','Overview'],['samples','navigation__samples.png','Embryo registry'],['import','navigation__upload-result.png','Upload result']];
 sub.innerHTML=items.map(([v,ic,l])=>`<button type="button" class="nav-item nav-subitem" data-view="${v}"><span><img class="ico" src="/static/assets/icons/${ic}" alt=""></span> ${l}</button>`).join('');
 runStatus.after(sub);
 // app.js bound the original [data-view] clicks before this ran, so wire the new ones.
 sub.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(window.showView)showView(b.dataset.view)}));
})();
