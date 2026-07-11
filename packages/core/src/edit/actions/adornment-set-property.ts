import { parseStyleValueAsOptionList } from "../../semantic/style/option-utils.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Span } from "../../ast/types.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { formatNumber, pointDistanceFormatOptions, type DragFormatPrecision } from "../format.js";
import { replaceSpan } from "../patch.js";
import type { PropertyTarget } from "../property-target.js";
import {
  normalizeOptionKey,
  rewriteOptionListMutations,
  rewriteSourceBackedOptionListMutations,
  type OptionMutation
} from "../option-mutations.js";
import type { EditActionResult } from "../actions.js";
import {
  ADORNMENT_ANGLE_PROPERTY_KEY,
  ADORNMENT_DISTANCE_PROPERTY_KEY,
  ADORNMENT_TEXT_PROPERTY_KEY,
  PIN_EDGE_DASH_PROPERTY_KEY,
  PIN_EDGE_DRAW_PROPERTY_KEY,
  PIN_EDGE_LINE_WIDTH_PROPERTY_KEY
} from "../adornment-keys.js";

type SetPropertyActionLike = {
  elementId: string;
  key: string;
  value: string;
  clearKeys?: string[];
};

const ADORNMENT_DEFAULT_DISTANCE_EPSILON = 0.05;

export const ADORNMENT_EDIT_NOOP_REASON = "Adornment edit would not change the source.";

export function applyAdornmentSetProperty(
  source: string,
  target: PropertyTarget,
  action: SetPropertyActionLike
): EditActionResult {
  if (target.kind !== "node-adornment" || !target.valueSpan) {
    return { kind: "unsupported", reason: "Adornment target does not have a writable value span." };
  }

  if (action.key === ADORNMENT_TEXT_PROPERTY_KEY) {
    return applyAdornmentValueRewrite(source, target, { textRaw: action.value }, action.elementId);
  }

  if (action.key === ADORNMENT_ANGLE_PROPERTY_KEY) {
    const parsed = Number(action.value);
    if (!Number.isFinite(parsed)) {
      return { kind: "error", message: "Adornment angle must be a finite number." };
    }
    return applyAdornmentValueRewrite(source, target, { angleRaw: formatAdornmentAngle(parsed) }, action.elementId);
  }

  if (action.key === ADORNMENT_DISTANCE_PROPERTY_KEY) {
    const parsed = parseLength(action.value, "pt");
    if (parsed == null || !Number.isFinite(parsed)) {
      return { kind: "error", message: "Adornment distance must be a valid length." };
    }
    return applyAdornmentValueRewrite(source, target, { distancePt: parsed }, action.elementId);
  }

  if (
    action.key === PIN_EDGE_DRAW_PROPERTY_KEY ||
    action.key === PIN_EDGE_LINE_WIDTH_PROPERTY_KEY ||
    action.key === PIN_EDGE_DASH_PROPERTY_KEY
  ) {
    return applyAdornmentValueRewrite(
      source,
      target,
      undefined,
      action.elementId,
      buildPinEdgeMutations(action.key, action.value, action.clearKeys ?? [])
    );
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }
  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = new Map<string, OptionMutation>();
  for (const rawClearKey of action.clearKeys ?? []) {
    const clearKey = normalizeOptionKey(rawClearKey);
    if (clearKey.length === 0) {
      continue;
    }
    if (clearKey === key && !removePrimaryKey) {
      continue;
    }
    mutations.set(clearKey, { kind: "remove" });
  }
  if (removePrimaryKey) {
    mutations.set(key, { kind: "remove" });
  } else {
    mutations.set(key, { kind: "set", value: action.value });
  }
  return applyAdornmentValueRewrite(source, target, undefined, action.elementId, undefined, mutations);
}

export function applyAdornmentValueRewrite(
  source: string,
  target: PropertyTarget,
  overrides: {
    angleRaw?: string;
    textRaw?: string;
    distancePt?: number;
  } | undefined,
  selectedTargetId: string,
  pinEdgeMutations?: ReadonlyMap<string, OptionMutation>,
  optionMutations?: ReadonlyMap<string, OptionMutation>,
  formatPrecision?: DragFormatPrecision
): EditActionResult {
  if (target.kind !== "node-adornment" || !target.valueSpan) {
    return { kind: "unsupported", reason: "Adornment target does not have a writable value span." };
  }

  const kind = target.adornmentKind ?? "label";
  const distanceKey = kind === "pin" ? "pin distance" : "label distance";
  const distancePt = Math.max(0, overrides?.distancePt ?? target.distancePt ?? target.defaultDistancePt ?? 0);
  const defaultDistancePt = Math.max(0, target.defaultDistancePt ?? (kind === "pin" ? (parseLength("3ex", "pt") ?? 12.9) : 0));
  const baseOptionMutations = new Map(optionMutations ?? []);
  if (Math.abs(distancePt - defaultDistancePt) <= ADORNMENT_DEFAULT_DISTANCE_EPSILON) {
    baseOptionMutations.set(distanceKey, { kind: "remove" });
  } else {
    baseOptionMutations.set(distanceKey, {
      kind: "set",
      value: `${formatNumber(distancePt, pointDistanceFormatOptions(formatPrecision))}pt`
    });
  }

  const authoredOptionSite = resolveAdornmentOptionSite(source, target.valueSpan);
  if (pinEdgeMutations && kind === "pin") {
    const rewrittenPinEdge = rewriteAdornmentPinEdgeOptions(
      source,
      authoredOptionSite,
      target.pinEdgeRaw ?? null,
      pinEdgeMutations
    );
    if (rewrittenPinEdge == null) {
      baseOptionMutations.set("pin edge", { kind: "remove" });
    } else {
      baseOptionMutations.set("pin edge", { kind: "set", value: formatPinEdgeOptionValue(rewrittenPinEdge) });
    }
  }

  const serializedOptions = authoredOptionSite
    ? rewriteSourceBackedOptionListMutations(
        source,
        authoredOptionSite.span,
        authoredOptionSite.options,
        baseOptionMutations,
        "bracketed"
      )
    // Without an authored leading option list, this is an isolated/synthesized
    // fragment and canonical serialization cannot rewrite unrelated source.
    : rewriteOptionListMutations(
        target.options ?? emptyOptionListAt(target.valueSpan.from),
        baseOptionMutations
      );
  const optionsRaw = unwrapOptionList(serializedOptions, "[", "]");
  const replacement = serializeAdornmentValue(
    kind,
    overrides?.angleRaw ?? target.angleRaw ?? "center",
    overrides?.textRaw ?? (target.textSpan ? source.slice(target.textSpan.from, target.textSpan.to) : ""),
    optionsRaw
  );
  const updated = replaceSpan(source, target.valueSpan, replacement);
  if (updated.source === source) {
    return { kind: "unsupported", reason: ADORNMENT_EDIT_NOOP_REASON };
  }
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: target.valueSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    ],
    selectedSourceIds: [selectedTargetId],
    changedSourceIds: [target.ownerSourceId!]
  };
}

function rewriteAdornmentPinEdgeOptions(
  source: string,
  authoredOptionSite: SourceBackedAdornmentOptionSite | null,
  pinEdgeRaw: string | null,
  mutations: ReadonlyMap<string, OptionMutation>
): string | null {
  const pinEdgeEntry = findAuthoredPinEdgeEntry(authoredOptionSite);
  if (pinEdgeEntry?.valueSpan) {
    const valueSpan = pinEdgeEntry.valueSpan;
    const sourceRaw = source.slice(valueSpan.from, valueSpan.to);
    const parsed = parseStyleValueAsOptionList(sourceRaw, valueSpan.from);
    if (parsed) {
      const format = sourceRaw.trim().startsWith("{") ? "braced" : "bare";
      const rewritten = rewriteSourceBackedOptionListMutations(
        source,
        valueSpan,
        parsed,
        mutations,
        format
      ).trim();
      if (rewritten.length === 0 || rewritten === "{}") {
        return null;
      }
      return rewritten;
    }
  }

  // No authored nested option span is available (for example, an inherited
  // pin edge). Normalized serialization is safe for this isolated fragment.
  const parsed = pinEdgeRaw ? parseStyleValueAsOptionList(pinEdgeRaw) : null;
  const rewritten = rewriteOptionListMutations(
    parsed ?? emptyOptionListAt(0),
    mutations
  ).slice(1, -1).trim();
  return rewritten.length > 0 ? rewritten : null;
}

type SourceBackedAdornmentOptionSite = {
  span: Span;
  options: OptionListAst;
};

function findAuthoredPinEdgeEntry(
  site: SourceBackedAdornmentOptionSite | null
): Extract<OptionEntry, { kind: "kv" }> | null {
  const entries = site?.options.entries ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "kv" && normalizeOptionKey(entry.key) === "pin edge") {
      return entry;
    }
  }
  return null;
}

function resolveAdornmentOptionSite(
  source: string,
  valueSpan: Span
): SourceBackedAdornmentOptionSite | null {
  let cursor = valueSpan.from;
  while (cursor < valueSpan.to && /\s/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  if (source[cursor] === "{") {
    cursor += 1;
    while (cursor < valueSpan.to && /\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  }
  if (source[cursor] !== "[") {
    return null;
  }

  const close = findAdornmentOptionListClose(source, cursor, valueSpan.to);
  if (close == null) {
    return null;
  }
  const span = { from: cursor, to: close + 1 };
  return {
    span,
    options: parseOptionListRaw(source.slice(span.from, span.to), span.from)
  };
}

function findAdornmentOptionListClose(
  source: string,
  open: number,
  limit: number
): number | null {
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = open; index < limit; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "%") {
      while (index < limit && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (braceDepth > 0) {
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        return index;
      }
    }
  }
  return null;
}

function unwrapOptionList(source: string, open: string, close: string): string {
  return source.startsWith(open) && source.endsWith(close)
    ? source.slice(open.length, -close.length)
    : source;
}

function formatPinEdgeOptionValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  return `{${trimmed}}`;
}

function buildPinEdgeMutations(
  key: string,
  value: string,
  clearKeys: readonly string[]
): Map<string, OptionMutation> {
  const mutations = new Map<string, OptionMutation>();
  for (const clearKey of clearKeys) {
    const normalized = normalizeOptionKey(clearKey);
    if (normalized.length > 0) {
      mutations.set(normalized, { kind: "remove" });
    }
  }
  if (key === PIN_EDGE_DASH_PROPERTY_KEY) {
    const normalizedValue = value.trim().toLowerCase();
    const dashKeys = ["solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted", "dash pattern", "dash"];
    for (const dashKey of dashKeys) {
      mutations.set(dashKey, { kind: "remove" });
    }
    if (normalizedValue !== "solid" && normalizedValue.length > 0) {
      mutations.set(normalizedValue, { kind: "set", value: "true" });
    }
    return mutations;
  }

  const targetKey =
    key === PIN_EDGE_DRAW_PROPERTY_KEY ? "draw" :
    key === PIN_EDGE_LINE_WIDTH_PROPERTY_KEY ? "line width" :
    "";
  if (targetKey.length > 0) {
    const trimmedValue = value.trim();
    mutations.set(targetKey, trimmedValue.length === 0 ? { kind: "remove" } : { kind: "set", value });
  }
  return mutations;
}

function emptyOptionListAt(offset: number) {
  return {
    span: { from: offset, to: offset },
    raw: "[]",
    entries: []
  };
}

function formatAdornmentAngle(rawDegrees: number): string {
  let degrees = rawDegrees % 360;
  if (degrees < 0) {
    degrees += 360;
  }
  const keywords = [
    { label: "right", degrees: 0 },
    { label: "above right", degrees: 45 },
    { label: "above", degrees: 90 },
    { label: "above left", degrees: 135 },
    { label: "left", degrees: 180 },
    { label: "below left", degrees: 225 },
    { label: "below", degrees: 270 },
    { label: "below right", degrees: 315 }
  ];
  for (const keyword of keywords) {
    const delta = Math.min(Math.abs(degrees - keyword.degrees), 360 - Math.abs(degrees - keyword.degrees));
    if (delta <= 8) {
      return keyword.label;
    }
  }
  return String(Math.round(degrees));
}

function serializeAdornmentValue(
  kind: "label" | "pin",
  angleRaw: string,
  textRaw: string,
  optionsRaw: string
): string {
  const normalizedText = normalizeAdornmentTextRaw(textRaw.trim().length > 0 ? textRaw : "label");
  const core = `${angleRaw}:${normalizedText}`;
  if (optionsRaw.trim().length === 0) {
    return core;
  }
  return `{[${optionsRaw}]${core}}`;
}

function normalizeAdornmentTextRaw(textRaw: string): string {
  const trimmed = textRaw.trim();
  if (trimmed.length === 0) {
    return "{}";
  }
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || !/[,\]]/.test(trimmed)) {
    return textRaw;
  }
  return `{${trimmed}}`;
}
