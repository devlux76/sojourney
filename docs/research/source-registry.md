# Sojourney Source Registry

A master list of data and reference sources, with what each one is for. Last updated 2026-09-28.
Related notes: biome-classification-research.md, surface-data-layers.md (cave-data-sources.md is not included; caves are out of scope for v1)

---

## 1. Biome / Ecosystem Classification (the "what kind of place is this" layer)

| Source | Use it for | Link |
|---|---|---|
| Keith et al. 2022, "A function-based typology for Earth's ecosystems" (Nature) | Main reference for the IUCN Global Ecosystem Typology (GET): 5 realms, 25 biomes, 110 ecosystem functional groups. Cite it for any biome delineation. | https://www.nature.com/articles/s41586-022-05318-4 |
| IUCN GET 2.0 descriptive profiles (PDF) | A profile for each biome and functional group: drivers, biota, processes. Use when writing class rules for what should appear in each ecosystem type. | https://portals.iucn.org/library/sites/library/files/documents/2020-037-En.pdf |
| IUCN GET resource page | Overview and official entry point | https://iucn.org/resources/conservation-tool/iucn-global-ecosystem-typology |
| UN SEEA page on GET | Evidence that the UN adopted GET as the reference classification. Use to justify the choice. | https://seea.un.org/content/iucn-global-ecosystem-typology-v101-descriptive-profiles-biomes-and-ecosystem-functional |
| GET indicative distribution maps (Zenodo) | Downloadable maps of the 110 functional groups. They are coarse and "indicative", so use them to tag regions, not for fine detail. | https://zenodo.org/records/10081251 |
| GET Level 3 on Google Earth Engine | The same maps, for querying in the cloud | https://developers.google.com/earth-engine/datasets/catalog/IUCN_GlobalEcosystemTypology_current |
| IUCN 2025 cross-referencing guidelines (PDF) | Mapping GET against other systems (RESOLVE, Köppen, and so on). Use to keep tags from different sources consistent. | https://portals.iucn.org/library/sites/library/files/documents/2025-026-En.pdf |
| Dinerstein et al. 2017 (BioScience) | Main reference for RESOLVE Ecoregions2017: 14 biomes, 846 ecoregions, 8 realms | https://academic.oup.com/bioscience/article/67/6/534/3102935 |
| RESOLVE Ecoregions & Biomes dataset (ArcGIS Hub) | Downloadable terrestrial ecoregion polygons. Tag each location with its ecoregion to get the right biota and landscape. | https://hub.arcgis.com/datasets/esri::resolve-ecoregions-and-biomes/about |
| UNEP-WCMC Resolve Ecoregions service | Mirror and metadata for the same data | https://data-gis.unep-wcmc.org/server/rest/services/Bio-geographicalRegions/Resolve_Ecoregions/FeatureServer/0/metadata?format=default&f=html |

## 2. Climate (the weather and seasons layer)

| Source | Use it for | Link |
|---|---|---|
| Beck et al. 2023, 1 km Köppen-Geiger maps 1901–2099 (Scientific Data) | Climate class per location, including historical and future periods. Drives weather, seasonality and snow. | https://www.nature.com/articles/s41597-023-02549-6 |
| Beck et al. 2018, present and future Köppen-Geiger 1 km | The earlier version and its method paper | https://www.nature.com/articles/sdata2018214 |
| GloH2O Köppen-Geiger downloads | Where to download the map files | https://www.gloh2o.org/koppen/ |

## 3. Terrain and Elevation

| Source | Use it for | Link |
|---|---|---|
| USGS 3D Elevation Program (3DEP) | Elevation models behind the heightmaps. Surface only, no caves. | https://www.usgs.gov/3d-elevation-program |
| USGS Lidar Explorer | Raw lidar point clouds. Use for canopy height models, individual tree positions and heights, and fine surface detail. | https://apps.nationalmap.gov/lidar-explorer/ |

## 4. Ground Cover and Surface (Wizard Island / Crater Lake)

| Source | Use it for | Link |
|---|---|---|
| USGS SIM 2832, Geologic Map of Mount Mazama and Crater Lake Caldera (Bacon 2008) + GIS database | Substrate type: cinder cone vs. blocky lava flows vs. talus, and so on. Drives ground material, texture and walkability. | https://pubs.usgs.gov/sim/2832/ |
| USGS SIM 2832 pamphlet (PDF) | Descriptions of each geologic unit | https://pubs.usgs.gov/sim/2832/data/sim2832_pamphlet.pdf |
| NPS Crater Lake Vegetation Mapping geospatial data (data.gov) | Vegetation-association polygons and field plots. Drives which plant communities appear where. | https://catalog.data.gov/dataset/geospatial-data-for-the-vegetation-mapping-inventory-project-of-crater-lake-national-park |
| NPS Vegetation Inventory, Crater Lake | Project overview; the report has the class descriptions and field keys | https://www.nps.gov/im/vmi-crla.htm |
| NPS "Completing the Crater Lake Vegetation Map" | Background on how the map was made | https://www.nps.gov/articles/000/completing-the-crater-lake-vegetation-map.htm |
| NPS Vegetation Mapping Inventory (all parks) | The same kind of vegetation map exists for many other parks. Check here for future experiences. | https://www.nps.gov/im/vegetation-mapping-inventory.htm |
| Crater Lake Institute, Wizard Island page | Descriptive ground truth: symmetrical cinder cone ringed by dark, rugged lava; ~1 sq mi; summit 763 ft above lake; sparse trees | https://www.craterlakeinstitute.com/research-at-crater-lake/geology/geologic-features/wizard-island/ |
| Crater Lake Institute, Howell Williams (1942) Wizard Island chapter | Historical geologic description of the post-caldera eruptions | https://www.craterlakeinstitute.com/research-at-crater-lake/geology/historic-geology/geology-howell-williams-1942/90-08/ |
| NPS Crater Lake maps | Official park maps: dock, trails, infrastructure | https://www.nps.gov/crla/planyourvisit/maps.htm |

**Also recommended (not yet looked up in detail; URLs still to be confirmed):**

- USDA NAIP aerial imagery (~0.6 m): colour and texture ground truth
- LANDFIRE Existing Vegetation Type (30 m): vegetation fallback for anywhere in the US
- USDA gSSURGO: soils
- OpenStreetMap: trails, docks, structures

## 5. Caves (on the back burner)

| Source | Use it for | Link |
|---|---|---|
| NPS, Laser Scanning in Carlsbad Caverns | Univ. of Arkansas CAST scan: main corridor, Big Room, Lunchroom; ~74 billion points, ~2 mm spacing. Data not public; contact CAST (Malcolm Williamson) or the park. | https://www.nps.gov/articles/000/laser-scanning-in-carlsbad-caverns.htm |
| NPS, Use of 3D Data in Carlsbad Caverns | How the data is used; voxel conversion | https://www.nps.gov/articles/000/introduction-use-of-3d-data-in-carlsbad-caverns.htm |
| NPS, Future Uses for the Carlsbad Scan Data | Planned applications. Useful when pitching a data-sharing request. | https://www.nps.gov/articles/000/potential-future-uses-for-laser-scanning-data-collected-in-carlsbad-caverns.htm |
| Univ. of Arkansas news on the Carlsbad digital map | Project background and contacts | https://news.uark.edu/articles/40790/u-of-a-researchers-create-digital-map-cultural-history-of-carlsbad-cavern |
| Smithsonian, Carlsbad 3D map | Popular summary | https://www.smithsonianmag.com/smart-news/3-d-map-capture-35-miles-carlsbad-caverns-down-millimeter-180972932/ |
| Unreal Engine spotlight: NPS caves in real-time 3D | Timpanogos scan (Faro lidar, ~22 billion points, >1 mile, all three caves; Blase LaSala) and Lehman Caves (lidar + photogrammetry). Shows a game-engine pipeline that has already been done. | https://unrealengine.com/en-US/spotlights/exploring-the-stunning-caves-of-the-national-park-service-in-real-time-3d |
| NPS Timpanogos Cave virtual tour | Public output of the Timp scan | https://www.nps.gov/tica/learn/photosmultimedia/virtualtour.htm |
| KarstConduitCatalogue (ESSD 2025) | Open lidar point clouds of cave conduits. Possible open data for generic cave shapes. | https://essd.copernicus.org/articles/17/4671/2025/ |
| Grand Canyon deep-karst caves 3D characterization (Scientific Reports 2025) | Academic cave 3D reference | https://www.nature.com/articles/s41598-025-17472-6 |

Note: the Federal Cave Resources Protection Act (1988) lets agencies withhold cave location data from public records requests. Expect data-sharing agreements rather than open downloads.

---

## Recommended tagging stack (per location)

1. IUCN GET biome and functional group: what the ecosystem is
2. RESOLVE ecoregion: the plants and animals it should have
3. Köppen-Geiger class: climate and weather
4. Local layers (geology, vegetation map, lidar, imagery): ground truth at walking scale

## Open research items

- Confirm URLs and details for NAIP, LANDFIRE, gSSURGO and OSM
- Aquatic companions: Marine Ecoregions of the World (Spalding 2007), Pelagic Provinces (Spalding 2012), Freshwater Ecoregions of the World (Abell 2008)
- USGS/Esri World Terrestrial Ecosystems (Sayre et al. 2020) as a finer-grain option
