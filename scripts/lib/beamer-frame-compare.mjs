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
        item.kind === "background" ||
        item.id.endsWith(":background") ||
        (item.kind === "list-marker" && item.traceAsGlyph !== true)
      ) &&
      item.visibility !== "hidden" &&
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
  const coveredRectangles = render.layout.items
    .filter((item) =>
      item.visibility === "hidden" &&
      (
        item.kind === "list-marker" ||
        item.id.endsWith(":background")
      ) &&
      item.bounds.width > 0 &&
      item.bounds.height > 0
    )
    .map((item) => ({
      id: item.id,
      role: "list-marker",
      ...roundedRect(item.bounds),
    }));
  const lines = [];
  const glyphs = [];
  const coveredGlyphs = [];
  for (const paragraph of render.layout.paragraphs) {
    const marginLabelSpans = [];
    const collectMarginLabels = (items) => {
      for (const positioned of items) {
        if (positioned.item.kind === "hbox" && positioned.item.role?.kind === "list-label") marginLabelSpans.push(positioned.item.sourceSpan);
        if (positioned.children) collectMarginLabels(positioned.children);
      }
    };
    collectMarginLabels(paragraph.vlistLayout.items);
    const placements = new Map(
      paragraph.vlistLayout.linePlacements.map(
        (placement) => [placement.lineIndex, placement]
      )
    );
    for (const line of paragraph.report.lines) {
      const placement = placements.get(line.lineIndex);
      const lineOffsetX = line.segments.some((segment) => segment.role === "list-label") ? 0 : Math.max(
        0,
        Number(placement?.x ?? 0) - Number(line.xStart)
      );
      const baselineY =
        paragraph.bounds.y +
        Number(placement?.y ?? 0) +
        Number(line.ascent);
      const lineGlyphs = [];
      for (const segment of mergeGeneratedTraceSegments(line.segments)) {
        const segmentCovered = sourceRangeIsHidden(
          Number(segment.sourceStartRaw),
          Number(segment.sourceEndRaw),
          paragraph.hiddenSourceSpans
        );
        const segmentGlyphs = segmentCovered
          ? coveredGlyphs
          : lineGlyphs;
        if (segment.kind === "math" && segment.mathSvgBody) {
          const math = featuresFromNativeMathSvg({
            svgBody: segment.mathSvgBody,
            originX:
              paragraph.bounds.x +
              lineOffsetX +
              Number(segment.x),
            baselineY,
            metricProvider,
          });
          segmentGlyphs.push(...math.glyphs);
          const segmentRectangles = segmentCovered
            ? coveredRectangles
            : rectangles;
          segmentRectangles.push(...math.rules.filter((rule) => rule.width > 0 && rule.height > 0).map((rule, ruleIndex) => ({
            id:
              `${paragraph.paragraphId}:line:${line.lineIndex}` +
              `:math-rule:${rectangles.length}:${ruleIndex}`,
            ...rule,
          })));
          continue;
        }
        if (
          segment.kind !== "text" ||
          !segment.text ||
          !segment.fontId ||
          (segment.role === "list-label" && marginLabelSpans.some((span) => span && span.start <= segment.sourceStartRaw && segment.sourceEndRaw <= span.end))
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
          segmentGlyphs.push({
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
          segmentGlyphs.push({
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
      metricProvider,
      rectangles
    );
    coveredGlyphs.push(...nativeDisplayMathGlyphs(
      paragraph,
      metricProvider,
      coveredRectangles,
      true
    ));
    const displayLines = groupOracleGlyphLines(displayGlyphs);
    for (const [displayLineIndex, displayLine] of displayLines.entries()) {
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
    const labelGlyphs = nativeVListLabelGlyphs(paragraph, metricProvider);
    for (const [labelLineIndex, labelLine] of
      groupOracleGlyphLines(labelGlyphs).entries()) {
      const lineIndex =
        paragraph.report.lines.length +
        displayLines.length +
        labelLineIndex;
      lines.push({
        id: `${paragraph.paragraphId}:label:${labelLineIndex}`,
        paragraphId: paragraph.paragraphId,
        role: paragraph.role,
        lineIndex,
        sourceSpan: paragraph.sourceSpan,
        ...labelLine,
      });
      glyphs.push(...labelLine.glyphs.map((glyph) => ({
        ...glyph,
        paragraphId: paragraph.paragraphId,
        role: paragraph.role,
        lineIndex,
      })));
    }
    coveredGlyphs.push(
      ...nativeVListLabelGlyphs(paragraph, metricProvider, true)
    );
  }
  for (const embedded of render.layout.embeddedTikz) {
    const embeddedGlyphs = nativeEmbeddedTikzGlyphs(
      embedded,
      metricProvider
    );
    for (const [embeddedLineIndex, embeddedLine] of
      groupOracleGlyphLines(embeddedGlyphs).entries()) {
      lines.push({
        id: `${embedded.itemId}:text:${embeddedLineIndex}`,
        paragraphId: embedded.itemId,
        role: "embedded-tikz",
        lineIndex: embeddedLineIndex,
        sourceSpan: embedded.sourceSpan,
        ...embeddedLine,
      });
      glyphs.push(...embeddedLine.glyphs.map((glyph) => ({
        ...glyph,
        paragraphId: embedded.itemId,
        role: "embedded-tikz",
        lineIndex: embeddedLineIndex,
      })));
    }
  }
  return {
    coordinateSystem: render.layout.coordinateSystem,
    page: roundedRect(render.layout.page.page),
    untracedRegions: [],
    rectangles,
    coveredRectangles,
    lines: canonicalNativeGlyphLines(glyphs, lines),
    glyphs,
    coveredLines: groupOracleGlyphLines(coveredGlyphs),
  };
}

function mergeGeneratedTraceSegments(segments) {
  const result = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (
      previous?.kind === "text" &&
      segment.kind === "text" &&
      previous.sourceRangePolicy === "generated" &&
      segment.sourceRangePolicy === "generated" &&
      previous.runIndex === segment.runIndex &&
      previous.fontId === segment.fontId &&
      previous.fontAtPt === segment.fontAtPt &&
      previous.sourceStartRaw === segment.sourceStartRaw &&
      previous.sourceEndRaw === segment.sourceEndRaw &&
      previous.endOffset === segment.startOffset
    ) {
      const previousStops = previous.caretStops ?? [];
      const segmentStops = segment.caretStops ?? [];
      result[result.length - 1] = {
        ...previous,
        text: `${previous.text ?? ""}${segment.text ?? ""}`,
        endOffset: segment.endOffset,
        width: Number(segment.x) + Number(segment.width) - Number(previous.x),
        caretStops: [
          ...previousStops,
          ...segmentStops.slice(1),
        ],
      };
      continue;
    }
    result.push({ ...segment });
  }
  return result;
}

function canonicalNativeGlyphLines(glyphs, lines) {
  const sourceLines = new Map(lines.map((line) => [
    `${line.paragraphId}:${line.lineIndex}`,
    line,
  ]));
  return groupOracleGlyphLines(glyphs)
    .map((line, index) => {
      const firstGlyph = line.glyphs[0];
      const sourceKeys = new Set(line.glyphs.map((glyph) =>
        `${glyph.paragraphId}:${glyph.lineIndex}`
      ));
      const source = sourceKeys.size === 1
        ? sourceLines.get([...sourceKeys][0])
        : sourceLines.get(
          `${firstGlyph?.paragraphId}:${firstGlyph?.lineIndex}`
        );
      return {
        id: sourceKeys.size === 1 && source
          ? source.id
          : `native:page-line:${index}`,
        paragraphId: source?.paragraphId ?? "native:page",
        role: source?.role ?? "body",
        lineIndex: index,
        sourceSpan: source?.sourceSpan ?? { from: 0, to: 0 },
        ...line,
      };
    });
}

function nativeEmbeddedTikzGlyphs(embedded, metricProvider) {
  const scale = embedded.bounds.width / embedded.viewBox.width;
  const pageTransform = [
    scale,
    0,
    0,
    scale,
    embedded.bounds.x - embedded.viewBox.x * scale,
    embedded.bounds.y - embedded.viewBox.y * scale,
  ];
  const glyphs = [];
  for (const part of embedded.model.parts) {
    const textContexts = [];
    const stack = [{
      transform: pageTransform,
      relativeTransform: null,
      textContext: null,
    }];
    for (const match of part.markup.matchAll(/<\/?[^>]+>/gu)) {
      const tag = match[0];
      if (tag.startsWith("</")) {
        if (stack.length > 1) {
          stack.pop();
        }
        continue;
      }
      const tagName = /^<([A-Za-z][\w:-]*)/u.exec(tag)?.[1]?.toLowerCase();
      if (!tagName) {
        continue;
      }
      let localTransform = identityMatrix();
      if (tagName === "svg") {
        localTransform = svgViewportTransform(tag);
      }
      const explicitTransform = parseSvgTransform(
        readSvgAttribute(tag, "transform") ?? ""
      );
      localTransform = multiplyMatrices(localTransform, explicitTransform);
      const parent = stack.at(-1);
      const transform = multiplyMatrices(parent.transform, localTransform);
      const startsTextContext =
        tagName === "svg" &&
        readSvgAttribute(tag, "data-text-renderer") === "tex";
      const textContext = startsTextContext
        ? {
            glyphs: [],
            rotated:
              Math.abs(parent.transform[1]) > 1e-6 ||
              Math.abs(parent.transform[2]) > 1e-6,
          }
        : parent.textContext;
      if (startsTextContext) {
        textContexts.push(textContext);
      }
      const relativeTransform = startsTextContext
        ? localTransform
        : parent.relativeTransform
          ? multiplyMatrices(parent.relativeTransform, localTransform)
          : null;
      if (tagName === "path") {
        const fontId = readSvgAttribute(tag, "data-tex-font");
        const code = Number(readSvgAttribute(tag, "data-tex-glyph"));
        if (fontId && Number.isFinite(code)) {
          const atPt = 10 * Math.hypot(transform[0], transform[1]);
          const font = metricProvider.resolveFont({ fontId, atPt });
          const metric = font.data.chars[String(code)];
          const baseline = transformPoint(transform, 0, 0);
          const candidate = {
            code: normalizeGlyphCode(code),
            baseline,
            relativeBaseline: relativeTransform
              ? transformPoint(relativeTransform, 0, 0)
              : null,
            effectiveScale: atPt / 10,
            width: round((metric?.width ?? 0) * font.atPt),
            height: round((metric?.height ?? 0) * font.atPt),
            depth: round((metric?.depth ?? 0) * font.atPt),
            fontName: normalizeFontName(font.id),
            fontSize: round(font.atPt),
          };
          if (textContext) {
            textContext.glyphs.push(candidate);
          } else {
            glyphs.push(finalizeEmbeddedGlyph(candidate, baseline));
          }
        }
      }
      if (!tag.endsWith("/>") && !isVoidSvgElement(tagName)) {
        stack.push({
          transform,
          relativeTransform,
          textContext,
        });
      }
    }
    for (const textContext of textContexts) {
      const anchor = textContext.glyphs[0];
      for (const candidate of textContext.glyphs) {
        let baseline = candidate.baseline;
        if (
          textContext.rotated &&
          anchor?.relativeBaseline &&
          candidate.relativeBaseline
        ) {
          // Lua's pre-shipout node trace sees PGF's text box before the PDF
          // literal rotates its ink: the box origin is transformed, while
          // glyph advances remain on TeX's horizontal baselines. Preserve
          // that oracle coordinate system here instead of comparing it to
          // the post-transform visual path positions.
          const parentScale =
            anchor.effectiveScale /
            relativePointScale(anchor, textContext.glyphs);
          baseline = {
            x:
              anchor.baseline.x +
              (
                candidate.relativeBaseline.x -
                anchor.relativeBaseline.x
              ) *
              parentScale,
            y:
              anchor.baseline.y +
              (
                candidate.relativeBaseline.y -
                anchor.relativeBaseline.y
              ) *
              parentScale,
          };
        }
        glyphs.push(finalizeEmbeddedGlyph(candidate, baseline));
      }
    }
  }
  return glyphs;
}

function relativePointScale(anchor, glyphs) {
  const peer = glyphs.find((candidate) => {
    if (!anchor.relativeBaseline || !candidate.relativeBaseline) {
      return false;
    }
    return (
      Math.abs(candidate.relativeBaseline.x - anchor.relativeBaseline.x) >
        1e-6 ||
      Math.abs(candidate.relativeBaseline.y - anchor.relativeBaseline.y) >
        1e-6
    );
  });
  if (!peer || !anchor.relativeBaseline || !peer.relativeBaseline) {
    return anchor.effectiveScale;
  }
  const relativeDistance = Math.hypot(
    peer.relativeBaseline.x - anchor.relativeBaseline.x,
    peer.relativeBaseline.y - anchor.relativeBaseline.y
  );
  const pageDistance = Math.hypot(
    peer.baseline.x - anchor.baseline.x,
    peer.baseline.y - anchor.baseline.y
  );
  return relativeDistance > 0
    ? anchor.effectiveScale * relativeDistance / pageDistance
    : anchor.effectiveScale;
}

function finalizeEmbeddedGlyph(candidate, baseline) {
  return {
    code: candidate.code,
    x: round(baseline.x),
    y: round(baseline.y),
    width: candidate.width,
    height: candidate.height,
    depth: candidate.depth,
    fontName: candidate.fontName,
    fontSize: candidate.fontSize,
  };
}

function svgViewportTransform(tag) {
  const x = numericSvgAttribute(tag, "x", 0);
  const y = numericSvgAttribute(tag, "y", 0);
  const width = numericSvgAttribute(tag, "width", 0);
  const height = numericSvgAttribute(tag, "height", 0);
  const viewBox = (readSvgAttribute(tag, "viewBox") ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    viewBox.length !== 4 ||
    viewBox.some((value) => !Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0 ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  ) {
    return translationMatrix(x, y);
  }
  const scale = Math.min(width / viewBox[2], height / viewBox[3]);
  const extraX = width - viewBox[2] * scale;
  const extraY = height - viewBox[3] * scale;
  return [
    scale,
    0,
    0,
    scale,
    x + extraX / 2 - viewBox[0] * scale,
    y + extraY / 2 - viewBox[1] * scale,
  ];
}

function numericSvgAttribute(tag, name, fallback) {
  const value = Number(readSvgAttribute(tag, name));
  return Number.isFinite(value) ? value : fallback;
}

function parseSvgTransform(value) {
  let result = identityMatrix();
  for (const match of value.matchAll(/([A-Za-z]+)\(([^)]*)\)/gu)) {
    const name = match[1]?.toLowerCase();
    const values = (match[2] ?? "")
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number);
    let transform = identityMatrix();
    if (name === "matrix" && values.length === 6) {
      transform = values;
    } else if (name === "translate" && values.length >= 1) {
      transform = translationMatrix(values[0], values[1] ?? 0);
    } else if (name === "scale" && values.length >= 1) {
      transform = [
        values[0],
        0,
        0,
        values[1] ?? values[0],
        0,
        0,
      ];
    } else if (name === "rotate" && values.length >= 1) {
      const radians = values[0] * Math.PI / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotation = [cosine, sine, -sine, cosine, 0, 0];
      if (values.length >= 3) {
        transform = multiplyMatrices(
          translationMatrix(values[1], values[2]),
          multiplyMatrices(
            rotation,
            translationMatrix(-values[1], -values[2])
          )
        );
      } else {
        transform = rotation;
      }
    }
    result = multiplyMatrices(result, transform);
  }
  return result;
}

function identityMatrix() {
  return [1, 0, 0, 1, 0, 0];
}

function translationMatrix(x, y) {
  return [1, 0, 0, 1, x, y];
}

function multiplyMatrices(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(transform, x, y) {
  return {
    x: transform[0] * x + transform[2] * y + transform[4],
    y: transform[1] * x + transform[3] * y + transform[5],
  };
}

function isVoidSvgElement(tagName) {
  return new Set([
    "circle",
    "ellipse",
    "line",
    "path",
    "polygon",
    "polyline",
    "rect",
    "stop",
    "use",
  ]).has(tagName);
}

function nativeDisplayMathGlyphs(
  paragraph,
  metricProvider,
  rectangles,
  covered = false
) {
  const glyphs = [];
  let ruleIndex = 0;
  const appendMath = (params) => {
    const math = featuresFromNativeMathSvg(params);
    glyphs.push(...math.glyphs);
    rectangles.push(...math.rules.map((rule) => ({
      id: `${paragraph.paragraphId}:display-rule:${ruleIndex++}`,
      ...rule,
    })));
  };
  const visit = (items) => {
    for (const positioned of items) {
      const isCovered = sourceRangeIsHidden(
        positioned.item.sourceSpan?.start,
        positioned.item.sourceSpan?.end,
        paragraph.hiddenSourceSpans
      );
      if (positioned.item.kind === "display-math") {
        if (isCovered !== covered) {
          continue;
        }
        appendMath({
          svgBody: positioned.item.box.svgBody ?? "",
          originX: paragraph.bounds.x + Number(positioned.x),
          baselineY:
            paragraph.bounds.y +
            Number(positioned.y) +
            Number(positioned.metrics.height),
          metricProvider,
        });
      } else if (
        positioned.item.kind === "hbox" &&
        positioned.item.role?.kind === "display-align-row"
      ) {
        if (isCovered !== covered) {
          continue;
        }
        for (const renderItem of positioned.item.box.renderItems) {
          if (renderItem.kind !== "tex-math-svg") {
            continue;
          }
          appendMath({
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
          });
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

function nativeVListLabelGlyphs(
  paragraph,
  metricProvider,
  covered = false
) {
  const glyphs = [];
  const visit = (items) => {
    for (const positioned of items) {
      if (
        positioned.item.kind === "hbox" &&
        positioned.item.role?.kind === "list-label"
      ) {
        const isCovered =
          paragraph.hiddenListItemIndices?.includes(
            positioned.item.role.itemIndex
          ) === true ||
          sourceRangeIsHidden(
            positioned.item.sourceSpan?.start,
            positioned.item.sourceSpan?.end,
            paragraph.hiddenSourceSpans
          );
        if (isCovered !== covered) {
          continue;
        }
        for (const renderItem of positioned.item.box.renderItems) {
          if (
            renderItem.kind !== "tex-glyph" &&
            renderItem.kind !== "tex-glyph-run"
          ) {
            continue;
          }
          const font = metricProvider.resolveFont({
            fontId: renderItem.fontId,
            atPt: Number(renderItem.atPt),
          });
          const baselineY =
            paragraph.bounds.y +
            Number(positioned.y) +
            Number(renderItem.baseline);
          let cursor =
            paragraph.bounds.x +
            Number(positioned.x) +
            Number(renderItem.x);
          if (renderItem.kind === "tex-glyph") {
            const metric = font.data.chars[String(renderItem.code)];
            glyphs.push({
              code: normalizeGlyphCode(renderItem.code),
              x: round(cursor),
              y: round(baselineY),
              width: round((metric?.width ?? 0) * font.atPt),
              height: round((metric?.height ?? 0) * font.atPt),
              depth: round((metric?.depth ?? 0) * font.atPt),
              fontName: normalizeFontName(font.id),
              fontSize: round(font.atPt),
            });
            continue;
          }
          const shaped = metricProvider.shapeText(renderItem.text, font);
          for (const item of shaped.items) {
            if (item.kind === "kern") {
              cursor += item.width;
              continue;
            }
            glyphs.push({
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
      }
      if (positioned.children?.length) {
        visit(positioned.children);
      }
    }
  };
  visit(paragraph.vlistLayout.items);
  return glyphs;
}

function sourceRangeIsHidden(from, to, hiddenSpans) {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    !Array.isArray(hiddenSpans)
  ) {
    return false;
  }
  return hiddenSpans.some((hidden) =>
    from < hidden.to && to > hidden.from
  );
}

export function compareBeamerPageTraces(nativeTrace, oracleTrace) {
  const pageRules = oracleTrace.rules.filter((rule) =>
      rule.width > 0 &&
      rule.totalHeight > 0 &&
      rule.x >= -0.01 &&
      rule.y >= -0.01 &&
      rule.x + rule.width <= oracleTrace.page.width + 0.01 &&
      rule.y + rule.totalHeight <= oracleTrace.page.height + 0.01
  );
  const coveredOracleRules = pageRules.filter((rule) =>
    (nativeTrace.coveredRectangles ?? []).some((covered) =>
      Math.max(
        ...Object.values(rectangleDelta(covered, rule)).map(Math.abs)
      ) <= 0.02
    )
  );
  const coveredOracleRuleSet = new Set(coveredOracleRules);
  const geometry = compareRectangles(
    nativeTrace.rectangles,
    pageRules.filter((rule) => !coveredOracleRuleSet.has(rule))
  );
  const coveredOracleLines = oracleTrace.lines.filter((line) =>
    (nativeTrace.coveredLines ?? []).some((covered) =>
      covered.text === line.text &&
      Math.abs(covered.x - line.x) <= 0.02 &&
      Math.abs(covered.baselineY - line.baselineY) <= 0.02
    )
  );
  const coveredOracleLineSet = new Set(coveredOracleLines);
  const untracedOracleLines = oracleTrace.lines.filter((line) =>
    !coveredOracleLineSet.has(line) &&
    nativeTrace.untracedRegions.some((region) =>
      pointNearRect(
        line.x,
        line.baselineY,
        region.bounds,
        2
      )
    )
  );
  const excludedOracleLines = [
    ...coveredOracleLines,
    ...untracedOracleLines,
  ];
  const excludedOracleLineSet = new Set(excludedOracleLines);
  const text = compareTextLines(
    nativeTrace.lines,
    oracleTrace.lines.filter((line) => !excludedOracleLineSet.has(line))
  );
  text.excludedOracle = excludedOracleLines.map((line) => ({
    ...line,
    reason: coveredOracleLineSet.has(line)
      ? "covered Beamer overlay material remains in the Lua node trace but is not painted"
      : "native embedded-TikZ glyph tracing is not yet merged into the page trace",
  }));
  return {
    coordinateSystem: nativeTrace.coordinateSystem,
    summary: {
      matchedRectangles: geometry.matches.length,
      unmatchedNativeRectangles: geometry.unmatchedNative.length,
      unmatchedOracleRules: geometry.unmatchedOracle.length,
      coveredOverlayRules: coveredOracleRules.length,
      maxRectangleEdgeDeltaPt: geometry.maxEdgeDeltaPt,
      matchedTextLines: text.matches.length,
      unmatchedNativeTextLines: text.unmatchedNative.length,
      unmatchedOracleTextLines: text.unmatchedOracle.length,
      excludedOracleTextLines: untracedOracleLines.length,
      coveredOverlayTextLines: coveredOracleLines.length,
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

function featuresFromNativeMathSvg(params) {
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
  const rules = [];
  for (const match of params.svgBody.matchAll(/<rect\b[^>]*>/gu)) {
    const tag = match[0];
    const role = readSvgAttribute(tag, "data-tex-rule");
    const x = Number(readSvgAttribute(tag, "x"));
    const y = Number(readSvgAttribute(tag, "y"));
    const width = Number(readSvgAttribute(tag, "width"));
    const height = Number(readSvgAttribute(tag, "height"));
    if (
      !role ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      continue;
    }
    rules.push({
      role,
      x: round(params.originX + x / 100),
      y: round(params.baselineY + y / 100),
      width: round(width / 100),
      height: round(height / 100),
    });
  }
  // PDF image nodes appear as rules in LuaTeX's shipout trace. Preserve
  // ancestor transforms when comparing a graphic inside an LR/raised box.
  const transforms = [identityMatrix()];
  for (const match of params.svgBody.matchAll(/<\/?[A-Za-z][^>]*>/gu)) {
    const tag = match[0];
    if (tag.startsWith("</")) { if (transforms.length > 1) transforms.pop(); continue; }
    const name = /^<([\w:-]+)/u.exec(tag)?.[1];
    const transform = multiplyMatrices(transforms.at(-1), parseSvgTransform(readSvgAttribute(tag, "transform") ?? ""));
    if (name === "image") {
      const x = numericSvgAttribute(tag, "x", 0);
      const y = numericSvgAttribute(tag, "y", 0);
      const width = numericSvgAttribute(tag, "width", 0);
      const height = numericSvgAttribute(tag, "height", 0);
      const origin = transformPoint(transform, x, y);
      rules.push({ role: "image", x: round(params.originX + origin.x / 100), y: round(params.baselineY + origin.y / 100), width: round(width * transform[0] / 100), height: round(height * transform[3] / 100) });
    }
    if (!tag.endsWith("/>") && !isVoidSvgElement(name)) transforms.push(transform);
  }
  return { glyphs, rules };
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
  if (id.includes(":headline:")) {
    return "headline";
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
