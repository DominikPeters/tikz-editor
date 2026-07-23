#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEAMER_FRAME_ORACLE_VERSION,
  buildBeamerFrameProbeSource,
  fileSha256,
  firstVersionLine,
  parseBeamerClassVersion,
  parseBeamerProbeLog,
  parsePdfInfo,
  summarizeMutoolStructuredText,
} from "./lib/beamer-frame-oracle.mjs";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

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

function compileProbe(runDir) {
  const stdout = execFileSync(
    "lualatex",
    [
      "--interaction=nonstopmode",
      "--halt-on-error",
      "--file-line-error",
      "probe.tex",
    ],
    {
      cwd: runDir,
      encoding: "utf8",
      env: texOracleEnv(),
      maxBuffer: 30 * 1024 * 1024,
    }
  );
  writeFileSync(join(runDir, "lualatex-stdout.txt"), stdout, "utf8");
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
  execFileSync(
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
  const { scanBeamerDocument } = await loadBeamerScanner();
  const document = scanBeamerDocument(source);
  const frameIndex = options.frameNumber - 1;
  const probe = buildBeamerFrameProbeSource(source, document, frameIndex);
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

  compileProbe(runDir);
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
  renderArtifacts(runDir, pageNumber);
  const structuredText = summarizeMutoolStructuredText(
    JSON.parse(
      readFileSync(join(runDir, "structured-text.json"), "utf8")
    )
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
    artifacts: {
      tex: "probe.tex",
      log: "probe.log",
      pdf: "probe.pdf",
      svg: "probe.svg",
      structuredText: "structured-text.json",
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
