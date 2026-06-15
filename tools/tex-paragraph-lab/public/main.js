import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
} from "/core/text/tex/index.js";
import { parseLength } from "/core/semantic/coords/parse-length.js";

const DEFAULT_TEXT_FONT_SIZE = 9.96264;
const LINE_HEIGHT_PT = DEFAULT_TEXT_FONT_SIZE * 1.2;
const FIRST_LINE_ASCENT_PT = DEFAULT_TEXT_FONT_SIZE * 0.7;
const MATH_SVG_SCALE = 0.01;

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
const mathBoxProvider = createTexDerivedInlineMathBoxProvider();

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
    rightskipStretch: options.width,
    spaceGlueProfile: "font",
    tikzTextWidthNode: true,
    mathBoxProvider,
  });

  if (!result.supported || !result.report) {
    setStatus(oursStatus, "fallback", "error");
    oursOutput.innerHTML = `<div class="render-error">${escapeHtml(result.fallbackReason ?? "Unsupported input.")}</div>`;
    oursLines.textContent = "";
    return;
  }

  setStatus(oursStatus, `${result.report.lines.length} lines`, "ok");
  oursOutput.innerHTML = renderResultSvg(result);
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

function renderResultSvg(result) {
  const vlistLayout = result.vlistLayout;
  const boxReport = result.vlistLayout?.boxReport;
  if (
    boxReport?.items?.some((item) => item.itemKind === "display-math") ||
    boxReport?.items?.some((item) => item.itemKind === "placeholder") ||
    flattenPositionedItems(vlistLayout?.items ?? []).some((item) =>
      item.item?.kind === "hbox" && item.item.role?.kind === "display-align-row"
    )
  ) {
    return renderVListReportSvg(result.report, vlistLayout);
  }
  return renderParagraphReportSvg(result.report);
}

function renderVListReportSvg(report, vlistLayout) {
  const boxReport = vlistLayout.boxReport;
  const height = Math.max(
    LINE_HEIGHT_PT,
    (boxReport.metrics?.height ?? 0) + (boxReport.metrics?.depth ?? 0)
  );
  const pieces = [
    svgOpen(report.width, height),
    `<g fill="currentColor">`,
  ];

  for (const item of boxReport.items ?? []) {
    if (item.itemKind === "paragraph") {
      const lines = report.lines.filter((line) => lineOverlapsSourceSpan(line, item.sourceSpan));
      pieces.push(renderParagraphLines(lines, item.y ?? 0, item.x ?? 0));
      continue;
    }
  }

  for (const item of flattenPositionedItems(vlistLayout.items ?? [])) {
    if (item.item?.kind === "display-math" && item.item.box?.svgBody) {
      pieces.push(renderMathSvgBody(
        item.item.box.svgBody,
        item.x ?? 0,
        (item.y ?? 0) + item.item.box.height
      ));
      continue;
    }
    if (item.item?.kind === "placeholder") {
      pieces.push(renderPlaceholderItem(item, report.width));
      continue;
    }
    if (item.item?.kind === "hbox" && item.item.role?.kind === "display-align-row") {
      pieces.push(renderHorizontalRenderItems(
        item.item.box?.renderItems ?? [],
        item.x ?? 0,
        item.y ?? 0
      ));
    }
  }

  pieces.push("</g></svg>");
  return pieces.join("");
}

function flattenPositionedItems(items) {
  const flat = [];
  for (const item of items) {
    flat.push(item);
    if (item.children?.length) {
      flat.push(...flattenPositionedItems(item.children));
    }
  }
  return flat;
}

function renderPlaceholderItem(positionedItem, width) {
  const itemWidth = Math.max(24, Math.min(width, positionedItem.metrics?.width ?? width));
  const height = Math.max(10, (positionedItem.metrics?.height ?? 0) + (positionedItem.metrics?.depth ?? 0));
  const x = positionedItem.x ?? 0;
  const y = positionedItem.y ?? 0;
  const reason = positionedItem.item?.reason ?? "Unsupported TeX content.";
  return [
    `<g class="placeholder" transform="translate(${formatPt(x)} ${formatPt(y)})">`,
    `<rect x="0" y="0" width="${formatPt(itemWidth)}" height="${formatPt(height)}" rx="1.5" />`,
    `<text x="4" y="${formatPt(Math.min(height - 2, 8))}">${escapeHtml(reason)}</text>`,
    `</g>`,
  ].join("");
}

function renderHorizontalRenderItems(renderItems, originX, originY) {
  const pieces = [];
  for (const item of renderItems) {
    if (item.kind === "tex-math-svg") {
      pieces.push(renderMathSvgBody(item.svgBody, originX + item.x, originY + item.baseline));
      continue;
    }
    const font = computerModernTexMetricProvider.resolveFont({
      fontId: item.fontId,
      atPt: item.atPt ?? DEFAULT_TEXT_FONT_SIZE,
    });
    if (item.kind === "tex-glyph-run") {
      pieces.push(renderGlyphRun(item.text ?? "", font, originX + item.x, originY + item.baseline));
      continue;
    }
    if (item.kind === "tex-glyph") {
      pieces.push(renderGlyphCode(item.code, font, originX + item.x, originY + item.baseline));
    }
  }
  return pieces.join("");
}

function renderParagraphReportSvg(report) {
  const height = Math.max(
    LINE_HEIGHT_PT,
    paragraphLinesHeight(report.lines)
  );
  return [
    svgOpen(report.width, height),
    `<g fill="currentColor">`,
    renderParagraphLines(report.lines, 0, 0),
    "</g></svg>",
  ].join("");
}

function renderParagraphLines(lines, originY, originX) {
  const font = computerModernTexMetricProvider.resolveFont({ atPt: DEFAULT_TEXT_FONT_SIZE });
  const lineTops = computeLineTops(lines);
  const pieces = [];

  for (const [localIndex, line] of lines.entries()) {
    const lineTop = lineTops[localIndex] ?? localIndex * LINE_HEIGHT_PT;
    const lineLeft = Number.isFinite(line.xStart) ? line.xStart : 0;
    const baseline = lineBaselinePt(line);
    pieces.push(`<g transform="translate(${formatPt(originX + lineLeft)} ${formatPt(originY + lineTop)})">`);
    for (const segment of line.segments) {
      if (segment.kind === "text") {
        const text = segment.text ?? "";
        if (!text) {
          continue;
        }
        const segmentFont = segment.fontId
          ? computerModernTexMetricProvider.resolveFont({
            fontId: segment.fontId,
            atPt: DEFAULT_TEXT_FONT_SIZE,
          })
          : font;
        if (typeof segment.glyphCode === "number") {
          pieces.push(renderGlyphCode(segment.glyphCode, segmentFont, segment.x - lineLeft, baseline));
        } else {
          pieces.push(renderGlyphRun(text, segmentFont, segment.x - lineLeft, baseline));
        }
        continue;
      }
      if (segment.kind === "math" && segment.mathSvgBody) {
        pieces.push(renderMathSvgBody(segment.mathSvgBody, segment.x - lineLeft, baseline));
      }
    }
    pieces.push("</g>");
  }

  return pieces.join("");
}

function svgOpen(width, height) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatPt(width)}pt" height="${formatPt(height)}pt" viewBox="0 0 ${formatPt(width)} ${formatPt(height)}">`,
    `<rect x="0" y="0" width="${formatPt(width)}" height="${formatPt(height)}" fill="white" opacity="0.92" />`,
  ].join("");
}

function renderMathSvgBody(svgBody, x, baseline) {
  return `<g data-tex-paragraph-lab-math="true" transform="translate(${formatPt(x)} ${formatPt(baseline)}) scale(${formatPt(MATH_SVG_SCALE)})">${svgBody}</g>`;
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

function renderGlyphCode(code, font, x, baseline) {
  const d = font.data.glyphs?.[String(code)] ?? "";
  if (!d || code === 32) {
    return "";
  }
  const scale = font.atPt / 10;
  const scaleSuffix = Math.abs(scale - 1) > 1e-6 ? ` scale(${formatPt(scale)})` : "";
  return `<path data-tex-glyph="${code}" d="${escapeAttribute(d)}" transform="translate(${formatPt(x)} ${formatPt(baseline)})${scaleSuffix}" />`;
}

function computeLineTops(report) {
  const tops = [];
  let cursor = 0;
  for (const [index, line] of report.entries()) {
    cursor += Math.max(0, line.verticalSkipBefore ?? 0);
    tops[index] = cursor;
    cursor += lineHeightPt(line) + lineLeadingPt(line.break?.lineLeading);
  }
  return tops;
}

function paragraphLinesHeight(lines) {
  if (lines.length === 0) {
    return LINE_HEIGHT_PT;
  }
  const lineTops = computeLineTops(lines);
  const lastLine = lines.at(-1);
  return (lineTops.at(-1) ?? 0) + lineHeightPt(lastLine);
}

function lineBaselinePt(line) {
  return Math.max(FIRST_LINE_ASCENT_PT, line?.ascent ?? FIRST_LINE_ASCENT_PT);
}

function lineHeightPt(line) {
  return Math.max(LINE_HEIGHT_PT, (line?.ascent ?? 0) + (line?.descent ?? 0));
}

function lineLeadingPt(lineLeading) {
  return lineLeading ? parseLength(lineLeading, "pt") ?? 0 : 0;
}

function lineOverlapsSourceSpan(line, sourceSpan) {
  if (!sourceSpan) {
    return false;
  }
  return line.segments.some((segment) => {
    const start = segment.sourceStartRaw;
    const end = segment.sourceEndRaw;
    return Number.isFinite(start) &&
      Number.isFinite(end) &&
      start < sourceSpan.end &&
      end > sourceSpan.start;
  });
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
