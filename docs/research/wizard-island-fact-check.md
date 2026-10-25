# Wizard Island — Surface Detail Fact-Check (Sept 2026)

Context: a pasted AI-generated brief proposed materials/flora/fauna for building out Wizard Island beyond its current state (heightmap + random tree scatter). This doc checks that brief against primary sources — NPS, USGS, and the Crater Lake Institute's archival *Nature Notes* (1930s–40s field observations, which turned out to be the strongest ground truth available) — keeps what holds up, fixes what's wrong, cuts what's invented, and adds detail the brief missed. Cross-reference `surface-data-layers.md` and `source-registry.md` for the data-layer pipeline this feeds.

**Verdict:** the brief's structure and most specifics are solid — better sourced than the average AI summary. Three items are hallucinated or unsupported (a named/endemic "Wizard Island Toad," a specific lone cottonwood tree, and "mountain ocean spray"), one is a real but mislabeled material (the lava is block lava, not A'a), and a few species need swapping or aren't confirmed for the island specifically. Confirmed details below are footnoted to primary sources so they can go straight into the source registry.

---

## 1. Terrain & Materials

### Cinder cone — mostly confirmed

| Claim | Verdict | Correction / detail |
|---|---|---|
| Symmetrical cinder cone, 763 ft above the lake | **Confirmed** | Matches Crater Lake Institute and the Howell Williams (1942) geologic account, and the project's existing `surface-data-layers.md` note. |
| Composed of loose scoria, ash, cinders | **Confirmed, refine** | Howell Williams: "black, scoriaceous lapilli and blocks," with true fine ash "notably scarce" — it's chunkier than "ash" implies. Bombs near the base reach 2 ft across; blocks on the crater rim exceed 6 ft. |
| Dark reddish-brown to black color | **Corrected** | Primary sources describe the cone as predominantly **black**, with **red and brown material concentrated near the summit** — not a uniform reddish-brown-to-black gradient down the whole slope. Use black scoria as the base material and blend in red/brown oxidized scoria only in the upper third, near the rim. |
| 35° angle of repose, unstable "shifting sand" footing | **Confirmed exactly** | 1930s Nature Notes: "the angle of slope of the cone is as much as thirty-five degrees." Good physics target as-is. |
| Only ~2% of the cone shows above water | **Missed — add** | NPS: Wizard Island is the exposed tip of an edifice that rises **over 2,700 ft from the caldera floor**; the visible cone is a small fraction of the whole volcano. Doesn't change surface assets, but useful for scale/story text and for any underwater terrain pass later. |

### Base lava fields — real feature, wrong lava type

| Claim | Verdict | Correction / detail |
|---|---|---|
| Dark, jagged **A'a** lava at the base | **Mislabeled — fix** | Every primary source (Howell Williams 1942, NPS) calls this **block lava** (blocky andesite), not A'a. NPS's own explainer on lava morphology notes block lava has **smoother-sided blocks** than a'a's rough clinkery surface, even though it's still sharp-edged and jagged at block scale. Howell Williams specifically describes the flow surface as "angular block lava" with "smooth, glassy skins" on individual blocks up to 30 ft across — the opposite of a'a's rough, friable texture. Use a blocky/angular rock material (high roughness at the macro scale, but individual block faces can be smoother/slightly glossy) rather than an a'a clinker shader. This matches what `surface-data-layers.md` already has right (it says "blocky andesite lava flows"). |
| Dark gray to charcoal-black, high roughness, low reflectivity | **Confirmed** | Consistent with all sources; keep this part. |
| Missing: flow shape detail | **Add** | Post-cone flows extend roughly half a mile **westward** from the cone (not a uniform ring — there's a dominant lobe), with a wavy surface of **concentric pressure ridges up to 60 ft high** separated by troughs. Rainwater collects in some troughs as small pools. This gives you a real macro-terrain feature (ridged flow lobe) rather than flat "lava apron" geometry. |

### Summit crater ("Witches Cauldron") — confirmed

| Claim | Verdict | Correction / detail |
|---|---|---|
| ~90 ft deep, ~300 ft wide | **Confirmed** | Matches Howell Williams (1942) almost exactly: "approximately 300 feet across and 90 feet deep." (Wikipedia gives a looser ~500 ft × 100 ft; the geologic source is more precise and is what to build to.) |
| Interior: finer soil and scree, small plants rooted in | **Confirmed, more specific available** | Crater Lake Institute's Wizard Island trail page names the actual interior flora: **grasses, sedges, rushes, and Tolmie's saxifrage** (*Saxifraga tolmiei*) where soil/moisture are best. Use that instead of a generic "small plants" scatter for the crater floor. |

---

## 2. Flora

| Claim | Verdict | Correction / detail |
|---|---|---|
| Mountain Hemlock as dominant lower-slope conifer | **Corrected** | Primary sources (1930s Nature Notes and the Crater Lake Institute trail page) both say **Western Hemlock** (*Tsuga heterophylla*, historically cited as *T. mertensiana* in one source — check against current NPS taxonomy) "predominates on the lower half of the island." Mountain hemlock is common on the caldera rim generally but isn't what's documented as dominant on Wizard Island itself. |
| Whitebark Pine at the summit/rim | **Confirmed** | Both sources agree it dominates the upper elevations and "characteristically encircles the crested rim" of the crater — this is your rim-silhouette tree. |
| Lodgepole Pine, Shasta Red Fir present | **Unconfirmed for the island specifically** | Both occur in the wider park at comparable elevations and are plausible, but no source found actually places them on Wizard Island — the island-specific lists (historical and current) only name western hemlock and whitebark pine as the two dominant conifers. Treat as optional/low-density set dressing rather than a confirmed core species, unless the NPS Vegetation Mapping geodatabase (already in `surface-data-layers.md`) shows polygons on the island. |
| Solitary deciduous cottonwood on the western shore, scarlet in autumn | **Likely hallucinated — cut or caveat hard** | No primary source places a cottonwood on Wizard Island. NPS's tree list for the park does place black cottonwood "along Crater Lake's western shore" — but that's almost certainly the **caldera's** west shore (mainland, near the rim), not Wizard Island's. This looks like source conflation. Cut it, or if you want the visual beat, place it on the caldera rim's west side instead of on the island. |
| Ground cover: "mountain ocean spray" | **Likely fabricated name — cut** | No source uses this term for anything on Wizard Island. The real PNW native shrub is **oceanspray** (*Holodiscus discolor*, no "mountain"), but no source confirms it on the island either. Don't invent a name; if you want a low shrub here, verify against the NPS Vegetation Mapping geodatabase first. |
| Fireweed along the shoreline | **Confirmed** | Named directly in the 1930s Nature Notes as a lower-elevation flowering plant on the island. |
| Indian Paintbrush near the summit | **Confirmed, more specific available** | The actual documented species are **Applegate's paintbrush** and **spider-web paintbrush** (both *Castilleja*) at upper elevations — "Indian paintbrush" as a common name is directionally right (same genus) but swap in the real species names if you want label-level accuracy. |
| Missed — add | | Lower-elevation companions actually documented: **bleeding heart**, **mountain ash**, and several **Arnica** species. Upper-elevation companions: **mountain daisy** and an unidentified "silver plant." Total island flora is small and specific: roughly **60 species**, two-thirds of which are trees/shrubs/perennials — useful as a hard cap on scatter-asset variety so it doesn't read as over-planted. All of it arrived by wind, water, birds, or driftwood across the ~350-yard channel from the caldera wall — and notably, several mainland species still haven't made the crossing, so the island should look visibly less diverse than the adjacent crater wall, not just smaller. |

---

## 3. Fauna

| Claim | Verdict | Correction / detail |
|---|---|---|
| Golden-mantled ground squirrels ("look like chipmunks, no facial stripes") | **Confirmed**, and the distinguishing detail is correct | Documented on the island (1930s Nature Notes, as *Callospermophilus chrysodeirus*); the no-facial-stripes tell vs. chipmunks is accurate. |
| Klamath chipmunks | **Confirmed** | Directly documented. |
| Pikas | **Confirmed**, old naming | Documented under the historical name "brown coney" (*Ochotona princeps brunnescens*) — same animal, pika is the current common name. Rock-crevice behavior as described is accurate. |
| Mazama red-backed mice under fallen logs | **Confirmed presence**, behavior detail unsourced | Species documented on the island; the "hiding under fallen logs" behavior wasn't in the source but is plausible for the species generally — fine as flavor, just not a cited fact. |
| Missing — add | | **Allen's chipmunk** and plain **deer mouse** are also documented on the island alongside Klamath chipmunk — round out the small-mammal roster with these two. |
| "Wizard Island Toad" — a distinct/endemic population | **Hallucinated — cut the name and status claim** | The real source (Crater Lake Institute's Frank Lang nature note) documents ordinary **western toads** (*Anaxyrus/Bufo boreas*) found on the island — three individuals, with the author himself wondering how they got there. Nothing in that source or any other calls them a distinct or endemic population, or gives them a unique name. Use "western toad" and treat their presence as a minor mystery/detail (they likely overwinter in lava-rock crevices), not a unique subspecies. |
| Missing — add (real, and better than what's in the brief) | | **Melanistic garter snakes**: documented dark-phase common garter snakes (*Thamnophis sirtalis fitchi*) specifically associated with Wizard Island's dark lava rock — a genuine camouflage-adaptation detail worth an ambient asset. Also documented: **unconfirmed fox/bobcat sign** (tracks only, never a confirmed resident) — good as an easter-egg track decal rather than an actual animal spawn. |

---

## Sources

| Source | Used for |
|---|---|
| [Crater Lake Institute — Wizard Island](https://www.craterlakeinstitute.com/research-at-crater-lake/geology/geologic-features/wizard-island/) | Cone height, general shape |
| [Crater Lake Institute — Howell Williams (1942) Ch. 8](https://www.craterlakeinstitute.com/research-at-crater-lake/geology/historic-geology/geology-howell-williams-1942/90-08/) | Cone composition/color, crater dimensions, lava flow morphology |
| [NPS Nature Notes vol. 7-1b (1932)](https://npshistory.com/nature_notes/crla/vol7-1b.htm) | Cinder color (black to bright red), 35° slope angle, andesite description |
| [NPS Nature Notes vol. 7-1d (1932)](https://npshistory.com/nature_notes/crla/vol7-1d.htm) | Island flora list, species counts, colonization story |
| [NPS Nature Notes vol. 10-3c (1937)](https://npshistory.com/nature_notes/crla/vol10-3c.htm) | Island mammal list and colonization discussion |
| [Crater Lake Institute — Wizard Island Summit Trail](https://www.craterlakeinstitute.com/what-to-do/planning-your-visit/hiking/trails-index/wizard-island-summit-trail/) | Dominant conifers by elevation, crater-floor plants |
| [Crater Lake Institute — Wizard Island Toads (Frank Lang)](https://www.craterlakeinstitute.com/nature-notes-by-dr-frank-lang/wizard-island-toads/) | Western toad presence (debunks the "Wizard Island Toad" name) |
| [Crater Lake Institute — Snakes in Crater Lake NP](https://www.craterlakeinstitute.com/smith-chronological-history-of-crater-lake/sources-and-articles-of-interest/snakes-in-crater-lake-national-park/) | Melanistic garter snake on Wizard Island's lava |
| [NPS — Block Flows](https://www.nps.gov/articles/000/block-flows.htm) | Block lava vs. a'a distinction |
| [NPS — Trees of Crater Lake (PDF)](https://www.nps.gov/crla/planyourvisit/upload/Trees-508.pdf) | Park-wide tree list; source of the cottonwood/western-shore conflation |
| [NPS — Wizard Island](https://www.nps.gov/crla/learn/nature/wizardisland.htm) | Formation context, % of cone exposed above water |
| [Wikipedia — Wizard Island](https://en.wikipedia.org/wiki/Wizard_Island) | Cross-check on dimensions (used where it agreed; superseded by Howell Williams where it didn't) |

Not independently verifiable and excluded from the table above: the original brief's USGS main-site link and the Oregon Explorer glossary link are legitimate domains but weren't checked line-by-line; the YouTube citation used for the cottonwood/tree claims couldn't be verified and is the likely origin of the cottonwood hallucination.

---

## Implementation notes

- Feed the corrected classifications straight into `surface-data-layers.md`'s per-cell substrate approach: black scoria (lower cone) → red/brown oxidized scoria (upper cone, near rim) → block-lava material (base apron + westward flow lobe with ridge/trough geometry) → fine soil/scree + grass-sedge-rush mix (crater floor).
- Cap flora variety hard — ~60 species total on the whole island, two-thirds woody/perennial — and bias placement so the crater wall (mainland) reads as visibly richer than the island, per the documented colonization gap.
- Small-mammal and reptile ambient spawns (golden-mantled ground squirrel, Klamath + Allen's chipmunk, pika, deer mouse, Mazama red-backed mouse, melanistic garter snake, western toad near shore) are all better-sourced than the original brief's list once the toad-naming and cottonwood items are dropped.
