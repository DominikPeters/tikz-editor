import type { AxisBasis } from "./coords/axis-basis.js";
import type { WorldTransform } from "../coords/transforms.js";
import type { Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import type { GeneratedSourceRef, ResolvedStyle } from "./types.js";
import type { StyleDiagnostic } from "./style/diagnostics.js";

export type StyleChainKind = "global" | "named-style" | "every-node" | "every-shape" | "scope" | "command";

export type StyleSourceRef = {
  sourceId: string;
  sourceSpan?: Span;
  sourceKind: string;
  label?: string;
  identityRef?: GeneratedSourceRef;
};

type StyleChainEntryBase = {
  kind: StyleChainKind;
  sourceRef?: StyleSourceRef;
  rawOptions: OptionListAst[];
  before: ResolvedStyle;
  after: ResolvedStyle;
  resolvedContributions: Partial<ResolvedStyle>;
};

export type StyleChainEntry =
  | (StyleChainEntryBase & {
      kind: "global" | "every-node" | "scope" | "command";
    })
  | (StyleChainEntryBase & {
      kind: "named-style";
      styleName: string;
    })
  | (StyleChainEntryBase & {
      kind: "every-shape";
      shape: string;
    });

export type StyleTraceLayerInput =
  | {
      kind: "global" | "every-node" | "scope" | "command";
      sourceRef?: StyleSourceRef;
      rawOptions: OptionListAst[];
    }
  | {
      kind: "named-style";
      sourceRef?: StyleSourceRef;
      styleName: string;
      rawOptions: OptionListAst[];
    }
  | {
      kind: "every-shape";
      sourceRef?: StyleSourceRef;
      shape: string;
      rawOptions: OptionListAst[];
    };

export type ResolvedStyleTrace = {
  axisBasis: AxisBasis;
  style: ResolvedStyle;
  transform: WorldTransform;
  diagnostics: StyleDiagnostic[];
  expandedOptionLists: OptionListAst[];
  chain: StyleChainEntry[];
};

export function cloneStyleSourceRef(sourceRef: StyleSourceRef | undefined): StyleSourceRef | undefined {
  if (!sourceRef) {
    return undefined;
  }
  const identityRef = sourceRef.identityRef;
  return {
    sourceId: sourceRef.sourceId,
    ...(sourceRef.sourceSpan === undefined ? {} : { sourceSpan: { ...sourceRef.sourceSpan } }),
    sourceKind: sourceRef.sourceKind,
    ...(sourceRef.label === undefined ? {} : { label: sourceRef.label }),
    ...(identityRef === undefined ? {} : { identityRef: {
      sourceId: identityRef.sourceId,
      ...(identityRef.sourceSpan === undefined ? {} : { sourceSpan: { ...identityRef.sourceSpan } }),
      ...(identityRef.sourceKind === undefined ? {} : { sourceKind: identityRef.sourceKind })
    } })
  };
}

export function cloneStyleChain(chain: StyleChainEntry[]): StyleChainEntry[] {
  // Keep array isolation so callers can append safely, while sharing immutable entries.
  return chain.slice();
}

export function cloneStyleChainEntry(entry: StyleChainEntry): StyleChainEntry {
  if (entry.kind === "named-style") {
    return {
      ...cloneStyleChainEntryBase(entry),
      kind: "named-style",
      styleName: entry.styleName
    };
  }
  if (entry.kind === "every-shape") {
    return {
      ...cloneStyleChainEntryBase(entry),
      kind: "every-shape",
      shape: entry.shape
    };
  }
  return {
    ...cloneStyleChainEntryBase(entry),
    kind: entry.kind
  };
}

function cloneStyleChainEntryBase(entry: StyleChainEntryBase): StyleChainEntryBase {
  const optionalSourceRef3 = cloneStyleSourceRef(entry.sourceRef);
  return {
    kind: entry.kind,
    ...(optionalSourceRef3 === undefined ? {} : { sourceRef: optionalSourceRef3 }),
    // Copy only the outer list; option AST nodes are treated as immutable.
    rawOptions: entry.rawOptions.slice(),
    before: cloneResolvedStyle(entry.before),
    after: cloneResolvedStyle(entry.after),
    resolvedContributions: cloneResolvedStyleContributions(entry.resolvedContributions)
  };
}

const STYLE_PROPERTY_KEYS: { [K in keyof ResolvedStyle]: K } = {
  stroke: "stroke",
  fill: "fill",
  fillPattern: "fillPattern",
  patternColor: "patternColor",
  fillRule: "fillRule",
  clip: "clip",
  useAsBoundingBox: "useAsBoundingBox",
  overlay: "overlay",
  textColor: "textColor",
  textOpacity: "textOpacity",
  fontSize: "fontSize",
  fontStyle: "fontStyle",
  fontWeight: "fontWeight",
  fontFamily: "fontFamily",
  doubleStroke: "doubleStroke",
  doubleDistance: "doubleDistance",
  doubleLineCenterDistance: "doubleLineCenterDistance",
  doubleColor: "doubleColor",
  textAlign: "textAlign",
  drawExplicit: "drawExplicit",
  radius: "radius",
  radiusUsesBasis: "radiusUsesBasis",
  xRadiusUsesBasis: "xRadiusUsesBasis",
  yRadiusUsesBasis: "yRadiusUsesBasis",
  xRadius: "xRadius",
  yRadius: "yRadius",
  roundedCorners: "roundedCorners",
  lineWidth: "lineWidth",
  dashArray: "dashArray",
  dashOffset: "dashOffset",
  lineCap: "lineCap",
  lineJoin: "lineJoin",
  shortenStart: "shortenStart",
  shortenEnd: "shortenEnd",
  markerStart: "markerStart",
  markerEnd: "markerEnd",
  arrowShorthandStart: "arrowShorthandStart",
  arrowShorthandEnd: "arrowShorthandEnd",
  tipsMode: "tipsMode",
  opacity: "opacity",
  strokeOpacity: "strokeOpacity",
  fillOpacity: "fillOpacity",
  shadeEnabled: "shadeEnabled",
  shading: "shading",
  shadingAngle: "shadingAngle",
  axisTopColor: "axisTopColor",
  axisMiddleColor: "axisMiddleColor",
  axisBottomColor: "axisBottomColor",
  radialInnerColor: "radialInnerColor",
  radialOuterColor: "radialOuterColor",
  ballColor: "ballColor",
  bilinearLowerLeft: "bilinearLowerLeft",
  bilinearLowerRight: "bilinearLowerRight",
  bilinearUpperLeft: "bilinearUpperLeft",
  bilinearUpperRight: "bilinearUpperRight",
  shadowScale: "shadowScale",
  shadowXShift: "shadowXShift",
  shadowYShift: "shadowYShift",
  shadowFade: "shadowFade",
  everyShadowStyles: "everyShadowStyles",
  shadowLayers: "shadowLayers",
  decoration: "decoration",
  decorationPreActions: "decorationPreActions",
  decorationPostActions: "decorationPostActions",
};

export const RESOLVED_STYLE_KEYS: readonly (keyof ResolvedStyle)[] = Object.values(STYLE_PROPERTY_KEYS);

function setStyleValue<K extends keyof ResolvedStyle>(target: Partial<ResolvedStyle>, key: K, value: ResolvedStyle[K]): void {
  target[key] = value;
}

function cloneResolvedStyleContributions(contributions: Partial<ResolvedStyle>): Partial<ResolvedStyle> {
  const cloned: Partial<ResolvedStyle> = {};
  for (const key of RESOLVED_STYLE_KEYS) {
    const value = contributions[key];
    if (value !== undefined) {
      setStyleValue(cloned, key, value);
    }
  }
  return cloned;
}

export function cloneResolvedStyle(style: ResolvedStyle): ResolvedStyle {
  // Resolved styles are immutable snapshots; sharing avoids repeated deep-clone churn.
  return style;
}

export function diffResolvedStyle(before: ResolvedStyle, after: ResolvedStyle): Partial<ResolvedStyle> {
  const diff: Partial<ResolvedStyle> = {};
  for (const key of RESOLVED_STYLE_KEYS) {
    const nextValue = after[key];
    if (nextValue !== undefined && !resolvedStyleValueEquals(before[key], nextValue)) {
      setStyleValue(diff, key, nextValue);
    }
  }
  return diff;
}

export function resolvedStyleValueEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!resolvedStyleValueEquals(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!(key in right)) {
        return false;
      }
      if (!resolvedStyleValueEquals(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
