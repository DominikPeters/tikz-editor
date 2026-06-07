#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareTikzRenderers } from "./compare-tikz-renderers.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT_DIR = join(repoRoot, "artifacts", "tex-text-compare");

function usage() {
  return `
Usage:
  node scripts/compare-tex-text-rendering.mjs --text "..." --width 120 [--align left]
  node scripts/compare-tex-text-rendering.mjs --input paragraph.txt --width 120

Options:
  --text <text>          Plain paragraph text.
  --input <file>         Read plain paragraph text from a file.
  --width <pt>           TikZ text width in pt.
  --align <mode>         TikZ node alignment. Default: left.
  --font-encoding <enc>  One of OT1, T1. Default: OT1.
  --name <name>          Artifact run name.
  --out-dir <dir>        Artifact output root. Default: artifacts/tex-text-compare
  --help                 Show this message.
`.trim();
}

function parseArgs(argv) {
  const options = {
    text: null,
    inputPath: null,
    widthPt: null,
    align: "left",
    fontEncoding: "OT1",
    name: null,
    outDir: DEFAULT_OUT_DIR,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--text" && next != null) {
      options.text = next;
      index += 1;
      continue;
    }
    if (arg === "--input" && next != null) {
      options.inputPath = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--width" && next != null) {
      options.widthPt = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--align" && next != null) {
      options.align = next;
      index += 1;
      continue;
    }
    if (arg === "--font-encoding" && next != null) {
      const normalized = next.toUpperCase();
      if (normalized !== "OT1" && normalized !== "T1") {
        throw new Error(`Invalid font encoding: ${next}`);
      }
      options.fontEncoding = normalized;
      index += 1;
      continue;
    }
    if (arg === "--name" && next != null) {
      options.name = next;
      index += 1;
      continue;
    }
    if (arg === "--out-dir" && next != null) {
      options.outDir = resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "tex-text";
}

function escapePlainTextForTeX(text) {
  const unsupported = /[\\{}%#$&_~^]/;
  if (unsupported.test(text)) {
    throw new Error(
      "The TeX text comparison helper currently supports plain text without TeX special characters \\ { } % # $ & _ ~ ^."
    );
  }
  return text.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

function buildTikzSnippet({ text, align, widthPt }) {
  return String.raw`\begin{tikzpicture}
  \node[align=${align}, text width=${widthPt}pt] at (0,0) {${escapePlainTextForTeX(text)}};
\end{tikzpicture}`;
}

function runParagraphCompare(options, runDir) {
  const result = execFileSync(
    process.execPath,
    [
      "scripts/compare-paragraph-breaks.mjs",
      "--text",
      options.text,
      "--align",
      options.align,
      "--width",
      String(options.widthPt),
      "--font-encoding",
      options.fontEncoding,
      "--out-dir",
      join(runDir, "line-breaks"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp/texmf-var",
        TEXMFCONFIG: process.env.TEXMFCONFIG ?? "/private/tmp/texmf-config",
      },
      maxBuffer: 30 * 1024 * 1024,
    }
  );
  const reportMatch = result.match(/\[paragraph-compare\] wrote report to (.+)$/m);
  return {
    stdout: result,
    reportDir: reportMatch?.[1]?.trim() ?? null,
  };
}

function labelSideBySide(visualRunDir, fontEncoding) {
  if (!commandExists("magick")) {
    return null;
  }
  const fontPath = "/System/Library/Fonts/Supplemental/Arial.ttf";
  if (!existsSync(fontPath)) {
    return null;
  }
  const oursPath = join(visualRunDir, "ours-comparable.png");
  const latexPath = join(visualRunDir, "latex-comparable.png");
  if (!existsSync(oursPath) || !existsSync(latexPath)) {
    return null;
  }

  const oursLabeled = join(visualRunDir, "ours-labeled.png");
  const latexLabeled = join(visualRunDir, "latex-labeled.png");
  const spacer = join(visualRunDir, "spacer.png");
  const sideBySideLabeled = join(visualRunDir, "side-by-side-labeled.png");
  execFileSync("magick", [
    "-background",
    "white",
    "-fill",
    "black",
    "-font",
    fontPath,
    "-gravity",
    "center",
    "-pointsize",
    "36",
    "label:TeX text renderer (ours)",
    oursPath,
    "-append",
    oursLabeled,
  ]);
  execFileSync("magick", [
    "-background",
    "white",
    "-fill",
    "black",
    "-font",
    fontPath,
    "-gravity",
    "center",
    "-pointsize",
    "36",
    `label:TeX reference (pdfLaTeX, ${fontEncoding})`,
    latexPath,
    "-append",
    latexLabeled,
  ]);
  execFileSync("magick", ["-size", "48x1", "xc:white", spacer]);
  execFileSync("magick", [oursLabeled, spacer, latexLabeled, "-background", "white", "+append", sideBySideLabeled]);
  return sideBySideLabeled;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const text = options.text ?? (options.inputPath ? readFileSync(options.inputPath, "utf8") : null);
  if (!text) {
    throw new Error("Provide --text or --input.");
  }
  if (!Number.isFinite(options.widthPt) || options.widthPt <= 0) {
    throw new Error("Provide a positive --width in pt.");
  }

  const runName = slugify(options.name ?? `${options.align}-${options.widthPt}-${text.slice(0, 32)}`);
  const runDir = join(resolve(options.outDir), `${runName}-${timestampSlug()}`);
  mkdirSync(runDir, { recursive: true });
  const normalizedOptions = { ...options, text };
  const snippet = buildTikzSnippet(normalizedOptions);
  const inputPath = join(runDir, "input.tikz");
  writeFileSync(inputPath, snippet, "utf8");

  const lineBreaks = runParagraphCompare(normalizedOptions, runDir);
  writeFileSync(join(runDir, "line-break-stdout.txt"), lineBreaks.stdout, "utf8");

  const latexPreamble = normalizedOptions.fontEncoding === "T1" ? String.raw`\usepackage[T1]{fontenc}` : "";
  const visual = await compareTikzRenderers({
    code: snippet,
    outDir: join(runDir, "visual"),
    name: "render",
    latexPreamble,
  });
  const labeledSideBySide = labelSideBySide(visual.runDir, normalizedOptions.fontEncoding);

  const summary = {
    input: inputPath,
    lineBreakReportDir: lineBreaks.reportDir,
    visualReportPath: visual.reportPath,
    sideBySidePng: labeledSideBySide ?? visual.outputs.sideBySidePng ?? null,
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({ runDir, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
