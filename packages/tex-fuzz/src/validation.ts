import { SIMPLE_TEX_DISPLAY_MATH_DELIMITERS } from "@tikz-editor/core/text/tex/index.js";
import { TEX_FUZZ_FEATURE_DEFINITIONS } from "./features.js";
import { TEX_FUZZ_SCHEMA_VERSION, type TexFuzzCase, type TexFuzzDimension, type TexFuzzFeatureId, type TexFuzzFingerprint, type TexFuzzMathNode, type TexFuzzMutation, type TexFuzzNode, type TexFuzzObservation, type TexFuzzReplayBundle, type TexFuzzSourceSpan, type TexFuzzChoice } from "./model.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isString(value: unknown): value is string { return typeof value === "string"; }
function isBoolean(value: unknown): value is boolean { return typeof value === "boolean"; }
function oneOf<T extends string | number>(value: unknown, choices: readonly T[]): value is T {
  const candidates: readonly unknown[] = choices;
  return candidates.includes(value);
}
export function isArrayOf<T>(value: unknown, validate: (entry: unknown) => entry is T): value is T[] {
  if (!Array.isArray(value)) return false;
  const entries: readonly unknown[] = value;
  for (const entry of entries) if (!validate(entry)) return false;
  return true;
}
function optional(value: Record<string, unknown>, key: string, validate: (entry: unknown) => boolean): boolean {
  return !(key in value) || validate(value[key]);
}
export function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every(isString);
}
const featureIds: ReadonlySet<string> = new Set(Object.values(TEX_FUZZ_FEATURE_DEFINITIONS).map(definition => definition.id));
export function isTexFuzzFeatureId(value: unknown): value is TexFuzzFeatureId {
  return typeof value === "string" && featureIds.has(value);
}
const NODE_KINDS = ["text", "space", "group", "font", "font-declaration", "style-declaration", "color", "math", "display-math", "accent", "line-break", "box", "dimension-box", "raisebox", "transform-box", "rule", "tabular", "paragraph-break", "noindent", "alignment", "environment", "item", "vertical-glue", "penalty", "vertical-rule", "document-box", "oracle-command"] as const;
const MATH_KINDS = ["atom", "group", "sequence", "fraction", "radical", "script", "accent", "alphabet", "line", "left-right", "operator", "stackrel", "xarrow", "matrix", "text"] as const;
const FONT_COMMANDS = ["textnormal", "textit", "textbf", "textmd", "textsl", "texttt", "textup", "textrm", "textsf", "textsc", "emph"] as const;
const FONT_DECLARATIONS = ["normalfont", "bfseries", "mdseries", "rmfamily", "sffamily", "ttfamily", "itshape", "slshape", "upshape", "scshape", "it", "bf", "rm", "sf", "sl", "sc", "tt", "em"] as const;
const SIZE_DECLARATIONS = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const;
function isColor(value: unknown): value is "red" | "blue" | "teal" { return oneOf(value, ["red", "blue", "teal"]); }
function isPosition(value: unknown): value is "t" | "c" | "b" { return oneOf(value, ["t", "c", "b"]); }
function isDimension(value: unknown): value is TexFuzzDimension {
  return isRecord(value) && isNumber(value.amount) && oneOf(value.unit, ["pt", "pc", "in", "bp", "cm", "mm", "dd", "cc", "sp", "em", "ex"]);
}
function isResizeDimension(value: unknown): value is TexFuzzDimension | "!" { return value === "!" || isDimension(value); }
function isMathNodes(value: unknown): value is TexFuzzMathNode[] { return isArrayOf(value, isMathNode); }
function isMathNode(value: unknown): value is TexFuzzMathNode {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "atom": return isString(value.value);
    case "group": return isMathNode(value.body);
    case "sequence": return isMathNodes(value.items) && isArrayOf(value.operators, isString);
    case "fraction": return oneOf(value.command, ["frac", "dfrac", "tfrac", "binom"]) && isMathNode(value.numerator) && isMathNode(value.denominator);
    case "radical": return isMathNode(value.body) && optional(value, "degree", isMathNode);
    case "script": return isMathNode(value.base) && optional(value, "subscript", isMathNode) && optional(value, "superscript", isMathNode);
    case "accent": return oneOf(value.command, ["hat", "bar", "tilde", "vec", "dot", "ddot", "widehat", "widetilde"]) && isMathNode(value.body);
    case "alphabet": return oneOf(value.command, ["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "boldsymbol"]) && isMathNode(value.body);
    case "line": return oneOf(value.command, ["overline", "underline", "overbrace", "underbrace"]) && isMathNode(value.body);
    case "left-right": return isString(value.left) && isString(value.right) && isMathNode(value.body);
    case "operator": return oneOf(value.command, ["sum", "prod", "int", "lim", "bigcup", "bigcap"]) && optional(value, "script", isMathNode);
    case "stackrel": return isMathNode(value.above) && isMathNode(value.body);
    case "xarrow": return oneOf(value.command, ["xleftarrow", "xrightarrow"]) && optional(value, "below", isMathNode) && isMathNode(value.above);
    case "matrix": return oneOf(value.environment, ["matrix", "pmatrix", "bmatrix", "smallmatrix", "cases"]) && isArrayOf(value.cells, isMathNodes);
    case "text": return oneOf(value.command, ["text", "mathrm", "mathbf"]) && isString(value.value);
    default: return false;
  }
}
function isNodes(value: unknown): value is TexFuzzNode[] { return isArrayOf(value, isNode); }
function isMathContent(value: Record<string, unknown>): boolean {
  return (isString(value.content) && !("body" in value)) || (isMathNode(value.body) && !("content" in value));
}
function isNode(value: unknown): value is TexFuzzNode {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "text": return isString(value.value);
    case "space": return isBoolean(value.nonBreaking);
    case "group": return isNodes(value.children);
    case "font": return oneOf(value.command, FONT_COMMANDS) && isNodes(value.children);
    case "font-declaration": return oneOf(value.command, FONT_DECLARATIONS) && isNodes(value.children);
    case "style-declaration": return isNodes(value.children) && (oneOf(value.command, SIZE_DECLARATIONS) || (value.command === "color" && isColor(value.color)) || (value.command === "fontsize" && isDimension(value.size) && isDimension(value.baselineSkip)));
    case "color": return isColor(value.color) && isNodes(value.children);
    case "math": return optional(value, "delimiter", entry => oneOf(entry, ["dollar", "paren"])) && isMathContent(value);
    case "display-math": return oneOf(value.delimiter, SIMPLE_TEX_DISPLAY_MATH_DELIMITERS) && isMathContent(value);
    case "accent": return oneOf(value.command, ["'", "`", "^"]) && isString(value.base);
    case "line-break": return value.command === "newline" || (value.command === "linebreak" && optional(value, "priority", entry => oneOf(entry, [0, 1, 2, 3, 4]))) || (value.command === "\\" && optional(value, "starred", isBoolean) && optional(value, "leading", isDimension));
    case "box":
      if (!isNodes(value.children)) return false;
      if (oneOf(value.command, ["underline", "mbox", "fbox", "llap", "rlap"])) return true;
      if (oneOf(value.command, ["makebox", "framebox"])) {
        return optional(value, "width", isDimension) && optional(value, "alignment", entry => oneOf(entry, ["l", "c", "r", "s"]));
      }
      return (value.command === "colorbox" && isColor(value.backgroundColor)) ||
        (value.command === "fcolorbox" && isColor(value.frameColor) && isColor(value.backgroundColor));
    case "dimension-box": return oneOf(value.command, ["hphantom", "vphantom", "phantom", "smash"]) && isNodes(value.children);
    case "raisebox": return isDimension(value.lift) && optional(value, "height", isDimension) && optional(value, "depth", isDimension) && isNodes(value.children);
    case "transform-box": return isNodes(value.children) && ((value.command === "rotatebox" && isNumber(value.angle)) || (value.command === "scalebox" && isNumber(value.scale) && optional(value, "verticalScale", isNumber)) || (value.command === "resizebox" && isResizeDimension(value.width) && isResizeDimension(value.height) && optional(value, "totalHeight", isBoolean)) || value.command === "reflectbox");
    case "rule": return optional(value, "raise", isDimension) && isDimension(value.width) && isDimension(value.height);
    case "tabular": return isArrayOf(value.columns, (entry): entry is "l" | "c" | "r" => oneOf(entry, ["l", "c", "r"])) && optional(value, "position", isPosition) && isArrayOf(value.cells, isNodes);
    case "paragraph-break": return oneOf(value.command, ["par", "blank-line"]);
    case "noindent": return true;
    case "alignment": return oneOf(value.command, ["centering", "raggedright", "raggedleft"]);
    case "environment": return oneOf(value.name, ["quote", "quotation", "center", "flushleft", "flushright", "itemize", "enumerate", "description"]) && isNodes(value.children);
    case "item": return optional(value, "label", isNodes);
    case "vertical-glue": return oneOf(value.command, ["smallskip", "medskip", "bigskip", "vfill"]) || (value.command === "vspace" && optional(value, "starred", isBoolean) && isDimension(value.size)) || (value.command === "vskip" && isDimension(value.size));
    case "penalty": return isNumber(value.value);
    case "vertical-rule": return optional(value, "width", isDimension) && optional(value, "height", isDimension) && optional(value, "depth", isDimension);
    case "document-box": return isNodes(value.children) && isDimension(value.width) && optional(value, "position", isPosition) && (value.command === "minipage" || (value.command === "parbox" && optional(value, "height", isDimension) && optional(value, "innerPosition", entry => oneOf(entry, ["t", "c", "b", "s"]))));
    case "oracle-command": return value.command === "TeX";
    default: return false;
  }
}
function isSourceSpan(value: unknown): value is TexFuzzSourceSpan {
  return isRecord(value) && isString(value.path) && (oneOf(value.kind, NODE_KINDS) || MATH_KINDS.some(kind => value.kind === `math.${kind}`)) && isNumber(value.start) && isNumber(value.end);
}
function isChoice(value: unknown): value is TexFuzzChoice {
  return isRecord(value) && isString(value.path) && isNumber(value.upperExclusive) && isNumber(value.value);
}
function isMutation(value: unknown): value is TexFuzzMutation {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "truncate": return isNumber(value.offset);
    case "insert": return isNumber(value.offset) && isString(value.text);
    case "delete": return isNumber(value.start) && isNumber(value.end);
    case "replace": return isNumber(value.start) && isNumber(value.end) && isString(value.text);
    default: return false;
  }
}
/** Validate replay structure; source is intentionally allowed to be malformed TeX. */
export function isTexFuzzCase(value: unknown): value is TexFuzzCase {
  return isRecord(value) && value.schemaVersion === TEX_FUZZ_SCHEMA_VERSION && isString(value.generatorVersion) && isNumber(value.seed) && oneOf(value.profile, ["vertical-slice", "canary", "aggressive", "supported-aggressive", "document", "malformed"]) && isNodes(value.ast) && isString(value.source) && isArrayOf(value.sourceMap, isSourceSpan) && isArrayOf(value.choices, isChoice) && isArrayOf(value.features, isTexFuzzFeatureId) && isArrayOf(value.mutations, isMutation);
}
export function isTexFuzzFingerprint(value: unknown): value is TexFuzzFingerprint {
  return isRecord(value) && value.version === 1 && oneOf(value.resultClass, ["hard-invariant", "differential", "timeout", "resource-limit"]) && isString(value.code) && optional(value, "firstDivergentLayer", isString) && isArrayOf(value.featureTags, isTexFuzzFeatureId) && oneOf(value.mode, ["text", "math", "document"]) && isString(value.structuralLocus) && optional(value, "operationKind", isString) && optional(value, "oracleEnvironmentFamily", isString) && optional(value, "severityBucket", entry => oneOf(entry, ["small", "medium", "large"]));
}
function isObservation(value: unknown): value is TexFuzzObservation {
  return isRecord(value) && isTexFuzzFingerprint(value.fingerprint) && optional(value, "detail", isRecord);
}
function isShrink(value: unknown): value is NonNullable<TexFuzzReplayBundle["shrink"]> {
  return isRecord(value) && isNumber(value.candidatesEvaluated) && isNumber(value.oracleEvaluations) && oneOf(value.termination, ["minimal", "candidate-budget", "oracle-budget", "time-budget"]);
}
export function isTexFuzzReplayBundle(value: unknown): value is TexFuzzReplayBundle {
  return isRecord(value) && isTexFuzzCase(value.case) && optional(value, "minimizedCase", isTexFuzzCase) && isObservation(value.observation) && optional(value, "oracleEnvironment", isStringRecord) && optional(value, "shrink", isShrink);
}
