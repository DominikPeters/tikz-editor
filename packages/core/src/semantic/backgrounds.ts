import type { Diagnostic } from "../diagnostics/types.js";
import type { OptionListAst } from "../options/types.js";
import { worldBounds, worldPoint, type WorldBounds, type WorldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
import { stripWrappingBraces } from "../utils/braces.js";
import type { SemanticContext, SemanticBackgroundHookKind } from "./context.js";
import { currentFrame, markBackgroundLayerUsed } from "./context.js";
import { parseLength } from "./coords/parse-length.js";
import { makeGridElements, extractGridStepsFromOptionLists } from "./path/grid.js";
import { DEFAULT_GRID_STEP } from "./path/constants.js";
import { makeRectangleElement } from "./path/elements.js";
import { commandDefaultStyle, defaultStyle, parseStyleValueAsOptionList, resolveContextDelta } from "./style/resolve.js";
import { styleDiagnosticCode, styleDiagnosticSpan, type StyleDiagnostic } from "./style/diagnostics.js";
import type { StyleChainEntry, StyleSourceRef } from "./style-chain.js";
import { cloneResolvedStyle, cloneStyleChain, diffResolvedStyle } from "./style-chain.js";
import { identityMatrix } from "./transform.js";
import type { ResolvedStyle, SceneElement, ScenePath } from "./types.js";
import { BACKGROUND_SCENE_LAYER } from "./types.js";
import { resolveContextColorAliasValue } from "./context.js";

export type BackgroundLayerOptionLayer = {
  rawOptions: OptionListAst[];
  sourceRef: StyleSourceRef;
};

const BACKGROUND_HOOK_BY_KEY: Record<string, SemanticBackgroundHookKind> = {
  "show background rectangle": "rectangle",
  "show background grid": "grid",
  "show background top": "top",
  "show background bottom": "bottom",
  "show background left": "left",
  "show background right": "right"
};

const BACKGROUND_STYLE_BY_HOOK: Record<SemanticBackgroundHookKind, string> = {
  rectangle: "background rectangle",
  grid: "background grid",
  top: "background top",
  bottom: "background bottom",
  left: "background left",
  right: "background right"
};

export const BACKGROUND_CONFIG_KEYS = new Set([
  "on background layer",
  "every on background layer",
  "show background rectangle",
  "show background grid",
  "show background top",
  "show background bottom",
  "show background left",
  "show background right",
  "inner frame sep",
  "inner frame xsep",
  "inner frame ysep",
  "outer frame sep",
  "outer frame xsep",
  "outer frame ysep"
]);

export function collectBackgroundOptionEffects(
  context: SemanticContext,
  optionLists: readonly OptionListAst[],
  sourceRef: StyleSourceRef
): boolean {
  let used = false;
  for (const list of optionLists) {
    for (const entry of list.entries) {
      const key = normalizeBackgroundKey(entry.kind === "unknown" ? entry.raw : entry.key);
      if (entry.kind === "flag") {
        const hook = BACKGROUND_HOOK_BY_KEY[key];
        if (hook) {
          registerBackgroundHook(context, hook, deriveEntrySourceRef(sourceRef, entry.span, key));
          used = true;
          continue;
        }
        continue;
      }

      if (entry.kind !== "kv") {
        continue;
      }

      const hook = BACKGROUND_HOOK_BY_KEY[key];
      if (hook) {
        const parsed = parseBackgroundBoolish(entry.valueRaw);
        if (parsed !== false) {
          registerBackgroundHook(context, hook, deriveEntrySourceRef(sourceRef, entry.span, key));
          used = true;
        }
        continue;
      }

      const parsedLength = parseBackgroundLength(entry.valueRaw);
      if (parsedLength == null) {
        continue;
      }

      if (key === "inner frame sep") {
        context.backgroundState.innerFrameXSep = parsedLength;
        context.backgroundState.innerFrameYSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      } else if (key === "inner frame xsep") {
        context.backgroundState.innerFrameXSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      } else if (key === "inner frame ysep") {
        context.backgroundState.innerFrameYSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      } else if (key === "outer frame sep") {
        context.backgroundState.outerFrameXSep = parsedLength;
        context.backgroundState.outerFrameYSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      } else if (key === "outer frame xsep") {
        context.backgroundState.outerFrameXSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      } else if (key === "outer frame ysep") {
        context.backgroundState.outerFrameYSep = parsedLength;
        markBackgroundLayerUsed(context);
        used = true;
      }
    }
  }
  return used;
}

export function extractOnBackgroundLayerOptionLayers(
  optionLists: readonly OptionListAst[],
  sourceRef: StyleSourceRef
): BackgroundLayerOptionLayer[] {
  const layers: BackgroundLayerOptionLayer[] = [];
  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (entry.kind !== "flag" && entry.kind !== "kv") {
        continue;
      }
      const key = normalizeBackgroundKey(entry.key);
      if (key !== "on background layer") {
        continue;
      }
      if (entry.kind === "flag") {
        layers.push({
          rawOptions: [],
          sourceRef: deriveEntrySourceRef(sourceRef, entry.span, key)
        });
        continue;
      }

      const parsed = parseBackgroundBoolish(entry.valueRaw);
      if (parsed === false) {
        continue;
      }
      if (parsed === true) {
        layers.push({
          rawOptions: [],
          sourceRef: deriveEntrySourceRef(sourceRef, entry.span, key)
        });
        continue;
      }

      const valueStart = resolveOptionValueStartOffset(entry);
      const parsedOptions = parseStyleValueAsOptionList(entry.valueRaw, valueStart);
      layers.push({
        rawOptions: parsedOptions ? [parsedOptions] : [],
        sourceRef: deriveEntrySourceRef(sourceRef, entry.span, key)
      });
    }
  }
  return layers;
}

export function makeEveryOnBackgroundLayerOptionLayer(sourceRef: StyleSourceRef): BackgroundLayerOptionLayer {
  const options = parseStyleValueAsOptionList("every on background layer");
  return {
    rawOptions: options ? [options] : [],
    sourceRef: {
      sourceId: sourceRef.sourceId,
      sourceSpan: sourceRef.sourceSpan,
      sourceKind: sourceRef.sourceKind,
      label: "every on background layer"
    }
  };
}

export function generateBackgroundHookElements(
  context: SemanticContext,
  contentBounds: WorldBounds | null,
  sourceFingerprint: string
): { elements: SceneElement[]; diagnostics: Diagnostic[] } {
  const hooks = [...context.backgroundState.hooks].sort((left, right) => left.sequence - right.sequence);
  if (hooks.length === 0 || !contentBounds) {
    return { elements: [], diagnostics: [] };
  }

  const state = context.backgroundState;
  const innerBounds = worldBounds(
    pt(contentBounds.minX - state.innerFrameXSep),
    pt(contentBounds.minY - state.innerFrameYSep),
    pt(contentBounds.maxX + state.innerFrameXSep),
    pt(contentBounds.maxY + state.innerFrameYSep)
  );
  const outerBounds = worldBounds(
    pt(innerBounds.minX - state.outerFrameXSep),
    pt(innerBounds.minY - state.outerFrameYSep),
    pt(innerBounds.maxX + state.outerFrameXSep),
    pt(innerBounds.maxY + state.outerFrameYSep)
  );

  const elements: SceneElement[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const hook of hooks) {
    const resolved = resolveBackgroundHookStyle(context, hook.kind, hook.sourceRef);
    for (const styleDiagnostic of resolved.diagnostics) {
      const code = styleDiagnosticCode(styleDiagnostic);
      diagnostics.push({
        severity: "warning",
        code,
        message: `Background option issue: ${code}`,
        span: styleDiagnosticSpan(styleDiagnostic, hook.sourceRef.sourceSpan ?? { from: 0, to: 0 })
      });
    }

    const sourceId = `background:${hook.kind}:${hook.sequence}`;
    const span = hook.sourceRef.sourceSpan ?? { from: 0, to: 0 };
    if (hook.kind === "rectangle") {
      elements.push(
        withBackgroundLayer(
          makeRectangleElement(
            sourceId,
            "rectangle",
            wp(innerBounds.minX, innerBounds.minY),
            wp(innerBounds.maxX, innerBounds.maxY),
            resolved.style,
            resolved.styleChain,
            span
          ),
          sourceFingerprint
        )
      );
      continue;
    }

    if (hook.kind === "grid") {
      const steps = extractGridStepsFromOptionLists(
        resolved.expandedOptionLists,
        (code, message, from, to) => {
          diagnostics.push({
            severity: code.startsWith("unsupported") ? "warning" : "error",
            code,
            message,
            span: { from, to }
          });
        },
        currentFrame(context).macroBindings,
        identityMatrix()
      );
      const stepX = steps?.stepX ?? DEFAULT_GRID_STEP;
      const stepY = steps?.stepY ?? DEFAULT_GRID_STEP;
      elements.push(
        ...makeGridElements(
          sourceId,
          "grid",
          wp(innerBounds.minX, innerBounds.minY),
          wp(innerBounds.maxX, innerBounds.maxY),
          stepX,
          stepY,
          resolved.style,
          resolved.styleChain,
          span
        ).map((element) => withBackgroundLayer(element, sourceFingerprint))
      );
      continue;
    }

    elements.push(
      withBackgroundLayer(
        makeBackgroundLineElement(
          sourceId,
          hook.kind,
          resolveBackgroundLineFrom(hook.kind, innerBounds, outerBounds),
          resolveBackgroundLineTo(hook.kind, innerBounds, outerBounds),
          resolved.style,
          resolved.styleChain,
          span
        ),
        sourceFingerprint
      )
    );
  }

  return { elements, diagnostics };
}

function registerBackgroundHook(
  context: SemanticContext,
  kind: SemanticBackgroundHookKind,
  sourceRef: StyleSourceRef
): void {
  markBackgroundLayerUsed(context);
  context.backgroundState.hooks.push({
    kind,
    sourceRef,
    sequence: context.backgroundState.nextHookSequence
  });
  context.backgroundState.nextHookSequence += 1;
}

function resolveBackgroundHookStyle(
  context: SemanticContext,
  hook: SemanticBackgroundHookKind,
  sourceRef: StyleSourceRef
): {
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  expandedOptionLists: OptionListAst[];
  diagnostics: StyleDiagnostic[];
} {
  const resetStyle = defaultStyle();
  const baseStyle = { ...resetStyle, ...commandDefaultStyle("path", resetStyle) };
  const commandEntry: StyleChainEntry = {
    kind: "command",
    sourceRef: {
      sourceId: sourceRef.sourceId,
      sourceSpan: sourceRef.sourceSpan,
      sourceKind: "background-command-default",
      label: "path"
    },
    rawOptions: [],
    before: cloneResolvedStyle(resetStyle),
    after: cloneResolvedStyle(baseStyle),
    resolvedContributions: diffResolvedStyle(resetStyle, baseStyle)
  };
  const styleName = BACKGROUND_STYLE_BY_HOOK[hook];
  const options = parseStyleValueAsOptionList(styleName);
  const resolved = resolveContextDelta(
    baseStyle,
    identityMatrix(),
    [
      {
        kind: "scope",
        sourceRef: {
          sourceId: sourceRef.sourceId,
          sourceSpan: sourceRef.sourceSpan,
          sourceKind: "background-hook",
          label: styleName
        },
        rawOptions: options ? [options] : []
      }
    ],
    currentFrame(context).customStyles,
    undefined,
    [commandEntry],
    (raw) => resolveContextColorAliasValue(context, raw)
  );

  return {
    style: resolved.style,
    styleChain: resolved.chain,
    expandedOptionLists: resolved.expandedOptionLists,
    diagnostics: resolved.diagnostics
  };
}

function makeBackgroundLineElement(
  sourceId: string,
  itemId: string,
  from: WorldPoint,
  to: WorldPoint,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number }
): ScenePath {
  return {
    kind: "Path",
    id: `scene-background-${itemId}:${sourceId}`,
    runtimeId: `scene-background-${itemId}:${sourceId}`,
    layer: BACKGROUND_SCENE_LAYER,
    sourceRef: {
      sourceId,
      sourceSpan: span,
      sourceFingerprint: ""
    },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    commands: [
      { kind: "M", to: from },
      { kind: "L", to }
    ]
  };
}

function withBackgroundLayer<T extends SceneElement>(element: T, sourceFingerprint: string): T {
  return {
    ...element,
    layer: BACKGROUND_SCENE_LAYER,
    runtimeId: element.runtimeId ?? element.id,
    sourceRef: {
      ...element.sourceRef,
      sourceFingerprint
    }
  };
}

function resolveBackgroundLineFrom(
  kind: Exclude<SemanticBackgroundHookKind, "rectangle" | "grid">,
  inner: WorldBounds,
  outer: WorldBounds
): WorldPoint {
  switch (kind) {
    case "top":
      return wp(outer.minX, inner.maxY);
    case "bottom":
      return wp(outer.minX, inner.minY);
    case "left":
      return wp(inner.minX, outer.minY);
    case "right":
      return wp(inner.maxX, outer.minY);
  }
}

function resolveBackgroundLineTo(
  kind: Exclude<SemanticBackgroundHookKind, "rectangle" | "grid">,
  inner: WorldBounds,
  outer: WorldBounds
): WorldPoint {
  switch (kind) {
    case "top":
      return wp(outer.maxX, inner.maxY);
    case "bottom":
      return wp(outer.maxX, inner.minY);
    case "left":
      return wp(inner.minX, outer.maxY);
    case "right":
      return wp(inner.maxX, outer.maxY);
  }
}

function parseBackgroundLength(raw: string): number | null {
  const parsed = parseLength(stripWrappingBraces(raw), "pt");
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
}

function parseBackgroundBoolish(raw: string): boolean | null {
  return parseBooleanishNormalized(stripWrappingBraces(raw));
}

function normalizeBackgroundKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\/tikz\//, "").replace(/\s+/g, " ");
}

function deriveEntrySourceRef(
  sourceRef: StyleSourceRef,
  span: { from: number; to: number },
  label: string
): StyleSourceRef {
  return {
    sourceId: sourceRef.sourceId,
    sourceSpan: span,
    sourceKind: sourceRef.sourceKind,
    label
  };
}

function resolveOptionValueStartOffset(entry: Extract<OptionListAst["entries"][number], { kind: "kv" }>): number {
  const relative = entry.raw.indexOf(entry.valueRaw);
  if (relative >= 0) {
    return entry.span.from + relative;
  }
  return entry.span.from;
}

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}
