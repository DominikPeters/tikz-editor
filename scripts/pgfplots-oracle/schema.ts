/**
 * pgfplots oracle data model and a typed reader.
 *
 * Coordinate frame (all positions, both tiers): TeX points (1/72.27 in),
 * PGF picture coordinates — origin at the tikzpicture origin, x right,
 * y UP. This is the frame `\pgfpointanchor` reports and the frame the
 * editor's scene uses. The PDF page of a case is exactly the picture's
 * bounding box, so page (y-down) coordinates convert with
 *   x = xPage + boundingBox.minX,  y = boundingBox.maxY - yPage.
 */

export const PGFPLOTS_ORACLE_SCHEMA = "pgfplots-oracle/v1";
/** Bump when the TeX instrumentation or parsing changes meaning. Part of the cache key. */
export const PGFPLOTS_ORACLE_HARNESS_VERSION = 3;

export interface Point { x: number; y: number }
export interface Box { minX: number; minY: number; maxX: number; maxY: number }

export interface OracleToolchain {
  engine: "lualatex" | "pdflatex";
  engineVersion: string;
  pgfVersion: string;
  pgfplotsVersion: string;
  mutoolVersion: string;
  compat: string;
}

/** Geometry of a named node, as read through `\pgfpointanchor`. */
export interface NodeGeometry {
  anchors: Record<string, Point>;
  /** Text recovered from the PDF glyphs inside the node's anchor quad. */
  text?: string;
}

export interface OracleTick {
  /** `\ticknum` as reported by the documented xticklabel code. */
  index: number;
  /** `\tick` parsed as a number. */
  value: number;
  /** `\tick` exactly as TeX expanded it (fixed-point formatting noise included). */
  valueRaw: string;
  /** Label node (named through `xticklabel style={name=...}`), when drawn. */
  label?: NodeGeometry;
}

export interface OracleAxisMap {
  /** Canvas image of data point (0,0). */
  origin: Point;
  /** Canvas displacement per data unit along x. */
  xUnit: Point;
  /** Canvas displacement per data unit along y. */
  yUnit: Point;
}

export interface OracleAxis {
  id: string;
  limits?: { xmin: number; xmax: number; ymin: number; ymax: number };
  limitsRaw?: { xmin: string; xmax: string; ymin: string; ymax: string };
  /** Corners from `rel axis cs` (keys r00, r10, r01, r11 = rel (0,0),(1,0),(0,1),(1,1)). */
  rect?: { r00: Point; r10: Point; r01: Point; r11: Point };
  /** Canvas images of (xmin,ymin), (xmax,ymin), (xmin,ymax) from `axis cs`. */
  limitCorners?: { d00: Point; d10: Point; d01: Point };
  map?: OracleAxisMap;
  /** `current axis` anchors read after `\end{axis}`. */
  anchors?: Record<string, Point>;
  ticks?: { x: OracleTick[]; y: OracleTick[] };
  descriptions?: Partial<Record<"title" | "xlabel" | "ylabel" | "legend", NodeGeometry>>;
  /** Legend entry text nodes (harness v3), by matrix row and column (1-based), row-major. */
  legendEntries?: Array<{ row: number; column: number; node: NodeGeometry }>;
}

export interface Tier1 {
  /** `current bounding box` at the end of the picture. */
  boundingBox?: Box;
  axes: OracleAxis[];
}

export type PathSegment =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

export interface Paint {
  /** Colour space as named by the PDF (DeviceGray, DeviceRGB, DeviceCMYK, ...). */
  space: string;
  components: number[];
  alpha: number;
}

export interface PathPrimitive {
  type: "path";
  /** Paint order index within the page. */
  order: number;
  /** stroke, fill, clip (clip path) or clip-stroke. */
  operation: "stroke" | "fill" | "clip";
  fillRule?: "nonzero" | "evenodd";
  segments: PathSegment[];
  /** True when the path is a single axis-aligned closed rectangle. */
  rect?: Box;
  paint?: Paint;
  lineWidth?: number;
  dash?: { array: number[]; phase: number };
  lineCap?: number;
  lineJoin?: number;
  miterLimit?: number;
  /** Number of clip paths active when this primitive was painted. */
  clipDepth: number;
  /** Intersection of the bounding boxes of the active clip paths. */
  clipBox?: Box;
}

export interface GlyphRun {
  type: "glyphs";
  order: number;
  /** PDF font name with the subset tag removed. */
  font: string;
  /** Font size in pt (text rendering matrix scale). */
  size: number;
  paint: Paint;
  /** Unit vector along the baseline, picture coordinates. */
  direction: Point;
  /** Glyph origins in picture coordinates, Unicode (NFKC) when the PDF maps it, advance in pt. */
  glyphs: { unicode: string; x: number; y: number; advance: number }[];
  text: string;
  clipDepth: number;
  clipBox?: Box;
}

export interface OtherPrimitive {
  type: "image" | "shading";
  order: number;
  /** Picture-coordinate bounds of the unit square under the transform. */
  bounds: Box;
  clipDepth: number;
}

/** A PGF node text box from the LuaTeX page walk (LuaLaTeX only). */
export interface TextBox {
  type: "textbox";
  /** 1-based index in page-walk order (paint order of the boxes). */
  tag: number;
  /** Number of enclosing tagged boxes (the axis picture itself is one). */
  nesting: number;
  /** Box reference point (left end of the baseline) in picture coordinates. */
  origin: Point;
  /** Linear part of the transform: box-local unit vectors in picture coordinates. */
  xAxis: Point;
  yAxis: Point;
  width: number;
  height: number;
  depth: number;
  /** TeX glyph slots with font names (not Unicode for legacy fonts). */
  glyphs: { code: number; font: string }[];
  /** Unicode text from the PDF glyphs that lie inside this box (excluding nested tagged boxes' glyphs is not attempted). */
  text: string;
}

export type Tier2Primitive = PathPrimitive | GlyphRun | OtherPrimitive;

export interface Tier2 {
  page: { width: number; height: number };
  primitives: Tier2Primitive[];
  textBoxes: TextBox[];
}

export interface PgfplotsOracle {
  schema: typeof PGFPLOTS_ORACLE_SCHEMA;
  harnessVersion: number;
  case: { name: string; sourceSha256: string };
  toolchain: OracleToolchain;
  tier1: Tier1;
  tier2: Tier2;
}

/** The neutral "observed" structure a renderer must produce to be compared. */
export interface ObservedPicture {
  tier1: Tier1;
  tier2: Tier2;
}

// ---------------------------------------------------------------------------
// Reader / validation

export class OracleSchemaError extends Error {}

type Json = unknown;

function fail(path: string, message: string): never {
  throw new OracleSchemaError(`${path}: ${message}`);
}
function isRecord(value: Json): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function num(value: Json, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  return value;
}
function str(value: Json, path: string): string {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}
function rec(value: Json, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, "expected an object");
  return value;
}
function arr(value: Json, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}
function point(value: Json, path: string): Point {
  const r = rec(value, path);
  return { x: num(r.x, `${path}.x`), y: num(r.y, `${path}.y`) };
}
function box(value: Json, path: string): Box {
  const r = rec(value, path);
  const b = { minX: num(r.minX, `${path}.minX`), minY: num(r.minY, `${path}.minY`), maxX: num(r.maxX, `${path}.maxX`), maxY: num(r.maxY, `${path}.maxY`) };
  if (b.minX > b.maxX || b.minY > b.maxY) fail(path, "inverted box");
  return b;
}
function points(value: Json, path: string): Record<string, Point> {
  const r = rec(value, path);
  return Object.fromEntries(Object.entries(r).map(([key, item]) => [key, point(item, `${path}.${key}`)]));
}
function nodeGeometry(value: Json, path: string): NodeGeometry {
  const r = rec(value, path);
  const result: NodeGeometry = { anchors: points(r.anchors, `${path}.anchors`) };
  if (r.text !== undefined) result.text = str(r.text, `${path}.text`);
  return result;
}
function paint(value: Json, path: string): Paint {
  const r = rec(value, path);
  return { space: str(r.space, `${path}.space`), components: arr(r.components, `${path}.components`).map((c, i) => num(c, `${path}.components[${i}]`)), alpha: num(r.alpha, `${path}.alpha`) };
}
function segment(value: Json, path: string): PathSegment {
  const r = rec(value, path);
  const op = str(r.op, `${path}.op`);
  if (op === "Z") return { op };
  if (op === "M" || op === "L") return { op, x: num(r.x, `${path}.x`), y: num(r.y, `${path}.y`) };
  if (op === "C") return { op, x1: num(r.x1, `${path}.x1`), y1: num(r.y1, `${path}.y1`), x2: num(r.x2, `${path}.x2`), y2: num(r.y2, `${path}.y2`), x: num(r.x, `${path}.x`), y: num(r.y, `${path}.y`) };
  return fail(path, `unknown segment op ${op}`);
}

function tick(value: Json, path: string): OracleTick {
  const r = rec(value, path);
  const result: OracleTick = { index: num(r.index, `${path}.index`), value: num(r.value, `${path}.value`), valueRaw: str(r.valueRaw, `${path}.valueRaw`) };
  if (r.label !== undefined) result.label = nodeGeometry(r.label, `${path}.label`);
  return result;
}

function axis(value: Json, path: string): OracleAxis {
  const r = rec(value, path);
  const result: OracleAxis = { id: str(r.id, `${path}.id`) };
  if (r.limits !== undefined) {
    const l = rec(r.limits, `${path}.limits`);
    result.limits = { xmin: num(l.xmin, `${path}.limits.xmin`), xmax: num(l.xmax, `${path}.limits.xmax`), ymin: num(l.ymin, `${path}.limits.ymin`), ymax: num(l.ymax, `${path}.limits.ymax`) };
    const raw = rec(r.limitsRaw, `${path}.limitsRaw`);
    result.limitsRaw = { xmin: str(raw.xmin, "xmin"), xmax: str(raw.xmax, "xmax"), ymin: str(raw.ymin, "ymin"), ymax: str(raw.ymax, "ymax") };
  }
  if (r.rect !== undefined) {
    const p = points(r.rect, `${path}.rect`);
    for (const key of ["r00", "r10", "r01", "r11"]) if (!p[key]) fail(`${path}.rect`, `missing ${key}`);
    result.rect = p as OracleAxis["rect"];
  }
  if (r.limitCorners !== undefined) {
    const p = points(r.limitCorners, `${path}.limitCorners`);
    for (const key of ["d00", "d10", "d01"]) if (!p[key]) fail(`${path}.limitCorners`, `missing ${key}`);
    result.limitCorners = p as OracleAxis["limitCorners"];
  }
  if (r.map !== undefined) {
    const m = rec(r.map, `${path}.map`);
    result.map = { origin: point(m.origin, `${path}.map.origin`), xUnit: point(m.xUnit, `${path}.map.xUnit`), yUnit: point(m.yUnit, `${path}.map.yUnit`) };
  }
  if (r.anchors !== undefined) result.anchors = points(r.anchors, `${path}.anchors`);
  if (r.ticks !== undefined) {
    const t = rec(r.ticks, `${path}.ticks`);
    result.ticks = {
      x: arr(t.x, `${path}.ticks.x`).map((item, i) => tick(item, `${path}.ticks.x[${i}]`)),
      y: arr(t.y, `${path}.ticks.y`).map((item, i) => tick(item, `${path}.ticks.y[${i}]`)),
    };
  }
  if (r.descriptions !== undefined) {
    const d = rec(r.descriptions, `${path}.descriptions`);
    result.descriptions = {};
    for (const [key, item] of Object.entries(d)) {
      if (key !== "title" && key !== "xlabel" && key !== "ylabel" && key !== "legend") fail(`${path}.descriptions`, `unknown description ${key}`);
      result.descriptions[key] = nodeGeometry(item, `${path}.descriptions.${key}`);
    }
  }
  if (r.legendEntries !== undefined) {
    result.legendEntries = arr(r.legendEntries, `${path}.legendEntries`).map((item, i) => {
      const e = rec(item, `${path}.legendEntries[${i}]`);
      return { row: num(e.row, `${path}.legendEntries[${i}].row`), column: num(e.column, `${path}.legendEntries[${i}].column`), node: nodeGeometry(e.node, `${path}.legendEntries[${i}].node`) };
    });
  }
  return result;
}

export function parseTier1(value: Json, path = "tier1"): Tier1 {
  const r = rec(value, path);
  const result: Tier1 = { axes: arr(r.axes, `${path}.axes`).map((item, i) => axis(item, `${path}.axes[${i}]`)) };
  if (r.boundingBox !== undefined) result.boundingBox = box(r.boundingBox, `${path}.boundingBox`);
  return result;
}

function primitive(value: Json, path: string): Tier2Primitive {
  const r = rec(value, path);
  const type = str(r.type, `${path}.type`);
  const order = num(r.order, `${path}.order`);
  const clipDepth = num(r.clipDepth, `${path}.clipDepth`);
  const clipBox = r.clipBox === undefined ? undefined : box(r.clipBox, `${path}.clipBox`);
  if (type === "path") {
    const operation = str(r.operation, `${path}.operation`);
    if (operation !== "stroke" && operation !== "fill" && operation !== "clip") fail(path, `bad operation ${operation}`);
    const result: PathPrimitive = { type, order, operation, segments: arr(r.segments, `${path}.segments`).map((s, i) => segment(s, `${path}.segments[${i}]`)), clipDepth };
    if (clipBox) result.clipBox = clipBox;
    if (r.fillRule !== undefined) {
      const rule = str(r.fillRule, `${path}.fillRule`);
      if (rule !== "nonzero" && rule !== "evenodd") fail(path, "bad fill rule");
      result.fillRule = rule;
    }
    if (r.rect !== undefined) result.rect = box(r.rect, `${path}.rect`);
    if (r.paint !== undefined) result.paint = paint(r.paint, `${path}.paint`);
    if (r.lineWidth !== undefined) result.lineWidth = num(r.lineWidth, `${path}.lineWidth`);
    if (r.dash !== undefined) {
      const d = rec(r.dash, `${path}.dash`);
      result.dash = { array: arr(d.array, `${path}.dash.array`).map((x, i) => num(x, `${path}.dash.array[${i}]`)), phase: num(d.phase, `${path}.dash.phase`) };
    }
    if (r.lineCap !== undefined) result.lineCap = num(r.lineCap, `${path}.lineCap`);
    if (r.lineJoin !== undefined) result.lineJoin = num(r.lineJoin, `${path}.lineJoin`);
    if (r.miterLimit !== undefined) result.miterLimit = num(r.miterLimit, `${path}.miterLimit`);
    return result;
  }
  if (type === "glyphs") {
    const result: GlyphRun = {
      type, order, clipDepth,
      font: str(r.font, `${path}.font`), size: num(r.size, `${path}.size`), paint: paint(r.paint, `${path}.paint`),
      direction: point(r.direction, `${path}.direction`),
      glyphs: arr(r.glyphs, `${path}.glyphs`).map((g, i) => { const gr = rec(g, `${path}.glyphs[${i}]`); return { unicode: str(gr.unicode, "unicode"), x: num(gr.x, "x"), y: num(gr.y, "y"), advance: num(gr.advance, "advance") }; }),
      text: str(r.text, `${path}.text`),
    };
    if (clipBox) result.clipBox = clipBox;
    return result;
  }
  if (type === "image" || type === "shading") return { type, order, clipDepth, bounds: box(r.bounds, `${path}.bounds`) };
  return fail(path, `unknown primitive type ${type}`);
}

function textBox(value: Json, path: string): TextBox {
  const r = rec(value, path);
  return {
    type: "textbox", tag: num(r.tag, `${path}.tag`), nesting: num(r.nesting, `${path}.nesting`),
    origin: point(r.origin, `${path}.origin`), xAxis: point(r.xAxis, `${path}.xAxis`), yAxis: point(r.yAxis, `${path}.yAxis`),
    width: num(r.width, `${path}.width`), height: num(r.height, `${path}.height`), depth: num(r.depth, `${path}.depth`),
    glyphs: arr(r.glyphs, `${path}.glyphs`).map((g, i) => { const gr = rec(g, `${path}.glyphs[${i}]`); return { code: num(gr.code, "code"), font: str(gr.font, "font") }; }),
    text: str(r.text, `${path}.text`),
  };
}

export function parseTier2(value: Json, path = "tier2"): Tier2 {
  const r = rec(value, path);
  const page = rec(r.page, `${path}.page`);
  return {
    page: { width: num(page.width, `${path}.page.width`), height: num(page.height, `${path}.page.height`) },
    primitives: arr(r.primitives, `${path}.primitives`).map((p, i) => primitive(p, `${path}.primitives[${i}]`)),
    textBoxes: arr(r.textBoxes, `${path}.textBoxes`).map((t, i) => textBox(t, `${path}.textBoxes[${i}]`)),
  };
}

/** Validate and type an oracle JSON value (throws OracleSchemaError). */
export function parsePgfplotsOracle(value: Json): PgfplotsOracle {
  const r = rec(value, "oracle");
  if (r.schema !== PGFPLOTS_ORACLE_SCHEMA) fail("oracle.schema", `expected ${PGFPLOTS_ORACLE_SCHEMA}`);
  const c = rec(r.case, "oracle.case");
  const t = rec(r.toolchain, "oracle.toolchain");
  const engine = str(t.engine, "oracle.toolchain.engine");
  if (engine !== "lualatex" && engine !== "pdflatex") fail("oracle.toolchain.engine", "unknown engine");
  return {
    schema: PGFPLOTS_ORACLE_SCHEMA,
    harnessVersion: num(r.harnessVersion, "oracle.harnessVersion"),
    case: { name: str(c.name, "oracle.case.name"), sourceSha256: str(c.sourceSha256, "oracle.case.sourceSha256") },
    toolchain: {
      engine, engineVersion: str(t.engineVersion, "engineVersion"), pgfVersion: str(t.pgfVersion, "pgfVersion"),
      pgfplotsVersion: str(t.pgfplotsVersion, "pgfplotsVersion"), mutoolVersion: str(t.mutoolVersion, "mutoolVersion"), compat: str(t.compat, "compat"),
    },
    tier1: parseTier1(r.tier1),
    tier2: parseTier2(r.tier2),
  };
}
