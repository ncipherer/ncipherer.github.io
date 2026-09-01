/*
 * encipherer's whispers — offline service worker
 *
 * Strategy:
 *   1. On install: pre-cache the app shell (HTML, critical JS/CSS, notes.json).
 *   2. On fetch:   cache-first for same-origin static assets; network-first
 *      for navigation requests (SPA fallback to cached index.html); stale-
 *      while-revalidate for dynamically fetched markdown notes.
 */

const CACHE_NAME = "whispers-v1";
const SHELL_CACHE = "whispers-shell-v1";

// App shell assets to pre-cache on install (paths relative to scope).
const PRECACHE = [
  "/",
  "/notes",
  "/data/notes.json",
];

/**
 * Install: pre-cache the app shell.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/**
 * Activate: clean up old caches.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/**
 * Fetch handler — different strategies per request type.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Navigation requests: network-first, fallback to cached index.html (SPA)
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first
  if (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.match(/\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot)$/)
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Note markdown content & data JSON: stale-while-revalidate
  if (
    url.pathname.startsWith("/data/") &&
    (url.pathname.endsWith(".md") || url.pathname.endsWith(".json"))
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Audio samples: cache-first (small, rarely change)
  if (url.pathname.startsWith("/data/audio/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

/* ── Strategies ──────────────────────────────────────────────────── */

/** Cache-first: serve from cache, fall back to network and cache the response. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/** Network-first: try network, fall back to cache, then offline page. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/**
 * Network-first with SPA fallback: for navigation requests, try the network
 * first. If offline, serve the cached index.html so the SPA router can render.
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Serve the cached shell so the SPA router handles the path
    const cached = await caches.match("/");
    return cached || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately, update cache in
 * background. Perfect for note content that rarely changes.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}
