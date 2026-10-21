import type { PathOptionItem } from "../../ast/types.js";
import { parseLength, parseLengthWithInfo } from "../coords/parse-length.js";
import type { MacroBinding, MacroExpansionTraceEvent } from "../../macros/index.js";
import type { DiagnosticPushFn } from "./types.js";
import { expandPathMacroBindings } from "./macro-expansion.js";

type ParsedLengthWithTransform = {
  value: number;
  applyFrameTransform: boolean;
};

export function extractEllipseRadii(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  macroBindings?: ReadonlyMap<string, MacroBinding>,
  macroTraceCollector?: MacroExpansionTraceEvent[]
): { rx: ParsedLengthWithTransform; ry: ParsedLengthWithTransform } | null {
  let rx: ParsedLengthWithTransform | null = null;
  let ry: ParsedLengthWithTransform | null = null;
  let radius: ParsedLengthWithTransform | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        rx = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        ry = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    } else if (entry.key === "radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        radius = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    }
  }

  if (radius != null) {
    return { rx: radius, ry: radius };
  }

  if (rx != null && ry != null) {
    return { rx, ry };
  }

  if (rx == null && ry == null) {
    return null;
  }

  pushDiagnostic("invalid-ellipse-radii", "Ellipse requires both x radius and y radius.", item.span.from, item.span.to);
  return null;
}

export function extractCircleShapeOptions(
  item: PathOptionItem,
  macroBindings?: ReadonlyMap<string, MacroBinding>,
  macroTraceCollector?: MacroExpansionTraceEvent[]
): {
  radius?: ParsedLengthWithTransform;
  rx?: ParsedLengthWithTransform;
  ry?: ParsedLengthWithTransform;
  rotation?: number;
} {
  let radius: ParsedLengthWithTransform | undefined;
  let rx: ParsedLengthWithTransform | undefined;
  let ry: ParsedLengthWithTransform | undefined;
  let rotation: number | undefined;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        radius = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    } else if (entry.key === "x radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        rx = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLengthWithInfo(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        ry = { value: parsed.value, applyFrameTransform: !parsed.hasExplicitUnit };
      }
    } else if (entry.key === "rotate") {
      const parsed = Number(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector));
      if (Number.isFinite(parsed)) {
        rotation = parsed;
      }
    }
  }

  return { ...(radius === undefined ? {} : { radius: radius }), ...(rx === undefined ? {} : { rx: rx }), ...(ry === undefined ? {} : { ry: ry }), ...(rotation === undefined ? {} : { rotation: rotation }) };
}

export function extractRoundedCorners(options: PathOptionItem["options"], current: number | null): number | null | undefined {
  let next = current;
  let changed = false;

  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "sharp corners") {
      next = null;
      changed = true;
      continue;
    }
    if (entry.kind === "flag" && entry.key === "rounded corners") {
      next = parseLength("4pt", "pt") ?? 4;
      changed = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rounded corners") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        next = parsed;
        changed = true;
      }
    }
  }

  return changed ? next : undefined;
}
