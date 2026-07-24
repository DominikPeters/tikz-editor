#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";
import {
  buildNativeBeamerPageTrace,
  compareBeamerPageTraces,
  normalizeOracleBeamerPageTrace,
} from "./lib/beamer-frame-compare.mjs";
import {
  applyBeamerThemeVariant,
  beamerThemeVariantSlug,
} from "./lib/beamer-theme-variants.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutDir = join(repoRoot, "artifacts", "beamer-frame-compare");
const defaultRasterWidth = 1600;

function usage() {
  return `
Usage:
  npm run compare:beamer-frame -- --input deck.tex [--frame 1]

Options:
  --input <file>       Beamer source file.
  --frame <n>          One-based source frame number. Default: 1.
  --page <n>           One-based compiled overlay page. Default: last page.
  --out-dir <dir>      Artifact root. Default: artifacts/beamer-frame-compare.
  --name <name>        Stable artifact directory name.
  --width <pixels>     Raster comparison width. Default: 1600.
  --theme <name>       Override \\usetheme for renderer and oracle.
  --color-theme <name> Override \\usecolortheme.
  --without-color-theme Remove explicit \\usecolortheme declarations.
  --font-theme <name>  Override \\usefonttheme.
  --inner-theme <name> Override \\useinnertheme.
  --outer-theme <name> Override \\useoutertheme.
  --structural-only    Skip raster comparison artifacts.
  --assert-structural  Fail when the structural fidelity contract is exceeded.
  --help               Show this help.
`.trim();
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    frameNumber: 1,
    pageNumber: null,
    outDir: defaultOutDir,
    name: null,
    width: defaultRasterWidth,
    themeVariant: {},
    structuralOnly: false,
    assertStructural: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input" && next) {
      options.inputPath = resolve(next);
      index += 1;
    } else if (arg === "--frame" && next) {
      options.frameNumber = Number(next);
      index += 1;
    } else if (arg === "--page" && next) {
      options.pageNumber = Number(next);
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = resolve(next);
      index += 1;
    } else if (arg === "--name" && next) {
      options.name = next;
      index += 1;
    } else if (arg === "--width" && next) {
      options.width = Number(next);
      index += 1;
    } else if (arg === "--theme" && next) {
      options.themeVariant.theme = next;
      index += 1;
    } else if (arg === "--color-theme" && next) {
      options.themeVariant.colorTheme = next;
      index += 1;
    } else if (arg === "--without-color-theme") {
      options.themeVariant.colorTheme = false;
    } else if (arg === "--font-theme" && next) {
      options.themeVariant.fontTheme = next;
      index += 1;
    } else if (arg === "--inner-theme" && next) {
      options.themeVariant.innerTheme = next;
      index += 1;
    } else if (arg === "--outer-theme" && next) {
      options.themeVariant.outerTheme = next;
      index += 1;
    } else if (arg === "--structural-only") {
      options.structuralOnly = true;
    } else if (arg === "--assert-structural") {
      options.assertStructural = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (
    !options.help &&
    (!Number.isInteger(options.frameNumber) || options.frameNumber < 1)
  ) {
    throw new Error("--frame must be a positive integer.");
  }
  if (
    options.pageNumber != null &&
    (!Number.isInteger(options.pageNumber) || options.pageNumber < 1)
  ) {
    throw new Error("--page must be a positive integer.");
  }
  if (!Number.isInteger(options.width) || options.width < 1) {
    throw new Error("--width must be a positive integer.");
  }
  return options;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "beamer-frame";
}

function runRequired(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? repoRoot,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Required command failed: ${command}${detail}`, {
      cause: error,
    });
  }
}

async function loadCoreRenderer() {
  ensureDistBuildFresh(repoRoot);
  const beamerEntry = join(
    repoRoot,
    "packages",
    "core",
    "dist",
    "beamer",
    "index.js"
  );
  const coreEntry = join(
    repoRoot,
    "packages",
    "core",
    "dist",
    "index.js"
  );
  const [beamer, core] = await Promise.all([
    import(pathToFileURL(beamerEntry).href),
    import(pathToFileURL(coreEntry).href),
  ]);
  return {
    renderBeamerFrame: beamer.renderBeamerFrame,
    computerModernTexMetricProvider: core.computerModernTexMetricProvider,
  };
}

function runOracle(options, runDir, inputPath) {
  const oracleRoot = join(runDir, "oracle");
  const args = [
    join(repoRoot, "scripts", "probe-beamer-frame.mjs"),
    "--input",
    inputPath,
    "--frame",
    String(options.frameNumber),
    "--out-dir",
    oracleRoot,
    "--name",
    "frame",
  ];
  if (options.pageNumber != null) {
    args.push("--page", String(options.pageNumber));
  }
  runRequired(process.execPath, args);
  return join(oracleRoot, "frame");
}

function rasterizeSvg(inputPath, outputPath, width, height) {
  runRequired("rsvg-convert", [
    "--format",
    "png",
    "--width",
    String(width),
    "--height",
    String(height),
    "--page-width",
    String(width),
    "--page-height",
    String(height),
    "--keep-aspect-ratio",
    "--background-color",
    "white",
    "--output",
    outputPath,
    inputPath,
  ]);
}

function rasterizePdfPage(
  inputPath,
  outputPath,
  pageNumber,
  width,
  height
) {
  const outputPrefix = outputPath.endsWith(".png")
    ? outputPath.slice(0, -".png".length)
    : outputPath;
  runRequired("pdftoppm", [
    "-png",
    "-f",
    String(pageNumber),
    "-l",
    String(pageNumber),
    "-singlefile",
    "-scale-to-x",
    String(width),
    "-scale-to-y",
    String(height),
    inputPath,
    outputPrefix,
  ]);
}

function createVisualComparisons(runDir) {
  const rendererPng = join(runDir, "renderer.png");
  const oraclePng = join(runDir, "oracle.png");
  runRequired("magick", [
    rendererPng,
    oraclePng,
    "+append",
    join(runDir, "side-by-side.png"),
  ]);
  runRequired("magick", [
    rendererPng,
    oraclePng,
    "-compose",
    "difference",
    "-composite",
    join(runDir, "difference.png"),
  ]);
  runRequired("magick", [
    rendererPng,
    oraclePng,
    "-define",
    "compose:args=50",
    "-compose",
    "blend",
    "-composite",
    join(runDir, "overlay.png"),
  ]);
}

function createSameRasterizerComparisons(runDir) {
  const rendererPng = join(runDir, "renderer.png");
  const oracleVectorPng = join(runDir, "oracle-vector.png");
  runRequired("magick", [
    rendererPng,
    oracleVectorPng,
    "+append",
    join(runDir, "side-by-side-vector.png"),
  ]);
  runRequired("magick", [
    rendererPng,
    oracleVectorPng,
    "-compose",
    "difference",
    "-composite",
    join(runDir, "difference-vector.png"),
  ]);
}

function relativeArtifact(runDir, path) {
  return relative(runDir, path);
}

function structuralContractFailures(summary) {
  const failures = [];
  for (const key of [
    "unmatchedNativeRectangles",
    "unmatchedOracleRules",
    "unmatchedNativeTextLines",
    "unmatchedOracleTextLines",
    "excludedOracleTextLines",
  ]) {
    if (summary[key] !== 0) {
      failures.push(`${key}=${summary[key]} (expected 0)`);
    }
  }
  if (!summary.glyphCodeMatch) {
    failures.push("glyphCodeMatch=false");
  }
  if (!summary.fontMatch) {
    failures.push("fontMatch=false");
  }
  for (const [key, tolerance] of [
    ["maxRectangleEdgeDeltaPt", 0.01],
    ["maxAbsoluteGlyphDxPt", 0.02],
    ["maxAbsoluteGlyphDyPt", 0.01],
  ]) {
    if (summary[key] > tolerance) {
      failures.push(`${key}=${summary[key]} (maximum ${tolerance})`);
    }
  }
  return failures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.inputPath) {
    throw new Error("Provide --input.");
  }

  const originalSource = readFileSync(options.inputPath, "utf8");
  const source = applyBeamerThemeVariant(
    originalSource,
    options.themeVariant
  );
  const deckName = basename(options.inputPath, extname(options.inputPath));
  const variantSlug = beamerThemeVariantSlug(options.themeVariant);
  const runName = slugify(
    options.name ??
      `${deckName}-${variantSlug}-frame-${String(options.frameNumber).padStart(3, "0")}`
  );
  const runDir = join(options.outDir, runName);
  mkdirSync(runDir, { recursive: true });
  const materializedInput = join(runDir, "input.tex");
  writeFileSync(materializedInput, source, "utf8");

  const {
    computerModernTexMetricProvider,
    renderBeamerFrame,
  } = await loadCoreRenderer();
  const render = await renderBeamerFrame(source, {
    frameIndex: options.frameNumber - 1,
  });
  const rendererSvg = join(runDir, "renderer.svg");
  writeFileSync(rendererSvg, render.svg.svg, "utf8");

  const oracleDir = runOracle(options, runDir, materializedInput);
  const oracleSvg = join(oracleDir, "probe.svg");
  const oracleReport = JSON.parse(
    readFileSync(join(oracleDir, "report.json"), "utf8")
  );
  const nativePageTrace = buildNativeBeamerPageTrace(
    render,
    computerModernTexMetricProvider
  );
  const oraclePageTrace = normalizeOracleBeamerPageTrace(
    oracleReport.pageTrace.selectedPage,
    oracleReport.tex.selectedPage
  );
  const structuralComparison = compareBeamerPageTraces(
    nativePageTrace,
    oraclePageTrace
  );
  writeFileSync(
    join(runDir, "native-page-trace.json"),
    `${JSON.stringify(nativePageTrace, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(runDir, "oracle-page-trace.json"),
    `${JSON.stringify(oraclePageTrace, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(runDir, "structural-comparison.json"),
    `${JSON.stringify(structuralComparison, null, 2)}\n`,
    "utf8"
  );
  const rasterHeight = Math.round(
    options.width * render.svg.viewBox.height / render.svg.viewBox.width
  );
  if (!options.structuralOnly) {
    const rendererPng = join(runDir, "renderer.png");
    const oraclePng = join(runDir, "oracle.png");
    const oracleVectorPng = join(runDir, "oracle-vector.png");
    rasterizeSvg(rendererSvg, rendererPng, options.width, rasterHeight);
    // This second oracle raster deliberately uses the same SVG rasterizer as
    // the native output. It is the useful visual check for glyph outline and
    // scale fidelity: comparing librsvg with Poppler can otherwise make
    // identical outlines appear to have different weight at screen resolution.
    //
    // Keep the PDF raster below as the primary full-paint oracle because
    // dvisvgm omits PGF radial shadings used by projected Beamer markers.
    rasterizeSvg(oracleSvg, oracleVectorPng, options.width, rasterHeight);
    // dvisvgm preserves the selected oracle page as a useful vector artifact,
    // but it drops Beamer's PGF radial shadings. Raster the same selected PDF
    // page directly so theme markers and other PDF paint operators remain in
    // the visual comparison.
    rasterizePdfPage(
      join(oracleDir, oracleReport.artifacts.pdf ?? "probe.pdf"),
      oraclePng,
      oracleReport.input.compiledPage,
      options.width,
      rasterHeight
    );
    createVisualComparisons(runDir);
    createSameRasterizerComparisons(runDir);
  }

  const report = {
    formatVersion: 3,
    input: {
      path: options.inputPath,
      materializedPath: relativeArtifact(runDir, materializedInput),
      themeVariant: options.themeVariant,
      frameNumber: options.frameNumber,
      frameId: render.frame.id,
      frameTitle: render.frame.title?.value ?? null,
      compiledPage: oracleReport.input.compiledPage,
    },
    renderer: {
      themeId: render.layout.page.themeId,
      page: render.layout.page,
      contentBounds: render.layout.contentBounds,
      itemKinds: render.layout.items.map((item) => item.kind),
      paragraphs: render.layout.paragraphs.map((paragraph) => ({
        id: paragraph.paragraphId,
        role: paragraph.role,
        sourceSpan: paragraph.sourceSpan,
        bounds: paragraph.bounds,
        lineCount: paragraph.report.lines.length,
      })),
      diagnostics: render.diagnostics,
    },
    oracle: {
      report: relativeArtifact(runDir, join(oracleDir, "report.json")),
      page: oracleReport.pdf,
      selectedTrace: oracleReport.tex.selectedPage,
    },
    structural: structuralComparison,
    raster: options.structuralOnly ? null : {
      width: options.width,
      height: rasterHeight,
      background: "white",
    },
    artifacts: {
      input: "input.tex",
      rendererSvg: "renderer.svg",
      oracleSvg: relativeArtifact(runDir, oracleSvg),
      ...(options.structuralOnly ? {} : {
        rendererPng: "renderer.png",
        oraclePng: "oracle.png",
        oracleVectorPng: "oracle-vector.png",
        sideBySidePng: "side-by-side.png",
        differencePng: "difference.png",
        sideBySideVectorPng: "side-by-side-vector.png",
        differenceVectorPng: "difference-vector.png",
        overlayPng: "overlay.png",
      }),
      nativePageTrace: "native-page-trace.json",
      oraclePageTrace: "oracle-page-trace.json",
      structuralComparison: "structural-comparison.json",
    },
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  console.log(`[beamer-frame-compare] wrote ${reportPath}`);
  console.log(
    `[beamer-frame-compare] structural ${JSON.stringify(structuralComparison.summary)}`
  );
  if (options.assertStructural) {
    const failures = structuralContractFailures(structuralComparison.summary);
    if (failures.length > 0) {
      throw new Error(
        `Structural fidelity contract failed: ${failures.join(", ")}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
