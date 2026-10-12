// 我的羽球練習日誌：離線快取（和「我的羽球教練」的快取分開，互不清除）
const VERSION = 'swing-journal-v5';
const RUNTIME = 'swing-journal-runtime-v1';
const SHELL = [
  './', 'index.html', 'css/journal.css', 'manifest.webmanifest', 'js/journal.js', 'js/jstore.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  '../css/app.css', '../js/ui.js', '../js/tracking.js', '../js/library.js', '../js/config.js', '../images/usc-logo.png',
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('swing-journal-') && k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(RUNTIME).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  // 示範影片庫一律直接連網路（離線時 App 會改用這台裝置下載過的示範）
  if (url.origin === self.location.origin && url.pathname.includes('/library/')) return;
  if (url.origin === self.location.origin) {
    // 程式本體：先用網路取得最新版，離線時用快取
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
});
