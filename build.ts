/**
 * build.ts — compiles the TypeScript sources into a `dist/` directory.
 *
 *   node build.ts            # writes ./dist/index.html + ./dist/app.js
 *   npm run build
 *
 * The output is two files and nothing else: `index.html` (markup + inlined CSS)
 * and `app.js` (the simulation). Zero dependencies: type-stripping uses Node's
 * built-in `module.stripTypeScriptTypes` (Node >= 22.13 / 23.x / 24). The
 * simulation in src/main.ts uses only type annotations (no
 * enums/namespaces/decorators), so stripping is a complete and faithful
 * transpile to browser JavaScript.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import mod from "node:module";
import { renderHTML } from "./src/template.ts";

const root = process.cwd();
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

// ---- Inputs ----------------------------------------------------------------
const css = read("src/styles.css");
const mainTs = read("src/main.ts");

// ---- Transpile: strip TypeScript types -> browser JS -----------------------
type Stripper = (code: string, opts?: { mode?: "strip" | "transform" }) => string;
const strip = (mod as unknown as { stripTypeScriptTypes?: Stripper }).stripTypeScriptTypes;
if (typeof strip !== "function") {
  console.error(
    "Error: node:module.stripTypeScriptTypes is unavailable.\n" +
    "Upgrade Node to >= 22.13 (24.x recommended) and retry.",
  );
  process.exit(1);
}
const js = strip(mainTs, { mode: "strip" });

// ---- Assemble & write ------------------------------------------------------
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
  timeZoneName: "short",
}).formatToParts(new Date());
const part = (t: string): string => parts.find(p => p.type === t)?.value ?? "";
const builtAt =
  `${part("year")}-${part("month")}-${part("day")} ` +
  `${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
const scriptName = "app.js";
// Cache-bust the script URL so browsers fetch the fresh build, not a stale
// cached app.js. The token is the build epoch (ms); changes every build.
const scriptSrc = `${scriptName}?v=${Date.now()}`;
const html = renderHTML({ css, scriptSrc, builtAt });

const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html, "utf8");
writeFileSync(join(outDir, scriptName), js, "utf8");

const kb = (n: number): string => (n / 1024).toFixed(1);
console.log(
  `✓ Built dist/  (index.html ${kb(html.length)} KB + ${scriptName} ${kb(js.length)} KB, ${bodyCount()} bodies)`,
);

function bodyCount(): number {
  // crude count of the DEFS rows, purely for a friendlier build log
  const m = mainTs.match(/const DEFS:[^=]*=\s*\[([\s\S]*?)\];/);
  return m ? (m[1].match(/\["/g) || []).length : 0;
}
