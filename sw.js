// Earshot offline support.
// Keeps a copy of the app on the phone so it opens without internet, and turns on
// "cross-origin isolation" so the AI voice can use several processor cores.
const VERSION = "earshot-v2";
const APP_FILES = [
  "./", "index.html", "manifest.webmanifest",
  "jszip.min.js", "pdf.min.js", "pdf.worker.min.js",
  "literata.woff2", "literata-italic.woff2", "bricolage.woff2", "plex-mono-400.woff2", "plex-mono-500.woff2",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"
];
// Large files for the AI voice: saved the first time they're used, then never re-downloaded.
const BIG = /\.(wasm|mjs)$|kokoro\.web\.js$|voice-worker\.js$/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keep = new Set([VERSION, "earshot-ai-runtime", "transformers-cache", "kokoro-voices"]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) {
  if (!res || res.type === "opaque" || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (BIG.test(url.pathname)) {
    // cache first: these files are big and only change when the app is updated
    e.respondWith((async () => {
      const c = await caches.open("earshot-ai-runtime");
      const key = url.pathname.endsWith("voice-worker.js") ? req.url + "#" + VERSION : req.url;
      let res = await c.match(key);
      if (!res) {
        res = await fetch(req);
        if (res.ok) await c.put(key, res.clone());
      }
      return isolate(res);
    })());
    return;
  }

  // everything else: show the saved copy right away and refresh it in the background
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const saved = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (saved) { e.waitUntil(fresh); return isolate(saved); }
    const res = (await fresh) || (req.mode === "navigate" ? await cache.match("index.html") : null);
    return res ? isolate(res) : Response.error();
  })());
});
