/* Service worker: التطبيق نفسه network-first (عشان التحديثات توصل)، المكتبات cache-first، وطلبات قاعدة البيانات من النت مباشرة */
const CACHE = 'shopapp-v2';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './db.js', './config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('.supabase.co')) return;
  if (url.origin === location.origin) {
    // network-first مع fallback للكاش لو النت قطع
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  // CDN: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
