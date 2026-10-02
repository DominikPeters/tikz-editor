import type { PersistentMapSnapshot } from "./persistent-map.js";
import { PersistentMap } from "./persistent-map.js";

export type SemanticDependencyCategory = "geometry";

export type SemanticDependencyNodeKind = "source" | "resource";

export type SemanticDependencyResourceKind =
  | "named-coordinate"
  | "named-node-geometry"
  | "named-path";

export type SemanticDependencyOpaqueReason =
  | "foreach-origin"
  | "macro-origin";

export type SemanticDependencySourceNode = {
  id: string;
  kind: "source";
  sourceId: string;
  opaque: boolean;
  opaqueReasons: SemanticDependencyOpaqueReason[];
};

export type SemanticDependencyResourceNode = {
  id: string;
  kind: "resource";
  resourceKind: SemanticDependencyResourceKind;
  resourceKey: string;
};

export type SemanticDependencyNode =
  | SemanticDependencySourceNode
  | SemanticDependencyResourceNode;

export type SemanticDependencyRelation = "producer" | "consumer";

export type SemanticDependencyEdge = {
  from: string;
  to: string;
  category: SemanticDependencyCategory;
  relation: SemanticDependencyRelation;
};

export type SemanticDependencyGraph = {
  nodes: SemanticDependencyNode[];
  edges: SemanticDependencyEdge[];
};

export type GeometryInvalidationQuery = {
  changedSourceIds: readonly string[];
};

export type GeometryInvalidationResult = {
  affectedSourceIds: string[];
  opaqueSourceIds: string[];
  reachedOpaque: boolean;
};

export type SemanticDependencyGraphBuilderState = {
  sourceNodes: PersistentMapSnapshot<string, SourceNodeState>;
  resourceNodes: PersistentMapSnapshot<string, ResourceNodeState>;
  edges: PersistentMapSnapshot<string, SemanticDependencyEdge>;
  edgesBySource: PersistentMapSnapshot<string, SourceEdgeList>;
};

type SourceNodeState = {
  sourceId: string;
  opaqueReasons: ReadonlySet<SemanticDependencyOpaqueReason>;
};

type ResourceNodeState = {
  resourceKind: SemanticDependencyResourceKind;
  resourceKey: string;
};

type SourceEdgeList = { edge: SemanticDependencyEdge; previous?: SourceEdgeList };

const GEOMETRY_CATEGORY: SemanticDependencyCategory = "geometry";

export class SemanticDependencyGraphBuilder {
  private sourceNodes = new PersistentMap<string, SourceNodeState>();
  private resourceNodes = new PersistentMap<string, ResourceNodeState>();
  private edges = new PersistentMap<string, SemanticDependencyEdge>();
  private edgesBySource = new PersistentMap<string, SourceEdgeList>();

  ensureSourceNode(sourceId: string): string {
    const existing = this.sourceNodes.get(sourceId);
    if (!existing) {
      this.sourceNodes.set(sourceId, {
        sourceId,
        opaqueReasons: new Set()
      });
    }
    return sourceNodeId(sourceId);
  }

  ensureResourceNode(kind: SemanticDependencyResourceKind, key: string): string {
    const resourceNodeKey = resourceNodeId(kind, key);
    const existing = this.resourceNodes.get(resourceNodeKey);
    if (!existing) {
      this.resourceNodes.set(resourceNodeKey, {
        resourceKind: kind,
        resourceKey: key
      });
    }
    return resourceNodeKey;
  }

  addProducer(sourceId: string, resourceKind: SemanticDependencyResourceKind, resourceKey: string): void {
    const sourceIdNode = this.ensureSourceNode(sourceId);
    const resourceIdNode = this.ensureResourceNode(resourceKind, resourceKey);
    this.addEdge({
      from: sourceIdNode,
      to: resourceIdNode,
      category: GEOMETRY_CATEGORY,
      relation: "producer"
    });
  }

  addConsumer(sourceId: string, resourceKind: SemanticDependencyResourceKind, resourceKey: string): void {
    const sourceIdNode = this.ensureSourceNode(sourceId);
    const resourceIdNode = this.ensureResourceNode(resourceKind, resourceKey);
    this.addEdge({
      from: resourceIdNode,
      to: sourceIdNode,
      category: GEOMETRY_CATEGORY,
      relation: "consumer"
    });
  }

  markSourceOpaque(sourceId: string, reason: SemanticDependencyOpaqueReason): void {
    const sourceNode = this.sourceNodes.get(sourceId);
    if (!sourceNode) {
      this.sourceNodes.set(sourceId, {
        sourceId,
        opaqueReasons: new Set([reason])
      });
      return;
    }
    if (sourceNode.opaqueReasons.has(reason)) {
      return;
    }
    const nextOpaqueReasons = new Set(sourceNode.opaqueReasons);
    nextOpaqueReasons.add(reason);
    this.sourceNodes.set(sourceId, {
      ...sourceNode,
      opaqueReasons: nextOpaqueReasons
    });
  }

  build(): SemanticDependencyGraph {
    const nodes: SemanticDependencyNode[] = [];

    for (const sourceNode of this.sourceNodes.values()) {
      const opaqueReasons = [...sourceNode.opaqueReasons].sort();
      nodes.push({
        id: sourceNodeId(sourceNode.sourceId),
        kind: "source",
        sourceId: sourceNode.sourceId,
        opaque: opaqueReasons.length > 0,
        opaqueReasons
      });
    }

    for (const [id, resourceNode] of this.resourceNodes) {
      nodes.push({
        id,
        kind: "resource",
        resourceKind: resourceNode.resourceKind,
        resourceKey: resourceNode.resourceKey
      });
    }

    nodes.sort((left, right) => left.id.localeCompare(right.id));
    const edges = [...this.edges.values()].sort(compareEdges);

    return {
      nodes,
      edges
    };
  }

  /** Read only replayed statements, without flattening the restored prefix. */
  buildForSources(sourceIds: ReadonlySet<string>): SemanticDependencyGraph {
    const nodes: SemanticDependencyNode[] = [];
    const edges: SemanticDependencyEdge[] = [];
    const resources = new Set<string>();
    for (const sourceId of sourceIds) {
      const source = this.sourceNodes.get(sourceId);
      if (!source) continue;
      const opaqueReasons = [...source.opaqueReasons].sort();
      nodes.push({ id: sourceNodeId(sourceId), kind: "source", sourceId, opaque: opaqueReasons.length > 0, opaqueReasons });
      for (let entry = this.edgesBySource.get(sourceId); entry; entry = entry.previous) {
        const { edge } = entry;
        edges.push(edge);
        resources.add(edge.relation === "producer" ? edge.to : edge.from);
      }
    }
    for (const id of resources) {
      const resource = this.resourceNodes.get(id);
      if (resource) nodes.push({ id, kind: "resource", ...resource });
    }
    return { nodes: nodes.sort(compareNodes), edges: edges.sort(compareEdges) };
  }

  exportState(): SemanticDependencyGraphBuilderState {
    return {
      sourceNodes: this.sourceNodes.snapshot(),
      resourceNodes: this.resourceNodes.snapshot(),
      edges: this.edges.snapshot(),
      edgesBySource: this.edgesBySource.snapshot()
    };
  }

  importState(state: SemanticDependencyGraphBuilderState): void {
    this.sourceNodes.restore(state.sourceNodes);
    this.resourceNodes.restore(state.resourceNodes);
    this.edges.restore(state.edges);
    this.edgesBySource.restore(state.edgesBySource);
  }

  clone(): SemanticDependencyGraphBuilder {
    const cloned = new SemanticDependencyGraphBuilder();
    cloned.importState(this.exportState());
    return cloned;
  }

  private addEdge(edge: SemanticDependencyEdge): void {
    const edgeKey = `${edge.from}|${edge.to}|${edge.category}|${edge.relation}`;
    if (this.edges.has(edgeKey)) {
      return;
    }
    this.edges.set(edgeKey, edge);
    const sourceId = (edge.relation === "producer" ? edge.from : edge.to).slice("source:".length);
    this.edgesBySource.set(sourceId, { edge, previous: this.edgesBySource.get(sourceId) });
  }
}

type DependencyIndex = {
  nodeById: ReadonlyMap<string, SemanticDependencyNode>;
  adjacency: ReadonlyMap<string, readonly string[]>;
  edgesBySource: ReadonlyMap<string, readonly SemanticDependencyEdge[]>;
};

// Published graphs are immutable. Repeated invalidation queries and unchanged
// topology revisions share this index; discarded graphs release it naturally.
const dependencyIndexes = new WeakMap<SemanticDependencyGraph, DependencyIndex>();

function dependencyIndex(graph: SemanticDependencyGraph): DependencyIndex {
  const cached = dependencyIndexes.get(graph);
  if (cached) return cached;
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  const edgesBySource = new Map<string, SemanticDependencyEdge[]>();
  for (const edge of graph.edges) {
    const id = edge.relation === "producer" ? edge.from : edge.to;
    const edges = edgesBySource.get(id);
    if (edges) edges.push(edge);
    else edgesBySource.set(id, [edge]);
    if (edge.category !== GEOMETRY_CATEGORY) continue;
    const neighbors = adjacency.get(edge.from);
    if (neighbors) neighbors.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }
  const index = { nodeById, adjacency, edgesBySource };
  dependencyIndexes.set(graph, index);
  return index;
}

/** Replace the dependency contribution of replayed statements. */
export function replaceSourceDependencies(
  previous: SemanticDependencyGraph,
  rebuilt: SemanticDependencyGraph,
  sourceIds: ReadonlySet<string>
): SemanticDependencyGraph {
  const before = dependencyIndex(previous);
  const after = dependencyIndex(rebuilt);
  const replaced = new Set([...sourceIds].map(sourceNodeId));
  const unchanged = [...replaced].every(id => {
    const left = before.nodeById.get(id);
    const right = after.nodeById.get(id);
    if (left?.kind !== "source" || right?.kind !== "source") return left === right;
    if (left.opaque !== right.opaque || left.opaqueReasons.join("\0") !== right.opaqueReasons.join("\0")) return false;
    const leftEdges = before.edgesBySource.get(id) ?? [];
    const rightEdges = after.edgesBySource.get(id) ?? [];
    return leftEdges.length === rightEdges.length && leftEdges.every((edge, i) => sameEdge(edge, rightEdges[i]));
  });
  if (unchanged) return previous;

  const replacedResources = new Set([...replaced].flatMap(id =>
    (before.edgesBySource.get(id) ?? []).map(edge => edge.relation === "producer" ? edge.to : edge.from)
  ));
  const edges = mergeSorted(
    previous.edges.filter(edge => !replaced.has(edge.relation === "producer" ? edge.from : edge.to)),
    rebuilt.edges, compareEdges
  );
  const resources = new Set(edges.map(edge => edge.relation === "producer" ? edge.to : edge.from));
  const nodes = mergeSorted(
    previous.nodes.filter(node => node.kind === "source"
      ? !replaced.has(node.id)
      : !replacedResources.has(node.id) || resources.has(node.id)),
    rebuilt.nodes, compareNodes
  );
  return { nodes, edges };
}

function sameEdge(left: SemanticDependencyEdge, right: SemanticDependencyEdge): boolean {
  return left.from === right.from && left.to === right.to && left.category === right.category && left.relation === right.relation;
}

function compareNodes(left: SemanticDependencyNode, right: SemanticDependencyNode): number {
  return left.id.localeCompare(right.id);
}

function mergeSorted<T>(left: readonly T[], right: readonly T[], compare: (a: T, b: T) => number): T[] {
  const merged: T[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    const order = compare(left[i], right[j]);
    if (order < 0) merged.push(left[i++]);
    else {
      if (order === 0) i++;
      merged.push(right[j++]);
    }
  }
  while (i < left.length) merged.push(left[i++]);
  while (j < right.length) merged.push(right[j++]);
  return merged;
}

export function collectGeometryInvalidation(
  graph: SemanticDependencyGraph,
  query: GeometryInvalidationQuery
): GeometryInvalidationResult {
  const { nodeById, adjacency } = dependencyIndex(graph);

  const queue: string[] = [];
  const visited = new Set<string>();

  for (const sourceId of new Set(query.changedSourceIds)) {
    const id = sourceNodeId(sourceId);
    if (!nodeById.has(id)) {
      continue;
    }
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    queue.push(id);
  }

  const affectedSourceIds = new Set<string>();
  const opaqueSourceIds = new Set<string>();

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const nextId = queue[cursor];
    if (!nextId) {
      continue;
    }
    const node = nodeById.get(nextId);
    if (!node) {
      continue;
    }

    if (node.kind === "source") {
      affectedSourceIds.add(node.sourceId);
      if (node.opaque) {
        opaqueSourceIds.add(node.sourceId);
        continue;
      }
    }

    for (const neighbor of adjacency.get(nextId) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  const sortedAffectedSourceIds = [...affectedSourceIds].sort();
  const sortedOpaqueSourceIds = [...opaqueSourceIds].sort();

  return {
    affectedSourceIds: sortedAffectedSourceIds,
    opaqueSourceIds: sortedOpaqueSourceIds,
    reachedOpaque: sortedOpaqueSourceIds.length > 0
  };
}

function compareEdges(left: SemanticDependencyEdge, right: SemanticDependencyEdge): number {
  if (left.from !== right.from) {
    return left.from.localeCompare(right.from);
  }
  if (left.to !== right.to) {
    return left.to.localeCompare(right.to);
  }
  return left.relation.localeCompare(right.relation);
}

export function sourceNodeId(sourceId: string): string {
  return `source:${sourceId}`;
}

export function resourceNodeId(kind: SemanticDependencyResourceKind, resourceKey: string): string {
  return `resource:${kind}:${resourceKey}`;
}
