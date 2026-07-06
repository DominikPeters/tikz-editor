import type { GraphOperationItem, GraphSpecChain, GraphSpecSegment, Span } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { worldPoint as makeWorldPoint, type WorldPoint } from "../../coords/points.js";
import { parseLength } from "../coords/parse-length.js";
import {
  findNextConnector,
  findTopLevelChar,
  mergeOptionLists,
  optionListFromEntries,
  optionListIfPresent,
  readBalancedSegment,
  readConnector,
  skipWhitespace,
  splitTopLevel,
  stripOptionListBrackets,
  trimRightIndex
} from "./graph-parse-utils.js";

const CONNECTOR_OPERATORS = ["<->", "-!-", "->", "<-", "--"] as const;
const DEFAULT_GRAPH_STEP_PT = parseLength("1cm", "cm")!;
const DEFAULT_GRAPH_SEP_PT = parseLength("1em", "cm")!;
const DEFAULT_GRAPH_RADIUS_PT = parseLength("1cm", "cm")!;
const BUILTIN_COLOR_CLASSES = ["all", "source", "target", "source'", "target'"] as const;
const GRAPH_NODE_BUDGET = 10_000;
const GRAPH_EDGE_BUDGET = 10_000;

type ConnectorOperator = (typeof CONNECTOR_OPERATORS)[number];
type GraphMode = "multi" | "simple";
type GraphNodeResolutionMode = "auto" | "fresh" | "existing";
type GraphOperatorContext = "group" | "edge";
type GraphPlacementMode = "none" | "cartesian" | "grid" | "circular";

type GraphVector2 = {
  x: number;
  y: number;
};

function graphPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

type GraphCircularPlacementState = {
  chainAngle: number;
  chainRadius: number;
  groupAngle: number;
  groupRadius: number;
  radius: number;
  phase: number;
};

type GraphNumberingState = {
  enabled: boolean;
  next: number;
  separator: string;
};

type GraphColorOp =
  | { kind: "add"; color: string }
  | { kind: "remove"; color: string }
  | { kind: "recolor"; from: string; to: string };

type GraphOperatorInvocation =
  | { kind: "clique"; color: string }
  | { kind: "cycle"; color: string }
  | { kind: "path"; color: string }
  | { kind: "complete-bipartite"; fromColor: string; toColor: string }
  | { kind: "matching"; fromColor: string; toColor: string }
  | { kind: "matching-star"; fromColor: string; toColor: string };

type GraphScopeState = {
  nodeOptionLists: OptionListAst[];
  edgeOptionLists: OptionListAst[];
  namePrefix: string;
  nameSeparator: string;
  nodeResolution: GraphNodeResolutionMode;
  numbering: GraphNumberingState;
  mode: GraphMode;
  asTextOverride?: string;
  emptyNodes: boolean;
  mathNodes: boolean;
  putNodeTextIncomingOptions: string[];
  putNodeTextOutgoingOptions: string[];
  trieEnabled: boolean;
  declaredColorClasses: Set<string>;
  defaultOperatorEdgeKind: ConnectorOperator;
  defaultJoinOperator: GraphOperatorInvocation;
  sourceAnchor: string | null;
  targetAnchor: string | null;
  chainSepAnchor: string | null;
  groupSepAnchor: string | null;
  autoNodeAnchor: string | null;
  placementMode: GraphPlacementMode;
  chainShift: GraphVector2;
  groupShift: GraphVector2;
  manualX: number | null;
  manualY: number | null;
  wrapAfter: number | null;
  nodeCountHint: number | null;
  circularPlacement: GraphCircularPlacementState;
  levelStyleOptionLists: Map<number, OptionListAst[]>;
  chainSepDistance: number | null;
  groupSepDistance: number | null;
  placementBaseChainShift: GraphVector2;
  placementBaseGroupShift: GraphVector2;
  placementResetsCounters: boolean;
};

type GraphNodeAccumulatorOp =
  | { kind: "clear-target" }
  | { kind: "clear-source" }
  | { kind: "add-target-style"; options: OptionListAst }
  | { kind: "add-source-style"; options: OptionListAst }
  | { kind: "add-target-node"; node: GraphPlannedEdgeNode }
  | { kind: "add-source-node"; node: GraphPlannedEdgeNode };

type GraphNodeRecord = {
  name: string;
  created: boolean;
  sourceEdgeOptionLists: OptionListAst[];
  targetEdgeOptionLists: OptionListAst[];
  sourceEdgeNodes: GraphPlannedEdgeNode[];
  targetEdgeNodes: GraphPlannedEdgeNode[];
};

type GraphColorMap = Map<string, string[]>;

export type GraphPlacementHint = {
  mode: GraphPlacementMode;
  logicalWidth: number;
  logicalDepth: number;
  level: number;
  chainShift: GraphVector2;
  groupShift: GraphVector2;
  chainSepDistance: number | null;
  groupSepDistance: number | null;
};

export type GraphPlannedNode = {
  name: string;
  text: string;
  options?: OptionListAst;
  span: Span;
  defaultPoint: WorldPoint;
  placementHint?: GraphPlacementHint;
};

export type GraphPlannedEdgeNode = {
  text: string;
  options?: OptionListAst;
  span: Span;
};

export type GraphPlannedEdge = {
  from: string;
  to: string;
  fromAnchor?: string;
  toAnchor?: string;
  operator: ConnectorOperator;
  options?: OptionListAst;
  nodes?: GraphPlannedEdgeNode[];
  span: Span;
};

type GraphPlannedEdgeInternal = GraphPlannedEdge & {
  passthroughSimple?: boolean;
};

export type GraphPlan = {
  nodes: GraphPlannedNode[];
  edges: GraphPlannedEdge[];
  diagnostics: string[];
};

type GraphTermResult = {
  entries: string[];
  exits: string[];
  edges: GraphPlannedEdgeInternal[];
  colors: GraphColorMap;
  logicalWidth: number;
  logicalDepth: number;
};

type GraphLayoutContext = {
  logicalWidth: number;
  logicalDepth: number;
  level: number;
};

type GraphChainSegmentInput = {
  raw: string;
  from: number;
  chain?: GraphSpecChain;
};

type GraphChainStep =
  | { kind: "done" }
  | { kind: "missing-right-node" }
  | {
      kind: "step";
      operator: ConnectorOperator;
      edgeOptions?: OptionListAst;
      span: Span;
      term: GraphTermResult;
    };

type GraphChainReader = {
  readFirst: (scope: GraphScopeState, layout: GraphLayoutContext) => GraphTermResult | null;
  readNext: (scope: GraphScopeState, layout: GraphLayoutContext) => GraphChainStep;
};

type ParsedDirectNodeSpec = {
  baseName: string;
  baseNameWasQuoted: boolean;
  textCandidate: string;
  explicitReference: boolean;
  options?: OptionListAst;
  span: Span;
};

type ParsedSubgraphSpec = {
  macro: "I_n" | "I_nm" | "K_n" | "K_nm" | "P_n" | "C_n" | "Grid_n";
  options?: OptionListAst;
  span: Span;
};

type ParsedSubgraphStructure = {
  verticesV: string[];
  verticesW: string[];
  nameShoreV: string;
  nameShoreW: string;
  wrapAfter: number | null;
};

export function buildGraphPlan(
  operation: GraphOperationItem,
  existingNodeSets?: ReadonlyMap<string, ReadonlySet<string> | readonly string[]>
): GraphPlan {
  const planner = new GraphPlanner(operation, existingNodeSets);
  planner.build();
  return {
    nodes: planner.nodes,
    edges: planner.edges,
    diagnostics: planner.diagnostics
  };
}

class GraphPlanner {
  readonly nodes: GraphPlannedNode[] = [];
  readonly edges: GraphPlannedEdge[] = [];
  readonly diagnostics: string[] = [];

  private readonly operation: GraphOperationItem;
  private readonly nodeRecords = new Map<string, GraphNodeRecord>();
  private readonly nodeSets = new Map<string, Set<string>>();
  private placementIndex = 0;
  private anonymousNodeCounter = 1;

  constructor(
    operation: GraphOperationItem,
    existingNodeSets?: ReadonlyMap<string, ReadonlySet<string> | readonly string[]>
  ) {
    this.operation = operation;
    if (existingNodeSets) {
      for (const [setName, rawMembers] of existingNodeSets.entries()) {
        const normalizedSetName = normalizeGraphText(setName);
        if (normalizedSetName.length === 0) {
          continue;
        }
        let members = this.nodeSets.get(normalizedSetName);
        if (!members) {
          members = new Set<string>();
          this.nodeSets.set(normalizedSetName, members);
        }
        for (const member of rawMembers) {
          const normalizedMember = normalizeGraphText(member);
          if (normalizedMember.length > 0) {
            members.add(normalizedMember);
          }
        }
      }
    }
  }

  build(): void {
    let rootScope = this.createRootScope();
    rootScope = this.applyGroupOptionControls(rootScope, this.operation.options);
    const term = this.parseGroup(
      this.operation.specRaw,
      this.operation.specSpan.from,
      rootScope,
      null,
      {
        logicalWidth: 0,
        logicalDepth: 0,
        level: 1
      },
      this.operation.spec?.segments
    );
    for (const edge of term.edges) {
      this.edges.push({
        from: edge.from,
        to: edge.to,
        fromAnchor: edge.fromAnchor,
        toAnchor: edge.toAnchor,
        operator: edge.operator,
        options: edge.options,
        nodes: edge.nodes,
        span: edge.span
      });
    }
  }

  private createRootScope(): GraphScopeState {
    return {
      nodeOptionLists: [],
      edgeOptionLists: [],
      namePrefix: "",
      nameSeparator: " ",
      nodeResolution: "auto",
      numbering: {
        enabled: false,
        next: 1,
        separator: " "
      },
      mode: "multi",
      asTextOverride: undefined,
      emptyNodes: false,
      mathNodes: false,
      putNodeTextIncomingOptions: [],
      putNodeTextOutgoingOptions: [],
      trieEnabled: false,
      declaredColorClasses: new Set(BUILTIN_COLOR_CLASSES),
      defaultOperatorEdgeKind: "--",
      defaultJoinOperator: {
        kind: "matching-star",
        fromColor: "target'",
        toColor: "source'"
      },
      sourceAnchor: null,
      targetAnchor: null,
      chainSepAnchor: null,
      groupSepAnchor: null,
      autoNodeAnchor: null,
      placementMode: "cartesian",
      chainShift: { x: DEFAULT_GRAPH_STEP_PT, y: 0 },
      groupShift: { x: 0, y: -DEFAULT_GRAPH_STEP_PT },
      manualX: null,
      manualY: null,
      wrapAfter: null,
      nodeCountHint: null,
      circularPlacement: {
        chainAngle: 0,
        chainRadius: 0,
        groupAngle: 45,
        groupRadius: 0,
        radius: DEFAULT_GRAPH_RADIUS_PT,
        phase: 90
      },
      levelStyleOptionLists: new Map(),
      chainSepDistance: null,
      groupSepDistance: null,
      placementBaseChainShift: { x: DEFAULT_GRAPH_STEP_PT, y: 0 },
      placementBaseGroupShift: { x: 0, y: -DEFAULT_GRAPH_STEP_PT },
      placementResetsCounters: false
    };
  }

  private cloneScope(scope: GraphScopeState): GraphScopeState {
    return {
      nodeOptionLists: [...scope.nodeOptionLists],
      edgeOptionLists: [...scope.edgeOptionLists],
      namePrefix: scope.namePrefix,
      nameSeparator: scope.nameSeparator,
      nodeResolution: scope.nodeResolution,
      // The numbering object is intentionally shared unless an option locally overrides it.
      numbering: scope.numbering,
      mode: scope.mode,
      asTextOverride: scope.asTextOverride,
      emptyNodes: scope.emptyNodes,
      mathNodes: scope.mathNodes,
      putNodeTextIncomingOptions: [...scope.putNodeTextIncomingOptions],
      putNodeTextOutgoingOptions: [...scope.putNodeTextOutgoingOptions],
      trieEnabled: scope.trieEnabled,
      declaredColorClasses: new Set(scope.declaredColorClasses),
      defaultOperatorEdgeKind: scope.defaultOperatorEdgeKind,
      defaultJoinOperator: cloneOperatorInvocation(scope.defaultJoinOperator),
      sourceAnchor: scope.sourceAnchor,
      targetAnchor: scope.targetAnchor,
      chainSepAnchor: scope.chainSepAnchor,
      groupSepAnchor: scope.groupSepAnchor,
      autoNodeAnchor: scope.autoNodeAnchor,
      placementMode: scope.placementMode,
      chainShift: { ...scope.chainShift },
      groupShift: { ...scope.groupShift },
      manualX: scope.manualX,
      manualY: scope.manualY,
      wrapAfter: scope.wrapAfter,
      nodeCountHint: scope.nodeCountHint,
      circularPlacement: { ...scope.circularPlacement },
      levelStyleOptionLists: cloneLevelStyleOptionLists(scope.levelStyleOptionLists),
      chainSepDistance: scope.chainSepDistance,
      groupSepDistance: scope.groupSepDistance,
      placementBaseChainShift: { ...scope.placementBaseChainShift },
      placementBaseGroupShift: { ...scope.placementBaseGroupShift },
      placementResetsCounters: scope.placementResetsCounters
    };
  }

  private parseGroup(
    raw: string,
    from: number,
    inheritedScope: GraphScopeState,
    parentMode: GraphMode | null,
    layout: GraphLayoutContext,
    parserSegments?: readonly GraphSpecSegment[]
  ): GraphTermResult {
    const groupBody = stripOuterBraces(raw);
    const bodyText = groupBody?.inner ?? raw.trim();
    const bodyFrom = groupBody ? from + groupBody.innerOffset : from;

    const leadingOptions = this.readLeadingOptionList(bodyText, bodyFrom);
    let scope = this.cloneScope(inheritedScope);
    if (leadingOptions) {
      scope = this.applyGroupOptionControls(scope, leadingOptions.options);
    }
    const resetPlacement = scope.placementResetsCounters;
    scope.placementResetsCounters = false;
    const groupLayout = resetPlacement
      ? {
          logicalWidth: 0,
          logicalDepth: 0,
          level: layout.level
        }
      : layout;
    const groupOptionPlan = this.extractGroupOptionPlan(leadingOptions?.options, scope);

    const content = leadingOptions ? bodyText.slice(leadingOptions.length).trim() : bodyText.trim();
    const contentFrom = leadingOptions ? bodyFrom + leadingOptions.length : bodyFrom;

    if (content.length === 0) {
      return {
        entries: [],
        exits: [],
        edges: this.finalizeGroupEdges(scope.mode, parentMode, []),
        colors: createEmptyColorMap(),
        logicalWidth: 0,
        logicalDepth: 0
      };
    }

    const segments: GraphChainSegmentInput[] =
      !leadingOptions && parserSegments && parserSegments.length > 0
        ? parserSegments.map((segment) => ({
            raw: segment.raw,
            from: segment.span.from,
            chain: segment.chain
          }))
        : splitTopLevel(content, [",", ";"], contentFrom);
    const edges: GraphPlannedEdgeInternal[] = [];
    let colors = createEmptyColorMap();
    let logicalWidth = 0;
    let logicalDepth = 0;

    for (const segment of segments) {
      if (segment.raw.trim().length === 0) {
        continue;
      }
      const chainResult = this.parseChain(segment.raw, segment.from, scope, {
        logicalWidth: groupLayout.logicalWidth,
        logicalDepth: groupLayout.logicalDepth + logicalDepth,
        level: groupLayout.level
      }, segment.chain);
      edges.push(...chainResult.edges);
      colors = mergeColorMaps(colors, chainResult.colors);
      logicalWidth = Math.max(logicalWidth, chainResult.logicalWidth);
      logicalDepth += chainResult.logicalDepth;
    }

    applyColorOperationsToNodes(colors, groupOptionPlan.colorOps, colorNodes(colors, "all"));

    if (groupOptionPlan.operators.length > 0) {
      edges.push(
        ...this.buildEdgesForOperators(
          groupOptionPlan.operators,
          colors,
          scope.defaultOperatorEdgeKind,
          {
            from: contentFrom,
            to: contentFrom + content.length
          },
          scope
        )
      );
    }

    const finalizedEdges = this.finalizeGroupEdges(scope.mode, parentMode, edges);
    return {
      entries: colorNodes(colors, "source"),
      exits: colorNodes(colors, "target"),
      edges: finalizedEdges,
      colors,
      logicalWidth,
      logicalDepth
    };
  }

  private finalizeGroupEdges(
    mode: GraphMode,
    parentMode: GraphMode | null,
    edges: GraphPlannedEdgeInternal[]
  ): GraphPlannedEdgeInternal[] {
    const finalized = mode === "simple" ? dedupeSimpleEdges(edges) : edges;
    if (mode === "multi" && parentMode === "simple") {
      return finalized.map((edge) => ({ ...edge, passthroughSimple: true }));
    }
    return finalized;
  }

  private parseChain(
    raw: string,
    from: number,
    scope: GraphScopeState,
    layout: GraphLayoutContext,
    parsedChain?: GraphSpecChain
  ): GraphTermResult {
    if (parsedChain && parsedChain.nodes.length > 0) {
      return this.parseChainFromParsedSpec(parsedChain, scope, layout);
    }

    let cursor = 0;
    return this.parseChainWithReader(scope, layout, {
      readFirst: (chainScope, nodeLayout) => {
        const first = this.parseNodeSpec(raw, from, cursor, chainScope, nodeLayout);
        if (!first) {
          return null;
        }
        cursor = first.next;
        return first.term;
      },
      readNext: (chainScope, nodeLayout) => {
        const afterSpace = skipWhitespace(raw, cursor);
        const connector = readConnector(raw, afterSpace, CONNECTOR_OPERATORS);
        if (!connector) {
          return { kind: "done" };
        }
        cursor = connector.next;

        const edgeOptionRead = this.readOptionList(raw, from, cursor);
        if (edgeOptionRead) {
          cursor = edgeOptionRead.next;
        }

        const nextNode = this.parseNodeSpec(raw, from, cursor, chainScope, nodeLayout);
        if (!nextNode) {
          return { kind: "missing-right-node" };
        }
        cursor = nextNode.next;
        return {
          kind: "step",
          operator: connector.operator,
          edgeOptions: edgeOptionRead?.options,
          span: {
            from: from + connector.index,
            to: from + nextNode.next
          },
          term: nextNode.term
        };
      }
    });
  }

  private parseChainFromParsedSpec(chain: GraphSpecChain, scope: GraphScopeState, layout: GraphLayoutContext): GraphTermResult {
    let index = 0;
    return this.parseChainWithReader(scope, layout, {
      readFirst: (chainScope, nodeLayout) => {
        const firstNodeSpec = chain.nodes[0];
        if (!firstNodeSpec) {
          return null;
        }
        return this.parseNodeTerm(firstNodeSpec.raw, firstNodeSpec.span.from, chainScope, nodeLayout);
      },
      readNext: (chainScope, nodeLayout) => {
        const pairCount = Math.min(chain.connectors.length, chain.nodes.length - 1);
        if (index >= pairCount) {
          return { kind: "done" };
        }

        const connector = chain.connectors[index];
        const nextNodeSpec = chain.nodes[index + 1];
        index += 1;
        const edgeOptions =
          connector.optionsRaw && connector.optionsSpan
            ? parseOptionListRaw(connector.optionsRaw, connector.optionsSpan.from)
            : undefined;
        const term = this.parseNodeTerm(nextNodeSpec.raw, nextNodeSpec.span.from, chainScope, nodeLayout);
        if (!term) {
          return { kind: "missing-right-node" };
        }
        return {
          kind: "step",
          operator: connector.operator,
          edgeOptions,
          span: {
            from: connector.span.from,
            to: nextNodeSpec.span.to
          },
          term
        };
      }
    });
  }

  private parseChainWithReader(scope: GraphScopeState, layout: GraphLayoutContext, reader: GraphChainReader): GraphTermResult {
    let chainWidth = 0;
    let chainDepth = 0;
    let levelOffset = 0;

    let chainScope = scope;
    const firstTerm = reader.readFirst(chainScope, {
      logicalWidth: layout.logicalWidth,
      logicalDepth: layout.logicalDepth,
      level: layout.level
    });
    if (!firstTerm) {
      return {
        entries: [],
        exits: [],
        edges: [],
        colors: createEmptyColorMap(),
        logicalWidth: 0,
        logicalDepth: 0
      };
    }

    chainWidth += firstTerm.logicalWidth;
    chainDepth = Math.max(chainDepth, firstTerm.logicalDepth);
    levelOffset += 1;
    chainScope = this.applyTrieChainPrefix(chainScope, firstTerm);

    const chainSources = [...firstTerm.entries];
    let chainTargets = [...firstTerm.exits];
    let chainColors = cloneColorMap(firstTerm.colors);
    const edges: GraphPlannedEdgeInternal[] = [...firstTerm.edges];

    while (true) {
      const step = reader.readNext(chainScope, {
        logicalWidth: layout.logicalWidth + chainWidth,
        logicalDepth: layout.logicalDepth,
        level: layout.level + levelOffset
      });
      if (step.kind === "done") {
        break;
      }
      if (step.kind === "missing-right-node") {
        this.diagnostics.push("graph-connector-without-right-node");
        break;
      }

      const edgePlan = this.extractEdgeOptionPlan(step.edgeOptions, chainScope);
      const nextTerm = step.term;
      edges.push(...nextTerm.edges);
      chainWidth += nextTerm.logicalWidth;
      chainDepth = Math.max(chainDepth, nextTerm.logicalDepth);
      levelOffset += 1;

      const nextSources = colorNodes(nextTerm.colors, "source");
      const nextTargets = colorNodes(nextTerm.colors, "target");

      const includeConnectorEdge = step.operator !== "-!-" || chainScope.mode === "simple";
      if (includeConnectorEdge) {
        const operatorColors = mergeColorMaps(chainColors, nextTerm.colors);
        setColorNodes(operatorColors, "target'", chainTargets);
        setColorNodes(operatorColors, "source'", nextSources);

        const operators = edgePlan.operators.length > 0 ? edgePlan.operators : [chainScope.defaultJoinOperator];
        for (const operator of operators) {
          edges.push(
            ...this.buildEdgesForOperators(
              [operator],
              operatorColors,
              step.operator,
              step.span,
              chainScope,
              edgePlan.styleOptions
            )
          );
        }
      }

      chainColors = mergeColorMaps(chainColors, nextTerm.colors);
      setColorNodes(chainColors, "source", chainSources);
      setColorNodes(chainColors, "target", nextTargets);
      chainTargets = [...nextTargets];
      chainScope = this.applyTrieChainPrefix(chainScope, nextTerm);
    }

    return {
      entries: chainSources,
      exits: chainTargets,
      edges,
      colors: chainColors,
      logicalWidth: chainWidth,
      logicalDepth: chainDepth
    };
  }

  private applyTrieChainPrefix(scope: GraphScopeState, term: GraphTermResult): GraphScopeState {
    if (!scope.trieEnabled) {
      return scope;
    }

    const candidateName = term.exits.length === 1 ? term.exits[0] : term.entries.length === 1 ? term.entries[0] : null;
    if (!candidateName || candidateName.length === 0) {
      return scope;
    }

    const nextScope = this.cloneScope(scope);
    nextScope.namePrefix = candidateName;
    return nextScope;
  }

  private parseNodeSpec(
    chainRaw: string,
    chainFrom: number,
    cursor: number,
    scope: GraphScopeState,
    layout: GraphLayoutContext
  ): { term: GraphTermResult; next: number } | null {
    const start = skipWhitespace(chainRaw, cursor);
    if (start >= chainRaw.length) {
      return null;
    }

    const groupSegment = readBalancedSegment(chainRaw, start, "{", "}");
    if (groupSegment) {
      const term = this.parseGroup(groupSegment.raw, chainFrom + start, scope, scope.mode, layout);
      return { term, next: groupSegment.next };
    }

    const connector = findNextConnector(chainRaw, start, CONNECTOR_OPERATORS);
    const end = connector ? connector.index : chainRaw.length;
    const rawNode = chainRaw.slice(start, end).trim();
    if (rawNode.length === 0) {
      this.diagnostics.push("empty-graph-node-spec");
      return null;
    }

    const term = this.parseNodeTerm(rawNode, chainFrom + start, scope, layout);
    if (!term) {
      return null;
    }

    return {
      term,
      next: end
    };
  }

  private parseNodeTerm(rawNode: string, nodeFrom: number, scope: GraphScopeState, layout: GraphLayoutContext): GraphTermResult | null {
    const trimmedNode = rawNode.trim();
    const balancedGroup = readBalancedSegment(trimmedNode, 0, "{", "}");
    if (balancedGroup?.next === trimmedNode.length) {
      return this.parseGroup(trimmedNode, nodeFrom, scope, scope.mode, layout);
    }

    const subgraphSpec = this.tryParseSubgraphSpec(trimmedNode, nodeFrom);
    if (subgraphSpec) {
      return this.expandSubgraph(subgraphSpec, scope, layout);
    }
    if (/^subgraph\b/i.test(trimmedNode)) {
      return {
        entries: [],
        exits: [],
        edges: [],
        colors: createEmptyColorMap(),
        logicalWidth: 0,
        logicalDepth: 0
      };
    }

    const parsedNode = this.parseDirectNode(trimmedNode, nodeFrom);
    const leveledScope = this.applyLevelStyles(scope, layout.level);
    const nodePlan = this.processNodeOptionList(leveledScope, parsedNode.options, parsedNode.textCandidate, parsedNode.span);
    const localScope = nodePlan.scope;

    const resolvedName = this.resolveDirectNodeName(parsedNode, localScope);
    const existingRecord = this.nodeRecords.get(resolvedName);
    const record = existingRecord ?? this.ensureNodeRecord(resolvedName);
    this.applyNodeAccumulatorOps(record, nodePlan.accumulatorOps);

    const mergedOptions = mergeOptionLists([
      ...optionListIfPresent(this.implicitNodeAnchorOption(localScope, parsedNode.span.from)),
      ...localScope.nodeOptionLists,
      ...(nodePlan.styleOptions ? [nodePlan.styleOptions] : [])
    ]);
    this.addNodeToSets(resolvedName, mergedOptions);

    const referencedSetMembers = parsedNode.explicitReference ? this.resolveNodeSetMembers(resolvedName) : null;
    if (parsedNode.explicitReference && referencedSetMembers && referencedSetMembers.length > 0) {
      for (const memberName of referencedSetMembers) {
        const memberRecord = this.ensureNodeRecord(memberName);
        this.applyNodeAccumulatorOps(memberRecord, nodePlan.accumulatorOps);
      }
      const colors = createColorMapFromNodes(referencedSetMembers);
      applyColorOperationsToNodes(colors, nodePlan.colorOps, referencedSetMembers);
      const edges = this.buildEdgesForOperators(
        nodePlan.operators,
        colors,
        localScope.defaultOperatorEdgeKind,
        parsedNode.span,
        localScope
      );
      return {
        entries: colorNodes(colors, "source"),
        exits: colorNodes(colors, "target"),
        edges,
        colors,
        logicalWidth: 0,
        logicalDepth: 0
      };
    }

    const shouldCreateFreshNode = this.shouldCreateFreshNode(parsedNode, localScope, existingRecord != null);
    if (shouldCreateFreshNode) {
      this.ensurePlannedNode(
        record,
        resolvedName,
        nodePlan.finalNodeText,
        mergedOptions,
        parsedNode.span,
        localScope,
        layout
      );
    }

    const colors = createColorMapFromNodes([resolvedName]);
    applyColorOperationsToNodes(colors, nodePlan.colorOps, [resolvedName]);

    const edges = this.buildEdgesForOperators(
      nodePlan.operators,
      colors,
      localScope.defaultOperatorEdgeKind,
      parsedNode.span,
      localScope
    );

    return {
      entries: colorNodes(colors, "source"),
      exits: colorNodes(colors, "target"),
      edges,
      colors,
      logicalWidth: shouldCreateFreshNode ? 1 : 0,
      logicalDepth: shouldCreateFreshNode ? 1 : 0
    };
  }

  private tryParseSubgraphSpec(raw: string, from: number): ParsedSubgraphSpec | null {
    let working = raw.trim();
    let options: OptionListAst | undefined;

    const trailingOptions = readTrailingOptionList(working);
    if (trailingOptions) {
      options = parseOptionListRaw(trailingOptions.raw, from + trailingOptions.start);
      working = working.slice(0, trailingOptions.start).trim();
    }

    const match = working.match(/^subgraph\s+([A-Za-z0-9_]+)$/i);
    if (!match) {
      return null;
    }

    const macroRaw = match[1];
    const normalizedMacro = macroRaw.toLowerCase();
    const macro: ParsedSubgraphSpec["macro"] | null =
      normalizedMacro === "i_n"
        ? "I_n"
        : normalizedMacro === "i_nm"
          ? "I_nm"
          : normalizedMacro === "k_n"
            ? "K_n"
            : normalizedMacro === "k_nm"
              ? "K_nm"
              : normalizedMacro === "p_n"
                ? "P_n"
                : normalizedMacro === "c_n"
                  ? "C_n"
                  : normalizedMacro === "grid_n"
                    ? "Grid_n"
                    : null;
    if (!macro) {
      this.diagnostics.push(`unsupported-subgraph:${macroRaw}`);
      return null;
    }

    return {
      macro,
      options,
      span: {
        from,
        to: from + raw.length
      }
    };
  }

  private expandSubgraph(spec: ParsedSubgraphSpec, scope: GraphScopeState, layout: GraphLayoutContext): GraphTermResult {
    let localScope = this.cloneScope(scope);
    localScope = this.applyGroupOptionControls(localScope, spec.options);
    const groupPlan = this.extractGroupOptionPlan(spec.options, localScope);
    const structure = parseSubgraphStructure(spec.options, this.diagnostics);

    const verticesV = structure.verticesV;
    const verticesW = structure.verticesW;
    const isBipartiteShoreLayout = spec.macro === "I_nm" || spec.macro === "K_nm";

    const vNames = this.createSubgraphNodes(
      verticesV,
      localScope,
      spec.span,
      structure.nameShoreV,
      {
        logicalWidth: layout.logicalWidth,
        logicalDepth: layout.logicalDepth,
        level: layout.level
      },
      spec.macro === "Grid_n" ? structure.wrapAfter : isBipartiteShoreLayout ? 1 : null
    );
    const wNames = this.createSubgraphNodes(
      verticesW,
      localScope,
      spec.span,
      structure.nameShoreW,
      isBipartiteShoreLayout
        ? {
            logicalWidth: layout.logicalWidth + (verticesV.length > 0 ? 1 : 0),
            logicalDepth: layout.logicalDepth,
            level: layout.level + (verticesV.length > 0 ? 1 : 0)
          }
        : {
            logicalWidth: layout.logicalWidth,
            logicalDepth: layout.logicalDepth + (verticesV.length > 0 ? 1 : 0),
            level: layout.level
          },
      isBipartiteShoreLayout ? 1 : null
    );

    const colors = createColorMapFromNodes([...vNames, ...wNames]);
    if (vNames.length > 0) {
      addNodesToColor(colors, "v", vNames);
    }
    if (wNames.length > 0) {
      addNodesToColor(colors, "w", wNames);
    }

    const edges: GraphPlannedEdgeInternal[] = [];
    const kind = localScope.defaultOperatorEdgeKind;

    switch (spec.macro) {
      case "I_n":
      case "I_nm":
        break;
      case "K_n": {
        edges.push(...this.buildEdgesForPairs(buildCliquePairs(vNames, GRAPH_EDGE_BUDGET), kind, spec.span, localScope));
        break;
      }
      case "K_nm": {
        edges.push(...this.buildEdgesForPairs(buildCompleteBipartitePairs(vNames, wNames, GRAPH_EDGE_BUDGET), kind, spec.span, localScope));
        break;
      }
      case "P_n": {
        edges.push(...this.buildEdgesForPairs(buildPathPairs(vNames), kind, spec.span, localScope));
        break;
      }
      case "C_n": {
        edges.push(...this.buildEdgesForPairs(buildCyclePairs(vNames), kind, spec.span, localScope));
        break;
      }
      case "Grid_n": {
        edges.push(...this.buildEdgesForPairs(buildGridPairs(vNames, structure.wrapAfter, GRAPH_EDGE_BUDGET), kind, spec.span, localScope));
        break;
      }
      default:
        break;
    }

    applyColorOperationsToNodes(colors, groupPlan.colorOps, colorNodes(colors, "all"));
    if (groupPlan.operators.length > 0) {
      edges.push(...this.buildEdgesForOperators(groupPlan.operators, colors, kind, spec.span, localScope));
    }

    const hasAnyNode = vNames.length + wNames.length > 0;
    const consumesOuterPlacementSlot = !(localScope.placementMode === "circular" && spec.macro === "C_n");

    return {
      entries: colorNodes(colors, "source"),
      exits: colorNodes(colors, "target"),
      edges: this.finalizeGroupEdges(localScope.mode, scope.mode, edges),
      colors,
      logicalWidth: hasAnyNode && consumesOuterPlacementSlot ? 1 : 0,
      logicalDepth: hasAnyNode && consumesOuterPlacementSlot ? 1 : 0
    };
  }

  private createSubgraphNodes(
    labels: string[],
    scope: GraphScopeState,
    span: Span,
    shorePrefix: string,
    layout: GraphLayoutContext,
    wrapAfter: number | null
  ): string[] {
    if (labels.length === 0) {
      return [];
    }

    const names: string[] = [];
    const localScope = shorePrefix.length > 0 ? appendScopedNamePrefix(scope, shorePrefix) : scope;
    const wrap = wrapAfter != null && wrapAfter > 0 ? Math.max(1, Math.floor(wrapAfter)) : null;
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      const col = wrap ? index % wrap : index;
      const row = wrap ? Math.floor(index / wrap) : 0;
      const nodeLayout: GraphLayoutContext = {
        logicalWidth: layout.logicalWidth + col,
        logicalDepth: layout.logicalDepth + row,
        level: layout.level + col
      };
      const styledScope = this.applyLevelStyles(localScope, nodeLayout.level);
      const nameToken = parseGraphNameToken(label);
      const textToken = parseGraphTextToken(label);
      const parsedNode: ParsedDirectNodeSpec = {
        baseName: nameToken.text,
        baseNameWasQuoted: nameToken.quoted,
        textCandidate: textToken.text,
        explicitReference: false,
        options: undefined,
        span
      };

      const resolvedName = this.resolveDirectNodeName(parsedNode, styledScope);
      const existingRecord = this.nodeRecords.get(resolvedName);
      const record = existingRecord ?? this.ensureNodeRecord(resolvedName);
      const mergedOptions = mergeOptionLists([
        ...optionListIfPresent(this.implicitNodeAnchorOption(styledScope, span.from)),
        ...styledScope.nodeOptionLists
      ]);
      this.addNodeToSets(resolvedName, mergedOptions);
      const shouldCreateFreshNode = this.shouldCreateFreshNode(parsedNode, styledScope, existingRecord != null);
      if (shouldCreateFreshNode) {
        this.ensurePlannedNode(
          record,
          resolvedName,
          this.resolveNodeText(styledScope, parsedNode.textCandidate),
          mergedOptions,
          span,
          styledScope,
          nodeLayout
        );
      }

      names.push(resolvedName);
    }

    return names;
  }

  private buildEdgesForPairs(
    pairs: Array<{ from: string; to: string }>,
    edgeKind: ConnectorOperator,
    span: Span,
    scope: GraphScopeState,
    edgeStyleOptions?: OptionListAst
  ): GraphPlannedEdgeInternal[] {
    const edges: GraphPlannedEdgeInternal[] = [];
    if (pairs.length >= GRAPH_EDGE_BUDGET) {
      pushUniqueDiagnostic(this.diagnostics, "graph-edge-budget-exceeded");
    }
    for (const pair of pairs) {
      if (edges.length >= GRAPH_EDGE_BUDGET) {
        pushUniqueDiagnostic(this.diagnostics, "graph-edge-budget-exceeded");
        break;
      }
      edges.push(this.createEdgeFromPair(pair.from, pair.to, edgeKind, span, scope, edgeStyleOptions));
    }
    return edges;
  }

  private parseDirectNode(raw: string, from: number): ParsedDirectNodeSpec {
    let working = stripTrailingGraphComment(raw).trim();
    let nodeOptions: OptionListAst | undefined;

    const trailingOptions = readTrailingOptionList(working);
    if (trailingOptions) {
      nodeOptions = parseOptionListRaw(trailingOptions.raw, from + trailingOptions.start);
      working = working.slice(0, trailingOptions.start).trim();
    }

    const slashIndex = findTopLevelChar(working, "/");
    let nameRaw = slashIndex >= 0 ? working.slice(0, slashIndex).trim() : working;
    let textRaw = slashIndex >= 0 ? working.slice(slashIndex + 1).trim() : "";

    let explicitReference = false;
    if (nameRaw.startsWith("(") && nameRaw.endsWith(")")) {
      nameRaw = stripOuterParens(nameRaw).trim();
      explicitReference = true;
      if (textRaw.length === 0) {
        textRaw = nameRaw;
      }
    }

    const nameToken = parseGraphNameToken(nameRaw);
    const textToken = textRaw.length > 0 ? parseGraphTextToken(textRaw) : { text: nameToken.text };

    return {
      baseName: nameToken.text,
      baseNameWasQuoted: nameToken.quoted,
      textCandidate: textToken.text,
      explicitReference,
      options: nodeOptions,
      span: {
        from,
        to: from + raw.length
      }
    };
  }

  private resolveDirectNodeName(parsedNode: ParsedDirectNodeSpec, scope: GraphScopeState): string {
    if (parsedNode.explicitReference) {
      let referencedName = parsedNode.baseNameWasQuoted
        ? canonicalizeQuotedNodeName(parsedNode.baseName)
        : parsedNode.baseName;
      if (referencedName.length === 0) {
        referencedName = this.nextAnonymousNodeName();
      }
      return referencedName;
    }

    let localName = parsedNode.baseNameWasQuoted ? canonicalizeQuotedNodeName(parsedNode.baseName) : parsedNode.baseName;
    if (localName.length === 0) {
      localName = this.nextAnonymousNodeName();
    }

    if (scope.numbering.enabled) {
      localName = `${localName}${scope.numbering.separator}${scope.numbering.next}`;
      scope.numbering.next += 1;
    }

    let fullName = scope.namePrefix.length > 0 ? `${scope.namePrefix}${scope.nameSeparator}${localName}` : localName;

    if (scope.nodeResolution === "fresh") {
      while (this.nodeRecords.has(fullName)) {
        fullName = `${fullName}'`;
      }
    }

    return fullName;
  }

  private shouldCreateFreshNode(parsedNode: ParsedDirectNodeSpec, scope: GraphScopeState, alreadySeenInGraph: boolean): boolean {
    if (parsedNode.explicitReference) {
      return false;
    }
    if (scope.nodeResolution === "existing") {
      return false;
    }
    if (scope.nodeResolution === "fresh") {
      return true;
    }
    return !alreadySeenInGraph;
  }

  private processNodeOptionList(
    baseScope: GraphScopeState,
    options: OptionListAst | undefined,
    baseNodeText: string,
    span: Span
  ): {
    scope: GraphScopeState;
    styleOptions?: OptionListAst;
    accumulatorOps: GraphNodeAccumulatorOp[];
    finalNodeText: string;
    colorOps: GraphColorOp[];
    operators: GraphOperatorInvocation[];
  } {
    let scope = this.cloneScope(baseScope);
    const accumulatorOps: GraphNodeAccumulatorOp[] = [];
    const colorOps: GraphColorOp[] = [];
    const operators: GraphOperatorInvocation[] = [];

    for (const optionsRaw of baseScope.putNodeTextIncomingOptions) {
      accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, optionsRaw, span, true));
    }
    for (const optionsRaw of baseScope.putNodeTextOutgoingOptions) {
      accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, optionsRaw, span, true));
    }

    if (!options) {
      return {
        scope,
        accumulatorOps,
        finalNodeText: this.resolveNodeText(scope, baseNodeText),
        colorOps,
        operators
      };
    }

    const retainedEntries: OptionEntry[] = [];

    for (const entry of options.entries) {
      const rawToken = entry.raw.trim();

      const directionalOps = parseDirectionalEdgeShortcut(rawToken, entry.span);
      if (directionalOps.length > 0) {
        accumulatorOps.push(...directionalOps);
        continue;
      }

      let consumed: boolean;

      if (entry.kind === "kv") {
        const key = normalizeGraphOptionKey(entry.key);

        if (key === "target edge style") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            accumulatorOps.push({ kind: "add-target-style", options: parsed });
          }
          consumed = true;
        } else if (key === "source edge style") {
          const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
          if (parsed) {
            accumulatorOps.push({ kind: "add-source-style", options: parsed });
          }
          consumed = true;
        } else if (key === "target edge node") {
          const parsed = parseGraphEdgeNodeValue(entry.valueRaw, entry.span, false);
          if (parsed) {
            accumulatorOps.push({ kind: "add-target-node", node: parsed });
          }
          consumed = true;
        } else if (key === "source edge node") {
          const parsed = parseGraphEdgeNodeValue(entry.valueRaw, entry.span, false);
          if (parsed) {
            accumulatorOps.push({ kind: "add-source-node", node: parsed });
          }
          consumed = true;
        } else if (key === "target edge clear" || key === "clear >") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled !== false) {
            accumulatorOps.push({ kind: "clear-target" });
          }
          consumed = true;
        } else if (key === "source edge clear" || key === "clear <") {
          const enabled = parseGraphBoolean(entry.valueRaw, true);
          if (enabled !== false) {
            accumulatorOps.push({ kind: "clear-source" });
          }
          consumed = true;
        } else if (key === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, entry.valueRaw, entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (key === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, entry.valueRaw, entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else {
          const control = applyGraphScopeControlEntry(scope, entry, { updatePlacementBase: true });
          scope = control.scope;
          consumed = control.consumed;
        }

        if (!consumed) {
          const colorOp = parseColorOpFromEntry(entry, scope.declaredColorClasses);
          if (colorOp) {
            colorOps.push(colorOp);
            consumed = true;
          }
        }

        if (!consumed) {
          const operatorInvocations = parseOperatorInvocationsFromEntry(entry, scope, "group");
          if (operatorInvocations.length > 0) {
            operators.push(...operatorInvocations);
            consumed = true;
          }
        }
      } else if (entry.kind === "flag") {
        const key = normalizeGraphOptionKey(entry.key);

        if (key === "target edge clear" || key === "clear >") {
          accumulatorOps.push({ kind: "clear-target" });
          consumed = true;
        } else if (key === "source edge clear" || key === "clear <") {
          accumulatorOps.push({ kind: "clear-source" });
          consumed = true;
        } else if (key === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (key === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else {
          const control = applyGraphScopeControlEntry(scope, entry, { updatePlacementBase: true });
          scope = control.scope;
          consumed = control.consumed;
        }

        if (!consumed) {
          const colorOp = parseColorOpFromEntry(entry, scope.declaredColorClasses);
          if (colorOp) {
            colorOps.push(colorOp);
            consumed = true;
          }
        }

        if (!consumed) {
          const operatorInvocations = parseOperatorInvocationsFromEntry(entry, scope, "group");
          if (operatorInvocations.length > 0) {
            operators.push(...operatorInvocations);
            consumed = true;
          }
        }
      } else {
        const normalizedRaw = normalizeGraphOptionKey(rawToken.toLowerCase());
        if (normalizedRaw === "clear >") {
          accumulatorOps.push({ kind: "clear-target" });
          consumed = true;
        } else if (normalizedRaw === "clear <") {
          accumulatorOps.push({ kind: "clear-source" });
          consumed = true;
        } else if (normalizedRaw === "put node text on incoming edges") {
          accumulatorOps.push(makeAddTargetNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else if (normalizedRaw === "put node text on outgoing edges") {
          accumulatorOps.push(makeAddSourceNodeOp(baseNodeText, "", entry.span, true));
          scope.asTextOverride = "";
          consumed = true;
        } else {
          const control = applyGraphScopeControlEntry(scope, entry, { updatePlacementBase: true });
          scope = control.scope;
          consumed = control.consumed;
        }
      }

      if (!consumed) {
        retainedEntries.push(entry);
      }
    }

    return {
      scope,
      styleOptions: optionListFromEntries(retainedEntries, options),
      accumulatorOps,
      finalNodeText: this.resolveNodeText(scope, baseNodeText),
      colorOps,
      operators
    };
  }

  private applyGroupOptionControls(
    baseScope: GraphScopeState,
    options: OptionListAst | undefined,
    updatePlacementBase = true
  ): GraphScopeState {
    if (!options) {
      return baseScope;
    }

    let scope = this.cloneScope(baseScope);

    for (const entry of options.entries) {
      if (entry.kind === "kv") {
        const key = normalizeGraphOptionKey(entry.key);
        if (key === "edge quotes") {
          const parsed = makeEdgeQuotesAppendStyleOption(entry.valueRaw, entry.span.from);
          if (parsed) {
            scope.edgeOptionLists.push(parsed);
          }
          continue;
        }
        if (key === "put node text on incoming edges") {
          scope.putNodeTextIncomingOptions.push(entry.valueRaw);
          scope.asTextOverride = "";
          continue;
        }
        if (key === "put node text on outgoing edges") {
          scope.putNodeTextOutgoingOptions.push(entry.valueRaw);
          scope.asTextOverride = "";
          continue;
        }
      } else if (entry.kind === "flag") {
        const key = normalizeGraphOptionKey(entry.key);
        if (key === "put node text on incoming edges") {
          scope.putNodeTextIncomingOptions.push("");
          scope.asTextOverride = "";
          continue;
        }
        if (key === "put node text on outgoing edges") {
          scope.putNodeTextOutgoingOptions.push("");
          scope.asTextOverride = "";
          continue;
        }
      }

      const control = applyGraphScopeControlEntry(scope, entry, {
        updatePlacementBase,
        allowBareNodeStateFlags: true
      });
      scope = control.scope;
    }

    return scope;
  }

  private extractGroupOptionPlan(
    options: OptionListAst | undefined,
    scope: GraphScopeState
  ): { colorOps: GraphColorOp[]; operators: GraphOperatorInvocation[] } {
    if (!options) {
      return { colorOps: [], operators: [] };
    }

    const colorOps: GraphColorOp[] = [];
    const operators: GraphOperatorInvocation[] = [];

    for (const entry of options.entries) {
      const maybeColorOp = parseColorOpFromEntry(entry, scope.declaredColorClasses);
      if (maybeColorOp) {
        colorOps.push(maybeColorOp);
      }

      const parsedOperators = parseOperatorInvocationsFromEntry(entry, scope, "group");
      if (parsedOperators.length > 0) {
        operators.push(...parsedOperators);
      }
    }

    return { colorOps, operators };
  }

  private extractEdgeOptionPlan(
    options: OptionListAst | undefined,
    scope: GraphScopeState
  ): { styleOptions?: OptionListAst; operators: GraphOperatorInvocation[] } {
    if (!options) {
      return { styleOptions: undefined, operators: [] };
    }

    const operators: GraphOperatorInvocation[] = [];
    const retainedEntries: OptionEntry[] = [];

    for (const entry of options.entries) {
      const parsedOperators = parseOperatorInvocationsFromEntry(entry, scope, "edge");
      if (parsedOperators.length > 0) {
        operators.push(...parsedOperators);
        continue;
      }
      retainedEntries.push(entry);
    }

    return {
      styleOptions: optionListFromEntries(retainedEntries, options),
      operators
    };
  }

  private addNodeToSets(nodeName: string, options: OptionListAst | undefined): void {
    if (!options || nodeName.length === 0) {
      return;
    }

    for (const setName of parseGraphSetNames(options)) {
      let members = this.nodeSets.get(setName);
      if (!members) {
        members = new Set<string>();
        this.nodeSets.set(setName, members);
      }
      members.add(nodeName);
    }
  }

  private resolveNodeSetMembers(setName: string): string[] | null {
    const normalizedSetName = normalizeGraphText(setName);
    if (normalizedSetName.length === 0) {
      return null;
    }
    const members = this.nodeSets.get(normalizedSetName);
    if (!members || members.size === 0) {
      return null;
    }
    return [...members];
  }

  private resolveNodeText(scope: GraphScopeState, baseText: string): string {
    if (scope.emptyNodes) {
      return "";
    }
    const rawText = scope.asTextOverride ?? baseText;
    if (scope.mathNodes && rawText.length > 0) {
      const trimmed = rawText.trim();
      if (!(trimmed.startsWith("$") && trimmed.endsWith("$"))) {
        return `$${rawText}$`;
      }
    }
    return rawText;
  }

  private ensureNodeRecord(name: string): GraphNodeRecord {
    const existing = this.nodeRecords.get(name);
    if (existing) {
      return existing;
    }

    const created: GraphNodeRecord = {
      name,
      created: false,
      sourceEdgeOptionLists: [],
      targetEdgeOptionLists: [],
      sourceEdgeNodes: [],
      targetEdgeNodes: []
    };
    this.nodeRecords.set(name, created);
    return created;
  }

  private applyNodeAccumulatorOps(record: GraphNodeRecord, operations: GraphNodeAccumulatorOp[]): void {
    for (const operation of operations) {
      if (operation.kind === "clear-target") {
        record.targetEdgeOptionLists = [];
        record.targetEdgeNodes = [];
        continue;
      }
      if (operation.kind === "clear-source") {
        record.sourceEdgeOptionLists = [];
        record.sourceEdgeNodes = [];
        continue;
      }
      if (operation.kind === "add-target-style") {
        record.targetEdgeOptionLists.push(operation.options);
        continue;
      }
      if (operation.kind === "add-source-style") {
        record.sourceEdgeOptionLists.push(operation.options);
        continue;
      }
      if (operation.kind === "add-target-node") {
        record.targetEdgeNodes.push(clonePlannedEdgeNode(operation.node));
        continue;
      }
      if (operation.kind === "add-source-node") {
        record.sourceEdgeNodes.push(clonePlannedEdgeNode(operation.node));
      }
    }
  }

  private ensurePlannedNode(
    record: GraphNodeRecord,
    name: string,
    text: string,
    options: OptionListAst | undefined,
    span: Span,
    scope: GraphScopeState,
    layout: GraphLayoutContext
  ): void {
    if (record.created) {
      return;
    }
    if (this.nodes.length >= GRAPH_NODE_BUDGET) {
      pushUniqueDiagnostic(this.diagnostics, "graph-node-budget-exceeded");
      record.created = true;
      return;
    }

    const placementSlot = this.placementIndex;
    this.placementIndex += 1;
    const defaultPoint = this.resolvePlacementPoint(scope, layout, placementSlot);
    const gridColumns = resolveGridColumns(scope.wrapAfter, scope.nodeCountHint);
    const gridColumn = placementSlot % gridColumns;
    const gridRow = Math.floor(placementSlot / gridColumns);

    this.nodes.push({
      name,
      text,
      options,
      span,
      defaultPoint,
      placementHint: {
        mode: scope.placementMode,
        logicalWidth: scope.placementMode === "grid" ? gridColumn : layout.logicalWidth,
        logicalDepth: scope.placementMode === "grid" ? gridRow : layout.logicalDepth,
        level: layout.level,
        chainShift: { ...scope.chainShift },
        groupShift: { ...scope.groupShift },
        chainSepDistance: scope.chainSepDistance,
        groupSepDistance: scope.groupSepDistance
      }
    });

    record.created = true;
  }

  private applyLevelStyles(baseScope: GraphScopeState, level: number): GraphScopeState {
    if (level <= 0 || baseScope.levelStyleOptionLists.size === 0) {
      return baseScope;
    }

    let scope = this.cloneScope(baseScope);
    let applied = false;
    for (let currentLevel = 1; currentLevel <= level; currentLevel += 1) {
      const optionLists = baseScope.levelStyleOptionLists.get(currentLevel);
      if (!optionLists || optionLists.length === 0) {
        continue;
      }
      applied = true;
      for (const optionList of optionLists) {
        scope = this.applyGroupOptionControls(scope, optionList, false);
      }
    }
    return applied ? scope : baseScope;
  }

  private implicitNodeAnchorOption(scope: GraphScopeState, from: number): OptionListAst | undefined {
    if (!scope.autoNodeAnchor) {
      return undefined;
    }
    return parseOptionListRaw(`[anchor=${scope.autoNodeAnchor}]`, from);
  }

  private resolveCumulativeCartesianChainOffset(scope: GraphScopeState, logicalWidth: number): GraphVector2 {
    const steps = Math.max(0, Math.floor(logicalWidth));
    if (steps === 0) {
      return graphPoint(0, 0);
    }

    let simulationScope = this.cloneScope(scope);
    simulationScope.chainShift = { ...scope.placementBaseChainShift };
    simulationScope.groupShift = { ...scope.placementBaseGroupShift };
    simulationScope.placementBaseChainShift = { ...scope.placementBaseChainShift };
    simulationScope.placementBaseGroupShift = { ...scope.placementBaseGroupShift };

    const offset: GraphVector2 = { x: 0, y: 0 };
    for (let step = 1; step <= steps; step += 1) {
      const levelOptionLists = scope.levelStyleOptionLists.get(step);
      if (levelOptionLists && levelOptionLists.length > 0) {
        for (const optionList of levelOptionLists) {
          simulationScope = this.applyGroupOptionControls(simulationScope, optionList, false);
        }
      }

      offset.x += simulationScope.chainShift.x;
      offset.y += simulationScope.chainShift.y;
    }

    return graphPoint(offset.x, offset.y);
  }

  private resolvePlacementPoint(
    scope: GraphScopeState,
    layout: GraphLayoutContext,
    placementSlot: number
  ): WorldPoint {
    let x = 0;
    let y = 0;

    if (scope.placementMode === "cartesian") {
      const chainOffset = this.resolveCumulativeCartesianChainOffset(scope, layout.logicalWidth);
      x = chainOffset.x + layout.logicalDepth * scope.groupShift.x;
      y = chainOffset.y + layout.logicalDepth * scope.groupShift.y;
    } else if (scope.placementMode === "grid") {
      const columns = resolveGridColumns(scope.wrapAfter, scope.nodeCountHint);
      const col = placementSlot % columns;
      const row = Math.floor(placementSlot / columns);
      x = col * scope.chainShift.x + row * scope.groupShift.x;
      y = col * scope.chainShift.y + row * scope.groupShift.y;
    } else if (scope.placementMode === "circular") {
      const angleDeg =
        scope.circularPlacement.phase +
        layout.logicalWidth * scope.circularPlacement.chainAngle +
        layout.logicalDepth * scope.circularPlacement.groupAngle;
      const radius =
        scope.circularPlacement.radius +
        layout.logicalWidth * scope.circularPlacement.chainRadius +
        layout.logicalDepth * scope.circularPlacement.groupRadius;
      const radians = (angleDeg * Math.PI) / 180;
      x = radius * Math.cos(radians);
      y = radius * Math.sin(radians);
    }

    if (scope.manualX != null) {
      x = scope.manualX;
    }
    if (scope.manualY != null) {
      y = scope.manualY;
    }

    return graphPoint(x, y);
  }

  private createEdgeFromPair(
    from: string,
    to: string,
    edgeKind: ConnectorOperator,
    span: Span,
    scope: GraphScopeState,
    edgeStyleOptions?: OptionListAst
  ): GraphPlannedEdgeInternal {
    const oriented = orientEdgeByKind(from, to, edgeKind);
    const normalizedKind = normalizeEdgeKindForOrientedPair(edgeKind);

    const sourceRecord = this.ensureNodeRecord(oriented.from);
    const targetRecord = this.ensureNodeRecord(oriented.to);

    const edgeOptions = mergeOptionLists([
      ...scope.edgeOptionLists,
      ...edgeKindOptionLists(normalizedKind),
      ...(edgeStyleOptions ? [edgeStyleOptions] : []),
      ...sourceRecord.sourceEdgeOptionLists,
      ...targetRecord.targetEdgeOptionLists
    ]);

    const edgeNodes = [
      ...sourceRecord.sourceEdgeNodes.map(clonePlannedEdgeNode),
      ...targetRecord.targetEdgeNodes.map(clonePlannedEdgeNode)
    ];

    return {
      from: oriented.from,
      to: oriented.to,
      fromAnchor: scope.sourceAnchor ?? undefined,
      toAnchor: scope.targetAnchor ?? undefined,
      operator: normalizedKind,
      options: edgeOptions,
      nodes: edgeNodes.length > 0 ? edgeNodes : undefined,
      span
    };
  }

  private buildEdgesForOperators(
    operators: GraphOperatorInvocation[],
    colors: GraphColorMap,
    edgeKind: ConnectorOperator,
    span: Span,
    scope: GraphScopeState,
    edgeStyleOptions?: OptionListAst
  ): GraphPlannedEdgeInternal[] {
    if (operators.length === 0) {
      return [];
    }

    const edges: GraphPlannedEdgeInternal[] = [];
    for (const operator of operators) {
      const pairs = buildOperatorPairs(operator, colors);
      if (pairs.length >= GRAPH_EDGE_BUDGET) {
        pushUniqueDiagnostic(this.diagnostics, "graph-edge-budget-exceeded");
      }
      for (const pair of pairs) {
        if (pair.from === pair.to) {
          continue;
        }
        if (edges.length >= GRAPH_EDGE_BUDGET) {
          pushUniqueDiagnostic(this.diagnostics, "graph-edge-budget-exceeded");
          break;
        }
        edges.push(this.createEdgeFromPair(pair.from, pair.to, edgeKind, span, scope, edgeStyleOptions));
      }
    }
    return edges;
  }

  private nextAnonymousNodeName(): string {
    const name = `__graph_anon_${this.anonymousNodeCounter}`;
    this.anonymousNodeCounter += 1;
    return name;
  }

  private readLeadingOptionList(raw: string, from: number): { options: OptionListAst; length: number } | null {
    const start = skipWhitespace(raw, 0);
    const segment = readBalancedSegment(raw, start, "[", "]");
    if (!segment) {
      return null;
    }
    const options = parseOptionListRaw(segment.raw, from + start);
    return {
      options,
      length: segment.next
    };
  }

  private readOptionList(raw: string, from: number, cursor: number): { options: OptionListAst; next: number } | null {
    const start = skipWhitespace(raw, cursor);
    const segment = readBalancedSegment(raw, start, "[", "]");
    if (!segment) {
      return null;
    }
    return {
      options: parseOptionListRaw(segment.raw, from + start),
      next: segment.next
    };
  }
}

type GraphScopeControlOptions = {
  updatePlacementBase: boolean;
  allowBareNodeStateFlags?: boolean;
};

function applyGraphScopeControlEntry(
  scope: GraphScopeState,
  entry: OptionEntry,
  options: GraphScopeControlOptions
): { consumed: boolean; scope: GraphScopeState } {
  if (entry.kind === "kv") {
    return applyGraphScopeControlKv(scope, entry, options.updatePlacementBase);
  }
  if (entry.kind === "flag") {
    return applyGraphScopeControlFlag(scope, normalizeGraphOptionKey(entry.key), options.updatePlacementBase);
  }

  const rawToken = normalizeGraphOptionKey(entry.raw.trim().toLowerCase());
  return applyGraphScopeControlBare(scope, rawToken, options);
}

function applyGraphScopeControlKv(
  scope: GraphScopeState,
  entry: Extract<OptionEntry, { kind: "kv" }>,
  updatePlacementBase: boolean
): { consumed: boolean; scope: GraphScopeState } {
  const key = normalizeGraphOptionKey(entry.key);

  if (key === "nodes") {
    const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
    if (parsed) {
      scope.nodeOptionLists.push(parsed);
    }
    return { consumed: true, scope };
  }
  if (key === "edge" || key === "edges") {
    const parsed = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
    if (parsed) {
      scope.edgeOptionLists.push(parsed);
    }
    return { consumed: true, scope };
  }
  if (key === "name") {
    return { consumed: true, scope: appendScopedNamePrefix(scope, normalizeGraphText(entry.valueRaw)) };
  }
  if (key === "name separator") {
    scope.nameSeparator = normalizeGraphText(entry.valueRaw);
    return { consumed: true, scope };
  }
  if (key === "as") {
    scope.asTextOverride = normalizeGraphText(entry.valueRaw);
    return { consumed: true, scope };
  }
  if (key === "empty nodes") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled != null) {
      scope.emptyNodes = enabled;
    }
    return { consumed: true, scope };
  }
  if (key === "math nodes") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled != null) {
      scope.mathNodes = enabled;
    }
    return { consumed: true, scope };
  }
  if (key === "trie") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled != null) {
      scope.trieEnabled = enabled;
    }
    return { consumed: true, scope };
  }
  if (key === "left anchor" || key === "source anchor") {
    scope.sourceAnchor = parseGraphAnchor(entry.valueRaw);
    return { consumed: true, scope };
  }
  if (key === "right anchor" || key === "target anchor") {
    scope.targetAnchor = parseGraphAnchor(entry.valueRaw);
    return { consumed: true, scope };
  }
  if (key === "edge label" || key === "edge label'" || key === "edge node") {
    scope.edgeOptionLists.push(parseOptionListRaw(`[${entry.raw}]`, entry.span.from));
    return { consumed: true, scope };
  }
  if (key === "use existing nodes") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled != null) {
      scope.nodeResolution = enabled ? "existing" : scope.nodeResolution === "existing" ? "auto" : scope.nodeResolution;
    }
    return { consumed: true, scope };
  }
  if (key === "fresh nodes") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled != null) {
      scope.nodeResolution = enabled ? "fresh" : scope.nodeResolution === "fresh" ? "auto" : scope.nodeResolution;
    }
    return { consumed: true, scope };
  }
  if (key === "number nodes") {
    return { consumed: true, scope: applyNumberNodes(scope, entry.valueRaw) };
  }
  if (key === "number nodes sep") {
    return { consumed: true, scope: applyNumberNodesSeparator(scope, normalizeGraphText(entry.valueRaw)) };
  }
  if (key === "simple") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled === true) {
      scope.mode = "simple";
    } else if (enabled === false && scope.mode === "simple") {
      scope.mode = "multi";
    }
    return { consumed: true, scope };
  }
  if (key === "multi") {
    const enabled = parseGraphBoolean(entry.valueRaw, true);
    if (enabled === true) {
      scope.mode = "multi";
    } else if (enabled === false && scope.mode === "multi") {
      scope.mode = "simple";
    }
    return { consumed: true, scope };
  }
  if (key === "color class") {
    const className = normalizeColorClassName(entry.valueRaw);
    if (className.length > 0) {
      scope.declaredColorClasses.add(className);
    }
    return { consumed: true, scope };
  }
  if (isDefaultEdgeKindKey(key)) {
    const parsedKind = parseDefaultEdgeKind(entry.valueRaw);
    if (parsedKind) {
      scope.defaultOperatorEdgeKind = parsedKind;
    }
    return { consumed: true, scope };
  }
  if (key === "default edge operator") {
    const operator = parseOperatorFromRaw(entry.valueRaw, scope, "edge");
    if (operator) {
      scope.defaultJoinOperator = operator;
    }
    return { consumed: true, scope };
  }

  const levelStyle = parseLevelStyleDefinition(entry);
  if (levelStyle) {
    addLevelStyleOption(scope.levelStyleOptionLists, levelStyle.level, levelStyle.options);
    return { consumed: true, scope };
  }
  if (applyPlacementControlFromKv(scope, key, entry.valueRaw, updatePlacementBase)) {
    return { consumed: true, scope };
  }

  return { consumed: false, scope };
}

function applyGraphScopeControlFlag(
  scope: GraphScopeState,
  key: string,
  updatePlacementBase: boolean
): { consumed: boolean; scope: GraphScopeState } {
  if (key === "simple") {
    scope.mode = "simple";
    return { consumed: true, scope };
  }
  if (key === "multi") {
    scope.mode = "multi";
    return { consumed: true, scope };
  }
  if (key === "fresh nodes") {
    scope.nodeResolution = "fresh";
    return { consumed: true, scope };
  }
  if (key === "use existing nodes") {
    scope.nodeResolution = "existing";
    return { consumed: true, scope };
  }
  if (key === "empty nodes") {
    scope.emptyNodes = true;
    return { consumed: true, scope };
  }
  if (key === "math nodes") {
    scope.mathNodes = true;
    return { consumed: true, scope };
  }
  if (key === "trie") {
    scope.trieEnabled = true;
    return { consumed: true, scope };
  }
  if (key === "number nodes") {
    return { consumed: true, scope: applyNumberNodes(scope) };
  }
  if (isEdgeKindFlag(key)) {
    scope.defaultOperatorEdgeKind = key as ConnectorOperator;
    return { consumed: true, scope };
  }
  if (applyPlacementControlFromFlag(scope, key, updatePlacementBase)) {
    return { consumed: true, scope };
  }
  return { consumed: false, scope };
}

function applyGraphScopeControlBare(
  scope: GraphScopeState,
  rawToken: string,
  options: GraphScopeControlOptions
): { consumed: boolean; scope: GraphScopeState } {
  if (rawToken === "simple") {
    scope.mode = "simple";
    return { consumed: true, scope };
  }
  if (rawToken === "multi") {
    scope.mode = "multi";
    return { consumed: true, scope };
  }
  if (options.allowBareNodeStateFlags) {
    if (rawToken === "empty nodes") {
      scope.emptyNodes = true;
      return { consumed: true, scope };
    }
    if (rawToken === "math nodes") {
      scope.mathNodes = true;
      return { consumed: true, scope };
    }
    if (rawToken === "trie") {
      scope.trieEnabled = true;
      return { consumed: true, scope };
    }
  }
  if (applyPlacementControlFromFlag(scope, rawToken, options.updatePlacementBase)) {
    return { consumed: true, scope };
  }
  return { consumed: false, scope };
}

function applyNumberNodes(scope: GraphScopeState, valueRaw?: string): GraphScopeState {
  if (valueRaw == null) {
    return {
      ...scope,
      numbering: {
        enabled: true,
        next: 1,
        separator: scope.numbering.separator
      }
    };
  }

  const booleanValue = parseGraphBoolean(valueRaw, true);
  if (booleanValue === false) {
    return {
      ...scope,
      numbering: {
        enabled: false,
        next: scope.numbering.next,
        separator: scope.numbering.separator
      }
    };
  }

  const parsedStart = parseGraphNumber(valueRaw);
  return {
    ...scope,
    numbering: {
      enabled: true,
      next: parsedStart ?? 1,
      separator: scope.numbering.separator
    }
  };
}

function applyNumberNodesSeparator(scope: GraphScopeState, separator: string): GraphScopeState {
  return {
    ...scope,
    numbering: {
      enabled: scope.numbering.enabled,
      next: scope.numbering.next,
      separator
    }
  };
}

function appendScopedNamePrefix(scope: GraphScopeState, rawName: string): GraphScopeState {
  if (rawName.length === 0) {
    return scope;
  }

  const nextPrefix =
    scope.namePrefix.length === 0 ? rawName : `${scope.namePrefix}${scope.nameSeparator}${rawName}`;
  return {
    ...scope,
    namePrefix: nextPrefix
  };
}

function cloneLevelStyleOptionLists(levelStyleOptionLists: Map<number, OptionListAst[]>): Map<number, OptionListAst[]> {
  const cloned = new Map<number, OptionListAst[]>();
  for (const [level, optionLists] of levelStyleOptionLists.entries()) {
    cloned.set(level, [...optionLists]);
  }
  return cloned;
}

function addLevelStyleOption(target: Map<number, OptionListAst[]>, level: number, options: OptionListAst): void {
  const existing = target.get(level) ?? [];
  target.set(level, [...existing, options]);
}

function parseLevelStyleDefinition(entry: OptionEntry): { level: number; options: OptionListAst } | null {
  if (entry.kind !== "kv") {
    return null;
  }

  const key = normalizeGraphOptionKey(entry.key);
  const match = key.match(/^level\s+(-?\d+)\s*\/\.style$/);
  if (!match) {
    return null;
  }

  const level = Number(match[1]);
  if (!Number.isFinite(level)) {
    return null;
  }

  const options = parseGraphValueAsOptionList(entry.valueRaw, entry.span.from);
  if (!options) {
    return null;
  }

  return {
    level: Math.floor(level),
    options
  };
}

function applyPlacementControlFromKv(scope: GraphScopeState, key: string, rawValue: string, updatePlacementBase: boolean): boolean {
  if (key === "no placement") {
    const enabled = parseGraphBoolean(rawValue, true);
    if (enabled === true) {
      scope.placementMode = "none";
      scope.placementResetsCounters = true;
    } else if (enabled === false && scope.placementMode === "none") {
      scope.placementMode = "cartesian";
    }
    return enabled != null;
  }
  if (key === "cartesian placement") {
    const enabled = parseGraphBoolean(rawValue, true);
    if (enabled === true) {
      scope.placementMode = "cartesian";
      scope.placementResetsCounters = true;
    }
    return enabled != null;
  }
  if (key === "grid placement") {
    const enabled = parseGraphBoolean(rawValue, true);
    if (enabled === true) {
      scope.placementMode = "grid";
      scope.placementResetsCounters = true;
    }
    return enabled != null;
  }
  if (key === "circular placement") {
    const enabled = parseGraphBoolean(rawValue, true);
    if (enabled === true) {
      scope.placementMode = "circular";
      scope.placementResetsCounters = true;
    }
    return enabled != null;
  }
  if (key === "x") {
    const parsed = parseGraphLength(rawValue);
    if (parsed != null) {
      scope.manualX = parsed;
      return true;
    }
    return false;
  }
  if (key === "y") {
    const parsed = parseGraphLength(rawValue);
    if (parsed != null) {
      scope.manualY = parsed;
      return true;
    }
    return false;
  }
  if (key === "n") {
    const parsed = parseGraphPositiveInteger(rawValue);
    if (parsed != null) {
      scope.nodeCountHint = parsed;
      return true;
    }
    return false;
  }
  if (key === "wrap after") {
    const parsed = parseGraphPositiveInteger(rawValue);
    if (parsed != null) {
      scope.wrapAfter = parsed;
      return true;
    }
    return false;
  }

  if (applyGrowBranchPlacement(scope, key, rawValue, true, updatePlacementBase)) {
    return true;
  }

  if (key === "radius") {
    const parsed = parseGraphLength(rawValue);
    if (parsed != null) {
      scope.circularPlacement.radius = parsed;
      return true;
    }
    return false;
  }
  if (key === "phase") {
    const parsed = parseGraphScalar(rawValue);
    if (parsed != null) {
      scope.circularPlacement.phase = parsed;
      return true;
    }
    return false;
  }
  if (key === "clockwise") {
    applyClockwisePlacement(scope, rawValue, true);
    return true;
  }
  if (key === "counterclockwise") {
    applyClockwisePlacement(scope, rawValue, false);
    return true;
  }

  return false;
}

function applyPlacementControlFromFlag(scope: GraphScopeState, key: string, updatePlacementBase: boolean): boolean {
  if (key === "no placement") {
    scope.placementMode = "none";
    scope.placementResetsCounters = true;
    return true;
  }
  if (key === "cartesian placement") {
    scope.placementMode = "cartesian";
    scope.placementResetsCounters = true;
    return true;
  }
  if (key === "grid placement") {
    scope.placementMode = "grid";
    scope.placementResetsCounters = true;
    return true;
  }
  if (key === "circular placement") {
    scope.placementMode = "circular";
    scope.placementResetsCounters = true;
    return true;
  }
  if (key === "clockwise") {
    applyClockwisePlacement(scope, undefined, true);
    return true;
  }
  if (key === "counterclockwise") {
    applyClockwisePlacement(scope, undefined, false);
    return true;
  }
  if (applyGrowBranchPlacement(scope, key, undefined, false, updatePlacementBase)) {
    return true;
  }
  return false;
}

function applyGrowBranchPlacement(
  scope: GraphScopeState,
  key: string,
  rawValue: string | undefined,
  allowBooleanDisable: boolean,
  updatePlacementBase: boolean
): boolean {
  const normalized = key.trim().toLowerCase();

  if (normalized === "grow right") {
    return setDirectionalShift(scope, "chain", { x: 1, y: 0 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "grow left") {
    return setDirectionalShift(scope, "chain", { x: -1, y: 0 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "grow up") {
    return setDirectionalShift(scope, "chain", { x: 0, y: 1 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "grow down") {
    return setDirectionalShift(scope, "chain", { x: 0, y: -1 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "branch right") {
    return setDirectionalShift(scope, "group", { x: 1, y: 0 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "branch left") {
    return setDirectionalShift(scope, "group", { x: -1, y: 0 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "branch up") {
    return setDirectionalShift(scope, "group", { x: 0, y: 1 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "branch down") {
    return setDirectionalShift(scope, "group", { x: 0, y: -1 }, rawValue, DEFAULT_GRAPH_STEP_PT, allowBooleanDisable, null, updatePlacementBase);
  }
  if (normalized === "grow right sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "chain",
      { x: 1, y: 0 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "grow left sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "chain",
      { x: -1, y: 0 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "grow up sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "chain",
      { x: 0, y: 1 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "grow down sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "chain",
      { x: 0, y: -1 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "branch right sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "group",
      { x: 1, y: 0 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "branch left sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "group",
      { x: -1, y: 0 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "branch up sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "group",
      { x: 0, y: 1 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }
  if (normalized === "branch down sep") {
    const sepDistance = parseGraphLength(rawValue) ?? DEFAULT_GRAPH_SEP_PT;
    return setDirectionalShift(
      scope,
      "group",
      { x: 0, y: -1 },
      rawValue,
      DEFAULT_GRAPH_STEP_PT + sepDistance,
      allowBooleanDisable,
      sepDistance,
      updatePlacementBase
    );
  }

  return false;
}

function setDirectionalShift(
  scope: GraphScopeState,
  axis: "chain" | "group",
  unitDirection: GraphVector2,
  rawValue: string | undefined,
  defaultMagnitude: number,
  allowBooleanDisable: boolean,
  sepDistance: number | null,
  updatePlacementBase: boolean
): boolean {
  if (rawValue != null && allowBooleanDisable) {
    const boolean = parseGraphBoolean(rawValue, true);
    if (boolean === false) {
      return true;
    }
  }

  const magnitude = parseGraphLength(rawValue) ?? defaultMagnitude;
  const vector = {
    x: unitDirection.x * magnitude,
    y: unitDirection.y * magnitude
  };
  if (axis === "chain") {
    scope.chainShift = vector;
    if (updatePlacementBase) {
      scope.placementBaseChainShift = { ...vector };
    }
    scope.chainSepDistance = sepDistance;
    scope.chainSepAnchor = sepDistance != null ? anchorOppositeDirection(unitDirection) : null;
  } else {
    scope.groupShift = vector;
    if (updatePlacementBase) {
      scope.placementBaseGroupShift = { ...vector };
    }
    scope.groupSepDistance = sepDistance;
    scope.groupSepAnchor = sepDistance != null ? anchorOppositeDirection(unitDirection) : null;
  }
  scope.autoNodeAnchor = combineSepAnchors(scope.chainSepAnchor, scope.groupSepAnchor);
  return true;
}

function applyClockwisePlacement(scope: GraphScopeState, rawValue: string | undefined, clockwise: boolean): void {
  scope.placementMode = "circular";
  scope.placementResetsCounters = true;
  let count = parseGraphPositiveInteger(rawValue);
  if (count == null || count <= 0) {
    count = scope.nodeCountHint ?? 0;
  }
  if (count <= 0) {
    count = 8;
  }
  const step = (clockwise ? -1 : 1) * (360 / count);
  // Different graph constructions advance either along chain slots
  // (subgraph expansions) or group depth (comma/semicolon lists),
  // so apply the circular step to both axes.
  scope.circularPlacement.chainAngle = step;
  scope.circularPlacement.groupAngle = step;
  scope.circularPlacement.groupRadius = 0;
}

function parseGraphScalar(raw: string): number | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }
  const value = Number(stripMatchingQuotes(normalized));
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function parseGraphLength(raw: string | undefined): number | null {
  if (raw == null) {
    return null;
  }
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }
  return parseLength(stripMatchingQuotes(normalized), "cm");
}

function parseGraphAnchor(raw: string | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const normalized = stripMatchingQuotes(stripWrappingBraces(raw).trim());
  return normalized.length > 0 ? normalized : null;
}

function anchorOppositeDirection(direction: GraphVector2): "east" | "west" | "north" | "south" {
  if (Math.abs(direction.x) >= Math.abs(direction.y)) {
    return direction.x >= 0 ? "west" : "east";
  }
  return direction.y >= 0 ? "south" : "north";
}

function combineSepAnchors(chainAnchor: string | null, groupAnchor: string | null): string | null {
  const vertical = [chainAnchor, groupAnchor].find((anchor) => anchor === "north" || anchor === "south") ?? null;
  const horizontal = [chainAnchor, groupAnchor].find((anchor) => anchor === "east" || anchor === "west") ?? null;

  if (vertical && horizontal) {
    return `${vertical} ${horizontal}`;
  }
  if (horizontal) {
    return horizontal;
  }
  if (vertical) {
    return vertical;
  }
  return groupAnchor ?? chainAnchor;
}

function parseGraphPositiveInteger(raw: string | undefined): number | null {
  if (raw == null) {
    return null;
  }
  const parsed = parseGraphNumber(raw);
  if (parsed == null || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveGridColumns(wrapAfter: number | null, nodeCountHint: number | null): number {
  if (wrapAfter != null && Number.isFinite(wrapAfter) && wrapAfter > 0) {
    return Math.max(1, Math.floor(wrapAfter));
  }
  if (nodeCountHint != null && Number.isFinite(nodeCountHint) && nodeCountHint > 0) {
    return Math.max(1, Math.round(Math.sqrt(nodeCountHint)));
  }
  return 1;
}

function cloneOperatorInvocation(operator: GraphOperatorInvocation): GraphOperatorInvocation {
  if (operator.kind === "clique" || operator.kind === "cycle" || operator.kind === "path") {
    return { ...operator };
  }
  return { ...operator };
}

function orientEdgeByKind(from: string, to: string, edgeKind: ConnectorOperator): { from: string; to: string } {
  if (edgeKind === "<-") {
    return { from: to, to: from };
  }
  return { from, to };
}

function normalizeEdgeKindForOrientedPair(edgeKind: ConnectorOperator): ConnectorOperator {
  return edgeKind === "<-" ? "->" : edgeKind;
}

function edgeKindOptionLists(edgeKind: ConnectorOperator): OptionListAst[] {
  const option = connectorToOptionList(edgeKind);
  return option ? [option] : [];
}

function parseDirectionalEdgeShortcut(rawToken: string, span: Span): GraphNodeAccumulatorOp[] {
  const trimmed = rawToken.trim();
  if (!(trimmed.startsWith(">") || trimmed.startsWith("<"))) {
    return [];
  }

  const direction = trimmed[0];
  const payload = trimmed.slice(1).trim();
  if (payload.length === 0) {
    return [];
  }

  if (payload.startsWith("\"")) {
    const quotedNode = parseQuotedEdgeNodePayload(payload);
    if (!quotedNode) {
      return [];
    }
    const node = makeGraphEdgeNode(quotedNode.text, quotedNode.optionsRaw, span, true);
    return [direction === ">" ? { kind: "add-target-node", node } : { kind: "add-source-node", node }];
  }

  const styleOptions = parseGraphValueAsOptionList(payload, span.from);
  if (!styleOptions) {
    return [];
  }
  return [direction === ">" ? { kind: "add-target-style", options: styleOptions } : { kind: "add-source-style", options: styleOptions }];
}

function makeAddTargetNodeOp(text: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphNodeAccumulatorOp {
  return {
    kind: "add-target-node",
    node: makeGraphEdgeNode(text, optionsRaw, span, defaultAuto)
  };
}

function makeAddSourceNodeOp(text: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphNodeAccumulatorOp {
  return {
    kind: "add-source-node",
    node: makeGraphEdgeNode(text, optionsRaw, span, defaultAuto)
  };
}

function makeGraphEdgeNode(textRaw: string, optionsRaw: string, span: Span, defaultAuto: boolean): GraphPlannedEdgeNode {
  const parsedOptions = parseGraphValueAsOptionList(optionsRaw, span.from);
  const mergedOptions =
    defaultAuto
      ? mergeOptionLists([
          parseOptionListRaw("[auto]", span.from),
          ...(parsedOptions ? [parsedOptions] : [])
        ])
      : parsedOptions;

  return {
    text: normalizeGraphText(textRaw),
    options: mergedOptions,
    span
  };
}

function parseGraphEdgeNodeValue(valueRaw: string, span: Span, defaultAuto: boolean): GraphPlannedEdgeNode | undefined {
  let working = stripWrappingBraces(valueRaw).trim();
  if (working.length === 0) {
    return undefined;
  }

  if (/^node\b/i.test(working)) {
    working = working.replace(/^node\b/i, "").trim();

    let optionRaw = "";
    if (working.startsWith("[")) {
      const optionSegment = readBalancedSegment(working, 0, "[", "]");
      if (optionSegment) {
        optionRaw = optionSegment.raw;
        working = working.slice(optionSegment.next).trim();
      }
    }

    const text = (() => {
      if (!working.startsWith("{")) {
        return working;
      }
      const textSegment = readBalancedSegment(working, 0, "{", "}");
      if (textSegment) {
        return textSegment.raw.slice(1, -1);
      }
      return stripWrappingBraces(working);
    })();

    const combinedOptions = stripOptionListBrackets(optionRaw);
    return makeGraphEdgeNode(text, combinedOptions, span, defaultAuto);
  }

  if (working.startsWith("\"")) {
    const quotedNode = parseQuotedEdgeNodePayload(working);
    if (quotedNode) {
      return makeGraphEdgeNode(quotedNode.text, quotedNode.optionsRaw, span, defaultAuto);
    }
  }

  return makeGraphEdgeNode(working, "", span, defaultAuto);
}

function parseQuotedEdgeNodePayload(raw: string): { text: string; optionsRaw: string } | null {
  const quoted = readQuotedText(raw, 0);
  if (!quoted) {
    return null;
  }

  let trailingOptions = raw.slice(quoted.next).trim();
  let swap = false;
  if (trailingOptions.startsWith("'")) {
    swap = true;
    trailingOptions = trailingOptions.slice(1).trim();
  }

  if (trailingOptions.startsWith("{")) {
    const block = readBalancedSegment(trailingOptions, 0, "{", "}");
    if (block) {
      const wrapped = stripWrappingBraces(block.raw).trim();
      trailingOptions = trailingOptions.slice(block.next).trim();
      trailingOptions = wrapped.length > 0 ? `${wrapped}${trailingOptions.length > 0 ? `,${trailingOptions}` : ""}` : trailingOptions;
    }
  }

  const normalizedOptions = swap ? (trailingOptions.length > 0 ? `swap,${trailingOptions}` : "swap") : trailingOptions;
  return {
    text: quoted.text,
    optionsRaw: normalizedOptions
  };
}

function parseGraphValueAsOptionList(valueRaw: string, from: number): OptionListAst | undefined {
  const normalized = stripWrappingBraces(valueRaw.trim());
  if (normalized.length === 0) {
    return undefined;
  }
  return parseOptionListRaw(`[${normalized}]`, from);
}

function parseGraphSetNames(options: OptionListAst): string[] {
  const names: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || normalizeGraphOptionKey(entry.key) !== "set") {
      continue;
    }
    const parts = splitTopLevel(stripWrappingBraces(entry.valueRaw), [","], 0);
    for (const part of parts) {
      const normalized = normalizeGraphText(part.raw);
      if (normalized.length > 0) {
        names.push(normalized);
      }
    }
  }
  return Array.from(new Set(names));
}

function normalizeGraphOptionKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("/tikz/graphs/")) {
    return trimmed.slice("/tikz/graphs/".length);
  }
  return trimmed;
}

function parseGraphBoolean(raw: string, defaultWhenOmitted: boolean): boolean | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return defaultWhenOmitted;
  }

  const token = stripMatchingQuotes(normalized).trim().toLowerCase();
  if (token.length === 0) {
    return defaultWhenOmitted;
  }
  if (token === "true" || token === "yes" || token === "on" || token === "1") {
    return true;
  }
  if (token === "false" || token === "no" || token === "off" || token === "0") {
    return false;
  }
  return null;
}

function makeEdgeQuotesAppendStyleOption(valueRaw: string, spanFrom: number): OptionListAst | null {
  const normalizedValue = stripWrappingBraces(valueRaw).trim();
  if (normalizedValue.length === 0) {
    return null;
  }
  return parseOptionListRaw(`[every edge quotes/.append style={${normalizedValue}}]`, spanFrom);
}

function parseGraphNumber(raw: string): number | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const value = Number(stripMatchingQuotes(normalized).trim());
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.floor(value);
}

function stripTrailingGraphComment(raw: string): string {
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      if (inQuote && raw[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (char === "%" && depthBrace === 0 && depthSquare === 0 && depthParen === 0) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw;
}

function parseGraphNameToken(raw: string): { text: string; quoted: boolean } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("\"")) {
    const quoted = readQuotedText(trimmed, 0);
    if (quoted && trimmed.slice(quoted.next).trim().length === 0) {
      return {
        text: quoted.text.trim(),
        quoted: true
      };
    }
  }
  return {
    text: normalizeGraphText(trimmed),
    quoted: false
  };
}

function parseGraphTextToken(raw: string): { text: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("\"")) {
    const quoted = readQuotedText(trimmed, 0);
    if (quoted && trimmed.slice(quoted.next).trim().length === 0) {
      return { text: quoted.text };
    }
  }
  return { text: normalizeGraphText(trimmed) };
}

function canonicalizeQuotedNodeName(raw: string): string {
  let encoded = "";
  for (const character of raw) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      encoded += character;
      continue;
    }

    const codePoint = character.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    encoded += `@u${codePoint.toString(16).toUpperCase()}@`;
  }
  return encoded.trim();
}

function normalizeGraphText(raw: string): string {
  const strippedBraces = stripOuterBraces(raw.trim())?.inner ?? raw.trim();
  const unquoted = stripMatchingQuotes(strippedBraces.trim());
  return unquoted.replaceAll('""', '"').trim();
}

function stripMatchingQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function stripWrappingBraces(raw: string): string {
  let normalized = raw.trim();
  while (true) {
    const stripped = stripOuterBraces(normalized);
    if (!stripped) {
      return normalized;
    }
    normalized = stripped.inner.trim();
  }
}

function stripOuterParens(raw: string): string {
  if (!raw.startsWith("(") || !raw.endsWith(")") || raw.length < 2) {
    return raw;
  }
  return raw.slice(1, -1);
}

function stripOuterBraces(raw: string): { inner: string; innerOffset: number } | null {
  if (!raw.startsWith("{") || !raw.endsWith("}") || raw.length < 2) {
    return null;
  }
  const segment = readBalancedSegment(raw, 0, "{", "}");
  if (segment?.next !== raw.length) {
    return null;
  }
  return {
    inner: raw.slice(1, -1).trim(),
    innerOffset: 1
  };
}

function readTrailingOptionList(raw: string): { raw: string; start: number } | null {
  const trimmedEnd = trimRightIndex(raw);
  if (trimmedEnd < 0 || raw[trimmedEnd] !== "]") {
    return null;
  }

  let depthSquare = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let inQuote = false;
  for (let index = trimmedEnd; index >= 0; index -= 1) {
    const char = raw[index];
    if (char === '"' && raw[index - 1] !== "\\") {
      if (inQuote && raw[index - 1] === '"') {
        index -= 1;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "]") {
      depthSquare += 1;
      continue;
    }
    if (char === "[") {
      depthSquare -= 1;
      if (depthSquare === 0 && depthBrace === 0 && depthParen === 0) {
        return {
          raw: raw.slice(index, trimmedEnd + 1),
          start: index
        };
      }
      continue;
    }
    if (char === "}") {
      depthBrace += 1;
      continue;
    }
    if (char === "{") {
      depthBrace -= 1;
      continue;
    }
    if (char === ")") {
      depthParen += 1;
      continue;
    }
    if (char === "(") {
      depthParen -= 1;
    }
  }

  return null;
}

function pairMatchingAndStar(left: string[], right: string[]): Array<{ from: string; to: string }> {
  if (left.length === 0 || right.length === 0) {
    return [];
  }

  const pairs: Array<{ from: string; to: string }> = [];
  const min = Math.min(left.length, right.length);
  for (let index = 0; index < min; index += 1) {
    pairs.push({ from: left[index], to: right[index] });
  }

  if (left.length > right.length) {
    const lastRight = right[right.length - 1];
    for (let index = min; index < left.length; index += 1) {
      pairs.push({ from: left[index], to: lastRight });
    }
  } else if (right.length > left.length) {
    const lastLeft = left[left.length - 1];
    for (let index = min; index < right.length; index += 1) {
      pairs.push({ from: lastLeft, to: right[index] });
    }
  }

  return pairs;
}

function buildPathPairs(nodes: string[], maxPairs = GRAPH_EDGE_BUDGET): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (let index = 1; index < nodes.length && pairs.length < maxPairs; index += 1) {
    pairs.push({ from: nodes[index - 1], to: nodes[index] });
  }
  return pairs;
}

function buildCyclePairs(nodes: string[], maxPairs = GRAPH_EDGE_BUDGET): Array<{ from: string; to: string }> {
  if (nodes.length <= 1) {
    return [];
  }
  const pairs = buildPathPairs(nodes, maxPairs);
  if (pairs.length < maxPairs) {
    pairs.push({ from: nodes[nodes.length - 1], to: nodes[0] });
  }
  return pairs;
}

function buildCliquePairs(nodes: string[], maxPairs = GRAPH_EDGE_BUDGET): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (pairs.length >= maxPairs) {
        return pairs;
      }
      pairs.push({ from: nodes[left], to: nodes[right] });
    }
  }
  return pairs;
}

function buildCompleteBipartitePairs(
  fromNodes: string[],
  toNodes: string[],
  maxPairs = GRAPH_EDGE_BUDGET
): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (const from of fromNodes) {
    for (const to of toNodes) {
      if (pairs.length >= maxPairs) {
        return pairs;
      }
      pairs.push({ from, to });
    }
  }
  return pairs;
}

function buildGridPairs(
  nodes: string[],
  wrapAfter: number | null,
  maxPairs = GRAPH_EDGE_BUDGET
): Array<{ from: string; to: string }> {
  if (nodes.length <= 1) {
    return [];
  }

  const wrap =
    wrapAfter != null && Number.isFinite(wrapAfter) && wrapAfter > 0
      ? Math.max(1, Math.floor(wrapAfter))
      : Math.max(1, Math.round(Math.sqrt(nodes.length)));

  const pairs: Array<{ from: string; to: string }> = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const row = Math.floor(index / wrap);
    const col = index % wrap;

    const rightIndex = index + 1;
    if (col + 1 < wrap && rightIndex < nodes.length && Math.floor(rightIndex / wrap) === row) {
      if (pairs.length >= maxPairs) {
        return pairs;
      }
      pairs.push({ from: nodes[index], to: nodes[rightIndex] });
    }

    const downIndex = index + wrap;
    if (downIndex < nodes.length) {
      if (pairs.length >= maxPairs) {
        return pairs;
      }
      pairs.push({ from: nodes[index], to: nodes[downIndex] });
    }
  }
  return pairs;
}

function connectorToOptionList(operator: ConnectorOperator): OptionListAst | undefined {
  if (operator === "--" || operator === "-!-") {
    return undefined;
  }
  return parseOptionListRaw(`[${operator}]`, 0);
}

function dedupeSimpleEdges(edges: GraphPlannedEdgeInternal[]): GraphPlannedEdgeInternal[] {
  const lastByPair = new Map<string, number>();
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.passthroughSimple) {
      continue;
    }
    lastByPair.set(simplePairKey(edge.from, edge.to), index);
  }

  const deduped: GraphPlannedEdgeInternal[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.passthroughSimple) {
      deduped.push(edge);
      continue;
    }

    const key = simplePairKey(edge.from, edge.to);
    if (lastByPair.get(key) !== index) {
      continue;
    }

    if (edge.operator === "-!-") {
      continue;
    }

    deduped.push(edge);
  }
  return deduped;
}

function simplePairKey(left: string, right: string): string {
  return left <= right ? `${left}::${right}` : `${right}::${left}`;
}

function clonePlannedEdgeNode(node: GraphPlannedEdgeNode): GraphPlannedEdgeNode {
  return {
    text: node.text,
    options: node.options,
    span: node.span
  };
}

function readQuotedText(raw: string, start: number): { text: string; next: number } | null {
  if (raw[start] !== '"') {
    return null;
  }

  let collected = "";
  let depthBrace = 0;
  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index];

    if (char === "\\" && index + 1 < raw.length) {
      collected += char;
      collected += raw[index + 1];
      index += 1;
      continue;
    }

    if (char === "{") {
      depthBrace += 1;
      collected += char;
      continue;
    }

    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      collected += char;
      continue;
    }

    if (char === '"' && depthBrace === 0) {
      if (raw[index + 1] === '"') {
        collected += '"';
        index += 1;
        continue;
      }
      return {
        text: collected,
        next: index + 1
      };
    }

    collected += char;
  }

  return null;
}

function normalizeColorClassName(raw: string): string {
  return normalizeGraphText(raw).toLowerCase();
}

function createEmptyColorMap(): GraphColorMap {
  return new Map();
}

function createColorMapFromNodes(nodes: string[]): GraphColorMap {
  const map = createEmptyColorMap();
  setColorNodes(map, "all", nodes);
  setColorNodes(map, "source", nodes);
  setColorNodes(map, "target", nodes);
  return map;
}

function cloneColorMap(colors: GraphColorMap): GraphColorMap {
  const cloned = createEmptyColorMap();
  for (const [key, values] of colors.entries()) {
    cloned.set(key, [...values]);
  }
  return cloned;
}

function mergeColorMaps(left: GraphColorMap, right: GraphColorMap): GraphColorMap {
  const merged = cloneColorMap(left);
  for (const [key, values] of right.entries()) {
    const existing = merged.get(key) ?? [];
    merged.set(key, mergeUnique(existing, values));
  }
  return merged;
}

function colorNodes(colors: GraphColorMap, color: string): string[] {
  return [...(colors.get(color.toLowerCase()) ?? [])];
}

function setColorNodes(colors: GraphColorMap, color: string, nodes: string[]): void {
  colors.set(color.toLowerCase(), mergeUnique([], nodes));
}

function addNodesToColor(colors: GraphColorMap, color: string, nodes: string[]): void {
  const key = color.toLowerCase();
  const existing = colors.get(key) ?? [];
  colors.set(key, mergeUnique(existing, nodes));
}

function removeNodesFromColor(colors: GraphColorMap, color: string, nodes: string[]): void {
  const key = color.toLowerCase();
  const existing = colors.get(key);
  if (!existing) {
    return;
  }
  const toRemove = new Set(nodes);
  colors.set(
    key,
    existing.filter((node) => !toRemove.has(node))
  );
}

function applyColorOperationsToNodes(colors: GraphColorMap, ops: GraphColorOp[], nodes: string[]): void {
  for (const op of ops) {
    if (op.kind === "add") {
      addNodesToColor(colors, op.color, nodes);
      continue;
    }
    if (op.kind === "remove") {
      removeNodesFromColor(colors, op.color, nodes);
      continue;
    }

    const eligibleNodes = new Set(nodes);
    const fromNodes = colorNodes(colors, op.from).filter((node) => eligibleNodes.has(node));
    removeNodesFromColor(colors, op.from, fromNodes);
    addNodesToColor(colors, op.to, fromNodes);
  }
}

function parseColorOpFromEntry(entry: OptionEntry, declaredColorClasses: Set<string>): GraphColorOp | undefined {
  if (entry.kind === "kv") {
    const key = normalizeGraphOptionKey(entry.key);
    const recolorMatch = key.match(/^recolor\s+(.+)\s+by$/);
    if (!recolorMatch) {
      return undefined;
    }

    const from = normalizeColorClassName(recolorMatch[1]);
    const to = normalizeColorClassName(entry.valueRaw);
    if (from.length === 0 || to.length === 0) {
      return undefined;
    }

    return {
      kind: "recolor",
      from,
      to
    };
  }

  if (entry.kind === "flag") {
    const key = normalizeGraphOptionKey(entry.key);
    const removeByNotMatch = key.match(/^not\s+(.+)$/);
    if (removeByNotMatch) {
      const color = normalizeColorClassName(removeByNotMatch[1]);
      if (color.length > 0 && isKnownColorClass(color, declaredColorClasses)) {
        return { kind: "remove", color };
      }
      return undefined;
    }

    if (key.startsWith("!")) {
      const color = normalizeColorClassName(key.slice(1));
      if (color.length > 0 && isKnownColorClass(color, declaredColorClasses)) {
        return { kind: "remove", color };
      }
      return undefined;
    }

    const color = normalizeColorClassName(key);
    if (color.length > 0 && isKnownColorClass(color, declaredColorClasses)) {
      return { kind: "add", color };
    }
  }

  return undefined;
}

function isKnownColorClass(color: string, declaredColorClasses: Set<string>): boolean {
  if (declaredColorClasses.has(color)) {
    return true;
  }
  return BUILTIN_COLOR_CLASSES.includes(color as (typeof BUILTIN_COLOR_CLASSES)[number]);
}

function parseOperatorInvocationsFromEntry(
  entry: OptionEntry,
  scope: GraphScopeState,
  context: GraphOperatorContext
): GraphOperatorInvocation[] {
  if (entry.kind === "kv") {
    const key = normalizeGraphOptionKey(entry.key);

    if (key === "operator") {
      const parsed = parseOperatorsFromRaw(entry.valueRaw, scope, context);
      return parsed;
    }

    if (key === "clique") {
      return [{ kind: "clique", color: parseSingleColor(entry.valueRaw, "all") }];
    }
    if (key === "cycle") {
      return [{ kind: "cycle", color: parseSingleColor(entry.valueRaw, "all") }];
    }
    if (key === "path") {
      return [{ kind: "path", color: parseSingleColor(entry.valueRaw, "all") }];
    }
    if (key === "complete bipartite") {
      const pair = parseColorPair(entry.valueRaw, context === "edge" ? "target'" : "all", context === "edge" ? "source'" : "all");
      return [{ kind: "complete-bipartite", fromColor: pair.from, toColor: pair.to }];
    }
    if (key === "matching") {
      const pair = parseColorPair(entry.valueRaw, context === "edge" ? "target'" : "all", context === "edge" ? "source'" : "all");
      return [{ kind: "matching", fromColor: pair.from, toColor: pair.to }];
    }
    if (key === "matching and star") {
      const pair = parseColorPair(entry.valueRaw, context === "edge" ? "target'" : "all", context === "edge" ? "source'" : "all");
      return [{ kind: "matching-star", fromColor: pair.from, toColor: pair.to }];
    }

    return [];
  }

  if (entry.kind === "flag") {
    const key = normalizeGraphOptionKey(entry.key);
    if (key === "clique") {
      return [{ kind: "clique", color: "all" }];
    }
    if (key === "cycle") {
      return [{ kind: "cycle", color: "all" }];
    }
    if (key === "path") {
      return [{ kind: "path", color: "all" }];
    }
    if (key === "complete bipartite") {
      return [{ kind: "complete-bipartite", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
    }
    if (key === "matching") {
      return [{ kind: "matching", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
    }
    if (key === "matching and star") {
      return [{ kind: "matching-star", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
    }
  }

  return [];
}

function parseOperatorFromRaw(raw: string, scope: GraphScopeState, context: GraphOperatorContext): GraphOperatorInvocation | null {
  const parsed = parseOperatorsFromRaw(raw, scope, context);
  if (parsed.length === 0) {
    return null;
  }
  return parsed[0];
}

function parseOperatorsFromRaw(raw: string, scope: GraphScopeState, context: GraphOperatorContext): GraphOperatorInvocation[] {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return [];
  }

  const optionList = parseGraphValueAsOptionList(normalized, 0);
  if (optionList) {
    const collected: GraphOperatorInvocation[] = [];
    for (const entry of optionList.entries) {
      collected.push(...parseOperatorInvocationsFromEntry(entry, scope, context));
    }
    if (collected.length > 0) {
      return collected;
    }
  }

  const key = normalizeGraphOptionKey(normalized);
  if (key === "clique") {
    return [{ kind: "clique", color: "all" }];
  }
  if (key === "cycle") {
    return [{ kind: "cycle", color: "all" }];
  }
  if (key === "path") {
    return [{ kind: "path", color: "all" }];
  }
  if (key === "complete bipartite") {
    return [{ kind: "complete-bipartite", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
  }
  if (key === "matching") {
    return [{ kind: "matching", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
  }
  if (key === "matching and star") {
    return [{ kind: "matching-star", fromColor: context === "edge" ? "target'" : "all", toColor: context === "edge" ? "source'" : "all" }];
  }
  return [];
}

function parseSingleColor(raw: string, defaultColor: string): string {
  const normalized = normalizeColorClassName(raw);
  return normalized.length > 0 ? normalized : defaultColor;
}

function parseColorPair(raw: string, defaultFrom: string, defaultTo: string): { from: string; to: string } {
  const trimmed = stripWrappingBraces(raw).trim();
  if (trimmed.length === 0) {
    return { from: defaultFrom, to: defaultTo };
  }

  const braces: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    cursor = skipWhitespace(trimmed, cursor);
    if (cursor >= trimmed.length || trimmed[cursor] !== "{") {
      break;
    }
    const segment = readBalancedSegment(trimmed, cursor, "{", "}");
    if (!segment) {
      break;
    }
    braces.push(segment.raw.slice(1, -1));
    cursor = segment.next;
  }

  if (braces.length >= 2) {
    const from = normalizeColorClassName(braces[0]);
    const to = normalizeColorClassName(braces[1]);
    return {
      from: from.length > 0 ? from : defaultFrom,
      to: to.length > 0 ? to : defaultTo
    };
  }

  const commaParts = splitTopLevel(trimmed, [","], 0)
    .map((part) => part.raw.trim())
    .filter((part) => part.length > 0);
  if (commaParts.length >= 2) {
    const from = normalizeColorClassName(commaParts[0]);
    const to = normalizeColorClassName(commaParts[1]);
    return {
      from: from.length > 0 ? from : defaultFrom,
      to: to.length > 0 ? to : defaultTo
    };
  }

  return {
    from: defaultFrom,
    to: defaultTo
  };
}

function buildOperatorPairs(operator: GraphOperatorInvocation, colors: GraphColorMap): Array<{ from: string; to: string }> {
  if (operator.kind === "clique") {
    return buildCliquePairs(colorNodes(colors, operator.color));
  }
  if (operator.kind === "cycle") {
    return buildCyclePairs(colorNodes(colors, operator.color));
  }
  if (operator.kind === "path") {
    return buildPathPairs(colorNodes(colors, operator.color));
  }

  const fromNodes = colorNodes(colors, operator.fromColor);
  const toNodes = colorNodes(colors, operator.toColor);

  if (operator.kind === "complete-bipartite") {
    return buildCompleteBipartitePairs(fromNodes, toNodes);
  }
  if (operator.kind === "matching") {
    const pairs: Array<{ from: string; to: string }> = [];
    const min = Math.min(fromNodes.length, toNodes.length);
    for (let index = 0; index < min; index += 1) {
      pairs.push({ from: fromNodes[index], to: toNodes[index] });
    }
    return pairs;
  }
  return pairMatchingAndStar(fromNodes, toNodes);
}

function isEdgeKindFlag(key: string): boolean {
  return key === "--" || key === "->" || key === "<-" || key === "<->" || key === "-!-";
}

function isDefaultEdgeKindKey(key: string): boolean {
  return key === "default edge kind" || key === "edge kind";
}

function parseDefaultEdgeKind(raw: string): ConnectorOperator | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (isEdgeKindFlag(normalized)) {
    return normalized as ConnectorOperator;
  }
  return null;
}

function parseSubgraphStructure(options: OptionListAst | undefined, diagnostics: string[]): ParsedSubgraphStructure {
  let verticesV: string[] = [];
  let verticesW: string[] = [];
  let n: number | null = null;
  let m: number | null = null;
  let wrapAfter: number | null = null;
  let nameShoreV = "";
  let nameShoreW = "";

  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeGraphOptionKey(entry.key);
    if (key === "v") {
      verticesV = parseVertexList(entry.valueRaw, diagnostics);
      continue;
    }
    if (key === "w") {
      verticesW = parseVertexList(entry.valueRaw, diagnostics);
      continue;
    }
    if (key === "n") {
      n = parseGraphNumber(entry.valueRaw);
      continue;
    }
    if (key === "m") {
      m = parseGraphNumber(entry.valueRaw);
      continue;
    }
    if (key === "wrap after") {
      wrapAfter = parseGraphNumber(entry.valueRaw);
      continue;
    }
    if (key === "name shore v") {
      nameShoreV = parseShoreName(entry.valueRaw);
      continue;
    }
    if (key === "name shore w") {
      nameShoreW = parseShoreName(entry.valueRaw);
    }
  }

  if (verticesV.length === 0 && n != null && n > 0) {
    verticesV = sequenceLabels(n, diagnostics);
    if (nameShoreV.length === 0) {
      nameShoreV = "V";
    }
  }

  if (verticesW.length === 0 && m != null && m > 0) {
    verticesW = sequenceLabels(m, diagnostics);
    if (nameShoreW.length === 0) {
      nameShoreW = "W";
    }
  }

  return {
    verticesV,
    verticesW,
    nameShoreV,
    nameShoreW,
    wrapAfter
  };
}

function parseShoreName(raw: string): string {
  const nested = parseGraphValueAsOptionList(raw, 0);
  if (nested) {
    for (const entry of nested.entries) {
      if (entry.kind === "kv" && entry.key === "name") {
        return normalizeGraphText(entry.valueRaw);
      }
    }
  }
  return normalizeGraphText(raw);
}

function parseVertexList(raw: string, diagnostics: string[]): string[] {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return [];
  }

  const parts = splitTopLevel(normalized, [","], 0)
    .map((segment) => segment.raw.trim())
    .filter((segment) => segment.length > 0);

  if (parts.length === 3 && parts[1] === "...") {
    const expanded = expandRange(parts[0], parts[2], diagnostics);
    if (expanded.length > 0) {
      return expanded;
    }
  }

  if (parts.length > GRAPH_NODE_BUDGET) {
    pushUniqueDiagnostic(diagnostics, "graph-node-budget-exceeded");
  }
  return parts.slice(0, GRAPH_NODE_BUDGET).map((part) => parseGraphTextToken(part).text);
}

function expandRange(leftRaw: string, rightRaw: string, diagnostics: string[]): string[] {
  const left = normalizeGraphText(leftRaw);
  const right = normalizeGraphText(rightRaw);

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    const from = Math.floor(leftNumber);
    const to = Math.floor(rightNumber);
    const count = Math.abs(to - from) + 1;
    if (count > GRAPH_NODE_BUDGET) {
      pushUniqueDiagnostic(diagnostics, "graph-node-budget-exceeded");
    }
    const result: string[] = [];
    if (from <= to) {
      for (let current = from; current <= to && result.length < GRAPH_NODE_BUDGET; current += 1) {
        result.push(String(current));
      }
    } else {
      for (let current = from; current >= to && result.length < GRAPH_NODE_BUDGET; current -= 1) {
        result.push(String(current));
      }
    }
    return result;
  }

  if (left.length === 1 && right.length === 1) {
    const leftCode = left.codePointAt(0)!;
    const rightCode = right.codePointAt(0)!;
    const count = Math.abs(rightCode - leftCode) + 1;
    if (count > GRAPH_NODE_BUDGET) {
      pushUniqueDiagnostic(diagnostics, "graph-node-budget-exceeded");
    }
    const result: string[] = [];
    if (leftCode <= rightCode) {
      for (let code = leftCode; code <= rightCode && result.length < GRAPH_NODE_BUDGET; code += 1) {
        result.push(String.fromCodePoint(code));
      }
    } else {
      for (let code = leftCode; code >= rightCode && result.length < GRAPH_NODE_BUDGET; code -= 1) {
        result.push(String.fromCodePoint(code));
      }
    }
    return result;
  }

  return [];
}

function sequenceLabels(count: number, diagnostics: string[]): string[] {
  if (count > GRAPH_NODE_BUDGET) {
    pushUniqueDiagnostic(diagnostics, "graph-node-budget-exceeded");
  }
  const labels: string[] = [];
  for (let index = 1; index <= count && labels.length < GRAPH_NODE_BUDGET; index += 1) {
    labels.push(String(index));
  }
  return labels;
}

function mergeUnique(base: string[], next: string[]): string[] {
  const merged = [...base];
  const seen = new Set(merged);
  for (const value of next) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

function pushUniqueDiagnostic(diagnostics: string[], diagnostic: string): void {
  if (!diagnostics.includes(diagnostic)) {
    diagnostics.push(diagnostic);
  }
}
