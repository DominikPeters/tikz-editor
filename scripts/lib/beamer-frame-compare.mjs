const GLYPH_LINE_Y_TOLERANCE_PT = 0.01;
const MIN_CLUSTER_GAP_PT = 20;

export function normalizeOracleBeamerPageTrace(pageTrace, pageGeometry) {
  if (!pageTrace) {
    throw new Error("The selected oracle page has no shipout trace.");
  }
  const pageWidth = pageGeometry.dimensions.paperWidth.texPt;
  const pageHeight = pageGeometry.dimensions.paperHeight.texPt;
  const pageRule = pageTrace.rules
    .filter((rule) =>
      close(rule.width.texPt, pageWidth, 0.01) &&
      close(rule.height.texPt + rule.depth.texPt, pageHeight, 0.01)
    )
    .sort((left, right) =>
      Math.abs(left.x.texPt) + Math.abs(left.y.texPt) -
      Math.abs(right.x.texPt) - Math.abs(right.y.texPt)
    )[0];
  if (!pageRule) {
    throw new Error("Could not locate the physical page rule in the shipout trace.");
  }
  const origin = {
    x: pageRule.x.texPt,
    y: pageRule.y.texPt,
  };
  const normalizeRect = (value) => ({
    path: value.path,
    x: round(value.x.texPt - origin.x),
    y: round(value.y.texPt - origin.y),
    width: round(value.width.texPt),
    height: round(value.height.texPt),
    depth: round(value.depth.texPt),
    totalHeight: round(value.height.texPt + value.depth.texPt),
  });
  const glyphs = pageTrace.glyphs.map((glyph) => ({
    path: glyph.path,
    code: normalizeGlyphCode(glyph.code),
    x: round(glyph.x.texPt - origin.x),
    y: round(glyph.y.texPt - origin.y),
    width: round(glyph.width.texPt),
    height: round(glyph.height.texPt),
    depth: round(glyph.depth.texPt),
    fontId: glyph.fontId,
    fontName: normalizeFontName(glyph.fontName),
    fontSize: round(glyph.fontSize.texPt),
  }));
  return {
    coordinateSystem: {
      unit: "tex-pt",
      origin: "top-left",
      yAxis: "down",
    },
    page: {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    },
    shipoutOrigin: origin,
    boxes: pageTrace.boxes.map(normalizeRect),
    rules: pageTrace.rules.map(normalizeRect),
    glyphs,
    lines: groupOracleGlyphLines(glyphs),
  };
}

export function buildNativeBeamerPageTrace(render, metricProvider) {
  const rectangles = render.layout.items
    .filter((item) =>
      (
        item.id.endsWith(":background") ||
        item.kind === "list-marker"
      ) &&
      item.paragraphId == null &&
      item.bounds.width > 0 &&
      item.bounds.height > 0
    )
    .map((item) => ({
      id: item.id,
      role: item.kind === "list-marker"
        ? "list-marker"
        : rectangleRole(item.id),
      ...roundedRect(item.bounds),
    }));
  const lines = [];
  const glyphs = [];
  for (const paragraph of render.layout.paragraphs) {
    const placements = new Map(
      paragraph.vlistLayout.linePlacements.map(
        (placement) => [placement.lineIndex, placement]
      )
    );
    for (const line of paragraph.report.lines) {
      const placement = placements.get(line.lineIndex);
      const lineOffsetX = Math.max(
        0,
        Number(placement?.x ?? 0) - Number(line.xStart)
      );
      const baselineY =
        paragraph.bounds.y +
        Number(placement?.y ?? 0) +
        Number(line.ascent);
      const lineGlyphs = [];
      for (const segment of line.segments) {
        if (segment.kind === "math" && segment.mathSvgBody) {
          lineGlyphs.push(...glyphsFromNativeMathSvg({
            svgBody: segment.mathSvgBody,
            originX:
              paragraph.bounds.x +
              lineOffsetX +
              Number(segment.x),
            baselineY,
            metricProvider,
          }));
          continue;
        }
        if (
          segment.kind !== "text" ||
          !segment.text ||
          !segment.fontId ||
          segment.role === "list-label"
        ) {
          continue;
        }
        const segmentFontAtPt = Number(segment.fontAtPt);
        const font = metricProvider.resolveFont({
          fontId: segment.fontId,
          ...(Number.isFinite(segmentFontAtPt)
            ? { atPt: segmentFontAtPt }
            : {}),
        });
        let cursor =
          paragraph.bounds.x +
          lineOffsetX +
          Number(segment.x);
        if (typeof segment.glyphCode === "number") {
          const metric = font.data.chars[String(segment.glyphCode)];
          lineGlyphs.push({
            code: normalizeGlyphCode(segment.glyphCode),
            x: round(cursor),
            y: round(baselineY),
            width: round(Number(segment.width)),
            height: round((metric?.height ?? 0) * font.atPt),
            depth: round((metric?.depth ?? 0) * font.atPt),
            fontName: normalizeFontName(font.id),
            fontSize: round(font.atPt),
          });
          continue;
        }
        const shaped = metricProvider.shapeText(segment.text, font, {
          sourceStart: Number(segment.sourceStartRaw ?? 0),
        });
        for (const item of shaped.items) {
          if (item.kind === "kern") {
            cursor += item.width;
            continue;
          }
          lineGlyphs.push({
            code: normalizeGlyphCode(item.code),
            x: round(cursor),
            y: round(baselineY),
            width: round(item.width),
            height: round(item.height),
            depth: round(item.depth),
            fontName: normalizeFontName(font.id),
            fontSize: round(font.atPt),
          });
          cursor += item.width;
        }
      }
      if (lineGlyphs.length === 0) {
        continue;
      }
      const lineClusters = groupOracleGlyphLines(lineGlyphs);
      for (
        let clusterIndex = 0;
        clusterIndex < lineClusters.length;
        clusterIndex += 1
      ) {
        const cluster = lineClusters[clusterIndex];
        lines.push({
          id:
            `${paragraph.paragraphId}:line:${line.lineIndex}` +
            (lineClusters.length > 1 ? `:${clusterIndex}` : ""),
          paragraphId: paragraph.paragraphId,
          role: paragraph.role,
          lineIndex: line.lineIndex,
          sourceSpan: paragraph.sourceSpan,
          ...cluster,
        });
        glyphs.push(...cluster.glyphs.map((glyph) => ({
          ...glyph,
          paragraphId: paragraph.paragraphId,
          role: paragraph.role,
          lineIndex: line.lineIndex,
        })));
      }
    }
    const displayGlyphs = nativeDisplayMathGlyphs(
      paragraph,
      metricProvider
    );
    for (const [displayLineIndex, displayLine] of
      groupOracleGlyphLines(displayGlyphs).entries()) {
      const lineIndex = paragraph.report.lines.length + displayLineIndex;
      lines.push({
        id: `${paragraph.paragraphId}:display:${displayLineIndex}`,
        paragraphId: paragraph.paragraphId,
        role: paragraph.role,
        lineIndex,
        sourceSpan: paragraph.sourceSpan,
        ...displayLine,
      });
      glyphs.push(...displayLine.glyphs.map((glyph) => ({
        ...glyph,
        paragraphId: paragraph.paragraphId,
        role: paragraph.role,
        lineIndex,
      })));
    }
  }
  return {
    coordinateSystem: render.layout.coordinateSystem,
    page: roundedRect(render.layout.page.page),
    untracedRegions: render.layout.embeddedTikz.map((embedded) => ({
      kind: "embedded-tikz",
      itemId: embedded.itemId,
      bounds: roundedRect(embedded.bounds),
    })),
    rectangles,
    lines,
    glyphs,
  };
}

function nativeDisplayMathGlyphs(paragraph, metricProvider) {
  const glyphs = [];
  const visit = (items) => {
    for (const positioned of items) {
      if (positioned.item.kind === "display-math") {
        glyphs.push(...glyphsFromNativeMathSvg({
          svgBody: positioned.item.box.svgBody ?? "",
          originX: paragraph.bounds.x + Number(positioned.x),
          baselineY:
            paragraph.bounds.y +
            Number(positioned.y) +
            Number(positioned.metrics.height),
          metricProvider,
        }));
      } else if (
        positioned.item.kind === "hbox" &&
        positioned.item.role?.kind === "display-align-row"
      ) {
        for (const renderItem of positioned.item.box.renderItems) {
          if (renderItem.kind !== "tex-math-svg") {
            continue;
          }
          glyphs.push(...glyphsFromNativeMathSvg({
            svgBody: renderItem.svgBody,
            originX:
              paragraph.bounds.x +
              Number(positioned.x) +
              Number(renderItem.x),
            baselineY:
              paragraph.bounds.y +
              Number(positioned.y) +
              Number(renderItem.baseline),
            metricProvider,
          }));
        }
      }
      if (positioned.children?.length) {
        visit(positioned.children);
      }
    }
  };
  visit(paragraph.vlistLayout.items);
  return glyphs;
}

export function compareBeamerPageTraces(nativeTrace, oracleTrace) {
  const geometry = compareRectangles(
    nativeTrace.rectangles,
    oracleTrace.rules.filter((rule) =>
      rule.width > 0 &&
      rule.totalHeight > 0 &&
      rule.x >= -0.01 &&
      rule.y >= -0.01 &&
      rule.x + rule.width <= oracleTrace.page.width + 0.01 &&
      rule.y + rule.totalHeight <= oracleTrace.page.height + 0.01
    )
  );
  const excludedOracleLines = oracleTrace.lines.filter((line) =>
    nativeTrace.untracedRegions.some((region) =>
      pointNearRect(
        line.x,
        line.baselineY,
        region.bounds,
        25
      )
    )
  );
  const excludedOracleLineSet = new Set(excludedOracleLines);
  const text = compareTextLines(
    nativeTrace.lines,
    oracleTrace.lines.filter((line) => !excludedOracleLineSet.has(line))
  );
  text.excludedOracle = excludedOracleLines.map((line) => ({
    ...line,
    reason: "native embedded-TikZ glyph tracing is not yet merged into the page trace",
  }));
  return {
    coordinateSystem: nativeTrace.coordinateSystem,
    summary: {
      matchedRectangles: geometry.matches.length,
      unmatchedNativeRectangles: geometry.unmatchedNative.length,
      unmatchedOracleRules: geometry.unmatchedOracle.length,
      maxRectangleEdgeDeltaPt: geometry.maxEdgeDeltaPt,
      matchedTextLines: text.matches.length,
      unmatchedNativeTextLines: text.unmatchedNative.length,
      unmatchedOracleTextLines: text.unmatchedOracle.length,
      excludedOracleTextLines: text.excludedOracle.length,
      comparedGlyphs: text.comparedGlyphs,
      maxAbsoluteGlyphDxPt: text.maxAbsoluteGlyphDxPt,
      maxAbsoluteGlyphDyPt: text.maxAbsoluteGlyphDyPt,
      glyphCodeMatch: text.glyphCodeMatch,
      fontMatch: text.fontMatch,
    },
    geometry,
    text,
  };
}

function compareRectangles(nativeRectangles, oracleRules) {
  const available = new Set(oracleRules.map((_, index) => index));
  const matches = [];
  const unmatchedNative = [];
  for (const native of nativeRectangles) {
    let best = null;
    for (const index of available) {
      const oracle = oracleRules[index];
      const delta = rectangleDelta(native, oracle);
      const score =
        Math.abs(delta.left) +
        Math.abs(delta.top) +
        Math.abs(delta.right) +
        Math.abs(delta.bottom);
      if (!best || score < best.score) {
        best = { index, oracle, delta, score };
      }
    }
    if (!best) {
      unmatchedNative.push(native);
      continue;
    }
    available.delete(best.index);
    matches.push({
      id: native.id,
      role: native.role,
      native,
      oracle: best.oracle,
      delta: best.delta,
      maxEdgeDeltaPt: round(Math.max(
        ...Object.values(best.delta).map(Math.abs)
      )),
    });
  }
  const unmatchedOracle = [...available].map((index) => oracleRules[index]);
  return {
    matches,
    unmatchedNative,
    unmatchedOracle,
    maxEdgeDeltaPt: round(Math.max(
      0,
      ...matches.map((match) => match.maxEdgeDeltaPt)
    )),
  };
}

function compareTextLines(nativeLines, oracleLines) {
  const available = new Set(oracleLines.map((_, index) => index));
  const matches = [];
  const unmatchedNative = [];
  for (const native of nativeLines) {
    let best = null;
    for (const index of available) {
      const oracle = oracleLines[index];
      if (native.text !== oracle.text) {
        continue;
      }
      const score =
        Math.abs(native.x - oracle.x) +
        Math.abs(native.baselineY - oracle.baselineY);
      if (!best || score < best.score) {
        best = { index, oracle, score };
      }
    }
    if (!best) {
      unmatchedNative.push(native);
      continue;
    }
    available.delete(best.index);
    matches.push(compareGlyphLines(native, best.oracle));
  }
  const unmatchedOracle = [...available].map((index) => oracleLines[index]);
  return {
    matches,
    unmatchedNative,
    unmatchedOracle,
    comparedGlyphs: matches.reduce(
      (total, match) => total + match.comparedGlyphs,
      0
    ),
    maxAbsoluteGlyphDxPt: round(Math.max(
      0,
      ...matches.map((match) => match.maxAbsoluteGlyphDxPt)
    )),
    maxAbsoluteGlyphDyPt: round(Math.max(
      0,
      ...matches.map((match) => match.maxAbsoluteGlyphDyPt)
    )),
    glyphCodeMatch: matches.every((match) => match.glyphCodeMatch),
    fontMatch: matches.every((match) => match.fontMatch),
  };
}

function compareGlyphLines(native, oracle) {
  const count = Math.min(native.glyphs.length, oracle.glyphs.length);
  const glyphs = [];
  for (let index = 0; index < count; index += 1) {
    const nativeGlyph = native.glyphs[index];
    const oracleGlyph = oracle.glyphs[index];
    glyphs.push({
      index,
      codeMatch: nativeGlyph.code === oracleGlyph.code,
      fontMatch: nativeGlyph.fontName === oracleGlyph.fontName,
      native: nativeGlyph,
      oracle: oracleGlyph,
      delta: {
        x: round(nativeGlyph.x - oracleGlyph.x),
        y: round(nativeGlyph.y - oracleGlyph.y),
        width: round(nativeGlyph.width - oracleGlyph.width),
        fontSize: round(nativeGlyph.fontSize - oracleGlyph.fontSize),
      },
    });
  }
  return {
    nativeLineId: native.id,
    paragraphId: native.paragraphId,
    role: native.role,
    text: native.text,
    native: {
      x: native.x,
      baselineY: native.baselineY,
      glyphCount: native.glyphs.length,
    },
    oracle: {
      x: oracle.x,
      baselineY: oracle.baselineY,
      glyphCount: oracle.glyphs.length,
    },
    lineDelta: {
      x: round(native.x - oracle.x),
      baselineY: round(native.baselineY - oracle.baselineY),
    },
    glyphCountMatch: native.glyphs.length === oracle.glyphs.length,
    glyphCodeMatch:
      native.glyphs.length === oracle.glyphs.length &&
      glyphs.every((glyph) => glyph.codeMatch),
    fontMatch:
      native.glyphs.length === oracle.glyphs.length &&
      glyphs.every((glyph) => glyph.fontMatch),
    comparedGlyphs: count,
    maxAbsoluteGlyphDxPt: round(Math.max(
      0,
      ...glyphs.map((glyph) => Math.abs(glyph.delta.x))
    )),
    maxAbsoluteGlyphDyPt: round(Math.max(
      0,
      ...glyphs.map((glyph) => Math.abs(glyph.delta.y))
    )),
    glyphs,
  };
}

function groupOracleGlyphLines(glyphs) {
  const rows = [];
  for (const glyph of [...glyphs].sort(
    (left, right) => left.y - right.y || left.x - right.x
  )) {
    let row = rows.find(
      (candidate) =>
        Math.abs(candidate.baselineY - glyph.y) <=
        GLYPH_LINE_Y_TOLERANCE_PT
    );
    if (!row) {
      row = { baselineY: glyph.y, glyphs: [] };
      rows.push(row);
    }
    row.glyphs.push(glyph);
  }
  const lines = [];
  for (const row of rows) {
    row.glyphs.sort((left, right) => left.x - right.x);
    let cluster = [];
    for (const glyph of row.glyphs) {
      const previous = cluster.at(-1);
      const gap = previous
        ? glyph.x - (previous.x + previous.width)
        : 0;
      const splitThreshold = Math.max(
        MIN_CLUSTER_GAP_PT,
        3 * Math.max(previous?.fontSize ?? 0, glyph.fontSize)
      );
      if (previous && gap > splitThreshold) {
        lines.push(oracleLine(cluster, row.baselineY));
        cluster = [];
      }
      cluster.push(glyph);
    }
    if (cluster.length > 0) {
      lines.push(oracleLine(cluster, row.baselineY));
    }
  }
  return lines.sort(
    (left, right) =>
      left.baselineY - right.baselineY ||
      left.x - right.x
  );
}

function oracleLine(glyphs, baselineY) {
  return {
    text: glyphText(glyphs),
    x: glyphs[0].x,
    baselineY: round(baselineY),
    glyphs,
  };
}

function glyphsFromNativeMathSvg(params) {
  const glyphs = [];
  for (const match of params.svgBody.matchAll(/<path\b[^>]*>/gu)) {
    const tag = match[0];
    const fontId = readSvgAttribute(tag, "data-tex-font");
    const code = Number(readSvgAttribute(tag, "data-tex-glyph"));
    const transform = readSvgAttribute(tag, "transform") ?? "";
    const parsed = parseTranslateScale(transform);
    if (!fontId || !Number.isFinite(code) || !parsed) {
      continue;
    }
    const atPt = parsed.scale / 10;
    const font = params.metricProvider.resolveFont({ fontId, atPt });
    const metric = font.data.chars[String(code)];
    glyphs.push({
      code: normalizeGlyphCode(code),
      x: round(params.originX + parsed.x / 100),
      y: round(params.baselineY + parsed.y / 100),
      width: round((metric?.width ?? 0) * font.atPt),
      height: round((metric?.height ?? 0) * font.atPt),
      depth: round((metric?.depth ?? 0) * font.atPt),
      fontName: normalizeFontName(font.id),
      fontSize: round(font.atPt),
    });
  }
  return glyphs;
}

function parseTranslateScale(transform) {
  const match =
    /translate\(\s*([-0-9.]+)[,\s]+([-0-9.]+)\s*\)\s*scale\(\s*([-0-9.]+)\s*\)/u.exec(
      transform
    );
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    scale: Number(match[3]),
  };
}

function readSvgAttribute(tag, name) {
  return new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? null;
}

function rectangleDelta(native, oracle) {
  return {
    left: round(native.x - oracle.x),
    top: round(native.y - oracle.y),
    right: round(
      native.x + native.width -
      (oracle.x + oracle.width)
    ),
    bottom: round(
      native.y + native.height -
      (oracle.y + oracle.totalHeight)
    ),
    width: round(native.width - oracle.width),
    height: round(native.height - oracle.totalHeight),
  };
}

function rectangleRole(id) {
  if (id.endsWith(":frame-title:background")) {
    return "frame-title";
  }
  if (id.includes(":footline:")) {
    return "footline";
  }
  if (id.endsWith(":background")) {
    return "page";
  }
  return "other";
}

function pointNearRect(x, y, rect, margin) {
  return (
    x >= rect.x - margin &&
    x <= rect.x + rect.width + margin &&
    y >= rect.y - margin &&
    y <= rect.y + rect.height + margin
  );
}

function roundedRect(rect) {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function glyphText(glyphs) {
  return glyphs.map((glyph) => glyphCodeText(glyph.code)).join("");
}

function glyphCodeText(code) {
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
    default:
      return code >= 0 ? String.fromCodePoint(code) : "?";
  }
}

function normalizeGlyphCode(code) {
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

function normalizeFontName(value) {
  const normalized = String(value ?? "").toLowerCase();
  const bracketed = /^\[([^:\]]+)/u.exec(normalized);
  return (bracketed?.[1] ?? normalized.split(":")[0] ?? normalized)
    .replace(/\.(?:otf|ttf)$/u, "");
}

function close(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}
