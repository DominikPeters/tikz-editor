import type { TexFuzzCase, TexFuzzMutation } from "./model.js";
import { applyTexFuzzMutations } from "./print.js";
import { TexFuzzRandom } from "./random.js";

export type TexFuzzEditInputKind = "insert" | "delete" | "replace" | "paste";
export type TexFuzzStageReuseStatus = "reused" | "fresh" | "not-run";

export interface TexFuzzSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface TexFuzzStageReuse {
  readonly status: TexFuzzStageReuseStatus;
  /** Required when status is `reused`; describes the observable reuse signal. */
  readonly evidence?: string;
}

export interface TexFuzzComputedValue<T> {
  readonly value: T;
  /** Absence means that the adapter did not instrument reuse for that stage. */
  readonly stages?: Readonly<Record<string, TexFuzzStageReuse>>;
}

export interface TexFuzzComputeContext<T> {
  readonly nodeId: string;
  readonly source: string;
  readonly revision: number;
  /** Session computations may update incremental caches; oracle computations must be fresh. */
  readonly purpose: "session" | "fresh-oracle";
  readonly previous?: {
    readonly source: string;
    readonly revision: number;
    readonly computed: TexFuzzComputedValue<T>;
  };
}

export interface TexFuzzEditAdapter<T> {
  readonly compute: (context: TexFuzzComputeContext<T>) => TexFuzzComputedValue<T> | Promise<TexFuzzComputedValue<T>>;
  readonly equal?: (left: T, right: T) => boolean;
}

export interface TexFuzzEditNode {
  readonly id: string;
  readonly case: TexFuzzCase;
}

export interface TexFuzzStaleTarget {
  /** Offsets and text are captured from the named snapshot, not the live source. */
  readonly start: number;
  readonly end: number;
  readonly expectedText: string;
}

export type TexFuzzEditOperation =
  | {
      readonly kind: "edit";
      readonly inputKind: TexFuzzEditInputKind;
      readonly mutation: TexFuzzMutation;
    }
  | {
      readonly kind: "selection";
      readonly movement: "set" | "left" | "right" | "home" | "end";
      readonly anchor?: number;
      readonly head?: number;
      readonly extend?: boolean;
    }
  | { readonly kind: "request-compute"; readonly requestId: string }
  | { readonly kind: "complete-compute"; readonly requestId: string }
  | {
      readonly kind: "stale-edit";
      readonly snapshotId: string;
      readonly inputKind: TexFuzzEditInputKind;
      readonly target: TexFuzzStaleTarget;
      readonly mutation: TexFuzzMutation;
      readonly policy: "reject" | "retarget-unique";
    }
  | { readonly kind: "switch-node"; readonly nodeId: string }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };

export interface TexFuzzEditSequence {
  readonly seed: number;
  readonly operations: readonly TexFuzzEditOperation[];
}

interface HistoryEntry {
  readonly before: string;
  readonly after: string;
  readonly beforeSelection: TexFuzzSelection;
  readonly afterSelection: TexFuzzSelection;
}

interface NodeState<T> {
  source: string;
  revision: number;
  selection: TexFuzzSelection;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  installed?: Snapshot<T>;
}

interface Snapshot<T> {
  readonly requestId: string;
  readonly nodeId: string;
  readonly source: string;
  readonly revision: number;
  readonly computed: TexFuzzComputedValue<T>;
}

export interface TexFuzzEditStep {
  readonly index: number;
  readonly operation: TexFuzzEditOperation;
  readonly nodeId: string;
  readonly source: string;
  readonly revision: number;
  readonly selection: TexFuzzSelection;
  readonly outcome?: "applied" | "rejected-stale" | "retargeted" | "installed" | "discarded-stale";
}

export interface TexFuzzReuseComparison {
  readonly requestId: string;
  readonly nodeId: string;
  readonly stage: string;
  readonly evidence: string;
  readonly freshEquivalent: boolean;
}

export interface TexFuzzFinalNode<T> {
  readonly nodeId: string;
  readonly source: string;
  readonly revision: number;
  readonly selection: TexFuzzSelection;
  readonly installedSnapshotEquivalent: boolean;
  readonly fresh: TexFuzzComputedValue<T>;
}

export interface TexFuzzEditRun<T> {
  readonly activeNodeId: string;
  readonly steps: readonly TexFuzzEditStep[];
  readonly nodes: readonly TexFuzzFinalNode<T>[];
  readonly reuseComparisons: readonly TexFuzzReuseComparison[];
}

function assertOffset(offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError(`${label} offset ${offset} is outside source length ${length}.`);
  }
}

function assertMutationInBounds(mutation: TexFuzzMutation, length: number): void {
  if (mutation.kind === "truncate" || mutation.kind === "insert") {
    assertOffset(mutation.offset, length, mutation.kind);
    return;
  }
  assertOffset(mutation.start, length, `${mutation.kind} start`);
  assertOffset(mutation.end, length, `${mutation.kind} end`);
}

function assertMutationInsideTarget(mutation: TexFuzzMutation, target: TexFuzzStaleTarget): void {
  if (mutation.kind === "truncate") {
    throw new Error("A stale snapshot edit cannot use a truncation mutation.");
  }
  const start = mutation.kind === "insert" ? mutation.offset : Math.min(mutation.start, mutation.end);
  const end = mutation.kind === "insert" ? mutation.offset : Math.max(mutation.start, mutation.end);
  if (start < target.start || end > target.end) {
    throw new Error("A stale mutation must remain inside its recorded target.");
  }
}

function assertInputKindMatches(inputKind: TexFuzzEditInputKind, mutation: TexFuzzMutation): void {
  const matches = inputKind === mutation.kind
    || (inputKind === "paste" && mutation.kind === "insert");
  if (!matches) {
    throw new Error(`Edit input kind ${inputKind} cannot record a ${mutation.kind} mutation.`);
  }
}

function mutationRange(mutation: TexFuzzMutation): { readonly start: number; readonly end: number; readonly inserted: number } {
  if (mutation.kind === "truncate") return { start: mutation.offset, end: Number.POSITIVE_INFINITY, inserted: 0 };
  if (mutation.kind === "insert") return { start: mutation.offset, end: mutation.offset, inserted: mutation.text.length };
  return {
    start: Math.min(mutation.start, mutation.end),
    end: Math.max(mutation.start, mutation.end),
    inserted: mutation.kind === "replace" ? mutation.text.length : 0,
  };
}

function remapSelection(selection: TexFuzzSelection, mutation: TexFuzzMutation, resultLength: number): TexFuzzSelection {
  const range = mutationRange(mutation);
  const remap = (offset: number): number => {
    if (offset <= range.start) return offset;
    if (offset >= range.end) return offset + range.inserted - (range.end - range.start);
    return range.start + range.inserted;
  };
  return {
    anchor: Math.max(0, Math.min(resultLength, remap(selection.anchor))),
    head: Math.max(0, Math.min(resultLength, remap(selection.head))),
  };
}

function translatedMutation(mutation: TexFuzzMutation, delta: number): TexFuzzMutation {
  switch (mutation.kind) {
    case "truncate": return { kind: "truncate", offset: mutation.offset + delta };
    case "insert": return { ...mutation, offset: mutation.offset + delta };
    case "delete": return { ...mutation, start: mutation.start + delta, end: mutation.end + delta };
    case "replace": return { ...mutation, start: mutation.start + delta, end: mutation.end + delta };
  }
}

function uniqueOccurrence(source: string, needle: string): number | null {
  if (needle.length === 0) return null;
  const first = source.indexOf(needle);
  if (first < 0 || source.slice(first + 1).includes(needle)) return null;
  return first;
}

function validateStages(stages: Readonly<Record<string, TexFuzzStageReuse>> | undefined): void {
  for (const [stage, reuse] of Object.entries(stages ?? {})) {
    if (reuse.status === "reused" && !reuse.evidence?.trim()) {
      throw new Error(`Incremental stage ${stage} claims reuse without evidence.`);
    }
  }
}

function equalValue<T>(adapter: TexFuzzEditAdapter<T>, left: T, right: T): boolean {
  return adapter.equal ? adapter.equal(left, right) : Object.is(left, right);
}

function cloneSelection(selection: TexFuzzSelection): TexFuzzSelection {
  return { anchor: selection.anchor, head: selection.head };
}

function applyRecordedMutation<T>(node: NodeState<T>, mutation: TexFuzzMutation): void {
  assertMutationInBounds(mutation, node.source.length);
  const before = node.source;
  const beforeSelection = cloneSelection(node.selection);
  const after = applyTexFuzzMutations(before, [mutation]);
  const afterSelection = remapSelection(beforeSelection, mutation, after.length);
  node.source = after;
  node.selection = afterSelection;
  node.revision += 1;
  node.undo.push({ before, after, beforeSelection, afterSelection });
  node.redo = [];
}

function assertSelection(node: NodeState<unknown>, nodeId: string): void {
  assertOffset(node.selection.anchor, node.source.length, `${nodeId} selection anchor`);
  assertOffset(node.selection.head, node.source.length, `${nodeId} selection head`);
}

/**
 * Run a replayable editor history. Compute requests capture their source immediately,
 * while completion operations control delivery order. Stale completions never install.
 */
export async function runTexFuzzEditSequence<T>(
  initialNodes: readonly TexFuzzEditNode[],
  sequence: TexFuzzEditSequence,
  adapter: TexFuzzEditAdapter<T>
): Promise<TexFuzzEditRun<T>> {
  if (initialNodes.length === 0) throw new Error("A stateful TeX fuzz run needs at least one node.");
  const nodes = new Map<string, NodeState<T>>();
  for (const initial of initialNodes) {
    if (nodes.has(initial.id)) throw new Error(`Duplicate editor node id ${initial.id}.`);
    nodes.set(initial.id, {
      source: initial.case.source,
      revision: 0,
      selection: { anchor: 0, head: 0 },
      undo: [],
      redo: [],
    });
  }
  let activeNodeId = initialNodes[0].id;
  const requests = new Map<string, Snapshot<T>>();
  const steps: TexFuzzEditStep[] = [];
  const reuseComparisons: TexFuzzReuseComparison[] = [];

  for (let index = 0; index < sequence.operations.length; index += 1) {
    const operation = sequence.operations[index];
    let node = nodes.get(activeNodeId);
    if (!node) throw new Error(`Unknown active editor node ${activeNodeId}.`);
    let outcome: TexFuzzEditStep["outcome"];

    switch (operation.kind) {
      case "edit":
        assertInputKindMatches(operation.inputKind, operation.mutation);
        applyRecordedMutation(node, operation.mutation);
        outcome = "applied";
        break;
      case "selection": {
        const moving = operation.movement === "set"
          ? (operation.head ?? operation.anchor ?? node.selection.head)
          : operation.movement === "left" || operation.movement === "home"
            ? operation.movement === "home" ? 0 : Math.max(0, node.selection.head - 1)
            : operation.movement === "end" ? node.source.length : Math.min(node.source.length, node.selection.head + 1);
        const anchor = operation.movement === "set"
          ? (operation.anchor ?? moving)
          : operation.extend ? node.selection.anchor : moving;
        assertOffset(anchor, node.source.length, "selection anchor");
        assertOffset(moving, node.source.length, "selection head");
        node.selection = { anchor, head: moving };
        break;
      }
      case "request-compute": {
        if (requests.has(operation.requestId)) throw new Error(`Duplicate compute request id ${operation.requestId}.`);
        const context: TexFuzzComputeContext<T> = {
          nodeId: activeNodeId,
          source: node.source,
          revision: node.revision,
          purpose: "session",
          previous: node.installed ? {
            source: node.installed.source,
            revision: node.installed.revision,
            computed: node.installed.computed,
          } : undefined,
        };
        const computed = await adapter.compute(context);
        validateStages(computed.stages);
        requests.set(operation.requestId, {
          requestId: operation.requestId,
          nodeId: activeNodeId,
          source: node.source,
          revision: node.revision,
          computed,
        });
        break;
      }
      case "complete-compute": {
        const request = requests.get(operation.requestId);
        if (!request) throw new Error(`Unknown compute request id ${operation.requestId}.`);
        const targetNode = nodes.get(request.nodeId);
        if (!targetNode) throw new Error(`Compute request names unknown node ${request.nodeId}.`);
        if (targetNode.revision === request.revision && targetNode.source === request.source) {
          targetNode.installed = request;
          outcome = "installed";
          const fresh = await adapter.compute({
            nodeId: request.nodeId,
            source: request.source,
            revision: request.revision,
            purpose: "fresh-oracle",
          });
          for (const [stage, reuse] of Object.entries(request.computed.stages ?? {})) {
            if (reuse.status !== "reused") continue;
            reuseComparisons.push({
              requestId: operation.requestId,
              nodeId: request.nodeId,
              stage,
              evidence: reuse.evidence ?? "",
              freshEquivalent: equalValue(adapter, request.computed.value, fresh.value),
            });
          }
        } else {
          outcome = "discarded-stale";
        }
        break;
      }
      case "stale-edit": {
        assertInputKindMatches(operation.inputKind, operation.mutation);
        const snapshot = requests.get(operation.snapshotId);
        if (!snapshot) throw new Error(`Unknown stale snapshot id ${operation.snapshotId}.`);
        if (snapshot.nodeId !== activeNodeId) throw new Error("A stale edit cannot silently cross editor nodes.");
        assertOffset(operation.target.start, snapshot.source.length, "stale target start");
        assertOffset(operation.target.end, snapshot.source.length, "stale target end");
        if (snapshot.source.slice(operation.target.start, operation.target.end) !== operation.target.expectedText) {
          throw new Error("A stale target does not reproduce its recorded snapshot text.");
        }
        assertMutationInBounds(operation.mutation, snapshot.source.length);
        assertMutationInsideTarget(operation.mutation, operation.target);
        const directMatch = node.source.slice(operation.target.start, operation.target.end) === operation.target.expectedText;
        let delta: number | null = directMatch ? 0 : null;
        if (delta === null && operation.policy === "retarget-unique") {
          const retargetedStart = uniqueOccurrence(node.source, operation.target.expectedText);
          if (retargetedStart !== null) delta = retargetedStart - operation.target.start;
        }
        if (delta === null) {
          outcome = "rejected-stale";
        } else {
          const translated = translatedMutation(operation.mutation, delta);
          assertMutationInBounds(translated, node.source.length);
          applyRecordedMutation(node, translated);
          outcome = delta === 0 ? "applied" : "retargeted";
        }
        break;
      }
      case "switch-node": {
        if (!nodes.has(operation.nodeId)) throw new Error(`Unknown editor node ${operation.nodeId}.`);
        activeNodeId = operation.nodeId;
        node = nodes.get(activeNodeId);
        if (!node) throw new Error(`Unknown editor node ${activeNodeId}.`);
        break;
      }
      case "undo": {
        const entry = node.undo.pop();
        if (entry) {
          if (node.source !== entry.after) throw new Error("Undo history diverged from its byte-exact after source.");
          node.source = entry.before;
          node.selection = cloneSelection(entry.beforeSelection);
          node.revision += 1;
          node.redo.push(entry);
          outcome = "applied";
        }
        break;
      }
      case "redo": {
        const entry = node.redo.pop();
        if (entry) {
          if (node.source !== entry.before) throw new Error("Redo history diverged from its byte-exact before source.");
          node.source = entry.after;
          node.selection = cloneSelection(entry.afterSelection);
          node.revision += 1;
          node.undo.push(entry);
          outcome = "applied";
        }
        break;
      }
    }

    for (const [nodeId, state] of nodes) assertSelection(state, nodeId);
    steps.push({
      index,
      operation,
      nodeId: activeNodeId,
      source: node.source,
      revision: node.revision,
      selection: cloneSelection(node.selection),
      ...(outcome ? { outcome } : {}),
    });
  }

  const finalNodes: TexFuzzFinalNode<T>[] = [];
  for (const [nodeId, node] of nodes) {
    const fresh = await adapter.compute({
      nodeId,
      source: node.source,
      revision: node.revision,
      purpose: "fresh-oracle",
    });
    const installedEquivalent = node.installed?.source === node.source
      && equalValue(adapter, node.installed.computed.value, fresh.value);
    if (!installedEquivalent) {
      throw new Error(`Final installed snapshot for ${nodeId} did not converge to its fresh source.`);
    }
    finalNodes.push({
      nodeId,
      source: node.source,
      revision: node.revision,
      selection: cloneSelection(node.selection),
      installedSnapshotEquivalent: true,
      fresh,
    });
  }

  if (reuseComparisons.some((comparison) => !comparison.freshEquivalent)) {
    throw new Error("A stage proven to reuse incremental state diverged from a fresh computation.");
  }
  return { activeNodeId, steps, nodes: finalNodes, reuseComparisons };
}

/** Generate a deterministic history containing each high-value stateful operation class. */
export function generateTexFuzzEditSequence(initialCase: TexFuzzCase, seed: number): TexFuzzEditSequence {
  const random = new TexFuzzRandom(seed);
  const length = initialCase.source.length;
  const insertOffset = random.int("edit.insert-offset", length + 1);
  const deleteStart = length === 0 ? 0 : random.int("edit.delete-start", length);
  const deleteEnd = Math.min(length, deleteStart + (length === 0 ? 0 : 1));
  const replaceStart = length === 0 ? 0 : random.int("edit.replace-start", length);
  const replaceEnd = Math.min(length, replaceStart + (length === 0 ? 0 : 1));
  const pastedSource = `${initialCase.source}\\textbf{paste}`;
  return {
    seed,
    operations: [
      { kind: "request-compute", requestId: "initial-a" },
      { kind: "complete-compute", requestId: "initial-a" },
      { kind: "selection", movement: "set", anchor: insertOffset, head: insertOffset },
      { kind: "edit", inputKind: "insert", mutation: { kind: "insert", offset: insertOffset, text: "X" } },
      { kind: "undo" },
      { kind: "redo" },
      { kind: "undo" },
      { kind: "edit", inputKind: "delete", mutation: { kind: "delete", start: deleteStart, end: deleteEnd } },
      { kind: "undo" },
      { kind: "edit", inputKind: "replace", mutation: { kind: "replace", start: replaceStart, end: replaceEnd, text: "Q" } },
      { kind: "undo" },
      { kind: "edit", inputKind: "paste", mutation: { kind: "insert", offset: length, text: "\\textbf{paste}" } },
      { kind: "request-compute", requestId: "old-a" },
      { kind: "edit", inputKind: "insert", mutation: { kind: "insert", offset: 0, text: "%shift\n" } },
      { kind: "request-compute", requestId: "fresh-a" },
      { kind: "complete-compute", requestId: "old-a" },
      {
        kind: "stale-edit",
        snapshotId: "old-a",
        inputKind: "replace",
        target: { start: 0, end: pastedSource.length, expectedText: pastedSource },
        mutation: { kind: "replace", start: 0, end: Math.min(1, pastedSource.length), text: "S" },
        policy: "reject",
      },
      { kind: "complete-compute", requestId: "fresh-a" },
      { kind: "switch-node", nodeId: "node-b" },
      { kind: "selection", movement: "end" },
      { kind: "request-compute", requestId: "fresh-b" },
      { kind: "complete-compute", requestId: "fresh-b" },
      { kind: "switch-node", nodeId: "node-a" },
    ],
  };
}
