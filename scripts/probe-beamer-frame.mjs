#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEAMER_FRAME_ORACLE_VERSION,
  beamerPageTraceLuaSource,
  buildBeamerFrameProbeSource,
  fileSha256,
  firstVersionLine,
  parseBeamerClassVersion,
  parseBeamerPageTraceTsv,
  parseBeamerProbeLog,
  parsePdfInfo,
  summarizeMutoolStructuredText,
} from "./lib/beamer-frame-oracle.mjs";
import { texOracleEnv } from "./lib/tex-oracle.mjs";
import { collectBeamerDeckContext } from "./lib/beamer-deck-context.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutDir = join(repoRoot, "artifacts", "beamer-frame-probe");

function usage() {
  return `
Usage:
  npm run probe:beamer-frame -- --input deck.tex [--frame 2]

Options:
  --input <file>       Beamer source file.
  --frame <n>          One-based source frame number. Default: 1.
  --page <n>           One-based compiled overlay page. Default: last page.
  --out-dir <dir>      Artifact root. Default: artifacts/beamer-frame-probe.
  --name <name>        Stable artifact directory name.
  --source-dir <dir>   Resolve deck-relative dependencies from this directory.
  --tex-root <dir>     Also search this snapshot recursively for TeX packages.
  --trace-only         Write LuaLaTeX geometry without SVG/text conversion tools.
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
    help: false,
    traceOnly: false,
    sourceDir: null,
    texRoot: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--trace-only") {
      options.traceOnly = true;
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
    } else if (arg === "--source-dir" && next) {
      options.sourceDir = resolve(next);
      index += 1;
    } else if (arg === "--tex-root" && next) {
      options.texRoot = resolve(next);
      index += 1;
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
  return options;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80) || "beamer-frame";
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    return "unavailable";
  }
  return String(result.stdout || result.stderr);
}

function requiredCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch {
    throw new Error(`Required command is unavailable: ${command}`);
  }
}

async function loadBeamerScanner() {
  const entry = join(
    repoRoot,
    "packages",
    "core",
    "dist",
    "beamer",
    "index.js"
  );
  try {
    return await import(entry);
  } catch {
    throw new Error(
      "Built core Beamer scanner not found. Run `npm run -w @tikz-editor/core build` first."
    );
  }
}

function collectEnvironment() {
  const beamerClassPath = requiredCommand("kpsewhich", ["beamer.cls"]);
  const beamerClassSource = readFileSync(beamerClassPath, "utf8");
  return {
    engine: "lualatex",
    engineBanner: firstVersionLine(commandOutput("lualatex", ["--version"])),
    beamerClassPath,
    beamerClassSha256: fileSha256(beamerClassPath),
    beamerClass: parseBeamerClassVersion(beamerClassSource),
    kpsewhich: firstVersionLine(commandOutput("kpsewhich", ["--version"])),
    pdfinfo: firstVersionLine(commandOutput("pdfinfo", ["-v"])),
    mutool: firstVersionLine(commandOutput("mutool", ["-v"])),
    dvisvgm: firstVersionLine(commandOutput("dvisvgm", ["--version"])),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

function compileProbe(runDir, options) {
  const sourceDir = options.sourceDir ?? dirname(options.inputPath);
  const searchPaths = [runDir, sourceDir, ...(options.texRoot ? [`${options.texRoot}//`] : [])];
  const searchPath = searchPaths.join(delimiter) + delimiter;
  const navigationSeed = readFileSync(join(runDir, "probe.nav"), "utf8");
  // A fresh isolated frame can contain local labels/references. The second
  // pass resolves those and replaces the shipout trace with the final output.
  for (let pass = 1; pass <= 2; pass += 1) {
    // Compilation rewrites .nav with just the isolated frame. Restore the
    // original deck context on each pass while retaining .aux label state.
    writeFileSync(join(runDir, "probe.nav"), navigationSeed, "utf8");
    let stdout;
    try {
      stdout = execFileSync(
        "lualatex",
        [
          "--interaction=nonstopmode",
          "--halt-on-error",
          "--file-line-error",
          "--no-shell-escape",
          `--output-directory=${runDir}`,
          join(runDir, "probe.tex"),
        ],
        {
          cwd: sourceDir,
          encoding: "utf8",
          env: texOracleEnv({
            TEXINPUTS: searchPath + (process.env.TEXINPUTS ?? ""),
            BIBINPUTS: searchPath + (process.env.BIBINPUTS ?? ""),
            TIKZ_BEAMER_TRACE_DIR: runDir,
          }),
          maxBuffer: 30 * 1024 * 1024,
        }
      );
    } catch (error) {
      writeFileSync(join(runDir, `lualatex-pass-${pass}.txt`), `${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      writeFileSync(join(runDir, "lualatex-stdout.txt"), `${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      throw error;
    }
    writeFileSync(join(runDir, `lualatex-pass-${pass}.txt`), stdout, "utf8");
    writeFileSync(join(runDir, "lualatex-stdout.txt"), stdout, "utf8");
  }
}

function renderArtifacts(runDir, pageNumber) {
  execFileSync(
    "dvisvgm",
    [
      "--pdf",
      "probe.pdf",
      "-n",
      "-p",
      String(pageNumber),
      "-o",
      "probe.svg",
    ],
    { cwd: runDir, stdio: "ignore" }
  );
  // The Lua trace supplies comparison geometry; MuPDF extraction is optional.
  if (commandOutput("mutool", ["-v"])) execFileSync(
    "mutool",
    [
      "draw",
      "-q",
      "-F",
      "stext.json",
      "-o",
      "structured-text.json",
      "probe.pdf",
      String(pageNumber),
    ],
    { cwd: runDir, stdio: "ignore" }
  );
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

  const source = readFileSync(options.inputPath, "utf8");
  const {
    resolveBeamerTheoremCounterSeed,
    scanBeamerDocument,
  } = await loadBeamerScanner();
  const document = scanBeamerDocument(source);
  const frameIndex = options.frameNumber - 1;
  const selectedFrame = document.frames[frameIndex];
  // Source frame indexes are not frame counters once allowframebreaks is
  // present. Obtain counters and navigation from an actual full TeX run.
  // The recorder-backed cache keeps this one full-deck compilation shared
  // by subsequent isolated probes without using native layout estimates.
  const deckContext = document.frames.some(frame => frame.options?.allowFrameBreaks != null) ? collectBeamerDeckContext({
    source, document, inputPath: options.inputPath, sourceDir: options.sourceDir ?? dirname(options.inputPath),
    texRoot: options.texRoot, cacheDir: join(repoRoot, "artifacts", "beamer-full-deck-context"),
  }) : null;
  const probe = buildBeamerFrameProbeSource(
    source,
    document,
    frameIndex,
    selectedFrame
      ? resolveBeamerTheoremCounterSeed(document, selectedFrame.span.from)
      : [],
    deckContext
  );
  const deckName = basename(
    options.inputPath,
    extname(options.inputPath)
  );
  const runName = slugify(
    options.name ??
      `${deckName}-frame-${String(options.frameNumber).padStart(3, "0")}`
  );
  const runDir = join(options.outDir, runName);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "probe.tex"), probe.source, "utf8");
  writeFileSync(
    join(runDir, "beamer-page-trace.lua"),
    beamerPageTraceLuaSource(),
    "utf8"
  );
  // Beamer reads the .nav file during its begin-document patches. Seed the
  // original deck's frame-count context before compiling the isolated frame;
  // the selected frame still increments from the preceding source index.
  writeFileSync(
    join(runDir, "probe.nav"),
    probe.navSource,
    "utf8"
  );

  compileProbe(runDir, options);
  const log = readFileSync(join(runDir, "probe.log"), "utf8");
  const texTrace = parseBeamerProbeLog(log);
  const pdfInfoOutput = execFileSync("pdfinfo", ["probe.pdf"], {
    cwd: runDir,
    encoding: "utf8",
  });
  const pdf = parsePdfInfo(pdfInfoOutput);
  const pageNumber = options.pageNumber ?? pdf.pageCount;
  if (pageNumber > pdf.pageCount) {
    throw new RangeError(
      `--page ${pageNumber} exceeds the compiled ${pdf.pageCount} pages.`
    );
  }
  if (!options.traceOnly) renderArtifacts(runDir, pageNumber);
  const hasStructuredText = !options.traceOnly && commandOutput("mutool", ["-v"]);
  const structuredText = !hasStructuredText ? { pages: [] } : summarizeMutoolStructuredText(
    JSON.parse(
      readFileSync(join(runDir, "structured-text.json"), "utf8")
    )
  );
  const pageTrace = parseBeamerPageTraceTsv(
    readFileSync(join(runDir, "beamer-page-trace.tsv"), "utf8")
  );

  const selectedTrace =
    texTrace.pages[pageNumber - 1] ?? texTrace.pages.at(-1) ?? null;
  const report = {
    formatVersion: BEAMER_FRAME_ORACLE_VERSION,
    input: {
      path: options.inputPath,
      sha256: fileSha256(options.inputPath),
      frameNumber: options.frameNumber,
      frameId: probe.frame.id,
      frameSpan: probe.frame.span,
      frameTitle: probe.frame.title?.value ?? null,
      compiledPage: pageNumber,
      compilationScope: "original-preamble-and-selected-source-frame",
      sourceDirectory: options.sourceDir ?? dirname(options.inputPath),
      texRoot: options.texRoot,
      ...(deckContext ? { frameCounterContext: { kind: "full-authored-tex-deck", beforeFrameNumber: deckContext.frames[frameIndex].beforeFrameNumber, firstPage: deckContext.frames[frameIndex].firstPage, totalFrames: deckContext.totalFrames, cached: deckContext.cached, cacheDirectory: deckContext.cacheDirectory } } : {}),
    },
    environment: collectEnvironment(),
    pdf,
    tex: {
      pages: texTrace.pages,
      selectedPage: selectedTrace,
    },
    structuredText: {
      pages: structuredText.pages,
      selectedPage:
        structuredText.pages[pageNumber - 1] ??
        structuredText.pages.at(-1) ??
        null,
    },
    pageTrace: {
      pages: pageTrace.pages,
      selectedPage:
        pageTrace.pages[pageNumber - 1] ??
        pageTrace.pages.at(-1) ??
        null,
    },
    artifacts: {
      tex: "probe.tex",
      pageTraceLua: "beamer-page-trace.lua",
      pageTrace: "beamer-page-trace.tsv",
      log: "probe.log",
      pdf: "probe.pdf",
      ...(!options.traceOnly ? { svg: "probe.svg" } : {}),
      ...(hasStructuredText ? { structuredText: "structured-text.json" } : {}),
    },
    scannerDiagnostics: document.diagnostics,
  };
  writeFileSync(
    join(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  console.log(`[beamer-frame-probe] wrote ${join(runDir, "report.json")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
