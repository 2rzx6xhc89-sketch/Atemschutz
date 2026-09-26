// Service Worker der Atemschutzüberwachung: App offline verfügbar machen, Texterkennung nach erstem Laden im Cache.
const CACHE = 'asue-v28';
const SHELL = ['./', './index.html', './benutzer.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './wappen/flecken-aerzen.png', './wappen/reinerbeck.png', './wappen/dehmke.png', './wappen/gellersen.png', './wappen/griessem.png', './wappen/gross-berkel.png', './wappen/grupenhagen.png', './wappen/herkendorf.png', './wappen/reher.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE && x.startsWith('asue-')).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com');
  if (!cacheable) return;
  if (url.origin === location.origin && url.pathname.includes('/api/')) return; // Live-Daten nie aus dem Cache
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; }).catch(() => hit);
    return url.origin === location.origin ? (net.then(r => r || hit)) : (hit || net);
  }));
});
