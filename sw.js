// אקורדי – שומר את קבצי האפליקציה בטלפון כדי שתעבוד גם בלי אינטרנט.
// VER – מספר הגרסה שמוצג (Akordi 0.N). V – קוד לפי תוכן הקבצים. שניהם מתעדכנים אוטומטית בכל עדכון (git pre-commit), וכך הטלפון יודע שיש גרסה חדשה.
const VER='0.69';
const V='f360ade15f';
const C='akordi-'+VER+'_'+V;
const ASSETS=['./','index.html','icon.svg','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','fonts/Alef-Regular.ttf','fonts/Alef-Bold.ttf','fonts/OpenSans500-he.woff','vendor/jspdf.umd.min.js','privacy.html','terms.html','legal.css'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'})))));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('akordi-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin!==location.origin)return;
  e.respondWith((async()=>{
    const c=await caches.open(C);
    let hit=await c.match(r,{ignoreSearch:true});
    if(!hit&&r.mode==='navigate'&&!/\.html$/.test(u.pathname))hit=await c.match('./');
    if(hit)return hit;
    try{return await fetch(r)}catch(err){if(r.mode==='navigate'){const h=await c.match('./');if(h)return h}throw err}
  })());
});
