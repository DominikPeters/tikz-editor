import { requireArrayValue } from "../../utils/collections.js";
import { coordinateInner } from "./shared.js";
import { parseLengthWithInfo } from "../coords/parse-length.js";

export type ParsedLengthWithTransform = {
  value: number;
  applyFrameTransform: boolean;
};

export function parseCoordinateOperation(raw: string): { name: string } | null {
  const inlineWithAt = raw.match(/coordinate\s*\(([^)]+)\)\s*at\s*(\([^)]+\))/i);
  if (inlineWithAt) {
    return { name: requireArrayValue(inlineWithAt, 1).trim() };
  }

  const simple = raw.match(/coordinate\s*\(([^)]+)\)/i);
  if (!simple) {
    return null;
  }
  return { name: requireArrayValue(simple, 1).trim() };
}

export function parseCircleRadiusFromCoordinateRaw(raw: string): ParsedLengthWithTransform | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  if (inner.includes(",") || inner.includes(":") || /\band\b/i.test(inner)) {
    return null;
  }

  const parsed = parseLengthWithInfo(inner, "cm");
  if (!parsed) {
    return null;
  }

  return {
    value: parsed.value,
    applyFrameTransform: !parsed.hasExplicitUnit
  };
}

export function parseEllipseRadiiFromCoordinateRaw(raw: string): { rx: ParsedLengthWithTransform; ry: ParsedLengthWithTransform } | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const match = inner.match(/^(.+?)\s+and\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const parsedRx = parseLengthWithInfo(requireArrayValue(match, 1).trim(), "cm");
  const parsedRy = parseLengthWithInfo(requireArrayValue(match, 2).trim(), "cm");
  const rx = parsedRx?.value ?? null;
  const ry = parsedRy?.value ?? null;
  if (rx == null || ry == null) {
    return null;
  }

  return {
    rx: { value: rx, applyFrameTransform: !(parsedRx?.hasExplicitUnit ?? false) },
    ry: { value: ry, applyFrameTransform: !(parsedRy?.hasExplicitUnit ?? false) }
  };
}
