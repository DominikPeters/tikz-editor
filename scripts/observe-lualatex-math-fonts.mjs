#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index] ?? "";
  if (!arg.startsWith("--")) {
    continue;
  }
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  if (inlineValue !== undefined) {
    args.set(key, inlineValue);
  } else {
    args.set(key, process.argv[index + 1]?.startsWith("--") ? "true" : process.argv[++index] ?? "true");
  }
}

const engine = args.get("engine") ?? "lualatex";
const tempDir = mkdtempSync(join(tmpdir(), "tikz-lualatex-math-fonts-"));

try {
  const texSource = String.raw`\documentclass{article}
\begin{document}
Text $x+1$
\makeatletter
\count@=0
\loop\ifnum\count@<4
\immediate\write16{TIKZ_MATH_FONT role=text family=\the\count@\space name=\fontname\textfont\count@}
\immediate\write16{TIKZ_MATH_FONT role=script family=\the\count@\space name=\fontname\scriptfont\count@}
\immediate\write16{TIKZ_MATH_FONT role=scriptscript family=\the\count@\space name=\fontname\scriptscriptfont\count@}
\advance\count@ by 1
\repeat
\immediate\write16{TIKZ_TEXT_FONT name=\fontname\font}
\makeatother
\end{document}
`;
  writeFileSync(join(tempDir, "fonts.tex"), texSource, "utf8");
  execFileSync(engine, ["--interaction=nonstopmode", "--halt-on-error", "fonts.tex"], {
    cwd: tempDir,
    env: texOracleEnv(),
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
  const log = readFileSync(join(tempDir, "fonts.log"), "utf8");
  const manifest = {
    engine,
    engineVersion: firstLine(execFileSync(engine, ["--version"], { encoding: "utf8" })),
    textFont: null,
    mathFonts: [],
  };
  for (const line of log.split(/\r?\n/)) {
    const math = /^TIKZ_MATH_FONT role=(?<role>\w+) family=(?<family>\d+) name=(?<name>.+)$/.exec(line);
    if (math?.groups) {
      const fontName = normalizeTexFontName(math.groups.name);
      manifest.mathFonts.push({
        role: math.groups.role,
        family: Number(math.groups.family),
        texFontName: math.groups.name,
        normalizedName: fontName,
        file: resolveFontFile(fontName, "tfm"),
      });
      continue;
    }
    const text = /^TIKZ_TEXT_FONT name=(?<name>.+)$/.exec(line);
    if (text?.groups) {
      const fontName = normalizeTexFontName(text.groups.name);
      manifest.textFont = {
        texFontName: text.groups.name,
        normalizedName: fontName,
        file: resolveFontFile(fontName, "opentype"),
      };
    }
  }
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function firstLine(value) {
  return value.split(/\r?\n/, 1)[0] ?? "";
}

function normalizeTexFontName(name) {
  const bracket = /^\[(?<file>[^\]]+)\]/.exec(name);
  if (bracket?.groups) {
    return bracket.groups.file;
  }
  return name.replace(/\s+at\s+.+$/, "").trim();
}

function resolveFontFile(fontName, preferredKind) {
  const candidates = preferredKind === "opentype"
    ? [`${fontName}.otf`, fontName]
    : [`${fontName}.tfm`, fontName];
  for (const candidate of candidates) {
    try {
      return execFileSync("kpsewhich", [candidate], { encoding: "utf8" }).trim() || null;
    } catch {
      continue;
    }
  }
  return null;
}
