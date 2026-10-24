// The map pages the outline can sit on. None of them lets other scripts reach
// its map object, but all keep the camera in the URL, and all use Web
// Mercator with 256-px tiles — so the camera, the map's box on the page and a
// way to fly somewhere are all the overlay needs from a site.

export interface Camera {
  lat: number;
  lng: number;
  zoom: number;
}

export interface Site {
  id: string;
  /** does this page belong to the site? */
  matches(url: URL): boolean;
  /** the camera from the current URL; null = a view we can't overlay (globe, 3D, …) */
  camera(url: URL): Camera | null;
  /** the map's box on the page (the URL's centre is this box's centre) */
  mapRect(): DOMRect;
  /** move the map to a camera */
  fly(cam: Camera): void;
}

const num = (s: string | undefined) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : NaN);
const windowRect = () => new DOMRect(0, 0, innerWidth, innerHeight);

export const google: Site = {
  id: "google",
  matches: (u) => /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/maps"),
  camera(u) {
    const m = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/);
    return m ? { lat: num(m[1]), lng: num(m[2]), zoom: num(m[3]) } : null;
  },
  mapRect: windowRect,
  fly: (c) => location.assign(`${location.origin}/maps/@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${c.zoom.toFixed(2)}z`),
};

// openstreetmap.org: #map=zoom/lat/lng, map in #map next to the sidebar; it
// follows hash changes without a reload.
export const osm: Site = {
  id: "osm",
  matches: (u) => /(^|\.)openstreetmap\.org$/.test(u.hostname),
  camera(u) {
    const m = u.hash.match(/map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    return m ? { zoom: num(m[1]), lat: num(m[2]), lng: num(m[3]) } : null;
  },
  mapRect: () => document.getElementById("map")?.getBoundingClientRect() || windowRect(),
  fly: (c) => {
    location.hash = `map=${Math.round(c.zoom)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
  },
};

export const SITES = [google, osm];

export function siteFor(href: string): Site | null {
  try {
    const u = new URL(href);
    return SITES.find((s) => s.matches(u)) || null;
  } catch {
    return null;
  }
}
