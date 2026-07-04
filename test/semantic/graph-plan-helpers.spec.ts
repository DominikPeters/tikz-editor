import { describe, expect, it } from "vitest";

import type { GraphOperationItem, GraphSpec } from "../../packages/core/src/ast/types.js";
import { parseOptionListRaw } from "../../packages/core/src/options/parse.js";
import { buildGraphPlan } from "../../packages/core/src/semantic/path/graph.js";

const span = { from: 0, to: 0 };

function graphOperation(specRaw: string, optionsRaw?: string, spec?: GraphSpec): GraphOperationItem {
  return {
    kind: "GraphOperation",
    id: "graph",
    span: { from: 0, to: specRaw.length },
    raw: specRaw,
    optionsSpan: optionsRaw ? { from: 0, to: optionsRaw.length } : undefined,
    options: optionsRaw ? parseOptionListRaw(optionsRaw, 0) : undefined,
    specSpan: { from: 0, to: specRaw.length },
    specRaw,
    spec
  };
}

function parsedSpec(raw: string, nodes: string[], connectors: Array<"--" | "->" | "<-" | "<->" | "-!-">): GraphSpec {
  return {
    span: { from: 0, to: raw.length },
    raw,
    segments: [
      {
        span: { from: 0, to: raw.length },
        raw,
        chain: {
          span: { from: 0, to: raw.length },
          raw,
          nodes: nodes.map((node) => ({ raw: node, span })),
          connectors: connectors.map((operator) => ({ operator, span }))
        }
      }
    ]
  };
}

describe("semantic graph planner helpers", () => {
  it("resolves existing node set references while ignoring empty set names and members", () => {
    const plan = buildGraphPlan(
      graphOperation("( red ) -> tail, -> orphan, lonely ->"),
      new Map<string, string[]>([
        ["", ["ignored"]],
        [" red ", [" left ", "", "right"]]
      ])
    );

    expect(plan.nodes.map((node) => node.name)).toEqual(["tail", "lonely"]);
    expect(plan.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(
      expect.arrayContaining(["left->tail", "right->tail"])
    );
    expect(plan.diagnostics).toEqual(expect.arrayContaining(["empty-graph-node-spec", "graph-connector-without-right-node"]));
  });

  it("applies local graph option controls that intentionally disable inherited modes", () => {
    const plan = buildGraphPlan(
      graphOperation(
        [
          "a [",
          "use existing nodes=false, fresh nodes=false, empty nodes=false, math nodes=false, trie=false,",
          "number nodes=false, simple=false, multi=false, clear >=false, clear <=false,",
          "left anchor={}, right anchor=\"west\", default edge kind=<-, default edge operator=path,",
          "source edge style={red}, target edge style={blue}, source edge node={node[swap]{src}}, target edge node={node{dst}},",
          "color class=hot, hot, recolor hot by target, /tikz/graphs/grow right=false",
          "] -> b"
        ].join(" ")
      )
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes.map((node) => node.text)).toEqual(["a", "b"]);
    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0]).toMatchObject({ from: "a", to: "b", operator: "->" });
    expect(plan.edges[0]?.nodes?.map((node) => node.text)).toEqual(["src"]);
  });

  it("handles root flags, numeric numbering starts, default joins, and placement toggles", () => {
    const plan = buildGraphPlan(
      graphOperation("a -- a -- a", "[number nodes=3, number nodes sep=-, multi, grid placement, n=3, wrap after=2, ->]")
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes.map((node) => node.name)).toEqual(["a-3", "a-4", "a-5"]);
    expect(plan.nodes.map((node) => node.placementHint?.mode)).toEqual(["grid", "grid", "grid"]);
    expect(plan.edges.map((edge) => edge.operator)).toEqual(["--", "--"]);
  });

  it("covers parsed chain fallback paths and simple-mode passthrough edges", () => {
    const emptyParsed = buildGraphPlan(graphOperation("ignored", undefined, parsedSpec("ignored", [], [])));
    expect(emptyParsed.nodes.map((node) => node.name)).toEqual(["ignored"]);
    expect(emptyParsed.edges).toEqual([]);

    const blankParsedNode = buildGraphPlan(graphOperation("ignored", undefined, parsedSpec("ignored", [""], ["->"])));
    expect(blankParsedNode.nodes.map((node) => node.name)).toEqual(["__graph_anon_1"]);

    const passthrough = buildGraphPlan(graphOperation("{[multi] a -> b, a -> b} [simple] -> c", "[simple]"));
    expect(passthrough.diagnostics).toEqual([]);
    expect(passthrough.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["a->b", "a->b"]);
  });

  it("normalizes edge label shortcuts, empty text controls, and malformed edge-node payloads", () => {
    const plan = buildGraphPlan(
      graphOperation(
        'a [>"quoted""label"{near start}, <"left"', "[edge quotes={}, put node text on incoming edges={}, put node text on outgoing edges={swap}]"
      )
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.edges).toEqual([]);
  });

  it("applies group-level controls, color operations, and graph operators", () => {
    const plan = buildGraphPlan(
      graphOperation(
        "{a [color class=warm, warm], b [color class=cool, cool], c}",
        [
          "[",
          "nodes={draw}, edges={very thick}, edge quotes={near start},",
          "name=Root, name separator=/, as={label}, empty nodes, math nodes, trie,",
          "left anchor={}, right anchor=east, use existing nodes=false, fresh nodes=true,",
          "number nodes=bad, number nodes sep=-, simple=false, multi=false,",
          "put node text on incoming edges={near end}, put node text on outgoing edges,",
          "default edge kind=<->, default edge operator={matching={target',source'}},",
          "level 1/.style={circle}, not warm, recolor cool by hot,",
          "operator={clique, cycle={hot}, path, complete bipartite={source,target}, matching, matching and star}",
          "]"
        ].join(" ")
      )
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes.map((node) => node.name)).toEqual(["Root/a-1", "Root/b-2", "Root/c-3"]);
  });

  it("covers node-local controls, directional shortcuts, and invalid placement values", () => {
    const plan = buildGraphPlan(
      graphOperation(
        [
          'a [nodes={}, edge={}, target edge style={}, source edge style={}, target edge node={}, source edge node={},',
          'target edge clear=false, source edge clear=false, clear >=false, clear <=false,',
          'put node text on incoming edges={swap}, put node text on outgoing edges,',
          'edge label={kept}, edge node={node[near start]{middle}},',
          'no placement=false, cartesian placement=false, grid placement=false, circular placement=false,',
          'x=bad, y=bad, n=bad, wrap after=bad, radius=bad, phase=bad, clockwise=bad, counterclockwise=bad,',
          'grow right=false, grow left=2cm, grow up sep=bad, branch down sep=1pt,',
          'color class=local, local, !local, recolor all by target, default edge operator={}, default edge kind=bad,',
          'operator={complete bipartite}, >{draw}, <{bend left}, >"target label"{near end}, <"source label"\'{near start}] -> b'
        ].join(" ")
      )
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.nodes.map((node) => node.name)).toEqual(["a", "b"]);
    expect(plan.edges.length).toBeGreaterThan(0);
  });

  it("expands subgraph macros, shore naming, ranges, and unsupported subgraphs", () => {
    const complete = buildGraphPlan(graphOperation("subgraph K_n [n=4, name shore v={name=Left}]"));
    expect(complete.nodes.map((node) => node.name)).toEqual(["Left 1", "Left 2", "Left 3", "Left 4"]);
    expect(complete.edges).toHaveLength(6);

    const bipartite = buildGraphPlan(
      graphOperation("subgraph K_nm [v={a,...,c}, w={3,...,1}, name shore v=V, name shore w={name=W}]")
    );
    expect(bipartite.nodes.map((node) => node.name)).toEqual(["V a", "V b", "V c", "W 3", "W 2", "W 1"]);
    expect(bipartite.edges).toHaveLength(9);

    const grid = buildGraphPlan(graphOperation("subgraph Grid_n [v={1,2,3,4,5}, wrap after=2]"));
    expect(grid.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(
      expect.arrayContaining(["1->2", "1->3", "3->4"])
    );

    const cycle = buildGraphPlan(graphOperation("subgraph C_n [n=3, circular placement, clockwise]"));
    expect(cycle.nodes).toHaveLength(3);
    expect(cycle.edges).toHaveLength(3);

    const unsupported = buildGraphPlan(graphOperation("subgraph Nope"));
    expect(unsupported.diagnostics).toEqual(["unsupported-subgraph:Nope"]);
    expect(unsupported.nodes).toEqual([]);
  });

  it("caps large subgraph expansions before they allocate unbounded edge lists", () => {
    const complete = buildGraphPlan(graphOperation("subgraph K_n [n=2000]"));

    expect(complete.nodes).toHaveLength(2000);
    expect(complete.edges).toHaveLength(10_000);
    expect(complete.diagnostics).toContain("graph-edge-budget-exceeded");

    const hugeRange = buildGraphPlan(graphOperation("subgraph P_n [v={1,...,100000000}]"));
    expect(hugeRange.nodes).toHaveLength(10_000);
    expect(hugeRange.diagnostics).toContain("graph-node-budget-exceeded");
  });
});
