// Geometry tests. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { areaKm2, centroid, destination, distance, project, relocate, simplify, template, unproject, type Shape } from "../src/geo.ts";

// a ~10 km × 10 km square around a centre, built with true distances
function square(center: [number, number], halfKm: number): Shape {
  const d = Math.SQRT2 * halfKm * 1000;
  return [[45, 135, 225, 315].map((b) => destination(center, d, (b * Math.PI) / 180))];
}

test("distance and destination are inverse", () => {
  const berlin: [number, number] = [13.405, 52.52];
  const p = destination(berlin, 10_000, Math.PI / 2);
  assert.ok(Math.abs(distance(berlin, p) - 10_000) < 1);
  // Berlin → Paris is ~878 km
  assert.ok(Math.abs(distance(berlin, [2.3522, 48.8566]) / 1000 - 878) < 5);
});

test("area of a 10 × 10 km square is ~100 km², anywhere on Earth", () => {
  for (const c of [[0, 0], [13.4, 52.5], [-70, -50], [25, 69]] as [number, number][]) {
    const a = areaKm2(square(c, 5));
    assert.ok(Math.abs(a - 100) < 1.5, `${c}: ${a}`);
  }
});

test("relocating keeps the true area but changes the Mercator size", () => {
  const cairo = square([31.2, 30.0], 10);
  const t = template(cairo);
  const oslo = relocate(t, [10.75, 59.9]);
  assert.ok(Math.abs(areaKm2(oslo) - areaKm2(cairo)) / areaKm2(cairo) < 0.01, "true area is kept");
  const width = (s: Shape) => {
    const xs = s[0].map((p) => project(p, 10)[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const ratio = width(oslo) / width(cairo);
  // Mercator scale ∝ 1/cos(lat): cos(30°)/cos(59.9°) ≈ 1.73
  assert.ok(Math.abs(ratio - Math.cos((30 * Math.PI) / 180) / Math.cos((59.9 * Math.PI) / 180)) < 0.05, `ratio ${ratio}`);
  const c = centroid(oslo);
  assert.ok(Math.abs(c[0] - 10.75) < 0.05 && Math.abs(c[1] - 59.9) < 0.05, `centre ${c}`);
});

test("relocation across the antimeridian and with rotation", () => {
  const t = template(square([179.9, -16.5], 5));
  const moved = relocate(t, [-179.95, -16.5]);
  assert.ok(Math.abs(areaKm2(moved) - 100) < 2);
  const rotated = relocate(template(square([0, 0], 5)), [0, 0], Math.PI / 4);
  // a square rotated by 45° has a vertex straight north
  assert.ok(rotated[0].some((p) => Math.abs(p[0]) < 1e-6 && p[1] > 0));
});

test("mercator round trip", () => {
  for (const p of [[13.4, 52.5], [-122.4, 37.8], [151.2, -33.9]] as [number, number][]) {
    const back = unproject(project(p, 11.5), 11.5);
    assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
  }
});

test("simplify caps the vertex count and keeps the area close", () => {
  const ring = Array.from({ length: 5000 }, (_, i) => {
    const a = (i / 5000) * 2 * Math.PI;
    const r = 0.1 * (1 + 0.05 * Math.sin(a * 40));
    return [13.4 + r * Math.cos(a) * 1.6, 52.5 + r * Math.sin(a)] as [number, number];
  });
  ring.push(ring[0]);
  const s = simplify([ring], 800);
  assert.ok(s[0].length <= 800, `${s[0].length}`);
  assert.ok(Math.abs(areaKm2(s) - areaKm2([ring])) / areaKm2([ring]) < 0.03);
});
