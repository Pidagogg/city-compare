// City outlines from OpenStreetMap (Nominatim) and population from OSM or
// Wikidata. Requests come only from the extension's own pages, only when the
// user searches, and results are cached — Nominatim's usage policy allows at
// most one request per second and asks clients to cache.
import browser from "webextension-polyfill";
import { areaKm2, shapeFromGeoJSON, simplify, type Shape } from "./geo.ts";
import { lang } from "./i18n.ts";

export interface Place {
  id: string;
  name: string;
  detail: string;
  shape: Shape;
  areaKm2: number;
  population: number | null;
  populationYear: string | null;
  bbox: [number, number, number, number]; // south, north, west, east
}

const CACHE_PREFIX = "search:";
let lastRequest = 0;

async function politely(url: string) {
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function wikidataPopulation(qid: string): Promise<{ value: number; year: string | null } | null> {
  try {
    const data = await politely(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`);
    const claims = data.entities?.[qid]?.claims?.P1082 || [];
    let best: { value: number; year: string | null } | null = null;
    for (const c of claims) {
      const value = Number(c.mainsnak?.datavalue?.value?.amount);
      if (!Number.isFinite(value)) continue;
      const time: string | null = c.qualifiers?.P585?.[0]?.datavalue?.value?.time || null;
      const year = time ? time.slice(1, 5) : null;
      if (!best || c.rank === "preferred" || (year && (!best.year || year > best.year))) best = { value, year };
      if (c.rank === "preferred") break;
    }
    return best;
  } catch {
    return null;
  }
}

/** Cities (settlements with a boundary) matching the query, best first. */
export async function searchCities(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `${CACHE_PREFIX}${lang}:${q.toLowerCase()}`;
  const cached = (await browser.storage.local.get(key))[key] as Place[] | undefined;
  if (cached) return cached;

  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    polygon_geojson: "1",
    polygon_threshold: "0.0003",
    extratags: "1",
    addressdetails: "0",
    limit: "6",
    "accept-language": lang,
  });
  const results = (await politely(`https://nominatim.openstreetmap.org/search?${params}`)) as Array<Record<string, any>>;
  const places: Place[] = [];
  for (const r of results) {
    if (!r.geojson || !/Polygon/.test(r.geojson.type)) continue;
    const shape = simplify(shapeFromGeoJSON(r.geojson), 1200);
    const [s, n, w, e] = (r.boundingbox || []).map(Number);
    let population = Number(String(r.extratags?.population || "").replace(/[^\d]/g, "")) || null;
    let populationYear: string | null = r.extratags?.["population:date"]?.slice(0, 4) || null;
    // Wikidata only for the top results: each lookup waits its turn (1 req/s)
    if (!population && r.extratags?.wikidata && places.length < 3) {
      const wd = await wikidataPopulation(r.extratags.wikidata);
      if (wd) {
        population = wd.value;
        populationYear = wd.year;
      }
    }
    const nameParts = String(r.display_name || r.name).split(",").map((x: string) => x.trim());
    places.push({
      id: `${r.osm_type}${r.osm_id}`,
      name: r.name || nameParts[0],
      detail: nameParts.slice(1, 3).join(", "),
      shape,
      areaKm2: areaKm2(shape),
      population,
      populationYear,
      bbox: [s, n, w, e],
    });
  }
  await browser.storage.local.set({ [key]: places }).catch(() => {});
  return places;
}
