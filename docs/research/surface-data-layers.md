# Surface / Ground-Cover Data Layers (Sept 2026)

Context: the Wizard Island prototype got terrain shape right (USGS topo -> heightmap) but ground cover wrong. A heightmap only gives shape. What covers the surface has to come from separate layers:

1. **Geology / substrate**: USGS SIM 2832, Geologic Map of Mount Mazama and Crater Lake Caldera (Bacon 2008), with a GIS database. Separates Wizard Island cinder cone (scoria/cinder) from its blocky andesite lava flows, plus talus and others. https://pubs.usgs.gov/sim/2832/
2. **Vegetation**: NPS Vegetation Mapping Inventory, Crater Lake NP (completed 2018). Geodatabase, association-level classes, field plots. https://catalog.data.gov/dataset/geospatial-data-for-the-vegetation-mapping-inventory-project-of-crater-lake-national-park
3. **Individual trees and exact positions**: 3DEP lidar point cloud (USGS Lidar Explorer) -> canopy height model -> tree locations and heights.
4. **Color/texture ground truth**: NAIP aerial imagery (~0.6 m), USDA.
5. **Infrastructure**: NPS / OpenStreetMap for dock, trails, summit trail.
6. **Soils (general case)**: USDA gSSURGO.
7. **Fallback anywhere in the US**: LANDFIRE Existing Vegetation Type (30 m).

Wizard Island facts: symmetrical cinder cone ringed by dark, rugged lava flows; ~1 sq mi; summit 763 ft above lake; sparse trees.

Principle: sample classification layers per cell, then scatter props by class rules; for trees, use lidar positions rather than random scatter.
