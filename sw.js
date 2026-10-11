// Service Worker der Atemschutzüberwachung: App offline verfügbar machen, Texterkennung nach erstem Laden im Cache.
const CACHE = 'asue-v59';
const SHELL = ['./', './index.html', './sammeln.html', './benutzer.js', './asue-config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './geraete.webmanifest', './atemschutz.webmanifest', './icon-geraete-192.png', './icon-geraete-512.png', './icon-atemschutz-192.png', './icon-atemschutz-512.png', './wappen/flecken-aerzen.png', './wappen/reinerbeck.png', './wappen/dehmke.png', './wappen/gellersen.png', './wappen/griessem.png', './wappen/gross-berkel.png', './wappen/grupenhagen.png', './wappen/herkendorf.png', './wappen/reher.png'];
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
// ab 5.5: Benachrichtigungen der Datenbank-Apps (Gerätedatenbank / Atemschutz-Datenbank)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titel: 'Datenbank', text: e.data ? e.data.text() : '' }; }
  const geraete = String(d.url || '').startsWith('/geraete');
  const icon = geraete ? '/icon-geraete-192.png' : '/icon-atemschutz-192.png';
  e.waitUntil(self.registration.showNotification(d.titel || (geraete ? 'Gerätedatenbank' : 'Atemschutz-Datenbank'), {
    body: d.text || '', tag: d.tag || d.art || 'db', renotify: true, lang: 'de', icon, badge: icon,
    vibrate: d.art === 'schaden' ? [300, 150, 300] : [200], timestamp: d.t || Date.now(),
    requireInteraction: d.art === 'schaden', data: { url: d.url || '/atemschutz' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = new URL((e.notification.data && e.notification.data.url) || '/atemschutz', self.location.origin).href;
  e.waitUntil((async () => {
    const liste = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = liste.find((x) => x.url.split('?')[0].split('#')[0] === ziel);
    if (c) return c.focus();
    return self.clients.openWindow(ziel);
  })());
});
