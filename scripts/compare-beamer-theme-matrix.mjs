#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILT_IN_BEAMER_THEMES } from "./lib/beamer-built-in-themes.mjs";
import { renderBeamerThemeGallery } from "./lib/beamer-theme-gallery.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutDir = join(
  repoRoot,
  "artifacts",
  "beamer-theme-compare"
);

const DECKS = {
  kkt: join(
    repoRoot,
    "test",
    "fixtures",
    "beamer",
    "kkt_theorem_beamer.tex"
  ),
  conformance: join(
    repoRoot,
    "test",
    "fixtures",
    "beamer",
    "theme_conformance_beamer.tex"
  ),
};

const VARIANTS = Object.fromEntries([
  ...BUILT_IN_BEAMER_THEMES.map(({ id, label, variant }) => [
    id,
    { label, ...variant },
  ]),
  ["madrid-seahorse", {
    label: "Madrid + Seahorse",
    theme: "Madrid",
    colorTheme: "seahorse",
  }],
]);

function usage() {
  return `
Usage:
  npm run compare:beamer-themes -- [options]

Options:
  --decks <names>       Comma-separated: kkt,conformance. Default: both.
  --variants <names>    Comma-separated variant IDs, or "built-in" for all
                        28 shipped presentation themes.
                        Default: madrid-seahorse,default.
  --frames <selection>  "all" or comma-separated frame numbers. Default: all.
  --out-dir <dir>       Default: artifacts/beamer-theme-compare.
  --raster              Also create PNG comparison artifacts.
                        The generated index.html uses these visual assets.
  --help                Show this help.
`.trim();
}

function parseArgs(argv) {
  const options = {
    deckNames: ["kkt", "conformance"],
    variantNames: ["madrid-seahorse", "default"],
    frames: null,
    outDir: defaultOutDir,
    raster: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--decks" && next) {
      options.deckNames = commaList(next);
      index += 1;
    } else if (arg === "--variants" && next) {
      options.variantNames = commaList(next);
      index += 1;
    } else if (arg === "--frames" && next) {
      options.frames = next === "all"
        ? null
        : commaList(next).map((value) => Number(value));
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = resolve(next);
      index += 1;
    } else if (arg === "--raster") {
      options.raster = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  options.variantNames = expandVariantNames(options.variantNames);
  validateNames(options.deckNames, DECKS, "deck");
  validateNames(options.variantNames, VARIANTS, "variant");
  if (options.frames?.some(
    (frame) => !Number.isInteger(frame) || frame < 1
  )) {
    throw new Error("--frames must contain positive integers or 'all'.");
  }
  return options;
}

function expandVariantNames(names) {
  return [...new Set(names.flatMap((name) =>
    name === "built-in"
      ? BUILT_IN_BEAMER_THEMES.map((theme) => theme.id)
      : [name]
  ))];
}

function commaList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function validateNames(names, catalog, label) {
  const unknown = names.filter((name) => !(name in catalog));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${label}: ${unknown.join(", ")}`);
  }
}

function countFrames(source) {
  return [...source.matchAll(/\\begin\s*\{\s*frame\s*\}/gu)].length;
}

function variantArgs(variant) {
  const args = [];
  for (const [key, flag] of [
    ["theme", "--theme"],
    ["colorTheme", "--color-theme"],
    ["fontTheme", "--font-theme"],
    ["innerTheme", "--inner-theme"],
    ["outerTheme", "--outer-theme"],
  ]) {
    if (variant[key] === false) {
      if (key !== "colorTheme") {
        throw new Error(`No removal flag registered for ${key}.`);
      }
      args.push("--without-color-theme");
    } else if (variant[key]) {
      args.push(flag, variant[key]);
    }
  }
  return args;
}

function readResult(reportPath, reportRoot, metadata, status) {
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const runDir = relative(reportRoot, dirname(reportPath));
    const artifact = (name) =>
      report.artifacts[name]
        ? join(runDir, report.artifacts[name])
        : null;
    return {
      ...metadata,
      status: status === 0 ? "passed" : "failed",
      report: relative(reportRoot, reportPath),
      frameTitle: report.input.frameTitle,
      diagnostics: report.renderer.diagnostics,
      summary: report.structural.summary,
      visuals: {
        renderer: artifact("rendererPng"),
        oracle: artifact("oraclePng"),
        overlay: artifact("overlayPng"),
        difference: artifact("differencePng"),
        sideBySide: artifact("sideBySidePng"),
      },
    };
  } catch {
    return {
      ...metadata,
      status: "error",
      report: null,
      frameTitle: null,
      diagnostics: [],
      summary: null,
      visuals: {},
    };
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  mkdirSync(options.outDir, { recursive: true });
  const results = [];

  for (const deckName of options.deckNames) {
    const inputPath = DECKS[deckName];
    const frameCount = countFrames(readFileSync(inputPath, "utf8"));
    const frames = options.frames ??
      Array.from({ length: frameCount }, (_, index) => index + 1);
    for (const variantName of options.variantNames) {
      const variant = VARIANTS[variantName];
      for (const frame of frames) {
        if (frame > frameCount) {
          throw new Error(
            `${deckName} has ${frameCount} frames; cannot compare frame ${frame}.`
          );
        }
        const name = `${deckName}-${variantName}-frame-${String(frame).padStart(3, "0")}`;
        const args = [
          join(repoRoot, "scripts", "compare-beamer-frame.mjs"),
          "--input",
          inputPath,
          "--frame",
          String(frame),
          "--out-dir",
          options.outDir,
          "--name",
          name,
          "--assert-structural",
          ...(options.raster ? [] : ["--structural-only"]),
          ...variantArgs(variant),
        ];
        const child = spawnSync(process.execPath, args, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: "inherit",
        });
        results.push(readResult(
          join(options.outDir, name, "report.json"),
          options.outDir,
          {
            deck: deckName,
            variant: variantName,
            variantLabel: variant.label,
            frame,
          },
          child.status
        ));
      }
    }
  }

  const reportPath = join(options.outDir, "matrix-report.json");
  const report = {
    formatVersion: 2,
    decks: options.deckNames,
    variants: options.variantNames,
    variantCatalog: options.variantNames.map((id) => ({
      id,
      label: VARIANTS[id].label,
    })),
    raster: options.raster,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status !== "passed").length,
    results,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[beamer-theme-matrix] wrote ${reportPath}`);
  const galleryPath = join(options.outDir, "index.html");
  writeFileSync(
    galleryPath,
    renderBeamerThemeGallery(report),
    "utf8"
  );
  console.log(`[beamer-theme-matrix] wrote ${galleryPath}`);
  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

main();
