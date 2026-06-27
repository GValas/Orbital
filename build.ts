/**
 * build.ts — generates the standalone `index.html` from the TypeScript sources.
 *
 *   node build.ts            # writes ./index.html
 *   npm run build
 *
 * Zero dependencies: type-stripping uses Node's built-in
 * `module.stripTypeScriptTypes` (Node >= 22.13 / 23.x / 24). The simulation in
 * src/main.ts uses only type annotations (no enums/namespaces/decorators), so
 * stripping is a complete and faithful transpile to browser JavaScript.
 */

import { readFileSync, writeFileSync } from "node:fs";
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
const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const html = renderHTML({ css, js, builtAt });
const outPath = join(root, "index.html");
writeFileSync(outPath, html, "utf8");

const kb = (html.length / 1024).toFixed(1);
console.log(`✓ Generated index.html  (${kb} KB, ${bodyCount()} bodies, self-contained)`);

function bodyCount(): number {
  // crude count of the DEFS rows, purely for a friendlier build log
  const m = mainTs.match(/const DEFS:[^=]*=\s*\[([\s\S]*?)\];/);
  return m ? (m[1].match(/\["/g) || []).length : 0;
}
