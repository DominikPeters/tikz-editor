import { execFileSync } from "node:child_process";

export const beamerPaintTolerance = 2;

// Compare flat fills separately from glyph geometry. A global raster
// threshold could hide a small but completely wrong block background.
export function blockPaintProbes(render, nativeTrace, oracleTrace) {
  const probes = [];
  const glyphs = [...nativeTrace.glyphs, ...oracleTrace.glyphs];
  const pictures = render.layout.items.filter(item =>
    (item.kind === "tikzpicture" || item.kind === "graphics") && item.visibility !== "hidden");
  for (const block of render.layout.items.filter(item => item.kind === "block" && item.visibility !== "hidden")) {
    // Each nested block has its own probes. Its paint (including rounded
    // transitions and shadows) is not a flat sample of the parent's fill.
    const nestedBlocks = render.layout.items.filter(item => item.kind === "block" && item.id !== block.id && item.visibility !== "hidden" &&
      block.sourceSpan.from <= item.sourceSpan.from && item.sourceSpan.to <= block.sourceSpan.to);
    for (const role of ["block-title", "block-body"]) {
      const paragraph = render.layout.paragraphs.find(p => p.role === role &&
        render.layout.items.some(item => item.paragraphId === p.paragraphId && item.parentId === block.id));
      if (!paragraph || paragraph.bounds.height <= 0) continue;
      const bounds = paragraph.bounds;
      for (const fraction of [.5, .25, .75]) {
        const y = bounds.y + bounds.height * fraction;
        let point = null;
        for (let x = bounds.x + bounds.width - 8; x >= bounds.x + 8; x -= 4) {
          if (!nestedBlocks.some(item => x >= item.bounds.x - 6 && x <= item.bounds.x + item.bounds.width + 6 &&
              y >= item.bounds.y - 6 && y <= item.bounds.y + item.bounds.height + 6) &&
              !pictures.some(item => x >= item.bounds.x - 2 && x <= item.bounds.x + item.bounds.width + 2 &&
                y >= item.bounds.y - 2 && y <= item.bounds.y + item.bounds.height + 2) &&
              !glyphs.some(g => x >= g.x - 2 && x <= g.x + g.width + 2 &&
              y >= g.y - g.height - 2 && y <= g.y + g.depth + 2)) {
            point = { x, y };
            break;
          }
        }
        if (point) { probes.push({ id: `${block.id}:${role}`, ...point }); break; }
      }
    }
  }
  return probes;
}

function pixelRgb(path, x, y) {
  const values = execFileSync("magick", [path, "-crop", `3x3+${x - 1}+${y - 1}`,
    "+repage", "-format", "%[fx:mean.r*255] %[fx:mean.g*255] %[fx:mean.b*255]", "info:"],
  { encoding: "utf8" }).trim().split(/\s+/u).map(Number);
  if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error("Invalid paint probe RGB.");
  return values;
}

export function compareImagePaint(render, nativeTrace, nativePng, oraclePng, width, height) {
  const probes = [];
  for (const graphic of nativeTrace.rectangles.filter(rect => rect.role === "image")) {
    const points = graphic.paintProbes ?? [.25, .75].flatMap(y => [.25, .75].map(x => ({ x: graphic.x + graphic.width * x, y: graphic.y + graphic.height * y })));
    for (const [index, point] of points.entries()) {
      probes.push({ id: `${graphic.id}:image:${Math.floor(index / 2)}:${index % 2}`, ...point });
    }
  }
  return samplePaint(probes, render.svg.viewBox, nativePng, oraclePng, width, height);
}

export function compareBlockPaint(render, nativeTrace, oracleTrace, nativePng, oraclePng, width, height, additionalProbes = [], imageSamples = []) {
  const automaticProbes = blockPaintProbes(render, nativeTrace, oracleTrace);
  const ids = new Set([...automaticProbes, ...imageSamples].map(probe => probe.id));
  for (const probe of additionalProbes) {
    if (typeof probe.id !== "string" || !probe.id || ids.has(probe.id) || !Number.isFinite(probe.x) || !Number.isFinite(probe.y) ||
        probe.x <= 0 || probe.x >= render.svg.viewBox.width || probe.y <= 0 || probe.y >= render.svg.viewBox.height) {
      throw new Error("Invalid or duplicate explicit paint probe.");
    }
    ids.add(probe.id);
  }
  const samples = samplePaint([...automaticProbes, ...additionalProbes], render.svg.viewBox, nativePng, oraclePng, width, height);
  return { tolerance: beamerPaintTolerance, samples: [...samples, ...imageSamples] };
}

function samplePaint(probes, viewBox, nativePng, oraclePng, width, height) {
  return probes.map(probe => {
    const x = Math.round(probe.x * width / viewBox.width);
    const y = Math.round(probe.y * height / viewBox.height);
    const native = pixelRgb(nativePng, x, y);
    const oracle = pixelRgb(oraclePng, x, y);
    return { ...probe, native, oracle, maxChannelDelta: Math.max(...native.map((v, i) => Math.abs(v - oracle[i]))) };
  });
}

export function paintContractFailures(paint) {
  return (paint?.samples ?? []).filter(sample => !Number.isFinite(sample.maxChannelDelta) || sample.maxChannelDelta > paint.tolerance)
    .map(sample => `Block paint ${sample.id}: RGB delta ${sample.maxChannelDelta} exceeds ${paint.tolerance}`);
}

/** Compare the complete footprint of a fixture's unique flat TikZ paint.
 * Independent of text tracing and its deliberately untraced PGF regions. */
export function compareColorMasks(nativePng, oraclePng, width, height, colors = []) {
  if (!colors.length) return [];
  const read = path => execFileSync("magick", [path, "-alpha", "off", "-depth", "8", "rgb:-"], { maxBuffer: width * height * 3 + 1 });
  const native = read(nativePng), oracle = read(oraclePng);
  if (native.length !== width * height * 3 || oracle.length !== native.length) throw new Error("Invalid paint mask dimensions.");
  return colors.map(({ color }) => compareColorPixels(native, oracle, color, width));
}

export function compareColorPixels(native, oracle, color, width) {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("Invalid paint-mask color.");
  if (native.length !== oracle.length || native.length % 3 !== 0) throw new Error("Invalid RGB pixels.");
  const target = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16));
  const matches = (pixels, index) => target.every((channel, offset) => Math.abs(pixels[index + offset] - channel) <= 2);
  const pixelCount = native.length / 3;
  const edgeTolerancePx = width === undefined ? 0 : 1;
  const gridWidth = width ?? pixelCount;
  if (!Number.isSafeInteger(gridWidth) || gridWidth <= 0 || pixelCount % gridWidth !== 0) throw new Error("Invalid mask width.");
  const gridHeight = pixelCount / gridWidth;
  const nativeMask = new Uint8Array(pixelCount), oracleMask = new Uint8Array(pixelCount);
  let nativePixels = 0, oraclePixels = 0, disagreement = 0, interiorDisagreement = 0;
  for (let index = 0; index < pixelCount; index++) {
    nativeMask[index] = Number(matches(native, index * 3));
    oracleMask[index] = Number(matches(oracle, index * 3));
    nativePixels += nativeMask[index];
    oraclePixels += oracleMask[index];
  }
  const coverageChannel = target.indexOf(Math.min(...target));
  const coverageRange = 255 - target[coverageChannel];
  const onWhiteCoverageRamp = (pixels, index) => {
    if (coverageRange === 0) return false;
    const coverage = (255 - pixels[index * 3 + coverageChannel]) / coverageRange;
    return coverage >= 0 && coverage <= 1 && target.every((channel, offset) =>
      Math.abs(pixels[index * 3 + offset] - (255 - coverage * (255 - channel))) <= 2);
  };
  const nearBoundary = (mask, pixels, index) => {
    const x = index % gridWidth, y = Math.floor(index / gridWidth);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      const outside = nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight;
      const neighborIndex = ny * gridWidth + nx;
      const neighbor = outside ? 0 : mask[neighborIndex];
      if (neighbor !== mask[index]) return true;
      // A thin glyph/stroke may have no fully opaque sample on one side.
      // Its changing target-to-white coverage still marks an edge inside
      // the same 1px band. Constant missing paint and other ink colors do not.
      if (!outside && onWhiteCoverageRamp(pixels, index) && onWhiteCoverageRamp(pixels, neighborIndex) &&
          target.some((_, channel) => pixels[index * 3 + channel] !== pixels[neighborIndex * 3 + channel])) return true;
    }
    return false;
  };
  for (let index = 0; index < pixelCount; index++) {
    if (nativeMask[index] === oracleMask[index]) continue;
    disagreement++;
    // Poppler hints text and rounds fill edges differently from librsvg.
    // Ignore only disagreements in BOTH masks' one-pixel boundary bands.
    // A new hole or missing shape inside otherwise matching paint still fails.
    if (!edgeTolerancePx || !nearBoundary(nativeMask, native, index) || !nearBoundary(oracleMask, oracle, index)) interiorDisagreement++;
  }
  return { color, nativePixels, oraclePixels, disagreement, relativeDifference: disagreement / Math.max(nativePixels, oraclePixels, 1), edgeTolerancePx,
    boundaryMethod: "binary-and-white-coverage", interiorDisagreement };
}
