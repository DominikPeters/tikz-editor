import { execFileSync } from "node:child_process";

// Compare flat block fills separately from glyph geometry. A global raster
// threshold could hide a small but completely wrong block background.
export function blockPaintProbes(render, nativeTrace, oracleTrace) {
  const probes = [];
  const glyphs = [...nativeTrace.glyphs, ...oracleTrace.glyphs];
  for (const block of render.layout.items.filter(item => item.kind === "block" && item.visibility !== "hidden")) {
    for (const role of ["block-title", "block-body"]) {
      const paragraph = render.layout.paragraphs.find(p => p.role === role &&
        render.layout.items.some(item => item.paragraphId === p.paragraphId && item.parentId === block.id));
      if (!paragraph || paragraph.bounds.height <= 0) continue;
      const bounds = paragraph.bounds;
      for (const fraction of [.5, .25, .75]) {
        const y = bounds.y + bounds.height * fraction;
        let point = null;
        for (let x = bounds.x + bounds.width - 8; x >= bounds.x + 8; x -= 4) {
          if (!glyphs.some(g => x >= g.x - 2 && x <= g.x + g.width + 2 &&
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

export function compareBlockPaint(render, nativeTrace, oracleTrace, nativePng, oraclePng, width, height) {
  const samples = blockPaintProbes(render, nativeTrace, oracleTrace).map(probe => {
    const x = Math.round(probe.x * width / render.svg.viewBox.width);
    const y = Math.round(probe.y * height / render.svg.viewBox.height);
    const native = pixelRgb(nativePng, x, y);
    const oracle = pixelRgb(oraclePng, x, y);
    return { ...probe, native, oracle, maxChannelDelta: Math.max(...native.map((v, i) => Math.abs(v - oracle[i]))) };
  });
  return { tolerance: 2, samples };
}

export function paintContractFailures(paint) {
  return (paint?.samples ?? []).filter(sample => !Number.isFinite(sample.maxChannelDelta) || sample.maxChannelDelta > paint.tolerance)
    .map(sample => `Block paint ${sample.id}: RGB delta ${sample.maxChannelDelta} exceeds ${paint.tolerance}`);
}
