#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distEntry = join(repoRoot, "packages/core/dist/text/tex/index.js");
const parseLengthEntry = join(repoRoot, "packages/core/dist/semantic/coords/parse-length.js");
const defaultOutDir = join(repoRoot, "artifacts", "tex-text-visual-fuzz");
const defaultCacheDir = join(repoRoot, "artifacts", "tex-text-visual-fuzz-cache");
const defaultSeed = 20260608;
const defaultCases = 32;
const defaultScale = 8;
const defaultThresholdRatio = 1.5;
const defaultGlyphDxTolerance = 1.5;
const defaultGlyphDyTolerance = 0.25;
const defaultCaseMode = "broad";
const defaultTextFontSize = 10;
const texPointToSvgPoint = defaultTextFontSize / 10;
const lineHeightPt = defaultTextFontSize * 1.2;
const firstLineAscentPt = defaultTextFontSize * 0.85;

const alignments = [
  { label: "left", layout: "ragged-right", tikz: "left" },
  { label: "right", layout: "ragged-left", tikz: "right" },
  { label: "center", layout: "center", tikz: "center" },
  { label: "justify", layout: "justified", tikz: "justify" },
];

const words = [
  "alpha", "beta", "gamma", "delta", "epsilon", "office", "affinity", "efficient",
  "lattice", "chapter", "reader", "layout", "baseline", "sentence", "paragraph",
  "hyphenation", "computer", "modern", "vector", "editor", "figure", "semantic",
  "rendering", "alignment", "precise", "manual", "paper", "method", "result",
  "careful", "default", "metric", "source", "canvas", "anchor", "compact",
  "visible", "screen", "document", "natural", "language", "pattern", "position",
  "stable", "quoted", "sample", "actual", "kernel", "model", "spacing",
  "analysis", "direct", "local", "shape", "table", "nested", "option",
  "single", "double", "final", "initial", "logic", "classic", "control",
  "future", "basic", "normal", "narrow", "wide", "faithful", "output",
];

const ligatureWords = [
  "office", "official", "officer", "offline", "offload", "coffee", "coffees",
  "affinity", "affixed", "afflict", "efficient", "efficiency", "difficult",
  "sufficient", "different", "difference", "final", "finally", "figure",
  "file", "filter", "profile", "refine", "reflect", "flight", "flower",
  "flexible", "shuffle", "raffle", "stiffly", "fulfill", "fulfilling",
];

function usage() {
  return `
Usage:
  node scripts/compare-tex-text-visual-fuzz.mjs [--cases 32] [--seed 20260608] [--scale 8]

Options:
  --cases <n>             Number of fuzz cases. Default: ${defaultCases}.
  --seed <n>              Deterministic fuzz seed. Default: ${defaultSeed}.
  --scale <px-per-pt>     Raster scale. Default: ${defaultScale}.
  --out-dir <dir>         Artifact root. Default: artifacts/tex-text-visual-fuzz.
  --cache-dir <dir>       TeX oracle cache root. Default: artifacts/tex-text-visual-fuzz-cache.
  --case-mode <mode>      Case generator: broad, ligatures, quote, style, list, vertical-glue, rule, box, or mixed. Default: ${defaultCaseMode}.
  --no-cache              Disable the TeX oracle cache for this run.
  --refresh-cache         Rebuild TeX oracle entries even if cached artifacts exist.
  --threshold-ratio <n>   Flag ours-vs-TeX AE above n times TeX-vs-TeX AE. Default: ${defaultThresholdRatio}.
  --flag-visual-diff      Treat raster AE ratio differences as failures. By default raster metrics are diagnostic only.
  --glyph-dx-tolerance <pt>
                          Max glyph x delta for structural pass. Checks absolute, block-normalized, line-edge, and line-internal deltas. Default: ${defaultGlyphDxTolerance}.
  --glyph-dy-tolerance <pt>
                          Max glyph baseline y delta for structural pass. Default: ${defaultGlyphDyTolerance}.
  --help                  Show this message.
`.trim();
}

function parseArgs(argv) {
  const options = {
    cases: defaultCases,
    seed: defaultSeed,
    scale: defaultScale,
    outDir: defaultOutDir,
    cacheDir: defaultCacheDir,
    caseMode: defaultCaseMode,
    cache: true,
    refreshCache: false,
    thresholdRatio: defaultThresholdRatio,
    flagVisualDiff: false,
    glyphDxTolerance: defaultGlyphDxTolerance,
    glyphDyTolerance: defaultGlyphDyTolerance,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--cases" && next != null) {
      options.cases = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--seed" && next != null) {
      options.seed = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--scale" && next != null) {
      options.scale = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--out-dir" && next != null) {
      options.outDir = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--cache-dir" && next != null) {
      options.cacheDir = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--case-mode" && next != null) {
      options.caseMode = next;
      index += 1;
      continue;
    }
    if (arg === "--no-cache") {
      options.cache = false;
      continue;
    }
    if (arg === "--refresh-cache") {
      options.refreshCache = true;
      continue;
    }
    if (arg === "--threshold-ratio" && next != null) {
      options.thresholdRatio = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--flag-visual-diff") {
      options.flagVisualDiff = true;
      continue;
    }
    if (arg === "--glyph-dx-tolerance" && next != null) {
      options.glyphDxTolerance = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--glyph-dy-tolerance" && next != null) {
      options.glyphDyTolerance = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isInteger(options.cases) || options.cases <= 0) {
    throw new Error("--cases must be a positive integer.");
  }
  if (!Number.isInteger(options.seed)) {
    throw new Error("--seed must be an integer.");
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error("--scale must be positive.");
  }
  if (!Number.isFinite(options.thresholdRatio) || options.thresholdRatio <= 0) {
    throw new Error("--threshold-ratio must be positive.");
  }
  if (!Number.isFinite(options.glyphDxTolerance) || options.glyphDxTolerance < 0) {
    throw new Error("--glyph-dx-tolerance must be non-negative.");
  }
  if (!Number.isFinite(options.glyphDyTolerance) || options.glyphDyTolerance < 0) {
    throw new Error("--glyph-dy-tolerance must be non-negative.");
  }
  if (!["broad", "ligatures", "quote", "style", "list", "vertical-glue", "rule", "box", "mixed"].includes(options.caseMode)) {
    throw new Error("--case-mode must be broad, ligatures, quote, style, list, vertical-glue, rule, box, or mixed.");
  }
  return options;
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function requireCommands(commands) {
  const missing = commands.filter((command) => !commandExists(command));
  if (missing.length > 0) {
    throw new Error(`Missing required commands: ${missing.join(", ")}`);
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function choice(random, values) {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

function sentence(random, minWords, maxWords) {
  const count = minWords + Math.floor(random() * (maxWords - minWords + 1));
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    let word = choice(random, words);
    if (index === 0) {
      word = word[0].toUpperCase() + word.slice(1);
    }
    if (index > 1 && random() < 0.12) {
      word += ",";
    }
    parts.push(word);
  }
  return `${parts.join(" ")}.`;
}

function paragraph(random, sentenceCount) {
  return Array.from({ length: sentenceCount }, () => sentence(random, 5, 12)).join(" ");
}

function ligatureSentence(random, minWords, maxWords) {
  const count = minWords + Math.floor(random() * (maxWords - minWords + 1));
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    let word = choice(random, ligatureWords);
    if (index === 0) {
      word = word[0].toUpperCase() + word.slice(1);
    }
    if (index > 1 && random() < 0.14) {
      word += ",";
    }
    parts.push(word);
  }
  return `${parts.join(" ")}.`;
}

function ligatureParagraph(random, sentenceCount) {
  return Array.from({ length: sentenceCount }, () => ligatureSentence(random, 6, 13)).join(" ");
}

function generateCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [80, 100, 120, 150, 200, 240, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const feature = index % 6;
  let text;
  if (feature === 0) {
    text = paragraph(random, 2 + Math.floor(random() * 3));
  } else if (feature === 1) {
    text = `${paragraph(random, 1 + Math.floor(random() * 2))} \\par ${paragraph(random, 1 + Math.floor(random() * 2))}`;
  } else if (feature === 2) {
    text = `${paragraph(random, 1)} \\par \\noindent ${paragraph(random, 2)}`;
  } else if (feature === 3) {
    text = `${sentence(random, 5, 9)} \\\\[${choice(random, [4, 7, 10])}pt] ${paragraph(random, 2)}`;
  } else if (feature === 4) {
    text = `${paragraph(random, 1)} \\par \\noindent ${sentence(random, 4, 8)} \\\\[7pt] ${paragraph(random, 1)}`;
  } else {
    const declaration = choice(random, ["\\raggedright", "\\centering", "\\raggedleft"]);
    text = `${paragraph(random, 1)} \\par ${declaration} ${paragraph(random, 1 + Math.floor(random() * 2))}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: ["plain", "multi-par", "noindent", "forced-break", "mixed", "declaration"][feature],
    text,
    width,
    parindent,
    alignment,
  };
}

function generateLigatureCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [70, 85, 100, 120, 150, 180, 220, 260];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10]);
  const feature = index % 4;
  let text;
  if (feature === 0) {
    text = ligatureParagraph(random, 2 + Math.floor(random() * 2));
  } else if (feature === 1) {
    text = `${ligatureParagraph(random, 1)} \\par ${ligatureParagraph(random, 1 + Math.floor(random() * 2))}`;
  } else if (feature === 2) {
    text = `${ligatureSentence(random, 6, 10)} \\\\[${choice(random, [4, 7])}pt] ${ligatureParagraph(random, 1)}`;
  } else {
    text = `${ligatureParagraph(random, 1)} \\par \\noindent ${ligatureParagraph(random, 1)}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "ligature",
    text,
    width,
    parindent,
    alignment,
  };
}

function generateQuoteCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [100, 120, 150, 200, 240, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const environmentName = index % 2 === 0 ? "quote" : "quotation";
  const feature = Math.floor(index / 2) % 4;
  let text;
  if (feature === 0) {
    text = `\\begin{${environmentName}} ${paragraph(random, 1 + Math.floor(random() * 2))} \\end{${environmentName}}`;
  } else if (feature === 1) {
    text = `${paragraph(random, 1)} \\par \\begin{${environmentName}} ${paragraph(random, 1 + Math.floor(random() * 2))} \\end{${environmentName}} \\par ${paragraph(random, 1)}`;
  } else if (feature === 2) {
    text = `\\begin{${environmentName}} ${sentence(random, 5, 9)} \\\\[${choice(random, [4, 7])}pt] ${paragraph(random, 1)} \\end{${environmentName}}`;
  } else {
    text = `${paragraph(random, 1)} \\par \\begin{${environmentName}} ${paragraph(random, 1)} \\par ${paragraph(random, 1)} \\end{${environmentName}}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: environmentName,
    text,
    width,
    parindent,
    alignment,
  };
}

function styledPhrase(random, minWords = 2, maxWords = 5) {
  const count = minWords + Math.floor(random() * (maxWords - minWords + 1));
  return Array.from({ length: count }, () => choice(random, words)).join(" ");
}

function styledSentence(random, index) {
  const lead = sentence(random, 3, 6);
  const tail = sentence(random, 4, 8);
  const phraseA = styledPhrase(random);
  const phraseB = styledPhrase(random);
  const phraseC = styledPhrase(random, 1, 3);
  switch (index % 6) {
    case 0:
      return `${lead} \\textit{${phraseA}} ${tail}`;
    case 1:
      return `${lead} \\textbf{${phraseA}} \\textrm{${phraseB}}.`;
    case 2:
      return `${lead} \\emph{${phraseA} \\emph{${phraseC}} ${phraseB}}.`;
    case 3:
      return `${lead} \\textbf{${phraseA} \\textit{${phraseB}}} ${tail}`;
    case 4:
      return `${lead} \\textit{${phraseA} \\textbf{${phraseB}}} \\textnormal{${phraseC}}.`;
    default:
      return `${lead} \\textbf{${phraseA} \\emph{${phraseB}} \\textnormal{${phraseC}}}.`;
  }
}

function generateStyleCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [100, 120, 150, 200, 240, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const feature = index % 5;
  let text;
  if (feature === 0) {
    text = `${styledSentence(random, index)} ${styledSentence(random, index + 1)}`;
  } else if (feature === 1) {
    text = `${styledSentence(random, index)} \\par ${styledSentence(random, index + 1)}`;
  } else if (feature === 2) {
    text = `${styledSentence(random, index)} \\\\[${choice(random, [4, 7])}pt] ${styledSentence(random, index + 1)}`;
  } else if (feature === 3) {
    text = `\\begin{quote} ${styledSentence(random, index)} \\par ${styledSentence(random, index + 1)} \\end{quote}`;
  } else {
    const declaration = choice(random, ["\\raggedright", "\\centering", "\\raggedleft"]);
    text = `${paragraph(random, 1)} \\par ${declaration} ${styledSentence(random, index)}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "style",
    text,
    width,
    parindent,
    alignment,
  };
}

function listItemText(random, index) {
  const feature = index % 6;
  if (feature === 0) {
    return sentence(random, 4, 8);
  }
  if (feature === 1) {
    return `${styledPhrase(random, 2, 4)} \\textit{${styledPhrase(random, 1, 3)}}.`;
  }
  if (feature === 2) {
    return `${sentence(random, 3, 6)} \\\\[${choice(random, [4, 7])}pt] ${sentence(random, 4, 7)}`;
  }
  if (feature === 3) {
    return `${sentence(random, 3, 6)} \\par ${sentence(random, 3, 6)}`;
  }
  if (feature === 4) {
    return `\\textbf{${styledPhrase(random, 2, 4)}} ${sentence(random, 3, 6)}`;
  }
  return `\\emph{${styledPhrase(random, 2, 4)}} ${sentence(random, 3, 6)}`;
}

function listEnvironment(kind, items) {
  return `\\begin{${kind}}${items.map((item) => `\\item ${item}`).join(" ")}\\end{${kind}}`;
}

function itemWithOptionalLabel(label, text) {
  return `\\item[${label}] ${text}`;
}

function generateListCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [120, 150, 180, 220, 260, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const feature = index % 6;
  let text;
  if (feature === 0) {
    text = listEnvironment("itemize", [
      listItemText(random, index),
      listItemText(random, index + 1),
    ]);
  } else if (feature === 1) {
    text = listEnvironment("enumerate", [
      listItemText(random, index),
      listItemText(random, index + 1),
      listItemText(random, index + 2),
    ]);
  } else if (feature === 2) {
    text = listEnvironment("itemize", [
      `${sentence(random, 3, 6)} ${listEnvironment("itemize", [
        listItemText(random, index + 1),
        listItemText(random, index + 2),
      ])}`,
      listItemText(random, index + 3),
    ]);
  } else if (feature === 3) {
    text = listEnvironment("enumerate", [
      `${sentence(random, 3, 6)} ${listEnvironment("enumerate", [
        listItemText(random, index + 1),
      ])}`,
      listItemText(random, index + 2),
    ]);
  } else if (feature === 4) {
    text = `Before ${sentence(random, 3, 6)} \\par ${listEnvironment("itemize", [
      listItemText(random, index),
      listItemText(random, index + 1),
    ])} \\par After ${sentence(random, 3, 6)}`;
  } else {
    text = `\\begin{enumerate}\\item \\textit{${styledPhrase(random, 2, 4)}} ${listEnvironment("itemize", [
      listItemText(random, index + 1),
    ])} ${itemWithOptionalLabel("Step", listItemText(random, index + 2))}\\end{enumerate}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "list",
    text,
    width,
    parindent,
    alignment,
  };
}

function generateVerticalGlueCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [120, 150, 180, 220, 260, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const feature = index % 7;
  let text;
  if (feature === 0) {
    text = `${paragraph(random, 1)} \\par \\smallskip ${paragraph(random, 1)}`;
  } else if (feature === 1) {
    text = `${paragraph(random, 1)} \\par \\medskip \\noindent ${paragraph(random, 1)}`;
  } else if (feature === 2) {
    text = `${paragraph(random, 1)} \\par \\bigskip ${paragraph(random, 1)}`;
  } else if (feature === 3) {
    text = `${paragraph(random, 1)} \\par \\vspace{${choice(random, [-4, -2, 3, 5, 7, 10])}pt} ${paragraph(random, 1)}`;
  } else if (feature === 4) {
    text = `${paragraph(random, 1)} \\par \\vskip ${choice(random, [-3, -1, 3, 5, 7])}pt plus ${choice(random, [1, 2])}pt minus 1pt ${paragraph(random, 1)}`;
  } else if (feature === 5) {
    text = `\\begin{quote}\\smallskip ${paragraph(random, 1)} \\par \\vspace{${choice(random, [-2, 3, 6])}pt} ${paragraph(random, 1)}\\end{quote}`;
  } else {
    text = `${paragraph(random, 1)} \\par ${listEnvironment("itemize", [
      `\\smallskip ${listItemText(random, index)}`,
      `\\vspace{${choice(random, [-2, 3, 5])}pt} ${listItemText(random, index + 1)}`,
    ])} \\par ${paragraph(random, 1)}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "vertical-glue",
    text,
    width,
    parindent,
    alignment,
  };
}

function generateRuleCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [120, 150, 180, 220, 260, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const ruleWidth = choice(random, [18, 24, 36, 48, 72]);
  const ruleHeight = choice(random, [0.4, 1, 2, 3]);
  const ruleDepth = choice(random, [0, 0.5, 1]);
  const rule = `\\hrule width ${ruleWidth}pt height ${ruleHeight}pt depth ${ruleDepth}pt`;
  const feature = index % 4;
  let text;
  if (feature === 0) {
    text = `${paragraph(random, 1)} \\par ${rule} ${paragraph(random, 1)}`;
  } else if (feature === 1) {
    text = `${paragraph(random, 1)} \\par \\smallskip ${rule} \\smallskip ${paragraph(random, 1)}`;
  } else if (feature === 2) {
    text = `\\begin{quote} ${paragraph(random, 1)} \\par ${rule} ${paragraph(random, 1)} \\end{quote}`;
  } else {
    text = `${paragraph(random, 1)} \\par ${listEnvironment("itemize", [
      `${rule} ${listItemText(random, index)}`,
      listItemText(random, index + 1),
    ])}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "rule",
    text,
    width,
    parindent,
    alignment,
  };
}

function generateBoxCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [140, 170, 200, 240, 300, 340];
  const width = choice(random, widths);
  const parindent = 0;
  const boxWidth = Math.min(width - 20, choice(random, [120, 140, 160]));
  const body = choice(random, [
    "Alpha beta gamma delta.",
    "Office figure final logic.",
    "Reader layout source model.",
  ]);
  const feature = index % 2;
  let text;
  if (feature === 0) {
    text = `\\parbox{${boxWidth}pt}{${body}}`;
  } else {
    text = `\\begin{minipage}{${boxWidth}pt}${body}\\end{minipage}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: "box",
    text,
    width,
    parindent,
    alignment,
  };
}

function generateMixedFeatureCase(index, random) {
  const feature = index % 6;
  if (feature === 0) {
    const generated = generateListCase(index, random);
    return {
      ...generated,
      feature: "mixed-list-quote",
      text: `\\begin{quote} ${generated.text} \\end{quote}`,
    };
  }
  if (feature === 1) {
    const generated = generateStyleCase(index, random);
    return {
      ...generated,
      feature: "mixed-style-list",
      text: `${generated.text} \\par ${listEnvironment("itemize", [
        listItemText(random, index),
        `\\textbf{${styledPhrase(random, 2, 4)}} ${sentence(random, 3, 6)}`,
      ])}`,
    };
  }
  if (feature === 2) {
    const generated = generateQuoteCase(index, random);
    return {
      ...generated,
      feature: "mixed-quote-style",
      text: `${generated.text} \\par ${styledSentence(random, index)}`,
    };
  }
  if (feature === 3) {
    const generated = generateLigatureCase(index, random);
    return {
      ...generated,
      feature: "mixed-ligature-list",
      text: `${generated.text} \\par ${listEnvironment("enumerate", [
        ligatureSentence(random, 5, 8),
        `\\textit{${styledPhrase(random, 2, 4)}} ${ligatureSentence(random, 4, 7)}`,
      ])}`,
    };
  }
  if (feature === 4) {
    const generated = generateVerticalGlueCase(index, random);
    return {
      ...generated,
      feature: "mixed-vertical-glue",
    };
  }
  return {
    ...generateCase(index, random),
    feature: "mixed-basic",
  };
}

function generateCaseForMode(index, random, mode) {
  if (mode === "ligatures") {
    return generateLigatureCase(index, random);
  }
  if (mode === "quote") {
    return generateQuoteCase(index, random);
  }
  if (mode === "style") {
    return generateStyleCase(index, random);
  }
  if (mode === "list") {
    return generateListCase(index, random);
  }
  if (mode === "vertical-glue") {
    return generateVerticalGlueCase(index, random);
  }
  if (mode === "rule") {
    return generateRuleCase(index, random);
  }
  if (mode === "box") {
    return generateBoxCase(index, random);
  }
  if (mode === "mixed") {
    return generateMixedFeatureCase(index, random);
  }
  return generateCase(index, random);
}

function formatPt(value) {
  return Number(value.toFixed(6)).toString();
}

function svgX(value) {
  return value * texPointToSvgPoint;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderGlyphRun(text, font, x, baseline, computerModernTexMetricProvider) {
  const shaped = computerModernTexMetricProvider.shapeText(text, font);
  const pieces = [];
  let cursor = x;
  for (const item of shaped.items) {
    if (item.kind === "kern") {
      cursor += item.width;
      continue;
    }
    const path = font.data.glyphs?.[String(item.code)] ?? "";
    if (path && item.code !== 32) {
      pieces.push(
        `<path d="${escapeXml(path)}" transform="translate(${formatPt(cursor)} ${formatPt(baseline)})" />`
      );
    }
    cursor += item.width;
  }
  return pieces.join("");
}

function renderGlyphCode(code, font, x, baseline) {
  const path = font.data.glyphs?.[String(code)] ?? "";
  if (!path || code === 32) {
    return "";
  }
  return `<path d="${escapeXml(path)}" transform="translate(${formatPt(x)} ${formatPt(baseline)})" />`;
}

function renderVListRules(items) {
  const pieces = [];
  for (const item of items ?? []) {
    if (item.item?.kind === "rule") {
      const width = item.metrics.width * texPointToSvgPoint;
      const height = (item.metrics.height + item.metrics.depth) * texPointToSvgPoint;
      pieces.push(
        `<rect x="${formatPt(item.x * texPointToSvgPoint)}" y="${formatPt(item.y * texPointToSvgPoint)}" width="${formatPt(width)}" height="${formatPt(height)}" fill="black" />`
      );
      continue;
    }
    if (item.children?.length) {
      pieces.push(...renderVListRules(item.children));
    }
  }
  return pieces;
}

function lineLeadingPt(lineLeading, parseLength) {
  return lineLeading ? parseLength(lineLeading, "pt") ?? 0 : 0;
}

function computeReportLineTops(report, parseLength) {
  const tops = [];
  let cursor = 0;
  for (const line of report.lines) {
    cursor += Math.max(0, line.verticalSkipBefore ?? 0) * texPointToSvgPoint;
    tops[line.lineIndex] = cursor;
    cursor += lineHeightPt + lineLeadingPt(line.break?.lineLeading, parseLength) * texPointToSvgPoint;
  }
  return tops;
}

function computeLineTops(layout, parseLength) {
  if (layout.vlistLayout?.linePlacements?.length) {
    const tops = [];
    for (const placement of layout.vlistLayout.linePlacements) {
      tops[placement.lineIndex] = placement.y * texPointToSvgPoint;
    }
    return tops;
  }
  return computeReportLineTops(layout.report, parseLength);
}

function reportLineBaselineY(line, lineTops) {
  return (lineTops[line.lineIndex] ?? 0) + (Number(line.ascent) || firstLineAscentPt);
}

function reportLineText(line) {
  return line.segments.map((segment) => segment.text ?? "").join("").trimEnd();
}

function renderOursSvg(caseData, layout, pageWidth, pageHeight, deps) {
  const font = deps.computerModernTexMetricProvider.resolveFont({ atPt: defaultTextFontSize });
  const lineTops = computeLineTops(layout, deps.parseLength);
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatPt(pageWidth)}pt" height="${formatPt(pageHeight)}pt" viewBox="0 0 ${formatPt(pageWidth)} ${formatPt(pageHeight)}">`,
    `<rect x="0" y="0" width="${formatPt(pageWidth)}" height="${formatPt(pageHeight)}" fill="white" />`,
    `<g fill="black">`,
  ];
  pieces.push(...renderVListRules(layout.vlistLayout?.items));
  for (const line of layout.report.lines) {
    const top = lineTops[line.lineIndex] ?? 0;
    const baseline = reportLineBaselineY(line, lineTops) - top;
    const left = Number.isFinite(line.xStart) ? line.xStart : 0;
    pieces.push(`<g transform="translate(${formatPt(left)} ${formatPt(top)})">`);
    for (const segment of line.segments) {
      if (segment.kind !== "text") {
        continue;
      }
      const segmentFont = segment.fontId
        ? deps.computerModernTexMetricProvider.resolveFont({
          fontId: segment.fontId,
          atPt: defaultTextFontSize,
        })
        : font;
      if (typeof segment.glyphCode === "number") {
        pieces.push(renderGlyphCode(
          segment.glyphCode,
          segmentFont,
          segment.x - left,
          baseline
        ));
      } else {
        pieces.push(
          renderGlyphRun(
            segment.text ?? "",
            segmentFont,
            segment.x - left,
            baseline,
            deps.computerModernTexMetricProvider
          )
        );
      }
    }
    pieces.push("</g>");
  }
  pieces.push("</g></svg>");
  return pieces.join("");
}

function buildOursTrace(layout, deps) {
  const font = deps.computerModernTexMetricProvider.resolveFont({ atPt: defaultTextFontSize });
  const lineTops = computeLineTops(layout, deps.parseLength);
  return {
    lines: layout.report.lines.map((line) => {
      const baselineY = reportLineBaselineY(line, lineTops);
      const glyphs = [];
      for (const segment of line.segments) {
        if (segment.kind !== "text") {
          continue;
        }
        const segmentFont = segment.fontId
          ? deps.computerModernTexMetricProvider.resolveFont({
            fontId: segment.fontId,
            atPt: defaultTextFontSize,
          })
          : font;
        if (typeof segment.glyphCode === "number") {
          glyphs.push({
            code: traceGlyphTextCode(segment.text, segment.glyphCode),
            fontId: segmentFont.id,
            x: Number(svgX(segment.x).toFixed(6)),
            y: Number(baselineY.toFixed(6)),
            width: Number(svgX(segment.width).toFixed(6)),
          });
          continue;
        }
        const shaped = deps.computerModernTexMetricProvider.shapeText(segment.text ?? "", segmentFont);
        let cursor = svgX(segment.x);
        for (const item of shaped.items) {
          if (item.kind === "kern") {
            cursor += item.width;
            continue;
          }
          if (item.code !== 32) {
            glyphs.push({
              code: item.code,
              fontId: segmentFont.id,
              x: Number(cursor.toFixed(6)),
              y: Number(baselineY.toFixed(6)),
              width: Number(item.width.toFixed(6)),
            });
          }
          cursor += item.width;
        }
      }
      return {
        text: reportLineText(line),
        width: line.width,
        baselineY,
        glyphs,
      };
    }),
  };
}

function traceGlyphTextCode(text, fallbackCode) {
  if (text === "–") {
    return 0x2013;
  }
  if (text === "•") {
    return 0x2022;
  }
  return fallbackCode;
}

function texGlyphText(code) {
  switch (code) {
    case 11:
    case 0xFB00:
      return "ff";
    case 12:
    case 0xFB01:
      return "fi";
    case 13:
    case 0xFB02:
      return "fl";
    case 14:
    case 0xFB03:
      return "ffi";
    case 15:
    case 0xFB04:
      return "ffl";
    case 123:
      return "-";
    case 136:
      return "•";
    case 183:
      return ".";
    default:
      return code >= 0 ? String.fromCodePoint(code) : "?";
  }
}

function normalizeTexGlyphCode(code) {
  switch (code) {
    case 0xFB00:
      return 11;
    case 0xFB01:
      return 12;
    case 0xFB02:
      return 13;
    case 0xFB03:
      return 14;
    case 0xFB04:
      return 15;
    default:
      return code;
  }
}

function texTracePt(value) {
  return Number((Number(value) * texPointToSvgPoint).toFixed(6));
}

function buildTexSvgTrace(svg, texNodeTrace, oursTrace) {
  const svgScale = dvisvgmCoordinateScale(svg);
  const rowsByY = new Map();
  const usePattern = /<use\b[^>]*\bx=['"]([^'"]+)['"][^>]*\by=['"]([^'"]+)['"][^>]*\bxlink:href=['"]#(g\d+)-(\d+)['"]/g;
  for (const match of svg.matchAll(usePattern)) {
    const x = Number(match[1]) * svgScale;
    const y = Number(match[2]) * svgScale;
    const glyphId = `${match[3]}-${match[4]}`;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const key = y.toFixed(6);
    const row = rowsByY.get(key) ?? { sourceY: y, glyphs: [] };
    row.glyphs.push({ glyphId, code: -1, x, y, width: 0 });
    rowsByY.set(key, row);
  }

  const rows = [...rowsByY.values()].sort((left, right) => left.sourceY - right.sourceY);
  for (const row of rows) {
    row.glyphs.sort((left, right) => left.x - right.x);
  }

  const firstTexY = rows[0]?.sourceY ?? 0;
  const firstOursY = oursTrace.lines[0]?.glyphs[0]?.y ?? 0;
  return {
    lines: rows.map((row, lineIndex) => {
      const normalizedY = row.sourceY - firstTexY + firstOursY;
      const nodeLine = texNodeTrace.lines[lineIndex];
      return {
        text: nodeLine?.text ?? row.glyphs.map((glyph) => texGlyphText(glyph.code)).join(""),
        width: row.glyphs.length > 0
          ? row.glyphs.at(-1).x - row.glyphs[0].x
          : 0,
        baselineY: normalizedY,
        glyphs: row.glyphs.map((glyph, glyphIndex) => ({
          ...glyph,
          code: nodeLine?.glyphs[glyphIndex]?.code ?? glyph.code,
          width: nodeLine?.glyphs[glyphIndex]?.width ?? glyph.width,
          fontId: nodeLine?.glyphs[glyphIndex]?.fontId,
          fontName: nodeLine?.glyphs[glyphIndex]?.fontName,
          y: normalizedY,
        })),
      };
    }),
  };
}

function dvisvgmCoordinateScale(svg) {
  const match = svg.match(/<g\b[^>]*\btransform=['"]matrix\(([^'")\s]+)\s+0\s+0\s+([^'")\s]+)\s+/);
  if (!match) {
    return 1;
  }
  const scaleX = Number(match[1]);
  const scaleY = Number(match[2]);
  if (
    Number.isFinite(scaleX) &&
    Number.isFinite(scaleY) &&
    Math.abs(scaleX - scaleY) < 0.000001
  ) {
    return scaleX;
  }
  return 1;
}

function parseEscapedTraceText(value) {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === "t") {
      out += "\t";
    } else if (next === "r") {
      out += "\r";
    } else if (next === "n") {
      out += "\n";
    } else if (next === "\\") {
      out += "\\";
    } else if (next) {
      out += next;
    }
  }
  return out;
}

function parseTexGlyphTrace(tsv) {
  const lines = [];
  for (const rawLine of tsv.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }
    const parts = rawLine.split("\t");
    if (parts[0] === "LINE") {
      const lineIndex = Number(parts[1]) - 1;
      lines[lineIndex] = {
        text: parseEscapedTraceText(parts[5] ?? ""),
        width: texTracePt(parts[2]),
        baselineY: texTracePt(parts[3]),
        badness: Number(parts[4]),
        glyphs: [],
      };
    } else if (parts[0] === "GLYPH") {
      const lineIndex = Number(parts[1]) - 1;
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      line.glyphs.push({
        code: normalizeTexGlyphCode(Number(parts[2])),
        x: texTracePt(parts[3]),
        y: texTracePt(parts[4]),
        width: texTracePt(parts[5]),
        fontId: parts[6] ? Number(parts[6]) : undefined,
        fontName: parts[7] ? parseEscapedTraceText(parts[7]) : undefined,
      });
    }
  }
  return { lines: lines.filter((line) => line && line.glyphs.length > 0) };
}

function runTexGlyphTrace(caseData, caseDir) {
  const traceTexPath = join(caseDir, "trace.tex");
  const traceLuaPath = join(caseDir, "trace.lua");
  const traceOutputPath = join(caseDir, "tex-glyph-trace.tsv");
  writeFileSync(traceTexPath, buildTexTraceDocument(caseData), "utf8");
  writeFileSync(traceLuaPath, texTraceLuaSource(), "utf8");
  execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", traceTexPath], {
    cwd: caseDir,
    env: {
      ...process.env,
      TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
      TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    },
    maxBuffer: 20 * 1024 * 1024,
    stdio: "ignore",
  });
  return parseTexGlyphTrace(readFileSync(traceOutputPath, "utf8"));
}

function compareGlyphTraces(oursTrace, texTrace) {
  const lineGlyphText = (line) => line.glyphs.length > 0
    ? line.glyphs.map((glyph) => texGlyphText(normalizeTexGlyphCode(glyph.code))).join("")
    : (line.text ?? "").replace(/\s+/g, "");
  const oursLines = oursTrace.lines.map(lineGlyphText);
  const texLines = texTrace.lines.map(lineGlyphText);
  const lineTextMatch = JSON.stringify(oursLines) === JSON.stringify(texLines);
  let glyphCodeMatch = oursTrace.lines.length === texTrace.lines.length;
  let fontMatch = oursTrace.lines.length === texTrace.lines.length;
  let maxAbsoluteGlyphDx = 0;
  let maxGlyphDx = 0;
  let maxLineInternalGlyphDx = 0;
  let maxGlyphDy = 0;
  let maxAbsoluteLineLeftDx = 0;
  let maxAbsoluteLineRightDx = 0;
  let maxLineLeftDx = 0;
  let maxLineRightDx = 0;
  let comparedGlyphs = 0;

  const lineCount = Math.min(oursTrace.lines.length, texTrace.lines.length);
  const oursXOrigin = firstGlyph(oursTrace)?.x ?? 0;
  const texXOrigin = firstGlyph(texTrace)?.x ?? 0;
  const oursBaselineOrigin = oursTrace.lines[0]?.glyphs[0]?.y ?? oursTrace.lines[0]?.baselineY ?? 0;
  const texBaselineOrigin = texTrace.lines[0]?.glyphs[0]?.y ?? texTrace.lines[0]?.baselineY ?? 0;
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const oursLine = oursTrace.lines[lineIndex];
    const texLine = texTrace.lines[lineIndex];
    const oursOriginX = oursLine.glyphs[0]?.x ?? 0;
    const texOriginX = texLine.glyphs[0]?.x ?? 0;
    maxAbsoluteLineLeftDx = Math.max(maxAbsoluteLineLeftDx, Math.abs(oursOriginX - texOriginX));
    maxAbsoluteLineRightDx = Math.max(
      maxAbsoluteLineRightDx,
      Math.abs(lineEndX(oursLine) - lineEndX(texLine))
    );
    const oursRelativeLineLeft = oursOriginX - oursXOrigin;
    const texRelativeLineLeft = texOriginX - texXOrigin;
    maxLineLeftDx = Math.max(maxLineLeftDx, Math.abs(oursRelativeLineLeft - texRelativeLineLeft));
    maxLineRightDx = Math.max(
      maxLineRightDx,
      Math.abs(
        (lineEndX(oursLine) - oursXOrigin) - (lineEndX(texLine) - texXOrigin)
      )
    );
    if (oursLine.glyphs.length !== texLine.glyphs.length) {
      glyphCodeMatch = false;
    }
    const glyphCount = Math.min(oursLine.glyphs.length, texLine.glyphs.length);
    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const oursGlyph = oursLine.glyphs[glyphIndex];
      const texGlyph = texLine.glyphs[glyphIndex];
      if (normalizeTexGlyphCode(oursGlyph.code) !== normalizeTexGlyphCode(texGlyph.code)) {
        glyphCodeMatch = false;
      }
      if (!texGlyphFontMatches(oursGlyph, texGlyph)) {
        fontMatch = false;
      }
      maxAbsoluteGlyphDx = Math.max(maxAbsoluteGlyphDx, Math.abs(oursGlyph.x - texGlyph.x));
      const oursBlockX = oursGlyph.x - oursXOrigin;
      const texBlockX = texGlyph.x - texXOrigin;
      maxGlyphDx = Math.max(maxGlyphDx, Math.abs(oursBlockX - texBlockX));
      const oursRelativeX = oursGlyph.x - oursOriginX;
      const texRelativeX = texGlyph.x - texOriginX;
      maxLineInternalGlyphDx = Math.max(maxLineInternalGlyphDx, Math.abs(oursRelativeX - texRelativeX));
      const oursRelativeY = oursGlyph.y - oursBaselineOrigin;
      const texRelativeY = texGlyph.y - texBaselineOrigin;
      maxGlyphDy = Math.max(maxGlyphDy, Math.abs(oursRelativeY - texRelativeY));
      comparedGlyphs += 1;
    }
  }

  return {
    lineTextMatch,
    glyphCodeMatch,
    fontMatch,
    maxAbsoluteGlyphDx: Number(maxAbsoluteGlyphDx.toFixed(6)),
    maxGlyphDx: Number(maxGlyphDx.toFixed(6)),
    maxLineInternalGlyphDx: Number(maxLineInternalGlyphDx.toFixed(6)),
    maxGlyphDy: Number(maxGlyphDy.toFixed(6)),
    maxAbsoluteLineLeftDx: Number(maxAbsoluteLineLeftDx.toFixed(6)),
    maxAbsoluteLineRightDx: Number(maxAbsoluteLineRightDx.toFixed(6)),
    maxLineLeftDx: Number(maxLineLeftDx.toFixed(6)),
    maxLineRightDx: Number(maxLineRightDx.toFixed(6)),
    comparedGlyphs,
    oursLines,
    texLines,
  };
}

function texGlyphFontMatches(oursGlyph, texGlyph) {
  const texFontId = texFontNameToMetricFontId(texGlyph.fontName);
  if (!texFontId || !oursGlyph.fontId) {
    return true;
  }
  return oursGlyph.fontId === texFontId;
}

function texFontNameToMetricFontId(fontName) {
  if (!fontName) {
    return undefined;
  }
  let normalized = fontName.toLowerCase();
  const bracketedFont = /^\[([^:\]]+)/.exec(normalized);
  if (bracketedFont?.[1]) {
    normalized = bracketedFont[1];
  } else {
    normalized = normalized.split(":")[0] ?? normalized;
  }
  if (normalized === "cmr10") {
    return "cmr10";
  }
  if (normalized === "cmbx10") {
    return "cmbx10";
  }
  if (normalized === "cmti10") {
    return "cmti10";
  }
  if (normalized === "cmbxti10") {
    return "cmbxti10";
  }
  if (normalized === "cmtt10") {
    return "cmtt10";
  }
  if (normalized === "cmss10") {
    return "cmss10";
  }
  if (normalized === "cmssi10") {
    return "cmssi10";
  }
  if (normalized === "cmssbx10") {
    return "cmssbx10";
  }
  if (normalized === "cmcsc10") {
    return "cmcsc10";
  }
  if (normalized === "tcrm1000") {
    return "tcrm1000";
  }
  const latinModernNames = new Map([
    ["lmroman10-regular", "lmroman10-regular"],
    ["lmroman10-bold", "lmroman10-bold"],
    ["lmroman10-italic", "lmroman10-italic"],
    ["lmroman10-bolditalic", "lmroman10-bolditalic"],
    ["lmromancaps10-regular", "lmromancaps10-regular"],
    ["lmsans10-regular", "lmsans10-regular"],
    ["lmsans10-bold", "lmsans10-bold"],
    ["lmsans10-oblique", "lmsans10-oblique"],
    ["lmsans10-boldoblique", "lmsans10-boldoblique"],
  ]);
  if (latinModernNames.has(normalized)) {
    return latinModernNames.get(normalized);
  }
  return undefined;
}

function firstGlyph(trace) {
  for (const line of trace.lines) {
    const glyph = line.glyphs[0];
    if (glyph) {
      return glyph;
    }
  }
  return null;
}

function lineEndX(line) {
  const lastGlyph = line.glyphs.at(-1);
  return lastGlyph ? lastGlyph.x + (lastGlyph.width ?? 0) : 0;
}

function buildTexDocument(caseData, pageWidth, pageHeight) {
  return String.raw`\documentclass{article}
\usepackage[paperwidth=${formatPt(pageWidth)}pt,paperheight=${formatPt(pageHeight)}pt,margin=0pt]{geometry}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
\noindent\begin{tikzpicture}[x=1pt,y=1pt]
\node[text width=${formatPt(caseData.width)}pt, align=${caseData.alignment.tikz}, inner sep=0pt, outer sep=0pt, anchor=north west, execute at begin node={\parindent=${formatPt(caseData.parindent)}pt}] at (0,0) {${caseData.text}};
\end{tikzpicture}
\end{document}
`;
}

function texOracleCacheKey(caseData, pageWidth, pageHeight) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: 4,
      text: caseData.text,
      width: caseData.width,
      parindent: caseData.parindent,
      alignment: caseData.alignment.tikz,
      pageWidth,
      pageHeight,
    }))
    .digest("hex")
    .slice(0, 24);
}

function runTexOracle(texPath, pdfPath, texPdfToCairoSvgPath, texDvisvgmSvgPath, caseDir) {
  execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", texPath], {
    cwd: caseDir,
    env: {
      ...process.env,
      TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
      TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    },
    maxBuffer: 20 * 1024 * 1024,
    stdio: "ignore",
  });
  execFileSync("pdftocairo", ["-svg", pdfPath, texPdfToCairoSvgPath], {
    cwd: caseDir,
    stdio: "ignore",
  });
  execFileSync("dvisvgm", ["--pdf", pdfPath, "-n", "-o", texDvisvgmSvgPath], {
    cwd: caseDir,
    stdio: "ignore",
  });
}

function copyTexOracleArtifacts(from, to) {
  copyFileSync(from.texPath, to.texPath);
  copyFileSync(from.pdfPath, to.pdfPath);
  copyFileSync(from.texPdfToCairoSvgPath, to.texPdfToCairoSvgPath);
  copyFileSync(from.texDvisvgmSvgPath, to.texDvisvgmSvgPath);
}

function ensureTexOracle(caseData, pageWidth, pageHeight, paths, options) {
  const texSource = buildTexDocument(caseData, pageWidth, pageHeight);
  if (!options.cache) {
    writeFileSync(paths.texPath, texSource, "utf8");
    runTexOracle(
      paths.texPath,
      paths.pdfPath,
      paths.texPdfToCairoSvgPath,
      paths.texDvisvgmSvgPath,
      paths.caseDir
    );
    return { status: "bypassed", key: null };
  }

  const key = texOracleCacheKey(caseData, pageWidth, pageHeight);
  const cacheDir = join(options.cacheDir, key);
  const cachedPaths = {
    texPath: join(cacheDir, "case.tex"),
    pdfPath: join(cacheDir, "case.pdf"),
    texPdfToCairoSvgPath: join(cacheDir, "tex-pdftocairo.svg"),
    texDvisvgmSvgPath: join(cacheDir, "tex-dvisvgm.svg"),
  };
  const cacheComplete =
    existsSync(cachedPaths.texPath) &&
    existsSync(cachedPaths.pdfPath) &&
    existsSync(cachedPaths.texPdfToCairoSvgPath) &&
    existsSync(cachedPaths.texDvisvgmSvgPath);

  if (cacheComplete && !options.refreshCache) {
    copyTexOracleArtifacts(cachedPaths, paths);
    return { status: "hit", key };
  }

  writeFileSync(paths.texPath, texSource, "utf8");
  runTexOracle(
    paths.texPath,
    paths.pdfPath,
    paths.texPdfToCairoSvgPath,
    paths.texDvisvgmSvgPath,
    paths.caseDir
  );
  mkdirSync(cacheDir, { recursive: true });
  copyTexOracleArtifacts(paths, cachedPaths);
  return { status: "miss", key };
}

function buildTexTraceDocument(caseData) {
  return String.raw`\documentclass{article}
\usepackage{tikz}
\pagestyle{empty}
\makeatletter
\newbox\tracebox
\let\trace@orig@fig@continue\tikz@fig@continue
\def\tikz@fig@continue{%
  \global\setbox\tracebox=\copy\pgfnodeparttextbox%
  \trace@orig@fig@continue%
}
\makeatother
\begin{document}
\noindent\begin{tikzpicture}[x=1pt,y=1pt]
\node[text width=${formatPt(caseData.width)}pt, align=${caseData.alignment.tikz}, inner sep=0pt, outer sep=0pt, anchor=north west, execute at begin node={\parindent=${formatPt(caseData.parindent)}pt}] at (0,0) {${caseData.text}};
\end{tikzpicture}
\directlua{dofile("trace.lua")}
\end{document}
`;
}

function texTraceLuaSource() {
  return String.raw`local out = assert(io.open("tex-glyph-trace.tsv", "w"))
local function pt(value)
  return (value or 0) / 65536
end
local function glyph_text(char)
  if char == 11 then return "ff"
  elseif char == 12 then return "fi"
  elseif char == 13 then return "fl"
  elseif char == 14 then return "ffi"
  elseif char == 15 then return "ffl"
  else return utf8.char(char) end
end
local function escape_text(value)
  return string.gsub(value, "[\t\r\n\\]", function(char)
    if char == "\t" then return "\\t" end
    if char == "\r" then return "\\r" end
    if char == "\n" then return "\\n" end
    return "\\\\"
  end)
end
local function glyph_font_name(font_id)
  local font_data = font.getfont(font_id)
  if not font_data then return "" end
  return font_data.name or font_data.fullname or font_data.psname or font_data.filename or ""
end
local function glue_width(node_value, parent)
  local width = node_value.width or 0
  if not parent then return width end
  local sign = parent.glue_sign or 0
  local order = parent.glue_order or 0
  local set = parent.glue_set or 0
  if sign == 1 and order == (node_value.stretch_order or 0) then
    width = width + set * (node_value.stretch or 0)
  elseif sign == 2 and order == (node_value.shrink_order or 0) then
    width = width - set * (node_value.shrink or 0)
  end
  return width
end
local function disc_is_line_end(disc)
  local current = disc.next
  while current do
    local kind = node.type(current.id)
    if kind == "glyph" or kind == "hlist" or kind == "vlist" or kind == "rule" then
      return false
    elseif kind == "glue" and (current.width or 0) ~= 0 then
      return false
    elseif kind == "kern" and (current.kern or 0) ~= 0 then
      return false
    end
    current = current.next
  end
  return true
end
local append_node_list

local function append_hlist(parts, glyphs, hlist, cursor, baseline)
  append_node_list(parts, glyphs, hlist.list, hlist, cursor, baseline)
  return cursor + (hlist.width or 0)
end

function append_node_list(parts, glyphs, list, parent, cursor, baseline)
  local x = cursor
  if not list then return x end
  for child in node.traverse(list) do
    local kind = node.type(child.id)
    if kind == "glyph" then
      table.insert(parts, glyph_text(child.char))
      table.insert(glyphs, {
        char = child.char,
        x = x,
        y = baseline,
        width = child.width or 0,
        font_id = child.font or 0,
        font_name = glyph_font_name(child.font),
      })
      x = x + (child.width or 0)
    elseif kind == "glue" then
      if #parts > 0 then table.insert(parts, " ") end
      x = x + glue_width(child, parent)
    elseif kind == "kern" then
      x = x + (child.kern or 0)
    elseif kind == "disc" then
      if disc_is_line_end(child) then
        x = append_node_list(parts, glyphs, child.pre, nil, x, baseline)
      else
        x = append_node_list(parts, glyphs, child.replace, nil, x, baseline)
      end
    elseif kind == "hlist" then
      x = append_hlist(parts, glyphs, child, x, baseline)
    elseif kind == "vlist" then
      -- Nested vertical lists are handled by the line collector.
    end
  end
  return x
end

local function find_lines(list, x_origin, y, lines)
  if not list then return y end
  for child in node.traverse(list) do
    local kind = node.type(child.id)
    if kind == "hlist" then
      local has_nested_vlist = false
      local nested_x = x_origin
      if child.list then
        for grandchild in node.traverse(child.list) do
          local grandchild_kind = node.type(grandchild.id)
          if grandchild_kind == "vlist" then
            has_nested_vlist = true
            y = find_lines(grandchild.list, nested_x + (grandchild.shift or 0), y, lines)
          elseif grandchild_kind == "hlist" then
            nested_x = nested_x + (grandchild.width or 0)
          elseif grandchild_kind == "glue" then
            nested_x = nested_x + glue_width(grandchild, child)
          elseif grandchild_kind == "kern" then
            nested_x = nested_x + (grandchild.kern or 0)
          elseif grandchild_kind == "rule" then
            nested_x = nested_x + (grandchild.width or 0)
          end
        end
      end
      if not has_nested_vlist then
        local baseline = y + (child.height or 0)
        local parts = {}
        local glyphs = {}
        append_node_list(parts, glyphs, child.list, child, x_origin + (child.shift or 0), baseline)
        if #glyphs > 0 then
          table.insert(lines, {
            width = child.width or 0,
            baseline = baseline,
            badness = child.badness or -1,
            text = table.concat(parts):gsub("%s+$", ""),
            glyphs = glyphs,
          })
        end
        y = y + (child.height or 0) + (child.depth or 0)
      end
    elseif kind == "vlist" then
      y = find_lines(child.list, x_origin + (child.shift or 0), y, lines)
    elseif kind == "glue" then
      y = y + (child.width or 0)
    elseif kind == "kern" then
      y = y + (child.kern or 0)
    end
  end
  return y
end

local lines = {}
find_lines(tex.box.tracebox.list, 0, 0, lines)
for line_index, line in ipairs(lines) do
  out:write(string.format("LINE\t%d\t%.6f\t%.6f\t%d\t%s\n", line_index, pt(line.width), pt(line.baseline), line.badness, escape_text(line.text)))
  for _, glyph in ipairs(line.glyphs) do
    out:write(string.format(
      "GLYPH\t%d\t%d\t%.6f\t%.6f\t%.6f\t%d\t%s\n",
      line_index,
      glyph.char,
      pt(glyph.x),
      pt(glyph.y),
      pt(glyph.width),
      glyph.font_id,
      escape_text(glyph.font_name)
    ))
  end
end
out:close()
`;
}

function extractSvgRows(svg) {
  const rows = new Map();
  const usePattern = /<use\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/g;
  for (const match of svg.matchAll(usePattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const key = y.toFixed(3);
    const row = rows.get(key) ?? { y, xStart: x, xEnd: x, glyphCount: 0 };
    row.xStart = Math.min(row.xStart, x);
    row.xEnd = Math.max(row.xEnd, x);
    row.glyphCount += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.y - b.y);
}

function rasterize(svgPath, pngPath, widthPx, heightPx) {
  execFileSync("rsvg-convert", [
    "-w", String(widthPx),
    "-h", String(heightPx),
    "-b", "white",
    "-f", "png",
    "-o", pngPath,
    svgPath,
  ]);
}

function compareMetric(metric, expectedPath, actualPath) {
  const result = spawnSync("magick", ["compare", "-metric", metric, expectedPath, actualPath, "null:"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`magick compare failed: ${result.stderr || result.stdout}`);
  }
  const raw = `${result.stdout}${result.stderr}`.trim();
  const match = raw.match(/([-+]?\d+(?:\.\d+)?)(?:\s+\(([-+]?\d+(?:\.\d+)?)\))?/);
  if (!match) {
    throw new Error(`Could not parse ${metric} output: ${raw}`);
  }
  return {
    raw,
    value: Number(match[1]),
    normalized: match[2] === undefined ? null : Number(match[2]),
  };
}

function writeCsv(rows, path) {
  const headers = [
    "id",
    "feature",
    "alignment",
    "width",
    "parindent",
    "oursLines",
    "texRows",
    "texNoiseAeNorm",
    "oursAeNorm",
    "ratio",
    "texNoiseRmseNorm",
    "oursRmseNorm",
    "lineTextMatch",
    "glyphCodeMatch",
    "fontMatch",
    "maxAbsoluteGlyphDx",
    "maxGlyphDx",
    "maxLineInternalGlyphDx",
    "maxGlyphDy",
    "maxAbsoluteLineLeftDx",
    "maxAbsoluteLineRightDx",
    "maxLineLeftDx",
    "maxLineRightDx",
    "texOracleCache",
    "traceFlagged",
    "visualFlagged",
    "flagged",
  ];
  const body = rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  writeFileSync(path, `${headers.join(",")}\n${body.join("\n")}\n`, "utf8");
}

function aggregateBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }
  return [...groups.entries()].map(([value, group]) => {
    const ratios = group.map((row) => row.ratio).filter(Number.isFinite);
    const ours = group.map((row) => row.oursAeNorm).filter(Number.isFinite);
    const noise = group.map((row) => row.texNoiseAeNorm).filter(Number.isFinite);
    return {
      [key]: value,
      cases: group.length,
      flagged: group.filter((row) => row.flagged).length,
      meanRatio: mean(ratios),
      maxRatio: Math.max(...ratios),
      meanOursAeNorm: mean(ours),
      meanTexNoiseAeNorm: mean(noise),
    };
  });
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!existsSync(distEntry) || !existsSync(parseLengthEntry)) {
    throw new Error("Missing core dist files. Run `npm run -w @tikz-editor/core build` first.");
  }
  requireCommands(["lualatex", "pdftocairo", "dvisvgm", "rsvg-convert", "magick"]);

  const deps = {
    ...(await import(distEntry)),
    ...(await import(parseLengthEntry)),
  };
  const runDir = join(resolve(options.outDir), `seed-${options.seed}-cases-${options.cases}-scale-${options.scale}-${timestampSlug()}`);
  mkdirSync(runDir, { recursive: true });

  const random = mulberry32(options.seed);
  const cases = Array.from(
    { length: options.cases },
    (_, index) => generateCaseForMode(index, random, options.caseMode)
  );
  const rows = [];
  const errors = [];
  const texOracleCache = {
    hits: 0,
    misses: 0,
    bypassed: 0,
  };

  for (const caseData of cases) {
    const caseDir = join(runDir, caseData.id);
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(join(caseDir, "case-data.json"), JSON.stringify({
      ...caseData,
      alignment: caseData.alignment.label,
    }, null, 2), "utf8");
    const layout = deps.layoutSimpleTexParagraph(caseData.text, {
      paragraphId: caseData.id,
      width: caseData.width,
      alignment: caseData.alignment.layout,
      parindent: caseData.parindent,
      tikzTextWidthNode: true,
    });
    if (!layout.supported || !layout.report) {
      errors.push({ id: caseData.id, error: layout.fallbackReason ?? "unsupported" });
      continue;
    }
    const oursTrace = buildOursTrace(layout, deps);

    const lineTops = computeLineTops(layout, deps.parseLength);
    const pageWidth = Math.max(360, caseData.width + 20);
    const pageHeight = Math.max(180, (lineTops.at(-1) ?? 0) + lineHeightPt + 20);
    const widthPx = Math.ceil(pageWidth * options.scale);
    const heightPx = Math.ceil(pageHeight * options.scale);
    const texPath = join(caseDir, "case.tex");
    const pdfPath = join(caseDir, "case.pdf");
    const oursSvgPath = join(caseDir, "ours.svg");
    const texPdfToCairoSvgPath = join(caseDir, "tex-pdftocairo.svg");
    const texDvisvgmSvgPath = join(caseDir, "tex-dvisvgm.svg");
    const oursPngPath = join(caseDir, "ours.png");
    const texPdfToCairoPngPath = join(caseDir, "tex-pdftocairo.png");
    const texDvisvgmPngPath = join(caseDir, "tex-dvisvgm.png");
    const texOraclePaths = {
      caseDir,
      texPath,
      pdfPath,
      texPdfToCairoSvgPath,
      texDvisvgmSvgPath,
    };

    writeFileSync(join(caseDir, "input.json"), JSON.stringify({
      ...caseData,
      alignment: caseData.alignment.label,
      oursLines: layout.report.lines.map(reportLineText),
      pageWidth,
      pageHeight,
      scale: options.scale,
    }, null, 2), "utf8");
    writeFileSync(oursSvgPath, renderOursSvg(caseData, layout, pageWidth, pageHeight, deps), "utf8");

    try {
      const oracle = ensureTexOracle(
        caseData,
        pageWidth,
        pageHeight,
        texOraclePaths,
        options
      );
      if (oracle.status === "hit") {
        texOracleCache.hits += 1;
      } else if (oracle.status === "miss") {
        texOracleCache.misses += 1;
      } else {
        texOracleCache.bypassed += 1;
      }
      rasterize(oursSvgPath, oursPngPath, widthPx, heightPx);
      rasterize(texPdfToCairoSvgPath, texPdfToCairoPngPath, widthPx, heightPx);
      rasterize(texDvisvgmSvgPath, texDvisvgmPngPath, widthPx, heightPx);
      const texNodeTrace = runTexGlyphTrace(caseData, caseDir);
      const texSvgTrace = buildTexSvgTrace(readFileSync(texDvisvgmSvgPath, "utf8"), texNodeTrace, oursTrace);
      const traceComparison = compareGlyphTraces(oursTrace, texNodeTrace);
      const svgTraceComparison = texSvgTrace.lines.length > 0
        ? compareGlyphTraces(oursTrace, texSvgTrace)
        : null;
      writeFileSync(join(caseDir, "ours-glyph-trace.json"), JSON.stringify(oursTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "tex-glyph-trace.json"), JSON.stringify(texNodeTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "tex-node-glyph-trace.json"), JSON.stringify(texNodeTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "tex-svg-glyph-trace.json"), JSON.stringify(texSvgTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "trace-comparison.json"), JSON.stringify(traceComparison, null, 2), "utf8");
      if (svgTraceComparison) {
        writeFileSync(join(caseDir, "svg-trace-comparison.json"), JSON.stringify(svgTraceComparison, null, 2), "utf8");
      }

      const texNoiseAe = compareMetric("AE", texPdfToCairoPngPath, texDvisvgmPngPath);
      const oursAe = compareMetric("AE", texPdfToCairoPngPath, oursPngPath);
      const texNoiseRmse = compareMetric("RMSE", texPdfToCairoPngPath, texDvisvgmPngPath);
      const oursRmse = compareMetric("RMSE", texPdfToCairoPngPath, oursPngPath);
      const ratio = texNoiseAe.normalized && texNoiseAe.normalized > 0
        ? oursAe.normalized / texNoiseAe.normalized
        : null;
      const texRows = extractSvgRows(readFileSync(texPdfToCairoSvgPath, "utf8"));
      // The Lua node trace descends into parbox/minipage vlists before TikZ's
      // outer hlist shift is visible, so box mode checks line-relative geometry
      // and leaves absolute x as a diagnostic.
      const ignoreAbsoluteTraceX = options.caseMode === "box";
      const traceFlagged =
        !traceComparison.lineTextMatch ||
        !traceComparison.glyphCodeMatch ||
        !traceComparison.fontMatch ||
        traceComparison.maxGlyphDx > options.glyphDxTolerance ||
        traceComparison.maxLineInternalGlyphDx > options.glyphDxTolerance ||
        traceComparison.maxGlyphDy > options.glyphDyTolerance ||
        (!ignoreAbsoluteTraceX && traceComparison.maxAbsoluteGlyphDx > options.glyphDxTolerance) ||
        (!ignoreAbsoluteTraceX && traceComparison.maxAbsoluteLineLeftDx > options.glyphDxTolerance) ||
        (!ignoreAbsoluteTraceX && traceComparison.maxAbsoluteLineRightDx > options.glyphDxTolerance) ||
        traceComparison.maxLineLeftDx > options.glyphDxTolerance ||
        traceComparison.maxLineRightDx > options.glyphDxTolerance;
      const visualFlagged = ratio !== null && ratio > options.thresholdRatio;
      const flagged = traceFlagged || (options.flagVisualDiff && visualFlagged);
      if (flagged || visualFlagged) {
        execFileSync("magick", [
          texPdfToCairoPngPath,
          oursPngPath,
          "+append",
          join(caseDir, "side-by-side.png"),
        ]);
        spawnSync("magick", [
          "compare",
          texPdfToCairoPngPath,
          oursPngPath,
          join(caseDir, "diff.png"),
        ]);
      }
      const row = {
        id: caseData.id,
        feature: caseData.feature,
        alignment: caseData.alignment.label,
        width: caseData.width,
        parindent: caseData.parindent,
        oursLines: layout.report.lines.length,
        texRows: texRows.length,
        texNoiseAeNorm: texNoiseAe.normalized,
        oursAeNorm: oursAe.normalized,
        ratio,
        texNoiseRmseNorm: texNoiseRmse.normalized,
        oursRmseNorm: oursRmse.normalized,
        lineTextMatch: traceComparison.lineTextMatch,
        glyphCodeMatch: traceComparison.glyphCodeMatch,
        fontMatch: traceComparison.fontMatch,
        maxAbsoluteGlyphDx: traceComparison.maxAbsoluteGlyphDx,
        maxGlyphDx: traceComparison.maxGlyphDx,
        maxLineInternalGlyphDx: traceComparison.maxLineInternalGlyphDx,
        maxGlyphDy: traceComparison.maxGlyphDy,
        maxAbsoluteLineLeftDx: traceComparison.maxAbsoluteLineLeftDx,
        maxAbsoluteLineRightDx: traceComparison.maxAbsoluteLineRightDx,
        maxLineLeftDx: traceComparison.maxLineLeftDx,
        maxLineRightDx: traceComparison.maxLineRightDx,
        texOracleCache: oracle.status,
        traceFlagged,
        visualFlagged,
        flagged,
      };
      rows.push(row);
      console.log(
        `${row.flagged ? "FLAG" : "ok"} ${row.id} ${row.alignment}/${row.feature} ` +
        `lines=${row.oursLines}/${row.texRows} AE=${row.oursAeNorm?.toFixed(4)} ` +
        `noise=${row.texNoiseAeNorm?.toFixed(4)} ratio=${row.ratio?.toFixed(2)} ` +
        `text=${row.lineTextMatch ? "ok" : "diff"} glyphs=${row.glyphCodeMatch ? "ok" : "diff"} ` +
        `fonts=${row.fontMatch ? "ok" : "diff"} ` +
        `dxAbs=${row.maxAbsoluteGlyphDx.toFixed(3)} dxBlock=${row.maxGlyphDx.toFixed(3)} ` +
        `dxLineInternal=${row.maxLineInternalGlyphDx.toFixed(3)} ` +
        `cache=${row.texOracleCache}`
      );
    } catch (error) {
      errors.push({ id: caseData.id, error: error instanceof Error ? error.message : String(error) });
      console.error(`ERROR ${caseData.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = {
    runDir,
    seed: options.seed,
    casesRequested: options.cases,
    casesCompleted: rows.length,
    errors,
    thresholdRatio: options.thresholdRatio,
    flagVisualDiff: options.flagVisualDiff,
    glyphDxTolerance: options.glyphDxTolerance,
    glyphDyTolerance: options.glyphDyTolerance,
    texOracleCache,
    cacheDir: options.cache ? options.cacheDir : null,
    flagged: rows.filter((row) => row.flagged),
    aggregate: {
      byAlignment: aggregateBy(rows, "alignment"),
      byFeature: aggregateBy(rows, "feature"),
    },
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify({ ...summary, rows }, null, 2), "utf8");
  writeCsv(rows, join(runDir, "summary.csv"));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
