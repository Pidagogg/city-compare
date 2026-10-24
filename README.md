# City Compare

A browser extension for Chrome and Firefox. Pick a city, or draw an area with the lasso, and its real outline appears on the map with its area, population and density. Drag it anywhere on the world map to compare sizes. The outline keeps its **true size**: it grows towards the poles and shrinks towards the equator, exactly as areas really do in Web Mercator.

- **On Google Maps:** the outline is drawn over the map. Google gives other scripts no access to its map, so the view is read from the URL (`/@lat,lng,zoomz`). While you pan or zoom the map, the outline dims until the URL catches up.
- **On the map page** (Leaflet + OpenStreetMap): the robust mode, where the outline follows the map frame by frame.

Outlines come from OpenStreetMap (Nominatim) and population from OSM or Wikidata. Nothing is collected or tracked: the only requests are your searches to Nominatim and Wikidata, and they're cached.

## Build

```bash
npm install
npm test          # geometry: true-size move, spherical area, Mercator, simplify
npm run build     # → dist/chrome, dist/firefox
npm run zip       # also city-compare-chrome-<v>.zip, city-compare-firefox-<v>.zip
```

To load it unpacked:
- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- **Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`.

## Publishing

- **Chrome Web Store:** a one-time $5 developer fee. Upload the Chrome zip. Privacy answers: no data collected. Host permissions are only for the search (Nominatim, Wikidata) and Google Maps (the overlay).
- **Firefox Add-ons (AMO):** upload the Firefox zip plus the source. The bundles aren't minified, and `build.mjs` rebuilds them exactly.

## How the size correction works

`src/geo.ts`:
1. Every vertex is stored as a distance and bearing from the shape's centre (`template`).
2. On every move the outline is rebuilt around the new centre with the destination-point formula (`relocate`).
3. The result is drawn in Web Mercator.

The area is computed on the sphere (`areaKm2`), so the number never changes, wherever the outline is.

## License

MIT

## Repositories

`Pidagogg/city-compare-private` holds the full history and internal notes. The public `Pidagogg/city-compare` gets a clean copy of the last commit without them: `bash scripts/publish-public.sh --push`.
