// The draggable outline, shared by the Google Maps tab and our own map page.
// It only needs a View that converts between lng/lat and pixels of the map
// container; everything else — drawing, true-size dragging, rotation, the
// label, the lasso — lives here.
//
// Dragging moves the shape's centre to follow the pointer; the outline is
// rebuilt from its distance/bearing template on every frame (geo.relocate),
// so it visibly grows towards the poles and shrinks towards the equator.
import { MAX_LAT, areaKm2, centroid, relocate, simplify, template, type LngLat, type Shape, type Template } from "./geo.ts";
import { formatArea } from "./geo.ts";
import { lang, t } from "./i18n.ts";

export interface View {
  /** pixels inside `container` */
  toPixel(p: LngLat): [number, number];
  toLngLat(x: number, y: number): LngLat;
  container: HTMLElement;
  /** call `redraw` whenever the map moves */
  onChange(redraw: () => void): void;
}

export interface ShapeInfo {
  name: string;
  shape: Shape;
  areaKm2: number;
  population: number | null;
  populationYear: string | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export class Overlay {
  private svg: SVGSVGElement;
  private path: SVGPathElement;
  private label: HTMLDivElement;
  private lassoLayer: HTMLDivElement;
  private tpl: Template | null = null;
  private info: ShapeInfo | null = null;
  private center: LngLat = [0, 0];
  private rotation = 0;
  private frame = 0;
  onMoved?: (center: LngLat, rotation: number) => void;

  constructor(private view: View) {
    const host = view.container;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "cc-overlay");
    Object.assign(this.svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "1000", overflow: "visible" });
    this.path = document.createElementNS(SVG_NS, "path");
    this.path.setAttribute("fill-rule", "evenodd");
    Object.assign(this.path.style, { fill: "rgba(255, 92, 66, 0.28)", stroke: "#ff5c42", strokeWidth: "2.5", strokeLinejoin: "round", pointerEvents: "visiblePainted", cursor: "grab", touchAction: "none" });
    this.svg.appendChild(this.path);
    this.label = document.createElement("div");
    this.label.className = "cc-label";
    Object.assign(this.label.style, {
      position: "absolute",
      zIndex: "1001",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      font: "600 12px/1.35 system-ui, sans-serif",
      color: "#fff",
      background: "rgba(20, 24, 38, 0.82)",
      padding: "4px 8px",
      borderRadius: "8px",
      whiteSpace: "nowrap",
      textAlign: "center",
      display: "none",
    });
    this.lassoLayer = document.createElement("div");
    // pointer-events is inherited: on Google Maps the host has "none", so the
    // layer must switch it back on explicitly or it never receives a stroke
    Object.assign(this.lassoLayer.style, { position: "absolute", inset: "0", zIndex: "1002", cursor: "crosshair", display: "none", touchAction: "none", pointerEvents: "auto" });
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(this.svg, this.label, this.lassoLayer);
    this.bindPointer();
    view.onChange(() => this.schedule());
  }

  /** Show a shape at its own place (the city where it really is). */
  show(info: ShapeInfo, at?: LngLat, rotation = 0) {
    this.info = info;
    this.tpl = template(info.shape);
    this.center = at || this.tpl.center;
    this.rotation = rotation;
    this.schedule();
  }

  clear() {
    this.info = null;
    this.tpl = null;
    this.path.setAttribute("d", "");
    this.label.style.display = "none";
  }

  rotate(by: number) {
    this.rotation += by;
    this.schedule();
    this.onMoved?.(this.center, this.rotation);
  }

  get current() {
    return this.info ? { center: this.center, rotation: this.rotation } : null;
  }

  /** whether a DOM event target belongs to the overlay (its outline or lasso layer) */
  owns(target: EventTarget | null) {
    return target === this.path || target === this.lassoLayer;
  }

  setDimmed(dim: boolean) {
    this.svg.style.opacity = dim ? "0.35" : "1";
  }

  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    if (!this.tpl || !this.info) return;
    const shape = relocate(this.tpl, this.center, this.rotation);
    const cx = this.center[0];
    let d = "";
    for (const ring of shape) {
      ring.forEach(([lng, lat], i) => {
        // keep the shape on the centre's side of the antimeridian
        const l = lng - cx > 180 ? lng - 360 : lng - cx < -180 ? lng + 360 : lng;
        const [x, y] = this.view.toPixel([l, lat]);
        d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      });
      d += "Z";
    }
    this.path.setAttribute("d", d);
    const [lx, ly] = this.view.toPixel(this.center);
    const pop = this.info.population;
    const density = pop ? Math.round(pop / this.info.areaKm2).toLocaleString(lang) : "";
    this.label.innerHTML = "";
    const name = document.createElement("div");
    name.textContent = this.info.name;
    const facts = document.createElement("div");
    facts.style.fontWeight = "400";
    facts.textContent = [formatArea(this.info.areaKm2, lang), pop ? `${compact(pop)} ${t.people}` : "", pop ? `${density} ${t.perKm2}` : ""].filter(Boolean).join(" · ");
    this.label.append(name, facts);
    Object.assign(this.label.style, { left: `${lx}px`, top: `${ly}px`, display: "block" });
  }

  // ---- pointer handling (drag + lasso) ----
  // One handler for both gestures. The map page feeds it from listeners on
  // the overlay's own elements. On Google Maps that is not enough: Google
  // listens on the window in the capture phase, so it would pan the map under
  // the same drag — and once the URL caught up, the outline jumped off-screen.
  // There the content script registers window capture listeners before
  // Google's code runs and calls pointer() first; true means "ours, stop it".
  private drag: { x: number; y: number; px: [number, number]; id: number } | null = null;
  private lassoPoints: Array<[number, number]> = [];
  private lassoActive = false;
  private trail = document.createElementNS(SVG_NS, "polyline");
  private lassoDone?: (s: Shape | null) => void;

  get busy() {
    return !!this.drag || this.lassoActive;
  }

  // Pass-through mode (Google Maps): the outline takes no pointer events, so
  // the wheel, clicks and pans next to it — and the wheel over it — all reach
  // Google's map. Whether a press starts a drag is decided by geometry
  // (isPointInFill) in pointer(), which the content script calls first.
  private passThrough = false;
  private hovering = false;
  private swallowClickUntil = 0;
  private cursorStyle: HTMLStyleElement | null = null;

  setPassThrough(on: boolean) {
    this.passThrough = on;
    this.path.style.pointerEvents = on ? "none" : "visiblePainted";
  }

  /** Is this viewport point inside the outline's fill? */
  hit(clientX: number, clientY: number) {
    if (!this.tpl) return false;
    const r = this.svg.getBoundingClientRect();
    try {
      return this.path.isPointInFill(new DOMPoint(clientX - r.left, clientY - r.top));
    } catch {
      return false;
    }
  }

  private isOurs(e: Event) {
    if (!this.passThrough) return this.owns(e.target);
    const pe = e as MouseEvent;
    return typeof pe.clientX === "number" && this.hit(pe.clientX, pe.clientY);
  }

  // Google sets its own cursor on the map; while over the outline a page-wide
  // rule shows "grab" instead, so the outline still feels draggable.
  private setCursor(value: "" | "grab" | "grabbing") {
    if (!this.passThrough) {
      this.path.style.cursor = value === "grabbing" ? "grabbing" : "grab";
      return;
    }
    if (!value) {
      this.cursorStyle?.remove();
      this.cursorStyle = null;
      return;
    }
    if (!this.cursorStyle) {
      this.cursorStyle = document.createElement("style");
      (document.head || document.documentElement).appendChild(this.cursorStyle);
    }
    this.cursorStyle.textContent = `* { cursor: ${value} !important; }`;
  }

  /** Handle a pointer/mouse/touch event; returns true when the overlay used it. */
  pointer(e: Event): boolean {
    const type = e.type;
    const pe = e as PointerEvent;
    if (this.lassoActive) {
      if (type === "pointerdown") this.lassoDown(pe);
      else if (type === "pointermove") this.lassoMove(pe);
      else if (type === "pointerup" || type === "pointercancel") this.lassoUp();
      return true;
    }
    if (type === "pointerdown") {
      if (!this.tpl || !this.isOurs(e)) return false;
      this.drag = { x: pe.clientX, y: pe.clientY, px: this.view.toPixel(this.center), id: pe.pointerId };
      this.setCursor("grabbing");
      try {
        this.path.setPointerCapture(pe.pointerId);
      } catch {
        /* window listeners keep tracking the pointer anyway */
      }
      return true;
    }
    if (type === "pointermove" && this.drag) {
      const [lng, lat] = this.view.toLngLat(this.drag.px[0] + pe.clientX - this.drag.x, this.drag.px[1] + pe.clientY - this.drag.y);
      this.center = [((lng + 540) % 360) - 180, Math.max(-MAX_LAT + 1, Math.min(MAX_LAT - 1, lat))];
      this.schedule();
      return true;
    }
    if ((type === "pointerup" || type === "pointercancel") && this.drag) {
      this.drag = null;
      this.swallowClickUntil = Date.now() + 400;
      this.setCursor(this.hit(pe.clientX, pe.clientY) ? "grab" : "");
      this.onMoved?.(this.center, this.rotation);
      return true;
    }
    if (type === "pointermove" && this.passThrough) {
      const over = this.hit(pe.clientX, pe.clientY);
      if (over !== this.hovering) {
        this.hovering = over;
        this.setCursor(over ? "grab" : "");
      }
      return false; // hovering must not stop Google from seeing the mouse
    }
    // the mouse/touch twins of a drag that is ours, and the click that ends it
    if (this.drag) return true;
    if ((type === "click" || type === "dblclick") && Date.now() < this.swallowClickUntil) return true;
    return this.passThrough ? (type === "mousedown" || type === "touchstart") && this.isOurs(e) : this.owns(e.target);
  }

  /** Alt + wheel over the outline rotates it; returns true when used. */
  wheel(e: WheelEvent): boolean {
    if (!e.altKey || !this.isOurs(e)) return false;
    this.rotate((Math.sign(e.deltaY) * 5 * Math.PI) / 180);
    return true;
  }

  private bindPointer() {
    Object.assign(this.trail.style, { fill: "rgba(66, 140, 255, 0.18)", stroke: "#428cff", strokeWidth: "2", strokeDasharray: "6 4" });
    const use = (e: Event) => {
      if (this.pointer(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    for (const el of [this.path, this.lassoLayer]) {
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) el.addEventListener(type, use);
    }
    this.path.addEventListener(
      "wheel",
      (e) => {
        if (this.wheel(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { passive: false }
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.lassoActive) this.finishLasso(null);
    });
  }

  // ---- lasso ----

  /** Let the user draw an area; resolves with the shape (or null when cancelled). */
  lasso(): Promise<Shape | null> {
    this.lassoActive = true;
    this.lassoLayer.style.display = "block";
    return new Promise((resolve) => (this.lassoDone = resolve));
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.view.container.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private lassoDown(e: PointerEvent) {
    try {
      this.lassoLayer.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.lassoPoints = [this.local(e)];
    this.svg.appendChild(this.trail);
  }

  private lassoMove(e: PointerEvent) {
    if (!this.lassoPoints.length) return;
    const p = this.local(e);
    const last = this.lassoPoints[this.lassoPoints.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
    this.lassoPoints.push(p);
    this.trail.setAttribute("points", this.lassoPoints.map((q) => q.join(",")).join(" "));
  }

  private lassoUp() {
    if (this.lassoPoints.length < 8) return this.finishLasso(null);
    const ring = this.lassoPoints.map(([x, y]) => this.view.toLngLat(x, y));
    ring.push(ring[0]);
    this.finishLasso(simplify([ring], 600));
  }

  private finishLasso(shape: Shape | null) {
    this.lassoActive = false;
    this.lassoLayer.style.display = "none";
    this.trail.remove();
    this.lassoPoints = [];
    this.lassoDone?.(shape);
    this.lassoDone = undefined;
  }
}

export function lassoInfo(shape: Shape): ShapeInfo {
  return { name: t.myArea, shape, areaKm2: areaKm2(shape), population: null, populationYear: null };
}

export function compact(n: number) {
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export { centroid };
