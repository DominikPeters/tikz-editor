#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";
import { compareBlockPaint, paintContractFailures } from "./lib/beamer-paint-compare.mjs";
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
  --pdf-only           Use PDF paint as oracle, without dvisvgm conversion.
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
    pdfOnly: false,
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
    } else if (arg === "--pdf-only") {
      options.pdfOnly = true;
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

export async function loadCoreRenderer() {
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
    prepareBeamerDocument: beamer.prepareBeamerDocument,
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
    "--source-dir",
    options.sourceDir ?? dirname(options.inputPath),
  ];
  if (options.texRoot) args.push("--tex-root", options.texRoot);
  if (options.pageNumber != null) {
    args.push("--page", String(options.pageNumber));
  }
  if (options.structuralOnly || options.pdfOnly) args.push("--trace-only");
  runRequired(process.execPath, args);
  return join(oracleRoot, "frame");
}

export function rasterizeSvg(inputPath, outputPath, width, height) {
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

export function rasterizePdfPage(
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

export function structuralContractFailures(summary) {
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
  if (summary.transformMatch === false) failures.push("transformMatch=false");
  for (const [key, tolerance] of [
    ["maxRectangleEdgeDeltaPt", 0.01],
    ["maxAbsoluteGlyphDxPt", 0.02],
    ["maxAbsoluteGlyphDyPt", 0.01],
  ]) {
    if (!Number.isFinite(summary[key]) || summary[key] > tolerance) {
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
  await compareBeamerFrame(options);
}

/**
 * Compare one frame while optionally reusing a caller-prepared document.
 * Theme matrix runs provide one prepared document for every deck/variant
 * pair; the standalone CLI leaves preparation to this function.
 */
export async function compareBeamerFrame(options, runtime = {}) {
  if (!options.inputPath) {
    throw new Error("Provide inputPath.");
  }
  const source = runtime.source ?? applyBeamerThemeVariant(
    readFileSync(options.inputPath, "utf8"),
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

  const coreRenderer = runtime.coreRenderer ?? await loadCoreRenderer();
  const { computerModernTexMetricProvider } = coreRenderer;
  const preparedDocument = runtime.preparedDocument ??
    coreRenderer.prepareBeamerDocument(source);
  const framePages = runtime.framePages ?? await preparedDocument.renderFramePages({
    frameIndex: options.frameNumber - 1,
    graphicsResolver: runtime.graphicsResolver,
  });
  const stepCount = framePages.stepCount;
  const pageCount = framePages.pageCount ?? framePages.pages.length;
  const selectedPage = options.pageNumber ?? pageCount;
  const render = runtime.render ?? framePages.pages[selectedPage - 1] ?? framePages.pages.at(-1);
  if (!render) throw new Error("Renderer did not produce a frame page.");
  const rendererSvg = join(runDir, "renderer.svg");
  writeFileSync(rendererSvg, render.svg.svg, "utf8");

  const oracleDir = runOracle(options, runDir, materializedInput);
  const oracleSvg = join(oracleDir, "probe.svg");
  const oracleReport = JSON.parse(
    readFileSync(join(oracleDir, "report.json"), "utf8")
  );
  if (oracleReport.pdf.pageCount !== pageCount || selectedPage < 1 || selectedPage > pageCount) {
    // Preserve evidence before failing. Different counts provide no valid
    // one-to-one mapping, so do not compare an arbitrary pair of pages.
    writeFileSync(join(runDir, "report.json"), JSON.stringify({
      formatVersion: 4,
      status: "page-count-mismatch",
      input: { path: options.inputPath, frameNumber: options.frameNumber, overlayStep: render.layout.step, overlayStepCount: stepCount, pageCount, compiledPage: selectedPage },
      correspondence: { valid: false, nativePageCount: pageCount, nativeOverlayStepCount: stepCount, oraclePageCount: oracleReport.pdf.pageCount },
      renderer: { diagnostics: render.diagnostics },
      oracle: { report: relativeArtifact(runDir, join(oracleDir, "report.json")), page: oracleReport.pdf },
      structural: null,
      artifacts: { input: "input.tex", rendererSvg: "renderer.svg", oraclePdf: relativeArtifact(runDir, join(oracleDir, oracleReport.artifacts.pdf ?? "probe.pdf")) },
    }, null, 2) + "\n");
    throw new Error(`Frame page counts differ: renderer=${pageCount}, oracle=${oracleReport.pdf.pageCount}. Cannot establish page correspondence.`);
  }
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
    if (!options.pdfOnly) rasterizeSvg(oracleSvg, oracleVectorPng, options.width, rasterHeight);
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
    if (!options.pdfOnly) createSameRasterizerComparisons(runDir);
  }

  const report = {
    formatVersion: 4,
    input: {
      path: options.inputPath,
      materializedPath: relativeArtifact(runDir, materializedInput),
      themeVariant: options.themeVariant,
      frameNumber: options.frameNumber,
      frameId: render.frame.id,
      frameTitle: render.frame.title?.value ?? null,
      overlayStep: render.layout.step,
      overlayStepCount: render.layout.stepCount,
      pageCount,
      ...(render.layout.continuation ? { continuation: render.layout.continuation } : {}),
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
    paint: options.structuralOnly ? null : compareBlockPaint(render, nativePageTrace, oraclePageTrace,
      join(runDir, "renderer.png"), join(runDir, "oracle.png"), options.width, rasterHeight, options.paintProbes),
    raster: options.structuralOnly ? null : {
      width: options.width,
      height: rasterHeight,
      background: "white",
      normalizedRmse: rasterRmse(join(runDir, "oracle.png"), join(runDir, "renderer.png")),
    },
    artifacts: {
      input: "input.tex",
      rendererSvg: "renderer.svg",
      ...(!options.structuralOnly && !options.pdfOnly ? { oracleSvg: relativeArtifact(runDir, oracleSvg) } : {}),
      ...(options.structuralOnly ? {} : {
        rendererPng: "renderer.png",
        oraclePng: "oracle.png",
        sideBySidePng: "side-by-side.png",
        differencePng: "difference.png",
        ...(!options.pdfOnly ? {
          oracleVectorPng: "oracle-vector.png",
          sideBySideVectorPng: "side-by-side-vector.png",
          differenceVectorPng: "difference-vector.png",
        } : {}),
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
    const failures = [...structuralContractFailures(structuralComparison.summary), ...paintContractFailures(report.paint)];
    if (failures.length > 0) {
      throw new Error(
        `Structural fidelity contract failed: ${failures.join(", ")}`
      );
    }
  }
  return { report, reportPath, runDir };
}

function rasterRmse(expected, actual) {
  const result = spawnSync("magick", ["compare", "-metric", "RMSE", expected, actual, "null:"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Raster metric failed: ${result.error?.message ?? result.stderr}`);
  }
  const match = `${result.stdout}${result.stderr}`.match(/\(([\d.eE+-]+)\)/u);
  if (!match || !Number.isFinite(Number(match[1]))) throw new Error("Invalid raster RMSE output.");
  return Number(match[1]);
}

function isMain(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
