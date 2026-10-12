/**
 * Model-based fuzzer for the editor store.
 *
 * Drives the real store (reducer, deck page claims, workspace saving) the way
 * the app's hooks do: someone types, runs edit commands against whatever
 * snapshot is on screen, drags with merged history, undoes and redoes,
 * switches documents and roots, saves, and reloads from disk. Renders run on
 * the real compute module but arrive late, out of order, or never; workspace
 * storage fails at random. After every operation the store must satisfy:
 *
 * - the dirty flag says exactly whether the source differs from the saved one;
 * - revisions only grow, and grow whenever the source changes;
 * - the undo history describes the source: the current entry ends at it, and
 *   consecutive entries chain;
 * - redo right after undo restores the source exactly;
 * - an edit command run against a stale snapshot is rejected or changes the
 *   element that was clicked, wherever the edits since have moved it;
 * - once renders settle, the snapshot on screen is a cold render of the
 *   document as it now is;
 * - a successful workspace save reloads into the same documents.
 *
 * Operations carry their own random numbers and derive concrete actions from
 * the state they meet, so a failing run replays from its operation list and
 * shrinks by dropping operations.
 */
import { appendFileSync } from "node:fs";
import { vi } from "vitest";

import type { Statement } from "../../packages/core/src/ast/types.js";
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import type { EditAction } from "../../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import type { ComputeRequest, SessionSnapshot } from "../../packages/app/src/compute.js";
import type { DocumentFileRef, EditorAction, EditorState, FileRevision } from "../../packages/app/src/store/types.js";
import { decideLinkedFileRefresh, revisionForText, revisionsMatch, sameDocumentFileRef, type LinkedTextReadResult, type LinkedTextWriteResult } from "../../packages/app/src/linked-file-sync.js";
import { benignTextEdit, coldCompute, makeRng, randomTextEdit, singleEdit, type FuzzDocument } from "./compute-fuzz.js";
import type { ModuleMock } from "./compute-instances.js";
import * as glyphOutlines from "../../packages/core/src/text/tex/fonts/glyph-outlines.js";
import { diffValues } from "./snapshot-diff.js";

export type StoreOpKind =
  | "type" | "action" | "drag" | "drag-start" | "drag-end" | "patches" | "undo" | "redo" | "undo-redo" | "render-now" | "compute" | "deliver" | "drop" | "settle"
  | "switch" | "open" | "close" | "root" | "step" | "save-start" | "save-finish" | "external-write" | "refresh" | "storage-fault";

export type StoreOp = { kind: StoreOpKind; r: [number, number, number, number] };

export type StoreFailure = { opIndex: number; op: StoreOp; invariant: string; details: string[] };

type Store = {
  getState: () => EditorState & { dispatch: (action: EditorAction) => void };
};

type Render = { request: ComputeRequest; controller: AbortController; response: Promise<{ snapshot: SessionSnapshot } | null> };

type Harness = {
  store: Store;
  compute: typeof import("../../packages/app/src/compute.js");
  storage: { map: Map<string, string>; failing: boolean; lastSaveOk: boolean; savesThisOp: number };
  /** The app's single-flight scheduler: one render running, at most one queued. */
  scheduler: { running: Render | null; queued: ComputeRequest | null };
  /** Saves in progress: the document as it was when the save began (useDocumentFileOperations). */
  saves: { documentId: string; source: string; sourceRevision: number; diskRevision: FileRevision | null; fileRef: DocumentFileRef | null }[];
  /** A simulated disk for linked documents, with every text each file has held. */
  disk: Map<string, { source: string; revision: FileRevision; history: Set<string> }>;
  diskClock: number;
  gesture: { key: string; documentId: string } | null;
  requestCounter: number;
};

const GLYPH_OUTLINES = "../../packages/core/src/text/tex/fonts/glyph-outlines.js";

async function createHarness(documents: readonly FuzzDocument[], mocks: readonly ModuleMock[]): Promise<Harness> {
  vi.resetModules();
  vi.doMock(GLYPH_OUTLINES, () => glyphOutlines);
  for (const mock of mocks) vi.doMock(mock.path, mock.factory as never);
  const storage = { map: new Map<string, string>(), failing: false, lastSaveOk: true, savesThisOp: 0 };
  try {
    const { setActiveEditorPlatform } = await import("../../packages/app/src/platform/current.js");
    setActiveEditorPlatform({
      id: "test",
      persistence: {
        load: (key) => storage.map.get(key) ?? null,
        save: (key, value) => {
          storage.savesThisOp += 1;
          if (storage.failing) {
            storage.lastSaveOk = false;
            throw new Error("QuotaExceededError (injected)");
          }
          storage.lastSaveOk = true;
          storage.map.set(key, value);
        }
      }
    });
    const { useEditorStore } = await import("../../packages/app/src/store/store.js");
    const compute = await import("../../packages/app/src/compute.js");
    const store = useEditorStore as unknown as Store;
    const initial = store.getState().activeDocumentId;
    for (const document of documents) store.getState().dispatch({ type: "NEW_DOCUMENT", source: document.source, title: document.label });
    store.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: initial });
    const harness: Harness = { store, compute, storage, scheduler: { running: null, queued: null }, saves: [], disk: new Map(), diskClock: 0, gesture: null, requestCounter: 0 };
    // The documents are files on disk, as when opened from the file system.
    for (const doc of Object.values(store.getState().documents)) {
      const path = `/fuzz/${doc.id}.tex`;
      const revision = nextDiskRevision(harness, doc.source);
      harness.disk.set(path, { source: doc.source, revision, history: new Set([doc.source]) });
      store.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: doc.id, savedSource: doc.source,
        fileRef: { kind: "file", provider: "desktop-fs", name: `${doc.id}.tex`, path }, diskRevision: revision, lastKnownDiskSource: doc.source });
    }
    return harness;
  } finally {
    vi.resetModules();
    vi.doUnmock(GLYPH_OUTLINES);
    for (const mock of mocks) vi.doUnmock(mock.path);
  }
}

function nextDiskRevision(harness: Harness, text: string): FileRevision {
  harness.diskClock += 1;
  return revisionForText(text, { mtimeMs: harness.diskClock, size: text.length });
}

/** The desktop bridge's write: refuses when the file changed since the expected revision. */
function writeLinked(harness: Harness, path: string, text: string, expected: FileRevision | null, fails: boolean): LinkedTextWriteResult {
  const file = harness.disk.get(path);
  const fileRef: DocumentFileRef = { kind: "file", provider: "desktop-fs", name: path.split("/").pop()!, path };
  if (!file) return { status: "missing" };
  if (fails) return { status: "failed", reason: "disk full (injected)" };
  if (expected && !revisionsMatch(expected, file.revision)) return { status: "changed-on-disk", source: file.source, revision: file.revision, fileRef };
  file.source = text;
  file.revision = nextDiskRevision(harness, text);
  file.history.add(text);
  return { status: "saved", revision: file.revision, fileRef };
}

// ── The app's compute request (App.tsx, useScheduledCompute) ────────────────

function appRequest(state: EditorState, id: string): ComputeRequest {
  const doc = state.documents[state.activeDocumentId];
  const isDeck = doc.snapshot.deck != null || /\\documentclass(\[[^\]]*\])?\{beamer\}/u.test(doc.source);
  const mask = state.canvasTextEditMask?.documentId === doc.id && state.canvasTextEditMask.sourceRevision === doc.sourceRevision
    ? state.canvasTextEditMask.span : null;
  return {
    id,
    documentId: doc.id,
    kind: "render",
    source: doc.source,
    sourceRevision: doc.sourceRevision,
    documentFileRef: doc.fileRef,
    activeRootId: doc.activeRootId,
    deckStep: isDeck ? state.deckStepByRootKey[`${doc.id}::${doc.activeRootId ?? ""}`] ?? 1 : null,
    changedSourceIds: doc.lastEditChangedSourceIds,
    patches: doc.lastEditPatches ? [...doc.lastEditPatches] : null,
    patchBaseRevision: doc.lastEditPatchBaseRevision,
    trigger: "other",
    inferSourceChanges: doc.lastSourceChangeOrigin !== "edit-command",
    textEditMaskSpan: mask,
    renderViewBox: null
  };
}

function start(harness: Harness, request: ComputeRequest): void {
  // STORE_FUZZ_DUMP=file writes every render request, to reproduce a render bug at the compute level.
  if (process.env.STORE_FUZZ_DUMP) appendFileSync(process.env.STORE_FUZZ_DUMP, `${JSON.stringify(request)}\n`);
  const controller = new AbortController();
  harness.store.getState().dispatch({ type: "COMPUTE_REQUESTED", requestId: request.id, documentId: request.documentId });
  const work = { signal: controller.signal, budgetMs: 0, yieldControl: () => new Promise<void>((resolve) => setImmediate(resolve)) };
  const response = harness.compute.computeSnapshot(request, work).catch((error: unknown) => {
    if (controller.signal.aborted) return null;
    throw error;
  });
  harness.scheduler.running = { request, controller, response };
}

/** As compute-scheduler.ts: run now, or queue after the running render, which is aborted unless kept. */
function schedule(harness: Harness, keepInFlight: boolean): void {
  const request = appRequest(harness.store.getState(), `store-fuzz-${++harness.requestCounter}`);
  if (harness.scheduler.running) {
    harness.scheduler.queued = request;
    if (!keepInFlight) harness.scheduler.running.controller.abort();
    return;
  }
  start(harness, request);
}

/** The running render finishes; its snapshot is published unless it was aborted. */
async function finishRunning(harness: Harness): Promise<void> {
  const running = harness.scheduler.running;
  if (!running) return;
  const response = await running.response;
  harness.scheduler.running = null;
  if (response && !running.controller.signal.aborted && harness.store.getState().documents[running.request.documentId!]) {
    harness.store.getState().dispatch({ type: "SNAPSHOT_READY", requestId: running.request.id, documentId: running.request.documentId, snapshot: response.snapshot });
  }
  const queued = harness.scheduler.queued;
  harness.scheduler.queued = null;
  if (queued && harness.store.getState().documents[queued.documentId!]) start(harness, queued);
}

async function finishAll(harness: Harness): Promise<void> {
  while (harness.scheduler.running) await finishRunning(harness);
}

/** Finishes what is running, then renders the current state, as the app does after any change. */
async function settle(harness: Harness): Promise<void> {
  await finishAll(harness);
  for (let round = 0; round < 3; round += 1) {
    const before = harness.store.getState();
    schedule(harness, false);
    await finishAll(harness);
    // The new snapshot can change the root selection, which renders again.
    const after = harness.store.getState();
    const doc = after.documents[after.activeDocumentId];
    if (doc.activeRootId === before.documents[before.activeDocumentId].activeRootId && isShownFor(doc.snapshot, appRequest(after, "check"))) return;
  }
}

function isShownFor(snapshot: SessionSnapshot, request: ComputeRequest): boolean {
  if (snapshot.deck) {
    const frame = snapshot.deck.activeFrame;
    return request.activeRootId == null ? frame == null : frame?.frameId === request.activeRootId && frame.step === Math.min(Math.max(1, request.deckStep ?? 1), frame.stepCount);
  }
  return snapshot.activeRootId === (request.activeRootId ?? snapshot.activeRootId);
}

// ── Invariants ──────────────────────────────────────────────────────────────

type Before = { state: EditorState };

function checkInvariants(before: Before, after: EditorState, diskFiles?: Harness["disk"]): string[] {
  const problems: string[] = [];
  for (const doc of Object.values(after.documents)) {
    const file = doc.fileRef?.path ? diskFiles?.get(doc.fileRef.path) : undefined;
    if (file && !doc.dirty && !file.history.has(doc.source)) {
      problems.push(`saved: ${doc.title} counts as saved, but its text was never written to its file`);
    }
    if (doc.dirty !== (doc.source !== doc.savedSource)) {
      problems.push(`dirty: ${doc.title} has dirty=${doc.dirty} but source ${doc.source === doc.savedSource ? "equals" : "differs from"} the saved source`);
    }
    const previous = before.state.documents[doc.id];
    if (previous) {
      if (doc.sourceRevision < previous.sourceRevision) problems.push(`revision: ${doc.title} went back from ${previous.sourceRevision} to ${doc.sourceRevision}`);
      if (doc.source !== previous.source && doc.sourceRevision === previous.sourceRevision) problems.push(`revision: ${doc.title} changed source without a new revision`);
    }
    // Renders are numbered as they start; a document must not go back to
    // showing a render that started before the one it shows.
    if (previous && previous.snapshot.revision > doc.snapshot.revision && previous.snapshot !== doc.snapshot && doc.snapshot.revision > 0) {
      problems.push(`shown render: ${doc.title} went back from render ${previous.snapshot.revision} to the older render ${doc.snapshot.revision}`);
    }
    const current = doc.history.at(doc.historyIndex);
    if (doc.historyIndex >= 0 && current && current.sourceAfter !== doc.source) {
      problems.push(`history: ${doc.title}'s current entry (${doc.historyIndex}, ${current.label}) does not end at the source`);
    }
    if (doc.historyIndex < 0 && doc.history.length > 0 && doc.history[0].sourceBefore !== doc.source) {
      problems.push(`history: ${doc.title} is before its first entry but the source is not that entry's start`);
    }
    for (let index = 1; index < doc.history.length; index += 1) {
      if (doc.history[index].sourceBefore !== doc.history[index - 1].sourceAfter) {
        problems.push(`history: ${doc.title}'s entries ${index - 1} (${doc.history[index - 1].label}) and ${index} (${doc.history[index].label}) do not chain`);
        break;
      }
    }
  }
  return problems;
}

function checkPersistence(harness: Harness): string[] {
  if (harness.storage.savesThisOp === 0 || !harness.storage.lastSaveOk) return [];
  const raw = harness.storage.map.get("tikz-editor:workspace");
  if (!raw) return ["persistence: a save succeeded but nothing is stored"];
  const saved = JSON.parse(raw) as { documents: { id: string; source: string; savedSource?: string; activeRootId?: string | null }[]; activeDocumentId: string };
  const state = harness.store.getState();
  const problems: string[] = [];
  for (const doc of Object.values(state.documents)) {
    const stored = saved.documents.find((entry) => entry.id === doc.id);
    if (!stored) problems.push(`persistence: ${doc.title} is missing from the saved workspace`);
    else if (stored.source !== doc.source) problems.push(`persistence: ${doc.title}'s saved source is not its source`);
    else if ((stored.savedSource ?? stored.source) !== doc.savedSource) problems.push(`persistence: ${doc.title}'s saved disk source is not its saved source`);
  }
  if (saved.documents.length !== Object.keys(state.documents).length) problems.push("persistence: the saved workspace has a different number of documents");
  return problems;
}

async function checkSettledRender(harness: Harness): Promise<string[]> {
  const state = harness.store.getState();
  const doc = state.documents[state.activeDocumentId];
  if (doc.snapshot.source !== doc.source) return [`settled render: ${doc.title} still shows an older source`];
  const request = appRequest(state, "settled");
  const expected = await coldCompute(request);
  return diffValues(
    { snapshot: expected.snapshot },
    { snapshot: doc.snapshot },
    // editingId: the store names handles by editing identity on arrival.
    { ignoredKeys: new Set(["revision", "cacheEpoch", "incremental", "textLayoutContext", "runtimeId", "editingId"]),
      normalizers: { expected: stripRunIdentities, actual: stripRunIdentities } }
  ).map((difference) => `settled render: ${difference}`);
}

function stripRunIdentities(text: string): string {
  return text.includes("tex:") || text.includes("|sm:")
    ? text.replace(/\btex:\d+\b/gu, "tex:*").replace(/\|sm:[0-9a-z]+/gu, "|sm:*")
    : text;
}

// ── Edit commands and their targets ─────────────────────────────────────────

function cm(value: number): number {
  return value * PT_PER_CM;
}

function findStatement(statements: readonly Statement[], id: string): Statement | null {
  for (const statement of statements) {
    if (statement.id === id) return statement;
    if (statement.kind === "Scope") {
      const nested = findStatement(statement.body, id);
      if (nested) return nested;
    }
  }
  return null;
}

type TargetedAction = { action: EditAction; sourceId: string; mergeable: boolean };

function candidateActions(snapshot: SessionSnapshot, r: readonly number[]): TargetedAction[] {
  const ids = [...new Set(snapshot.scene?.elements.map((element) => element.sourceRef.sourceId) ?? [])]
    .filter((id) => snapshot.parseResult && findStatement(snapshot.parseResult.figure.body, id));
  if (ids.length === 0) return [];
  const sourceId = ids[Math.floor(r[1] * ids.length)];
  const delta = worldPoint(pt(cm((r[2] - 0.3) * 0.9)), pt(cm((r[3] - 0.6) * 0.9)));
  const actions: TargetedAction[] = [
    { action: { kind: "moveElement", elementId: sourceId, delta }, sourceId, mergeable: true },
    { action: { kind: "setProperty", elementId: sourceId, level: "command", key: "fill", value: r[2] < 0.5 ? "red!20" : "blue!35" }, sourceId, mergeable: false },
    { action: { kind: "setProperty", elementId: sourceId, level: "command", key: "line width", value: `${(0.3 + r[3]).toFixed(2)}pt` }, sourceId, mergeable: false },
    { action: { kind: "deleteElement", elementId: sourceId }, sourceId, mergeable: false }
  ];
  const handles = snapshot.editHandles.filter((handle) => handle.sourceRef.sourceId === sourceId && handle.handleType === "coordinate" && handle.rewriteMode === "direct");
  if (handles.length > 0) {
    const handle = handles[Math.floor(r[2] * handles.length)];
    actions.push({ action: { kind: "moveHandle", handleId: handle.id,
      newWorld: worldPoint(pt(handle.world.x + cm((r[3] - 0.3) * 0.7)), pt(handle.world.y + cm((r[2] - 0.6) * 0.7))) }, sourceId, mergeable: true });
  }
  return actions;
}

/**
 * Where the clicked statement is in the current source: its span in the
 * snapshot's source, mapped through the difference to the current one. Null
 * when the difference reaches into the statement, so its identity is moot.
 */
function mappedTargetSpan(snapshot: SessionSnapshot, current: string, sourceId: string): { from: number; to: number } | null {
  const statement = snapshot.parseResult && findStatement(snapshot.parseResult.figure.body, sourceId);
  if (!statement) return null;
  const span = statement.span;
  const edit = singleEdit(snapshot.source, current);
  const delta = edit.insert.length - (edit.to - edit.from);
  if (edit.from === edit.to && edit.insert.length === 0) return span;
  if (span.to < edit.from) return span;
  if (span.from > edit.to) return { from: span.from + delta, to: span.to + delta };
  return null;
}

/**
 * Whether the edit left everything outside the target statement's lines (and
 * the line break on either side) alone. Checked by prefix and suffix, since a
 * minimal diff can place a deleted line at either of two similar lines.
 */
function changeWithin(before: string, after: string, target: { from: number; to: number }): boolean {
  const lineStart = Math.max(0, before.lastIndexOf("\n", target.from - 1));
  const nextNewline = before.indexOf("\n", target.to);
  const lineEnd = nextNewline < 0 ? before.length : nextNewline + 1;
  const prefix = before.slice(0, lineStart);
  const suffix = before.slice(lineEnd);
  return after.length >= prefix.length + suffix.length && after.startsWith(prefix) && after.endsWith(suffix);
}

// ── Runner ──────────────────────────────────────────────────────────────────

/** `mocks` replace modules of the store under test (vi.doMock paths, relative to compute-instances.ts's directory). */
export async function runStoreOps(documents: readonly FuzzDocument[], ops: readonly StoreOp[], mocks: readonly ModuleMock[] = []): Promise<{ failure: StoreFailure | null; counts: Record<string, number> }> {
  const harness = await createHarness(documents, mocks);
  const counts: Record<string, number> = {};
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

  for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
    const op = ops[opIndex];
    const { r } = op;
    const store = harness.store;
    const before: Before = { state: store.getState() };
    harness.storage.savesThisOp = 0;
    const doc = before.state.documents[before.state.activeDocumentId];
    const fail = (invariant: string, details: string[]) => ({ failure: { opIndex, op, invariant, details }, counts });
    try {
      switch (op.kind) {
        case "type": {
          const edit = randomTextEdit(doc.source, makeRng(Math.floor(r[0] * 2 ** 31)));
          store.getState().dispatch({ type: "CODE_EDITED", source: doc.source.slice(0, edit.from) + edit.insert + doc.source.slice(edit.to) });
          harness.gesture = null;
          break;
        }
        case "action":
        case "drag": {
          // The command acts on what is on screen, however stale.
          const candidates = candidateActions(doc.snapshot, r).filter((candidate) => op.kind === "action" || candidate.mergeable);
          if (candidates.length === 0) break;
          const { action, sourceId } = candidates[Math.floor(r[0] * candidates.length)];
          if (op.kind === "drag" && (harness.gesture?.documentId !== doc.id || r[3] < 0.25)) {
            harness.gesture = { key: `drag-${opIndex}`, documentId: doc.id };
          }
          const target = mappedTargetSpan(doc.snapshot, doc.source, sourceId);
          store.getState().dispatch({ type: "APPLY_EDIT_ACTION", action, historyMergeKey: op.kind === "drag" ? harness.gesture!.key : undefined });
          const after = store.getState().documents[doc.id];
          count(doc.snapshot.source === doc.source ? "action:current" : "action:stale");
          if (after.source === doc.source) {
            count(`action:unchanged:${after.lastEditWarningMessage?.slice(0, 40) ?? "no warning"}`);
          } else if (target && !changeWithin(doc.source, after.source, target)) {
            const change = singleEdit(doc.source, after.source);
            return fail("stale edit target", [
              `${action.kind} on ${sourceId} from a snapshot ${doc.snapshot.source === doc.source ? "of the current source" : "of an older source"}`,
              `clicked statement now at ${target.from}-${target.to}: ${JSON.stringify(doc.source.slice(target.from, target.to))}`,
              `but the edit changed ${change.from}-${change.to}: ${JSON.stringify(doc.source.slice(Math.max(0, change.from - 20), change.to + 20))}`
            ]);
          }
          break;
        }
        case "drag-start":
          store.getState().dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: r[0] < 0.5 ? "element" : "handle" });
          break;
        case "drag-end":
          store.getState().dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null });
          harness.gesture = null;
          break;
        case "patches": {
          // A canvas text edit, possibly computed against an older revision. The
          // canvas editor keeps the text well formed (balanced, inside node
          // text), and the store trusts such patches to keep statement identities.
          const stale = r[1] < 0.3 && doc.snapshot.source !== doc.source;
          const base = stale ? doc.snapshot.source : doc.source;
          const edit = benignTextEdit(base, makeRng(Math.floor(r[0] * 2 ** 31)));
          store.getState().dispatch({ type: "APPLY_SOURCE_PATCHES", baseRevision: stale ? doc.sourceRevision - 1 : doc.sourceRevision,
            patches: [{ oldSpan: { from: edit.from, to: edit.to }, newSpan: { from: edit.from, to: edit.from + edit.insert.length }, replacement: edit.insert }],
            changedSourceIds: [], historyMergeKey: r[2] < 0.6 ? "canvas-typing" : undefined });
          harness.gesture = null;
          break;
        }
        case "undo":
          store.getState().dispatch({ type: "UNDO" });
          harness.gesture = null;
          break;
        case "redo":
          store.getState().dispatch({ type: "REDO" });
          harness.gesture = null;
          break;
        case "undo-redo": {
          if (doc.historyIndex < 0) break;
          store.getState().dispatch({ type: "UNDO" });
          store.getState().dispatch({ type: "REDO" });
          const after = store.getState().documents[doc.id];
          count("undo-redo");
          if (after.source !== doc.source) return fail("undo then redo", ["redo after undo did not restore the source"]);
          break;
        }
        case "render-now":
          // The common case: a render lands before the next input.
          schedule(harness, r[0] < 0.5);
          await finishAll(harness);
          break;
        case "compute":
          // Typing keeps the running render; other changes abort it.
          schedule(harness, r[0] < 0.5);
          break;
        case "deliver":
          await finishRunning(harness);
          break;
        case "drop":
          // An immediate cause invalidates: the queue empties and the running render aborts.
          harness.scheduler.queued = null;
          harness.scheduler.running?.controller.abort();
          break;
        case "settle": {
          await settle(harness);
          count("settle");
          const problems = await checkSettledRender(harness);
          if (problems.length > 0) return fail("settled render", problems);
          break;
        }
        case "switch": {
          const ids = Object.keys(before.state.documents);
          store.getState().dispatch({ type: "SWITCH_DOCUMENT", documentId: ids[Math.floor(r[0] * ids.length)] });
          harness.gesture = null;
          break;
        }
        case "open": {
          if (Object.keys(before.state.documents).length >= 4) break;
          const document = documents[Math.floor(r[0] * documents.length)];
          store.getState().dispatch({ type: "NEW_DOCUMENT", source: document.source, title: document.label });
          harness.gesture = null;
          break;
        }
        case "close": {
          if (Object.keys(before.state.documents).length <= 1) break;
          store.getState().dispatch({ type: "CLOSE_DOCUMENT" });
          harness.gesture = null;
          break;
        }
        case "root": {
          const roots = doc.snapshot.deck ? doc.snapshot.deck.frames.map((frame) => frame.id) : doc.snapshot.figures.map((figure) => figure.id);
          if (roots.length === 0) break;
          store.getState().dispatch({ type: "SET_ACTIVE_ROOT", rootId: roots[Math.floor(r[0] * roots.length)] });
          harness.gesture = null;
          break;
        }
        case "step": {
          if (!doc.snapshot.deck || !doc.activeRootId) break;
          const frame = doc.snapshot.deck.frames.find((entry) => entry.id === doc.activeRootId);
          store.getState().dispatch({ type: "SET_DECK_STEP", rootId: doc.activeRootId, step: 1 + Math.floor(r[0] * ((frame?.stepCount ?? 1) + 1)) });
          break;
        }
        case "save-start":
          harness.saves.push({ documentId: doc.id, source: doc.source, sourceRevision: doc.sourceRevision, diskRevision: doc.diskRevision ?? null, fileRef: doc.fileRef });
          break;
        case "save-finish": {
          // performSave: the write lands, possibly after further edits, and possibly refused or failed.
          const save = harness.saves.splice(Math.floor(r[0] * harness.saves.length), 1)[0];
          const owner = () => {
            const current = store.getState().documents[save.documentId];
            return current && sameDocumentFileRef(current.fileRef, save.fileRef) ? current : null;
          };
          if (!save || !owner()) break;
          if (!save.fileRef?.path) {
            store.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: save.documentId, savedSource: save.source });
            break;
          }
          let result = writeLinked(harness, save.fileRef.path, save.source, save.diskRevision, r[1] < 0.1);
          count(`save:${result.status}`);
          if (result.status === "changed-on-disk") {
            store.getState().dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: save.documentId, externalChangeStatus: "changed" });
            const decision = r[2] < 0.3 ? "reload" : r[2] < 0.6 ? "save-anyway" : "cancel";
            count(`conflict:${decision}`);
            const current = owner();
            if (!current) break;
            if (decision === "reload") {
              // The person chose to drop their text; allowed only if they have not typed since.
              if (current.sourceRevision !== save.sourceRevision) break;
              store.getState().dispatch({ type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK", documentId: save.documentId,
                source: result.source, fileRef: result.fileRef, diskRevision: result.revision });
              break;
            }
            if (decision === "cancel") break;
            result = writeLinked(harness, save.fileRef.path, save.source, null, false);
          }
          if (result.status === "saved") {
            store.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: save.documentId, savedSource: save.source,
              fileRef: result.fileRef, diskRevision: result.revision, lastKnownDiskSource: save.source });
          } else if (result.status !== "changed-on-disk") {
            store.getState().dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: save.documentId,
              externalChangeStatus: result.status === "missing" || result.status === "permission-needed" ? result.status : "error" });
          }
          break;
        }
        case "external-write": {
          // Another program changes the file.
          const path = doc.fileRef?.path;
          const file = path ? harness.disk.get(path) : undefined;
          if (!file) break;
          const edit = randomTextEdit(file.source, makeRng(Math.floor(r[0] * 2 ** 31)));
          file.source = file.source.slice(0, edit.from) + edit.insert + file.source.slice(edit.to);
          file.revision = nextDiskRevision(harness, file.source);
          file.history.add(file.source);
          break;
        }
        case "refresh": {
          // readLinkedDocument on focus: reload, mark a conflict, or clear one.
          const path = doc.fileRef?.path;
          const file = path ? harness.disk.get(path) : undefined;
          if (!file || !doc.fileRef) break;
          const read: LinkedTextReadResult = r[1] < 0.08 ? { status: "failed", reason: "injected" }
            : { status: "ok", source: file.source, revision: file.revision, fileRef: doc.fileRef };
          const decision = decideLinkedFileRefresh(doc, read);
          count(`refresh:${decision.kind}${decision.kind === "mark-status" ? `:${decision.externalChangeStatus}` : ""}`);
          if (decision.kind === "reload") {
            if (!file.history.has(doc.source)) {
              return fail("silent data loss", [`refresh would reload ${doc.title} over text that was never written to its file`]);
            }
            store.getState().dispatch({ type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK", documentId: doc.id,
              source: decision.source, fileRef: decision.fileRef, diskRevision: decision.revision });
          } else if (decision.kind === "mark-status") {
            store.getState().dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: doc.id,
              externalChangeStatus: decision.externalChangeStatus,
              diskRevision: decision.externalChangeStatus === "changed" ? undefined : decision.revision,
              lastKnownDiskSource: decision.externalChangeStatus === "changed" ? undefined : decision.source });
          }
          break;
        }
        case "storage-fault":
          harness.storage.failing = r[0] < 0.5;
          break;
      }
    } catch (error) {
      return fail("threw", [String(error instanceof Error ? error.stack : error)]);
    }
    const problems = [...checkInvariants(before, harness.store.getState(), harness.disk), ...checkPersistence(harness)];
    if (problems.length > 0) return fail(problems[0].split(":")[0], problems);
  }
  return { failure: null, counts };
}

const WEIGHTS: [StoreOpKind, number][] = [
  ["type", 6], ["action", 12], ["drag", 10], ["drag-start", 3], ["drag-end", 3], ["patches", 6], ["undo", 6], ["redo", 4], ["undo-redo", 6], ["render-now", 14], ["compute", 6],
  ["deliver", 8], ["drop", 2], ["settle", 4], ["switch", 3], ["open", 1], ["close", 1], ["root", 3], ["step", 2], ["save-start", 3],
  ["save-finish", 3], ["external-write", 2], ["refresh", 3], ["storage-fault", 2]
];

export function generateStoreOps(seed: number, steps: number): StoreOp[] {
  const rng = makeRng(seed);
  const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  const ops: StoreOp[] = [];
  for (let step = 0; step < steps; step += 1) {
    let roll = rng() * total;
    const kind = WEIGHTS.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? "type";
    ops.push({ kind, r: [rng(), rng(), rng(), rng()] });
  }
  ops.push({ kind: "settle", r: [0, 0, 0, 0] });
  return ops;
}

export async function shrinkStoreOps(documents: readonly FuzzDocument[], ops: readonly StoreOp[], budget = 150): Promise<{ ops: StoreOp[]; failure: StoreFailure }> {
  let result = await runStoreOps(documents, ops);
  if (!result.failure) throw new Error("shrinkStoreOps: the operations do not fail");
  let current = ops.slice(0, result.failure.opIndex + 1);
  let failure = result.failure;
  let runs = 0;
  for (let chunk = Math.max(1, Math.floor(current.length / 2)); chunk >= 1 && runs < budget; chunk = Math.floor(chunk / 2)) {
    for (let start = 0; start < current.length && runs < budget;) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunk)];
      runs += 1;
      result = await runStoreOps(documents, candidate);
      // Shrink toward the same invariant, so the report stays about one bug.
      if (result.failure && result.failure.invariant === failure.invariant) {
        current = candidate.slice(0, result.failure.opIndex + 1);
        failure = result.failure;
      } else {
        start += chunk;
      }
    }
  }
  return { ops: current, failure };
}

export function describeStoreFailure(documents: readonly FuzzDocument[], seed: number, ops: readonly StoreOp[], failure: StoreFailure): string {
  return [
    `store invariant broken: ${failure.invariant} (seed ${seed}, documents ${documents.map((document) => document.label).join(", ")})`,
    `at op ${failure.opIndex}: ${failure.op.kind}`,
    ...failure.details.map((detail) => `  ${detail}`),
    `ops (${ops.length}): ${ops.map((op) => op.kind).join(" ")}`,
    JSON.stringify(ops)
  ].join("\n");
}
