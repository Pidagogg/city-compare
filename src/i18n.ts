// English and Russian UI texts; the browser language picks one.
const en = {
  name: "City Compare",
  search: "Search a city…",
  searching: "Searching…",
  noResults: "No city with an outline found.",
  people: "people",
  perKm2: "/ km²",
  showHere: "Show on this map",
  openMap: "Open the map page",
  onlyGoogle: "Open Google Maps or OpenStreetMap in this tab to put the outline on it — or use the map page.",
  savedNoMap: "Saved. Open Google Maps or OpenStreetMap (or the map page) to see it.",
  drag: "Drag the outline anywhere — it keeps its true size.",
  lasso: "Draw an area",
  lassoHint: "Hold and draw around an area, then release.",
  myArea: "My area",
  rotate: "Rotate",
  clear: "Clear",
  satellite: "City Compare: the outline is hidden in globe, 3D and satellite view — zoom in a little or switch Layers to the map view.",
  promoTitle: "W flow — automate your busywork",
  promo: "Connect 100+ apps and AI by dragging blocks, no code. Free to start →",
  source: "Outlines and population: © OpenStreetMap contributors, Wikidata",
};
const ru: typeof en = {
  name: "City Compare",
  search: "Найти город…",
  searching: "Ищем…",
  noResults: "Город с границами не найден.",
  people: "жителей",
  perKm2: "/ км²",
  showHere: "Показать на этой карте",
  openMap: "Открыть страницу карты",
  onlyGoogle: "Откройте в этой вкладке Google Карты или OpenStreetMap, чтобы показать контур там, — или используйте страницу карты.",
  savedNoMap: "Сохранено. Откройте Google Карты или OpenStreetMap (или страницу карты), чтобы увидеть контур.",
  drag: "Перетащите контур куда угодно — он сохраняет реальный размер.",
  lasso: "Нарисовать область",
  lassoHint: "Зажмите и обведите область, затем отпустите.",
  myArea: "Моя область",
  rotate: "Повернуть",
  clear: "Убрать",
  satellite: "City Compare: в режимах глобуса, 3D и спутника контур скрыт — немного приблизьте карту или выберите в «Слоях» обычную карту.",
  promoTitle: "W flow — автоматизируйте рутину",
  promo: "Соединяйте 100+ сервисов и ИИ из блоков, без кода. Бесплатный старт →",
  source: "Границы и население: © участники OpenStreetMap, Wikidata",
};
export type Texts = typeof en;
export const lang = /^ru|^uk|^be|^kk/i.test(navigator.language || "") ? "ru" : "en";
export const t: Texts = lang === "ru" ? ru : en;
// where the click came from (popup or map page) shows up as utm_content
export const promoUrl = (place: string) => `https://w-flow.tech/?utm_source=city-compare&utm_medium=extension&utm_content=${place}`;
