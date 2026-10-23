const V = 'spotcast-v5';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'stations.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {mode: u.startsWith('http') ? 'cors' : 'same-origin'})).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![V, 'spotcast-tiles', 'spotcast-data'].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(name, max){ const c = await caches.open(name); const ks = await c.keys(); for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]); }
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const isTile = /arcgisonline\.com\/ArcGIS\/rest\/services\/.*\/tile\//.test(r.url) || r.url.includes('/exportImage?');
  const isData = /weather\.gov|tidesandcurrents\.noaa\.gov|gis\.myfwc\.com|services1\.arcgis\.com|geocode\.arcgis\.com|nominatim/.test(u.host);
  if (isTile){
    e.respondWith(caches.open('spotcast-tiles').then(async c => { const hit = await c.match(r); if (hit) return hit;
      const res = await fetch(r); if (res.ok || res.type === 'opaque'){ c.put(r, res.clone()); if (Math.random() < .05) trim('spotcast-tiles', 2500); } return res; }));
    return;
  }
  if (isData){
    e.respondWith(fetch(r).then(res => { if (res.ok){ const cl = res.clone(); caches.open('spotcast-data').then(c => { c.put(r, cl); if (Math.random() < .1) trim('spotcast-data', 300); }); } return res; })
      .catch(() => caches.match(r).then(m => m || Response.error())));
    return;
  }
  if (u.origin === location.origin){
    e.respondWith(fetch(r).then(res => { const cl = res.clone(); caches.open(V).then(c => c.put(r, cl)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cl = res.clone(); caches.open(V).then(c => c.put(r, cl)); return res; })));
});
