// The one shape the user is comparing, shared by the popup, the Google Maps
// tab and the map page through extension storage (local to this browser).
import browser from "webextension-polyfill";
import type { LngLat } from "./geo.ts";
import type { ShapeInfo } from "./overlay.ts";

export interface Current {
  info: ShapeInfo;
  bbox?: [number, number, number, number];
  /** where the user dragged it; absent = at its own place */
  position?: { center: LngLat; rotation: number };
  /** set when a new shape was picked: views fly to it once */
  flyId?: string;
}

const KEY = "current";

export async function getCurrent(): Promise<Current | null> {
  return ((await browser.storage.local.get(KEY))[KEY] as Current | undefined) || null;
}

export async function setCurrent(c: Current | null) {
  if (c) await browser.storage.local.set({ [KEY]: c });
  else await browser.storage.local.remove(KEY);
}

export async function savePosition(center: LngLat, rotation: number) {
  const c = await getCurrent();
  if (c) await browser.storage.local.set({ [KEY]: { ...c, position: { center, rotation }, flyId: undefined } });
}

export function watchCurrent(cb: (c: Current | null) => void) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && KEY in changes) cb((changes[KEY].newValue as Current | undefined) || null);
  });
}
