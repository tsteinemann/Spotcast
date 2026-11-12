# Spotcast

**Know where. Know when.** The forecast for where to fish.

Spotcast is an installable web app for Florida and Georgia anglers. Pan anywhere along the Florida or Georgia coast, search a town, or use your location. Spots load automatically for whatever is on screen: passes, bridges, channel drop-offs, tidal flats, mangrove shorelines, oyster bars, public docks and man-made reefs. Inland, lakes (Lanier, Allatoona, West Point, Hartwell, Oconee, Sinclair, Seminole and the rest) get points, coves, bridges and marina docks, rated on the season's pattern from estimated water temperature, live lake level where USGS has a gauge, wind, moon and light. Each one is rated Hot, Great, Good or Fair for every hour of the next seven days. The score is built in the open: tide (35), wind (25), moon (20) and light (20) make the base, then extras add or take points for the spot type, the pressure trend, water temperature for the main species, seas, sky and storms. Passes, bridges and drop-offs near a NOAA current station score on the predicted current itself, and a small tide swing counts against a spot. Every rating shows its reasons, and every spot has a short game plan.

The map also has radar (last hour, looped), NOAA nautical charts, tidal current and wind arrows that follow the hour on the timeline, water temperature at NOAA stations, and bait and tackle shops.

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
- Esri World Imagery, reference labels and geocoder; OpenStreetMap Nominatim as backup search

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout and styles |
| `app.js` | Spot generation, scoring, map rendering and data loading |
| `stations.json` | Florida NOAA tide, water-temperature and current stations |
| `georgia.json` | Georgia sounds, DNR reefs, boat ramps and marinas |
| `baits.json` | Florida bait and tackle shops: name, lat, lng, hours, phone, website, address, live bait, note |
| `sw.js` | Service worker: offline shell, tile and data caching |
| `manifest.webmanifest`, `icons/` | Home screen install |

Not for navigation. Depths are approximate.
