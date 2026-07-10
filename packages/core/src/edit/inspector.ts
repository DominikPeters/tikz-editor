import { TREE_CHILD_NODE_READONLY_KEYS } from "./tree-editing.js";
import {
  makeForeachTemplateTargetId,
  makePicTemplateTargetId
} from "./property-target.js";
import type { EditParseOptions } from "./parse-options.js";
import { collectInspectorColorAliases } from "./inspector/color-syntax.js";
import { normalizeOptionKey } from "./option-key.js";
import type { Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import { transformPropertyCandidateKeys } from "./property-write-builders.js";
import { uniqueStrings } from "./statement-find.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  AXIS_SHADING_CONFLICT_CLEAR_KEYS,
  BALL_SHADING_CONFLICT_CLEAR_KEYS,
  DASH_STYLE_PRESET_CLEAR_KEYS,
  FILL_PATTERN_CLEAR_KEYS,
  FILL_SHADING_CLEAR_KEYS,
  NODE_SHAPE_KNOWN_KEYS,
  PATH_MORPHING_DECORATION_CLEAR_KEYS,
  RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
  ROUNDED_CORNERS_CLEAR_KEYS,
  SHADOW_ALL_KEYS
} from "./inspector/presets.js";
import type { SceneElement } from "../semantic/types.js";
import {
  candidateKeysForProperty,
  propertyIdForWriteKey
} from "./property-registry.js";
import {
  buildMatrixInspectorDescriptor as buildMatrixInspectorDescriptorBase,
  buildTreeInspectorDescriptor as buildTreeInspectorDescriptorBase
} from "./inspector/matrix-tree-descriptors.js";
import { buildAdornmentSections } from "./inspector/adornment-sections.js";
import { buildFillSection } from "./inspector/fill-section.js";
import { buildGridSection } from "./inspector/grid-section.js";
import { buildNodeSection, buildPathAttachedNodeSection } from "./inspector/node-section.js";
import { buildPathSection } from "./inspector/path-section.js";
import { buildShadowSection } from "./inspector/shadow-section.js";
import { buildStrokeSection } from "./inspector/stroke-section.js";
import { buildStandaloneTextSection } from "./inspector/text-section.js";
import { buildTransformSection } from "./inspector/transform-section.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./inspector/section-builder.js";
import { createInspectorTargetResolver, type InspectorTargetResolver } from "./inspector/target-resolver.js";
import type {
  InspectorDescriptor,
  InspectorProperty,
  InspectorSection,
  InspectorSnapshot,
  SetPropertyWriteTarget
} from "./inspector/types.js";
export { createInspectorTargetResolver } from "./inspector/target-resolver.js";
export type { InspectorTargetResolver } from "./inspector/target-resolver.js";
export { TIKZPICTURE_GLOBAL_TARGET_ID } from "./property-target.js";
export type {
  ArrowTipWriteTarget,
  InspectorDescriptor,
  InspectorProperty,
  InspectorSection,
  InspectorSnapshot,
  NodeTextAlignInspectorValue,
  SetPropertyWriteTarget
} from "./inspector/types.js";
export type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaFamilyId,
  FillPatternMetaOptionKey,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption,
  ShadowPresetId,
  ShadowPresetOption
} from "./inspector/presets.js";
export {
  DASH_STYLE_OPTIONS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_OPTIONS,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  LINE_WIDTH_PRESETS,
  NODE_INNER_SEP_DEFAULT,
  NODE_SHAPE_OPTIONS,
  ROUNDED_CORNERS_DEFAULT_RADIUS,
  SHADOW_PRESET_DEFAULTS,
  SHADOW_PRESET_OPTIONS
} from "./inspector/presets.js";
export {
  dashStylePresetFromStyle,
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "./inspector/preset-values.js";

const FOREACH_TEMPLATE_INFO_NOTE = "Editing the foreach template. Changes apply to all iterations.";
const PIC_INLINE_TEMPLATE_INFO_NOTE = "Editing this inline pic code. Changes apply to this invocation.";
const PIC_SHARED_TEMPLATE_INFO_NOTE = "Editing this shared pic template. Changes apply to all uses.";
const FOREACH_VARIABLE_READONLY_REASON = "This property depends on foreach iteration variables and is read-only.";
const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);
const NODE_BACKED_SECTION_ORDER = ["transform", "node", "stroke", "fill", "path", "grid", "text", "shadow"] as const;
const PATH_SECTION_ORDER = ["transform", "grid", "path", "stroke", "fill", "text", "shadow"] as const;
const DEFAULT_SECTION_ORDER = ["transform", "stroke", "fill", "text", "shadow"] as const;
const SECTION_BUILDERS: readonly SectionBuilder[] = [
  buildTransformSection,
  buildNodeSection,
  buildPathAttachedNodeSection,
  buildGridSection,
  buildPathSection,
  buildStrokeSection,
  buildFillSection,
  buildStandaloneTextSection,
  buildShadowSection
];


function orderInspectorSections(
  sections: InspectorSection[],
  context: { nodeBacked: boolean; pathBacked: boolean }
): InspectorSection[] {
  const order = context.nodeBacked
    ? NODE_BACKED_SECTION_ORDER
    : context.pathBacked
      ? PATH_SECTION_ORDER
      : DEFAULT_SECTION_ORDER;
  const orderIndex = new Map<string, number>(order.map((id, index) => [id, index]));
  const originalIndex = new Map<InspectorSection, number>(
    sections.map((section, index) => [section, index])
  );
  return [...sections].sort((left, right) => {
    const leftOrder = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });
}

export function buildMatrixInspectorDescriptor(
  source: string,
  matrixId: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  return buildMatrixInspectorDescriptorBase(source, matrixId, parseOptions, resolveTarget);
}

export function buildTreeInspectorDescriptor(
  source: string,
  sourceId: string,
  element: SceneElement | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  return buildTreeInspectorDescriptorBase(source, sourceId, element, parseOptions, resolveTarget, getInspectorDescriptor);
}

export function getInspectorDescriptor(
  element: SceneElement,
  snapshot: InspectorSnapshot,
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(snapshot.source, snapshot.parseOptions)
): InspectorDescriptor {
  const inlineTarget = resolveInlineWriteTarget(
    element,
    snapshot.source,
    snapshot.parseOptions ?? {},
    resolveTarget
  );
  const resolvedInlineTarget =
    inlineTarget.targetId != null
      ? resolveTarget(inlineTarget.targetId)
      : null;
  const colorAliases = snapshot.parseOptions?.colorAliases ?? collectInspectorColorAliases(snapshot.source);
  const sectionContext: InspectorSectionBuildContext = {
    source: snapshot.source,
    element,
    targetId: inlineTarget.targetId,
    targetKind: inlineTarget.targetKind,
    resolvedTarget: resolvedInlineTarget,
    parseOptions: snapshot.parseOptions,
    resolveTarget,
    colorAliases,
    writeProperty: (key) => makeSetPropertyWriteTarget(inlineTarget, key),
    writePropertyForElementId: (elementId, key) =>
      makeSetPropertyWriteTargetForElementId(inlineTarget, elementId, key)
  };

  const adornmentSections =
    inlineTarget.targetKind === "node-adornment"
      ? buildAdornmentSections(sectionContext)
      : null;
  if (adornmentSections) {
    return {
      elementKind: normalizeElementKind(element.kind),
      elementId: element.sourceRef.sourceId,
      writeTargetId: inlineTarget.targetId,
      readOnlyReason: inlineTarget.reason,
      infoNote: inlineTarget.infoNote,
      sections: applyForeachVariableReadOnlyToSections(adornmentSections, inlineTarget, resolveTarget)
    };
  }

  const sections: InspectorSection[] = [];
  for (const buildSection of SECTION_BUILDERS) {
    const section = buildSection(sectionContext);
    if (section) sections.push(section);
  }

  return {
    elementKind: normalizeElementKind(element.kind),
    elementId: element.sourceRef.sourceId,
    writeTargetId: inlineTarget.targetId,
    readOnlyReason: inlineTarget.reason,
    infoNote: inlineTarget.infoNote,
    sections: applyForeachVariableReadOnlyToSections(
      orderInspectorSections(sections, {
        nodeBacked: inlineTarget.targetKind != null && NODE_TARGET_KINDS.has(inlineTarget.targetKind),
        pathBacked: element.kind === "Path"
      }),
      inlineTarget,
      resolveTarget
    )
  };
}

function makeSetPropertyWriteTarget(
  inlineTarget: InlineWriteTarget,
  key: string
): SetPropertyWriteTarget {
  return makeSetPropertyWriteTargetForElementId(inlineTarget, inlineTarget.targetId, key);
}

function makeSetPropertyWriteTargetForElementId(
  inlineTarget: InlineWriteTarget,
  elementId: string | null,
  key: string
): SetPropertyWriteTarget {
  const normalizedKey = normalizeOptionKey(key);
  const treeChildWritable =
    inlineTarget.targetKind !== "tree-child"
    || !TREE_CHILD_NODE_READONLY_KEYS.has(normalizedKey);
  const writable = inlineTarget.writable && elementId != null && treeChildWritable;
  const reason =
    !treeChildWritable
      ? "This tree-child property is read-only."
      : inlineTarget.reason;
  return {
    mode: "setProperty",
    elementId: elementId ?? "",
    level: "command",
    key,
    propertyId: propertyIdForWriteKey(key) ?? undefined,
    writable,
    reason
  };
}


function collectForeachVariableNames(
  foreachStack: ReadonlyArray<{ bindings: Record<string, string> }>
): string[] {
  const names = new Set<string>();
  for (const frame of foreachStack) {
    for (const name of Object.keys(frame.bindings)) {
      const normalized = name.trim();
      if (normalized.length > 0) {
        names.add(normalized);
      }
    }
  }
  return [...names];
}

function applyForeachVariableReadOnlyToSections(
  sections: InspectorSection[],
  inlineTarget: InlineWriteTarget,
  resolveTarget: InspectorTargetResolver
): InspectorSection[] {
  if (
    inlineTarget.targetKind !== "foreach-template"
    || !inlineTarget.targetId
    || (inlineTarget.foreachVariableNames?.length ?? 0) === 0
  ) {
    return sections;
  }

  const resolved = resolveTarget(inlineTarget.targetId);
  const options = resolved.kind === "found" ? resolved.target.options : undefined;
  if (!options || options.entries.length === 0) {
    return sections;
  }

  return sections.map((section) => ({
    ...section,
    properties: section.properties.map((property) =>
      inspectorPropertyDependsOnForeachVariables(property, options, inlineTarget.foreachVariableNames ?? [])
        ? makeInspectorPropertyForeachReadOnly(property)
        : property
    )
  }));
}

function makeInspectorPropertyForeachReadOnly(property: InspectorProperty): InspectorProperty {
  return {
    ...(property as InspectorProperty & { readOnlyReason?: string }),
    write: {
      ...property.write,
      writable: false,
      reason: FOREACH_VARIABLE_READONLY_REASON
    },
    readOnlyReason: FOREACH_VARIABLE_READONLY_REASON
  } as InspectorProperty;
}

function inspectorPropertyDependsOnForeachVariables(
  property: InspectorProperty,
  options: OptionListAst,
  foreachVariableNames: readonly string[]
): boolean {
  const candidateKeys = inspectorPropertyCandidateKeys(property);
  if (candidateKeys.length === 0 || foreachVariableNames.length === 0) {
    return false;
  }
  const normalizedKeys = new Set(
    candidateKeys
      .map((key) => normalizeOptionKey(key))
      .filter((key) => key.length > 0)
  );
  if (normalizedKeys.size === 0) {
    return false;
  }
  const foreachVariableSet = new Set(foreachVariableNames);
  return options.entries.some((entry) => {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      return false;
    }
    if (!normalizedKeys.has(normalizeOptionKey(entry.key))) {
      return false;
    }
    return optionEntryContainsForeachVariable(entry.raw, foreachVariableSet);
  });
}

function inspectorPropertyCandidateKeys(property: InspectorProperty): string[] {
  const write = "write" in property ? property.write : undefined;
  const registryKeys = candidateKeysForProperty(write?.propertyId ?? property.id);
  if (registryKeys.length > 0) {
    return registryKeys;
  }
  switch (property.kind) {
    case "dashStyle":
      return [...DASH_STYLE_PRESET_CLEAR_KEYS];
    case "lineCap":
    case "lineJoin":
      return [property.write.key];
    case "pathMorphingDecoration":
      return [...PATH_MORPHING_DECORATION_CLEAR_KEYS];
    case "fillMode":
      return uniqueStrings(["fill", ...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS]);
    case "fillShading":
      return uniqueStrings([
        "shade",
        "shading",
        ...AXIS_SHADING_CONFLICT_CLEAR_KEYS,
        ...RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
        ...BALL_SHADING_CONFLICT_CLEAR_KEYS
      ]);
    case "fillPattern":
    case "fillPatternOption":
      return ["pattern"];
    case "roundedCorners":
      return [...ROUNDED_CORNERS_CLEAR_KEYS];
    case "nodeShape":
      return [...NODE_SHAPE_KNOWN_KEYS];
    case "nodeFont":
      return uniqueStrings([property.context.key, ...property.context.clearKeys]);
    case "nodeTextAlign":
      return uniqueStrings([property.write.key, ...(property.clearKeys ?? [])]);
    case "arrowTip":
      return uniqueStrings([...ARROW_DEFAULT_CLEAR_KEYS, ...property.write.arrowContext.clearKeys]);
    case "shadowPreset":
      return [...SHADOW_ALL_KEYS];
    case "number": {
      if (write?.transformContext) {
        return transformPropertyCandidateKeys(write.transformContext.key);
      }
      return uniqueStrings([write?.key ?? "", ...("clearKeys" in property && property.clearKeys ? property.clearKeys : [])]);
    }
    case "length":
    case "optionalLength":
    case "slider":
    case "boolean":
      return uniqueStrings([property.write.key, ...("clearKeys" in property && property.clearKeys ? property.clearKeys : [])]);
    case "text":
    case "enum":
    case "color":
    case "lineWidth":
      return [property.write.key];
  }
  return [];
}

function optionEntryContainsForeachVariable(raw: string, foreachVariableSet: ReadonlySet<string>): boolean {
  const controlSequences = raw.match(/\\(?:[A-Za-z@]+|.)/gu) ?? [];
  return controlSequences.some((token) => foreachVariableSet.has(token));
}



type InlineWriteTarget = {
  targetId: string | null;
  targetKind: string | null;
  writable: boolean;
  reason?: string;
  infoNote?: string;
  foreachVariableNames?: string[];
};

function sourceSpanContainsMacroOrigin(
  source: string,
  span: Span,
  macroStack: readonly { macroName: string }[]
): boolean {
  const from = Math.max(0, Math.min(source.length, span.from));
  const to = Math.max(from, Math.min(source.length, span.to));
  const slice = source.slice(from, to);
  return macroStack.some((origin) => origin.macroName.length > 0 && slice.includes(origin.macroName));
}


function resolveInlineWriteTarget(
  element: SceneElement,
  source: string,
  parseOptions: EditParseOptions,
  resolveTarget: InspectorTargetResolver
): InlineWriteTarget {
  if (
    element.origin?.macroStack &&
    element.origin.macroStack.length > 0 &&
    sourceSpanContainsMacroOrigin(source, element.sourceRef.sourceSpan, element.origin.macroStack)
  ) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a macro expansion and cannot be edited directly."
    };
  }

  const picStack = element.origin?.picStack ?? [];
  if (picStack.length > 0) {
    const picOrigin = picStack[picStack.length - 1];
    if (!picOrigin) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "This pic expansion cannot be edited from the inspector."
      };
    }
    if (picOrigin.parameterized) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "Parameterized pic templates are read-only."
      };
    }
    if (!picOrigin.codeSpan || !element.origin?.picTemplateLocalTargetId) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "This pic template target could not be mapped back to source."
      };
    }
    const targetId = makePicTemplateTargetId(picOrigin.codeSpan, element.origin.picTemplateLocalTargetId);
    const resolved = resolveTarget(targetId);
    if (resolved.kind === "found") {
      return {
        targetId,
        targetKind: resolved.target.kind,
        writable: true,
        infoNote: picOrigin.codeSource === "inline" ? PIC_INLINE_TEMPLATE_INFO_NOTE : PIC_SHARED_TEMPLATE_INFO_NOTE
      };
    }
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This pic template target could not be mapped back to source."
    };
  }

  const foreachStack = element.origin?.foreachStack ?? [];
  const foreachVariableNames = collectForeachVariableNames(foreachStack);
  if (foreachStack.length > 0) {
    if (element.adornment) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "This adornment comes from a \\foreach expansion and cannot be edited directly.",
        foreachVariableNames
      };
    }

    const templateLocalTargetId = element.origin?.foreachTemplateLocalTargetId;
    const loopId = element.sourceRef.sourceId.startsWith("foreach:") ? element.sourceRef.sourceId : null;
    if (templateLocalTargetId && loopId) {
      const nestedLoopLocalIds = foreachStack.slice(1).map((frame) => frame.loopId);
      const targetId = makeForeachTemplateTargetId(loopId, templateLocalTargetId, nestedLoopLocalIds);
      const resolved = resolveTarget(targetId);
      if (resolved.kind === "found") {
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true,
          infoNote: FOREACH_TEMPLATE_INFO_NOTE,
          foreachVariableNames
        };
      }
    }

    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This \\foreach expansion cannot be edited from the inspector.",
      foreachVariableNames
    };
  }

  const styleChainCommandSourceId =
    [...element.styleChain].reverse().find((entry) => entry.kind === "command")?.sourceRef?.sourceId ?? null;
  const elementSourceId = element.sourceRef.sourceId;
  const prefersSourceTarget =
    elementSourceId.includes(":tree-child:");
  const candidateTargetIds = [
    element.adornment?.targetId ?? null,
    prefersSourceTarget ? elementSourceId : styleChainCommandSourceId,
    prefersSourceTarget ? styleChainCommandSourceId : elementSourceId
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  for (const targetId of candidateTargetIds) {
    const resolved = resolveTarget(targetId);
    if (resolved.kind === "found") {
      if (resolved.target.kind === "matrix-cell") {
        if (!resolved.target.matrixOfNodes) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Cell property editing is only available for matrix node cells."
          };
        }
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true
        };
      }
      if (resolved.target.kind === "tree-child") {
        if (resolved.target.treeChildForeach) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Tree child editing is read-only for child foreach expansions."
          };
        }
        if (
          !resolved.target.treeNodeId
          || !resolved.target.treeNodeTextSpan
          || resolved.target.treeChildInsertOffset == null
          || resolved.target.treeNodeInsertOffset == null
        ) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Tree child source spans could not be resolved for editing."
          };
        }
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true
        };
      }
      return {
        targetId,
        targetKind: resolved.target.kind,
        writable: true
      };
    }
  }

  const fallbackTargetId = candidateTargetIds[0] ?? null;
  if (!fallbackTargetId) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "Inline command options could not be resolved for this element."
    };
  }

  return {
    targetId: fallbackTargetId,
    targetKind: null,
    writable: false,
    reason: "Inline command options could not be resolved for this element."
  };
}


function normalizeElementKind(kind: SceneElement["kind"]): InspectorDescriptor["elementKind"] {
  if (kind === "Path") return "path";
  if (kind === "Circle") return "circle";
  if (kind === "Ellipse") return "ellipse";
  return "text";
}
