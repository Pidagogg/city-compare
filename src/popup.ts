// The toolbar popup: search a city and show it on the map the user is on
// (Google Maps, OpenStreetMap). It never takes the user anywhere else — the
// extension's own map page opens only from its button.
//
// A tab that was open before the extension was installed or reloaded has no
// content script yet, and a browser may hold back site access (Firefox does
// by default). Opening the popup grants activeTab for the current tab, so the
// popup injects the content script itself in that case.
import browser from "webextension-polyfill";
import { promoUrl, t } from "./i18n.ts";
import { mountSearch } from "./searchUi.ts";
import { setCurrent } from "./store.ts";

const app = document.getElementById("app")!;
const title = document.createElement("h1");
title.textContent = t.name;
const searchBox = document.createElement("div");
const status = document.createElement("p");
status.className = "cc-hint";
const tools = document.createElement("div");
tools.className = "cc-tools";
app.append(title, searchBox, status, tools);

async function ping(tabId: number) {
  try {
    const r = (await browser.tabs.sendMessage(tabId, { type: "ping" })) as { ok?: boolean } | undefined;
    return !!r?.ok;
  } catch {
    return false;
  }
}

/** The active tab, if it shows a supported map and the overlay is running there. */
async function mapTab(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  if (await ping(tab.id)) return tab.id;
  try {
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    return null; // not a page we may touch (browser pages, the store, …)
  }
  // content.js only starts on supported map sites; the ping tells
  return (await ping(tab.id)) ? tab.id : null;
}

const openMapPage = () => browser.tabs.create({ url: browser.runtime.getURL("map.html") });

const button = (label: string, onClick: () => void, disabled = false) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  tools.append(b);
  return b;
};

(async () => {
  const tabId = await mapTab();
  status.textContent = tabId ? t.drag : t.onlyGoogle;
  mountSearch(searchBox, async (p) => {
    await setCurrent({
      info: { name: p.name, shape: p.shape, areaKm2: p.areaKm2, population: p.population, populationYear: p.populationYear },
      bbox: p.bbox,
      flyId: p.id,
    });
    if (tabId) window.close();
    else status.textContent = t.savedNoMap;
  });
  button(
    t.lasso,
    async () => {
      if (!tabId) return;
      await browser.tabs.sendMessage(tabId, { type: "lasso" }).catch(() => {});
      window.close();
    },
    !tabId
  );
  if (tabId) {
    button(`${t.rotate} ↺`, () => browser.tabs.sendMessage(tabId, { type: "rotate", by: (-15 * Math.PI) / 180 }));
    button(`${t.rotate} ↻`, () => browser.tabs.sendMessage(tabId, { type: "rotate", by: (15 * Math.PI) / 180 }));
  }
  button(t.clear, () => setCurrent(null));
  button(t.openMap, () => openMapPage());

  // one small, dismissible card — never in the way
  const { promoHidden } = await browser.storage.local.get("promoHidden");
  if (!promoHidden) {
    const promo = document.createElement("div");
    promo.className = "cc-promo";
    const link = document.createElement("a");
    link.href = promoUrl("popup");
    link.target = "_blank";
    link.rel = "noopener";
    const title = document.createElement("b");
    title.textContent = t.promoTitle;
    link.append(title, document.createElement("br"), t.promo);
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = "Hide";
    x.addEventListener("click", () => {
      browser.storage.local.set({ promoHidden: true });
      promo.remove();
    });
    promo.append(link, x);
    app.append(promo);
  }
})();
