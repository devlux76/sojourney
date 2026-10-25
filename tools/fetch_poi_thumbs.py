"""Fill references/ with the highest-res Commons files, politely (background-safe).

For each wanted file (from the 2026-10-02 cache CSVs):
 - orig width >= 2560 (or unknown): 2560px thumb (a listed size)
 - else: the upload.wikimedia.org original (hash path taken from the thumb URL)
One file per 15 s, single curl, 2 retries. Skips files already present >50KB.
No API calls, no page scraping.
Usage: nohup python3 tools/fetch_poi_thumbs.py > /tmp/opencode/thumbs.log 2>&1 &
"""
import csv
import os
import subprocess
import time
import urllib.parse

CACHE_DIR = "tools/.cache/reference/crater-lake/places"
OUT_ROOT = "references"
SLEEP = 15
UA = "SojourneyResearch/1.0 (game art-direction reference; one file per 15s)"

WANTED = {
    "cleetwood-cove/great-light-along-crater-lake-northern-rim-3062928123.jpg": "cleetwood-cove",
    "cleetwood-cove/pumice-and-plants-along-crater-lake-northern-rim-3063765428.jpg": "cleetwood-cove",
    "cleetwood-cove/pumice-and-plants-along-crater-lake-northern-rim-3063765776.jpg": "cleetwood-cove",
    "llao-rock/crater-lake-llao-rock-4106190116.jpg": "llao-rock",
    "llao-rock/crater-lake-national-park-or-2006-6539570785.jpg": "llao-rock",
    "llao-rock/crater-lake-view-from-llao-rock-4106190378.jpg": "llao-rock",
    "llao-rock/crater-lake-north-rim-llao-rock-or-2013.jpg": "llao-rock",
    "llao-rock/crater-lake-in-oregon-in-2011-3.jpg": "llao-rock",
    "devils-backbone/devil-s-backbone-crater-lake-national-park-panoramio.jpg": "devils-backbone",
    "wizard-island/approaching-wizard-island-4106192788.jpg": "wizard-island",
    "wizard-island/boat-on-crater-lake-oregon-4105428335.jpg": "wizard-island",
    "wizard-island/crater-lake-s-wizard-island.jpg": "wizard-island",
    "wizard-island/wizard-island-crater-lake-n-p-06-15517696849.jpg": "wizard-island",
    "wizard-island/view-inside-crater-of-wizard-island-on-crater-lake-01.jpg": "wizard-island",
    "wizard-island/panorama-from-rim-of-crater-of-wizard-island.jpg": "wizard-island",
    "wizard-island/wizard-island-trail-on-slope-of-cinder-cone.jpg": "wizard-island",
    "wizard-island/crater-lake-and-wizard-island-early-spring.jpg": "wizard-island",
    "wizard-island/hiking-to-top-of-wizard-island-4106193696.jpg": "wizard-island",
    "phantom-ship/view-of-the-phantom-ship-in-crater-lake-oregon-3387076737.jpg": "phantom-ship",
    "phantom-ship/phantom-ship-and-tourist-ship-sun-notch-trail-crater-lake-national-park-oregon-219372119.jpg": "phantom-ship",
    "phantom-ship/the-phantom-ship-at-crater-lake-49750570083.jpg": "phantom-ship",
    "phantom-ship/b-w-phantom-ship-crater-lake-national-park-20421442508.jpg": "phantom-ship",
    "phantom-ship/crater-lake-phantom-ship-7983109630.jpg": "phantom-ship",
    "pumice-castle/crater-lake-national-park-or-pumice-castle-from-rim-drive-turnoff.jpg": "pumice-castle",
    "pumice-castle/pumice-castle-crater-lake-national-park-oregon-219302298.jpg": "pumice-castle",
}


def load_lookup():
    lookup = {}
    for name in ("SOURCES.csv", "SOURCES_commons_search.csv"):
        with open(os.path.join(CACHE_DIR, name), newline="") as f:
            for row in csv.DictReader(f):
                key = row.get("file", "")
                short = key.replace("places/", "") if key.startswith("places/") else key
                lookup.setdefault(short, row)
                lookup.setdefault(os.path.basename(key), row)
    return lookup


def thumb_url(row):
    for v in row.values():
        if v and "thumb.wikimedia.org" in v:
            return v.split("?")[0]
    return None


def main():
    lookup = load_lookup()
    for local, subdir in WANTED.items():
        stem = os.path.basename(local).rsplit(".", 1)[0] + ".jpg"
        dest = os.path.join(OUT_ROOT, subdir, stem)
        if os.path.exists(dest) and os.path.getsize(dest) > 50000:
            print(f"HAVE {dest}", flush=True)
            continue
        meta = lookup.get(local) or lookup.get(os.path.basename(local))
        if meta is None:
            print(f"SKIP (no metadata): {local}", flush=True)
            continue
        base = thumb_url(meta)
        if not base:
            print(f"SKIP (no URL): {local}", flush=True)
            continue
        try:
            orig_w = int(float(meta.get("orig_w") or 0))
        except ValueError:
            orig_w = 0
        if orig_w >= 2560 or orig_w == 0:
            import re
            url = re.sub(r"/\d+px-", "/2560px-", base)
            # unscaled originals have no width segment; keep as-is (full original)
            if url == base and "/thumb/" not in base:
                url = base
        else:
            # original is smaller than 2560: fetch the original itself.
            # thumb path: .../thumb/<h>/<hh>/<filename>/<w>px-<filename>
            m = base.split("/thumb/", 1)
            if len(m) == 2:
                rest = m[1].split("/", 3)
                if len(rest) == 4:
                    url = f"https://upload.wikimedia.org/wikipedia/commons/{rest[0]}/{rest[1]}/{rest[2]}"
                else:
                    url = base
            else:
                url = base
        # filename on Commons keeps spaces/parens escaped; restore for hash check
        print(f"GET {os.path.basename(dest)}\n  <- {url}", flush=True)
        ok = False
        tries = [(url, 3)]
        if "/2560px-" in url:
            # unknown/small originals: fall back to the known-good 1280px size
            tries.append((url.replace("/2560px-", "/1280px-"), 1))
        for url_try, retries in tries:
            # polite: fresh TCP each time, browser-ish UA, rate naturally limited
            for attempt in range(retries):
                r = subprocess.run(["curl", "-sL", "--max-time", "180", "-A", UA,
                                    "-o", dest, url_try], capture_output=True, text=True)
                if r.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 50000:
                    # reject Wikimedia error pages
                    with open(dest, "rb") as f:
                        head = f.read(200)
                    if b"<html" in head.lower() or b"<!doctype" in head.lower():
                        print(f"  {url_try.split('/')[-1][:40]} attempt{attempt}: error page, retrying", flush=True)
                        os.remove(dest)
                        time.sleep(30)
                        continue
                    ok = True
                    break
                print(f"  attempt{attempt} rc={r.returncode}", flush=True)
                time.sleep(30)
            if ok:
                break
        if ok:
            print(f"  OK {os.path.getsize(dest)//1024}KB", flush=True)
        else:
            print("  FAIL", flush=True)
            if os.path.exists(dest):
                os.remove(dest)
        time.sleep(SLEEP)


if __name__ == "__main__":
    main()
