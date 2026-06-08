import {
  computerModernTexMetricProvider,
  layoutSimpleTexParagraph,
} from "/core/text/tex/index.js";
import { parseLength } from "/core/semantic/coords/parse-length.js";

const DEFAULT_TEXT_FONT_SIZE = 9.96264;
const LINE_HEIGHT_PT = DEFAULT_TEXT_FONT_SIZE * 1.2;
const FIRST_LINE_ASCENT_PT = DEFAULT_TEXT_FONT_SIZE * 0.7;

const sourceInput = document.querySelector("#source");
const widthInput = document.querySelector("#width");
const parindentInput = document.querySelector("#parindent");
const alignmentInput = document.querySelector("#alignment");
const oursOutput = document.querySelector("#ours-output");
const texOutput = document.querySelector("#tex-output");
const oursStatus = document.querySelector("#ours-status");
const texStatus = document.querySelector("#tex-status");
const oursLines = document.querySelector("#ours-lines");
const texLines = document.querySelector("#tex-lines");

let oracleTimer = 0;
let oracleSequence = 0;

for (const input of [sourceInput, widthInput, parindentInput, alignmentInput]) {
  input.addEventListener("input", scheduleRender);
}

scheduleRender();

function scheduleRender() {
  const options = readOptions();
  renderOurs(options);
  window.clearTimeout(oracleTimer);
  const sequence = ++oracleSequence;
  oracleTimer = window.setTimeout(() => {
    void renderOracle(options, sequence);
  }, 220);
}

function readOptions() {
  return {
    text: sourceInput.value,
    width: clampNumber(Number(widthInput.value), 20, 800, 150),
    parindent: clampNumber(Number(parindentInput.value), 0, 200, 0),
    alignment: alignmentInput.value,
  };
}

function renderOurs(options) {
  const result = layoutSimpleTexParagraph(options.text, {
    paragraphId: "lab:ours",
    width: options.width,
    alignment: options.alignment,
    parindent: options.parindent,
    tikzTextWidthNode: true,
  });

  if (!result.supported || !result.report) {
    setStatus(oursStatus, "fallback", "error");
    oursOutput.innerHTML = `<div class="render-error">${escapeHtml(result.fallbackReason ?? "Unsupported input.")}</div>`;
    oursLines.textContent = "";
    return;
  }

  setStatus(oursStatus, `${result.report.lines.length} lines`, "ok");
  oursOutput.innerHTML = renderReportSvg(result.report);
  oursLines.textContent = formatLines(result.report.lines.map((line) => ({
    text: line.segments.map((segment) => segment.text ?? "").join("").trimEnd(),
    xStart: line.xStart,
  })));
}

async function renderOracle(options, sequence) {
  setStatus(texStatus, "rendering", "");
  try {
    const response = await fetch("/api/oracle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    });
    const result = await response.json();
    if (sequence !== oracleSequence) {
      return;
    }
    if (!result.ok) {
      setStatus(texStatus, "error", "error");
      texOutput.innerHTML = `<div class="render-error">${escapeHtml(result.error ?? "TeX failed.")}\n\n${escapeHtml(result.logTail ?? "")}</div>`;
      texLines.textContent = formatOracleLines(result.lineTexts ?? [], result.visualRows ?? []);
      return;
    }
    setStatus(texStatus, `${result.lineTexts.length} lines`, "ok");
    texOutput.innerHTML = result.svg;
    texLines.textContent = formatOracleLines(result.lineTexts, result.visualRows ?? []);
  } catch (error) {
    if (sequence !== oracleSequence) {
      return;
    }
    setStatus(texStatus, "error", "error");
    texOutput.innerHTML = `<div class="render-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    texLines.textContent = "";
  }
}

function renderReportSvg(report) {
  const font = computerModernTexMetricProvider.resolveFont({ atPt: DEFAULT_TEXT_FONT_SIZE });
  const lineTops = computeLineTops(report);
  const height = Math.max(LINE_HEIGHT_PT, (lineTops.at(-1) ?? 0) + LINE_HEIGHT_PT);
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatPt(report.width)}pt" height="${formatPt(height)}pt" viewBox="0 0 ${formatPt(report.width)} ${formatPt(height)}">`,
    `<rect x="0" y="0" width="${formatPt(report.width)}" height="${formatPt(height)}" fill="white" opacity="0.92" />`,
    `<g fill="currentColor">`,
  ];

  for (const line of report.lines) {
    const lineTop = lineTops[line.lineIndex] ?? line.lineIndex * LINE_HEIGHT_PT;
    const lineLeft = Number.isFinite(line.xStart) ? line.xStart : 0;
    const baseline = FIRST_LINE_ASCENT_PT;
    pieces.push(`<g transform="translate(${formatPt(lineLeft)} ${formatPt(lineTop)})">`);
    for (const segment of line.segments) {
      if (segment.kind !== "text") {
        continue;
      }
      const text = segment.text ?? "";
      if (text) {
        pieces.push(renderGlyphRun(text, font, segment.x - lineLeft, baseline));
      }
    }
    pieces.push("</g>");
  }

  pieces.push("</g></svg>");
  return pieces.join("");
}

function renderGlyphRun(text, font, x, baseline) {
  const shaped = computerModernTexMetricProvider.shapeText(text, font);
  const pieces = [];
  let cursor = x;
  for (const item of shaped.items) {
    if (item.kind === "kern") {
      cursor += item.width;
      continue;
    }
    const d = font.data.glyphs?.[String(item.code)] ?? "";
    if (d && item.code !== 32) {
      const scale = font.atPt / 10;
      const scaleSuffix = Math.abs(scale - 1) > 1e-6 ? ` scale(${formatPt(scale)})` : "";
      pieces.push(`<path data-tex-glyph="${item.code}" d="${escapeAttribute(d)}" transform="translate(${formatPt(cursor)} ${formatPt(baseline)})${scaleSuffix}" />`);
    }
    cursor += item.width;
  }
  return pieces.join("");
}

function computeLineTops(report) {
  const tops = [];
  let cursor = 0;
  for (const line of report.lines) {
    tops[line.lineIndex] = cursor;
    cursor += LINE_HEIGHT_PT + lineLeadingPt(line.break?.lineLeading);
  }
  return tops;
}

function lineLeadingPt(lineLeading) {
  return lineLeading ? parseLength(lineLeading, "pt") ?? 0 : 0;
}

function formatLines(lines) {
  return lines.map((line, index) => {
    const row = typeof line === "string" ? { text: line } : line;
    const xStart = Number.isFinite(row.xStart) ? ` x=${formatPt(row.xStart).padStart(7, " ")}` : "";
    return `${String(index + 1).padStart(2, " ")}${xStart}  ${row.text}`;
  }).join("\n");
}

function formatOracleLines(lineTexts, visualRows) {
  return formatLines(lineTexts.map((text, index) => ({
    text,
    xStart: visualRows[index]?.xStart,
  })));
}

function setStatus(element, text, className) {
  element.textContent = text;
  element.className = className ? `status ${className}` : "status";
}

function clampNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function formatPt(value) {
  return Number(value.toFixed(6)).toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
