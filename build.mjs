// Build City Compare for Chrome and Firefox from one code base.
//   node build.mjs          → dist/chrome, dist/firefox
//   node build.mjs --watch  → rebuild on change
//   node build.mjs --zip    → also city-compare-<browser>-<version>.zip for the stores
// Both stores get unminified bundles plus this script, so reviewers (AMO
// requires it) can rebuild and compare.
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const watch = process.argv.includes("--watch");
const zip = process.argv.includes("--zip");

// Google Maps is served under many country domains; content scripts cannot
// match a wildcard TLD, so the common ones are listed.
const TLDS = ["com", "de", "at", "ch", "co.uk", "fr", "it", "es", "nl", "be", "pl", "se", "ru", "com.ua", "com.tr", "ca", "com.au", "co.in", "com.br", "co.jp", "com.mx"];
const GOOGLE = TLDS.map((t) => `https://www.google.${t}/maps*`);
// other map sites with a URL camera (src/sites.ts)
const MAPS = [...GOOGLE, "https://www.openstreetmap.org/*"];

function manifest(target) {
  const m = {
    manifest_version: 3,
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    version: pkg.version,
    icons: { 16: "icons/16.png", 48: "icons/48.png", 128: "icons/128.png" },
    action: { default_popup: "popup.html", default_icon: { 16: "icons/16.png", 48: "icons/48.png" } },
    // activeTab + scripting: the popup can add the overlay to the map tab the
    // user is on even when the content script is not there yet
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["https://nominatim.openstreetmap.org/*", "https://www.wikidata.org/*", ...MAPS],
    content_scripts: [{ matches: MAPS, js: ["content.js"], run_at: "document_start" }],
  };
  if (target === "firefox") {
    m.browser_specific_settings = { gecko: { id: "city-compare@w-flow.tech", strict_min_version: "115.0", data_collection_permissions: { required: ["none"] } } };
  }
  return m;
}

const LOCALES = {
  en: { extName: "City Compare", extDescription: "Drag a city's real outline anywhere on the map and compare its true size — corrected for latitude." },
  ru: { extName: "City Compare", extDescription: "Перетащите реальный контур города куда угодно на карте и сравните его настоящий размер с учётом широты." },
};

// ---- icons: a tiny PNG encoder, so the build needs no image tools ----
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded square background
      const r = size * 0.22;
      const dx = Math.max(Math.abs(x - c) - (c - r), 0);
      const dy = Math.max(Math.abs(y - c) - (c - r), 0);
      const inside = Math.hypot(dx, dy) <= r;
      if (!inside) continue;
      // two overlapping outlines: one small (left), one big (right)
      const ring = (cx, cy, rad, w) => Math.abs(Math.hypot(x - cx, y - cy) - rad) <= w;
      const w = Math.max(1, size * 0.06);
      const a = ring(size * 0.4, size * 0.55, size * 0.2, w);
      const b = ring(size * 0.6, size * 0.45, size * 0.28, w);
      const [R, G, B] = a || b ? [255, 255, 255] : [255, 92, 66];
      px.set([R, G, B, 255], i);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function writeStatic(out, target) {
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  for (const f of fs.readdirSync("static")) fs.copyFileSync(path.join("static", f), path.join(out, f));
  for (const s of [16, 48, 128]) fs.writeFileSync(path.join(out, "icons", `${s}.png`), png(s));
  for (const [lang, msgs] of Object.entries(LOCALES)) {
    fs.mkdirSync(path.join(out, "_locales", lang), { recursive: true });
    fs.writeFileSync(path.join(out, "_locales", lang, "messages.json"), JSON.stringify(Object.fromEntries(Object.entries(msgs).map(([k, v]) => [k, { message: v }])), null, 2));
  }
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest(target), null, 2));
}

const targets = ["chrome", "firefox"];
for (const target of targets) {
  const out = path.join("dist", target);
  fs.rmSync(out, { recursive: true, force: true });
  writeStatic(out, target);
  const options = {
    entryPoints: { content: "src/content.ts", popup: "src/popup.ts", map: "src/mapPage.ts" },
    outdir: out,
    bundle: true,
    format: "iife",
    target: target === "firefox" ? "firefox115" : "chrome110",
    minify: false,
    sourcemap: false,
    loader: { ".png": "dataurl" },
    logLevel: "warning",
  };
  if (watch) await (await context(options)).watch();
  else await build(options);
}

if (zip && !watch) {
  for (const target of targets) {
    const file = path.resolve(`city-compare-${target}-${pkg.version}.zip`);
    fs.rmSync(file, { force: true });
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.resolve("dist", target)}\\*' -DestinationPath '${file}'`]);
    } else {
      execFileSync("zip", ["-qr", file, "."], { cwd: path.join("dist", target) });
    }
    console.log("wrote", path.basename(file));
  }
}
console.log(watch ? "watching…" : "built dist/chrome and dist/firefox");
