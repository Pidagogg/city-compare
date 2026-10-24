// Geometry for City Compare, on a spherical Earth (error well under 1 % at
// city scale — fine for comparing sizes by eye).
//
// The core trick (relocate): a shape keeps its true size when moved because
// every vertex is stored as (distance, bearing) from the shape's centre and
// rebuilt around the new centre with the "destination point" formula. Drawn
// in Web Mercator, it then grows towards the poles and shrinks towards the
// equator exactly as real areas do on that map.

export type LngLat = [number, number]; // [lng, lat]
export type Ring = LngLat[];
export type Shape = Ring[]; // outer rings (a city can have islands)

export const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: LngLat, b: LngLat) {
  const φ1 = rad(a[1]);
  const φ2 = rad(b[1]);
  const Δλ = rad(b[0] - a[0]);
  return Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ));
}

export function destination(from: LngLat, dist: number, brg: number): LngLat {
  const δ = dist / R;
  const φ1 = rad(from[1]);
  const λ1 = rad(from[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brg));
  const λ2 = λ1 + Math.atan2(Math.sin(brg) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((deg(λ2) + 540) % 360) - 180, deg(φ2)];
}

/** Area-weighted centre of the shape (planar in lng/lat around the shape; good enough as an anchor). */
export function centroid(shape: Shape): LngLat {
  let ax = 0;
  let ay = 0;
  let aw = 0;
  const ref = shape[0]?.[0] || [0, 0];
  for (const ring of shape) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = [unwrap(ring[i][0], ref[0]), ring[i][1]];
      const [x2, y2] = [unwrap(ring[(i + 1) % n][0], ref[0]), ring[(i + 1) % n][1]];
      const cross = x1 * y2 - x2 * y1;
      aw += cross;
      ax += (x1 + x2) * cross;
      ay += (y1 + y2) * cross;
    }
  }
  if (Math.abs(aw) < 1e-12) return ref;
  return [((ax / (3 * aw) + 540) % 360) - 180, ay / (3 * aw)];
}

// keep longitudes of one shape on the same side of the antimeridian
const unwrap = (lng: number, ref: number) => (lng - ref > 180 ? lng - 360 : lng - ref < -180 ? lng + 360 : lng);

/** Area in km² on the sphere (spherical excess per ring, absolute). */
export function areaKm2(shape: Shape) {
  let total = 0;
  for (const ring of shape) {
    let sum = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const [λ1, φ1] = [rad(ring[i][0]), rad(ring[i][1])];
      const [λ2, φ2] = [rad(ring[(i + 1) % n][0]), rad(ring[(i + 1) % n][1])];
      let dλ = λ2 - λ1;
      if (dλ > Math.PI) dλ -= 2 * Math.PI;
      if (dλ < -Math.PI) dλ += 2 * Math.PI;
      sum += dλ * (2 + Math.sin(φ1) + Math.sin(φ2));
    }
    total += Math.abs((sum * R * R) / 2);
  }
  return total / 1e6;
}

/** The shape as (distance, bearing) from its centre — computed once per shape. */
export interface Template {
  center: LngLat;
  rings: Array<Array<{ d: number; b: number }>>;
}

export function template(shape: Shape): Template {
  const center = centroid(shape);
  return { center, rings: shape.map((ring) => ring.map((p) => ({ d: distance(center, p), b: bearing(center, p) }))) };
}

/** The same shape, same true size, centred somewhere else; `rotation` in radians. */
export function relocate(t: Template, to: LngLat, rotation = 0): Shape {
  return t.rings.map((ring) => ring.map(({ d, b }) => destination(to, d, b + rotation)));
}

// ---- Web Mercator (the projection Google Maps and OSM tiles use) ----

export const MAX_LAT = 85.05112878;
const TILE = 256;

/** World pixel coordinates at a zoom level. */
export function project([lng, lat]: LngLat, zoom: number): [number, number] {
  const size = TILE * 2 ** zoom;
  const φ = rad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)));
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + Math.sin(φ)) / (1 - Math.sin(φ))) / (4 * Math.PI)) * size];
}

export function unproject([x, y]: [number, number], zoom: number): LngLat {
  const size = TILE * 2 ** zoom;
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return [((lng + 540) % 360) - 180, deg(Math.atan(Math.sinh(n)))];
}

// ---- simplification (Douglas–Peucker in projected space) ----

function perpDist(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function dp(points: number[][], tol: number): number[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

/** Simplify each ring to at most ~maxPoints vertices, dropping specks. */
export function simplify(shape: Shape, maxPoints = 1200): Shape {
  const total = shape.reduce((n, r) => n + r.length, 0);
  if (total <= maxPoints) return shape;
  const z = 12;
  let tol = 0.5;
  let out: Shape = shape;
  for (let pass = 0; pass < 12; pass++) {
    out = shape
      .map((ring) => {
        const pts = ring.map((p) => project(p, z));
        return dp(pts, tol).map((i) => ring[i]);
      })
      .filter((r) => r.length >= 4);
    if (out.reduce((n, r) => n + r.length, 0) <= maxPoints) break;
    tol *= 1.8;
  }
  return out.length ? out : shape.slice(0, 1);
}

/** Outer rings of a GeoJSON Polygon / MultiPolygon (holes ignored: a city's outline is what we compare). */
export function shapeFromGeoJSON(geom: { type: string; coordinates: unknown }): Shape {
  if (geom.type === "Polygon") return [(geom.coordinates as Ring[])[0]];
  if (geom.type === "MultiPolygon") return (geom.coordinates as Ring[][]).map((p) => p[0]);
  throw new Error("This place has no outline.");
}

export function formatArea(km2: number, locale: string) {
  return `${km2 >= 100 ? Math.round(km2).toLocaleString(locale) : km2.toLocaleString(locale, { maximumFractionDigits: 1 })} km²`;
}
