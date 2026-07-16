// sw.js – service worker for offline-brug.
// App-skallen caches (cache-first). Vejr-API'et hentes network-first med cache-fallback.

const CACHE = "fiskeodds-v19";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/config.js",
  "./js/species.js",
  "./js/weather.js",
  "./js/scoring.js",
  "./js/grej.js",
  "./js/fishart.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Open-Meteo: network-first
  if (url.hostname.endsWith("open-meteo.com")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 3D-modeller (.glb): cache efter første hentning, så de virker offline bagefter.
  if (url.pathname.endsWith(".glb")) {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((res) => {
          if (e.request.method === "GET") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // App-skal (HTML/JS/CSS/ikoner): NETWORK-FIRST.
  // Online -> altid nyeste version. Offline -> fald tilbage til cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (e.request.method === "GET" && res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
