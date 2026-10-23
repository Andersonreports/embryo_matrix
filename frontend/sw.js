// Lets the phone install EmbryoMatrix as an app. Nothing is cached except a small offline page: every screen needs
// live data, so pages and API calls always go to the server.
const OFFLINE='em-offline-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(OFFLINE).then(c=>c.add('/static/offline.html')).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==OFFLINE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.mode!=='navigate')return;
  e.respondWith(fetch(e.request).catch(()=>caches.match('/static/offline.html')));
});
