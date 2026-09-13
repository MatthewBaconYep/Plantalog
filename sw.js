// Plantalog service worker: serve the app page instantly at launch.
//
// A Home Screen launch on a phone waited ~350ms for index.html from the
// network before the first paint, and iOS faded its launch image toward white
// while it waited (a two-to-five frame flash in screen recordings). This
// answers page loads from a local copy immediately and refreshes that copy in
// the background, so the next launch has the latest page.
//
// Scope is deliberately narrow: only top-level page loads of "/" (or
// /index.html). Scripts, images, version.txt, Supabase and every other request
// pass straight through to the network. Updates still arrive the usual way:
// the page's version check reloads to "/?v=<version>", which always goes to the
// network (and refreshes the copy).

const CACHE = "plantalog-page-v1";
const PAGE = "/";

function isAppPage(url) {
  return url.origin === self.location.origin &&
         (url.pathname === "/" || url.pathname === "/index.html");
}

async function refresh(cache) {
  const res = await fetch(PAGE, { cache: "no-store" });
  if (res && res.ok) await cache.put(PAGE, res.clone());
  return res;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await refresh(cache); } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (!isAppPage(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // An update reload (?v=) or anything without a saved copy: network first.
    if (url.searchParams.has("v")) {
      try { return await refresh(cache); } catch (e) {}
    }
    const saved = await cache.match(PAGE);
    if (saved) {
      event.waitUntil(refresh(cache).catch(() => {}));
      return saved;
    }
    try { return await refresh(cache); } catch (e) { return Response.error(); }
  })());
});
