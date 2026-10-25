self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes("/packs/") || event.request.headers.has("x-pack-download")) return;
  if (url.pathname.endsWith("/files.json")) {
    event.respondWith(fetch(event.request).catch(async () => (await fromPackCaches(event.request)) ?? Response.error()));
    return;
  }
  event.respondWith((async () => (await fromPackCaches(event.request)) ?? fetch(event.request))());
});

async function fromPackCaches(request) {
  for (const name of await caches.keys()) {
    if (!name.startsWith("pack-")) continue;
    const hit = await (await caches.open(name)).match(request);
    if (hit) return hit;
  }
  return undefined;
}
