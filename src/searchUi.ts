// The search box + result list used by the popup and the map page.
import { formatArea } from "./geo.ts";
import { lang, t } from "./i18n.ts";
import { compact } from "./overlay.ts";
import { searchCities, type Place } from "./osm.ts";

export function mountSearch(root: HTMLElement, onPick: (p: Place) => void) {
  root.innerHTML = "";
  const form = document.createElement("form");
  form.className = "cc-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = t.search;
  input.autofocus = true;
  form.append(input);
  const list = document.createElement("div");
  list.className = "cc-results";
  root.append(form, list);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    list.textContent = t.searching;
    try {
      const places = await searchCities(input.value);
      list.innerHTML = "";
      if (!places.length) list.textContent = t.noResults;
      for (const p of places) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cc-result";
        const name = document.createElement("b");
        name.textContent = p.name;
        const detail = document.createElement("span");
        detail.textContent = [p.detail, formatArea(p.areaKm2, lang), p.population ? `${compact(p.population)} ${t.people}${p.populationYear ? ` (${p.populationYear})` : ""}` : ""]
          .filter(Boolean)
          .join(" · ");
        b.append(name, detail);
        b.addEventListener("click", () => {
          list.innerHTML = "";
          input.value = p.name;
          onPick(p);
        });
        list.append(b);
      }
    } catch (err) {
      list.textContent = String((err as Error).message || err);
    }
  });
  return input;
}
