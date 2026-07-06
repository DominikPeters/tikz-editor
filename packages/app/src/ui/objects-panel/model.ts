import type { NodeItem, PathStatement, ScopeStatement, Statement } from "tikz-editor/ast/types";
import type { EditAnalysisView } from "tikz-editor/edit/analysis";
import { resolveFigureBoundsState } from "tikz-editor/edit/figure-bounds";
import type { OptionEntry, OptionListAst } from "tikz-editor/options/types";
import type { SceneElement, SceneFigure } from "tikz-editor/semantic/types";

export type ObjectsPanelNode = {
  id: string;
  writeTargetId: string;
  title: string;
  label: string;
  explicitName: string | null;
  parentKey: string;
  index: number;
  hidden: boolean;
  selected: boolean;
  canRename: boolean;
  canToggleVisibility: boolean;
  canDragReorder: boolean;
  childCount: number;
  children: ObjectsPanelNode[];
};

export type ObjectsPanelModel = {
  nodes: ObjectsPanelNode[];
  byId: Map<string, ObjectsPanelNode>;
};

export function buildObjectsPanelModel(args: {
  analysisView: EditAnalysisView;
  scene: SceneFigure | null;
  selectedIds: ReadonlySet<string>;
}): ObjectsPanelModel {
  const { analysisView, scene, selectedIds } = args;
  const sceneElementsBySourceId = new Map<string, SceneElement[]>();
  for (const element of scene?.elements ?? []) {
    if (element.adornment) {
      continue;
    }
    const list = sceneElementsBySourceId.get(element.sourceRef.sourceId);
    if (list) {
      list.push(element);
    } else {
      sceneElementsBySourceId.set(element.sourceRef.sourceId, [element]);
    }
  }

  const byId = new Map<string, ObjectsPanelNode>();
  const figureBoundsState = resolveFigureBoundsState(analysisView.source, {
    activeFigureId: analysisView.activeFigureId,
    analysisView
  });
  const boundingBoxSourceId = figureBoundsState.mode === "fixed" ? figureBoundsState.sourceId : null;
  const nodes = analysisView.parseResult.figure.body
    .map((statement) => buildNode(statement, analysisView, sceneElementsBySourceId, selectedIds, byId, boundingBoxSourceId))
    .filter((node): node is ObjectsPanelNode => node != null);

  return { nodes, byId };
}

function buildNode(
  statement: Statement,
  analysisView: EditAnalysisView,
  sceneElementsBySourceId: ReadonlyMap<string, SceneElement[]>,
  selectedIds: ReadonlySet<string>,
  byId: Map<string, ObjectsPanelNode>,
  boundingBoxSourceId: string | null
): ObjectsPanelNode | null {
  if (statement.kind !== "Path" && statement.kind !== "Scope") {
    return null;
  }

  const children = statement.kind === "Scope"
    ? statement.body
        .map((child) => buildNode(child, analysisView, sceneElementsBySourceId, selectedIds, byId, boundingBoxSourceId))
        .filter((node): node is ObjectsPanelNode => node != null)
    : [];
  const ref = analysisView.statementSnapshot.byId.get(statement.id);
  if (!ref) {
    return null;
  }
  const options = statement.options;
  const primaryNode = statement.kind === "Path" ? findPrimaryNodeItem(statement) : null;
  const writeTargetId = primaryNode?.id ?? statement.id;
  const displayOptions = primaryNode?.options ?? options;
  const explicitNodeName = primaryNode?.name?.trim();
  const explicitName = explicitNodeName === undefined || explicitNodeName.length === 0 ? readOptionValue(displayOptions, "name") : explicitNodeName;
  const label = statement.id === boundingBoxSourceId
    ? "Bounding Box"
    : deriveStatementLabel(statement, sceneElementsBySourceId.get(statement.id) ?? []);
  const targetResolution = analysisView.resolvePropertyTarget(writeTargetId);
  const siblingCount = analysisView.statementSnapshot.byParentKey.get(ref.parentKey)?.length ?? 0;
  const node: ObjectsPanelNode = {
    id: statement.id,
    writeTargetId,
    title: explicitName ?? label,
    label,
    explicitName,
    parentKey: ref.parentKey,
    index: ref.index,
    hidden: hasOptionFlag(displayOptions, "transparent"),
    selected: selectedIds.has(statement.id),
    canRename: targetResolution.kind === "found",
    canToggleVisibility: targetResolution.kind === "found",
    canDragReorder: siblingCount > 1,
    childCount: children.length,
    children
  };
  byId.set(node.id, node);
  return node;
}

function deriveStatementLabel(statement: PathStatement | ScopeStatement, elements: readonly SceneElement[]): string {
  if (statement.kind === "Scope") {
    if (hasOptionFlag(statement.options, "on background layer")) {
      return "Background Layer";
    }
    return "Scope";
  }

  if (hasStatementOptionFlag(statement, "matrix") || hasStatementOptionFlag(statement, "matrix of nodes")) {
    return "Matrix";
  }

  const keywordSet = collectPathKeywords(statement);
  const basicLineKeywordCount = countPathKeywords(statement, ["--", "-|", "|-"]);
  const coordinateCount = statement.items.filter((item) => item.kind === "Coordinate").length;

  if (statement.command === "graph" || statement.items.some((item) => item.kind === "GraphOperation")) {
    return "Graph";
  }

  if (statement.items.some((item) => item.kind === "ChildOperation" || item.kind === "EdgeFromParentOperation")) {
    return "Tree";
  }

  if (statement.items.some((item) => item.kind === "PlotOperation") || keywordSet.has("plot")) {
    return "Plot";
  }

  if (keywordSet.has("grid")) {
    return "Grid";
  }

  if (keywordSet.has("arc")) {
    return "Arc";
  }

  if (keywordSet.has("parabola")) {
    return "Parabola";
  }

  if (keywordSet.has("sin")) {
    return "Sine Path";
  }

  if (keywordSet.has("cos")) {
    return "Cosine Path";
  }

  if (keywordSet.has("..")) {
    return "Curve";
  }

  if (statement.items.some((item) => item.kind === "EdgeOperation")) {
    return "Edge";
  }

  if (statement.items.some((item) => item.kind === "ToOperation")) {
    return "Connector";
  }

  for (const element of elements) {
    if (element.kind === "Circle") {
      return "Circle";
    }
    if (element.kind === "Ellipse") {
      return "Ellipse";
    }
    if (element.kind === "Path") {
      if (element.shapeHint === "rectangle") {
        return "Rectangle";
      }
      if (element.shapeHint === "circle") {
        return "Circle";
      }
      if (element.shapeHint === "ellipse") {
        return "Ellipse";
      }
    }
  }

  if (statement.command === "coordinate") {
    return "Coordinate";
  }
  if (statement.command === "node") {
    return "Node";
  }
  if (elements.some((element) => element.kind === "Text")) {
    return "Text";
  }

  if (basicLineKeywordCount > 0) {
    if (keywordSet.has("cycle")) {
      return "Polygon";
    }
    if (keywordSet.has("-|") || keywordSet.has("|-")) {
      return basicLineKeywordCount === 1 && coordinateCount <= 2 ? "Orthogonal Line" : "Orthogonal Path";
    }
    if (basicLineKeywordCount === 1 && coordinateCount <= 2) {
      return "Line";
    }
    return "Polyline";
  }

  return "Path";
}

function collectPathKeywords(statement: PathStatement): Set<string> {
  const keywords = new Set<string>();
  for (const item of statement.items) {
    if (item.kind === "PathKeyword") {
      keywords.add(item.keyword);
    }
  }
  return keywords;
}

function countPathKeywords(statement: PathStatement, keywords: readonly string[]): number {
  const accepted = new Set(keywords);
  let count = 0;
  for (const item of statement.items) {
    if (item.kind === "PathKeyword" && accepted.has(item.keyword)) {
      count += 1;
    }
  }
  return count;
}

function hasStatementOptionFlag(statement: PathStatement, key: string): boolean {
  if (hasOptionFlag(statement.options, key)) {
    return true;
  }
  return statement.items.some((item) => item.kind === "Node" && hasOptionFlag(item.options, key));
}

function findPrimaryNodeItem(statement: PathStatement): NodeItem | null {
  return statement.items.find((item): item is NodeItem => item.kind === "Node") ?? null;
}

function hasOptionFlag(options: OptionListAst | undefined, key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return options?.entries.some((entry) => normalizeEntryKey(entry) === normalized) ?? false;
}

function readOptionValue(options: OptionListAst | undefined, key: string): string | null {
  const normalized = key.trim().toLowerCase();
  for (const entry of options?.entries ?? []) {
    if (entry.kind === "kv" && entry.key.trim().toLowerCase() === normalized) {
      return entry.valueRaw.trim();
    }
  }
  return null;
}

function normalizeEntryKey(entry: OptionEntry): string | null {
  if (entry.kind === "kv" || entry.kind === "flag") {
    return entry.key.trim().toLowerCase();
  }
  return null;
}
