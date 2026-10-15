import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { worldTransform, type WorldTransform } from "../../coords/transforms.js";
import type { AdornmentOwnerGeometry, EdgeOperationItem, NodeItem, Span, ToOperationItem } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import {
  readNamedCoordinate,
  readNamedNodeGeometry,
  type NamedNodeGeometry,
  type NodeQuotesMode,
  type SemanticContext
} from "../context.js";
import { parseLength } from "../coords/parse-length.js";
import { applyNameScope } from "../nodes/named-coordinates.js";
import { intersectRayWithPolygon } from "../nodes/shape-geometry.js";
import { findTopLevelCharacter, readBalancedBlock, parseStyleValueAsOptionList } from "../style/option-utils.js";
import { applyMatrixToVector, inverseMatrix } from "../transform.js";
import { stripWrappingBraces } from "../../utils/braces.js";

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

type QuotesMode = NodeQuotesMode;

export type NodeAdornmentSpec = {
  kind: "label" | "pin";
  span: Span;
  valueSpan: Span;
  textSpan: Span;
  text: string;
  angleRaw: string;
  angleSpan?: Span;
  options: OptionListAst | undefined;
  distancePt: number;
  defaultDistancePt: number;
  distanceExplicit: boolean;
  pinEdgeRaw: string | null;
};

export type NodeAdornmentPlan = {
  mainOptions: OptionListAst | undefined;
  adornments: NodeAdornmentSpec[];
};

export type NodeAdornmentDefaults = {
  quoteMode: QuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
};

export type MaterializedNodeAdornment = {
  node: NodeItem;
  mainPoint: WorldPoint | null;
  mainGeometry: NamedNodeGeometry | null;
  mainNameRaw: string;
  pinEdgeOptions: OptionListAst | undefined;
};

const CONTROL_OPTION_KEYS = new Set([
  "label",
  "pin",
  "label position",
  "pin position",
  "label distance",
  "pin distance",
  "pin edge",
  "quotes mean label",
  "quotes mean pin"
]);

const CONTROL_OPTION_FLAGS = new Set([
  "quotes mean label",
  "quotes mean pin"
]);

const ADORNMENT_INTERNAL_STYLE_FLAGS = new Set([
  "every label",
  "every pin",
  "every label quotes",
  "every pin quotes"
]);

const DIRECTION_SHORTHANDS_TO_POSITION: Record<string, string> = {
  centered: "center",
  above: "90",
  below: "-90",
  left: "180",
  right: "0",
  "above left": "135",
  "above right": "45",
  "below left": "-135",
  "below right": "-45"
};

const DIRECTION_TO_DEGREES: Record<string, number> = {
  right: 0,
  "above right": 45,
  above: 90,
  "above left": 135,
  left: 180,
  "below left": 225,
  below: 270,
  "below right": 315,
  east: 0,
  "north east": 45,
  north: 90,
  "north west": 135,
  west: 180,
  "south west": 225,
  south: 270,
  "south east": 315
};

const DIRECTION_TO_ANCHOR: Record<string, string> = {
  right: "east",
  "above right": "north east",
  above: "north",
  "above left": "north west",
  left: "west",
  "below left": "south west",
  below: "south",
  "below right": "south east",
  east: "east",
  "north east": "north east",
  north: "north",
  "north west": "north west",
  west: "west",
  "south west": "south west",
  south: "south",
  "south east": "south east"
};

type RunningAdornmentDefaults = {
  quoteMode: QuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
};

type ParsedAdornment = {
  kind: "label" | "pin";
  span: Span;
  valueSpan: Span;
  textSpan: Span;
  text: string;
  angleRaw: string;
  angleSpan?: Span;
  options: OptionListAst | undefined;
  distancePt: number;
  defaultDistancePt: number;
  distanceExplicit: boolean;
  pinEdgeRaw: string | null;
  angleExplicit: boolean;
};

type ParsedQuoteToken = {
  text: string;
  optionsRaw: string;
  hasApostrophe: boolean;
  textSpan: Span;
};

export function makeNodeAdornmentTargetId(
  ownerNodeId: string,
  adornmentIndex: number,
  kind: "label" | "pin"
): string {
  return `node-adornment:${ownerNodeId}:${kind}:${adornmentIndex}`;
}

export function extractNodeAdornmentPlan(
  options: OptionListAst | undefined,
  baseDefaults?: Partial<NodeAdornmentDefaults>
): NodeAdornmentPlan {
  if (!options) {
    return { mainOptions: undefined, adornments: [] };
  }

  const defaults: RunningAdornmentDefaults = {
    quoteMode: baseDefaults?.quoteMode ?? "label",
    labelPosition: baseDefaults?.labelPosition ?? "above",
    pinPosition: baseDefaults?.pinPosition ?? "above",
    labelDistancePt: baseDefaults?.labelDistancePt ?? parseLength("0pt", "pt")!,
    pinDistancePt: baseDefaults?.pinDistancePt ?? parseLength("3ex", "pt")!,
    pinEdgeRaw: baseDefaults?.pinEdgeRaw ?? null
  };

  const adornments: NodeAdornmentSpec[] = [];
  const mainEntries: OptionEntry[] = [];

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "quotes mean pin") {
        defaults.quoteMode = "pin";
        continue;
      }
      if (entry.key === "quotes mean label") {
        defaults.quoteMode = "label";
        continue;
      }
      if (CONTROL_OPTION_FLAGS.has(entry.key)) {
        continue;
      }
      mainEntries.push(entry);
      continue;
    }

    if (entry.kind === "kv") {
      if (entry.key === "label position") {
        const normalized = normalizeText(entry.valueRaw);
        if (normalized.length > 0) {
          defaults.labelPosition = normalized;
        }
        continue;
      }
      if (entry.key === "pin position") {
        const normalized = normalizeText(entry.valueRaw);
        if (normalized.length > 0) {
          defaults.pinPosition = normalized;
        }
        continue;
      }
      if (entry.key === "label distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          defaults.labelDistancePt = parsed;
        }
        continue;
      }
      if (entry.key === "pin distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          defaults.pinDistancePt = parsed;
        }
        continue;
      }
      if (entry.key === "pin edge") {
        defaults.pinEdgeRaw = entry.valueRaw;
        continue;
      }

      if (entry.key === "label" || entry.key === "pin") {
        const valueStart = resolveOptionValueStartOffset(entry);
        const parsed = parseAdornmentValue(entry.key, entry.valueRaw, entry.span, defaults, {
          valueSpan: {
            from: valueStart,
            to: valueStart + entry.valueRaw.length
          }
        });
        if (parsed) {
          adornments.push({
            kind: parsed.kind,
            span: parsed.span,
            valueSpan: parsed.valueSpan,
            textSpan: parsed.textSpan,
            text: parsed.text,
            angleRaw: parsed.angleRaw,
            ...(parsed.angleSpan === undefined ? {} : { angleSpan: parsed.angleSpan }),
            options: parsed.options,
            distancePt: parsed.distancePt,
            defaultDistancePt: parsed.defaultDistancePt,
            distanceExplicit: parsed.distanceExplicit,
            pinEdgeRaw: parsed.pinEdgeRaw
          });
        }
        continue;
      }

      if (CONTROL_OPTION_KEYS.has(entry.key)) {
        continue;
      }
      mainEntries.push(entry);
      continue;
    }

    const quote = parseQuoteToken(entry.raw, entry.span.from);
    if (!quote) {
      mainEntries.push(entry);
      continue;
    }

    const quoteOptionsRaw = composeQuoteOptions(quote.optionsRaw, quote.hasApostrophe);
    const quoteStyleFlag = defaults.quoteMode === "pin" ? "every pin quotes" : "every label quotes";
    const quoteOptionsWithDefaults = quoteOptionsRaw.length > 0 ? `${quoteStyleFlag},${quoteOptionsRaw}` : quoteStyleFlag;
    const parsedQuote = parseAdornmentValue(
      defaults.quoteMode,
      quoteOptionsWithDefaults.length > 0 ? `{[${quoteOptionsWithDefaults}]${quote.text}}` : quote.text,
      entry.span,
      defaults,
      {
        valueSpan: {
          from: entry.span.from,
          to: entry.span.to
        },
        textSpan: quote.textSpan
      }
    );
    if (!parsedQuote) {
      continue;
    }

    parsedQuote.options = applyDirectionShorthands(parsedQuote.options, parsedQuote.kind);
    const directionalOverride = extractDirectionalAngle(parsedQuote.options);
    if (!parsedQuote.angleExplicit && directionalOverride) {
      parsedQuote.angleRaw = directionalOverride;
    }

    adornments.push({
      kind: parsedQuote.kind,
      span: parsedQuote.span,
      valueSpan: parsedQuote.valueSpan,
      textSpan: parsedQuote.textSpan,
      text: parsedQuote.text,
      angleRaw: parsedQuote.angleRaw,
      ...(parsedQuote.angleSpan === undefined ? {} : { angleSpan: parsedQuote.angleSpan }),
      options: parsedQuote.options,
      distancePt: parsedQuote.distancePt,
      defaultDistancePt: parsedQuote.defaultDistancePt,
      distanceExplicit: parsedQuote.distanceExplicit,
      pinEdgeRaw: parsedQuote.pinEdgeRaw
    });
  }

  return {
    mainOptions: optionListFromEntries(mainEntries, options.span, options.raw),
    adornments
  };
}

export function materializeNodeAdornment(params: {
  spec: NodeAdornmentSpec;
  context: SemanticContext;
  mainNodeNameRaw: string;
  ownerId: string;
  adornmentIndex: number;
}): MaterializedNodeAdornment {
  const { spec, context, mainNodeNameRaw, ownerId, adornmentIndex } = params;
  const frameTransform = context.stack[context.stack.length - 1]?.transform ?? worldTransform(1, 0, 0, 1, 0, 0);
  const generatedName = `generated_pin_${sanitizeName(mainNodeNameRaw)}_${adornmentIndex}`;
  const explicitName = extractOptionValue(spec.options, "name");
  const resolvedName = explicitName ?? (spec.kind === "pin" ? generatedName : undefined);
  const mainPoint = resolveNamedPoint(mainNodeNameRaw, context);
  const mainGeometry = resolveNamedGeometry(mainNodeNameRaw, context);

  const parsedAngle = parseAdornmentAngle(spec.angleRaw, mainNodeNameRaw, context, mainPoint);
  const center = mainPoint ?? worldPoint(0, 0);
  let target = center;
  let anchor = "center";

  if (parsedAngle.kind !== "center") {
    const direction = pointOnUnitCircle(parsedAngle.degrees);
    const borderPoint =
      parsedAngle.borderPoint ??
      intersectNodeBorder(mainGeometry, direction) ??
      center;
    const centerToBorder = worldVector(borderPoint.x - center.x, borderPoint.y - center.y);
    const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
    const isSimple = centerToBorderLength <= 1e-6;
    const shiftDirection = isSimple
      ? direction
      : worldVector(centerToBorder.x / centerToBorderLength, centerToBorder.y / centerToBorderLength);
    target = worldPoint(
      borderPoint.x + shiftDirection.x * spec.distancePt,
      borderPoint.y + shiftDirection.y * spec.distancePt
    );
    anchor = isSimple
      ? anchorFacingAway(parsedAngle.degrees)
      : autoAnchorFromVector(worldVector(shiftDirection.y, pt(-1 * shiftDirection.x)));
  }

  const filteredBase = sanitizeAdornmentOptions(spec.options);
  const entries: OptionEntry[] = [...(filteredBase?.entries ?? [])];
  const hasAnchor = hasExplicitAnchor(entries);
  if (!hasAnchor) {
    entries.push(kvEntry("anchor", anchor, spec.span));
  }
  if (!hasOptionKey(entries, "at")) {
    const localTarget = worldPointToLocalPoint(target, frameTransform);
    entries.push(kvEntry("at", `(${formatPt(localTarget.x)}pt,${formatPt(localTarget.y)}pt)`, spec.span));
  }
  if (resolvedName && !hasOptionKey(entries, "name")) {
    entries.push(kvEntry("name", resolvedName, spec.span));
  }

  const options = optionListFromEntries(entries, spec.span, "");
  const pinEdgeOptions =
    spec.kind === "pin" && spec.pinEdgeRaw != null
      ? (parseStyleValueAsOptionList(spec.pinEdgeRaw) ?? undefined)
      : undefined;

  const optionalOwnerGeometry1 = cloneAdornmentOwnerGeometry(mainGeometry);
  const node: NodeItem = {
    kind: "Node",
    id: `${ownerId}:adornment:${adornmentIndex}`,
    span: spec.span,
    raw: spec.text,
    templateRaw: spec.text,
    ...(resolvedName === undefined ? {} : { name: resolvedName }),
    ...(options?.span === undefined ? {} : { optionsSpan: options?.span }),
    ...(options === undefined ? {} : { options: options }),
    textSource: "group",
    textSpan: spec.textSpan,
    text: spec.text,
    adornment: {
      kind: spec.kind,
      ownerNodeId: ownerId,
      ownerSourceId: ownerId,
      adornmentIndex,
      optionSpan: spec.span,
      valueSpan: spec.valueSpan,
      textSpan: spec.textSpan,
      angleRaw: spec.angleRaw,
      ...(spec.angleSpan === undefined ? {} : { angleSpan: spec.angleSpan }),
      distancePt: spec.distancePt,
      defaultDistancePt: spec.defaultDistancePt,
      distanceExplicit: spec.distanceExplicit,
      pinEdgeRaw: spec.pinEdgeRaw,
      ...(optionalOwnerGeometry1 === undefined ? {} : { ownerGeometry: optionalOwnerGeometry1 }),
    }
  };

  return {
    node,
    mainPoint,
    mainGeometry,
    mainNameRaw: mainNodeNameRaw,
    pinEdgeOptions
  };
}

function worldPointToLocalPoint(point: WorldPoint, transform: WorldTransform): WorldPoint {
  const inverse = inverseMatrix(transform);
  if (!inverse) {
    return point;
  }
  return worldPoint(
    inverse.a * point.x + inverse.c * point.y + inverse.e,
    inverse.b * point.x + inverse.d * point.y + inverse.f
  );
}

export function cloneAdornmentOwnerGeometry(
  geometry: NamedNodeGeometry | null | undefined
): AdornmentOwnerGeometry | undefined {
  if (!geometry) {
    return undefined;
  }
  const optionalAnchorTransform2 = geometry.anchorTransform ? { ...geometry.anchorTransform } : undefined;
  const optionalAnchorPolygon3 = geometry.anchorPolygon?.map((point) => ({ ...point }));
  return {
    shape: geometry.shape,
    center: { ...geometry.center },
    ...(optionalAnchorTransform2 === undefined ? {} : { anchorTransform: optionalAnchorTransform2 }),
    anchorHalfWidth: geometry.anchorHalfWidth,
    anchorHalfHeight: geometry.anchorHalfHeight,
    anchorRadius: geometry.anchorRadius,
    ...(optionalAnchorPolygon3 === undefined ? {} : { anchorPolygon: optionalAnchorPolygon3 })
  };
}

export function stripAdornmentInternalStyleOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const filtered = options.entries.filter((entry) => {
    if (entry.kind === "flag") {
      return !ADORNMENT_INTERNAL_STYLE_FLAGS.has(entry.key);
    }
    return !(entry.kind === "kv" && ADORNMENT_INTERNAL_STYLE_FLAGS.has(entry.key));
  });

  return optionListFromEntries(filtered, options.span, options.raw);
}

export function extractToLikeOptionPlan<T extends ToOperationItem | EdgeOperationItem>(item: T): {
  item: T;
  generatedNodes: NodeItem[];
} {
  const options = item.options;
  if (!options) {
    return { item, generatedNodes: [] };
  }

  const generatedNodes: NodeItem[] = [];
  const keptEntries: OptionEntry[] = [];
  let generatedIndex = 0;

  for (const entry of options.entries) {
    if (entry.kind === "kv" && (entry.key === "edge label" || entry.key === "edge label'")) {
      const optionsRaw = entry.key === "edge label'" ? "auto,swap" : "auto";
      const nodeOptions = parseGeneratedOptions(optionsRaw, entry.span);
      generatedNodes.push(
        makeSyntheticOperationNode(item.id, generatedIndex, stripWrappingBraces(entry.valueRaw), nodeOptions, entry.span, entry.raw)
      );
      generatedIndex += 1;
      continue;
    }

    if (entry.kind === "kv" && entry.key === "edge node") {
      const parsedNodes = parseEdgeNodeOptionValue(item.id, generatedIndex, entry.valueRaw, entry.span, entry.raw);
      if (parsedNodes.length > 0) {
        generatedNodes.push(...parsedNodes);
        generatedIndex += parsedNodes.length;
        continue;
      }
    }

    const quote = parseQuoteToken(entry.raw, entry.span.from);
    if (quote) {
      const quoteOptions = composeQuoteOptions(quote.optionsRaw, quote.hasApostrophe);
      const optionsRaw = quoteOptions.length > 0 ? `every edge quotes,${quoteOptions}` : "every edge quotes";
      const nodeOptions = parseGeneratedOptions(optionsRaw, entry.span);
      generatedNodes.push(
        makeSyntheticOperationNode(item.id, generatedIndex, stripWrappingBraces(quote.text), nodeOptions, entry.span, entry.raw)
      );
      generatedIndex += 1;
      continue;
    }

    keptEntries.push(entry);
  }

  const cleanedOptions = optionListFromEntries(keptEntries, options.span, options.raw);
  if (cleanedOptions === options && generatedNodes.length === 0) {
    return { item, generatedNodes };
  }

  const cleanedItem = { ...item };
  if (cleanedOptions === undefined) {
    delete cleanedItem.options;
    delete cleanedItem.optionsSpan;
  } else {
    cleanedItem.options = cleanedOptions;
    cleanedItem.optionsSpan = cleanedOptions.span;
  }
  return { item: cleanedItem, generatedNodes };
}

function parseAdornmentValue(
  kind: "label" | "pin",
  rawValue: string,
  span: Span,
  defaults: RunningAdornmentDefaults,
  spans: {
    valueSpan: Span;
    textSpan?: Span;
  }
): ParsedAdornment | null {
  let value = stripWrappingBraces(rawValue).trim();
  if (value.length === 0) {
    return null;
  }

  let optionsRaw = "";
  let offsetInValue = rawValue.indexOf(value);
  if (offsetInValue < 0) {
    offsetInValue = 0;
  }
  if (value.startsWith("[")) {
    const block = readBalancedBlock(value, 0, "[", "]");
    if (block) {
      optionsRaw = block.content.trim();
      value = value.slice(block.nextIndex).trim();
      const shifted = rawValue.indexOf(value, offsetInValue + block.nextIndex);
      if (shifted >= 0) {
        offsetInValue = shifted;
      }
    }
  }

  const colonIndex = findTopLevelCharacter(value, ":");
  let angleRaw = kind === "label" ? defaults.labelPosition : defaults.pinPosition;
  let angleExplicit = false;
  let textRaw = value;
  let angleSpan: Span | undefined;
  if (colonIndex >= 0) {
    const maybeAngle = value.slice(0, colonIndex).trim();
    const maybeText = value.slice(colonIndex + 1).trim();
    if (maybeAngle.length > 0) {
      angleRaw = maybeAngle;
      angleExplicit = true;
      const angleRelative = value.indexOf(maybeAngle);
      if (angleRelative >= 0) {
        angleSpan = {
          from: spans.valueSpan.from + offsetInValue + angleRelative,
          to: spans.valueSpan.from + offsetInValue + angleRelative + maybeAngle.length
        };
      }
    }
    textRaw = maybeText;
  }

  if (textRaw.length === 0) {
    return null;
  }

  const styleFlag = kind === "label" ? "every label" : "every pin";
  const optionsWithStyle = optionsRaw.length > 0 ? `${styleFlag},${optionsRaw}` : styleFlag;
  const parsedOptions = parseGeneratedOptions(optionsWithStyle, span);
  const cleanedOptions = sanitizeAdornmentOptions(parsedOptions);
  const defaultDistancePt = kind === "label" ? defaults.labelDistancePt : defaults.pinDistancePt;
  const distancePt = resolveAdornmentDistance(parsedOptions, kind, defaults);
  const distanceExplicit = hasAdornmentDistanceOverride(parsedOptions, kind);
  const pinEdgeRaw = kind === "pin" ? resolvePinEdgeRaw(parsedOptions, defaults.pinEdgeRaw) : null;
  const textSpan =
    spans.textSpan ??
    resolveAdornmentTextSpan(rawValue, textRaw, spans.valueSpan.from);

  return {
    kind,
    span,
    valueSpan: spans.valueSpan,
    textSpan,
    text: stripWrappingBraces(textRaw),
    angleRaw,
    ...(angleSpan === undefined ? {} : { angleSpan: angleSpan }),
    options: cleanedOptions,
    distancePt,
    defaultDistancePt,
    distanceExplicit,
    pinEdgeRaw,
    angleExplicit
  };
}

function parseQuoteToken(raw: string, absoluteFrom: number): ParsedQuoteToken | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("\"")) {
    return null;
  }

  let cursor = 1;
  while (cursor < trimmed.length) {
    const char = trimmed.charAt(cursor);
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "\"") {
      break;
    }
    cursor += 1;
  }

  if (cursor >= trimmed.length || trimmed.charAt(cursor) !== "\"") {
    return null;
  }

  const text = trimmed.slice(1, cursor);
  let rest = trimmed.slice(cursor + 1).trim();
  let hasApostrophe = false;
  if (rest.startsWith("'")) {
    hasApostrophe = true;
    rest = rest.slice(1).trim();
  }

  let optionsRaw = rest;
  if (rest.startsWith("{")) {
    const block = readBalancedBlock(rest, 0, "{", "}");
    if (!block) {
      return null;
    }
    optionsRaw = block.content.trim();
    rest = rest.slice(block.nextIndex).trim();
    if (rest.length > 0) {
      optionsRaw = optionsRaw.length > 0 ? `${optionsRaw}, ${rest}` : rest;
    }
  }

  return {
    text,
    optionsRaw: optionsRaw.trim(),
    hasApostrophe,
    textSpan: {
      from: absoluteFrom + 1,
      to: absoluteFrom + cursor
    }
  };
}

function resolveOptionValueStartOffset(entry: Extract<OptionEntry, { kind: "kv" }>): number {
  const relative = entry.raw.indexOf(entry.valueRaw);
  if (relative >= 0) {
    return entry.span.from + relative;
  }
  return entry.span.from;
}

function resolveAdornmentTextSpan(rawValue: string, textRaw: string, absoluteFrom: number): Span {
  const normalized = textRaw.trim();
  const relative = normalized.length > 0 ? rawValue.indexOf(normalized) : -1;
  if (relative >= 0) {
    return {
      from: absoluteFrom + relative,
      to: absoluteFrom + relative + normalized.length
    };
  }
  return {
    from: absoluteFrom,
    to: absoluteFrom + rawValue.length
  };
}

function composeQuoteOptions(optionsRaw: string, hasApostrophe: boolean): string {
  const trimmed = optionsRaw.trim();
  if (hasApostrophe) {
    return trimmed.length > 0 ? `swap,${trimmed}` : "swap";
  }
  return trimmed;
}

function extractDirectionalAngle(options: OptionListAst | undefined): string | null {
  if (!options) {
    return null;
  }

  let resolved: string | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "centered") {
        resolved = "center";
        continue;
      }
      if (entry.key in DIRECTION_TO_DEGREES) {
        resolved = entry.key;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "label position" || entry.key === "pin position") {
      const normalized = normalizeText(entry.valueRaw);
      if (normalized.length > 0) {
        resolved = normalized;
      }
      continue;
    }
    if (entry.key in DIRECTION_TO_DEGREES) {
      resolved = entry.key;
    }
  }

  return resolved;
}

function applyDirectionShorthands(
  options: OptionListAst | undefined,
  kind: "label" | "pin"
): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const positionKey = kind === "label" ? "label position" : "pin position";
  const rewritten: OptionEntry[] = [];
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const rewrittenValue = DIRECTION_SHORTHANDS_TO_POSITION[entry.key];
      if (rewrittenValue != null) {
        rewritten.push(kvEntry(positionKey, rewrittenValue, entry.span));
        continue;
      }
    }
    rewritten.push(entry);
  }

  return optionListFromEntries(rewritten, options.span, options.raw);
}

function resolveAdornmentDistance(
  options: OptionListAst | undefined,
  kind: "label" | "pin",
  defaults: RunningAdornmentDefaults
): number {
  const key = kind === "label" ? "label distance" : "pin distance";
  const fallback = kind === "label" ? defaults.labelDistancePt : defaults.pinDistancePt;
  if (!options) {
    return fallback;
  }

  let resolved = fallback;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== key) {
      continue;
    }
    const parsed = parseLength(entry.valueRaw, "pt");
    if (parsed != null && Number.isFinite(parsed)) {
      resolved = parsed;
    }
  }

  return resolved;
}

function hasAdornmentDistanceOverride(
  options: OptionListAst | undefined,
  kind: "label" | "pin"
): boolean {
  if (!options) {
    return false;
  }
  const key = kind === "label" ? "label distance" : "pin distance";
  return options.entries.some((entry) => entry.kind === "kv" && entry.key === key);
}

function resolvePinEdgeRaw(options: OptionListAst | undefined, fallback: string | null): string | null {
  if (!options) {
    return fallback;
  }

  let resolved = fallback;
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "pin edge") {
      resolved = entry.valueRaw;
    }
  }
  return resolved;
}

function sanitizeAdornmentOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const filtered: OptionEntry[] = [];
  for (const entry of options.entries) {
    if (entry.kind === "flag" && CONTROL_OPTION_FLAGS.has(entry.key)) {
      continue;
    }
    if (entry.kind === "kv" && CONTROL_OPTION_KEYS.has(entry.key)) {
      continue;
    }
    filtered.push(entry);
  }

  return optionListFromEntries(filtered, options.span, options.raw);
}

function parseGeneratedOptions(raw: string, span: Span): OptionListAst | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = parseOptionListRaw(`[${trimmed}]`, span.from);
  const normalizedEntries = parsed.entries.map((entry) => {
    if (entry.kind === "unknown" && entry.raw.trim() === "'") {
      return {
        kind: "flag" as const,
        key: "swap",
        span: entry.span,
        raw: "swap"
      };
    }
    return entry;
  });

  return optionListFromEntries(normalizedEntries, parsed.span, parsed.raw);
}

function parseEdgeNodeOptionValue(
  ownerId: string,
  startingIndex: number,
  rawValue: string,
  span: Span,
  raw: string
): NodeItem[] {
  const nodes: NodeItem[] = [];
  let remainder = stripWrappingBraces(rawValue).trim();

  while (remainder.length > 0) {
    // Intentionally limited to common `node[...] (...) {..}` / `\node ...` forms.
    // More dynamic TeX forms are left untouched for later dedicated parsing support.
    const parsed = parseSingleEdgeNodeSpec(remainder);
    if (!parsed) {
      break;
    }

    nodes.push(
      makeSyntheticOperationNode(ownerId, startingIndex + nodes.length, parsed.text, parsed.options, span, raw, parsed.name)
    );
    remainder = parsed.rest.trim();
  }

  return nodes;
}

function parseSingleEdgeNodeSpec(source: string): {
  name?: string;
  options: OptionListAst | undefined;
  text: string;
  rest: string;
} | null {
  let cursor = 0;
  const nodeKeyword = source.startsWith("\\node") ? "\\node" : source.startsWith("node") ? "node" : null;
  if (!nodeKeyword) {
    return null;
  }
  cursor += nodeKeyword.length;

  while (cursor < source.length && /\s/u.test(source.charAt(cursor))) {
    cursor += 1;
  }

  let options: OptionListAst | undefined;
  if ((source.charAt(cursor)) === "[") {
    const block = readBalancedBlock(source, cursor, "[", "]");
    if (!block) {
      return null;
    }
    options = parseGeneratedOptions(block.content, {
      from: 0,
      to: block.nextIndex
    });
    cursor = block.nextIndex;
    while (cursor < source.length && /\s/u.test(source.charAt(cursor))) {
      cursor += 1;
    }
  }

  let name: string | undefined;
  if ((source.charAt(cursor)) === "(") {
    const block = readBalancedBlock(source, cursor, "(", ")");
    if (!block) {
      return null;
    }
    const normalizedName = stripWrappingBraces(block.content).trim();
    if (normalizedName.length > 0) {
      name = normalizedName;
    }
    cursor = block.nextIndex;
    while (cursor < source.length && /\s/u.test(source.charAt(cursor))) {
      cursor += 1;
    }
  }

  if ((source.charAt(cursor)) !== "{") {
    return null;
  }
  const block = readBalancedBlock(source, cursor, "{", "}");
  if (!block) {
    return null;
  }

  return {
    ...(name === undefined ? {} : { name: name }),
    options,
    text: stripWrappingBraces(block.content),
    rest: source.slice(block.nextIndex)
  };
}

function makeSyntheticOperationNode(
  ownerId: string,
  index: number,
  text: string,
  options: OptionListAst | undefined,
  span: Span,
  raw: string,
  name?: string
): NodeItem {
  return {
    kind: "Node",
    id: `${ownerId}:synthetic-node:${index}`,
    span,
    raw,
    templateRaw: raw,
    ...(name === undefined ? {} : { name: name }),
    ...(options?.span === undefined ? {} : { optionsSpan: options?.span }),
    ...(options === undefined ? {} : { options: options }),
    textSource: "group",
    textSpan: span,
    text
  };
}

function parseAdornmentAngle(
  rawAngle: string,
  mainNodeNameRaw: string,
  context: SemanticContext,
  mainPoint: WorldPoint | null
): { kind: "center" } | { kind: "angle"; degrees: number; borderPoint?: WorldPoint } {
  const normalized = normalizeText(rawAngle);
  if (normalized === "center" || normalized === "centered") {
    return { kind: "center" };
  }

  const mapped = DIRECTION_TO_DEGREES[normalized];
  if (mapped != null) {
    const mappedAnchor = DIRECTION_TO_ANCHOR[normalized];
    if (mappedAnchor) {
      const anchorPoint = resolveNamedPoint(`${mainNodeNameRaw}.${mappedAnchor}`, context);
      if (anchorPoint) {
        return { kind: "angle", degrees: mapped, borderPoint: anchorPoint };
      }
    }
    return { kind: "angle", degrees: mapped };
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return { kind: "angle", degrees: normalizeDegrees(numeric) };
  }

  if (mainPoint) {
    const anchorPoint = resolveNamedPoint(`${mainNodeNameRaw}.${normalized}`, context);
    if (anchorPoint) {
      const dx = anchorPoint.x - mainPoint.x;
      const dy = anchorPoint.y - mainPoint.y;
      const degrees = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
      return { kind: "angle", degrees, borderPoint: anchorPoint };
    }
  }

  return { kind: "angle", degrees: 90 };
}

function resolveNamedPoint(nameRaw: string, context: SemanticContext): WorldPoint | null {
  const scoped = applyNameScope(nameRaw, context);
  const candidates = scoped === nameRaw ? [nameRaw] : [scoped, nameRaw];
  for (const candidate of candidates) {
    const point = readNamedCoordinate(context, candidate);
    if (point) {
      return point;
    }
  }
  return null;
}

function resolveNamedGeometry(nameRaw: string, context: SemanticContext): NamedNodeGeometry | null {
  const scoped = applyNameScope(nameRaw, context);
  const candidates = scoped === nameRaw ? [nameRaw] : [scoped, nameRaw];
  for (const candidate of candidates) {
    const geometry = readNamedNodeGeometry(context, candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(geometry: NamedNodeGeometry | null, direction: WorldPoint): WorldPoint | null {
  if (!geometry) {
    return null;
  }
  const dx = direction.x;
  const dy = direction.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return geometry.center;
  }

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return worldVector(dx, dy);
      const inverse = inverseMatrix(transform);
      if (!inverse) return worldVector(dx, dy);
      return applyMatrixToVector(inverse, worldVector(dx, dy));
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (!Number.isFinite(localLen) || localLen <= 1e-9) {
      return geometry.center;
    }
    const localPoint = worldVector(
      (localDirection.x / localLen) * radius,
      (localDirection.y / localLen) * radius
    );
    if (!transform) {
      return worldPoint(geometry.center.x + localPoint.x, geometry.center.y + localPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  if (geometry.shape === "rectangle") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return worldVector(dx, dy);
      const inverse = inverseMatrix(transform);
      if (!inverse) return worldVector(dx, dy);
      return applyMatrixToVector(inverse, worldVector(dx, dy));
    })();
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    const localPoint = worldVector(localDirection.x * scale, localDirection.y * scale);
    if (!transform) {
      return worldPoint(geometry.center.x + localPoint.x, geometry.center.y + localPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  if (geometry.shape === "ellipse") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return worldVector(dx, dy);
      const inverse = inverseMatrix(transform);
      if (!inverse) return worldVector(dx, dy);
      return applyMatrixToVector(inverse, worldVector(dx, dy));
    })();
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return geometry.center;
    }
    const localPoint = worldVector(localDirection.x * scale, localDirection.y * scale);
    if (!transform) {
      return worldPoint(geometry.center.x + localPoint.x, geometry.center.y + localPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon(worldPoint(0, 0), worldVector(dx, dy), geometry.anchorPolygon);
    if (hit) {
      return worldPoint(geometry.center.x + hit.x, geometry.center.y + hit.y);
    }
  }

  return geometry.center;
}

function anchorFacingAway(degrees: number): string {
  const normalized = normalizeDegrees(degrees);
  if (normalized < 4 || normalized >= 356) {
    return "west";
  }
  if (normalized < 87) {
    return "south west";
  }
  if (normalized < 94) {
    return "south";
  }
  if (normalized < 177) {
    return "south east";
  }
  if (normalized < 184) {
    return "east";
  }
  if (normalized < 267) {
    return "north east";
  }
  if (normalized < 274) {
    return "north";
  }
  return "north west";
}

function autoAnchorFromVector(vector: Pick<WorldPoint | WorldVector, "x" | "y">): string {
  if (vector.x > 0.05) {
    if (vector.y > 0.05) {
      return "south east";
    }
    if (vector.y < -0.05) {
      return "south west";
    }
    return "south";
  }
  if (vector.x < -0.05) {
    if (vector.y > 0.05) {
      return "north east";
    }
    if (vector.y < -0.05) {
      return "north west";
    }
    return "north";
  }
  return vector.y > 0 ? "east" : "west";
}

function pointOnUnitCircle(degrees: number): WorldPoint {
  const radians = (degrees * Math.PI) / 180;
  return worldPoint(Math.cos(radians), Math.sin(radians));
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function hasExplicitAnchor(entries: OptionEntry[]): boolean {
  return entries.some((entry) => entry.kind === "kv" && entry.key === "anchor");
}

function extractOptionValue(options: OptionListAst | undefined, key: string): string | undefined {
  if (!options) {
    return undefined;
  }
  let resolved: string | undefined;
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === key) {
      resolved = stripWrappingBraces(entry.valueRaw).trim();
    }
  }
  return resolved && resolved.length > 0 ? resolved : undefined;
}

function hasOptionKey(entries: OptionEntry[], key: string): boolean {
  return entries.some((entry) => entry.kind === "kv" && entry.key === key);
}

function kvEntry(key: string, valueRaw: string, span: Span): OptionEntry {
  return {
    kind: "kv",
    key,
    valueRaw,
    span,
    raw: `${key}=${valueRaw}`
  };
}

function optionListFromEntries(entries: OptionEntry[], span: Span, raw: string): OptionListAst | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  return {
    span,
    raw: raw.length > 0 ? raw : `[${entries.map((entry) => entry.raw).join(", ")}]`,
    entries
  };
}

function normalizeText(raw: string): string {
  return stripWrappingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}

function formatPt(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function sanitizeName(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "node";
}
