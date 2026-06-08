#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_FONTS = [
  "cmr10",
  "cmbx10",
  "cmti10",
  "cmbxti10",
  "cmtt10",
  "cmss10",
  "cmssi10",
  "cmssbx10",
  "cmcsc10",
];
const outputPath = resolve(
  process.cwd(),
  "packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.ts"
);

const atomPattern = /^(?<kind>[CODH])\s+(?<value>.+)$/;
const charStartPattern = /^\s*\(CHARACTER\s+(?<atom>.+)$/;
const metricPattern = /^\s*\((?<kind>CHARWD|CHARHT|CHARDP|CHARIC)\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const fontdimenPattern = /^\s*\((?<name>[A-Z]+)\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const labelPattern = /^\s*\(LABEL\s+(?<atom>.+)\)/;
const plAtomSource = String.raw`(?:C\s+.|O\s+[0-7]+|D\s+\d+|H\s+[0-9A-Fa-f]+)`;
const ligPattern = new RegExp(
  String.raw`^\s*\(LIG\s+(?<right>${plAtomSource})\s+(?<out>${plAtomSource})\)`
);
const kernPattern = new RegExp(
  String.raw`^\s*\(KRN\s+(?<right>${plAtomSource})\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)`
);
const designSizePattern = /^\(DESIGNSIZE\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const checksumPattern = /^\(CHECKSUM\s+O\s+(?<value>[0-7]+)\)/;
const codingSchemePattern = /^\(CODINGSCHEME\s+(?<value>.+)\)/;
const familyPattern = /^\(FAMILY\s+(?<value>.+)\)/;

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function parseAtom(raw) {
  const normalized = raw.trim().replace(/\)+$/, "");
  const match = atomPattern.exec(normalized);
  if (!match?.groups) {
    throw new Error(`Unsupported PL atom: ${raw}`);
  }
  const value = match.groups.value;
  switch (match.groups.kind) {
    case "C":
      return value.codePointAt(0) ?? 0;
    case "O":
      return Number.parseInt(value, 8);
    case "D":
      return Number.parseInt(value, 10);
    case "H":
      return Number.parseInt(value, 16);
    default:
      throw new Error(`Unsupported PL atom kind: ${match.groups.kind}`);
  }
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function parsePl(pl) {
  const font = {
    family: "",
    codingScheme: "",
    checksum: "",
    designSize: 10,
    fontdimen: {},
    chars: {},
    ligKerns: [],
  };
  let currentChar = null;
  let inFontdimen = false;
  let currentLabels = [];

  for (const line of pl.split(/\r?\n/)) {
    const family = familyPattern.exec(line);
    if (family?.groups) {
      font.family = family.groups.value;
      continue;
    }
    const codingScheme = codingSchemePattern.exec(line);
    if (codingScheme?.groups) {
      font.codingScheme = codingScheme.groups.value;
      continue;
    }
    const designSize = designSizePattern.exec(line);
    if (designSize?.groups) {
      font.designSize = Number(designSize.groups.value);
      continue;
    }
    const checksum = checksumPattern.exec(line);
    if (checksum?.groups) {
      font.checksum = checksum.groups.value;
      continue;
    }

    if (line.trim().startsWith("(FONTDIMEN")) {
      inFontdimen = true;
      continue;
    }
    if (inFontdimen) {
      if (line.trim() === ")") {
        inFontdimen = false;
        continue;
      }
      const metric = fontdimenPattern.exec(line);
      if (metric?.groups) {
        font.fontdimen[metric.groups.name.toLowerCase()] = roundMetric(Number(metric.groups.value));
      }
      continue;
    }

    const charStart = charStartPattern.exec(line);
    if (charStart?.groups) {
      const code = parseAtom(charStart.groups.atom);
      currentChar = { code };
      font.chars[code] = currentChar;
      continue;
    }
    if (currentChar) {
      const metric = metricPattern.exec(line);
      if (metric?.groups) {
        const key = {
          CHARWD: "width",
          CHARHT: "height",
          CHARDP: "depth",
          CHARIC: "italicCorrection",
        }[metric.groups.kind];
        currentChar[key] = roundMetric(Number(metric.groups.value));
        continue;
      }
      if (line.trim() === ")") {
        currentChar = null;
        continue;
      }
    }

    const label = labelPattern.exec(line);
    if (label?.groups) {
      currentLabels.push(parseAtom(label.groups.atom));
      continue;
    }
    if (line.trim() === "(STOP)") {
      currentLabels = [];
      continue;
    }
    if (currentLabels.length > 0) {
      const lig = ligPattern.exec(line);
      if (lig?.groups) {
        const right = parseAtom(lig.groups.right);
        const out = parseAtom(lig.groups.out);
        for (const left of currentLabels) {
          font.ligKerns.push(["lig", left, right, out]);
        }
        continue;
      }
      const kern = kernPattern.exec(line);
      if (kern?.groups) {
        const right = parseAtom(kern.groups.right);
        const value = roundMetric(Number(kern.groups.value));
        for (const left of currentLabels) {
          font.ligKerns.push(["kern", left, right, value]);
        }
      }
    }
  }

  return font;
}

function generate(fontNames) {
  const fonts = {};
  for (const fontName of fontNames) {
    const tfmPath = run("kpsewhich", [`${fontName}.tfm`]);
    if (!tfmPath) {
      throw new Error(`Could not resolve ${fontName}.tfm through kpsewhich`);
    }
    const pl = execFileSync("tftopl", [tfmPath], { encoding: "utf8" });
    const font = parsePl(pl);
    font.glyphs = extractSvgGlyphPaths(fontName, Object.keys(font.chars).map(Number));
    fonts[fontName] = font;
  }
  return fonts;
}

function texCharList(codes) {
  return codes
    .filter((code) => Number.isInteger(code) && code >= 0 && code <= 255)
    .sort((a, b) => a - b)
    .map((code) => `\\char${code}`)
    .join("");
}

function extractSvgGlyphPaths(fontName, codes) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-glyphs-"));
  try {
    const texSource = `\\nopagenumbers\\font\\f=${fontName} at 10pt\\f ${texCharList(codes)}\\bye\n`;
    writeFileSync(join(tempDir, "glyphs.tex"), texSource, "utf8");
    execFileSync("tex", ["-interaction=nonstopmode", "glyphs.tex"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    const output = execFileSync(
      "dvisvgm",
      ["--no-fonts", "--exact-bbox", "--stdout", "glyphs.dvi"],
      { cwd: tempDir, encoding: "utf8" }
    );
    const xmlStart = output.indexOf("<?xml");
    const svg = xmlStart >= 0 ? output.slice(xmlStart) : output;
    const glyphs = {};
    const pathPattern = /<path\s+id='g0-(\d+)'\s+d='([^']*)'\/>/g;
    let match = pathPattern.exec(svg);
    while (match) {
      glyphs[match[1]] = match[2];
      match = pathPattern.exec(svg);
    }
    return glyphs;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const fonts = generate(DEFAULT_FONTS);
  const source = `// Generated by scripts/generate-tex-font-data.mjs. Do not edit by hand.
import type { GeneratedTexFontTable } from "../types.js";

export const COMPUTER_MODERN_OT1_FONTS: GeneratedTexFontTable = ${JSON.stringify(fonts, null, 2)};
`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source);
  console.log(`Wrote ${outputPath}`);
}

main();
