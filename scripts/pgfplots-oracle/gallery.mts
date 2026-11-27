/**
 * Visual gallery for human review (design/pgfplots.md 5.2, Tier 3): for each
 * pgfplots fixture, the editor's SVG and LuaLaTeX's PDF rasterised at the
 * same scale, side by side (editor left, TeX right).
 *
 *   node --import tsx scripts/pgfplots-oracle/gallery.mts [fixture ...]
 *
 * Output: artifacts/pgfplots-gallery/<name>.png (plus the parts). Needs
 * lualatex, mutool, rsvg-convert and ImageMagick `convert`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderObservedPicture } from "./adapter.js";

const root = resolve(import.meta.dirname, "..", "..");
const fixtures = join(root, "test", "fixtures", "pgfplots");
const out = join(root, "artifacts", "pgfplots-gallery");
mkdirSync(out, { recursive: true });
const DPI = 300;

function run(command: string, args: string[], cwd = out): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

const only = process.argv.slice(2);
const names = readdirSync(fixtures).filter((f) => f.endsWith(".tex")).map((f) => f.slice(0, -4)).filter((n) => only.length === 0 || only.includes(n)).sort();
for (const name of names) {
  const body = readFileSync(join(fixtures, `${name}.tex`), "utf8");
  const picture = await renderObservedPicture(body);
  writeFileSync(join(out, `${name}-editor.svg`), picture.svg);
  run("rsvg-convert", ["-d", String(DPI), "-p", String(DPI), "-z", String(DPI / 72), "-b", "white", "-o", `${name}-editor.png`, `${name}-editor.svg`]);
  writeFileSync(join(out, `${name}-tex.tex`), `\\documentclass[border=0pt]{standalone}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.18}\n\\begin{document}\n${body.trim()}\n\\end{document}\n`);
  run("lualatex", ["-interaction=nonstopmode", "-halt-on-error", `${name}-tex.tex`]);
  run("mutool", ["draw", "-q", "-r", String(DPI), "-o", `${name}-tex.png`, `${name}-tex.pdf`]);
  run("convert", [`${name}-editor.png`, `${name}-tex.png`, "-bordercolor", "white", "-border", "10", "+append", "-background", "white", "-gravity", "north", "-splice", "0x30", "-pointsize", "24", "-annotate", "+0+2", `${name}: editor (left) | LuaLaTeX (right)`, `${name}.png`]);
  console.log(`wrote ${join(out, `${name}.png`)}  diagnostics: ${picture.diagnostics.map((d) => d.code ?? d.message).join(", ") || "none"}`);
}
