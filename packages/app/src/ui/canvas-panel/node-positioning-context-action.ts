import type { NodeItem, PathStatement, Statement } from "tikz-editor/ast/types";
import { resolveEligibleExplicitPath } from "tikz-editor/edit/path-editing";
import type { EditParseOptions } from "tikz-editor/edit/parse-options";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { resolveMatrixMode } from "tikz-editor/semantic/nodes/matrix";
import type { NodeAnchorTarget, SceneElement } from "tikz-editor/semantic/types";
import type { CanvasSnapshot } from "./types";

export type NodePositioningContextMenuAction = "position-relative" | "convert-absolute";

type NodeInfo = {
  sourceId: string;
  spanFrom: number;
  name: string | null;
  tree: boolean;
  matrix: boolean;
  adornment: boolean;
};

export function resolveNodePositioningContextMenuAction(input: {
  source: string;
  sourceId: string | null;
  snapshot: CanvasSnapshot;
  parseOptions: EditParseOptions;
}): NodePositioningContextMenuAction | null {
  const sourceId = input.sourceId?.trim();
  if (!sourceId || input.snapshot.source !== input.source) {
    return null;
  }
  const info = collectNodeInfoBySourceId(input.snapshot).get(sourceId);
  if (!info || !isEligibleNodeInfo(info)) {
    return null;
  }
  if (hasPathAttachment(input.snapshot.scene?.elements ?? [], sourceId)) {
    return null;
  }

  const resolved = resolvePropertyTarget(input.source, sourceId, input.parseOptions);
  if (
    resolved.kind !== "found" ||
    (resolved.target.kind !== "node-item" &&
      !(resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node"))
  ) {
    return null;
  }

  const hasPositioningHandle = input.snapshot.editHandles.some(
    (handle) =>
      handle.sourceRef.sourceId === sourceId &&
      handle.kind === "node-position" &&
      handle.handleType === "node-positioning"
  );
  if (hasPositioningHandle) {
    return "convert-absolute";
  }

  return collectRelativePositionTargetAnchors({
    snapshot: input.snapshot,
    sourceId
  }).length > 0
    ? "position-relative"
    : null;
}

export function collectRelativePositionTargetAnchors(input: {
  snapshot: CanvasSnapshot;
  sourceId: string | null;
}): NodeAnchorTarget[] {
  const sourceId = input.sourceId?.trim();
  const semantic = input.snapshot.semanticResult;
  if (!sourceId || !semantic) {
    return [];
  }
  const nodeInfoBySourceId = collectNodeInfoBySourceId(input.snapshot);
  const selected = nodeInfoBySourceId.get(sourceId);
  if (!selected || !isEligibleNodeInfo(selected)) {
    return [];
  }
  const sceneElements = input.snapshot.scene?.elements ?? [];
  if (hasPathAttachment(sceneElements, sourceId)) {
    return [];
  }

  const seen = new Set<string>();
  const targets: NodeAnchorTarget[] = [];
  for (const target of semantic.nodeAnchorTargets) {
    const targetSourceId = target.nodeSourceId?.trim();
    if (!targetSourceId || target.anchor !== "center" || target.nodeName.trim().length === 0) {
      continue;
    }
    if (targetSourceId === sourceId || seen.has(targetSourceId)) {
      continue;
    }
    const targetInfo = nodeInfoBySourceId.get(targetSourceId);
    if (!targetInfo || !isEligibleNodeInfo(targetInfo)) {
      continue;
    }
    if (hasPathAttachment(sceneElements, targetSourceId)) {
      continue;
    }
    if (targetInfo.spanFrom >= selected.spanFrom) {
      continue;
    }
    seen.add(targetSourceId);
    targets.push(target);
  }
  return targets;
}

export function isPathContextMenuSource(input: {
  source: string;
  sourceId: string | null;
  snapshot: CanvasSnapshot;
  parseOptions: EditParseOptions;
}): boolean {
  const sourceId = input.sourceId?.trim();
  if (!sourceId || input.snapshot.source !== input.source) {
    return false;
  }
  if (collectNodeInfoBySourceId(input.snapshot).has(sourceId)) {
    return false;
  }
  const resolved = resolveEligibleExplicitPath(input.source, sourceId, input.parseOptions);
  return resolved.kind === "eligible" && resolved.analysis.segments.length > 0;
}

function isEligibleNodeInfo(info: NodeInfo): boolean {
  return !info.tree && !info.matrix && !info.adornment;
}

function collectNodeInfoBySourceId(snapshot: CanvasSnapshot): Map<string, NodeInfo> {
  const statements = snapshot.parseResult?.figure.body ?? [];
  const nodes = new Map<string, NodeInfo>();
  visitStatements(statements, nodes);
  return nodes;
}

function visitStatements(statements: readonly Statement[], nodes: Map<string, NodeInfo>): void {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      visitStatements(statement.body, nodes);
      continue;
    }
    if (statement.kind !== "Path") {
      continue;
    }
    collectPathStatementNodes(statement, nodes);
  }
}

function collectPathStatementNodes(statement: PathStatement, nodes: Map<string, NodeInfo>): void {
  const tree = statement.items.some((item) => item.kind === "ChildOperation") || statement.id.includes(":tree-child:");
  for (const item of statement.items) {
    if (item.kind !== "Node") {
      continue;
    }
    const sourceId = resolveNodeSourceId(statement, item, tree);
    const name = item.name?.trim() ?? "";
    nodes.set(sourceId, {
      sourceId,
      spanFrom: item.span.from,
      name: name.length > 0 ? name : null,
      tree,
      matrix: resolveMatrixMode(item.options).enabled,
      adornment: item.adornment != null
    });
  }
}

function resolveNodeSourceId(statement: PathStatement, node: NodeItem, tree: boolean): string {
  return node.adornment != null || statement.command === "node" || tree
    ? statement.id
    : node.id;
}

function hasPathAttachment(elements: readonly SceneElement[], sourceId: string): boolean {
  return elements.some(
    (element) => element.sourceRef.sourceId === sourceId && "pathAttachment" in element && element.pathAttachment != null
  );
}
