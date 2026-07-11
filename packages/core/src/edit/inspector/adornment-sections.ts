import {
  ADORNMENT_ANGLE_PROPERTY_KEY,
  ADORNMENT_DISTANCE_PROPERTY_KEY,
  ADORNMENT_TEXT_PROPERTY_KEY,
  PIN_EDGE_DRAW_PROPERTY_KEY,
  PIN_EDGE_LINE_WIDTH_PROPERTY_KEY
} from "../adornment-keys.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { parseStyleValueAsOptionList, stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import type { PropertyTarget } from "../property-target.js";
import {
  colorOptionsForValue,
  normalizeInspectorColorValue,
  resolveColorSyntaxValue
} from "./color-syntax.js";
import type { DashStylePresetId } from "./presets.js";
import type { InspectorSection } from "./types.js";
import type { InspectorSectionBuildContext } from "./section-builder.js";

export function buildAdornmentSections(context: InspectorSectionBuildContext): InspectorSection[] | null {
  if (context.resolvedTarget?.kind !== "found" || context.resolvedTarget.target.kind !== "node-adornment") {
    return null;
  }

  const state = resolveAdornmentInspectorState(context, context.resolvedTarget.target);
  const textColor = normalizeInspectorColorValue(context.element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["text", "color"],
    textColor,
    context.colorAliases,
    context.element.styleChain
  );
  const strokeColor = normalizeInspectorColorValue(context.element.style.stroke);
  const strokeColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["draw", "color"],
    strokeColor,
    context.colorAliases,
    context.element.styleChain
  );
  const fillColor = normalizeInspectorColorValue(context.element.style.fill);
  const fillColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["fill", "color"],
    fillColor,
    context.colorAliases,
    context.element.styleChain
  );
  const sections: InspectorSection[] = [
    {
      id: "adornment",
      title: state.kind === "pin" ? "Pin" : "Label",
      sourceLevel: "command",
      properties: [
        {
          kind: "text",
          id: "adornment-text",
          label: "Text",
          value: state.text,
          write: context.writeProperty(ADORNMENT_TEXT_PROPERTY_KEY)
        },
        {
          kind: "number",
          id: "adornment-angle",
          label: "Angle",
          value: state.angleDeg,
          step: 1,
          unit: "deg",
          write: context.writeProperty(ADORNMENT_ANGLE_PROPERTY_KEY)
        },
        {
          kind: "length",
          id: "adornment-distance",
          label: state.kind === "pin" ? "Pin distance" : "Label distance",
          value: state.distancePt,
          step: 0.1,
          unit: "pt",
          write: context.writeProperty(ADORNMENT_DISTANCE_PROPERTY_KEY)
        },
        {
          kind: "color",
          id: "adornment-text-color",
          label: "Text color",
          value: textColor,
          syntaxValue: textColorSyntax,
          options: colorOptionsForValue(textColor),
          write: context.writeProperty("text")
        },
        {
          kind: "color",
          id: "adornment-draw-color",
          label: "Draw",
          value: strokeColor,
          syntaxValue: strokeColorSyntax,
          options: colorOptionsForValue(strokeColor),
          write: context.writeProperty("draw")
        },
        {
          kind: "color",
          id: "adornment-fill-color",
          label: "Fill",
          value: fillColor,
          syntaxValue: fillColorSyntax,
          options: colorOptionsForValue(fillColor),
          write: context.writeProperty("fill")
        }
      ]
    }
  ];

  if (state.kind === "pin") {
    sections.push({
      id: "pin-edge",
      title: "Pin Edge",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "pin-edge-color",
          label: "Color",
          value: state.pinEdge.draw,
          syntaxValue: state.pinEdge.draw,
          options: colorOptionsForValue(state.pinEdge.draw),
          write: context.writeProperty(PIN_EDGE_DRAW_PROPERTY_KEY)
        },
        {
          kind: "length",
          id: "pin-edge-line-width",
          label: "Line width",
          value: state.pinEdge.lineWidthPt,
          step: 0.1,
          unit: "pt",
          write: context.writeProperty(PIN_EDGE_LINE_WIDTH_PROPERTY_KEY)
        }
      ]
    });
  }

  return sections;
}

function resolveAdornmentInspectorState(context: InspectorSectionBuildContext, target: PropertyTarget): {
  kind: "label" | "pin";
  text: string;
  angleDeg: number;
  distancePt: number;
  distanceExplicit: boolean;
  pinEdge: {
    draw: string | null;
    lineWidthPt: number;
    dashStyle: DashStylePresetId;
  };
} {
  if (target.kind !== "node-adornment") {
    throw new Error("Adornment section builder requires a resolved node-adornment target.");
  }
  const pinEdge = resolvePinEdgeInspectorState(target.pinEdgeRaw ?? null);
  return {
    kind: target.adornmentKind ?? "label",
    text: target.textSpan
      ? stripEnclosingBraces(context.source.slice(target.textSpan.from, target.textSpan.to))
      : "",
    angleDeg: parseAdornmentAngleForInspector(target.angleRaw ?? "center"),
    distancePt: target.distancePt ?? target.defaultDistancePt ?? 0,
    distanceExplicit: target.distanceExplicit ?? false,
    pinEdge: {
      draw: pinEdge.draw,
      lineWidthPt: pinEdge.lineWidthPt ?? context.element.style.lineWidth,
      dashStyle: pinEdge.dashStyle
    }
  };
}

function parseAdornmentAngleForInspector(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  const keyword =
    normalized === "center" || normalized === "centered" ? 0 :
    normalized === "right" || normalized === "east" ? 0 :
    normalized === "above right" || normalized === "north east" ? 45 :
    normalized === "above" || normalized === "north" ? 90 :
    normalized === "above left" || normalized === "north west" ? 135 :
    normalized === "left" || normalized === "west" ? 180 :
    normalized === "below left" || normalized === "south west" ? -135 :
    normalized === "below" || normalized === "south" ? -90 :
    normalized === "below right" || normalized === "south east" ? -45 :
    null;
  if (keyword != null) return keyword;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePinEdgeInspectorState(pinEdgeRaw: string | null): {
  draw: string | null;
  lineWidthPt: number | null;
  dashStyle: DashStylePresetId;
} {
  const options = pinEdgeRaw ? parseStyleValueAsOptionList(pinEdgeRaw) : null;
  let draw: string | null = null;
  let lineWidthPt: number | null = null;
  let dashStyle: DashStylePresetId = "solid";

  for (const entry of options?.entries ?? []) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (isDashStyle(key)) dashStyle = key;
      else if (isLikelyColorValue(entry.key)) draw = entry.key.trim();
      continue;
    }
    if (entry.kind !== "kv") continue;
    const key = normalizeOptionKey(entry.key);
    if (key === "draw" || key === "color") {
      draw = entry.valueRaw.trim() || null;
    } else if (key === "line width") {
      lineWidthPt = parseLength(entry.valueRaw, "pt");
    } else if (isDashStyle(key)) {
      dashStyle = key;
    }
  }
  return { draw, lineWidthPt, dashStyle };
}

function isDashStyle(value: string): value is DashStylePresetId {
  return value === "solid" || value === "dashed" || value === "densely dashed" || value === "loosely dashed" ||
    value === "dotted" || value === "densely dotted" || value === "loosely dotted";
}

function isLikelyColorValue(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 && (
    trimmed === "none" ||
    /^[a-z][a-z0-9._:@!-]*$/i.test(trimmed) ||
    /^#[0-9a-f]{3,8}$/i.test(trimmed)
  );
}
