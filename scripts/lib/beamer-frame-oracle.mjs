import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BEAMER_FRAME_ORACLE_VERSION = 1;
export const SP_PER_TEX_POINT = 65_536;

const PROBE_DIMENSIONS = [
  ["paperWidth", String.raw`\paperwidth`],
  ["paperHeight", String.raw`\paperheight`],
  ["textWidth", String.raw`\textwidth`],
  ["textHeight", String.raw`\textheight`],
  ["beamerLeftMargin", String.raw`\beamer@leftmargin`],
  ["beamerRightMargin", String.raw`\beamer@rightmargin`],
  ["geometryLeftMargin", String.raw`\Gm@lmargin`],
  ["geometryRightMargin", String.raw`\Gm@rmargin`],
  ["headHeight", String.raw`\headheight`],
  ["headDepth", String.raw`\headdp`],
  ["footHeight", String.raw`\footheight`],
];

export function beamerProbeInstrumentation() {
  const dimensionWrites = PROBE_DIMENSIONS.map(
    ([name, control]) =>
      String.raw`  \typeout{TIKZ_BEAMER_DIM ${name} \number\dimexpr${control}\relax}%`
  ).join("\n");
  return String.raw`\makeatletter
% Oracle instrumentation only. Dimension names correspond to TeX Live 2025
% beamer.cls and beamerbaseframe{,components,size}.sty.
\newcommand{\tikzeditorbeamerprobe}{%
  \typeout{TIKZ_BEAMER_PAGE \number\c@page}%
  \typeout{TIKZ_BEAMER_META aspectRatio \insertaspectratio}%
${dimensionWrites}
}
\AddToHook{shipout/before}{\tikzeditorbeamerprobe}
\makeatother`;
}

export function buildBeamerFrameProbeSource(source, document, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError("frameIndex must be a non-negative integer.");
  }
  const frame = document.frames[frameIndex];
  if (!frame) {
    throw new RangeError(
      `Frame ${frameIndex + 1} does not exist; document has ${document.frames.length} frames.`
    );
  }
  if (!frame.endSpan) {
    throw new Error(`Frame ${frameIndex + 1} is incomplete and cannot be compiled.`);
  }

  const preamble = source.slice(
    document.preamble.span.from,
    document.preamble.span.to
  );
  const frameSource = source.slice(frame.span.from, frame.span.to);
  return {
    frame,
    source: `${preamble.trimEnd()}

${beamerProbeInstrumentation()}

\\begin{document}
${frameSource}
\\end{document}
`,
  };
}

export function parseBeamerProbeLog(log) {
  const pages = [];
  let currentPage = null;

  for (const line of log.split(/\r?\n/u)) {
    const pageMatch = /TIKZ_BEAMER_PAGE\s+(-?\d+)/u.exec(line);
    if (pageMatch?.[1]) {
      currentPage = {
        pageNumber: Number.parseInt(pageMatch[1], 10),
        metadata: {},
        dimensions: {},
      };
      pages.push(currentPage);
      continue;
    }
    const metadataMatch =
      /TIKZ_BEAMER_META\s+([A-Za-z][A-Za-z0-9]*)\s+(.+?)\s*$/u.exec(line);
    if (metadataMatch?.[1] && metadataMatch[2] != null && currentPage) {
      currentPage.metadata[metadataMatch[1]] = metadataMatch[2];
      continue;
    }
    const dimensionMatch =
      /TIKZ_BEAMER_DIM\s+([A-Za-z][A-Za-z0-9]*)\s+(-?\d+)/u.exec(line);
    if (
      dimensionMatch?.[1] &&
      dimensionMatch[2] != null &&
      currentPage
    ) {
      const sp = Number.parseInt(dimensionMatch[2], 10);
      currentPage.dimensions[dimensionMatch[1]] = {
        sp,
        texPt: sp / SP_PER_TEX_POINT,
      };
    }
  }

  return { pages };
}

export function parsePdfInfo(output) {
  const pagesMatch = /^Pages:\s+(\d+)\s*$/mu.exec(output);
  const pageSizeMatch =
    /^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts(?:\s+\(([^)]+)\))?\s*$/mu.exec(
      output
    );
  const rotationMatch = /^Page rot:\s+(-?\d+)\s*$/mu.exec(output);
  if (!pagesMatch?.[1] || !pageSizeMatch?.[1] || !pageSizeMatch[2]) {
    throw new Error("pdfinfo output did not contain page count and page size.");
  }
  return {
    pageCount: Number.parseInt(pagesMatch[1], 10),
    widthPdfPt: Number(pageSizeMatch[1]),
    heightPdfPt: Number(pageSizeMatch[2]),
    description: pageSizeMatch[3] ?? null,
    rotation: rotationMatch?.[1]
      ? Number.parseInt(rotationMatch[1], 10)
      : 0,
  };
}

export function parseBeamerClassVersion(source) {
  const match =
    /\\ProvidesClass\{beamer\}\s*\[([0-9/]+)\s+v([^\s]+)\s+([^\]]+)\]/u.exec(
      source
    );
  return match
    ? {
      date: match[1],
      version: match[2],
      description: match[3],
    }
    : null;
}

export function summarizeMutoolStructuredText(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.pages)
  ) {
    throw new TypeError("Expected mutool structured-text JSON with pages.");
  }
  return {
    pages: value.pages.map((page, pageIndex) => {
      const blocks =
        page && typeof page === "object" && Array.isArray(page.blocks)
          ? page.blocks
          : [];
      const textBlocks = blocks.filter(
        (block) => block && typeof block === "object" && block.type === "text"
      );
      return {
        pageNumber: pageIndex + 1,
        textBounds: unionBounds(
          textBlocks
            .map((block) => normalizeBounds(block.bbox))
            .filter(Boolean)
        ),
        lines: textBlocks.flatMap((block) => {
          const lines = Array.isArray(block.lines) ? block.lines : [];
          return lines.flatMap((line) => {
            if (!line || typeof line !== "object") {
              return [];
            }
            const text = typeof line.text === "string" ? line.text : "";
            const bounds = normalizeBounds(line.bbox);
            return [{
              text,
              bounds,
              baseline:
                Number.isFinite(line.x) && Number.isFinite(line.y)
                  ? { x: line.x, y: line.y }
                  : null,
              font:
                line.font && typeof line.font === "object"
                  ? {
                    name:
                      typeof line.font.name === "string"
                        ? line.font.name
                        : null,
                    size: Number.isFinite(line.font.size)
                      ? line.font.size
                      : null,
                    weight:
                      typeof line.font.weight === "string"
                        ? line.font.weight
                        : null,
                    style:
                      typeof line.font.style === "string"
                        ? line.font.style
                        : null,
                  }
                  : null,
            }];
          });
        }),
      };
    }),
  };
}

export function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function firstVersionLine(output) {
  return String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown";
}

function normalizeBounds(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.w) ||
    !Number.isFinite(value.h)
  ) {
    return null;
  }
  return { x: value.x, y: value.y, width: value.w, height: value.h };
}

function unionBounds(bounds) {
  if (bounds.length === 0) {
    return null;
  }
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
