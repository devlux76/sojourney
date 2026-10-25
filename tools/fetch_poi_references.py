"""Download high-res reference originals from Wikimedia Commons for Sojourney POIs.

Resolves each wanted file (from the 2026-10-02 reference-imagery cache's two
CSVs) to its Commons File: title, then downloads via Special:Redirect/file at
width=2560 (Commons returns the original when it is smaller). This uses the
thumbnail service as Commons asks, with a 3 s delay between requests.

Writes references/SOURCES.csv manifest (author/licence/dimensions) for
RESEARCH.md + CREDITS.
Usage: python3 tools/fetch_poi_references.py
"""
import csv
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "SojourneyResearch/1.0 (reference-photo fetch for game art direction)"
CACHE_DIR = "tools/.cache/reference/crater-lake/places"
OUT_ROOT = "references"
WIDTH = 2560
DELAY = 3

# cache-relative path -> (references subdir, note on what it shows)
WANTED = {
    "cleetwood-cove/boat-launch-at-cleetwood-cove-with-the-old-man-of-the-lake-to-the-left-4105429577.jpg": (
        "cleetwood-cove", "Boat-level view at the Cleetwood Cove launch; Old Man of the Lake log at left."),
    "cleetwood-cove/crater-lake-np-or-cleetwood-cove-8-28-13-9859608395.jpg": (
        "cleetwood-cove", "Cleetwood Cove from the water, late August."),
    "cleetwood-cove/great-light-along-crater-lake-northern-rim-3062928123.jpg": (
        "cleetwood-cove", "North-rim wall in low light; rock colour and banding."),
    "cleetwood-cove/pumice-and-plants-along-crater-lake-northern-rim-3063765428.jpg": (
        "cleetwood-cove", "Ground close-up: pumice rubble and plants, north rim."),
    "cleetwood-cove/pumice-and-plants-along-crater-lake-northern-rim-3063765776.jpg": (
        "cleetwood-cove", "Ground close-up: pumice rubble and plants, north rim, second angle."),
    "cleetwood-cove/crater-lake-national-park-hcp-october-13-2022-054-cleetwood-cove-trail.jpg": (
        "cleetwood-cove", "Cleetwood Cove trail and lake overlook, October."),
    "llao-rock/crater-lake-llao-rock-4106190116.jpg": (
        "llao-rock", "Llao Rock flow front from the lake, August."),
    "llao-rock/crater-lake-llao-rock.jpg": (
        "llao-rock", "Llao Rock from across the lake (Don Henise)."),
    "llao-rock/crater-lake-national-park-or-2006-6539570785.jpg": (
        "llao-rock", "Llao Rock multi-picture set, August 2006."),
    "llao-rock/crater-lake-view-from-llao-rock-4106190378.jpg": (
        "llao-rock", "Reverse angle: the lake seen from Llao Rock."),
    "llao-rock/crater-lake-north-rim-llao-rock-or-2013.jpg": (
        "llao-rock", "East aspect of Llao Rock (Don Graham, 2013)."),
    "llao-rock/crater-lake-in-oregon-in-2011-3.jpg": (
        "llao-rock", "Llao Rock wall, 2011."),
    "devils-backbone/devil-s-backbone-crater-lake-national-park-panoramio.jpg": (
        "devils-backbone", "Devils Backbone from the lake (panoramio)."),
    "wizard-island/approaching-wizard-island-4106192788.jpg": (
        "wizard-island", "Boat approach to Wizard Island, August."),
    "wizard-island/boat-on-crater-lake-oregon-4105428335.jpg": (
        "wizard-island", "Tour boat on the lake near Wizard Island."),
    "wizard-island/crater-lake-s-wizard-island.jpg": (
        "wizard-island", "Wizard Island cone from the water."),
    "wizard-island/wizard-island-crater-lake-n-p-06-15517696849.jpg": (
        "wizard-island", "Wizard Island, June (early season; compare snow)."),
    "wizard-island/view-inside-crater-of-wizard-island-on-crater-lake-01.jpg": (
        "wizard-island", "Inside the Witches Cauldron crater, first angle."),
    "wizard-island/panorama-from-rim-of-crater-of-wizard-island.jpg": (
        "wizard-island", "Panorama from the crater rim (Witches Cauldron)."),
    "wizard-island/wizard-island-trail-on-slope-of-cinder-cone.jpg": (
        "wizard-island", "Ground close-up: cinder trail on the cone slope."),
    "wizard-island/crater-lake-and-wizard-island-early-spring.jpg": (
        "wizard-island", "Early-spring snow cover for snow-vs-rock comparison."),
    "wizard-island/hiking-to-top-of-wizard-island-4106193696.jpg": (
        "wizard-island", "Hiking the cone slope, August; cinder colour."),
    "phantom-ship/phantom-ship-crater-lake-national-park-15176204199.jpg": (
        "phantom-ship", "Phantom Ship close-up (Slobirdr, Sept)."),
    "phantom-ship/view-of-the-phantom-ship-in-crater-lake-oregon-3387076737.jpg": (
        "phantom-ship", "Historic Gifford Collection view (OSU, no restrictions)."),
    "phantom-ship/phantom-ship-and-tourist-ship-sun-notch-trail-crater-lake-national-park-oregon-219372119.jpg": (
        "phantom-ship", "Phantom Ship with tour boat alongside for scale."),
    "phantom-ship/the-phantom-ship-at-crater-lake-49750570083.jpg": (
        "phantom-ship", "Phantom Ship, recent high-res view."),
    "phantom-ship/b-w-phantom-ship-crater-lake-national-park-20421442508.jpg": (
        "phantom-ship", "Black-and-white rendering; reads form without colour."),
    "phantom-ship/crater-lake-phantom-ship-7983109630.jpg": (
        "phantom-ship", "Phantom Ship from the water."),
    "pumice-castle/crater-lake-national-park-or-pumice-castle-from-rim-drive-turnoff.jpg": (
        "pumice-castle", "Pumice Castle from the Rim Drive turnoff."),
    "pumice-castle/pumice-castle-crater-lake-national-park-oregon-219302298.jpg": (
        "pumice-castle", "Pumice Castle wall detail."),
}


def load_lookup():
    lookup = {}
    for name in ("SOURCES.csv", "SOURCES_commons_search.csv"):
        path = os.path.join(CACHE_DIR, name)
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                key = row.get("file", "")
                # search CSV keys are like places/rim-village/foo.jpg; index by basename folder
                short = key.replace("places/", "") if key.startswith("places/") else key
                lookup.setdefault(short, row)
                lookup.setdefault(os.path.basename(key), row)
    return lookup


def file_title(page_url):
    m = re.search(r"File%3A(.+)$", page_url)
    return "File:" + urllib.parse.unquote(m.group(1)) if m else None


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())


def main():
    lookup = load_lookup()
    os.makedirs(OUT_ROOT, exist_ok=True)
    manifest = []
    # keep already-downloaded rows
    manifest_path = os.path.join(OUT_ROOT, "SOURCES.csv")
    done = set()
    if os.path.exists(manifest_path):
        with open(manifest_path, newline="") as f:
            for row in csv.DictReader(f):
                manifest.append(row)
                done.add(row["file"])
    for local, (subdir, note) in WANTED.items():
        stem = os.path.basename(local).rsplit(".", 1)[0] + ".jpg"
        rel = os.path.join(subdir, stem)
        if rel in done or os.path.exists(os.path.join(OUT_ROOT, rel)):
            print(f"HAVE {rel}", flush=True)
            continue
        meta = lookup.get(local) or lookup.get(os.path.basename(local))
        if meta is None:
            print(f"SKIP (no metadata): {local}", flush=True)
            continue
        title = file_title(meta.get("page_url", ""))
        if not title:
            print(f"SKIP (no File title): {local}", flush=True)
            continue
        url = ("https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/"
               + urllib.parse.quote(title.split(":", 1)[1]) + f"&width={WIDTH}")
        dest = os.path.join(OUT_ROOT, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        for attempt in range(4):
            try:
                download(url, dest)
                break
            except Exception as e:
                print(f"TRY{attempt} FAIL {title}: {e}", flush=True)
                time.sleep(10 * (attempt + 1))
        else:
            continue
        try:
            from PIL import Image
            w, h = Image.open(dest).size
        except Exception:
            w, h = meta.get("orig_w", ""), meta.get("orig_h", "")
        size = os.path.getsize(dest)
        print(f"OK {w}x{h} {size//1024}KB -> {rel}", flush=True)
        manifest.append({"file": rel, "commons_page": meta.get("page_url", ""),
                         "author": meta.get("author", ""), "date": meta.get("date_taken", ""),
                         "licence": meta.get("licence_as_stated_on_Commons", meta.get("licence", "")),
                         "width": w, "height": h, "note": note})
        with open(manifest_path, "w", newline="") as f:
            w_ = csv.DictWriter(f, fieldnames=["file", "commons_page", "author", "date", "licence", "width", "height", "note"])
            w_.writeheader()
            w_.writerows(manifest)
        time.sleep(DELAY)
    print(f"manifest: {len(manifest)} rows")


if __name__ == "__main__":
    sys.exit(main())
