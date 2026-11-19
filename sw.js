const CACHE_NAME = 'chicken-workspace-v11';
const STATIC = ['./','./index.html','./manifest.json','./logo.png','./assets/images/chicken.jpg','./assets/images/breast.jpg','./assets/images/fish.jpg','./assets/images/eggs.jpg','./html5-qrcode.min.js','./data-core.js','./cloud-access.js','./coconut.js','./coconut-ledger-browser.mjs','./lib/coconut-ledger.mjs','./sales.js','./returns.js','./workspace.css','./workspace.js','./vendor/fuse.min.js','./vendor/JsBarcode.all.min.js','./assets/fonts/inter-latin-variable.woff2','./assets/fonts/noto-sans-sinhala-400.woff2','./assets/fonts/noto-sans-sinhala-600.woff2','./pwa.js','./backup.js','./inventory.js','./settings.js','./assets/icons/icon-180.png','./assets/icons/icon-192.png','./assets/icons/icon-maskable-512.png','./logo.ico'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC))));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>(name.startsWith('rcm-pos-')||name.startsWith('chicken-workspace-'))&&name!==CACHE_NAME).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api/')||!['http:','https:'].includes(url.protocol))return;
  if(request.mode==='navigate'){
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const shell = await cache.match('./index.html');
      return shell || fetch(request);
    }));
    return;
  }
  if(url.origin===self.location.origin||request.destination==='image'||request.destination==='font')event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok||response.type==='opaque'){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());}
      return response;
    }catch{return new Response('',{status:503});}
  })());
});