import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ChildOperationItem, NodeItem, PathItem, Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import type { ProvenanceOptionList, SemanticContextFrame } from "../context.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { maybeResolveNamedCoordinateBorderPointFromRaw } from "../nodes/evaluate.js";
import { applyMatrixToVector } from "../transform.js";
import type { WorldTransform } from "../../coords/transforms.js";

export type TreeChildCluster = {
  children: ChildOperationItem[];
  consumed: number;
};

export type TreePreparedRoot = {
  body: PathItem[];
  rootNameRaw: string;
  rootSpan: Span;
};

export type TreeDeferredDiagnostic = {
  code: string;
  message: string;
  span: Span;
};

export function collectTreeChildCluster(items: PathItem[], startIndex: number): TreeChildCluster {
  const children: ChildOperationItem[] = [];
  let cursor = startIndex;
  while (cursor < items.length) {
    const item = items[cursor];
    if (!item) {
      break;
    }
    if (item.kind === "PathComment") {
      cursor += 1;
      continue;
    }
    if (item.kind === "ChildOperation") {
      children.push(item);
      cursor += 1;
      continue;
    }
    break;
  }

  return {
    children,
    consumed: cursor - startIndex
  };
}

export function makeTreeAutoName(
  parentNameRaw: string | null,
  statementId: string,
  childItemId: string,
  childIndex: number,
  level: number
): string {
  const normalizedParentName = parentNameRaw?.trim() ?? "";
  if (normalizedParentName.length > 0) {
    return `${normalizedParentName}-${childIndex}`;
  }

  const sanitizedParent = sanitizeNameSegment(parentNameRaw ?? "root");
  const sanitizedStatement = sanitizeNameSegment(statementId);
  const sanitizedItem = sanitizeNameSegment(childItemId);
  return `__tree_auto_${sanitizedStatement}_${sanitizedParent}_${sanitizedItem}_${level}_${childIndex}`;
}

export function prepareChildBodyWithRoot(child: ChildOperationItem, generatedRootName: string): TreePreparedRoot {
  const body = [...child.body];
  const rootIndex = body.findIndex((item) => item.kind !== "PathComment" && item.kind !== "PathOption");
  if (rootIndex >= 0) {
    const root = body[rootIndex];
    if (root?.kind === "Node") {
      const trimmedRootName = root.name?.trim();
      const rootNameRaw = trimmedRootName === undefined || trimmedRootName.length === 0 ? generatedRootName : trimmedRootName;
      if (!root.name || root.name.trim().length === 0) {
        const patchedRoot: NodeItem = {
          ...root,
          name: rootNameRaw
        };
        body[rootIndex] = patchedRoot;
      }
      return {
        body,
        rootNameRaw,
        rootSpan: root.span
      };
    }
  }

  const syntheticOptions = parseOptionListRaw("[coordinate]", child.span.from);
  const syntheticRoot: NodeItem = {
    kind: "Node",
    id: `${child.id}:implicit-root`,
    span: { from: child.span.from, to: child.span.from },
    raw: "",
    templateRaw: "",
    name: generatedRootName,
    optionsSpan: syntheticOptions.span,
    options: syntheticOptions,
    textSource: "group",
    textSpan: { from: child.span.from, to: child.span.from },
    text: ""
  };

  return {
    body: [syntheticRoot, ...body],
    rootNameRaw: generatedRootName,
    rootSpan: child.span
  };
}

export function resolveTreeLevelStyleLayers(frame: SemanticContextFrame, level: number): ProvenanceOptionList[] {
  const levelStyles: ProvenanceOptionList[] = [];
  for (const templateLayer of frame.treeLevelStyleTemplateLayers) {
    levelStyles.push({
      options: substituteLevelPlaceholder(templateLayer.options, level),
      sourceRef: {
        ...templateLayer.sourceRef,
        label:
          templateLayer.sourceRef.label != null
            ? `${templateLayer.sourceRef.label} (level ${level})`
            : `level ${level}`
      }
    });
  }

  for (const bucket of frame.treeLevelStyleLayers) {
    if (bucket.level !== level) {
      continue;
    }
    levelStyles.push(...bucket.layers);
  }

  return levelStyles;
}

export function computeTreeChildOrigin(
  parentOrigin: WorldPoint,
  levelDistancePt: number,
  siblingDistancePt: number,
  childIndexOneBased: number,
  childCount: number,
  growDirectionDegrees: number,
  growReverse: boolean,
  transform: WorldTransform
): WorldPoint {
  const radians = (growDirectionDegrees * Math.PI) / 180;
  const forward = { x: Math.cos(radians), y: Math.sin(radians) };
  const perpendicular = { x: -forward.y, y: forward.x };
  const centeredIndex = childIndexOneBased - (childCount + 1) / 2;
  const orderSign = growReverse ? -1 : 1;
  const offset = centeredIndex * siblingDistancePt * orderSign;
  const displacement = applyMatrixToVector(transform, {
    x: pt(forward.x * levelDistancePt + perpendicular.x * offset),
    y: pt(forward.y * levelDistancePt + perpendicular.y * offset)
  });

  return worldPoint(
    pt(parentOrigin.x + displacement.x),
    pt(parentOrigin.y + displacement.y)
  );
}

export function resolveNamedTreeAnchorPoint(
  context: SemanticContext,
  nameRaw: string,
  anchorRaw: string,
  fallbackPoint: WorldPoint,
  towardPoint: WorldPoint
): WorldPoint {
  const normalizedAnchor = normalizeAnchor(anchorRaw);
  const coordinateRaw = `(${nameRaw})`;

  if (normalizedAnchor === "center") {
    const evaluated = evaluateRawCoordinate(coordinateRaw, context);
    return evaluated.world ?? fallbackPoint;
  }

  if (normalizedAnchor === "border") {
    return maybeResolveNamedCoordinateBorderPointFromRaw(coordinateRaw, fallbackPoint, towardPoint, context);
  }

  const anchorCoordinate = `(${nameRaw}.${normalizedAnchor})`;
  const evaluated = evaluateRawCoordinate(anchorCoordinate, context);
  return evaluated.world ?? fallbackPoint;
}

export function collectDeferredTreeHookDiagnostics(
  frame: Pick<
    SemanticContextFrame,
    "treeDeferredGrowthFunction" | "treeDeferredEdgeFromParentPath" | "treeDeferredEdgeFromParentMacro"
  >,
  span: Span
): TreeDeferredDiagnostic[] {
  const diagnostics: TreeDeferredDiagnostic[] = [];
  if (frame.treeDeferredGrowthFunction) {
    diagnostics.push({
      code: "unsupported-tree-growth-function",
      message: "Tree `growth function` hooks are parsed but currently use the default growth function fallback.",
      span
    });
  }
  if (frame.treeDeferredEdgeFromParentPath) {
    diagnostics.push({
      code: "unsupported-tree-edge-from-parent-path",
      message: "Tree `edge from parent path` hooks are parsed but currently use the default edge-from-parent fallback.",
      span
    });
  }
  if (frame.treeDeferredEdgeFromParentMacro) {
    diagnostics.push({
      code: "unsupported-tree-edge-from-parent-macro",
      message: "Tree `edge from parent macro` hooks are parsed but currently use the default edge-from-parent fallback.",
      span
    });
  }
  return diagnostics;
}

function substituteLevelPlaceholder(optionList: OptionListAst, level: number): OptionListAst {
  const replacement = String(level);
  return {
    span: {
      from: optionList.span.from,
      to: optionList.span.to
    },
    raw: optionList.raw.replace(/#1/g, replacement),
    entries: optionList.entries.map((entry) => {
      if (entry.kind === "kv") {
        return {
          ...entry,
          key: entry.key.replace(/#1/g, replacement),
          valueRaw: entry.valueRaw.replace(/#1/g, replacement),
          raw: entry.raw.replace(/#1/g, replacement),
          span: {
            from: entry.span.from,
            to: entry.span.to
          }
        };
      }
      if (entry.kind === "flag") {
        return {
          ...entry,
          key: entry.key.replace(/#1/g, replacement),
          raw: entry.raw.replace(/#1/g, replacement),
          span: {
            from: entry.span.from,
            to: entry.span.to
          }
        };
      }
      return {
        ...entry,
        raw: entry.raw.replace(/#1/g, replacement),
        span: {
          from: entry.span.from,
          to: entry.span.to
        }
      };
    })
  };
}

function normalizeAnchor(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function sanitizeNameSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "id";
}
