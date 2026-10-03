import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BEAMER_FRAME_ORACLE_VERSION = 4;
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
\directlua{dofile((os.getenv("TIKZ_BEAMER_TRACE_DIR") or ".") .. "/beamer-page-trace.lua")}
\AddToHook{shipout/before}{\tikzeditorbeamerprobe}
\makeatother`;
}

/**
 * Trace the final LuaTeX shipout box without changing it.
 *
 * Coordinates are emitted as integer scaled points in a page-local,
 * top-left, y-down coordinate system. The JavaScript parser retains those
 * integers and also exposes TeX-point values.
 */
export function beamerPageTraceLuaSource() {
  return String.raw`local trace_path = (os.getenv("TIKZ_BEAMER_TRACE_DIR") or ".") .. "/beamer-page-trace.tsv"
local trace_file = assert(io.open(trace_path, "w"))
local glyph_id = node.id("glyph")
local glue_id = node.id("glue")
local kern_id = node.id("kern")
local hlist_id = node.id("hlist")
local vlist_id = node.id("vlist")
local rule_id = node.id("rule")
local disc_id = node.id("disc")
local running_dimension = -1073741824
local page_index = 0

local function clean(value)
  return tostring(value or ""):gsub("[\t\r\n]", " ")
end

local function font_name(font_id)
  local data = font.getfont(font_id)
  if not data then return "" end
  return clean(data.name or data.fullname or data.psname or data.filename or "")
end

local function font_size(font_id)
  local data = font.getfont(font_id)
  return data and (data.size or 0) or 0
end

local function glue_width(value, parent)
  local width = value.width or (value.spec and value.spec.width) or 0
  if not parent then return width end
  local sign = parent.glue_sign or 0
  local order = parent.glue_order or 0
  local set = parent.glue_set or 0
  local stretch_order = value.stretch_order or
    (value.spec and value.spec.stretch_order) or 0
  local shrink_order = value.shrink_order or
    (value.spec and value.spec.shrink_order) or 0
  if sign == 1 and order == stretch_order then
    width = width + set *
      (value.stretch or (value.spec and value.spec.stretch) or 0)
  elseif sign == 2 and order == shrink_order then
    width = width - set *
      (value.shrink or (value.spec and value.spec.shrink) or 0)
  end
  return math.floor(width + 0.5)
end

local function resolved(value, fallback)
  if value == running_dimension then return fallback or 0 end
  return value or 0
end

local function child_path(path, index)
  if path == "" then return tostring(index) end
  return path .. "." .. index
end

local function write_box(kind, path, x, y, value)
  trace_file:write(table.concat({
    "BOX",
    page_index,
    kind,
    path,
    math.floor(x + 0.5),
    math.floor(y + 0.5),
    value.width or 0,
    value.height or 0,
    value.depth or 0,
  }, "\t"), "\n")
end

local function write_rule(path, x, y, width, height, depth)
  trace_file:write(table.concat({
    "RULE",
    page_index,
    path,
    math.floor(x + 0.5),
    math.floor(y + 0.5),
    math.floor(width + 0.5),
    math.floor(height + 0.5),
    math.floor(depth + 0.5),
  }, "\t"), "\n")
end

local function write_glyph(path, value, x, baseline)
  local x_offset = value.xoffset or 0
  local y_offset = value.yoffset or 0
  trace_file:write(table.concat({
    "GLYPH",
    page_index,
    path,
    value.char or -1,
    math.floor(x + x_offset + 0.5),
    math.floor(baseline - y_offset + 0.5),
    value.width or 0,
    value.height or 0,
    value.depth or 0,
    value.font or 0,
    font_size(value.font),
    font_name(value.font),
  }, "\t"), "\n")
end

local function write_spacing(kind, path, axis, x, y, value, effective)
  trace_file:write(table.concat({
    kind,
    page_index,
    path,
    axis,
    math.floor(x + 0.5),
    math.floor(y + 0.5),
    value.width or (value.spec and value.spec.width) or value.kern or 0,
    math.floor(effective + 0.5),
    value.stretch or (value.spec and value.spec.stretch) or 0,
    value.stretch_order or (value.spec and value.spec.stretch_order) or 0,
    value.shrink or (value.spec and value.spec.shrink) or 0,
    value.shrink_order or (value.spec and value.spec.shrink_order) or 0,
    value.subtype or 0,
  }, "\t"), "\n")
end

local walk_hlist
local walk_vlist

walk_hlist = function(list, parent, origin_x, baseline, path)
  local x = origin_x
  local index = 0
  if not list then return x end
  for value in node.traverse(list) do
    index = index + 1
    local current_path = child_path(path, index)
    if value.id == glyph_id then
      write_glyph(current_path, value, x, baseline)
      x = x + (value.width or 0)
    elseif value.id == glue_id then
      local effective = glue_width(value, parent)
      write_spacing("GLUE", current_path, "x", x, baseline, value, effective)
      x = x + effective
    elseif value.id == kern_id then
      local effective = value.kern or value.width or 0
      write_spacing("KERN", current_path, "x", x, baseline, value, effective)
      x = x + effective
    elseif value.id == hlist_id then
      local child_baseline = baseline + (value.shift or 0)
      local child_top = child_baseline - (value.height or 0)
      write_box("hlist", current_path, x, child_top, value)
      walk_hlist(value.list, value, x, child_baseline, current_path)
      x = x + (value.width or 0)
    elseif value.id == vlist_id then
      local child_baseline = baseline + (value.shift or 0)
      local child_top = child_baseline - (value.height or 0)
      write_box("vlist", current_path, x, child_top, value)
      walk_vlist(value.list, value, x, child_top, current_path)
      x = x + (value.width or 0)
    elseif value.id == rule_id then
      local width = resolved(value.width, parent and parent.width)
      local height = resolved(value.height, parent and parent.height)
      local depth = resolved(value.depth, parent and parent.depth)
      write_rule(current_path, x, baseline - height, width, height, depth)
      x = x + width
    elseif value.id == disc_id then
      x = walk_hlist(value.replace, parent, x, baseline, current_path)
    end
  end
  return x
end

walk_vlist = function(list, parent, origin_x, origin_y, path)
  local y = origin_y
  local index = 0
  if not list then return y end
  for value in node.traverse(list) do
    index = index + 1
    local current_path = child_path(path, index)
    if value.id == glue_id then
      local effective = glue_width(value, parent)
      write_spacing("GLUE", current_path, "y", origin_x, y, value, effective)
      y = y + effective
    elseif value.id == kern_id then
      local effective = value.kern or value.width or 0
      write_spacing("KERN", current_path, "y", origin_x, y, value, effective)
      y = y + effective
    elseif value.id == hlist_id then
      local x = origin_x + (value.shift or 0)
      local baseline = y + (value.height or 0)
      write_box("hlist", current_path, x, y, value)
      walk_hlist(value.list, value, x, baseline, current_path)
      y = y + (value.height or 0) + (value.depth or 0)
    elseif value.id == vlist_id then
      local x = origin_x + (value.shift or 0)
      write_box("vlist", current_path, x, y, value)
      walk_vlist(value.list, value, x, y, current_path)
      y = y + (value.height or 0) + (value.depth or 0)
    elseif value.id == rule_id then
      local width = resolved(value.width, parent and parent.width)
      local height = resolved(value.height, parent and parent.height)
      local depth = resolved(value.depth, parent and parent.depth)
      write_rule(current_path, origin_x, y, width, height, depth)
      y = y + height + depth
    end
  end
  return y
end

local function trace_page(page)
  page_index = page_index + 1
  local kind = node.type(page.id)
  trace_file:write(table.concat({
    "PAGE",
    page_index,
    kind,
    page.width or 0,
    page.height or 0,
    page.depth or 0,
  }, "\t"), "\n")
  write_box(kind, "root", 0, 0, page)
  if page.id == vlist_id then
    walk_vlist(page.list, page, 0, 0, "root")
  elseif page.id == hlist_id then
    walk_hlist(page.list, page, 0, page.height or 0, "root")
  end
  trace_file:flush()
  return true
end

luatexbase.add_to_callback(
  "pre_shipout_filter",
  trace_page,
  "tikz-editor.beamer-page-trace"
)
`;
}

export function buildBeamerFrameProbeSource(
  source,
  document,
  frameIndex,
  theoremCounterSeed = []
) {
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
  const navigationState = buildBeamerFrameNavigationState(
    source,
    document,
    frameIndex
  );
  const theoremCounterState = theoremCounterSeed
    .map(({ counter, value }) =>
      `\\setcounter{${counter}}{${value}}`
    )
    .join("\n");
  return {
    frame,
    navSource: buildBeamerNavigationSeed(source, document),
    source: `${preamble.trimEnd()}

${beamerProbeInstrumentation()}

\\begin{document}
\\setcounter{framenumber}{${frameIndex}}
\\def\\inserttotalframenumber{${document.frames.length}}
${navigationState}
${theoremCounterState}
${frameSource}
\\end{document}
`,
  };
}

/**
 * Seed the document-wide `.nav` entry stream which Beamer normally obtains
 * from an earlier full-deck compilation.
 *
 * Page links are irrelevant to the visual oracle, so a frame's one-based
 * source index is a stable synthetic page number. Section/subsection/frame
 * topology and short navigation titles remain faithful to the source model.
 */
export function buildBeamerNavigationSeed(source, document) {
  const topLevelSections = document.sections.filter(
    (section) => section.level === 1
  );
  const sectionNumberById = new Map(
    topLevelSections.map((section, index) => [section.id, index + 1])
  );
  const subsectionNumberById = new Map();
  for (const section of topLevelSections) {
    let subsectionNumber = 0;
    for (const subsection of document.sections) {
      if (
        subsection.level === 2 &&
        subsection.parentSectionId === section.id
      ) {
        subsectionNumber += 1;
        subsectionNumberById.set(subsection.id, subsectionNumber);
      }
    }
  }

  const lines = [];
  for (const section of topLevelSections) {
    const sectionNumber = sectionNumberById.get(section.id);
    const title = sourceValue(source, section.shortTitle ?? section.title);
    const firstFrameIndex = document.frames.findIndex(
      (frame) => frame.sectionId === section.id
    );
    const page = firstFrameIndex >= 0
      ? firstFrameIndex + 1
      : document.frames.length + 1;
    lines.push(
      `\\headcommand {\\sectionentry {${sectionNumber}}{${title}}{${page}}{${title}}{0}}`
    );
    for (const subsection of document.sections) {
      if (
        subsection.level !== 2 ||
        subsection.parentSectionId !== section.id
      ) {
        continue;
      }
      const subsectionNumber = subsectionNumberById.get(subsection.id);
      const subsectionTitle = sourceValue(
        source,
        subsection.shortTitle ?? subsection.title
      );
      const firstSubsectionFrameIndex = document.frames.findIndex(
        (frame) => frame.subsectionId === subsection.id
      );
      const subsectionPage = firstSubsectionFrameIndex >= 0
        ? firstSubsectionFrameIndex + 1
        : page;
      lines.push(
        `\\headcommand {\\beamer@subsectionentry {0}{${sectionNumber}}{${subsectionNumber}}{${subsectionPage}}{${subsectionTitle}}}`
      );
    }
  }

  const localFrameCounts = new Map();
  for (const [frameIndex, frame] of document.frames.entries()) {
    const sectionNumber = frame.sectionId === null
      ? 0
      : sectionNumberById.get(frame.sectionId) ?? 0;
    const subsectionNumber = frame.subsectionId === null
      ? 0
      : subsectionNumberById.get(frame.subsectionId) ?? 0;
    const localKey = `${sectionNumber}:${subsectionNumber}`;
    const localFrameNumber = (localFrameCounts.get(localKey) ?? 0) + 1;
    localFrameCounts.set(localKey, localFrameNumber);
    const subsection = frame.subsectionId === null
      ? null
      : document.sections.find(
          (section) => section.id === frame.subsectionId
        ) ?? null;
    const subsectionTitle = subsection
      ? sourceValue(source, subsection.shortTitle ?? subsection.title)
      : "";
    const page = frameIndex + 1;
    lines.push(
      `\\headcommand {\\slideentry {${sectionNumber}}{${subsectionNumber}}{${localFrameNumber}}{${page}/${page}}{${subsectionTitle}}{0}}`,
      `\\headcommand {\\beamer@framepages {${page}}{${page}}}`
    );
  }
  lines.push(
    `\\headcommand {\\beamer@documentpages {${document.frames.length}}}`,
    `\\headcommand {\\gdef \\inserttotalframenumber {${document.frames.length}}}`
  );
  return `${lines.join("\n")}\n`;
}

function buildBeamerFrameNavigationState(
  source,
  document,
  frameIndex
) {
  const frame = document.frames[frameIndex];
  const section = frame.sectionId === null
    ? null
    : document.sections.find((entry) => entry.id === frame.sectionId) ?? null;
  const subsection = frame.subsectionId === null
    ? null
    : document.sections.find(
        (entry) => entry.id === frame.subsectionId
      ) ?? null;
  const topLevelSections = document.sections.filter(
    (entry) => entry.level === 1
  );
  const sectionNumber = section
    ? topLevelSections.findIndex((entry) => entry.id === section.id) + 1
    : 0;
  const subsections = section
    ? document.sections.filter(
        (entry) =>
          entry.level === 2 &&
          entry.parentSectionId === section.id
      )
    : [];
  const subsectionNumber = subsection
    ? subsections.findIndex((entry) => entry.id === subsection.id) + 1
    : 0;
  const groupFrames = document.frames.filter(
    (entry) =>
      entry.sectionId === frame.sectionId &&
      entry.subsectionId === frame.subsectionId
  );
  const subsectionSlide = groupFrames.findIndex(
    (entry) => entry.id === frame.id
  );
  const sectionShortTitle = section
    ? sourceValue(source, section.shortTitle ?? section.title)
    : "";
  const sectionLongTitle = section
    ? sourceValue(source, section.title)
    : "";
  const subsectionShortTitle = subsection
    ? sourceValue(source, subsection.shortTitle ?? subsection.title)
    : "";
  const subsectionLongTitle = subsection
    ? sourceValue(source, subsection.title)
    : "";

  return String.raw`\makeatletter
\setcounter{section}{${sectionNumber}}
\setcounter{subsection}{${subsectionNumber}}
\setcounter{subsectionslide}{${Math.max(0, subsectionSlide)}}
\def\insertsectionhead{${sectionShortTitle}}
\def\insertsection{${sectionLongTitle}}
\def\insertsubsectionhead{${subsectionShortTitle}}
\def\insertsubsection{${subsectionLongTitle}}
\def\lastsubsection{${subsectionShortTitle}}
\makeatother`;
}

function sourceValue(source, value) {
  return source.slice(value.contentSpan.from, value.contentSpan.to);
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

export function parseBeamerPageTraceTsv(tsv) {
  const pages = [];
  const byNumber = new Map();
  for (const line of tsv.split(/\r?\n/u)) {
    if (!line) {
      continue;
    }
    const fields = line.split("\t");
    const kind = fields[0];
    const pageNumber = Number(fields[1]);
    if (kind === "PAGE") {
      const page = {
        pageNumber,
        boxKind: fields[2] ?? "unknown",
        width: dimension(Number(fields[3])),
        height: dimension(Number(fields[4])),
        depth: dimension(Number(fields[5])),
        boxes: [],
        rules: [],
        glyphs: [],
        glues: [],
        kerns: [],
      };
      pages.push(page);
      byNumber.set(pageNumber, page);
      continue;
    }
    const page = byNumber.get(pageNumber);
    if (!page) {
      throw new Error(`Beamer page trace record preceded PAGE ${pageNumber}.`);
    }
    if (kind === "BOX") {
      page.boxes.push({
        kind: fields[2] ?? "unknown",
        path: fields[3] ?? "",
        x: dimension(Number(fields[4])),
        y: dimension(Number(fields[5])),
        width: dimension(Number(fields[6])),
        height: dimension(Number(fields[7])),
        depth: dimension(Number(fields[8])),
      });
    } else if (kind === "RULE") {
      page.rules.push({
        path: fields[2] ?? "",
        x: dimension(Number(fields[3])),
        y: dimension(Number(fields[4])),
        width: dimension(Number(fields[5])),
        height: dimension(Number(fields[6])),
        depth: dimension(Number(fields[7])),
      });
    } else if (kind === "GLYPH") {
      page.glyphs.push({
        path: fields[2] ?? "",
        code: Number(fields[3]),
        x: dimension(Number(fields[4])),
        y: dimension(Number(fields[5])),
        width: dimension(Number(fields[6])),
        height: dimension(Number(fields[7])),
        depth: dimension(Number(fields[8])),
        fontId: Number(fields[9]),
        fontSize: dimension(Number(fields[10])),
        fontName: fields[11] ?? "",
      });
    } else if (kind === "GLUE" || kind === "KERN") {
      const spacing = {
        path: fields[2] ?? "",
        axis: fields[3] === "x" ? "x" : "y",
        x: dimension(Number(fields[4])),
        y: dimension(Number(fields[5])),
        natural: dimension(Number(fields[6])),
        effective: dimension(Number(fields[7])),
        stretch: dimension(Number(fields[8])),
        stretchOrder: Number(fields[9]),
        shrink: dimension(Number(fields[10])),
        shrinkOrder: Number(fields[11]),
        subtype: Number(fields[12]),
      };
      page[kind === "GLUE" ? "glues" : "kerns"].push(spacing);
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

function dimension(sp) {
  if (!Number.isFinite(sp)) {
    throw new TypeError("Expected a finite scaled-point dimension.");
  }
  return {
    sp,
    texPt: sp / SP_PER_TEX_POINT,
  };
}
