import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { Span } from "../../ast/types.js";
import type { WorldPoint } from "../../coords/points.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { ResolvedStyle } from "../types.js";
import {
  cloneResolvedStyle,
  cloneStyleChain,
  cloneStyleSourceRef,
  diffResolvedStyle,
  type ResolvedStyleTrace,
  type StyleChainEntry,
  type StyleSourceRef,
  type StyleTraceLayerInput
} from "../style-chain.js";
import { parseArrowSpecification } from "./arrows.js";
import { applyFlagEntry } from "./apply-flag.js";
import type { ApplyOutcome } from "./apply-types.js";
import { applyKvEntry } from "./apply-kv.js";
import type { ColorAliasResolver } from "./colors.js";
import type { CustomStyleRegistry } from "./custom-styles.js";
import {
  normalizeStyleDiagnostic,
  styleDiagnosticCode,
  type StyleDiagnostic,
  type StyleDiagnosticInput
} from "./diagnostics.js";
import {
  applyCustomStyleDefinition,
  parseCustomStyleDefinition,
  resolveCustomStyleInvocation
} from "./custom-styles.js";
import { commandDefaultStyle, defaultStyle, DEFAULT_TEXT_FONT_SIZE } from "./defaults.js";
import { extractCircleRadius } from "./extract-circle-radius.js";
import { parseStyleValueAsOptionList } from "./option-utils.js";

export type ResolvedContextDelta = ResolvedStyleTrace;

export type CoordinateResolver = (raw: string) => WorldPoint | null;

export function resolveContextDelta(
  baseStyle: ResolvedStyle,
  baseTransform: WorldTransform,
  optionLayers: StyleTraceLayerInput[],
  customStyles: CustomStyleRegistry = new Map(),
  resolveCoordinate?: CoordinateResolver,
  baseChain: StyleChainEntry[] = [],
  resolveColorAliasValue?: ColorAliasResolver
): ResolvedContextDelta {
  const diagnostics: StyleDiagnostic[] = [];
  let style = cloneResolvedStyle(baseStyle);
  let transform = baseTransform;
  const chain = cloneStyleChain(baseChain);
  const expandedEntries: OptionEntry[] = [];
  const resolveColorAlias = resolveColorAliasValue;

  const topLevelLayers = optionLayers;
  const topLevelOptionLists = topLevelLayers.flatMap((layer) => layer.rawOptions);

  const applyLayer = (layer: StyleTraceLayerInput, activeStyles: Set<string>): void => {
    const beforeStyle = cloneResolvedStyle(style);
    const layerExpandedEntries: OptionEntry[] = [];
    const rawOptions = layer.rawOptions;

    for (const optionList of rawOptions) {
      for (const entry of optionList.entries) {
        applyEntry(entry, layer.sourceRef, activeStyles, layerExpandedEntries);
      }
    }

    const afterStyle = cloneResolvedStyle(style);
    const entry = makeStyleChainEntry(layer, beforeStyle, afterStyle);
    chain.push(entry);
    expandedEntries.push(...layerExpandedEntries);
  };

  const applyEntry = (
    entry: OptionEntry,
    layerSourceRef: StyleSourceRef | undefined,
    activeStyles: Set<string>,
    layerExpandedEntries: OptionEntry[]
  ): void => {
    if (entry.kind === "kv") {
      const definition = parseCustomStyleDefinition(entry.key);
      if (definition) {
        const valueStart = resolveValueStartOffset(entry);
        const nested = parseStyleValueAsOptionList(entry.valueRaw, valueStart);
        if (!nested) {
          diagnostics.push({
            code: `invalid-style-value:${entry.valueRaw}`,
            span: entry.valueSpan ?? entry.span
          });
          return;
        }
        applyCustomStyleDefinition(
          customStyles,
          definition.name,
          definition.kind,
          nested,
          deriveStyleSourceRef(layerSourceRef, entry.span, definition.name)
        );
        return;
      }
    }

    const invocation = resolveCustomStyleInvocation(entry, customStyles);
    if (invocation) {
      if (activeStyles.has(invocation.name)) {
        diagnostics.push({
          code: `custom-style-recursion:${invocation.name}`,
          span: entry.kind === "unknown" ? entry.span : entry.keySpan ?? entry.span
        });
        return;
      }

      const nextActive = new Set(activeStyles);
      nextActive.add(invocation.name);
      for (const nestedLayer of invocation.layers) {
        applyLayer(
          {
            kind: "named-style",
            styleName: invocation.name,
            sourceRef: cloneStyleSourceRef(nestedLayer.sourceRef),
            rawOptions: [nestedLayer.options]
          },
          nextActive
        );
      }
      return;
    }

    layerExpandedEntries.push(entry);
    const outcome = applyOptionEntry(entry, style, transform, resolveCoordinate, resolveColorAlias);
    style = outcome.style;
    transform = outcome.transform;
    diagnostics.push(
      ...outcome.diagnostics.map((diagnostic) =>
        normalizeStyleDiagnostic(diagnostic, diagnosticFallbackSpanForEntry(entry, styleDiagnosticCode(diagnostic)))
      )
    );
  };

  for (const layer of topLevelLayers) {
    applyLayer(layer, new Set());
  }

  return {
    style,
    transform,
    diagnostics,
    expandedOptionLists: buildExpandedOptionLists(topLevelOptionLists, expandedEntries),
    chain
  };
}

function makeStyleChainEntry(
  layer: StyleTraceLayerInput,
  beforeStyle: ResolvedStyle,
  afterStyle: ResolvedStyle
): StyleChainEntry {
  const baseEntry = {
    kind: layer.kind,
    sourceRef: cloneStyleSourceRef(layer.sourceRef),
    rawOptions: layer.rawOptions,
    before: beforeStyle,
    after: afterStyle,
    resolvedContributions: diffResolvedStyle(beforeStyle, afterStyle)
  } as const;

  if (layer.kind === "named-style") {
    return {
      ...baseEntry,
      kind: "named-style",
      styleName: layer.styleName
    };
  }

  if (layer.kind === "every-shape") {
    return {
      ...baseEntry,
      kind: "every-shape",
      shape: layer.shape
    };
  }

  return {
    ...baseEntry,
    kind: layer.kind
  };
}

function resolveValueStartOffset(entry: Extract<OptionEntry, { kind: "kv" }>): number {
  const rawIndex = entry.raw.indexOf(entry.valueRaw);
  if (rawIndex >= 0) {
    return entry.span.from + rawIndex;
  }
  return entry.span.from;
}

function deriveStyleSourceRef(
  layerSourceRef: StyleSourceRef | undefined,
  entrySpan: { from: number; to: number },
  label: string
): StyleSourceRef {
  return {
    sourceId: layerSourceRef?.sourceId ?? "__unknown__",
    sourceSpan: {
      from: entrySpan.from,
      to: entrySpan.to
    },
    sourceKind: layerSourceRef?.sourceKind ?? "custom-style-definition",
    label
  };
}

function applyOptionEntry(
  entry: OptionEntry,
  style: ResolvedStyle,
  transform: WorldTransform,
  resolveCoordinate?: CoordinateResolver,
  resolveColorAlias?: ColorAliasResolver
): ApplyOutcome {
  if (entry.kind === "unknown") {
    const parsedArrow = parseArrowSpecification(entry.raw, style);
    if (parsedArrow) {
      return { style: { ...style, markerStart: parsedArrow.start, markerEnd: parsedArrow.end }, transform, diagnostics: [] };
    }
    return { style, transform, diagnostics: [] };
  }

  if (entry.kind === "flag") {
    if (entry.key === "every shadow") {
      let nextStyle = style;
      let nextTransform = transform;
      const diagnostics: StyleDiagnosticInput[] = [];
      for (const list of style.everyShadowStyles) {
        for (const nestedEntry of list.entries) {
          const outcome = applyOptionEntry(nestedEntry, nextStyle, nextTransform, resolveCoordinate, resolveColorAlias);
          nextStyle = outcome.style;
          nextTransform = outcome.transform;
          diagnostics.push(...outcome.diagnostics);
        }
      }
      return { style: nextStyle, transform: nextTransform, diagnostics };
    }

    if (
      entry.key === "general shadow" ||
      entry.key === "drop shadow" ||
      entry.key === "copy shadow" ||
      entry.key === "double copy shadow" ||
      entry.key === "circular drop shadow" ||
      entry.key === "circular glow"
    ) {
      return withEntryDiagnosticSpans(
        applyKvEntry(entry.key, "", style, transform, applyOptionEntry, resolveCoordinate, resolveColorAlias),
        entry
      );
    }

    return withEntryDiagnosticSpans(applyFlagEntry(entry.key, entry.raw, style, transform, resolveColorAlias), entry);
  }

  return withEntryDiagnosticSpans(
    applyKvEntry(entry.key, entry.valueRaw, style, transform, applyOptionEntry, resolveCoordinate, resolveColorAlias),
    entry
  );
}

function withEntryDiagnosticSpans(outcome: ApplyOutcome, entry: OptionEntry): ApplyOutcome {
  return {
    ...outcome,
    diagnostics: outcome.diagnostics.map((diagnostic) =>
      normalizeStyleDiagnostic(diagnostic, diagnosticFallbackSpanForEntry(entry, styleDiagnosticCode(diagnostic)))
    )
  };
}

function diagnosticFallbackSpanForEntry(entry: OptionEntry, code: string): Span {
  if (entry.kind === "unknown") {
    return entry.span;
  }
  if (code.startsWith("unsupported-option-key:") || code.startsWith("unsupported-option-flag:")) {
    return entry.keySpan ?? entry.span;
  }
  if (entry.kind === "kv" && entry.valueSpan) {
    return entry.valueSpan;
  }
  return entry.keySpan ?? entry.span;
}

function buildExpandedOptionLists(optionLists: OptionListAst[], entries: OptionEntry[]): OptionListAst[] {
  if (entries.length === 0) {
    return [];
  }

  const spanFrom = optionLists.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = optionLists.reduce((max, list) => Math.max(max, list.span.to), 0);
  return [
    {
      span: {
        from: Number.isFinite(spanFrom) ? spanFrom : 0,
        to: spanTo
      },
      raw: optionLists.map((list) => list.raw).join(", "),
      entries: entries.map((entry) => ({
        ...entry,
        span: {
          from: entry.span.from,
          to: entry.span.to
        }
      }))
    }
  ];
}

export { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, extractCircleRadius, parseStyleValueAsOptionList };
