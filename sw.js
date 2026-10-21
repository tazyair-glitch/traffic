// Service worker: offline shell + receiving screenshots shared from the gallery (Share Target)
const CACHE = 'tlm-shell-v2';
const SHELL = ['./', './index.html', './app.js', './analyzer.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'tlm-shared').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const shareUrl = new URL('./share', self.registration.scope);

  // Image shared into the app → stash it and open the app
  if (e.request.method === 'POST' && url.pathname === shareUrl.pathname) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('image');
      if (file) {
        const c = await caches.open('tlm-shared');
        await c.put('./shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  // Only cache our own files; Waze iframe etc. go to network
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
