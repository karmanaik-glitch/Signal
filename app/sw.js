// Shell: stale-while-revalidate. Data: network-first with offline fallback. Bump VERSION on shell changes.
const VERSION = 'signal-v1';
const SHELL = ['./', 'index.html', 'styles.css',
  'js/main.js', 'js/views.js', 'js/data.js', 'js/charts.js', 'js/util.js', 'js/router.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'icons/Signal_Wordmark.svg', 'icons/Signal_Wordmark_Light.svg', 'icons/Signal_Wordmark_Only.svg', 'icons/Signal_Wordmark_Only_Light.svg',
  'fonts/ibm-plex-sans-400.woff2', 'fonts/ibm-plex-sans-500.woff2', 'fonts/ibm-plex-sans-600.woff2', 'fonts/ibm-plex-sans-700.woff2',
  'fonts/ibm-plex-mono-400.woff2', 'fonts/ibm-plex-mono-500.woff2', 'fonts/ibm-plex-mono-600.woff2', 'fonts/ibm-plex-mono-700.woff2'];
const DATA = /\/(snapshot|backtest)\.json$|\/charts\//;
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  const put = res => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then(x => x.put(r, c)); } return res; };
  if (DATA.test(u.pathname)) { e.respondWith(fetch(r, { cache: 'no-cache' }).then(put).catch(() => caches.match(r))); return; }
  e.respondWith(caches.match(r).then(hit => { const net = fetch(r).then(put).catch(() => hit); return hit || net; }));
});
