import { describe, expect, it } from "vitest";

import {
  SemanticDependencyGraphBuilder,
  collectGeometryInvalidation,
  replaceSourceDependencies,
  resourceNodeId,
  type SemanticDependencyGraph,
  type SemanticDependencyResourceKind
} from "../../packages/core/src/semantic/dependencies.js";
import { collectGeometryInvalidation as collectGeometryInvalidationFromRoot } from "../../packages/core/src/index.js";
import { evaluateSemantic } from "./helpers.js";

describe("semantic dependencies / graph + invalidation query", () => {
  it("retains an unchanged graph and replaces only changed source contributions", () => {
    const initial = new SemanticDependencyGraphBuilder();
    initial.addProducer("a", "named-coordinate", "A");
    initial.addConsumer("b", "named-coordinate", "A");
    initial.addProducer("b", "named-path", "old");
    initial.addProducer("c", "named-coordinate", "C");
    const graph = initial.build();
    const saved = JSON.stringify(graph);
    const changed = new Set(["b"]);
    expect(replaceSourceDependencies(graph, initial.buildForSources(changed), changed)).toBe(graph);

    const rebuilt = new SemanticDependencyGraphBuilder();
    rebuilt.addConsumer("b", "named-coordinate", "C");
    rebuilt.addProducer("b", "named-path", "new");
    const next = replaceSourceDependencies(graph, rebuilt.buildForSources(changed), changed);
    expect(next.nodes.some(node => node.id === resourceNodeId("named-path", "old"))).toBe(false);
    expect(collectGeometryInvalidation(next, { changedSourceIds: ["a"] }).affectedSourceIds).toEqual(["a"]);
    expect(collectGeometryInvalidation(next, { changedSourceIds: ["c"] }).affectedSourceIds).toEqual(["b", "c"]);
    expect(collectGeometryInvalidation(graph, { changedSourceIds: ["a"] }).affectedSourceIds).toEqual(["a", "b"]);
    expect(JSON.stringify(graph)).toBe(saved);

    const canonical = new SemanticDependencyGraphBuilder();
    canonical.addProducer("a", "named-coordinate", "A");
    canonical.addConsumer("b", "named-coordinate", "C");
    canonical.addProducer("b", "named-path", "new");
    canonical.addProducer("c", "named-coordinate", "C");
    expect(next).toEqual(canonical.build());
  });

  it("tracks direct producer/consumer dependencies through a named coordinate", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");

    const graph = builder.build();
    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: ["source-a"]
    });

    expect(invalidation).toEqual({
      affectedSourceIds: ["source-a", "source-b"],
      opaqueSourceIds: [],
      reachedOpaque: false
    });
  });

  it("re-exports invalidation query helper from package root", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");
    const graph = builder.build();

    expect(collectGeometryInvalidationFromRoot(graph, { changedSourceIds: ["source-a"] })).toEqual({
      affectedSourceIds: ["source-a", "source-b"],
      opaqueSourceIds: [],
      reachedOpaque: false
    });
  });

  it("supports multi-hop invalidation chains across source/resource nodes", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");
    builder.addProducer("source-b", "named-path", "path-b");
    builder.addConsumer("source-c", "named-path", "path-b");

    const graph = builder.build();
    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: ["source-a"]
    });

    expect(invalidation).toEqual({
      affectedSourceIds: ["source-a", "source-b", "source-c"],
      opaqueSourceIds: [],
      reachedOpaque: false
    });
  });

  it("stops traversal at opaque source boundaries while still reporting them", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");
    builder.addProducer("source-b", "named-coordinate", "B");
    builder.addConsumer("source-c", "named-coordinate", "B");
    builder.markSourceOpaque("source-b", "foreach-origin");

    const graph = builder.build();
    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: ["source-a"]
    });

    expect(invalidation).toEqual({
      affectedSourceIds: ["source-a", "source-b"],
      opaqueSourceIds: ["source-b"],
      reachedOpaque: true
    });
  });

  it("keeps unrelated dependency subgraphs out of the affected set", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");
    builder.addProducer("source-x", "named-coordinate", "X");
    builder.addConsumer("source-y", "named-coordinate", "X");

    const graph = builder.build();
    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: ["source-a"]
    });

    expect(invalidation).toEqual({
      affectedSourceIds: ["source-a", "source-b"],
      opaqueSourceIds: [],
      reachedOpaque: false
    });
  });

  it("returns an empty result when changed source ids are not in the graph", () => {
    const builder = new SemanticDependencyGraphBuilder();
    builder.addProducer("source-a", "named-coordinate", "A");
    builder.addConsumer("source-b", "named-coordinate", "A");

    const graph = builder.build();
    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: ["missing-source"]
    });

    expect(invalidation).toEqual({
      affectedSourceIds: [],
      opaqueSourceIds: [],
      reachedOpaque: false
    });
  });

  it("builds deterministic node/edge output regardless of insertion order", () => {
    const left = new SemanticDependencyGraphBuilder();
    left.addProducer("source-z", "named-path", "p");
    left.addConsumer("source-a", "named-path", "p");
    left.addProducer("source-a", "named-coordinate", "A");
    left.addConsumer("source-b", "named-coordinate", "A");
    left.markSourceOpaque("source-a", "macro-origin");

    const right = new SemanticDependencyGraphBuilder();
    right.addConsumer("source-b", "named-coordinate", "A");
    right.addProducer("source-a", "named-coordinate", "A");
    right.markSourceOpaque("source-a", "macro-origin");
    right.addConsumer("source-a", "named-path", "p");
    right.addProducer("source-z", "named-path", "p");

    expect(left.build()).toEqual(right.build());
  });
});

describe("semantic dependencies / integration", () => {
  it("records named-coordinate producer/consumer edges from real TikZ", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const graph = result.dependencies;

    expect(graph).toBeDefined();
    const coordinateProducers = sourceIdsProducing(graph, "named-coordinate", "A");
    const coordinateConsumers = sourceIdsConsuming(graph, "named-coordinate", "A");

    expect(coordinateProducers).toHaveLength(1);
    expect(coordinateConsumers).toHaveLength(1);

    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: [coordinateProducers[0]]
    });
    expect(invalidation.reachedOpaque).toBe(false);
    expect(invalidation.affectedSourceIds).toContain(coordinateProducers[0]);
    expect(invalidation.affectedSourceIds).toContain(coordinateConsumers[0]);
  });

  it("records named-node-geometry consumers for numeric anchors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (N) at (0,0) {N};
  \draw (N.30) -- +(1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const graph = result.dependencies;

    const geometryProducers = sourceIdsProducing(graph, "named-node-geometry", "N");
    const geometryConsumers = sourceIdsConsuming(graph, "named-node-geometry", "N");

    expect(geometryProducers).toHaveLength(1);
    expect(geometryConsumers.length).toBeGreaterThan(0);

    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: [geometryProducers[0]]
    });
    expect(invalidation.affectedSourceIds).toContain(geometryProducers[0]);
    for (const consumer of geometryConsumers) {
      expect(invalidation.affectedSourceIds).toContain(consumer);
    }
  });

  it("connects named-path producers to intersections and downstream consumers", () => {
    const source = String.raw`\begin{tikzpicture}
  \path [name path=a] (0,0) -- (2,2);
  \path [name path=b] (0,2) -- (2,0);
  \path [name intersections={of=a and b, by=p}];
  \draw (p) -- (2,1);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const graph = result.dependencies;

    const pathAProducers = sourceIdsProducing(graph, "named-path", "a");
    const pathAConsumers = sourceIdsConsuming(graph, "named-path", "a");
    const pointPProducers = sourceIdsProducing(graph, "named-coordinate", "p");
    const pointPConsumers = sourceIdsConsuming(graph, "named-coordinate", "p");

    expect(pathAProducers).toHaveLength(1);
    expect(pathAConsumers.length).toBeGreaterThan(0);
    expect(pointPProducers).toEqual(pathAConsumers);
    expect(pointPConsumers.length).toBeGreaterThan(0);

    const invalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: [pathAProducers[0]]
    });
    expect(invalidation.affectedSourceIds).toContain(pathAProducers[0]);
    for (const sourceId of pathAConsumers) {
      expect(invalidation.affectedSourceIds).toContain(sourceId);
    }
    for (const sourceId of pointPConsumers) {
      expect(invalidation.affectedSourceIds).toContain(sourceId);
    }
  });

  it("keeps opaque invalidation local to the traversed foreach-derived closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw (\x,0) -- (\x,1);
  \coordinate (A) at (0,2);
  \draw (A) -- (1,2);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const graph = result.dependencies;

    const plainProducer = sourceIdsProducing(graph, "named-coordinate", "A")[0];
    const plainConsumers = sourceIdsConsuming(graph, "named-coordinate", "A");
    expect(plainProducer).toBeDefined();
    expect(plainConsumers.length).toBeGreaterThan(0);

    const plainInvalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: plainProducer ? [plainProducer] : []
    });
    expect(plainInvalidation.reachedOpaque).toBe(false);
    expect(plainInvalidation.opaqueSourceIds).toEqual([]);
    for (const consumer of plainConsumers) {
      expect(plainInvalidation.affectedSourceIds).toContain(consumer);
    }

    const opaqueSources = graph.nodes
      .filter((node): node is Extract<(typeof graph.nodes)[number], { kind: "source" }> => node.kind === "source")
      .filter((node) => node.opaque)
      .map((node) => node.sourceId);
    expect(opaqueSources.length).toBeGreaterThan(0);

    const opaqueInvalidation = collectGeometryInvalidation(graph, {
      changedSourceIds: [opaqueSources[0]]
    });
    expect(opaqueInvalidation.reachedOpaque).toBe(true);
    expect(opaqueInvalidation.opaqueSourceIds).toContain(opaqueSources[0]);
    for (const consumer of plainConsumers) {
      expect(opaqueInvalidation.affectedSourceIds).not.toContain(consumer);
    }
  });

  it("returns deterministic dependency graphs for repeated semantic evaluation", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{tikzpicture}`;
    const first = evaluateSemantic(source).dependencies;
    const second = evaluateSemantic(source).dependencies;

    expect(first).toEqual(second);
  });
});

function sourceIdsProducing(
  graph: SemanticDependencyGraph,
  resourceKind: SemanticDependencyResourceKind,
  resourceKey: string
): string[] {
  const targetResourceId = resourceNodeId(resourceKind, resourceKey);
  const sourceNodeIds = graph.edges
    .filter((edge) => edge.relation === "producer" && edge.to === targetResourceId)
    .map((edge) => edge.from);
  return sourceIdsForNodeIds(graph, sourceNodeIds);
}

function sourceIdsConsuming(
  graph: SemanticDependencyGraph,
  resourceKind: SemanticDependencyResourceKind,
  resourceKey: string
): string[] {
  const sourceResourceId = resourceNodeId(resourceKind, resourceKey);
  const sourceNodeIds = graph.edges
    .filter((edge) => edge.relation === "consumer" && edge.from === sourceResourceId)
    .map((edge) => edge.to);
  return sourceIdsForNodeIds(graph, sourceNodeIds);
}

function sourceIdsForNodeIds(graph: SemanticDependencyGraph, nodeIds: readonly string[]): string[] {
  const sourceIds = new Set<string>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node || node.kind !== "source") {
      continue;
    }
    sourceIds.add(node.sourceId);
  }
  return [...sourceIds].sort();
}
