# Flaming Gorge Reservoir Bathymetry: Data Sources & Feasibility

> **Reviewer verification (2026-09-27, supersedes the recommendation below where they differ):**
> - The Reclamation 2019–2020 survey is real ([Technical Report ENV-2021-111](https://www.usbr.gov/tsc/techreferences/reservoir/FlamingGorgeRes2019SedimentationSurvey_final508.pdf); [RISE record 8065](https://data.usbr.gov/catalog/8065)), but RISE publishes **only the report PDF and the ACAP table**, with no bathymetric raster. So option (a) is not available as data.
> - The TNM API (bbox -109.62,40.86,-109.48,40.95) returns **1952 1:24,000 quads "Flaming Gorge, UT" (ids 249345/249346) and "Dutch John Mtn, UT" (249031/249032)**, e.g. `https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/PDF/UT/24000/UT_Flaming%20Gorge_249346_1952_24000_geo.pdf`. GeoTIFFs sit under the same bucket's `HistoricalTopo/GeoTIFF/` path.
> - Reclamation reports only 2.2 % (80,394 acre-ft) capacity lost to sediment since 1962, and the dead pool below 5,740 ft is intact, so the 1952 contours are a faithful floor.
> - **Decision:** (b) pre-dam quad contours below full pool, merged with the modern 3DEP DEM above it, **validated against the 2019 ACAP table** (elevation → area/volume). (c) synthetic bed stays as the fallback.

## 1. Modern Bathymetry (2019–2020)

**Bureau of Reclamation Sedimentation Survey** ([usbr.gov/tsc/techreferences](https://www.usbr.gov/tsc/techreferences/reservoir/FlamingGorgeRes2019SedimentationSurvey_final508.pdf))

- **Multibeam survey:** May–June 2019 & Sept 2020 (Reclamation's Technical Service Center, Denver)
- **Coverage:** Continuous raster from reservoir bottom to crest elevation 6,047 ft (RPVD)
- **Resolution:** Suitable for game terrain (original 1–5 m, resample as needed)
- **Area-Capacity (ACAP) table:** CSV format, 2019 edition ([RISE Item 133885](https://data.usbr.gov/catalog/8065/item/133885))
- **Report:** Technical Report ENV-2021-111 ([details](https://data.usbr.gov/catalog/8065))
- **Status:** ✅ **Best option—modern, accurate, publicly available**

### Key Elevations
- Dam crest: 6,047 ft  
- Normal pool surface: 6,040 ft  
- Bedrock foundation: ~5,545 ft (crest − 502 ft above bedrock)

---

## 2. Pre-Impoundment Historical Maps (1952–1962)

**USGS topoView** ([ngmdb.usgs.gov/topoview](https://ngmdb.usgs.gov/topoview/))

- **Flaming Gorge 7.5′ quad (1:24,000):** Versions available 1952, 1966, 1996, 2016
- **Format:** GeoPDF, GeoTIFF, JPEG, KMZ (all free download)
- **Pre-dam:** 1952 edition shows the Green River *before* Dec 1962 impoundment
- **Contour interval:** 40 or 80 ft (typical for 1:24,000 US topos); check metadata
- **Georeferenced GeoTIFF:** Available directly from topoView

**USGS Geologic Quadrangle 75** ([pubs.usgs.gov/publication/gq75](https://pubs.usgs.gov/publications/geology-flaming-gorge-quadrangle-utah-wyoming))
- Title: *Geology of the Flaming Gorge quadrangle, Utah-Wyoming*
- Author: Wallace R. Hansen, 1955
- Coverage: 1:24,000 scale; geological map + contour base from survey-era topo

**Adjacent & Related Quads:**
- Red Canyon area: Check Manila (W), Linwood Canyon (NW), Dutch John (E), East Park Reservoir (S)
- All available via topoView with pre-1962 editions

---

## 3. Digitized Pre-Impoundment Surface

**None located directly.** However, contours from the 1952 topo can be vectorized (see Feasibility, below).

---

## 4. Modern Area-Capacity & River Bed Data

- **ACAP Table:** [RISE Item 133885](https://data.usbr.gov/catalog/8065/item/133885) (CSV, elevation → area → volume)
- **Normal pool:** 6,040 ft; **minimum pool:** ~5,950 ft; **spillway:** 6,047 ft
- **Green River thalweg at dam (pre-impoundment):** ~5,540–5,545 ft *(inferred from 502 ft height above bedrock)*
- **Filling timeline:** Commenced Dec 10, 1962; reached design pool by ~1964

---

## 5. Contour Extraction from Historical Topos: Feasibility ✅

**Absolutely feasible.** Workflow for 1952 topo GeoTIFF → lake-floor DEM:

1. **Threshold brown contour lines** (OpenCV: HSV brown range → binary mask)
2. **Vectorize contours** (rasterio / GDAL contouring, or trace with OpenCV)
3. **Interpolate DEM** (elevation labels + contour lines → TIN or gridded DEM via geopandas + scipy)
4. **Resample to game grid** (GDAL, rasterio)

**Tools & Libraries:**
- [GemGIS](https://gemgis.readthedocs.io/en/latest/getting_started/tutorial/62_Extracting_contour_lines_from_raster.html): Rasterio + Shapely + Geopandas tutorial for contour extraction
- [lightningtrace](https://github.com/GeomaticsResearch/lightningtrace): `extract_contours()` function
- OpenCV (contour detection & line tracing)
- GDAL/rasterio (raster I/O & resampling)
- SciPy / RBF (interpolation)

**Caveat:** 1952 topo has ~40–80 ft contour intervals → coarse resolution. Suitable for ambient terrain, not high-fidelity bathymetry. ~500 m–1 km generalization needed.

---

## Recommendation

**Rank by use case:**

### (A) Modern bathymetry ⭐ **Primary choice**
- Use Reclamation 2019–2020 multibeam + LiDAR raster ([env-2021-111](https://www.usbr.gov/tsc/techreferences/reservoir/FlamingGorgeRes2019SedimentationSurvey_final508.pdf), [ACAP Table](https://data.usbr.gov/catalog/8065/item/133885))
- High fidelity, modern, publicly available
- Covers **Red Canyon & entire reservoir** at game-usable resolution
- Direct download as GeoTIFF from RISE catalog

### (B) Pre-dam contours ✅ **Fallback if modern unavailable**
- Download 1952 Flaming Gorge 7.5′ topo as GeoTIFF from [topoView](https://ngmdb.usgs.gov/topoview/)
- Extract brown contour lines with Python (OpenCV + rasterio)
- Interpolate to DEM; ~500 m–1 km generalization
- Lower fidelity but historically authentic pre-impoundment riverbed

### (C) Synthetic bed (not recommended)
- Calibrate Green River thalweg at dam (~5,545 ft) + area-capacity curve
- Generate synthetic U-shaped channel
- Use only if (A) & (B) fail; coarse approximation

**Next step:** Fetch Reclamation's 2019 GeoTIFF raster. If resolution insufficient, script contour extraction from 1952 topo as parallel track.

---

## Sources

- [Flaming Gorge Reservoir 2019 Sedimentation Survey Report (ENV-2021-111)](https://www.usbr.gov/tsc/techreferences/reservoir/FlamingGorgeRes2019SedimentationSurvey_final508.pdf)
- [Bureau of Reclamation RISE Data Catalog (Flaming Gorge Sedimentation Survey)](https://data.usbr.gov/catalog/8065)
- [ACAP Table 2019](https://data.usbr.gov/catalog/8065/item/133885)
- [USGS topoView](https://ngmdb.usgs.gov/topoview/)
- [USGS Geology of the Flaming Gorge Quadrangle (GQ-75, Hansen 1955)](https://pubs.usgs.gov/publication/gq75)
- [GemGIS Contour Extraction Tutorial](https://gemgis.readthedocs.io/en/latest/getting_started/tutorial/62_Extracting_contour_lines_from_raster.html)
- [Wikipedia: Flaming Gorge Dam](https://en.wikipedia.org/wiki/Flaming_Gorge_Dam)
