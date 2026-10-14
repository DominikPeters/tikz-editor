/**
 * Differential fuzzer for the compute pipeline's shortcuts.
 *
 * A "warm" compute module receives the stream of requests the app sends while
 * someone edits: typing (changes inferred against the last render), edit
 * commands with patches and changed statement ids, drags, coalesced edits that
 * skip revisions, root and overlay-step navigation, canvas text-edit masks,
 * cached-page claims, neighbor prewarming, renders aborted midway and renders
 * racing each other, and on slides the drawing layer: picking a layer (or the
 * next one, still to come) and editing its shapes as the canvas does. Every result the app would show is compared with a "cold"
 * render of the same request in a fresh module instance, without any hints.
 * The two must be identical: the shortcuts (incremental parsing and
 * evaluation, SVG reuse, the deck session and page cache, syntax-index reuse)
 * may only change how fast the output appears, never what it is.
 *
 * Runs are sequences of concrete operations, so a failure replays from its
 * operation list alone and shrinks by dropping operations.
 */
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { applyEditAction, type EditAction } from "../../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import type { SourcePatch } from "../../packages/core/src/edit/types.js";
import type { SvgViewBox } from "../../packages/core/src/svg/types.js";
import type { ComputeRequest, ComputeResponse, SessionSnapshot } from "../../packages/app/src/compute.js";
import { reconcileActiveRootSelection, snapshotRoots } from "../../packages/app/src/root-inventory.js";
import { formatDocumentRootId, parseDocumentRootId } from "../../packages/core/src/document/root-id.js";
import { executeDocumentEdit } from "../../packages/app/src/edit-execution.js";
import { beamerOverlayPicturesIn, scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../../packages/core/src/beamer/syntax.js";
import { worldToPictureCoordinates } from "../../packages/app/src/ui/canvas-panel/picture-coordinates.js";
import { freshComputeModule, type ComputeModule } from "./compute-instances.js";
import { diffValues } from "./snapshot-diff.js";

export type FuzzDocument = { label: string; source: string };

type Span = { from: number; to: number };
export type TextEdit = { from: number; to: number; insert: string };
type EditOrigin = "source-editor" | "edit-command";

export type FuzzOp =
  /** A source change; `render: false` leaves it to be coalesced into a later render. */
  | { kind: "edit"; doc: number; edit: TextEdit; origin: EditOrigin; changedSourceIds: string[] | null; drag: boolean; render: boolean; note: string;
    /** A drawing-layer edit sends its own patches and changed ids, as a tikz edit does. */
    layer?: { patches: SourcePatch[]; changedSourceIds: string[] | null } }
  /** A drawing tool or a shape's click picks a slide's drawing layer (null: the tool is put down). */
  | { kind: "layer"; doc: number; root: string | null }
  /** Undo/redo: the source returns to an earlier text, with no patch. */
  | { kind: "history"; doc: number; back: number }
  | { kind: "navigate"; doc: number; root: string | null; step: number }
  /** A canvas text-edit session starts (span) or ends (null). */
  | { kind: "mask"; doc: number; span: Span | null }
  | { kind: "render"; doc: number }
  | { kind: "aborted-render"; doc: number; afterYields: number }
  /** A render is overtaken by an edit and the render of that edit. */
  | { kind: "race"; doc: number; edit: TextEdit; newerFirst: boolean }
  | { kind: "neighbors"; doc: number; abortAfterYields: number | null }
  | { kind: "hover-prewarm"; doc: number; sourceId: string };

export type FuzzFailure = {
  opIndex: number;
  op: FuzzOp;
  what: string;
  request: ComputeRequest;
  differences: string[];
};

/** Which shortcuts the warm side actually took, to check the generator reaches them. */
export type FuzzReach = Record<string, number>;

export type FuzzRunResult = { failure: FuzzFailure | null; reach: FuzzReach; comparisons: number };

/** Lets mutation tests run the warm side against a sabotaged module. */
export type WarmModuleFactory = () => Promise<ComputeModule>;

// ── Oracle ──────────────────────────────────────────────────────────────────

const IGNORED_KEYS = new Set([
  // Request bookkeeping, not output (a drawing layer echoes the layer it was asked for).
  "revision", "cacheEpoch", "incremental", "requestedRootId",
  // Whether a deck's parse is known to be a fresh parse's; checked by healing (see `check`).
  "exactParse",
  // Retained layout state for later incremental renders; its output is in the scene and SVG.
  "textLayoutContext",
  // Identity of an evaluation run, not of the content.
  "runtimeId"
]);

type ColdKey = string;
const COLD_CACHE_LIMIT = 256;
const coldCache = new Map<ColdKey, ComputeResponse>();

function coldRequest(request: ComputeRequest): ComputeRequest {
  return {
    id: "cold",
    documentId: request.documentId,
    kind: "render",
    source: request.source,
    sourceRevision: request.sourceRevision,
    documentFileRef: request.documentFileRef ?? null,
    activeRootId: request.activeRootId,
    deckStep: request.deckStep,
    includeDrawingLayer: request.includeDrawingLayer,
    drawingLayerRootId: request.drawingLayerRootId ?? null,
    textEditMaskSpan: request.textEditMaskSpan ?? null,
    renderViewBox: request.renderViewBox ?? null
  };
}

/** The reference result: a fresh module instance that has never seen another request. */
export async function coldCompute(request: ComputeRequest): Promise<ComputeResponse> {
  const cold = coldRequest(request);
  const key = JSON.stringify(cold);
  const cached = coldCache.get(key);
  if (cached) {
    coldCache.delete(key);
    coldCache.set(key, cached);
    return cached;
  }
  const module = await freshComputeModule();
  const response = await module.computeSnapshot(cold);
  coldCache.set(key, response);
  if (coldCache.size > COLD_CACHE_LIMIT) coldCache.delete(coldCache.keys().next().value!);
  return response;
}

/**
 * The text engine names paragraphs (`tex:12`) and interns source maps
 * (`|sm:3`) with counters that run for the engine's lifetime. Those are
 * identities of a run, not output.
 */
function stripRunIdentities(text: string): string {
  return text.includes("tex:") || text.includes("|sm:")
    ? text.replace(/\btex:\d+\b/gu, "tex:*").replace(/\|sm:[0-9a-z]+/gu, "|sm:*")
    : text;
}

export function compareResponses(expected: ComputeResponse, actual: { snapshot: SessionSnapshot; diagnostics: unknown }): string[] {
  return diffValues(
    { snapshot: expected.snapshot, diagnostics: expected.diagnostics },
    { snapshot: actual.snapshot, diagnostics: actual.diagnostics },
    { ignoredKeys: IGNORED_KEYS, normalizers: { expected: stripRunIdentities, actual: stripRunIdentities } }
  );
}

// ── App model ───────────────────────────────────────────────────────────────

type DocState = {
  documentId: string;
  source: string;
  revision: number;
  root: string | null;
  rootInitialized: boolean;
  /** The slide's drawing layer providing editing geometry (the store's drawingLayerRootId). */
  drawingLayer: string | null;
  step: number;
  mask: Span | null;
  lastEdit: {
    origin: EditOrigin | "history";
    patches: SourcePatch[] | null;
    base: number | null;
    changedSourceIds: string[] | null;
    trigger: "drag-handle" | "other";
  };
  history: string[];
  dragViewBox: SvgViewBox | null;
  /** The snapshot the app shows for this document. */
  shown: SessionSnapshot | null;
};

let requestCounter = 0;

function requestFor(doc: DocState): ComputeRequest {
  return {
    id: `warm-${++requestCounter}`,
    documentId: doc.documentId,
    kind: "render",
    source: doc.source,
    sourceRevision: doc.revision,
    activeRootId: doc.root,
    deckStep: isDeckSource(doc.source) ? doc.step : null,
    // As App.tsx: every slide render asks for its drawing layer.
    ...(isDeckSource(doc.source) && { includeDrawingLayer: true, drawingLayerRootId: doc.drawingLayer }),
    changedSourceIds: doc.lastEdit.changedSourceIds,
    patches: doc.lastEdit.patches,
    patchBaseRevision: doc.lastEdit.base,
    trigger: doc.lastEdit.trigger,
    inferSourceChanges: doc.lastEdit.origin !== "edit-command",
    textEditMaskSpan: doc.mask,
    renderViewBox: doc.dragViewBox
  };
}

function clampEdit(source: string, edit: TextEdit): TextEdit {
  const from = Math.max(0, Math.min(edit.from, source.length));
  const to = Math.max(from, Math.min(edit.to, source.length));
  return { from, to, insert: edit.insert };
}

function mapThroughEdit(offset: number, edit: TextEdit, assoc: -1 | 1): number {
  if (offset < edit.from || (offset === edit.from && assoc < 0)) return offset;
  if (offset > edit.to || (offset === edit.to && assoc > 0)) return offset + edit.insert.length - (edit.to - edit.from);
  return assoc < 0 ? edit.from : edit.from + edit.insert.length;
}

function applyEdit(doc: DocState, rawEdit: TextEdit, origin: EditOrigin, changedSourceIds: string[] | null, drag: boolean,
  layer?: { patches: SourcePatch[]; changedSourceIds: string[] | null }): boolean {
  const edit = clampEdit(doc.source, rawEdit);
  const source = doc.source.slice(0, edit.from) + edit.insert + doc.source.slice(edit.to);
  if (source === doc.source) return false;
  const patch: SourcePatch = {
    oldSpan: { from: edit.from, to: edit.to },
    newSpan: { from: edit.from, to: edit.from + edit.insert.length },
    replacement: edit.insert
  };
  doc.history.push(doc.source);
  if (doc.history.length > 12) doc.history.shift();
  if (doc.mask) {
    const from = mapThroughEdit(doc.mask.from, edit, -1);
    const to = mapThroughEdit(doc.mask.to, edit, 1);
    doc.mask = to > from ? { from, to } : null;
  }
  doc.lastEdit = layer
    ? { origin, patches: layer.patches, base: doc.revision, changedSourceIds: layer.changedSourceIds, trigger: drag ? "drag-handle" : "other" }
    : origin === "edit-command"
    ? { origin, patches: [patch], base: doc.revision, changedSourceIds: isDeckSource(doc.source) ? [] : changedSourceIds, trigger: drag ? "drag-handle" : "other" }
    : { origin, patches: null, base: null, changedSourceIds: null, trigger: "other" };
  if (!drag) doc.dragViewBox = null;
  else doc.dragViewBox ??= doc.shown?.svg?.viewBox ?? null;
  doc.source = source;
  doc.revision += 1;
  return true;
}

/** Cooperative work that yields at every step, aborting after `abortAfter` yields. */
function yieldingWork(abortAfter: number | null) {
  const controller = new AbortController();
  let yields = 0;
  return {
    controller,
    work: {
      budgetMs: 0,
      signal: controller.signal,
      yieldControl: async () => {
        yields += 1;
        if (abortAfter != null && yields >= abortAfter) controller.abort();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  };
}

function count(reach: FuzzReach, key: string): void {
  reach[key] = (reach[key] ?? 0) + 1;
}

function recordReach(reach: FuzzReach, snapshot: SessionSnapshot): void {
  const incremental = snapshot.incremental;
  if (snapshot.overlayLayer?.pageCoordinates) {
    count(reach, snapshot.overlayLayer.insertion ? "layer:to-come" : "layer:shown");
    if (incremental?.deckLayoutReused) count(reach, "layer:slide-layout-reused");
  }
  if (incremental) {
    count(reach, `parse:${incremental.parseStrategy}${incremental.parseFallbackReason ? `:${incremental.parseFallbackReason}` : ""}`);
    if (incremental.parsePatchApplication) count(reach, `patches:${incremental.parsePatchApplication}`);
    count(reach, `semantic:${incremental.strategy}${incremental.replayMode ? `:${incremental.replayMode}` : ""}`);
  } else if (snapshot.deck) {
    count(reach, "deck:render");
  } else {
    count(reach, "tikz:full");
  }
}

class Mismatch extends Error {
  constructor(readonly what: string, readonly request: ComputeRequest, readonly differences: string[]) {
    super(`${what}: ${differences.join("; ")}`);
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────

export async function runOps(documents: readonly FuzzDocument[], ops: readonly FuzzOp[], warmFactory: WarmModuleFactory = freshComputeModule,
  trace?: (line: string) => void): Promise<FuzzRunResult> {
  const warm = await warmFactory();
  const reach: FuzzReach = {};
  const docs = documents.map((document, index) => initialDocState(document, index));
  let comparisons = 0;

  /**
   * Compares with a cold render and returns the snapshot shown afterwards. A
   * deck reparsed with syntax errors may differ, but says its parse is not
   * exact; the app then parses it afresh once typing pauses, which must match.
   */
  const check = async (what: string, request: ComputeRequest, actual: { snapshot: SessionSnapshot; diagnostics: unknown },
    { shown = true }: { shown?: boolean } = {}): Promise<SessionSnapshot> => {
    comparisons += 1;
    recordReach(reach, actual.snapshot);
    const incremental = actual.snapshot.incremental;
    trace?.(`  ${what}: ${incremental ? `${incremental.parseStrategy}${incremental.parseFallbackReason ? `(${incremental.parseFallbackReason})` : ""} ${incremental.strategy}` : actual.snapshot.deck ? "deck" : "full"}`);
    const expected = await coldCompute(request);
    const differences = compareResponses(expected, actual);
    const inexact = actual.snapshot.deck?.exactParse === false;
    if (differences.length > 0 && !inexact) throw new Mismatch(what, request, differences);
    // A response the app discards is never parsed afresh.
    if (!shown) return actual.snapshot;
    // Typing does not always pause at an inexact parse; when it differs it must be healed.
    if (!inexact || (differences.length === 0 && comparisons % 2 === 0)) return actual.snapshot;
    count(reach, differences.length > 0 ? "deck:exact-parse-healed" : "deck:exact-parse");
    const exactRequest = { ...request, id: `${request.id}-exact`, exactParse: true };
    const exact = await warm.computeSnapshot(exactRequest);
    const remaining = compareResponses(expected, exact);
    if (remaining.length > 0) throw new Mismatch(`${what}, parsed afresh after a pause`, exactRequest, remaining);
    if (exact.snapshot.deck?.exactParse === false) throw new Mismatch(`${what}, parsed afresh after a pause`, exactRequest, ["deck parse still not exact"]);
    return exact.snapshot;
  };

  /** Shows a snapshot as the store does; true when its root selection changed. */
  const publish = async (doc: DocState, request: ComputeRequest, response: ComputeResponse, what: string): Promise<boolean> => {
    const shown = await check(what, request, response);
    const previous = doc.shown;
    doc.shown = shown;
    return reconcileRoot(doc, previous, shown);
  };

  const render = async (doc: DocState, what: string): Promise<void> => {
    // A changed root selection schedules another render, as in the app.
    for (let round = 0; round < 3; round += 1) {
      const request = requestFor(doc);
      if (isDeckSource(doc.source) && doc.shown && warm.isDeckSnapshotCurrent(doc.shown, request)) {
        // The app keeps the published page instead of rendering again.
        count(reach, "deck:current");
        doc.shown = await check(`${what} (kept current page)`, request, { snapshot: doc.shown, diagnostics: shownDiagnostics(doc.shown) });
        return;
      }
      if (!await publish(doc, request, await warm.computeSnapshot(request), round === 0 ? what : `${what}, after root reconciliation`)) return;
    }
  };

  for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
    const op = ops[opIndex];
    const doc = docs[op.doc % docs.length];
    trace?.(`${opIndex} ${op.kind}${op.kind === "edit" ? ` ${op.note} ${JSON.stringify(op.edit)}` : ""}`);
    try {
      switch (op.kind) {
        case "edit": {
          if (applyEdit(doc, op.edit, op.origin, op.changedSourceIds, op.drag, op.layer) && op.render) await render(doc, op.note);
          break;
        }
        case "layer": {
          if (!isDeckSource(doc.source)) break;
          doc.drawingLayer = op.root;
          doc.mask = null;
          doc.dragViewBox = null;
          await render(doc, op.root ? `pick drawing layer ${op.root}` : "put the drawing tool down");
          break;
        }
        case "history": {
          const target = doc.history[Math.max(0, doc.history.length - op.back)];
          if (target === undefined || target === doc.source) break;
          doc.history.push(doc.source);
          doc.source = target;
          doc.revision += 1;
          doc.lastEdit = { origin: "history", patches: null, base: null, changedSourceIds: null, trigger: "other" };
          doc.mask = null;
          doc.dragViewBox = null;
          await render(doc, "undo");
          break;
        }
        case "navigate": {
          if (op.root !== doc.root) doc.drawingLayer = null;
          doc.root = op.root;
          doc.step = op.step;
          doc.mask = null;
          doc.dragViewBox = null;
          if (isDeckSource(doc.source)) {
            // The store claims a completed page before scheduling a render.
            const request = requestFor(doc);
            const claimed = warm.claimCachedDeckSnapshot({ id: request.id, documentId: doc.documentId, source: doc.source,
              sourceRevision: doc.revision, activeRootId: doc.root, deckStep: doc.step,
              drawingLayerRootId: doc.drawingLayer, includeDrawingLayer: true });
            if (claimed) {
              count(reach, "deck:claimed");
              // A claimed page is the page as drawn, without a drawing layer's
              // editing geometry; a slide with a layer renders that next.
              const plain = { ...request, includeDrawingLayer: undefined, drawingLayerRootId: undefined };
              const shown = await check("navigate (claimed cached page)", plain, { snapshot: claimed, diagnostics: shownDiagnostics(claimed) });
              const previous = doc.shown;
              doc.shown = shown;
              reconcileRoot(doc, previous, shown);
              await render(doc, "render after a claimed page");
              break;
            }
          }
          await render(doc, "navigate");
          break;
        }
        case "mask": {
          doc.mask = op.span && op.span.to <= doc.source.length && op.span.from < op.span.to ? op.span : null;
          await render(doc, op.span ? "text edit starts" : "text edit ends");
          break;
        }
        case "render": {
          await render(doc, "render");
          break;
        }
        case "aborted-render": {
          const { work } = yieldingWork(op.afterYields);
          const request = requestFor(doc);
          try {
            const response = await warm.computeSnapshot(request, work);
            // Finished before the abort: an ordinary result.
            if (await publish(doc, request, response, "render that outran its abort")) await render(doc, "render after root reconciliation");
          } catch (error) {
            if (!(error instanceof Error && error.name === "AbortError")) throw error;
            count(reach, "aborted");
          }
          break;
        }
        case "race": {
          const olderRequest = requestFor(doc);
          const older = warm.computeSnapshot(olderRequest, yieldingWork(null).work);
          if (!applyEdit(doc, op.edit, "source-editor", null, false)) {
            if (await publish(doc, olderRequest, await older, "race without a second edit")) await render(doc, "render after root reconciliation");
            break;
          }
          const newerRequest = requestFor(doc);
          const newer = warm.computeSnapshot(newerRequest, yieldingWork(null).work);
          const [first, second] = op.newerFirst
            ? [{ promise: newer, request: newerRequest, what: "newer render of a race" }, { promise: older, request: olderRequest, what: "older render of a race" }]
            : [{ promise: older, request: olderRequest, what: "older render of a race" }, { promise: newer, request: newerRequest, what: "newer render of a race" }];
          const firstResponse = await first.promise;
          const secondResponse = await second.promise;
          count(reach, "race");
          const firstShown = await check(first.what, first.request, firstResponse, { shown: first.request === newerRequest });
          const secondShown = await check(second.what, second.request, secondResponse, { shown: second.request === newerRequest });
          const previous = doc.shown;
          doc.shown = first.request === newerRequest ? firstShown : secondShown;
          if (reconcileRoot(doc, previous, doc.shown)) await render(doc, "render after root reconciliation");
          break;
        }
        case "neighbors": {
          if (!isDeckSource(doc.source)) break;
          const { work } = yieldingWork(op.abortAfterYields);
          await warm.prewarmDeckNeighbors(requestFor(doc), work);
          count(reach, "deck:prewarm");
          break;
        }
        case "hover-prewarm": {
          if (isDeckSource(doc.source)) break;
          await warm.computeSnapshot({ ...requestFor(doc), kind: "prewarm", changedSourceIds: [op.sourceId], trigger: "drag-element",
            patches: null, patchBaseRevision: null, inferSourceChanges: false, textEditMaskSpan: null });
          count(reach, "tikz:prewarm");
          break;
        }
      }
    } catch (error) {
      if (error instanceof Mismatch) {
        return { failure: { opIndex, op, what: error.what, request: error.request, differences: error.differences }, reach, comparisons };
      }
      return { failure: { opIndex, op, what: "threw", request: requestFor(doc), differences: [String(error instanceof Error ? error.stack : error)] }, reach, comparisons };
    }
  }
  return { failure: null, reach, comparisons };
}

/** The store's root reconciliation on SNAPSHOT_READY (reducer.ts). */
function reconcileRoot(doc: DocState, previous: SessionSnapshot | null, snapshot: SessionSnapshot): boolean {
  // The layer a slide snapshot edits becomes the document's (reducer, SNAPSHOT_READY).
  if (snapshot.overlayLayer?.pageCoordinates) doc.drawingLayer = snapshot.overlayLayer.rootId;
  const keepsNestedFigureRoot = snapshot.deck == null && parseDocumentRootId(doc.root ?? "")?.kind === "beamer-frame-tikz" && isDeckSource(snapshot.source);
  if (keepsNestedFigureRoot) return false;
  const selection = reconcileActiveRootSelection({
    activeRootId: doc.root,
    hasInitializedRootSelection: doc.rootInitialized,
    previousRootCount: previous ? snapshotRoots(previous).length : 0,
    roots: snapshotRoots(snapshot)
  });
  const changed = selection.activeRootId !== doc.root;
  doc.root = selection.activeRootId;
  doc.rootInitialized = selection.hasInitializedRootSelection;
  return changed;
}

/**
 * A deck made long by repeating the frames of `deck`. Lezer reuses only
 * whole subtrees of an earlier parse, which a short deck does not have, so
 * the reparse from a previous tree is exercised only on long ones.
 */
export function longDeck(deck: FuzzDocument, copies: number): FuzzDocument {
  const begin = deck.source.indexOf("\\begin{document}") + "\\begin{document}".length;
  const end = deck.source.lastIndexOf("\\end{document}");
  const body = deck.source.slice(begin, end);
  const bodies = Array.from({ length: copies }, (_, index) => body.replace(/\\section\{([^}]*)\}/gu, `\\section{$1 ${index + 1}}`));
  return { label: `${deck.label} ×${copies}`, source: deck.source.slice(0, begin) + bodies.join("") + deck.source.slice(end) };
}

/**
 * A figure made long by repeating the body of `document`'s first picture,
 * each copy in a shifted scope. Selective replay keeps a checkpoint every
 * few statements, which short figures barely cross. Node names repeat, so
 * later copies redefine them and later references follow the latest one.
 */
export function longFigure(document: FuzzDocument, copies: number): FuzzDocument {
  const begin = document.source.indexOf("\n", document.source.indexOf("\\begin{tikzpicture}")) + 1;
  const end = document.source.indexOf("\\end{tikzpicture}");
  const body = document.source.slice(begin, end);
  const bodies = Array.from({ length: copies }, (_, index) => `\\begin{scope}[xshift=${index * 6}cm]\n${body}\\end{scope}\n`);
  return { label: `${document.label} ×${copies}`, source: document.source.slice(0, begin) + bodies.join("") + document.source.slice(end) };
}

function isDeckSource(source: string): boolean {
  return /\\documentclass(\[[^\]]*\])?\{beamer\}/u.test(source);
}

function initialDocState(document: FuzzDocument, index: number): DocState {
  return {
    documentId: `doc-${index}`,
    source: document.source,
    revision: 0,
    root: null,
    rootInitialized: false,
    drawingLayer: null,
    step: 1,
    mask: null,
    lastEdit: { origin: "history", patches: null, base: null, changedSourceIds: null, trigger: "other" },
    history: [],
    dragViewBox: null,
    shown: null
  };
}

function shownDiagnostics(snapshot: SessionSnapshot): ComputeResponse["diagnostics"] {
  return snapshot.deck?.diagnostics.map((diagnostic) => ({
    code: diagnostic.code ?? "beamer",
    message: diagnostic.message,
    severity: diagnostic.severity
  })) ?? [];
}

// ── Generator ───────────────────────────────────────────────────────────────

export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function chance(rng: () => number, probability: number): boolean {
  return rng() < probability;
}

// Characters and fragments that change how TeX and TikZ read the text around
// them. Text is deliberately asymmetric (no palindromes, distinct numbers).
const CHARACTERS = ["{", "}", "[", "]", "<", ">", "%", "$", "\\", "\n", " ", ",", ";", "(", ")", "-", ".", "q", "W", "7", "&", "^", "_", "="];
const FRAGMENTS = [
  "\\pause ", "\\item ", "\\item<2-> late ", "\\only<2>{", "\\uncover<3->{seen}", "\\end{frame}\n", "\\begin{frame}{Fresh}\n",
  "\\begin{itemize}\n\\item one\n\\end{itemize}\n", "\\note{aside}", "\\section{Later}\n", "\\alert{", "\\textbf{bold} ",
  "\\node (q) at (1.5,-0.25) {$x_2$};\n", "\\draw (0.3,0.1) -- (2.2,1.4);\n", " -- (3.1,-1.7)", "[red,thick]", "node[above] {k}",
  "\\tikzset{every node/.style={draw}}\n", "\\newcommand{\\fooq}{bar}\n", "\\fooq ", "% note\n",
  "\\begin{tikzpicture}\n\\draw (0,0) circle (1.3);\n\\end{tikzpicture}\n", "\\end{tikzpicture}", "\\\\", "\\[ y^3 \\]", "$a_1+b$"
];
const INTERESTING = /\\[a-zA-Z]+|[{}[\]<>%$\n();,]/gu;

function interestingOffsets(source: string): number[] {
  const offsets: number[] = [];
  for (const match of source.matchAll(INTERESTING)) offsets.push(match.index!, match.index! + match[0].length);
  return offsets;
}

function pickOffset(source: string, rng: () => number, within?: Span): number {
  const lo = within?.from ?? 0;
  const hi = within?.to ?? source.length;
  if (chance(rng, 0.55)) {
    const offsets = interestingOffsets(source).filter((offset) => offset >= lo && offset <= hi);
    if (offsets.length > 0) return pick(offsets, rng);
  }
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function randomTextEdit(source: string, rng: () => number, within?: Span): TextEdit {
  const at = pickOffset(source, rng, within);
  const limit = within ? within.to : source.length;
  const roll = rng();
  if (roll < 0.3) return { from: at, to: at, insert: pick(CHARACTERS, rng) };
  if (roll < 0.5) return { from: at, to: at, insert: pick(FRAGMENTS, rng) };
  if (roll < 0.6) {
    // Paste a piece of the document itself, as copy-paste does.
    const start = Math.floor(rng() * source.length);
    return { from: at, to: at, insert: source.slice(start, start + 1 + Math.floor(rng() * 120)) };
  }
  if (roll < 0.75) return { from: Math.max(within?.from ?? 0, at - 1), to: at, insert: "" };
  if (roll < 0.88) return { from: at, to: Math.min(limit, at + 1 + Math.floor(rng() * 60)), insert: "" };
  // Replace a number, as dragging a coordinate does.
  const numbers = [...source.matchAll(/-?\d+(\.\d+)?/gu)].filter((match) => match.index! >= (within?.from ?? 0) && match.index! + match[0].length <= limit);
  if (numbers.length === 0) return { from: at, to: at, insert: pick(CHARACTERS, rng) };
  const number = pick(numbers, rng);
  return { from: number.index!, to: number.index! + number[0].length, insert: (Number(number[0]) + (rng() - 0.4) * 3).toFixed(2) };
}

/**
 * An edit that keeps the text it touches well formed: a coordinate nudged, a
 * letter typed into or deleted from text in braces. These are the edits the
 * shortcuts are meant to handle without a full render, so they must be common.
 */
export function benignTextEdit(source: string, rng: () => number, within?: readonly Span[]): TextEdit {
  const inside = (from: number, to: number) => !within || within.some((span) => span.from <= from && to <= span.to);
  const roll = rng();
  if (roll < 0.5) {
    const numbers = [...source.matchAll(/-?\d+(\.\d+)?/gu)].filter((match) => inside(match.index!, match.index! + match[0].length));
    if (numbers.length > 0) {
      const number = pick(numbers, rng);
      return { from: number.index!, to: number.index! + number[0].length, insert: (Number(number[0]) + (rng() - 0.4) * 3).toFixed(2) };
    }
  }
  const texts = [...source.matchAll(/\{([A-Za-z][A-Za-z ]*)\}/gu)].filter((match) => inside(match.index!, match.index! + match[0].length));
  if (texts.length === 0) {
    // Nothing to nudge or retype: a space inside one of the spans keeps it well formed.
    const span = within && within.length > 0 ? pick(within, rng) : { from: 0, to: source.length };
    const at = span.from + Math.floor(rng() * (span.to - span.from + 1));
    return { from: at, to: at, insert: " " };
  }
  const text = pick(texts, rng);
  const from = text.index! + 1 + Math.floor(rng() * text[1].length);
  return roll < 0.8 || text[1].length < 2
    ? { from, to: from, insert: pick(["q", "W", "e", " ", "k"], rng) }
    : { from, to: from + 1, insert: "" };
}

type GeneratorState = {
  docs: { source: string; isDeck: boolean; mask: Span | null; frames: number; stepCounts: number[]; nestedRoots: string[]; figures: string[];
    statements: { id: string; span: Span }[]; editHandles: SessionSnapshot["editHandles"]; sceneIds: string[];
    /** The cold snapshot the view was read from; drawing-layer edits run against it, as the canvas does. */
    snapshot: SessionSnapshot }[];
};

/**
 * The generator picks operations from a cold render of the current state, so
 * the operations it emits are ones the app could send. Statement ids, frames
 * and handles come from that render.
 */
async function describeDoc(doc: DocState): Promise<GeneratorState["docs"][number]> {
  let response = await coldCompute(requestFor(doc));
  // Follow the root the store would settle on, as the run does.
  for (let round = 0; round < 3; round += 1) {
    const previous = doc.shown;
    doc.shown = response.snapshot;
    if (!reconcileRoot(doc, previous, response.snapshot)) break;
    response = await coldCompute(requestFor(doc));
  }
  const snapshot = response.snapshot;
  const deck = snapshot.deck;
  const nestedRoots = deck
    ? deck.frames.flatMap((frame) => {
      const text = doc.source.slice(frame.span.from, frame.span.to);
      const count = (text.match(/\\begin\{tikzpicture\}/gu) ?? []).length;
      return Array.from({ length: count }, (_, index) => `frame:${frame.frameIndex}:tikzpicture:${index}`);
    })
    : [];
  return {
    source: doc.source,
    isDeck: isDeckSource(doc.source),
    mask: doc.mask,
    frames: deck?.frames.length ?? 0,
    stepCounts: deck?.frames.map((frame) => frame.stepCount) ?? [],
    nestedRoots,
    figures: snapshot.figures.map((figure) => figure.id),
    statements: (snapshot.parseResult?.figure.body ?? []).map((statement) => ({ id: statement.id, span: statement.span })),
    editHandles: snapshot.editHandles,
    sceneIds: [...new Set(snapshot.scene?.elements.map((element) => element.sourceRef.sourceId) ?? [])],
    snapshot
  };
}

/** The drawing layers a tool or a click can pick on the slide shown: its overlay pictures, the next one, none. */
function drawingLayerChoices(doc: DocState, view: GeneratorState["docs"][number]): (string | null)[] {
  const frame = view.snapshot.deck?.activeFrame;
  if (!frame || frame.frameId !== doc.root) return [null];
  const shown = frame.layout.embeddedTikz.flatMap((picture) => picture.overlay ? [picture.overlay.rootId] : []);
  const body = scanBeamerDocument(doc.source).frames[frame.frameIndex]?.bodySpan;
  const pictures = body ? beamerOverlayPicturesIn(createBeamerSyntaxContext(doc.source), body).length : shown.length;
  const next = formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: frame.frameIndex, index: pictures, layer: true });
  return [...shown, next, null];
}

/** A shape edit on the slide's drawing layer, through the app's edit execution (the canvas's path). */
function layerEditCommand(doc: DocState, view: GeneratorState["docs"][number], rng: () => number, focus: Focus):
  { edit: TextEdit; layer: { patches: SourcePatch[]; changedSourceIds: string[] | null }; drag: boolean; note: string } | null {
  const snapshot = view.snapshot;
  if (!snapshot.overlayLayer?.pageCoordinates || snapshot.source !== doc.source) return null;
  // A drag frame: a digit of a coordinate changes, the layer keeps its length.
  const figure = snapshot.parseResult?.figure;
  const statements = !snapshot.overlayLayer.insertion && figure
    ? figure.body.filter((statement) => figure.span.from <= statement.span.from && statement.span.to <= figure.span.to) : [];
  const dragged = focus.drag ? statements.find((statement) => statement.id === focus.drag!.statementId) : undefined;
  if (focus.drag && !dragged) focus.drag = null;
  if (dragged || (statements.length > 0 && chance(rng, 0.6))) {
    const statement = dragged ?? pick(statements, rng);
    // A drag runs over a few frames.
    focus.drag = focus.drag && focus.drag.frames > 1 ? { statementId: statement.id, frames: focus.drag.frames - 1 }
      : dragged ? null : { statementId: statement.id, frames: 2 + Math.floor(rng() * 3) };
    const digits = [...doc.source.slice(statement.span.from, statement.span.to).matchAll(/\d/gu)].map((match) => statement.span.from + match.index);
    if (digits.length > 0) {
      const at = pick(digits, rng);
      const insert = String((Number(doc.source[at]) + 1 + Math.floor(rng() * 8)) % 10);
      const patch: SourcePatch = { oldSpan: { from: at, to: at + 1 }, newSpan: { from: at, to: at + 1 }, replacement: insert };
      return { edit: { from: at, to: at + 1, insert }, layer: { patches: [patch], changedSourceIds: [statement.id] }, drag: true, note: "layer nudge" };
    }
  }
  const actions: { action: EditAction; drag: boolean }[] = [];
  const toPicture = worldToPictureCoordinates(snapshot.scene);
  const at = worldPoint(pt(cm(1 + rng() * 10)), pt(cm(1 + rng() * 7)));
  actions.push(
    { action: { kind: "addElement", at: toPicture(at), template: { kind: "rectangle", corner: toPicture(worldPoint(pt(at.x + cm(1.5)), pt(at.y + cm(0.8)))) } }, drag: false },
    { action: { kind: "addElement", at: toPicture(at), template: { kind: "node", text: pick(["Note", "$x^2$", "Two words"], rng) } }, drag: false }
  );
  if (!snapshot.overlayLayer.insertion && view.sceneIds.length > 0) {
    const elementId = pick(view.sceneIds, rng);
    actions.push(
      { action: { kind: "moveElement", elementId, delta: worldPoint(pt(cm((rng() - 0.5) * 2)), pt(cm((rng() - 0.5) * 2))) }, drag: true },
      // Recolouring keeps the layer's length, as many drags do: the slide's layout then stands.
      { action: { kind: "setProperty", elementId, level: "command", key: "fill", value: pick(["red!20", "red!35", "red!50"], rng) }, drag: false },
      { action: { kind: "setProperty", elementId, level: "command", key: "fill", value: pick(["red!20", "red!35", "red!50"], rng) }, drag: false },
      { action: { kind: "duplicateElements", elementIds: [elementId], delta: worldPoint(pt(cm(0.4)), pt(cm(-0.3))) }, drag: false },
      { action: { kind: "deleteElement", elementId }, drag: false }
    );
    const handles = view.editHandles.filter((handle) => handle.handleType === "coordinate" && handle.rewriteMode === "direct");
    if (handles.length > 0) {
      const handle = pick(handles, rng);
      actions.push({ action: { kind: "moveHandle", handleId: handle.id,
        newWorld: worldPoint(pt(handle.world.x + cm((rng() - 0.5) * 1.4)), pt(handle.world.y + cm((rng() - 0.5) * 1.4))) }, drag: true });
    }
  }
  for (let attempt = 0; attempt < 4 && actions.length > 0; attempt += 1) {
    const { action, drag } = actions.splice(Math.floor(rng() * actions.length), 1)[0];
    const result = executeDocumentEdit({ documentId: doc.documentId, source: doc.source, sourceRevision: doc.revision,
      activeRootId: doc.root, snapshot, drawingLayerRootId: doc.drawingLayer }, action);
    if ((result.kind !== "success" && result.kind !== "partial") || result.newSource === doc.source) continue;
    return { edit: singleEdit(doc.source, result.newSource), layer: { patches: result.patches, changedSourceIds: result.changedSourceIds ?? null },
      drag, note: `layer ${action.kind}` };
  }
  return null;
}

function cm(value: number): number {
  return value * PT_PER_CM;
}

function editCommandFromAction(view: GeneratorState["docs"][number], rng: () => number): { edit: TextEdit; changedSourceIds: string[] | null; drag: boolean; note: string } | null {
  const actions: { action: EditAction; drag: boolean }[] = [];
  if (view.sceneIds.length > 0) {
    const elementId = pick(view.sceneIds, rng);
    actions.push(
      { action: { kind: "moveElement", elementId, delta: worldPoint(pt(cm((rng() - 0.3) * 0.8)), pt(cm((rng() - 0.6) * 0.8))) }, drag: true },
      { action: { kind: "setProperty", elementId, level: "command", key: "fill", value: pick(["red!20", "blue!35", "none"], rng) }, drag: false },
      { action: { kind: "setProperty", elementId, level: "command", key: "line width", value: `${(0.3 + rng()).toFixed(2)}pt` }, drag: false },
      { action: { kind: "duplicateElements", elementIds: [elementId], delta: worldPoint(pt(cm(0.4)), pt(cm(-0.3))) }, drag: false },
      { action: { kind: "deleteElement", elementId }, drag: false }
    );
  }
  const handles = view.editHandles.filter((handle) => handle.handleType === "coordinate" && handle.rewriteMode === "direct");
  if (handles.length > 0) {
    const handle = pick(handles, rng);
    actions.push({ action: { kind: "moveHandle", handleId: handle.id,
      newWorld: worldPoint(pt(handle.world.x + cm((rng() - 0.3) * 0.7)), pt(handle.world.y + cm((rng() - 0.6) * 0.7))) }, drag: true });
  }
  actions.push({ action: { kind: "addElement", template: { kind: "line", to: worldPoint(pt(cm(2.3)), pt(cm(0.9))), hasArrow: true },
    at: worldPoint(pt(cm(0.2)), pt(cm(-0.4))) }, drag: false });
  for (let attempt = 0; attempt < 4 && actions.length > 0; attempt += 1) {
    const { action, drag } = actions.splice(Math.floor(rng() * actions.length), 1)[0];
    const result = applyEditAction(view.source, view.editHandles, action);
    if ((result.kind !== "success" && result.kind !== "partial") || result.newSource === view.source) continue;
    // Express the change as one edit; the patches the action reports may be several.
    const edit = singleEdit(view.source, result.newSource);
    return { edit, changedSourceIds: result.changedSourceIds ?? null, drag, note: `edit command ${action.kind}` };
  }
  return null;
}

export function singleEdit(before: string, after: string): TextEdit {
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > prefix && afterEnd > prefix && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return { from: prefix, to: beforeEnd, insert: after.slice(prefix, afterEnd) };
}

function statementContaining(view: GeneratorState["docs"][number], offset: number): string | null {
  return view.statements.find((statement) => statement.span.from <= offset && offset <= statement.span.to)?.id ?? null;
}

/**
 * Gentle runs make mostly well-formed edits, so they exercise the shortcuts;
 * wild runs break the text and exercise the fallbacks. Wild edits leave errors
 * behind that send every later render the long way.
 */
type Profile = { wild: number };

/** Which document the run edits, and a drag on a drawing layer still going on. */
type Focus = { doc: number; drag?: { statementId: string; frames: number } | null };

async function generateOp(docs: DocState[], rng: () => number, focus: Focus, profile: Profile): Promise<FuzzOp> {
  if (docs.length > 1 && !focus.drag && chance(rng, 0.08)) focus.doc = Math.floor(rng() * docs.length);
  const index = focus.doc;
  const doc = docs[index];
  const view = await describeDoc(doc);
  if (focus.drag && view.snapshot.overlayLayer) {
    const command = layerEditCommand(doc, view, rng, focus);
    if (command) return { kind: "edit", doc: index, origin: "edit-command", render: true, changedSourceIds: null, ...command };
  }
  focus.drag = null;
  const roll = rng();

  if (view.mask) {
    // Inside a canvas text edit: typing within the edited text, then the end.
    if (roll < 0.8) {
      return { kind: "edit", doc: index, edit: chance(rng, profile.wild) ? randomTextEdit(doc.source, rng, view.mask) : benignTextEdit(doc.source, rng, [view.mask]), origin: "edit-command",
        changedSourceIds: view.isDeck ? [] : (statementContaining(view, view.mask.from) ? [statementContaining(view, view.mask.from)!] : null),
        drag: false, render: chance(rng, 0.8), note: "canvas typing" };
    }
    return { kind: "mask", doc: index, span: null };
  }

  const statementSpans = view.isDeck ? undefined : view.statements.map((statement) => statement.span);
  if (roll < 0.32) {
    const edit = chance(rng, profile.wild) ? randomTextEdit(doc.source, rng) : benignTextEdit(doc.source, rng, statementSpans);
    return { kind: "edit", doc: index, edit, origin: "source-editor", changedSourceIds: null,
      drag: false, render: chance(rng, 0.75), note: "source typing" };
  }
  if (roll < 0.56) {
    if (view.isDeck && view.snapshot.overlayLayer && chance(rng, 0.85)) {
      const command = layerEditCommand(doc, view, rng, focus);
      if (command) return { kind: "edit", doc: index, origin: "edit-command", render: chance(rng, 0.85), changedSourceIds: null, ...command };
    }
    if (!view.isDeck && view.editHandles.length > 0 && chance(rng, 0.6)) {
      const command = editCommandFromAction(view, rng);
      if (command) return { kind: "edit", doc: index, origin: "edit-command", render: chance(rng, 0.85), ...command };
    }
    const edit = chance(rng, profile.wild) ? randomTextEdit(doc.source, rng) : benignTextEdit(doc.source, rng, statementSpans);
    const owner = view.isDeck ? null : statementContaining(view, edit.from);
    return { kind: "edit", doc: index, edit, origin: "edit-command", changedSourceIds: owner ? [owner] : view.isDeck ? [] : null,
      drag: !view.isDeck && chance(rng, 0.3), render: chance(rng, 0.8), note: view.isDeck ? "deck command" : "node text typing" };
  }
  if (roll < 0.64) {
    const current = doc.root?.match(/^frame:(\d+)$/u);
    if (view.isDeck && current && chance(rng, 0.5)) {
      // Stepping through the overlays of the frame on screen.
      const steps = view.stepCounts[Number(current[1])] ?? 1;
      return { kind: "navigate", doc: index, root: doc.root, step: 1 + Math.floor(rng() * (steps + 1)) };
    }
    // A deck can show no frame; a picture document always has one chosen.
    const roots: (string | null)[] = view.isDeck
      ? [...Array.from({ length: view.frames }, (_, frame) => `frame:${frame}`), ...view.nestedRoots, null]
      : view.figures;
    const root = roots.length > 0 ? pick(roots, rng) : null;
    const frameIndex = root?.startsWith("frame:") ? Number(root.split(":")[1]) : -1;
    const steps = view.stepCounts[frameIndex] ?? 1;
    return { kind: "navigate", doc: index, root, step: 1 + Math.floor(rng() * (steps + 1)) };
  }
  if (roll < 0.69) {
    // A canvas text edit starts on a short stretch of text.
    const at = pickOffset(doc.source, rng);
    const span = { from: at, to: Math.min(doc.source.length, at + 1 + Math.floor(rng() * 30)) };
    return { kind: "mask", doc: index, span };
  }
  if (roll < 0.74) return { kind: "history", doc: index, back: 1 + Math.floor(rng() * 4) };
  if (roll < 0.79) return { kind: "race", doc: index, edit: chance(rng, profile.wild) ? randomTextEdit(doc.source, rng) : benignTextEdit(doc.source, rng, statementSpans), newerFirst: chance(rng, 0.5) };
  if (roll < 0.85) return { kind: "aborted-render", doc: index, afterYields: 1 + Math.floor(rng() * 40) };
  if (roll < 0.92) {
    if (view.isDeck) return { kind: "neighbors", doc: index, abortAfterYields: chance(rng, 0.4) ? 1 + Math.floor(rng() * 30) : null };
    if (view.sceneIds.length > 0) return { kind: "hover-prewarm", doc: index, sourceId: pick(view.sceneIds, rng) };
  }
  // A drawing tool or a shape's click picks a layer on the slide shown.
  if (view.isDeck && /^frame:\d+$/u.test(doc.root ?? "")) return { kind: "layer", doc: index, root: pick(drawingLayerChoices(doc, view), rng) };
  return { kind: "render", doc: index };
}

/**
 * Generates and runs `steps` operations. Generation needs the state each
 * operation leaves behind, so it advances a private replica of the run.
 */
export async function generateOps(documents: readonly FuzzDocument[], seed: number, steps: number): Promise<FuzzOp[]> {
  const rng = makeRng(seed);
  const docs = documents.map((document, index) => initialDocState(document, index));
  const ops: FuzzOp[] = [];
  const focus: Focus = { doc: 0 };
  const profile: Profile = { wild: seed % 2 === 0 ? 0.1 : 0.5 };
  for (let step = 0; step < steps; step += 1) {
    const op = await generateOp(docs, rng, focus, profile);
    ops.push(op);
    advanceModel(docs, op);
  }
  return ops;
}

/** The state changes of an operation, without rendering. */
function advanceModel(docs: DocState[], op: FuzzOp): void {
  const doc = docs[op.doc % docs.length];
  switch (op.kind) {
    case "edit":
      applyEdit(doc, op.edit, op.origin, op.changedSourceIds, op.drag, op.layer);
      break;
    case "layer":
      if (!isDeckSource(doc.source)) break;
      doc.drawingLayer = op.root;
      doc.mask = null;
      doc.dragViewBox = null;
      break;
    case "race":
      applyEdit(doc, op.edit, "source-editor", null, false);
      break;
    case "history": {
      const target = doc.history[Math.max(0, doc.history.length - op.back)];
      if (target === undefined || target === doc.source) break;
      doc.history.push(doc.source);
      doc.source = target;
      doc.revision += 1;
      doc.lastEdit = { origin: "history", patches: null, base: null, changedSourceIds: null, trigger: "other" };
      doc.mask = null;
      doc.dragViewBox = null;
      break;
    }
    case "navigate":
      if (op.root !== doc.root) doc.drawingLayer = null;
      doc.root = op.root;
      doc.step = op.step;
      doc.mask = null;
      doc.dragViewBox = null;
      break;
    case "mask":
      doc.mask = op.span && op.span.to <= doc.source.length && op.span.from < op.span.to ? op.span : null;
      break;
    default:
      break;
  }
}

// ── Shrinking ───────────────────────────────────────────────────────────────

/**
 * Drops operations while the run still fails at all (any mismatch counts:
 * shrinking toward a different failure still yields a real bug).
 */
export async function shrinkOps(documents: readonly FuzzDocument[], ops: readonly FuzzOp[], warmFactory?: WarmModuleFactory,
  budget = 200): Promise<{ ops: FuzzOp[]; failure: FuzzFailure }> {
  let current = [...ops];
  let result = await runOps(documents, current, warmFactory);
  if (!result.failure) throw new Error("shrinkOps: the operations do not fail");
  current = current.slice(0, result.failure.opIndex + 1);
  let failure = result.failure;
  let runs = 0;
  for (let chunk = Math.max(1, Math.floor(current.length / 2)); chunk >= 1 && runs < budget; chunk = Math.floor(chunk / 2)) {
    for (let start = 0; start < current.length && runs < budget;) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunk)];
      runs += 1;
      result = await runOps(documents, candidate, warmFactory);
      if (result.failure) {
        current = candidate.slice(0, result.failure.opIndex + 1);
        failure = result.failure;
      } else {
        start += chunk;
      }
    }
  }
  return { ops: current, failure };
}

export function describeFailure(documents: readonly FuzzDocument[], seed: number, ops: readonly FuzzOp[], failure: FuzzFailure): string {
  const request = { ...failure.request, source: `<${failure.request.source.length} chars>` };
  return [
    `compute differential mismatch (seed ${seed}, documents ${documents.map((document) => document.label).join(", ")})`,
    `at op ${failure.opIndex}: ${failure.what}`,
    `request: ${JSON.stringify(request)}`,
    "differences (cold, then warm):",
    ...failure.differences.map((difference) => `  ${difference}`),
    `ops (${ops.length}):`,
    JSON.stringify(ops)
  ].join("\n");
}
