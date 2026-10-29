// Offline support for the home-screen (web) version. Not used inside the Android app.
// The app's own files are cached so it opens with no signal. Contact data is never here:
// it lives in the app's local storage on the phone.
const VERSION = '__BUILD__';
const CACHE = 'gtc-' + VERSION;
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/contacts-data.js', 'manifest.webmanifest',
               'favicon.png', 'img/logo-192.png', 'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('gtc-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (so updates show up right away), cached copy when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('index.html')))
  );
});
