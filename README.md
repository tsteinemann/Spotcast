# Spotcast

**Know where. Know when.** The forecast for where to fish.

Spotcast is an installable web app for Florida anglers. Search any Florida town, or use your location, and it finds nearby passes, oyster bars and man-made reefs, then rates each one Hot, Great, Good or Fair for every hour of the next seven days from live tides, wind, moon and light. Every rating shows its reasons, and every spot has a short game plan.

## Use it

Open the GitHub Pages link on your phone:

- **iPhone (Safari):** tap Share, then Add to Home Screen.
- **Android (Chrome):** tap Install, or Install app from the browser menu.

## Data

All data is public and fetched live from the phone:

- NOAA CO-OPS tide predictions and water temperature
- National Weather Service hourly forecast
- NOAA NCEI elevation models (shaded relief and depth contours)
- FWC inlets and passes, oyster beds, artificial reefs, and hard bottom
- Esri World Imagery, reference labels and geocoder; OpenStreetMap Nominatim as backup search

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: UI, data loading, spot generation, scoring, map rendering |
| `stations.json` | Florida NOAA tide and water-temperature stations |
| `sw.js` | Service worker: offline shell, tile and data caching |
| `manifest.webmanifest`, `icons/` | Home screen install |

Not for navigation. Depths are approximate.
