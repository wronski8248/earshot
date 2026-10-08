// Earshot offline support.
// Keeps a copy of the app on the phone so it opens without internet.
const VERSION = "earshot-v6";
const APP_FILES = [
  "./", "index.html", "manifest.webmanifest",
  "jszip.min.js", "pdf.min.js", "pdf.worker.min.js",
  "literata.woff2", "literata-italic.woff2", "bricolage.woff2", "plex-mono-400.woff2", "plex-mono-500.woff2",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png",
  "safari-fixes.js", "voice-worker.js"
];
// Large files for the AI voice: saved the first time they're used, then never re-downloaded.
const BIG = /\.(wasm|mjs)$|kokoro\.web\.js$/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = new Set([VERSION, "earshot-ai-runtime", "transformers-cache", "kokoro-voices"]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) { return res; }

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (BIG.test(url.pathname)) {
    // cache first: these files are big and only change when the app is updated
    e.respondWith((async () => {
      const c = await caches.open("earshot-ai-runtime");
      const key = req.url;
      let res = await c.match(key);
      if (!res) {
        res = await fetch(req);
        if (res.ok) await c.put(key, res.clone());
      }
      return isolate(res);
    })());
    return;
  }

  // everything else: get the newest copy when online (so fixes arrive right away),
  // and fall back to the saved copy when offline or the network is very slow
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([
        fetch(req, { cache: "no-cache" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 5000))
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const saved = await cache.match(req, { ignoreSearch: true });
      if (saved) return saved;
      if (req.mode === "navigate") { const home = await cache.match("index.html"); if (home) return home; }
      return Response.error();
    }
  })());
});
