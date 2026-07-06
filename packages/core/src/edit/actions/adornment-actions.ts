import type { EditActionResultLike } from "../result-types.js";
import type { WorldPoint } from "../../coords/points.js";
import { extractNodeAdornmentPlan } from "../../semantic/path/label-quotes.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import { applyAdornmentValueRewrite } from "./adornment-set-property.js";
import type { EditParseOptions } from "../parse-options.js";
import type { DragFormatPrecision } from "../format.js";


export type MoveAdornmentAction = {
  targetId: string;
  ownerPoint: WorldPoint;
  newWorld: WorldPoint;
  angleRaw?: string;
  distancePt?: number;
  formatPrecision?: DragFormatPrecision;
};

export type AddNodeAdornmentAction = {
  nodeId: string;
  adornmentKind: "label" | "pin";
  angle: string;
  text: string;
};

export function applyDuplicateAdornmentAction(
  source: string,
  targetId: string,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-adornment" || !resolved.target.optionSpan) {
    return { kind: "unsupported", reason: "Selected adornment could not be resolved for duplication." };
  }

  const snippet = source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to);
  const insertion = replaceSpan(
    source,
    { from: resolved.target.optionSpan.to, to: resolved.target.optionSpan.to },
    `, ${snippet}`
  );
  return {
    kind: "success",
    newSource: insertion.source,
    patches: [
      {
        oldSpan: { from: resolved.target.optionSpan.to, to: resolved.target.optionSpan.to },
        newSpan: insertion.changedSpan,
        replacement: `, ${snippet}`
      }
    ],
    selectedSourceIds: [targetId],
    changedSourceIds: [resolved.target.ownerSourceId!]
  };
}

export function applyMoveAdornmentAction(
  source: string,
  action: MoveAdornmentAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, action.targetId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-adornment" || !resolved.target.valueSpan) {
    return { kind: "unsupported", reason: "Selected adornment could not be resolved for drag editing." };
  }

  return applyAdornmentValueRewrite(
    source,
    resolved.target,
    resolveAdornmentMoveOverrides(action),
    action.targetId,
    undefined,
    undefined,
    action.formatPrecision
  );
}

export function applyAddNodeAdornmentAction(
  source: string,
  action: AddNodeAdornmentAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, action.nodeId, parseOptions);
  if (resolved.kind !== "found") {
    return { kind: "unsupported", reason: "Selected node could not be resolved for adding an adornment." };
  }
  if (resolved.target.kind !== "node-item") {
    return { kind: "unsupported", reason: "Selected target is not a node that can receive an adornment." };
  }

  const key = action.adornmentKind;
  const value = `${action.angle}:${action.text}`;
  const snippet = `${key}=${value}`;
  const insertionOffset = resolved.target.optionsSpan
    ? resolveOptionListAppendOffset(source, resolved.target.optionsSpan)
    : resolved.target.insertOffset;
  const insertionText = resolved.target.optionsSpan ? `, ${snippet}` : `[${snippet}]`;
  const updated = replaceSpan(source, { from: insertionOffset, to: insertionOffset }, insertionText);
  const adornmentIndex = extractNodeAdornmentPlan(resolved.target.options).adornments.length;
  const adornmentTargetId = `node-adornment:${action.nodeId}:${action.adornmentKind}:${adornmentIndex}`;
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: { from: insertionOffset, to: insertionOffset },
        newSpan: updated.changedSpan,
        replacement: insertionText
      }
    ],
    selectedSourceIds: [adornmentTargetId],
    changedSourceIds: [action.nodeId]
  };
}

function resolveAdornmentMoveOverrides(action: MoveAdornmentAction): {
  angleRaw: string;
  distancePt: number;
} {
  if (typeof action.angleRaw === "string" && typeof action.distancePt === "number") {
    return {
      angleRaw: action.angleRaw,
      distancePt: action.distancePt
    };
  }

  const dx = action.newWorld.x - action.ownerPoint.x;
  const dy = action.newWorld.y - action.ownerPoint.y;
  const radius = Math.sqrt(dx * dx + dy * dy);
  return {
    angleRaw: radius <= 1e-3 ? "center" : formatAdornmentAngle((Math.atan2(dy, dx) * 180) / Math.PI),
    distancePt: radius
  };
}

function resolveOptionListAppendOffset(source: string, span: { from: number; to: number }): number {
  let cursor = span.to;
  while (cursor > span.from && /\s/u.test(source[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  return cursor - 1;
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
