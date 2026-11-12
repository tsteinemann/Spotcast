# Spotcast

**Know where. Know when.** The forecast for where to fish.

Spotcast is an installable web app for Florida and Georgia anglers. Pan anywhere along the Florida or Georgia coast, search a town, or use your location. Spots load automatically for whatever is on screen: passes, bridges, channel drop-offs, tidal flats, mangrove shorelines, oyster bars, public docks and man-made reefs. Inland, lakes (Lanier, Allatoona, West Point, Hartwell, Oconee, Sinclair, Seminole and the rest) get points, coves, bridges and marina docks, rated on the season's pattern from estimated water temperature, live lake level where USGS has a gauge, wind, moon and light. Each one is rated Hot, Great, Good or Fair for every hour of the next seven days. The score is built in the open: tide (35), wind (25), moon (20) and light (20) make the base, then extras add or take points for the spot type, the pressure trend, water temperature for the main species, seas, sky and storms. Passes, bridges and drop-offs near a NOAA current station score on the predicted current itself, and a small tide swing counts against a spot. Every rating shows its reasons, and every spot has a short game plan.

The map also has radar (last hour, looped), NOAA nautical charts, tidal current and wind arrows that follow the hour on the timeline, water temperature at NOAA stations, and bait and tackle shops.

## Lake guides

`guide.html` is a month-by-month field guide for ten Georgia lakes (Lanier, Allatoona, Hartwell, West Point, Walter F. George, Oconee, Sinclair, Clarks Hill (Thurmond), Russell and Carters) and ten Florida lakes (Okeechobee, Kissimmee, Toho, Istokpoga, the Harris Chain, Rodman, Lake George, Orange and Lochloosa, Talquin and Tarpon). Each guide shows what stripers, hybrids, bass, crappie, bream (and walleye on Carters) are doing that month, target areas on the lake map, how to fish them, the water column and what to look for. Areas and patterns marked "From guide reports" come from published monthly reports; the rest are the typical pattern for that kind of lake. Open a guide from the lake card or a lake spot, or go to `guide.html?lake=lanier&m=11`.

## Use it

Open the GitHub Pages link on your phone:

- **iPhone (Safari):** tap Share, then Add to Home Screen.
- **Android (Chrome):** tap Install, or Install app from the browser menu.

## Data

All data is public and fetched live from the phone:

- NOAA CO-OPS tide predictions, tidal current predictions and water temperature
- Open-Meteo pressure, cloud cover and visibility, plus marine waves, swell, surface current and sea temperature
- NEXRAD radar via Iowa State Mesonet
- USGS National Hydrography Dataset lake outlines and USGS lake level gauges; Esri places for lake parks and marinas
- NOAA ENC nautical charts
- Bait and tackle shops: a built-in statewide list (`baits.json`) from OpenStreetMap and Esri places, plus hand-checked local shops
- National Weather Service hourly forecast
- NOAA NCEI elevation models (shaded relief and depth contours)
- FWC inlets and passes, oyster beds, tidal flats, mangroves, marinas and docks, artificial reefs, and hard bottom
- FDOT and local bridge locations; the National Bridge Inventory for Georgia
- Georgia DNR offshore and inshore artificial reefs (GPX master lists), Georgia sound entrances, OpenStreetMap ramps and marinas in Georgia
- Lake guides: OpenStreetMap lake outlines and creek names; monthly guide reports from GON, Carolina Sportsman, AHQ, Lakeside News, FWC lake pages and others, listed on each guide
- Esri World Imagery, reference labels and geocoder; OpenStreetMap Nominatim as backup search

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout and styles |
| `app.js` | Spot generation, scoring, map rendering and data loading |
| `stations.json` | Florida NOAA tide, water-temperature and current stations |
| `georgia.json` | Georgia sounds, DNR reefs, boat ramps and marinas |
| `baits.json` | Florida bait and tackle shops: name, lat, lng, hours, phone, website, address, live bait, note |
| `guide.html`, `guides/` | Lake guides: the page, plus one data file per lake (outline, seasonal patterns, target areas, sources) and `common.json` |
| `sw.js` | Service worker: offline shell, tile and data caching |
| `manifest.webmanifest`, `icons/` | Home screen install |

Not for navigation. Depths are approximate.
