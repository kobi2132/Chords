// אקורדי – שומר את קבצי האפליקציה בטלפון כדי שתעבוד גם בלי אינטרנט.
// VER – מספר הגרסה שמוצג (Akordi 0.N). V – קוד לפי תוכן הקבצים. שניהם מתעדכנים אוטומטית בכל עדכון (git pre-commit), וכך הטלפון יודע שיש גרסה חדשה.
const VER='0.74b6';
const V='36f736c04d';
const C='akordi-'+VER+'_'+V;
const ASSETS=['./','index.html','icon.svg','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','manifest-beta.webmanifest','icon-beta.svg','icons/icon-beta-192.png','icons/icon-beta-512.png','icons/icon-beta-maskable-512.png','icons/apple-touch-icon-beta.png','fonts/Alef-Regular.ttf','fonts/Alef-Bold.ttf','fonts/OpenSans500-he.woff','vendor/jspdf.umd.min.js','whatsnew.json','help.json','privacy.html','terms.html','legal.css'];
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
    // כתובת בלי סיומת קובץ (למשל /Chords/) נפתחת כאפליקציה; כתובת של קובץ (sw.js, changelog.json) מוצגת כמו שהיא
    const page=!/\.[a-z0-9]+$/i.test(u.pathname);
    if(!hit&&r.mode==='navigate'&&page)hit=await c.match('./');
    if(hit)return hit;
    try{return await fetch(r)}catch(err){if(r.mode==='navigate'&&page){const h=await c.match('./');if(h)return h}throw err}
  })());
});
