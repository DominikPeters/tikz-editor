import type { PathItem } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import type { SceneElement } from "../../semantic/types.js";
import { normalizeOptionKey } from "../option-key.js";
import type { EditParseOptions } from "../parse-options.js";
import {
  cloneTransformInspectorValues,
  DEFAULT_TRANSFORM_INSPECTOR_VALUES,
  resolveTransformInspectorMutationContext,
  transformRotateInspectorLabel
} from "../property-write-builders.js";
import { TREE_ROOT_LAYOUT_KEYS } from "../tree-editing.js";
import { colorOptionsForValue } from "./color-syntax.js";
import { findPathStatementInSource } from "./grid-state.js";
import { createInspectorTargetResolver, type InspectorTargetResolver } from "./target-resolver.js";
import type { InspectorDescriptor, InspectorSnapshot } from "./types.js";

export type TreeNodeDescriptorResolver = (
  element: SceneElement,
  snapshot: InspectorSnapshot,
  resolveTarget: InspectorTargetResolver
) => InspectorDescriptor;

function resolveMatrixSpacingPt(options: OptionListAst | undefined, key: "row sep" | "column sep"): number {
  const entry = options?.entries.find(
    (candidate): candidate is Extract<OptionEntry, { kind: "kv" }> => candidate.kind === "kv" && candidate.key === key
  );
  if (!entry) {
    return 0;
  }
  const tokens = entry.valueRaw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  let sum = 0;
  for (const token of tokens) {
    const parsed = parseLength(token, "pt");
    if (parsed != null) {
      sum += parsed;
    }
  }
  return sum;
}

function resolveMatrixColorOption(options: OptionListAst | undefined, key: "draw" | "fill"): string | null {
  const entry = options?.entries.find(
    (candidate): candidate is Extract<OptionEntry, { kind: "kv" }> => candidate.kind === "kv" && candidate.key === key
  );
  if (!entry) {
    return null;
  }
  const normalized = entry.valueRaw.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionHasNormalizedKey(options: OptionListAst | undefined, key: string): boolean {
  const normalizedKey = normalizeOptionKey(key);
  return (
    options?.entries.some(
      (entry) =>
        (entry.kind === "flag" || entry.kind === "kv")
        && normalizeOptionKey(entry.key) === normalizedKey
    ) ?? false
  );
}

function resolveTreeLengthOptionPt(options: OptionListAst | undefined, key: "level distance" | "sibling distance"): number {
  const normalizedKey = normalizeOptionKey(key);
  const entry = options?.entries.find(
    (candidate): candidate is Extract<OptionEntry, { kind: "kv" }> =>
      candidate.kind === "kv"
      && normalizeOptionKey(candidate.key) === normalizedKey
  );
  if (!entry) {
    return 0;
  }
  const parsed = parseLength(entry.valueRaw, "pt");
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
}

function resolveTreeGrowOption(options: OptionListAst | undefined): string {
  const growEntry = options?.entries.find(
    (candidate) =>
      candidate.kind === "kv"
      && normalizeOptionKey(candidate.key) === "grow"
  );
  if (growEntry?.kind !== "kv") {
    return "down";
  }
  const normalized = growEntry.valueRaw.trim();
  return normalized.length > 0 ? normalized : "down";
}

export function buildMatrixInspectorDescriptor(
  source: string,
  matrixId: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  const resolved = resolveTarget(matrixId);
  if (resolved.kind === "not-found" || resolved.target.kind !== "matrix-statement") {
    return null;
  }

  const writable = true;
  const readOnlyReason = undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, matrixId, parseOptions, resolveTarget);
  const transformValues = transformContext.values;
  const rowSepPt = resolveMatrixSpacingPt(resolved.target.options, "row sep");
  const columnSepPt = resolveMatrixSpacingPt(resolved.target.options, "column sep");
  const drawColor = resolveMatrixColorOption(resolved.target.options, "draw");
  const fillColor = resolveMatrixColorOption(resolved.target.options, "fill");

  return {
    elementKind: "path",
    elementId: matrixId,
    writeTargetId: matrixId,
    readOnlyReason,
    sections: [
      {
        id: "transform",
        title: "Transform",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "xshift",
            label: "X shift",
            value: transformValues.xshift,
            step: 0.1,
            unit: "pt",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "xshift",
              transformContext: {
                key: "xshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yshift",
            label: "Y shift",
            value: transformValues.yshift,
            step: 0.1,
            unit: "pt",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "yshift",
              transformContext: {
                key: "yshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "xscale",
            label: "X scale",
            value: transformValues.xscale,
            step: 0.1,
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "xscale",
              transformContext: {
                key: "xscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yscale",
            label: "Y scale",
            value: transformValues.yscale,
            step: 0.1,
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "yscale",
              transformContext: {
                key: "yscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "rotate",
            label: transformRotateInspectorLabel(transformContext),
            value: transformValues.rotate,
            step: 1,
            unit: "deg",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "rotate",
              transformContext: {
                key: "rotate",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      {
        id: "matrix",
        title: "Matrix",
        sourceLevel: "command",
        properties: [
          {
            kind: "length",
            id: "matrix-row-sep",
            label: "Row sep",
            value: rowSepPt,
            step: 0.1,
            unit: "pt",
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "row sep", writable, reason: readOnlyReason }
          },
          {
            kind: "length",
            id: "matrix-column-sep",
            label: "Column sep",
            value: columnSepPt,
            step: 0.1,
            unit: "pt",
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "column sep", writable, reason: readOnlyReason }
          },
          {
            kind: "color",
            id: "matrix-draw",
            label: "Draw",
            value: drawColor,
            syntaxValue: drawColor,
            options: colorOptionsForValue(drawColor),
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "draw", writable, reason: readOnlyReason }
          },
          {
            kind: "color",
            id: "matrix-fill",
            label: "Fill",
            value: fillColor,
            syntaxValue: fillColor,
            options: colorOptionsForValue(fillColor),
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "fill", writable, reason: readOnlyReason }
          }
        ]
      }
    ]
  };
}

const TREE_GROW_DIRECTION_OPTIONS = [
  { value: "down", label: "Down" },
  { value: "up", label: "Up" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

export function buildTreeInspectorDescriptor(
  source: string,
  sourceId: string,
  element: SceneElement | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions),
  resolveNodeDescriptor?: TreeNodeDescriptorResolver
): InspectorDescriptor | null {
  const resolvedRootTarget = resolveTarget(sourceId);
  if (resolvedRootTarget.kind === "not-found" || resolvedRootTarget.target.kind !== "path-statement") {
    return null;
  }

  const rootStatement =
    parseOptions.analysisView?.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
      ? parseOptions.analysisView.findPathStatement(sourceId)
      : findPathStatementInSource(source, sourceId, parseOptions);
  if (!rootStatement) {
    return null;
  }
  const hasChildren = rootStatement.items.some((item) => item.kind === "ChildOperation");
  if (!hasChildren) {
    return null;
  }

  const rootNode = rootStatement.items.find((item): item is Extract<PathItem, { kind: "Node" }> => item.kind === "Node");
  if (!rootNode) {
    return null;
  }

  const rootNodeElement = element
    ? ({
        ...element,
        sourceRef: {
          ...element.sourceRef,
          sourceId: rootNode.id
        }
      })
    : null;
  const rootNodeDescriptor = rootNodeElement && resolveNodeDescriptor
    ? resolveNodeDescriptor(rootNodeElement, {
        source,
        parseOptions
      }, resolveTarget)
    : null;
  const nodeSections = rootNodeDescriptor
    ? rootNodeDescriptor.sections.filter((section) => section.id !== "transform")
    : [];

  const writable = true;
  const readOnlyReason = undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, sourceId, parseOptions, resolveTarget);
  const transformValues = transformContext.values;

  const resolveRootLayoutWriteTargetId = (key: string): string => {
    if (!TREE_ROOT_LAYOUT_KEYS.has(normalizeOptionKey(key))) {
      return sourceId;
    }
    if (optionHasNormalizedKey(resolvedRootTarget.target.options, key)) {
      return sourceId;
    }
    if (optionHasNormalizedKey(rootNode.options, key)) {
      return rootNode.id;
    }
    return sourceId;
  };
  const resolveRootLayoutValue = (key: "level distance" | "sibling distance"): number => {
    if (optionHasNormalizedKey(resolvedRootTarget.target.options, key)) {
      return resolveTreeLengthOptionPt(resolvedRootTarget.target.options, key);
    }
    if (optionHasNormalizedKey(rootNode.options, key)) {
      return resolveTreeLengthOptionPt(rootNode.options, key);
    }
    return 0;
  };
  const growValue = optionHasNormalizedKey(resolvedRootTarget.target.options, "grow")
    ? resolveTreeGrowOption(resolvedRootTarget.target.options)
    : resolveTreeGrowOption(rootNode.options);

  return {
    elementKind: "path",
    elementId: sourceId,
    writeTargetId: sourceId,
    readOnlyReason,
    sections: [
      {
        id: "transform",
        title: "Transform",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "xshift",
            label: "X shift",
            value: transformValues.xshift,
            step: 0.1,
            unit: "pt",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "xshift",
              transformContext: {
                key: "xshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yshift",
            label: "Y shift",
            value: transformValues.yshift,
            step: 0.1,
            unit: "pt",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "yshift",
              transformContext: {
                key: "yshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "xscale",
            label: "X scale",
            value: transformValues.xscale,
            step: 0.1,
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "xscale",
              transformContext: {
                key: "xscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yscale",
            label: "Y scale",
            value: transformValues.yscale,
            step: 0.1,
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "yscale",
              transformContext: {
                key: "yscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "rotate",
            label: transformRotateInspectorLabel(transformContext),
            value: transformValues.rotate,
            step: 1,
            unit: "deg",
            defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "rotate",
              transformContext: {
                key: "rotate",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      {
        id: "tree-layout",
        title: "Tree Layout",
        sourceLevel: "command",
        properties: [
          {
            kind: "enum",
            id: "tree-grow",
            label: "Grow",
            value: growValue,
            options: TREE_GROW_DIRECTION_OPTIONS,
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("grow"),
              level: "command",
              key: "grow",
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "length",
            id: "tree-level-distance",
            label: "Level distance",
            value: resolveRootLayoutValue("level distance"),
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("level distance"),
              level: "command",
              key: "level distance",
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "length",
            id: "tree-sibling-distance",
            label: "Sibling distance",
            value: resolveRootLayoutValue("sibling distance"),
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("sibling distance"),
              level: "command",
              key: "sibling distance",
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      ...nodeSections
    ]
  };
}
