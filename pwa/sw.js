// Snapback service worker. Built by the `serviceWorker` plugin in vite.config.ts,
// which fills in VERSION and PRECACHE (every file of the build).
// It only caches the app itself: your photos and videos never go through here.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `snapback-${VERSION}`;
// Servers often send `Vary: Origin` or `Vary: Accept-Encoding`, which would make module
// requests (sent with an Origin header) miss the precached copies.
const MATCH = { ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("snapback-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first so updates show up, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((c) => c.put("./", response.clone()));
          return response;
        })
        .catch(async () => (await caches.match("./", MATCH)) ?? (await caches.match("index.html", MATCH)) ?? Response.error()),
    );
    return;
  }

  // Hashed assets, icons, fonts: cache first.
  event.respondWith(
    caches.match(request, MATCH).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
