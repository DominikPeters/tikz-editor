import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { chromium } from "@playwright/test";

import { renderTikzToSvgAsync } from "../../../packages/core/src/render/index.js";
import { getActiveTextLayoutContext } from "../../../packages/core/src/text/layout-context.js";
import { getParagraphLayoutReports } from "../../../packages/core/src/text/knuth-plass/index.js";
import { type NodeTextRenderInfo } from "../../../packages/core/src/text/types.js";

type DebugCase = {
  name: string;
  source: string;
};

type CliOptions = {
  outDir: string;
  iterations: number;
  warmup: number;
  inputPath: string | null;
  caseFilePath: string | null;
  caseName: string | null;
  scale: number;
};

type CaseArtifact = {
  name: string;
  slug: string;
  sourcePath: string;
  svgPath: string;
  pngPath: string;
  summaryPath: string;
  reportPath: string;
  timing: {
    warmupRuns: number;
    measuredRuns: number;
    coldRunMs: number | null;
    durationsMs: number[];
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
  diagnostics: {
    parseErrors: number;
    semanticErrors: number;
    renderErrors: number;
  };
  spaceStats: {
    paragraphs: number;
    runSpaces: number;
    zeroWidthRunSpaces: number;
    segmentSpaces: number;
    zeroWidthSegmentSpaces: number;
  };
  renderedSpaceStats: {
    mspacePairs: number;
    zeroAdvancePairs: number;
    sampleAdvances: number[];
  };
  paragraphSummaries: Array<{
    paragraphId: string;
    alignment: string;
    layoutMode: string;
    linebreakingMode: string;
    width: number;
    lineCount: number;
    runSpaceCount: number;
    zeroWidthRunSpaceCount: number;
    segmentSpaceCount: number;
    zeroWidthSegmentSpaceCount: number;
    maxLineTightnessError: number;
  }>;
};

const DEFAULT_CASES: DebugCase[] = [
  {
    name: "lorem-left-380pt",
    source: String.raw`\begin{tikzpicture}
  \node[align=left, text width=380pt] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`,
  },
  {
    name: "lorem-justify-360pt",
    source: String.raw`\begin{tikzpicture}
  \node[align=justify, text width=360pt] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`,
  },
  {
    name: "wrapped-explicit-right",
    source: String.raw`\begin{tikzpicture}
  \node[align=right, text width=280pt] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`,
  },
  {
    name: "explicit-left-math",
    source: String.raw`\begin{tikzpicture}
  \node[align=left] at (0,0) {$x$ \\ variable};
\end{tikzpicture}`,
  },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cases = await loadCases(options);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rootOutDir = resolve(options.outDir, timestamp);
  await mkdir(rootOutDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1400 },
    deviceScaleFactor: options.scale,
  });

  const artifacts: CaseArtifact[] = [];
  try {
    for (const [index, debugCase] of cases.entries()) {
      const artifact = await renderDebugCase({
        page,
        rootOutDir,
        debugCase,
        index,
        iterations: options.iterations,
        warmup: options.warmup,
      });
      artifacts.push(artifact);
      console.log(
        `[multiline-debug] ${artifact.name}: avg=${artifact.timing.avgMs.toFixed(1)}ms zeroWidthRunSpaces=${artifact.spaceStats.zeroWidthRunSpaces}/${artifact.spaceStats.runSpaces} png=${artifact.pngPath}`
      );
    }
  } finally {
    await page.close();
    await browser.close();
  }

  await writeIndex(rootOutDir, artifacts);
  console.log(`[multiline-debug] wrote gallery to ${join(rootOutDir, "index.html")}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    outDir: resolve("artifacts/multiline-debug"),
    iterations: 3,
    warmup: 1,
    inputPath: null,
    caseFilePath: null,
    caseName: null,
    scale: 2,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if ((arg === "--out-dir" || arg === "-o") && next) {
      options.outDir = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--iterations" && next) {
      options.iterations = Math.max(1, Number.parseInt(next, 10) || 1);
      i += 1;
      continue;
    }
    if (arg === "--warmup" && next) {
      options.warmup = Math.max(0, Number.parseInt(next, 10) || 0);
      i += 1;
      continue;
    }
    if (arg === "--input" && next) {
      options.inputPath = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--case-file" && next) {
      options.caseFilePath = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--name" && next) {
      options.caseName = next;
      i += 1;
      continue;
    }
    if (arg === "--scale" && next) {
      options.scale = Math.max(1, Number.parseInt(next, 10) || 1);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage:
  npm run debug:multiline
  npm run debug:multiline -- --input path/to/example.tex --name custom-case
  npm run debug:multiline -- --case-file path/to/cases.json

Options:
  --out-dir <dir>      Artifact output root (default: artifacts/multiline-debug)
  --input <file>       Single .tex file to render
  --case-file <file>   JSON file with [{ "name": "...", "source": "..." }]
  --name <label>       Case label for --input
  --iterations <n>     Measured render runs per case (default: 3)
  --warmup <n>         Warmup runs per case (default: 1)
  --scale <n>          PNG device scale factor (default: 2)
`);
}

async function loadCases(options: CliOptions): Promise<DebugCase[]> {
  if (options.caseFilePath) {
    const raw = await readFile(options.caseFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Case file ${options.caseFilePath} must be a JSON array.`);
    }
    return parsed.map((entry, index) => {
      const name =
        typeof entry === "object" &&
        entry != null &&
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name
          : `case-${index + 1}`;
      const source =
        typeof entry === "object" &&
        entry != null &&
        typeof (entry as { source?: unknown }).source === "string"
          ? (entry as { source: string }).source
          : "";
      if (!source) {
        throw new Error(`Case ${name} in ${options.caseFilePath} is missing a non-empty source string.`);
      }
      return { name, source };
    });
  }

  if (options.inputPath) {
    const source = await readFile(options.inputPath, "utf8");
    return [
      {
        name: options.caseName ?? basename(options.inputPath).replace(/\.[^.]+$/, ""),
        source,
      },
    ];
  }

  return DEFAULT_CASES;
}

async function renderDebugCase(params: {
  page: import("@playwright/test").Page;
  rootOutDir: string;
  debugCase: DebugCase;
  index: number;
  iterations: number;
  warmup: number;
}): Promise<CaseArtifact> {
  const { page, rootOutDir, debugCase, index, iterations, warmup } = params;
  const slug = `${String(index + 1).padStart(2, "0")}-${slugify(debugCase.name)}`;
  const caseDir = join(rootOutDir, slug);
  await mkdir(caseDir, { recursive: true });

  let lastResult: Awaited<ReturnType<typeof renderTikzToSvgAsync>> | null = null;
  const durationsMs: number[] = [];
  let coldRunMs: number | null = null;

  for (let runIndex = 0; runIndex < warmup + iterations; runIndex++) {
    const startedAt = performance.now();
    const result = await renderTikzToSvgAsync(debugCase.source, {
      parse: { recover: true },
      svg: { padding: 18 },
    });
    const elapsed = performance.now() - startedAt;
    lastResult = result;
    if (runIndex === 0) {
      coldRunMs = elapsed;
    }
    if (runIndex >= warmup) {
      durationsMs.push(elapsed);
    }
  }

  if (!lastResult) {
    throw new Error(`No render result produced for ${debugCase.name}.`);
  }

  const reports = resolveReportsForResult(lastResult);
  const summary = summarizeReports(reports);
  const renderedSpaceStats = summarizeRenderedMspaces(lastResult.svg.svg);

  const sourcePath = join(caseDir, "source.tex");
  const svgPath = join(caseDir, "render.svg");
  const pngPath = join(caseDir, "render.png");
  const summaryPath = join(caseDir, "summary.json");
  const reportPath = join(caseDir, "paragraph-reports.json");

  await writeFile(sourcePath, debugCase.source, "utf8");
  await writeFile(svgPath, lastResult.svg.svg, "utf8");
  await writeFile(
    reportPath,
    JSON.stringify(reports, null, 2),
    "utf8"
  );

  const artifact: CaseArtifact = {
    name: debugCase.name,
    slug,
    sourcePath,
    svgPath,
    pngPath,
    summaryPath,
    reportPath,
    timing: {
      warmupRuns: warmup,
      measuredRuns: iterations,
      coldRunMs,
      durationsMs,
      avgMs: average(durationsMs),
      minMs: Math.min(...durationsMs),
      maxMs: Math.max(...durationsMs),
    },
    diagnostics: {
      parseErrors: lastResult.parse.diagnostics.filter((item) => item.severity === "error").length,
      semanticErrors: lastResult.semantic.diagnostics.filter((item) => item.severity === "error").length,
      renderErrors: lastResult.renderDiagnostics.filter((item) => item.severity === "error").length,
    },
    spaceStats: summary.spaceStats,
    renderedSpaceStats,
    paragraphSummaries: summary.paragraphSummaries,
  };

  await writeFile(summaryPath, JSON.stringify(artifact, null, 2), "utf8");
  await screenshotSvg(page, lastResult.svg.svg, pngPath, debugCase.name);

  return artifact;
}

function resolveReportsForResult(
  result: Awaited<ReturnType<typeof renderTikzToSvgAsync>>
): ReturnType<typeof getParagraphLayoutReports> {
  const paragraphIds = new Set<string>();
  for (const element of result.semantic.scene.elements) {
    if (element.kind !== "Text") {
      continue;
    }
    const renderInfo = element.textRenderInfo as NodeTextRenderInfo | undefined;
    if (renderInfo?.mode !== "tex" || !renderInfo.paragraphId) {
      continue;
    }
    paragraphIds.add(renderInfo.paragraphId);
  }

  const allReports = getParagraphLayoutReports(getActiveTextLayoutContext());
  return allReports.filter((report) => paragraphIds.has(report.paragraphId));
}

function summarizeReports(
  reports: ReturnType<typeof getParagraphLayoutReports>
): {
  spaceStats: CaseArtifact["spaceStats"];
  paragraphSummaries: CaseArtifact["paragraphSummaries"];
} {
  const paragraphSummaries = reports.map((report) => {
    const runSpaceCount = report.runs.filter((run) => run.kind === "space").length;
    const zeroWidthRunSpaceCount = report.runs.filter(
      (run) => run.kind === "space" && run.width <= 1e-6
    ).length;
    const segmentSpaces = report.lines.flatMap((line) =>
      line.segments.filter((segment) => segment.kind === "space")
    );
    const maxLineTightnessError = report.lines.reduce((max, line) => {
      if (!Number.isFinite(line.targetWidth) || !Number.isFinite(line.xEnd)) {
        return max;
      }
      return Math.max(max, Math.abs(line.targetWidth - line.xEnd));
    }, 0);

    return {
      paragraphId: report.paragraphId,
      alignment: report.alignment,
      layoutMode: report.layoutMode,
      linebreakingMode: report.linebreakingMode,
      width: report.width,
      lineCount: report.lines.length,
      runSpaceCount,
      zeroWidthRunSpaceCount,
      segmentSpaceCount: segmentSpaces.length,
      zeroWidthSegmentSpaceCount: segmentSpaces.filter((segment) => segment.width <= 1e-6).length,
      maxLineTightnessError,
    };
  });

  return {
    spaceStats: {
      paragraphs: reports.length,
      runSpaces: paragraphSummaries.reduce((sum, item) => sum + item.runSpaceCount, 0),
      zeroWidthRunSpaces: paragraphSummaries.reduce(
        (sum, item) => sum + item.zeroWidthRunSpaceCount,
        0
      ),
      segmentSpaces: paragraphSummaries.reduce((sum, item) => sum + item.segmentSpaceCount, 0),
      zeroWidthSegmentSpaces: paragraphSummaries.reduce(
        (sum, item) => sum + item.zeroWidthSegmentSpaceCount,
        0
      ),
    },
    paragraphSummaries,
  };
}

async function screenshotSvg(
  page: import("@playwright/test").Page,
  svgMarkup: string,
  pngPath: string,
  title: string
): Promise<void> {
  const encodedSvg = Buffer.from(svgMarkup, "utf8").toString("base64");
  await page.setContent(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background:
          linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px) 0 0 / 24px 24px,
          linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px) 0 0 / 24px 24px,
          #f6f3ee;
      }
      body {
        padding: 32px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .frame {
        display: inline-flex;
        background: white;
        border: 1px solid rgba(0,0,0,0.16);
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        padding: 24px;
      }
      .frame > img {
        display: block;
        max-width: none;
      }
    </style>
  </head>
  <body>
    <div class="frame" data-testid="frame">
      <img
        data-testid="rendered-svg"
        alt="${escapeHtml(title)}"
        src="data:image/svg+xml;base64,${encodedSvg}"
      />
    </div>
  </body>
</html>`,
    { waitUntil: "load" }
  );
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="rendered-svg"]') as HTMLImageElement | null;
    return !!image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  });
  await page.evaluate(() => {
    const image = document.querySelector('[data-testid="rendered-svg"]') as HTMLImageElement | null;
    if (!image) {
      return;
    }
    image.style.width = `${image.naturalWidth}px`;
    image.style.height = `${image.naturalHeight}px`;
  });
  const locator = page.getByTestId("frame");
  await locator.screenshot({ path: pngPath });
}

async function writeIndex(rootOutDir: string, artifacts: CaseArtifact[]): Promise<void> {
  const rows = artifacts
    .map((artifact) => {
      const summary = artifact.paragraphSummaries
        .map(
          (paragraph) =>
            `<li><strong>${escapeHtml(paragraph.paragraphId)}</strong> ` +
            `mode=${escapeHtml(paragraph.layoutMode)} align=${escapeHtml(paragraph.alignment)} ` +
            `lines=${paragraph.lineCount} zeroWidthRunSpaces=${paragraph.zeroWidthRunSpaceCount}/${paragraph.runSpaceCount} ` +
            `maxTightnessError=${paragraph.maxLineTightnessError.toFixed(4)}</li>`
        )
        .join("");

      return `<section class="case">
  <h2>${escapeHtml(artifact.name)}</h2>
  <p>
    avg=${artifact.timing.avgMs.toFixed(1)}ms
    min=${artifact.timing.minMs.toFixed(1)}ms
    max=${artifact.timing.maxMs.toFixed(1)}ms
  </p>
  <p>
    zeroWidthRunSpaces=${artifact.spaceStats.zeroWidthRunSpaces}/${artifact.spaceStats.runSpaces}
    zeroWidthSegmentSpaces=${artifact.spaceStats.zeroWidthSegmentSpaces}/${artifact.spaceStats.segmentSpaces}
  </p>
  <p>
    renderedZeroAdvanceMspaces=${artifact.renderedSpaceStats.zeroAdvancePairs}/${artifact.renderedSpaceStats.mspacePairs}
    cold=${artifact.timing.coldRunMs?.toFixed(1) ?? "n/a"}ms
  </p>
  <p>
    <a href="${escapeHtml(relativePath(rootOutDir, artifact.pngPath))}">PNG</a>
    <a href="${escapeHtml(relativePath(rootOutDir, artifact.svgPath))}">SVG</a>
    <a href="${escapeHtml(relativePath(rootOutDir, artifact.sourcePath))}">Source</a>
    <a href="${escapeHtml(relativePath(rootOutDir, artifact.summaryPath))}">Summary</a>
    <a href="${escapeHtml(relativePath(rootOutDir, artifact.reportPath))}">Reports</a>
  </p>
  <img src="${escapeHtml(relativePath(rootOutDir, artifact.pngPath))}" alt="${escapeHtml(
        artifact.name
      )}" />
  <ul>${summary}</ul>
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Multiline Debug Gallery</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font: 14px/1.45 ui-sans-serif, system-ui, sans-serif;
        color: #1f1f1f;
        background: #f4f1ec;
      }
      h1 {
        margin: 0 0 24px;
      }
      .case {
        margin: 0 0 40px;
        padding: 20px;
        background: white;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      }
      img {
        display: block;
        max-width: 100%;
        border: 1px solid rgba(0,0,0,0.12);
        background: #fff;
      }
      a {
        margin-right: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Multiline Debug Gallery</h1>
    ${rows}
  </body>
</html>`;

  await writeFile(join(rootOutDir, "index.html"), html, "utf8");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "case";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function summarizeRenderedMspaces(svgMarkup: string): CaseArtifact["renderedSpaceStats"] {
  const pairPattern =
    /data-mml-node="mspace"[^>]*transform="translate\(([-\d.]+),0\)"[^>]*><\/g>\s*<g data-mml-node="mtext"[^>]*transform="translate\(([-\d.]+),0\)"/g;
  const sampleAdvances: number[] = [];
  let mspacePairs = 0;
  let zeroAdvancePairs = 0;

  for (const match of svgMarkup.matchAll(pairPattern)) {
    const currentX = Number.parseFloat(match[1] ?? "");
    const nextX = Number.parseFloat(match[2] ?? "");
    if (!Number.isFinite(currentX) || !Number.isFinite(nextX)) {
      continue;
    }
    const advance = nextX - currentX;
    if (sampleAdvances.length < 12) {
      sampleAdvances.push(advance);
    }
    mspacePairs += 1;
    if (Math.abs(advance) <= 1e-6) {
      zeroAdvancePairs += 1;
    }
  }

  return {
    mspacePairs,
    zeroAdvancePairs,
    sampleAdvances,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativePath(rootDir: string, targetPath: string): string {
  return targetPath.startsWith(rootDir)
    ? targetPath.slice(rootDir.length + 1)
    : targetPath;
}

void main().catch((error) => {
  console.error("[multiline-debug] failed", error);
  process.exitCode = 1;
});
