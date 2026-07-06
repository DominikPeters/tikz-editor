import type { EditActionResultLike } from "../result-types.js";
import type { OptionListAst } from "../../options/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type { SemanticDependencyGraph } from "../../semantic/dependencies.js";
import type { Statement, Span } from "../../ast/types.js";
import { parseEditableTargetId } from "../editable-targets.js";
import { normalizeOptionKey } from "../option-key.js";
import type { EditParseOptions } from "../parse-options.js";
import {
  applyTextReplacements,
  lineIndentAtOffset,
  parseStatementSnapshot,
  resolveStatementRefs,
  type StatementRef
} from "../statement-ops.js";
import { parseTikzForEdit } from "../parse-options.js";


export function applyGroupElementsAction(
  source: string,
  elementIds: readonly string[],
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const statementIds = normalizeStatementIds(elementIds);
  if (statementIds.length < 2) {
    return { kind: "unsupported", reason: "Group requires at least two selected statements." };
  }

  const snapshot = parseStatementSnapshot(source, parseOptions);
  const selectedRefs = resolveStatementRefs(snapshot, statementIds);
  if (selectedRefs.length < 2) {
    return { kind: "unsupported", reason: "Group requires at least two selected statements." };
  }

  const parentKeys = new Set(selectedRefs.map((ref) => ref.parentKey));
  if (parentKeys.size !== 1) {
    return { kind: "unsupported", reason: "Group currently requires all selected statements to share the same parent scope." };
  }

  const parentKey = selectedRefs[0].parentKey;
  const parentRefs = snapshot.byParentKey.get(parentKey)!.slice().sort((left, right) => left.index - right.index);

  const selectedIdSet = new Set(selectedRefs.map((ref) => ref.id));
  const selectedOrdered = parentRefs.filter((ref) => selectedIdSet.has(ref.id));

  const siblingIds = parentRefs.map((ref) => ref.id);
  const constraints = collectSiblingDependencyConstraints(source, siblingIds, parseOptions);
  const unselectedIds = siblingIds.filter((id) => !selectedIdSet.has(id));
  const oldIndexById = new Map<string, number>();
  for (let index = 0; index < siblingIds.length; index += 1) {
    oldIndexById.set(siblingIds[index], index);
  }

  const candidates = buildGroupingCandidates(unselectedIds, selectedOrdered.map((ref) => ref.id));
  const safeCandidates = candidates
    .filter((candidate) => preservesDependencyOrder(candidate.expandedOrder, constraints))
    .map((candidate) => ({
      ...candidate,
      movement: totalSiblingMovement(candidate.expandedOrder, oldIndexById),
      slotDistanceFromOriginal: Math.abs(candidate.slot - originalContiguousSlot(parentRefs, selectedIdSet))
    }))
    .sort((left, right) => {
      if (left.movement !== right.movement) {
        return left.movement - right.movement;
      }
      if (left.slotDistanceFromOriginal !== right.slotDistanceFromOriginal) {
        return left.slotDistanceFromOriginal - right.slotDistanceFromOriginal;
      }
      return left.slot - right.slot;
    });

  if (safeCandidates.length === 0) {
    return {
      kind: "unsupported",
      reason: "Cannot group this non-contiguous selection without changing dependency order. Try a contiguous selection or a different subset."
    };
  }

  const chosen = safeCandidates[0];
  const replacement = buildGroupReplacement({
    source,
    parentRefs,
    selectedRefs: selectedOrdered,
    orderedItems: chosen.orderedItems,
    parseOptions
  });
  const applied = applyTextReplacements(source, [{ span: replacement.span, text: replacement.text }]);
  const appliedReplacement = applied.applied[0];

  const scopeSpan: Span = {
    from: appliedReplacement.newSpan.from + replacement.scopeLocalSpan.from,
    to: appliedReplacement.newSpan.from + replacement.scopeLocalSpan.to
  };
  const groupedScopeId = resolveStatementIdBySpan(applied.source, scopeSpan, parseOptions)!;

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches,
    selectedSourceIds: [groupedScopeId],
    // Grouping can renumber statement ids; force full recompute path.
    changedSourceIds: []
  };
}

export function applyUngroupElementsAction(
  source: string,
  elementIds: readonly string[],
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const statementIds = normalizeStatementIds(elementIds);
  if (statementIds.length !== 1) {
    return { kind: "unsupported", reason: "Ungroup currently requires exactly one selected scope." };
  }

  const scopeId = statementIds[0];
  const snapshot = parseStatementSnapshot(source, parseOptions);
  const ref = snapshot.byId.get(scopeId);
  if (ref?.statement.kind !== "Scope") {
    return { kind: "unsupported", reason: "Ungroup currently supports scope selections only." };
  }

  const scopeStatement = ref.statement;
  const optionCheck = validateUngroupableScopeOptions(scopeStatement.options);
  if (!optionCheck.allowed) {
    return { kind: "unsupported", reason: optionCheck.reason };
  }

  const parentRefs = snapshot.byParentKey.get(ref.parentKey)!;
  const indent = lineIndentAtOffset(source, ref.span.from);
  const newline = detectPreferredNewline(source, ref.span.from);
  const separator = resolveStatementSeparator(source, parentRefs, indent, newline);
  const bodySnippets = scopeStatement.body.map((statement) => source.slice(statement.span.from, statement.span.to));
  const replacementText = bodySnippets
    .map((snippet) => reindentInlineStatement(snippet, indent))
    .join(separator);

  const applied = applyTextReplacements(source, [{ span: ref.span, text: replacementText }]);
  const appliedReplacement = applied.applied[0];

  let selectedSourceIds: string[] | undefined;
  if (replacementText.length > 0) {
    const nextSnapshot = parseStatementSnapshot(applied.source, parseOptions);
    const selectedRefs = nextSnapshot.byParentKey.get(ref.parentKey)!
      .filter((candidate) =>
        candidate.span.from >= appliedReplacement.newSpan.from &&
        candidate.span.to <= appliedReplacement.newSpan.to
      )
      .sort((left, right) => left.index - right.index);
    if (selectedRefs.length > 0) {
      selectedSourceIds = selectedRefs.map((candidate) => candidate.id);
    }
  }

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches,
    selectedSourceIds,
    // Ungrouping can renumber statement ids; force full recompute path.
    changedSourceIds: []
  };
}

type GroupCandidate = {
  slot: number;
  orderedItems: string[];
  expandedOrder: string[];
};

type GroupReplacement = {
  span: Span;
  text: string;
  scopeLocalSpan: Span;
};

type DependencyConstraint = {
  before: string;
  after: string;
};

function buildGroupingCandidates(
  unselectedIds: readonly string[],
  selectedIds: readonly string[]
): GroupCandidate[] {
  const candidates: GroupCandidate[] = [];
  for (let slot = 0; slot <= unselectedIds.length; slot += 1) {
    const orderedItems: string[] = [];
    for (let index = 0; index < unselectedIds.length; index += 1) {
      if (index === slot) {
        orderedItems.push("__group__");
      }
      orderedItems.push(unselectedIds[index]);
    }
    if (slot === unselectedIds.length) {
      orderedItems.push("__group__");
    }

    const expandedOrder: string[] = [];
    for (const item of orderedItems) {
      if (item === "__group__") {
        expandedOrder.push(...selectedIds);
      } else {
        expandedOrder.push(item);
      }
    }

    candidates.push({
      slot,
      orderedItems,
      expandedOrder
    });
  }
  return candidates;
}

function originalContiguousSlot(parentRefs: readonly StatementRef[], selectedIds: ReadonlySet<string>): number {
  let slot = 0;
  for (const ref of parentRefs) {
    if (selectedIds.has(ref.id)) {
      break;
    }
    slot += 1;
  }
  return slot;
}

function totalSiblingMovement(
  expandedOrder: readonly string[],
  oldIndexById: ReadonlyMap<string, number>
): number {
  let movement = 0;
  for (let index = 0; index < expandedOrder.length; index += 1) {
    const id = expandedOrder[index];
    const oldIndex = oldIndexById.get(id)!;
    movement += Math.abs(index - oldIndex);
  }
  return movement;
}

function preservesDependencyOrder(
  expandedOrder: readonly string[],
  constraints: readonly DependencyConstraint[]
): boolean {
  if (constraints.length === 0) {
    return true;
  }
  const indexById = new Map<string, number>();
  for (let index = 0; index < expandedOrder.length; index += 1) {
    indexById.set(expandedOrder[index], index);
  }
  for (const constraint of constraints) {
    const beforeIndex = indexById.get(constraint.before)!;
    const afterIndex = indexById.get(constraint.after)!;
    if (beforeIndex >= afterIndex) {
      return false;
    }
  }
  return true;
}

function collectSiblingDependencyConstraints(
  source: string,
  siblingIds: readonly string[],
  parseOptions: EditParseOptions
): DependencyConstraint[] {
  const siblingIdSet = new Set(siblingIds);
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  return collectConstraintsFromDependencyGraph(semantic.dependencies, siblingIdSet);
}

function collectConstraintsFromDependencyGraph(
  graph: SemanticDependencyGraph,
  siblingIds: ReadonlySet<string>
): DependencyConstraint[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const producersByResourceId = new Map<string, Set<string>>();
  const consumersByResourceId = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (edge.category !== "geometry") {
      continue;
    }
    if (edge.relation === "producer") {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      if (!fromNode || !toNode || fromNode.kind !== "source" || toNode.kind !== "resource") {
        continue;
      }
      const producers = producersByResourceId.get(edge.to);
      if (producers) {
        producers.add(fromNode.sourceId);
      } else {
        producersByResourceId.set(edge.to, new Set([fromNode.sourceId]));
      }
      continue;
    }

    if (edge.relation === "consumer") {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      if (!fromNode || !toNode || fromNode.kind !== "resource" || toNode.kind !== "source") {
        continue;
      }
      const consumers = consumersByResourceId.get(edge.from);
      if (consumers) {
        consumers.add(toNode.sourceId);
      } else {
        consumersByResourceId.set(edge.from, new Set([toNode.sourceId]));
      }
    }
  }

  const constraints: DependencyConstraint[] = [];
  const seen = new Set<string>();
  for (const [resourceId, producers] of producersByResourceId.entries()) {
    const consumers = consumersByResourceId.get(resourceId);
    if (!consumers || producers.size === 0 || consumers.size === 0) {
      continue;
    }

    for (const producer of producers) {
      if (!siblingIds.has(producer)) {
        continue;
      }
      for (const consumer of consumers) {
        if (!siblingIds.has(consumer) || producer === consumer) {
          continue;
        }
        const key = `${producer}->${consumer}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        constraints.push({
          before: producer,
          after: consumer
        });
      }
    }
  }

  return constraints;
}

function buildGroupReplacement(input: {
  source: string;
  parentRefs: readonly StatementRef[];
  selectedRefs: readonly StatementRef[];
  orderedItems: readonly string[];
  parseOptions: EditParseOptions;
}): GroupReplacement {
  const { source, parentRefs, selectedRefs, orderedItems, parseOptions } = input;
  const replacementSpan: Span = {
    from: parentRefs[0].span.from,
    to: parentRefs[parentRefs.length - 1].span.to
  };
  const newline = detectPreferredNewline(source, replacementSpan.from);
  const indent = lineIndentAtOffset(source, replacementSpan.from);
  const indentUnit = resolveIndentUnit(source, parentRefs, indent, parseOptions);
  const separator = resolveStatementSeparator(source, parentRefs, indent, newline);
  const childIndent = `${indent}${indentUnit}`;

  const snippetsById = new Map(parentRefs.map((ref) => [ref.id, source.slice(ref.span.from, ref.span.to)] as const));
  const groupedBody = selectedRefs
    .map((ref) => reindentBlock(source.slice(ref.span.from, ref.span.to), childIndent))
    .join(newline);
  const scopeText = `\\begin{scope}${newline}${groupedBody}${newline}${indent}\\end{scope}`;

  let text = "";
  let scopeLocalFrom = -1;
  let scopeLocalTo = -1;

  for (let index = 0; index < orderedItems.length; index += 1) {
    if (index > 0) {
      text += separator;
    }
    const item = orderedItems[index];
    if (item === "__group__") {
      scopeLocalFrom = text.length;
      text += scopeText;
      scopeLocalTo = text.length;
      continue;
    }
    text += snippetsById.get(item)!;
  }

  return {
    span: replacementSpan,
    text,
    scopeLocalSpan: {
      from: scopeLocalFrom,
      to: scopeLocalTo
    }
  };
}

function resolveIndentUnit(
  source: string,
  parentRefs: readonly StatementRef[],
  parentIndent: string,
  parseOptions: EditParseOptions
): string {
  if (parseOptions.indentSize != null) {
    const normalized = Math.max(1, Math.floor(parseOptions.indentSize));
    return " ".repeat(normalized);
  }

  let shortestExtra: number | null = null;
  for (const ref of parentRefs) {
    const statementIndent = lineIndentAtOffset(source, ref.span.from);
    if (!statementIndent.startsWith(parentIndent)) {
      continue;
    }
    const extra = statementIndent.slice(parentIndent.length);
    if (!/^[ \t]+$/.test(extra)) {
      continue;
    }
    if (shortestExtra == null || extra.length < shortestExtra) {
      shortestExtra = extra.length;
    }
  }

  return " ".repeat(shortestExtra ?? 2);
}

function validateUngroupableScopeOptions(options: OptionListAst | undefined): { allowed: true } | { allowed: false; reason: string } {
  if (!options) {
    return { allowed: true };
  }
  if (options.entries.length === 0) {
    return { allowed: true };
  }

  for (const entry of options.entries) {
    if (entry.kind === "unknown") {
      return { allowed: false, reason: "Ungroup currently supports only scopes without options, or with `name=...` only." };
    }
    if (normalizeOptionKey(entry.key) !== "name") {
      return { allowed: false, reason: "Ungroup currently supports only scopes without options, or with `name=...` only." };
    }
  }

  return { allowed: true };
}

function resolveStatementIdBySpan(
  source: string,
  span: Span,
  parseOptions: EditParseOptions
): string | null {
  const snapshot = parseStatementSnapshot(source, parseOptions);

  for (const ref of snapshot.all) {
    if (ref.span.from === span.from && ref.span.to === span.to) {
      return ref.id;
    }
  }
  return null;
}

function resolveStatementSeparator(
  source: string,
  parentRefs: readonly StatementRef[],
  indent: string,
  newline: string
): string {
  for (let index = 0; index < parentRefs.length - 1; index += 1) {
    const left = parentRefs[index];
    const right = parentRefs[index + 1];

    const gap = source.slice(left.span.to, right.span.from);
    if (gap.includes("\n")) {
      return `${gap.includes("\r\n") ? "\r\n" : "\n"}${indent}`;
    }
  }
  return `${newline}${indent}`;
}

function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  if (window.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function reindentBlock(snippet: string, indent: string): string {
  const normalized = snippet.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmpty.reduce((minimum, line) => {
    const current = line.match(/^[ \t]*/u)![0].length;
    return Math.min(minimum, current);
  }, Number.POSITIVE_INFINITY);
  const trimIndent = minIndent;
  return lines
    .map((line) => {
      const stripped = trimIndent > 0 ? line.slice(Math.min(trimIndent, line.length)) : line;
      return `${indent}${stripped}`;
    })
    .join("\n");
}

function reindentInlineStatement(snippet: string, indent: string): string {
  const reindented = reindentBlock(snippet, indent);
  if (indent.length === 0 || !reindented.startsWith(indent)) {
    return reindented;
  }
  return reindented.slice(indent.length);
}

function normalizeStatementIds(elementIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of elementIds) {
    const parsed = parseEditableTargetId(rawId);
    if (parsed.kind !== "statement") {
      continue;
    }
    const id = parsed.id.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function isUngroupableScopeStatement(statement: Statement): boolean {
  return statement.kind === "Scope" && validateUngroupableScopeOptions(statement.options).allowed;
}
