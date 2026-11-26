const CACHE="customer-static-v2";
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(["/"])));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.destination==="document"||url.pathname.startsWith("/t/"))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)))});
self.addEventListener("push",event=>{
  let payload={title:"تحديث طلبك",body:"يوجد تحديث جديد على طلبك.",url:"/"};
  try{if(event.data)payload={...payload,...event.data.json()}}catch{if(event.data)payload.body=event.data.text()}
  event.waitUntil(self.registration.showNotification(payload.title||"تحديث طلبك",{
    body:payload.body||"يوجد تحديث جديد على طلبك.",
    icon:"/icon.svg",
    badge:"/icon.svg",
    tag:payload.tag||"customer-order-update",
    renotify:true,
    requireInteraction:true,
    silent:false,
    data:{url:payload.url||"/"}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/",self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
    for(const client of clients){if(client.url.startsWith(self.location.origin)&&"focus" in client)return client.focus()}
    return self.clients.openWindow(target);
  }));
});
