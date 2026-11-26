#!/usr/bin/env node
// LuaLaTeX (luaotfload, fontspec defaults) metrics for OpenType fonts that
// the editor loads at runtime. The runtime builder
// (packages/core/src/text/tex/fonts/runtime-opentype.ts) is checked against
// this oracle by test/runtime-opentype-fonts.spec.ts.
//
//   node scripts/generate-runtime-font-oracle.mjs [Font-File.otf ...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(repoRoot, "test", "fixtures", "fonts", "runtime-opentype-oracle.json");
const DEFAULT_FONTS = ["Lato-Light.ttf", "Lato-Regular.ttf", "Lato-LightItalic.ttf", "Raleway-Regular.otf", "Raleway-Bold.otf"];
const PAIR_CODES = [
  ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => 0x21 + index),
  0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014,
];
const METRIC_CODES = [0x20, ...PAIR_CODES, 0xe9, 0xfc, 0xdf, 0xc5, 0x2026, 0xfb01, 0xfb02];
const LIGATURES = ["ff", "fi", "fl", "ffi", "ffl", "fj"];

function probe(fontPath) {
  const dir = mkdtempSync(join(tmpdir(), "runtime-font-oracle-"));
  try {
    const hex = code => `\\char"${code.toString(16).toUpperCase()}`;
    const pairs = PAIR_CODES.flatMap(left => PAIR_CODES.map(right =>
      `\\setbox\\probe=\\hbox{${hex(left)}${hex(right)}}\\directlua{pair(${left},${right})}`));
    const ligatures = LIGATURES.map(text => `\\setbox\\probe=\\hbox{${text}}\\directlua{lig("${text}")}`);
    // Lua lives in its own file: inside \directlua, TeX would read `%` as a comment.
    const lua = `local f = font.getfont(font.current())
local size = f.size
local p = f.parameters
texio.write_nl(string.format("ORACLE param space %.9f stretch %.9f shrink %.9f xheight %.9f quad %.9f", p.space/size, p.space_stretch/size, p.space_shrink/size, p.x_height/size, p.quad/size))
for _, code in ipairs({${METRIC_CODES.join(",")}}) do
  local c = f.characters[code]
  if c then texio.write_nl(string.format("ORACLE char %d %.9f %.9f %.9f", code, (c.width or 0)/size, (c.height or 0)/size, (c.depth or 0)/size)) end
end
function pair(left, right)
  local kern = 0
  for n in node.traverse(tex.box.probe.list) do
    if n.id == node.id("kern") then kern = kern + n.kern end
  end
  if kern ~= 0 then texio.write_nl(string.format("ORACLE kern %d %d %.9f", left, right, kern/size)) end
end
function lig(text)
  local codes = {}
  for n in node.traverse(tex.box.probe.list) do
    if n.id == node.id("glyph") then codes[#codes+1] = tostring(n.char) end
  end
  texio.write_nl("ORACLE lig " .. text .. " " .. table.concat(codes, ","))
end
`;
    writeFileSync(join(dir, "oracle.lua"), lua);
    const source = String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{${basename(fontPath)}}[Path=${dirname(fontPath)}/]
\newbox\probe
\begin{document}
\directlua{dofile("oracle.lua")}
${ligatures.join("\n")}
${pairs.join("%\n")}
\end{document}
`;
    writeFileSync(join(dir, "oracle.tex"), source);
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "oracle.tex"], { cwd: dir, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
    const log = readFileSync(join(dir, "oracle.log"), "utf8").replace(/\n(?!ORACLE|\(|\)|!|l\.)/gu, "");
    const result = { file: basename(fontPath), params: {}, chars: {}, kerns: [], ligatures: {} };
    for (const line of log.split("\n")) {
      const fields = line.trim().split(/\s+/u);
      if (fields[0] !== "ORACLE") continue;
      if (fields[1] === "param") for (let index = 2; index + 1 < fields.length; index += 2) result.params[fields[index]] = Number(fields[index + 1]);
      if (fields[1] === "char") result.chars[fields[2]] = { width: Number(fields[3]), height: Number(fields[4]), depth: Number(fields[5]) };
      if (fields[1] === "kern") result.kerns.push([Number(fields[2]), Number(fields[3]), Number(fields[4])]);
      if (fields[1] === "lig") result.ligatures[fields[2]] = (fields[3] ?? "").split(",").filter(Boolean).map(Number);
    }
    return result;
  } finally {
    if (!process.env.KEEP_ORACLE_DIR) rmSync(dir, { recursive: true, force: true }); else process.stderr.write(`kept ${dir}\n`);
  }
}

const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FONTS;
const fonts = names.map(name => {
  const path = execFileSync("kpsewhich", [name], { encoding: "utf8" }).trim();
  if (!path) throw new Error(`kpsewhich could not find ${name}`);
  process.stderr.write(`[runtime-font-oracle] ${name}\n`);
  return probe(path);
});
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({ generatedBy: "scripts/generate-runtime-font-oracle.mjs", fonts }, null, 1)}\n`);
process.stderr.write(`[runtime-font-oracle] wrote ${OUTPUT}\n`);
