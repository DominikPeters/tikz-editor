import type { PersistentMapSnapshot } from "./persistent-map.js";
import { PersistentMap } from "./persistent-map.js";

export type SemanticDependencyCategory = "geometry";

export type SemanticDependencyNodeKind = "source" | "resource";

export type SemanticDependencyResourceKind =
  | "named-coordinate"
  | "named-node-geometry"
  | "named-path"
  | "coordinate-system";

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
};

type SourceNodeState = {
  sourceId: string;
  opaqueReasons: ReadonlySet<SemanticDependencyOpaqueReason>;
};

type ResourceNodeState = {
  resourceKind: SemanticDependencyResourceKind;
  resourceKey: string;
};

const GEOMETRY_CATEGORY: SemanticDependencyCategory = "geometry";

export class SemanticDependencyGraphBuilder {
  private sourceNodes = new PersistentMap<string, SourceNodeState>();
  private resourceNodes = new PersistentMap<string, ResourceNodeState>();
  private edges = new PersistentMap<string, SemanticDependencyEdge>();

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

  exportState(): SemanticDependencyGraphBuilderState {
    return {
      sourceNodes: this.sourceNodes.snapshot(),
      resourceNodes: this.resourceNodes.snapshot(),
      edges: this.edges.snapshot()
    };
  }

  importState(state: SemanticDependencyGraphBuilderState): void {
    this.sourceNodes.restore(state.sourceNodes);
    this.resourceNodes.restore(state.resourceNodes);
    this.edges.restore(state.edges);
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
  }
}

export function collectGeometryInvalidation(
  graph: SemanticDependencyGraph,
  query: GeometryInvalidationQuery
): GeometryInvalidationResult {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.category !== GEOMETRY_CATEGORY) {
      continue;
    }
    const existing = adjacency.get(edge.from);
    if (existing) {
      existing.push(edge.to);
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
  }

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

  while (queue.length > 0) {
    const nextId = queue.shift();
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
