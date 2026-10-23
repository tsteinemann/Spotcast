# Spotcast

**Know where. Know when.** The forecast for where to fish.

Spotcast is an installable web app for Florida anglers. Pan anywhere along the Florida coast, search a town, or use your location. Spots load automatically for whatever is on screen: passes, bridges, channel drop-offs, tidal flats, mangrove shorelines, oyster bars, public docks and man-made reefs. Each one is rated Hot, Great, Good or Fair for every hour of the next seven days from live tides, wind, moon and light. Every rating shows its reasons, and every spot has a short game plan.

## Use it

Open the GitHub Pages link on your phone:

- **iPhone (Safari):** tap Share, then Add to Home Screen.
- **Android (Chrome):** tap Install, or Install app from the browser menu.

## Data

All data is public and fetched live from the phone:

- NOAA CO-OPS tide predictions and water temperature
- National Weather Service hourly forecast
- NOAA NCEI elevation models (shaded relief and depth contours)
- FWC inlets and passes, oyster beds, tidal flats, mangroves, marinas and docks, artificial reefs, and hard bottom
- FDOT and local bridge locations
- Esri World Imagery, reference labels and geocoder; OpenStreetMap Nominatim as backup search

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page layout and styles |
| `app.js` | Spot generation, scoring, map rendering and data loading |
| `stations.json` | Florida NOAA tide and water-temperature stations |
| `sw.js` | Service worker: offline shell, tile and data caching |
| `manifest.webmanifest`, `icons/` | Home screen install |

Not for navigation. Depths are approximate.
