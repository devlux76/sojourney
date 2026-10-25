# Biome Classification Research (Sept 2026)

## Q1: How many macrobiomes?
No single number — depends on the system. Two dominant answers:

- **14 terrestrial biomes** (WWF/Olson 2001; updated as RESOLVE Ecoregions2017, Dinerstein et al. 2017): 846 ecoregions, 14 biomes, 8 biogeographic realms.
  1. Tropical & subtropical moist broadleaf forests
  2. Tropical & subtropical dry broadleaf forests
  3. Tropical & subtropical coniferous forests
  4. Temperate broadleaf & mixed forests
  5. Temperate conifer forests
  6. Boreal forests / taiga
  7. Tropical & subtropical grasslands, savannas & shrublands
  8. Temperate grasslands, savannas & shrublands
  9. Flooded grasslands & savannas
  10. Montane grasslands & shrublands
  11. Tundra
  12. Mediterranean forests, woodlands & scrub
  13. Deserts & xeric shrublands
  14. Mangroves
  Distinguished by climate (temperature/precipitation regime, seasonality), dominant vegetation structure, and (for flooded/mangrove/montane) hydrology or elevation.

- **25 functional biomes** (IUCN Global Ecosystem Typology 2.0, Keith et al. 2022, Nature): 5 core realms + transitional realms -> 25 biomes -> 110 ecosystem functional groups (EFGs). Covers land, freshwater, marine, subterranean, and transitional systems, plus anthropogenic ones.
  - Terrestrial: T1 Tropical-subtropical forests; T2 Temperate-boreal forests & woodlands; T3 Shrublands & shrub-dominated woodlands; T4 Savannas & grasslands; T5 Deserts & semi-deserts; T6 Polar/alpine (cryogenic); T7 Intensive land-use
  - Freshwater: F1 Rivers & streams; F2 Lakes; F3 Artificial wetlands
  - Marine: M1 Marine shelf; M2 Pelagic ocean waters; M3 Deep sea floors; M4 Anthropogenic marine
  - Subterranean: S1 Subterranean lithic; S2 Anthropogenic subterranean voids
  - Transitional: SF1, SF2 (subterranean freshwaters), SM1 (subterranean tidal), TF1 Palustrine wetlands, FM1 Semi-confined transitional waters (estuaries/lagoons), MT1 Shorelines, MT2 Supralittoral coastal, MT3 Anthropogenic shorelines, MFT1 Brackish tidal (mangroves, saltmarsh)
  Distinguished by ecological function: resources, drivers/disturbance regimes, biota traits and processes.

Classic textbook: Whittaker (~9 biomes by mean annual temp x precipitation); Walter's 9 zonobiomes.

## Q2: Most scientifically accepted
- **IUCN GET** — most current, peer-reviewed in Nature, adopted by UN SEEA Ecosystem Accounting as reference classification; the conceptual framework to classify against. Weakness: EFG maps are "indicative" and variable quality.
- **RESOLVE Ecoregions2017** — most used operational terrestrial map; best for biogeographic realism (which species where).
- **Köppen-Geiger** (Beck et al. 2018, 2023; 1 km, 1901-2099) — climate layer, not biomes, but best-validated driver data.
- Aquatic companions: Marine Ecoregions of the World (Spalding 2007; 12 realms, 62 provinces, 232 ecoregions), Pelagic Provinces (Spalding 2012), Freshwater Ecoregions of the World (Abell 2008; ~450 ecoregions).
- Finer-grain option: USGS/Esri World Terrestrial Ecosystems (Sayre et al. 2020) — climate x landform x land cover.

## Recommended stack for Sojourney
Tag every location with: GET biome/EFG code (what it is functionally) + RESOLVE ecoregion (where/biota) + Köppen-Geiger class (climate/weather). IUCN has published cross-walks between typologies (2025 guidelines).
