// Our own full-tab map (Leaflet + OpenStreetMap tiles). Here we control the
// map completely, so the overlay follows every pan and zoom frame by frame —
// the robust mode, and the same in Chrome and Firefox. The outline can be
// dragged over the whole world.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { promoUrl, t } from "./i18n.ts";
import { Overlay, lassoInfo, type View } from "./overlay.ts";
import { mountSearch } from "./searchUi.ts";
import { getCurrent, savePosition, setCurrent, watchCurrent, type Current } from "./store.ts";

document.title = t.name;
const map = L.map("map", { worldCopyJump: true, zoomControl: false, minZoom: 2 }).setView([30, 10], 3);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const view: View = {
  container: map.getContainer(),
  toPixel: ([lng, lat]) => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return [p.x, p.y];
  },
  toLngLat: (x, y) => {
    const ll = map.containerPointToLatLng([x, y]);
    return [ll.lng, ll.lat];
  },
  onChange: (redraw) => map.on("move zoom viewreset resize", redraw),
};
const overlay = new Overlay(view);
overlay.onMoved = (center, rotation) => savePosition(center, rotation);

function apply(c: Current | null) {
  if (!c) return overlay.clear();
  overlay.show(c.info, c.position?.center, c.position?.rotation || 0);
  // a newly picked city: the outline starts on its own city
  if (c.flyId && c.bbox) {
    const [s, n, w, e] = c.bbox;
    map.fitBounds([
      [s, w],
      [n, e],
    ], { padding: [40, 40] });
    setCurrent({ ...c, flyId: undefined });
  }
}

// ---- panel ----
const panel = document.getElementById("panel")!;
const searchBox = document.createElement("div");
panel.append(searchBox);
mountSearch(searchBox, (p) => setCurrent({ info: { name: p.name, shape: p.shape, areaKm2: p.areaKm2, population: p.population, populationYear: p.populationYear }, bbox: p.bbox, flyId: p.id }));

const hint = document.createElement("p");
hint.className = "cc-hint";
hint.textContent = t.drag;
const tools = document.createElement("div");
tools.className = "cc-tools";
const button = (label: string, onClick: () => void) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  tools.append(b);
  return b;
};
button(t.lasso, async () => {
  hint.textContent = t.lassoHint;
  const shape = await overlay.lasso();
  hint.textContent = t.drag;
  if (shape) setCurrent({ info: lassoInfo(shape) });
});
button(`${t.rotate} ↺`, () => overlay.rotate((-15 * Math.PI) / 180));
button(`${t.rotate} ↻`, () => overlay.rotate((15 * Math.PI) / 180));
button(t.clear, () => setCurrent(null));
const promo = document.createElement("a");
promo.className = "cc-promo";
promo.href = promoUrl("map-page");
promo.target = "_blank";
promo.rel = "noopener";
const promoTitle = document.createElement("b");
promoTitle.textContent = t.promoTitle;
promo.append(promoTitle, document.createElement("br"), t.promo);
const source = document.createElement("p");
source.className = "cc-source";
source.textContent = t.source;
panel.append(hint, tools, source, promo);

getCurrent().then((c) => {
  apply(c);
  if (location.hash === "#lasso") tools.querySelector("button")?.click();
});
watchCurrent(apply);
