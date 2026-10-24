// Content script for the map sites in sites.ts (Google Maps, OpenStreetMap).
// Their maps are drawn on canvas/WebGL or in their own code and give other
// scripts no access to the map object, so the view is read from the URL,
// which each site keeps up to date. With the map's box on the page that is
// enough for Web Mercator maths. While the user pans or zooms, the URL lags a
// moment, so the outline is dimmed until the URL catches up.
//
// Runs at document_start (or is injected by the popup into a tab that was
// open before the extension): its window capture listeners must come before
// the site's own, so a drag or lasso stroke on the outline reaches the overlay
// first and is stopped there — otherwise the map pans under the same gesture.
import browser from "webextension-polyfill";
import { project, unproject, type LngLat } from "./geo.ts";
import { t } from "./i18n.ts";
import { Overlay, lassoInfo, type View } from "./overlay.ts";
import { siteFor, type Camera } from "./sites.ts";
import { getCurrent, savePosition, setCurrent, watchCurrent, type Current } from "./store.ts";

const w = window as unknown as { __cityCompare?: boolean };
const site = siteFor(location.href);
if (site && !w.__cityCompare) {
  w.__cityCompare = true;
  start(site);
}

function start(s: NonNullable<ReturnType<typeof siteFor>>) {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483000" });
  document.documentElement.appendChild(host);
  const toast = document.createElement("div");
  Object.assign(toast.style, { position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", background: "#222c", color: "#fff", padding: "8px 12px", borderRadius: "8px", font: "13px system-ui", display: "none", zIndex: "2147483001", pointerEvents: "none" });
  document.documentElement.appendChild(toast);

  const cameraNow = () => s.camera(new URL(location.href));
  let cam: Camera | null = cameraNow();
  let currentShown = false;

  // The URL's centre is the centre of the site's map box (Google: the window;
  // OpenStreetMap: the map next to its sidebar).
  const centre = () => {
    const r = s.mapRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const view: View = {
    container: host,
    toPixel(p) {
      const c = cam || { lat: 0, lng: 0, zoom: 2 };
      const [cx, cy] = project([c.lng, c.lat], c.zoom);
      const [x, y] = project(p, c.zoom);
      const [mx, my] = centre();
      return [x - cx + mx, y - cy + my];
    },
    toLngLat(x, y) {
      const c = cam || { lat: 0, lng: 0, zoom: 2 };
      const [cx, cy] = project([c.lng, c.lat], c.zoom);
      const [mx, my] = centre();
      return unproject([cx + x - mx, cy + y - my], c.zoom);
    },
    onChange(redraw) {
      let last = location.href;
      setInterval(() => {
        if (location.href === last) return;
        last = location.href;
        const next = cameraNow();
        overlay.setDimmed(false);
        // Globe, 3D and satellite views write a camera that is not Web
        // Mercator; keep the last view and say why the outline is hidden.
        if (next) cam = next;
        host.style.display = next ? "block" : "none";
        toast.textContent = t.satellite;
        toast.style.display = !next && currentShown ? "block" : "none";
        redraw();
      }, 120);
      addEventListener("resize", redraw);
    },
  };

  const overlay = new Overlay(view);
  // the map must keep getting the wheel and the clicks next to the outline
  overlay.setPassThrough(true);
  const guard = (e: Event) => {
    if (!overlay.pointer(e)) return;
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchmove", "touchend"]) {
    addEventListener(type, guard, { capture: true, passive: false });
  }
  addEventListener(
    "wheel",
    (e) => {
      if (!overlay.wheel(e)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    { capture: true, passive: false }
  );
  overlay.onMoved = (center, rotation) => savePosition(center, rotation);

  // the map moves under the outline before the URL says so: dim it meanwhile
  addEventListener("pointerdown", (e) => !overlay.busy && !overlay.hit(e.clientX, e.clientY) && overlay.setDimmed(true), true);
  addEventListener("wheel", () => overlay.setDimmed(true), { capture: true, passive: true });
  addEventListener("pointerup", () => setTimeout(() => overlay.setDimmed(false), 600), true);

  /** Zoom level that fits a bbox into the map box, with some margin. */
  const fitZoom = ([south, north, west, east]: [number, number, number, number]) => {
    const r = s.mapRect();
    const [x1, y1] = project([west, north], 0);
    const [x2, y2] = project([east, south], 0);
    const z = Math.log2(Math.min((r.width * 0.7) / Math.max(1e-9, Math.abs(x2 - x1)), (r.height * 0.7) / Math.max(1e-9, Math.abs(y2 - y1))));
    return Math.max(2, Math.min(18, z));
  };

  async function apply(c: Current | null) {
    if (!c) {
      overlay.clear();
      currentShown = false;
      return;
    }
    currentShown = true;
    overlay.show(c.info, c.position?.center, c.position?.rotation || 0);
    // A newly picked city: move this map there, so the outline starts on its city.
    if (c.flyId && c.bbox && document.visibilityState === "visible") {
      const [south, north, west, east] = c.bbox;
      const at: LngLat = [(west + east) / 2, (south + north) / 2];
      await setCurrent({ ...c, flyId: undefined });
      s.fly({ lat: at[1], lng: at[0], zoom: fitZoom(c.bbox) });
    }
  }

  getCurrent().then(apply);
  watchCurrent(apply);
  // a city picked while this tab was in the background: fly once it is shown
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") getCurrent().then((c) => {
        if (c?.flyId) apply(c);
      });
  });

  browser.runtime.onMessage.addListener(async (msg: unknown) => {
    const m = msg as { type: string; by?: number };
    if (m.type === "ping") return { ok: true, site: s.id, camera: !!cam };
    if (m.type === "rotate") overlay.rotate(m.by || 0);
    if (m.type === "lasso") {
      // answer at once (the popup closes right away), then let the user draw
      toast.textContent = t.lassoHint;
      toast.style.display = "block";
      overlay.lasso().then(async (shape) => {
        toast.style.display = "none";
        if (shape) await setCurrent({ info: lassoInfo(shape) });
      });
    }
    return { ok: true };
  });
}
