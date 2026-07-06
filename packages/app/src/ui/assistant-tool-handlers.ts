import type { EmitSvgResult, SvgRenderModel, SvgRenderPart } from "tikz-editor/svg/index";
import type { SessionSnapshot } from "../compute";
import type { Diagnostic } from "tikz-editor/diagnostics/types";
import { PT_PER_CM } from "tikz-editor/edit/format";

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export function buildDiagnosticsText(
  fullSource: string,
  snap: SessionSnapshot
): string | null {
  const parseDiags = snap.parseResult?.diagnostics ?? [];
  const semanticDiags = snap.semanticResult?.diagnostics ?? [];
  const allDiags: Diagnostic[] = [...parseDiags, ...semanticDiags];
  if (allDiags.length === 0) {
    return null;
  }
  const lines = fullSource.split("\n");
  const offsetToLine = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < fullSource.length; i++) {
      if (fullSource[i] === "\n") line++;
    }
    return line;
  };
  return allDiags
    .map((d) => {
      const line = offsetToLine(d.span.from);
      const code = d.code ? ` [${d.code}]` : "";
      const srcLine = lines[line - 1];
      const preview = srcLine ? ` | ${srcLine.trimStart()}` : "";
      return `${d.severity} (line ${line})${code}: ${d.message}${preview}`;
    })
    .join("\n");
}

// ─── Figure context ───────────────────────────────────────────────────────────

export function buildFigureContext(
  fullSource: string,
  snap: SessionSnapshot
): string | null {
  const figures = snap.figures;
  if (figures.length <= 1) {
    return null;
  }
  const activeId = snap.activeFigureId;
  const activeIndex = figures.findIndex((f) => f.id === activeId);
  if (activeIndex < 0) {
    return null;
  }
  const figure = figures[activeIndex];
  const figureSource = fullSource.slice(figure.span.from, figure.span.to);
  const linesBeforeFigure = fullSource.slice(0, figure.span.from).split("\n").length;
  const numberedLines = figureSource
    .split("\n")
    .map((line, i) => `${linesBeforeFigure + i}: ${line}`)
    .join("\n");
  // Build a listing of all figures with their indices and line ranges
  const figureListing = figures
    .map((f, i) => {
      const marker = i === activeIndex ? " (active)" : "";
      return `  Figure ${i + 1}: lines ${f.startLine + 1}–${f.endLine + 1}${marker}`;
    })
    .join("\n");

  return `This document contains ${figures.length} figures:\n${figureListing}\n\nThe user is currently editing figure ${activeIndex + 1}.\n\nActive figure source (with line numbers from the full document):\n\`\`\`tex\n${numberedLines}\n\`\`\`\n\nThe full document source is in the file you will edit. Only modify the active figure unless the user asks otherwise. All tools accept a \`figure_index\` parameter (1-indexed) to query any figure; omit it to use the active figure.`;
}

// ─── Element list ─────────────────────────────────────────────────────────────

export function buildElementList(
  fullSource: string,
  snap: SessionSnapshot
): string {
  const scene = snap.scene;
  if (!scene || scene.elements.length === 0) {
    return "No elements in the current scene.";
  }
  const lines = fullSource.split("\n");
  const offsetToLine = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < fullSource.length; i++) {
      if (fullSource[i] === "\n") line++;
    }
    return line;
  };

  const entries = scene.elements.map((el) => {
    const startLine = offsetToLine(el.sourceRef.sourceSpan.from);
    const endLine = offsetToLine(el.sourceRef.sourceSpan.to);
    const lineRange = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
    const stroke = el.style.stroke ?? "none";
    const fill = el.style.fill ?? "none";

    let info = `  sourceId: ${el.sourceRef.sourceId}, kind: ${el.kind}, ${lineRange}, stroke: ${stroke}, fill: ${fill}`;

    if (el.kind === "Text") {
      const name = findNodeName(fullSource, el.sourceRef.sourceSpan.from, el.sourceRef.sourceSpan.to);
      const cx = (el.position.x / PT_PER_CM).toFixed(2);
      const cy = (el.position.y / PT_PER_CM).toFixed(2);
      info += `, center: (${cx}, ${cy})`;
      if (name) info += `, name: "${name}"`;
      if (el.text) info += `, text: "${el.text}"`;
    } else if (el.kind === "Circle") {
      const cx = (el.center.x / PT_PER_CM).toFixed(2);
      const cy = (el.center.y / PT_PER_CM).toFixed(2);
      const r = (el.radius / PT_PER_CM).toFixed(2);
      info += `, center: (${cx}, ${cy}), radius: ${r}`;
    } else if (el.kind === "Ellipse") {
      const cx = (el.center.x / PT_PER_CM).toFixed(2);
      const cy = (el.center.y / PT_PER_CM).toFixed(2);
      info += `, center: (${cx}, ${cy})`;
    }

    // Source preview
    const srcLine = lines[startLine - 1];
    if (srcLine) {
      const trimmed = srcLine.trimStart();
      if (trimmed.length <= 80) {
        info += `\n    ${trimmed}`;
      } else {
        info += `\n    ${trimmed.slice(0, 77)}...`;
      }
    }

    return info;
  });
  return `${scene.elements.length} element(s):\n${entries.join("\n")}`;
}

function findNodeName(source: string, from: number, to: number): string | null {
  const text = source.slice(from, to);
  // Match \node (name) or \node[...] (name)
  const match = /\(([a-zA-Z_][\w.-]*)\)/.exec(text);
  return match?.[1] ?? null;
}

// ─── Node anchors ─────────────────────────────────────────────────────────────

export function buildNodeAnchors(
  snap: SessionSnapshot,
  nodeName: string
): string {
  const targets = snap.semanticResult?.nodeAnchorTargets ?? [];
  const matching = targets.filter((t) => t.nodeName === nodeName);
  if (matching.length === 0) {
    return `No node named "${nodeName}" found. Available nodes: ${[...new Set(targets.map((t) => t.nodeName))].join(", ") || "none"}`;
  }
  const lines = matching.map((t) => {
    const x = (t.world.x / PT_PER_CM).toFixed(3);
    const y = (t.world.y / PT_PER_CM).toFixed(3);
    return `  ${t.anchor}: (${x}, ${y})`;
  });
  return `Anchors for node "${nodeName}" (in cm):\n${lines.join("\n")}`;
}

// ─── Bounds ───────────────────────────────────────────────────────────────────

export function buildBoundsText(snap: SessionSnapshot): string {
  const bounds = snap.scene?.bounds;
  if (!bounds) {
    return "No scene bounds available (scene may be empty).";
  }
  const minX = (bounds.minX / PT_PER_CM).toFixed(3);
  const minY = (bounds.minY / PT_PER_CM).toFixed(3);
  const maxX = (bounds.maxX / PT_PER_CM).toFixed(3);
  const maxY = (bounds.maxY / PT_PER_CM).toFixed(3);
  const w = ((bounds.maxX - bounds.minX) / PT_PER_CM).toFixed(3);
  const h = ((bounds.maxY - bounds.minY) / PT_PER_CM).toFixed(3);
  return `Scene bounds (cm): x: [${minX}, ${maxX}], y: [${minY}, ${maxY}], size: ${w} × ${h}`;
}

// ─── Enhanced preview: grid overlay + zoom ────────────────────────────────────

type ShowGridOptions = {
  spacing?: number;
  color?: string;
};

type ZoomRegionOptions = {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
};

/**
 * Convert a TikZ world-space Y coordinate (in pt, y-up) to SVG Y (y-down).
 * Mirrors the emitter's toSvgPoint: svgY = vb.y + vb.height - (worldY - vb.y)
 */
function tikzPtToSvgY(worldYPt: number, vb: { y: number; height: number }): number {
  return vb.y + vb.height - (worldYPt - vb.y);
}

/**
 * Inverse: SVG Y → TikZ world-space Y (in pt, y-up).
 */
function svgYToTikzPt(svgY: number, vb: { y: number; height: number }): number {
  return vb.y + vb.height - svgY + vb.y;
}

/**
 * Post-process an SVG result to add a coordinate grid and/or zoom to a region.
 * Returns a new EmitSvgResult with modified SVG and viewBox.
 */
export function applyPreviewEnhancements(
  svgResult: EmitSvgResult,
  options: {
    showGrid?: ShowGridOptions;
    zoomRegion?: ZoomRegionOptions;
  }
): EmitSvgResult {
  let { svg, viewBox } = svgResult;
  const originalViewBox = viewBox;

  // Apply zoom (changes viewBox)
  if (options.zoomRegion) {
    const r = options.zoomRegion;
    const svgMinX = r.min_x * PT_PER_CM;
    const svgMaxX = r.max_x * PT_PER_CM;
    // TikZ max_y (top in y-up) → SVG min y (top in y-down)
    const svgYTop = tikzPtToSvgY(r.max_y * PT_PER_CM, originalViewBox);
    const svgYBottom = tikzPtToSvgY(r.min_y * PT_PER_CM, originalViewBox);
    viewBox = {
      x: svgMinX,
      y: svgYTop,
      width: svgMaxX - svgMinX,
      height: svgYBottom - svgYTop
    };
  }

  // Build grid SVG overlay
  let gridMarkup = "";
  if (options.showGrid) {
    const spacingCm = options.showGrid.spacing ?? 1;
    const color = options.showGrid.color ?? "#cccccc";

    // Compute visible TikZ coordinate range from the (potentially zoomed) viewBox
    const tikzMinXCm = viewBox.x / PT_PER_CM;
    const tikzMaxXCm = (viewBox.x + viewBox.width) / PT_PER_CM;
    // SVG top → TikZ max y, SVG bottom → TikZ min y
    const tikzMaxYCm = svgYToTikzPt(viewBox.y, originalViewBox) / PT_PER_CM;
    const tikzMinYCm = svgYToTikzPt(viewBox.y + viewBox.height, originalViewBox) / PT_PER_CM;

    const startX = Math.floor(tikzMinXCm / spacingCm) * spacingCm;
    const endX = Math.ceil(tikzMaxXCm / spacingCm) * spacingCm;
    const startY = Math.floor(tikzMinYCm / spacingCm) * spacingCm;
    const endY = Math.ceil(tikzMaxYCm / spacingCm) * spacingCm;

    const gridLines: string[] = [];
    const tickLabels: string[] = [];
    const fontSize = Math.max(4, Math.min(10, spacingCm * PT_PER_CM * 0.3));

    // Vertical lines (constant x)
    for (let xCm = startX; xCm <= endX; xCm = roundStep(xCm + spacingCm, spacingCm)) {
      const svgX = xCm * PT_PER_CM;
      gridLines.push(
        `<line x1="${svgX}" y1="${viewBox.y}" x2="${svgX}" y2="${viewBox.y + viewBox.height}" stroke="${color}" stroke-width="0.4" />`
      );
      const labelY = viewBox.y + viewBox.height - fontSize * 0.3;
      tickLabels.push(
        `<text x="${svgX + fontSize * 0.15}" y="${labelY}" font-size="${fontSize}" fill="${color}" font-family="sans-serif">${formatTick(xCm)}</text>`
      );
    }

    // Horizontal lines (constant y in TikZ)
    for (let yCm = startY; yCm <= endY; yCm = roundStep(yCm + spacingCm, spacingCm)) {
      const svgY = tikzPtToSvgY(yCm * PT_PER_CM, originalViewBox);
      gridLines.push(
        `<line x1="${viewBox.x}" y1="${svgY}" x2="${viewBox.x + viewBox.width}" y2="${svgY}" stroke="${color}" stroke-width="0.4" />`
      );
      tickLabels.push(
        `<text x="${viewBox.x + fontSize * 0.15}" y="${svgY - fontSize * 0.15}" font-size="${fontSize}" fill="${color}" font-family="sans-serif">${formatTick(yCm)}</text>`
      );
    }

    gridMarkup = `<g class="assistant-grid" opacity="0.6">${gridLines.join("")}${tickLabels.join("")}</g>`;
  }

  // Inject grid and update viewBox in SVG string
  if (gridMarkup || options.zoomRegion) {
    svg = svg.replace(
      /viewBox="[^"]*"/,
      `viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}"`
    );
    if (gridMarkup) {
      svg = svg.replace(/<\/svg>\s*$/, `${gridMarkup}</svg>`);
    }
  }

  return {
    ...svgResult,
    svg,
    viewBox,
    model: applyEnhancementsToModel(svgResult.model, viewBox, gridMarkup)
  };
}

function roundStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatTick(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function applyEnhancementsToModel(
  model: SvgRenderModel,
  viewBox: EmitSvgResult["viewBox"],
  gridMarkup: string
): SvgRenderModel {
  const updatedParts = [...model.parts];

  if (gridMarkup) {
    const partId = nextAssistantGridPartId(updatedParts);
    const gridPart: SvgRenderPart = {
      partId,
      sourceId: "__assistant_tool__",
      elementId: null,
      order: updatedParts.length,
      markup: gridMarkup,
      fingerprint: gridMarkup
    };
    updatedParts.push(gridPart);
  }

  return {
    ...model,
    viewBox,
    parts: updatedParts
  };
}

function nextAssistantGridPartId(parts: readonly SvgRenderPart[]): string {
  const base = "assistant-grid";
  const existing = new Set(parts.map((part) => part.partId));
  if (!existing.has(base)) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base}#${index}`)) {
    index += 1;
  }
  return `${base}#${index}`;
}

// ─── Enhanced preview: overlay code ───────────────────────────────────────────

/**
 * Insert overlay TikZ code before the `\end{tikzpicture}` of the active figure.
 * If activeFigureSpan is provided, inserts within that range; otherwise uses the last match.
 */
export function injectOverlayCode(
  source: string,
  overlayCode: string,
  activeFigureSpan?: { from: number; to: number } | null
): string {
  const searchRegion = activeFigureSpan
    ? source.slice(activeFigureSpan.from, activeFigureSpan.to)
    : source;
  const offset = activeFigureSpan ? activeFigureSpan.from : 0;

  const endPattern = /\\end\{tikzpicture\*?\}/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = endPattern.exec(searchRegion)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return source;
  }
  const insertPos = offset + lastMatch.index;
  return source.slice(0, insertPos) + overlayCode + "\n" + source.slice(insertPos);
}
