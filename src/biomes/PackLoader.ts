// Keep cache hits separate from network bytes so they advance progress without inflating the ETA.
export interface LoadProgress { loaded: number; total: number; networkLoaded: number }
interface FilesManifest { version: string; files: { path: string; bytes: number }[] }

const cacheName = (id: string, version: string) => `pack-${id}-${version}`;
const markerUrl = (id: string) => `packs/${id}/files.json`;

async function fetchManifest(id: string): Promise<FilesManifest> {
  const response = await fetch(`packs/${id}/files.json`);
  return response.json();
}

export async function packSizeBytes(id: string): Promise<number> {
  const manifest = await fetchManifest(id);
  return manifest.files.reduce((sum, f) => sum + f.bytes, 0);
}

export async function isPackCached(id: string): Promise<boolean> {
  if (!("caches" in globalThis)) return false;
  const manifest = await fetchManifest(id);
  const cache = await caches.open(cacheName(id, manifest.version));
  return (await cache.match(markerUrl(id))) !== undefined;
}

export async function loadPack(id: string, onProgress: (p: LoadProgress) => void): Promise<void> {
  if (!("caches" in globalThis)) return;
  const manifest = await fetchManifest(id);
  const cache = await caches.open(cacheName(id, manifest.version));
  const total = manifest.files.reduce((sum, f) => sum + f.bytes, 0);
  let loaded = 0;
  let networkLoaded = 0;
  onProgress({ loaded, total, networkLoaded });
  for (const file of manifest.files) {
    const url = `packs/${id}/${file.path}`;
    if (await cache.match(url)) {
      loaded += file.bytes;
      onProgress({ loaded, total, networkLoaded });
      continue;
    }
    const response = await fetch(url, { headers: { "x-pack-download": "1" } });
    if (!response.ok || !response.body) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value.slice().buffer);
      loaded += value.byteLength;
      networkLoaded += value.byteLength;
      onProgress({ loaded, total, networkLoaded });
    }
    await cache.put(url, new Response(new Blob(chunks), { headers: response.headers }));
  }
  await cache.put(markerUrl(id), new Response(JSON.stringify(manifest)));
  for (const name of await caches.keys())
    if (name.startsWith(`pack-${id}-`) && name !== cacheName(id, manifest.version)) await caches.delete(name);
}
