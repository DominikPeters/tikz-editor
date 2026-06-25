import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "../../settings/useSettingsStore";
import { EDITOR_FONT_SIZE_MAX_PX, EDITOR_FONT_SIZE_MIN_PX } from "../../settings/types";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import {
  Compartment,
  Annotation,
  EditorSelection,
  EditorState as CMState,
  Prec,
  Transaction,
  StateEffect,
  StateField,
  type Range
} from "@codemirror/state";
import {
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  isolateHistory,
  indentLess,
  indentMore
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxTree,
  syntaxHighlighting
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  Decoration,
  type DecorationSet,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  rectangularSelection,
  tooltips,
  ViewPlugin,
  type ViewUpdate
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { PathItem, Span, Statement } from "tikz-editor/ast/types";
import { collectSymbols, type DocumentSymbols } from "tikz-editor/completion/index";
import { resolveDocHoverTarget } from "tikz-editor/completion/doc-hover";
import { recordProfilingSourcePanelSyncTiming } from "tikz-editor/profiling";
import type { SceneElement } from "tikz-editor/semantic/types";
import { NAMED_COLORS } from "tikz-editor/semantic/style/constants";
import { patchesMatchSourceTransition } from "tikz-editor/edit/source-patches";
import { tikz } from "@tikz-editor/lang-tikz";
import { tikzCompletion } from "./tikz-autocomplete";
import { lookupTikzDocEntry } from "./tikz-docs";
import { getActiveEditorPlatform } from "../../platform/current";
import { colorSwatches } from "./color-swatches";
import { numberScrubber } from "./number-scrubber";
import { useProjectNamedColorSwatches } from "../../colors/project-named-colors";
import { useEditorStore } from "../../store/store";
import { ColorPicker } from "../ColorPicker";
import {
  SOURCE_FORMAT_REQUEST_EVENT
} from "../source-sync";
import css from "./SourcePanel.module.css";
import { formatTikzSource } from "tikz-editor/edit/source-format";

// ── Dynamic configuration compartments ──────────────────────────────────────

const wordWrapCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
const editableCompartment = new Compartment();
const highlightCompartment = new Compartment();

// ── Theme-aware highlight styles ─────────────────────────────────────────────

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword,        color: "#569cd6", fontWeight: "bold" },
  { tag: t.typeName,       color: "#4ec9b0" },
  { tag: t.lineComment,    color: "#6a9955", fontStyle: "italic" },
  { tag: t.blockComment,   color: "#6a9955", fontStyle: "italic" },
  { tag: t.string,         color: "#ce9178" },
  { tag: t.special(t.string), color: "#dcdcaa" },
  { tag: t.regexp,         color: "#c586c0", fontWeight: "600" },
  { tag: t.number,         color: "#b5cea8" },
  { tag: t.variableName,   color: "#9cdcfe" },
  { tag: t.attributeName,  color: "#9cdcfe" },
  { tag: t.propertyName,   color: "#9cdcfe" },
  { tag: t.operator,       color: "#d4d4d4" },
  { tag: t.punctuation,    color: "#d4d4d4" },
  { tag: t.bracket,        color: "#ffd700" },
  { tag: t.name,           color: "#d4d4d4" },
]);

function buildHighlightExtension(dark: boolean) {
  return dark ? [Prec.highest(syntaxHighlighting(darkHighlightStyle))] : [];
}

// ── CodeMirror state effects ────────────────────────────────────────────────

const setHighlight = StateEffect.define<[number, number] | null>();
const setDiagnostics = StateEffect.define<DiagnosticInput[]>();
const setFigureOverlay = StateEffect.define<DecorationSet>();
const sourcePanelExternalSyncAnnotation = Annotation.define<{ nextSource: string; sourceRevision: number }>();

type PendingExternalSourceSync = {
  nextSource: string;
  sourceRevision: number;
  lastEditPatches: readonly SourceSyncPatch[] | null;
  lastEditPatchBaseRevision: number | null;
  patchChain: SourceSyncPatchStep[] | null;
  coalescedToAnimationFrame: boolean;
};

type SourceSyncPatchStep = {
  baseRevision: number;
  sourceRevision: number;
  patches: readonly SourceSyncPatch[];
};

type DiagnosticSeverity = "error" | "warning";

export type DiagnosticInput = {
  from: number;
  to: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source: "parse" | "semantic";
};

type Diagnostic = DiagnosticInput;
type SourceSyncPatch = {
  oldSpan: { from: number; to: number };
  newSpan: { from: number; to: number };
  replacement: string;
};

type SourceSyncChange = { from: number; to: number; insert: string };

type SourceSyncChanges = {
  changes: SourceSyncChange | SourceSyncChange[];
  trustedPatch: boolean;
};

type SourceSpan = {
  from: number;
  to: number;
};

type SourceSpanEntry = {
  sourceId: string;
  from: number;
  to: number;
  width: number;
};

type SourceSpanIndex = {
  bySourceId: ReadonlyMap<string, SourceSpan>;
  sortedByWidth: SourceSpanEntry[];
};

type ActiveColorPickerSession = {
  from: number;
  to: number;
  currentToken: string;
  anchorRect: DOMRectReadOnly;
  editable: boolean;
};

const EMPTY_SPAN_INDEX: SourceSpanIndex = {
  bySourceId: new Map(),
  sortedByWidth: []
};

const EMPTY_SYMBOLS: DocumentSymbols = {
  nodeNames: [],
  styleNames: [],
  coordinateNames: []
};

const MAX_DIAGNOSTICS = 300;
const MAX_DECORATED_SPAN = 160;
const MAX_RECOVERY_NOISE_DISTANCE = 80;
const DIAGNOSTIC_DEBOUNCE_MS = 120;
const DOCS_TOOLTIP_HOVER_TIME_MS = 650;
const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

const SOURCE_PICKER_COLORS = uniqueStrings(["none", ...NAMED_COLORS]);
const ENABLE_TIKZ_AUTOCOMPLETE = true;

type MathJaxBrowserRuntime = {
  typesetPromise?: (elements?: Element[]) => Promise<void>;
};

function stripTikzPrefixInSignatureHtml(signatureHtml: string): string {
  const template = document.createElement("template");
  template.innerHTML = signatureHtml;
  template.content.querySelectorAll("kbd, code").forEach((el) => {
    const text = el.textContent;
    if (!text) return;
    if (text.startsWith("/tikz/")) {
      el.textContent = text.slice("/tikz/".length);
    }
  });
  return template.innerHTML;
}

function includesInlineMath(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes("\\(");
}

function maybeTypesetTooltipMathJax(dom: HTMLElement): void {
  const runtime = (globalThis as { MathJax?: MathJaxBrowserRuntime }).MathJax;
  if (!runtime || typeof runtime.typesetPromise !== "function") {
    return;
  }
  queueMicrotask(() => {
    void runtime.typesetPromise?.([dom]).catch(() => {
      // Keep tooltip rendering resilient if MathJax fails on malformed inline input.
    });
  });
}

// ── State fields ─────────────────────────────────────────────────────────────

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setHighlight)) continue;
      if (!effect.value) return Decoration.none;
      const [from, to] = effect.value;
      return Decoration.set([Decoration.mark({ class: "cm-highlight-range" }).range(from, to)]);
    }
    if (tr.docChanged) {
      return value.map(tr.changes);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f)
});

const diagnosticsField = StateField.define<{ list: Diagnostic[]; decorations: DecorationSet }>({
  create: () => ({ list: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDiagnostics)) continue;
      const list = normalizeDiagnostics(effect.value, tr.state.doc.length);
      return { list, decorations: buildDecorations(list) };
    }
    if (tr.docChanged) return { list: [], decorations: Decoration.none };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations)
});

const figureOverlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFigureOverlay)) {
        return effect.value;
      }
    }
    if (tr.docChanged) {
      return value.map(tr.changes);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f)
});

function findExternalSourceSyncAnnotation(
  transactions: readonly Transaction[]
): { nextSource: string; sourceRevision: number } | null {
  for (const transaction of transactions) {
    const annotation = transaction.annotation(sourcePanelExternalSyncAnnotation);
    if (annotation) {
      return annotation;
    }
  }
  return null;
}

function buildExternalSourceSyncChanges(
  currentSource: string,
  nextSource: string,
  lastEditPatches: readonly SourceSyncPatch[] | null,
  canTrustPatches: boolean,
  trustedPatchChain: readonly SourceSyncPatchStep[] | null
): SourceSyncChanges {
  if (trustedPatchChain && trustedPatchChain.length > 0) {
    return {
      changes: trustedPatchChain.flatMap((step) => sourcePatchChanges(step.patches)),
      trustedPatch: true
    };
  }
  if (canTrustPatches && lastEditPatches && lastEditPatches.length > 0) {
    return {
      changes: sourcePatchChanges(lastEditPatches),
      trustedPatch: true
    };
  }
  if (
    lastEditPatches &&
    lastEditPatches.length > 0 &&
    patchesMatchSourceTransition(currentSource, nextSource, lastEditPatches)
  ) {
    return {
      changes: sourcePatchChanges(lastEditPatches),
      trustedPatch: false
    };
  }
  return {
    changes: { from: 0, to: currentSource.length, insert: nextSource },
    trustedPatch: false
  };
}

function sourcePatchChanges(patches: readonly SourceSyncPatch[]): SourceSyncChange[] {
  return patches.map((patch) => ({
    from: patch.oldSpan.from,
    to: patch.oldSpan.to,
    insert: patch.replacement
  }));
}

class ExternalSourceSyncManager {
  private lastKnownSource: string;
  private lastKnownRevision: number | null;

  constructor(private readonly view: EditorView) {
    this.lastKnownSource = view.state.doc.toString();
    this.lastKnownRevision = null;
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged) {
      return;
    }
    const annotation = findExternalSourceSyncAnnotation(update.transactions);
    if (annotation) {
      this.lastKnownSource = annotation.nextSource;
      this.lastKnownRevision = annotation.sourceRevision;
      return;
    }
    this.lastKnownSource = update.state.doc.toString();
    this.lastKnownRevision = null;
  }

  destroy(): void {
    // No-op. React owns scheduling and cleanup.
  }

  syncExternalSource(
    nextSource: string,
    sourceRevision: number,
    lastEditPatches: readonly SourceSyncPatch[] | null,
    lastEditPatchBaseRevision: number | null,
    patchChain: readonly SourceSyncPatchStep[] | null,
    coalescedToAnimationFrame: boolean
  ): void {
    if (sourceRevision === this.lastKnownRevision && nextSource === this.lastKnownSource) {
      return;
    }
    if (nextSource === this.lastKnownSource) {
      this.lastKnownRevision = sourceRevision;
      return;
    }
    if (
      this.lastKnownRevision == null &&
      lastEditPatchBaseRevision != null &&
      lastEditPatches != null &&
      lastEditPatches.length > 0
    ) {
      this.lastKnownRevision = lastEditPatchBaseRevision;
    }
    const canTrustPatches =
      lastEditPatches != null &&
      lastEditPatches.length > 0 &&
      lastEditPatchBaseRevision != null &&
      lastEditPatchBaseRevision === this.lastKnownRevision;
    const trustedPatchChain =
      patchChain &&
      patchChain.length > 0 &&
      patchChain[0]?.baseRevision === this.lastKnownRevision &&
      patchChain[patchChain.length - 1]?.sourceRevision === sourceRevision
        ? patchChain
        : null;
    if (trustedPatchChain) {
      const patchCount = trustedPatchChain.reduce((count, step) => count + step.patches.length, 0);
      const startedAt = performance.now();
      dispatchPatchChainWithStableHorizontalScroll(
        this.view,
        trustedPatchChain,
        nextSource,
        sourceRevision
      );
      recordProfilingSourcePanelSyncTiming({
        kind: "externalSyncDispatch",
        durationMs: performance.now() - startedAt,
        mode: "patch",
        trustedPatch: true,
        coalescedToAnimationFrame,
        patchCount,
        docLength: nextSource.length
      });
      this.lastKnownSource = nextSource;
      this.lastKnownRevision = sourceRevision;
      return;
    }
    const syncChanges = buildExternalSourceSyncChanges(
      this.lastKnownSource,
      nextSource,
      lastEditPatches,
      canTrustPatches,
      null
    );
    const patchCount = Array.isArray(syncChanges.changes) ? syncChanges.changes.length : 1;
    const mode = Array.isArray(syncChanges.changes) ? "patch" : "replace";
    const startedAt = performance.now();
    dispatchSelectionWithStableHorizontalScroll(this.view, {
      changes: syncChanges.changes,
      annotations: [
        Transaction.addToHistory.of(false),
        isolateHistory.of("before"),
        isolateHistory.of("after"),
        sourcePanelExternalSyncAnnotation.of({ nextSource, sourceRevision })
      ]
    });
    recordProfilingSourcePanelSyncTiming({
      kind: "externalSyncDispatch",
      durationMs: performance.now() - startedAt,
      mode,
      trustedPatch: Array.isArray(syncChanges.changes) && syncChanges.trustedPatch,
      coalescedToAnimationFrame,
      patchCount,
      docLength: nextSource.length
    });
    this.lastKnownSource = nextSource;
    this.lastKnownRevision = sourceRevision;
  }
}

const externalSourceSyncPlugin = ViewPlugin.fromClass(ExternalSourceSyncManager);

function useExternalSourceSync(
  viewRef: RefObject<EditorView | null>,
  source: string,
  sourceRevision: number,
  lastEditPatches: readonly SourceSyncPatch[] | null,
  lastEditPatchBaseRevision: number | null,
  coalesceToAnimationFrame: boolean,
  throttleMs = 0
) {
  const rafIdRef = useRef<number | null>(null);
  const throttleIdRef = useRef<number | null>(null);
  const pendingSyncRef = useRef<PendingExternalSourceSync | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (throttleIdRef.current != null) {
        window.clearTimeout(throttleIdRef.current);
        throttleIdRef.current = null;
      }
      pendingSyncRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const plugin = view.plugin(externalSourceSyncPlugin);
    if (!plugin) {
      return;
    }

    if (!coalesceToAnimationFrame) {
      if (rafIdRef.current != null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (throttleIdRef.current != null) {
        window.clearTimeout(throttleIdRef.current);
        throttleIdRef.current = null;
      }
      pendingSyncRef.current = null;
      plugin.syncExternalSource(source, sourceRevision, lastEditPatches, lastEditPatchBaseRevision, null, false);
      return;
    }

    const patchStep =
      lastEditPatchBaseRevision != null && lastEditPatches && lastEditPatches.length > 0
        ? {
            baseRevision: lastEditPatchBaseRevision,
            sourceRevision,
            patches: lastEditPatches
          }
        : null;
    const previousPending = pendingSyncRef.current;
    const patchChain =
      patchStep && previousPending?.patchChain && previousPending.sourceRevision === patchStep.baseRevision
        ? [...previousPending.patchChain, patchStep]
        : patchStep
          ? [patchStep]
          : null;
    pendingSyncRef.current = {
      nextSource: source,
      sourceRevision,
      lastEditPatches,
      lastEditPatchBaseRevision,
      patchChain,
      coalescedToAnimationFrame: true
    };
    const flushPendingSync = () => {
      rafIdRef.current = null;
      throttleIdRef.current = null;
      const pending = pendingSyncRef.current;
      pendingSyncRef.current = null;
      if (!pending) {
        return;
      }
      plugin.syncExternalSource(
        pending.nextSource,
        pending.sourceRevision,
        pending.lastEditPatches,
        pending.lastEditPatchBaseRevision,
        pending.patchChain,
        pending.coalescedToAnimationFrame
      );
    };
    if (throttleMs > 0) {
      if (throttleIdRef.current != null) {
        return;
      }
      throttleIdRef.current = window.setTimeout(flushPendingSync, throttleMs);
      return;
    }
    if (rafIdRef.current != null) {
      return;
    }
    rafIdRef.current = window.requestAnimationFrame(flushPendingSync);
  }, [coalesceToAnimationFrame, lastEditPatchBaseRevision, lastEditPatches, source, sourceRevision, throttleMs, viewRef]);
}

const diagnosticTooltip = hoverTooltip((view, pos) => {
  const field = view.state.field(diagnosticsField, false);
  if (!field) return null;
  const d = bestDiagnosticAt(field.list, pos);
  if (!d) return null;
  return {
    pos: d.from,
    end: d.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = `cm-editor-diagnostic-tooltip cm-editor-diagnostic-tooltip-${d.severity}`;

      const header = document.createElement("div");
      header.className = "cm-editor-diagnostic-tooltip-header";
      const code = document.createElement("code");
      code.textContent = d.code ?? d.severity;
      const src = document.createElement("span");
      src.textContent = d.source.toUpperCase();
      header.append(code, src);

      const msg = document.createElement("div");
      msg.className = "cm-editor-diagnostic-tooltip-message";
      msg.textContent = d.message;

      dom.append(header, msg);
      return { dom };
    }
  };
});

export function prioritizeDiagnosticsForDisplay(diagnostics: readonly DiagnosticInput[]): DiagnosticInput[] {
  const result: DiagnosticInput[] = [];
  for (const diagnostic of diagnostics) {
    if (isRecoveryNoiseDiagnostic(diagnostic, diagnostics)) {
      continue;
    }
    if (result.some((accepted) => isNearbyDuplicateDiagnostic(accepted, diagnostic))) {
      continue;
    }
    result.push(diagnostic);
  }
  return result;
}

function isRecoveryNoiseDiagnostic(
  diagnostic: DiagnosticInput,
  diagnostics: readonly DiagnosticInput[]
): boolean {
  if (diagnostic.code === "stray-token") {
    return diagnostics.some((candidate) =>
      candidate.source === diagnostic.source &&
      candidate.code === "parse-error" &&
      diagnostic.from >= candidate.from &&
      diagnostic.from - candidate.from <= MAX_RECOVERY_NOISE_DISTANCE
    );
  }

  if (diagnostic.code === "missing-semicolon") {
    return diagnostics.some((candidate) =>
      candidate.source === diagnostic.source &&
      candidate.code === "parse-error" &&
      (
        Math.abs(diagnostic.to - candidate.from) <= 1 ||
        (diagnostic.from >= candidate.from && diagnostic.from <= candidate.to)
      )
    );
  }

  return false;
}

function isNearbyDuplicateDiagnostic(left: DiagnosticInput, right: DiagnosticInput): boolean {
  return (
    left.source === right.source &&
    left.message === right.message &&
    Math.abs(left.from - right.from) <= MAX_RECOVERY_NOISE_DISTANCE
  );
}

const docsTooltip = hoverTooltip(async (view, pos, side) => {
  const diagnostics = view.state.field(diagnosticsField, false);
  if (diagnostics && bestDiagnosticAt(diagnostics.list, pos)) {
    return null;
  }

  const source = view.state.doc.toString();
  const tree = syntaxTree(view.state);
  const probePos = side < 0 ? Math.max(0, pos - 1) : pos;
  const target = resolveDocHoverTarget({
    source,
    tree,
    pos: probePos
  });
  if (!target) {
    return null;
  }

  const entry = await lookupTikzDocEntry(target.candidates);
  if (!entry) {
    return null;
  }

  return {
    pos: target.from,
    end: target.to,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-editor-docs-tooltip";

      if (entry.signatureHtml || entry.defaultHtml) {
        const meta = document.createElement("div");
        meta.className = "cm-editor-docs-tooltip-meta";

        if (entry.signatureHtml) {
          const signature = document.createElement("div");
          signature.className = "cm-editor-docs-tooltip-signature";
          signature.innerHTML = stripTikzPrefixInSignatureHtml(entry.signatureHtml);
          meta.appendChild(signature);
        }

        if (entry.defaultHtml) {
          const defaultValue = document.createElement("div");
          defaultValue.className = "cm-editor-docs-tooltip-default";
          defaultValue.innerHTML = entry.defaultHtml;
          meta.appendChild(defaultValue);
        }

        dom.appendChild(meta);
      }

      if (entry.snippetHtml) {
        const snippet = document.createElement("div");
        snippet.className = "cm-editor-docs-tooltip-snippet";
        snippet.innerHTML = entry.snippetHtml;
        dom.appendChild(snippet);
      }

      const linkRow = document.createElement("div");
      linkRow.className = "cm-editor-docs-tooltip-link-row";
      const link = document.createElement("a");
      link.className = "cm-editor-docs-tooltip-link";
      link.href = entry.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open docs";
      link.addEventListener("click", (event) => {
        const openExternalUrl = getActiveEditorPlatform().window?.openExternalUrl;
        if (typeof openExternalUrl !== "function") {
          return;
        }
        event.preventDefault();
        void openExternalUrl(entry.href);
      });
      linkRow.appendChild(link);
      dom.appendChild(linkRow);

      const shouldTypesetMath =
        includesInlineMath(entry.signatureHtml) ||
        includesInlineMath(entry.defaultHtml) ||
        includesInlineMath(entry.snippetHtml);
      if (shouldTypesetMath) {
        maybeTypesetTooltipMathJax(dom);
      }

      return { dom };
    }
  };
}, {
  hoverTime: DOCS_TOOLTIP_HOVER_TIME_MS
});

const editorKeymap = Prec.highest(
  keymap.of([
    { key: "Mod-d", run: deleteLine, preventDefault: true },
    { key: "Mod-[", run: indentLess, preventDefault: true },
    { key: "Mod-]", run: indentMore, preventDefault: true },
    { key: "Mod-+", run: increaseEditorFontSize, preventDefault: true },
    { key: "Mod-=", run: increaseEditorFontSize, preventDefault: true },
    { key: "Mod--", run: decreaseEditorFontSize, preventDefault: true },
    { key: "Tab", run: insertSoftIndent, preventDefault: true },
    { key: "Shift-Tab", run: indentLess, preventDefault: true }
  ])
);

// ── Component ─────────────────────────────────────────────────────────────────

export function SourcePanel() {
  const {
    source,
    sourceRevision,
    lastEditPatches,
    lastEditPatchBaseRevision,
    activeFigureId,
    snapshot,
    activeCanvasDragKind,
    activeCanvasTextEditSourceId,
    selectedElementIds,
    hoveredElementId,
    assistantLockReason,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    source: s.source,
    sourceRevision: s.sourceRevision,
    lastEditPatches: s.lastEditPatches,
    lastEditPatchBaseRevision: s.lastEditPatchBaseRevision,
    activeFigureId: s.activeFigureId,
    snapshot: s.snapshot,
    activeCanvasDragKind: s.activeCanvasDragKind,
    activeCanvasTextEditSourceId: s.activeCanvasTextEditSourceId,
    selectedElementIds: s.selectedElementIds,
    hoveredElementId: s.hoveredElementId,
    assistantLockReason: s.documents[s.activeDocumentId]?.assistantLockReason ?? null,
    dispatch: s.dispatch
  })));
  const figures = snapshot.figures;
  const {
    editorWordWrap,
    editorFontSize,
    editorLineNumbers,
    editorIndentSize,
    formatterReflowLongOptions,
    formatterMaxLineLength
  } = useSettingsStore(useShallow((s) => ({
    editorWordWrap: s.settings.editor.wordWrap,
    editorFontSize: s.settings.editor.fontSize,
    editorLineNumbers: s.settings.editor.lineNumbers,
    editorIndentSize: s.settings.editor.indentSize,
    formatterReflowLongOptions: s.settings.editor.formatterReflowLongOptions,
    formatterMaxLineLength: s.settings.editor.formatterMaxLineLength
  })));
  const [darkMode, setDarkMode] = useState(() => document.documentElement.dataset.colorScheme === "dark");

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextSelectionSyncRef = useRef(false);
  const suppressStoreSelectionSyncRef = useRef(false);
  const suppressElementScrollOnFigureSwitchRef = useRef(false);
  const colorPickerApplyingRef = useRef(false);
  const diagnosticTimerRef = useRef<number | null>(null);
  const spanIndexRef = useRef<SourceSpanIndex>(EMPTY_SPAN_INDEX);
  const symbolsRef = useRef<DocumentSymbols>(EMPTY_SYMBOLS);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const figuresRef = useRef(figures);
  const activeFigureIdRef = useRef(activeFigureId);
  const [activeColorPicker, setActiveColorPicker] = useState<ActiveColorPickerSession | null>(null);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
  const figureOverlaySignature = useMemo(
    () =>
      figures.length < 2
        ? `${activeFigureId ?? ""}:single:${source.length}`
        : `${activeFigureId ?? ""}:${source.length}:${figures.map((figure) => `${figure.id}:${figure.span.from}:${figure.span.to}`).join("|")}`,
    [activeFigureId, figures, source.length]
  );

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);

  useEffect(() => {
    figuresRef.current = figures;
    activeFigureIdRef.current = activeFigureId;
  }, [activeFigureId, figures]);

  useEffect(() => {
    spanIndexRef.current = buildSourceSpanIndex(snapshot.scene?.elements ?? [], snapshot.parseResult?.figure.body);
    symbolsRef.current = collectSymbols({ parseResult: snapshot.parseResult });
  }, [snapshot.scene, snapshot.parseResult]);

  // ── Initialize CodeMirror ───────────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      const externalSourceSync = findExternalSourceSyncAnnotation(update.transactions);
      if (update.docChanged) {
        const appliedByColorPicker = colorPickerApplyingRef.current;
        colorPickerApplyingRef.current = false;

        setActiveColorPicker((current) => {
          if (!current) {
            return null;
          }

          if (!appliedByColorPicker) {
            return null;
          }

          const mappedFrom = update.changes.mapPos(current.from, 1);
          const mappedTo = update.changes.mapPos(current.to, -1);
          if (mappedTo <= mappedFrom || mappedFrom < 0 || mappedTo > update.state.doc.length) {
            return null;
          }

          const nextToken = update.state.doc.sliceString(mappedFrom, mappedTo).trim();
          if (nextToken.length === 0) {
            return null;
          }

          return {
            ...current,
            from: mappedFrom,
            to: mappedTo,
            currentToken: nextToken
          };
        });

        if (!externalSourceSync) {
          const nextSource = update.state.doc.toString();
          dispatch({ type: "CODE_EDITED", source: nextSource });
        }
      }

      if (!update.selectionSet) {
        return;
      }

      if (ignoreNextSelectionSyncRef.current) {
        ignoreNextSelectionSyncRef.current = false;
        return;
      }

      if (externalSourceSync) {
        return;
      }

      // Drive active-figure switching from CodeMirror selection updates so
      // keyboard navigation and all cursor moves behave consistently.
      if (update.view.hasFocus) {
        const head = clamp(update.state.selection.main.head, 0, update.state.doc.length);
        const targetFigure = figuresRef.current.find((figure) => head >= figure.span.from && head <= figure.span.to) ?? null;
        if (targetFigure && targetFigure.id !== activeFigureIdRef.current) {
          dispatch({ type: "SET_ACTIVE_FIGURE", figureId: targetFigure.id });
        }
      }

      syncSelectionFromSourceCursor(
        update.state,
        spanIndexRef.current,
        selectedElementIdsRef.current,
        () => {
          suppressStoreSelectionSyncRef.current = true;
        },
        dispatch
      );
    });

    const sourceHoverBridge = EditorView.domEventHandlers({
      mousemove(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const sourceId = findSourceIdAtPosition(pos, view.state.doc.length, spanIndexRef.current);
        dispatch({ type: "SET_HOVERED_ELEMENT", id: sourceId });
        return false;
      },
      mouseleave() {
        dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
        return false;
      }
    });

    const completionExtension = ENABLE_TIKZ_AUTOCOMPLETE
      ? autocompletion({
          override: [
            (context) => tikzCompletion(context, symbolsRef.current)
          ]
        })
      : autocompletion();

    const state = CMState.create({
      doc: source,
      extensions: [
        // basicSetup equivalent, minus autocompletion() (we add our own above)
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        CMState.lineSeparator.of("\n"),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        CMState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        completionExtension,
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
        ]),
        editorKeymap,
        tikz(),
        wordWrapCompartment.of(editorWordWrap ? EditorView.lineWrapping : []),
        fontSizeCompartment.of(EditorView.theme({ "& .cm-scroller": { fontSize: `${editorFontSize}px` } })),
        tabSizeCompartment.of(CMState.tabSize.of(editorIndentSize)),
        editableCompartment.of(EditorView.editable.of(!assistantLockReason)),
        highlightCompartment.of(buildHighlightExtension(darkMode)),
        numberScrubber({
          onScrubStateChange: (scrub) => {
            if (!scrub.isActive || scrub.from == null) {
              dispatch({ type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: null });
              return;
            }
            const sourceId = findSourceIdAtPosition(scrub.from, view.state.doc.length, spanIndexRef.current);
            dispatch({
              type: "SET_ACTIVE_SOURCE_SCRUB",
              sourceId
            });
          }
        }),
        colorSwatches({
          onPickRequest: ({ occurrence, anchorRect }) => {
            if (!occurrence.editable) {
              return;
            }
            setActiveColorPicker({
              from: occurrence.from,
              to: occurrence.to,
              currentToken: occurrence.token,
              anchorRect,
              editable: occurrence.editable
            });
          }
        }),
        highlightField,
        diagnosticsField,
        figureOverlayField,
        tooltips({ parent: document.body }),
        diagnosticTooltip,
        docsTooltip,
        sourceHoverBridge,
        externalSourceSyncPlugin,
        updateListener
      ]
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      dispatch({ type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: null });
      if (diagnosticTimerRef.current != null) {
        clearTimeout(diagnosticTimerRef.current);
        diagnosticTimerRef.current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once; source synced via separate effect below

  // ── Reactively apply editor settings ────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wordWrapCompartment.reconfigure(editorWordWrap ? EditorView.lineWrapping : []) });
  }, [editorWordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: fontSizeCompartment.reconfigure(EditorView.theme({ "& .cm-scroller": { fontSize: `${editorFontSize}px` } })) });
  }, [editorFontSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: tabSizeCompartment.reconfigure(CMState.tabSize.of(editorIndentSize)) });
  }, [editorIndentSize]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!assistantLockReason)) });
  }, [assistantLockReason]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(document.documentElement.dataset.colorScheme === "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] });
    return () => { observer.disconnect(); };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: highlightCompartment.reconfigure(buildHighlightExtension(darkMode)) });
  }, [darkMode]);


  // ── Canvas selection → source selection sync ────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Preserve active typing/caret behavior: when the source editor has focus,
    // store selection changes should update canvas state but must not replace
    // the user's current text selection/cursor in CodeMirror.
    if (view.hasFocus) {
      return;
    }

    if (suppressStoreSelectionSyncRef.current) {
      suppressStoreSelectionSyncRef.current = false;
      return;
    }

    // After a figure switch, suppress the scroll that would come from
    // selectedElementIds changing (the figure-scroll effect already positioned
    // the viewport at the figure header).
    const suppressScroll = suppressElementScrollOnFigureSwitchRef.current;
    if (suppressScroll) {
      suppressElementScrollOnFigureSwitchRef.current = false;
    }

    const selection = combineSelectedSourceSpan(selectedElementIds, spanIndexRef.current.bySourceId);
    if (!selection) {
      const currentSelection = view.state.selection.main;
      if (currentSelection.empty) {
        return;
      }
      const normalizedSelection = normalizeSelectionAnchorHead(
        currentSelection.head,
        currentSelection.head,
        view.state.doc.length
      );
      ignoreNextSelectionSyncRef.current = true;
      dispatchSelectionWithStableHorizontalScroll(view, {
        selection: normalizedSelection,
        annotations: [Transaction.addToHistory.of(false)],
        scrollIntoView: false
      });
      return;
    }

    const normalized = normalizeRange(selection.from, selection.to, view.state.doc.length);
    const currentSelection = view.state.selection.main;
    if (currentSelection.from === normalized.from && currentSelection.to === normalized.to) {
      return;
    }

    const autoRevealSelection = suppressScroll ? false : shouldAutoRevealSourceSelection();
    ignoreNextSelectionSyncRef.current = true;
    dispatchSelectionWithStableHorizontalScroll(view, {
      selection: { anchor: normalized.from, head: normalized.to },
      annotations: [Transaction.addToHistory.of(false)],
      scrollIntoView: autoRevealSelection
    });
  }, [selectedElementIds]);

  // ── Sync store source → CodeMirror (for WYSIWYG changes) ───────────────────
  useExternalSourceSync(
    viewRef,
    source,
    sourceRevision,
    lastEditPatches,
    lastEditPatchBaseRevision,
    activeCanvasDragKind != null || lastEditPatches != null,
    activeCanvasDragKind != null || activeCanvasTextEditSourceId != null ? 80 : 0
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const decorations = buildFigureOverlayDecorations({
      docLength: view.state.doc.length,
      figures,
      activeFigureId
    });
    view.dispatch({ effects: setFigureOverlay.of(decorations) });
  }, [activeFigureId, figureOverlaySignature, figures]);

  const prevActiveFigureIdRef = useRef(activeFigureId);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const activeFigure = figures.find((figure) => figure.id === activeFigureId);
    if (!activeFigure) {
      return;
    }
    // Only scroll to figure top when the active figure actually changes,
    // not on every reparse (which updates the `figures` array reference).
    const figureChanged = prevActiveFigureIdRef.current !== activeFigureId;
    prevActiveFigureIdRef.current = activeFigureId;
    if (!figureChanged) {
      return;
    }
    // If the user changed figures by placing their caret in the source
    // editor, they are already looking at the right spot — don't scroll.
    if (view.hasFocus) {
      return;
    }
    const anchor = clamp(activeFigure.span.from, 0, view.state.doc.length);
    suppressElementScrollOnFigureSwitchRef.current = true;
    const selection = view.state.selection.main;
    if (selection.anchor !== anchor || selection.head !== anchor) {
      ignoreNextSelectionSyncRef.current = true;
      dispatchSelectionWithStableHorizontalScroll(view, {
        selection: { anchor, head: anchor },
        annotations: [Transaction.addToHistory.of(false)],
        effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 8 })
      });
      return;
    }
    view.dispatch({
      effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 8 })
    });
  }, [activeFigureId, figures]);

  useEffect(() => {
    if (!activeColorPicker) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (colorPickerRef.current?.contains(target)) {
        return;
      }
      setActiveColorPicker(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActiveColorPicker(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeColorPicker]);

  // ── Canvas hover → source highlight sync ────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const hoverSpan = hoveredElementId
      ? spanIndexRef.current.bySourceId.get(hoveredElementId) ?? null
      : null;

    if (!hoverSpan) {
      view.dispatch({ effects: setHighlight.of(null) });
      return;
    }

    const normalized = normalizeRange(hoverSpan.from, hoverSpan.to, view.state.doc.length);
    view.dispatch({ effects: setHighlight.of([normalized.from, normalized.to]) });
  }, [hoveredElementId, snapshot.scene]);

  // ── Update diagnostic decorations when snapshot changes ────────────────────
  useEffect(() => {
    if (diagnosticTimerRef.current != null) {
      clearTimeout(diagnosticTimerRef.current);
    }

    diagnosticTimerRef.current = window.setTimeout(() => {
      diagnosticTimerRef.current = null;
      const view = viewRef.current;
      if (!view) return;

      const docSource = view.state.doc.toString();
      const parse = snapshot.parseResult;
      const semantic = snapshot.semanticResult;

      if (parse?.source !== docSource) {
        view.dispatch({ effects: setDiagnostics.of([]) });
        return;
      }

      const list = prioritizeDiagnosticsForDisplay([
        ...parse.diagnostics.map((d) => ({ ...d, from: d.span.from, to: d.span.to, source: "parse" as const })),
        ...(semantic?.diagnostics ?? []).map((d) => ({
          ...d,
          from: d.span.from,
          to: d.span.to,
          source: "semantic" as const
        }))
      ]);
      view.dispatch({ effects: setDiagnostics.of(list) });
    }, DIAGNOSTIC_DEBOUNCE_MS);

    return () => {
      if (diagnosticTimerRef.current != null) {
        clearTimeout(diagnosticTimerRef.current);
        diagnosticTimerRef.current = null;
      }
    };
  }, [snapshot]);

  useEffect(() => {
    const handleFormatRequest = (): void => {
      const view = viewRef.current;
      if (!view) {
        return;
      }

      const currentSource = view.state.doc.toString();
      const formattedSource = formatTikzSource(currentSource, {
        indentUnit: " ".repeat(editorIndentSize),
        reflowLongOptionLists: formatterReflowLongOptions,
        maxLineLength: clampFormatterMaxLineLength(formatterMaxLineLength)
      });
      if (formattedSource === currentSource) {
        return;
      }

      const selection = view.state.selection.main;
      const nextAnchor = clamp(selection.anchor, 0, formattedSource.length);
      const nextHead = clamp(selection.head, 0, formattedSource.length);

      dispatchSelectionWithStableHorizontalScroll(view, {
        changes: { from: 0, to: currentSource.length, insert: formattedSource },
        selection: { anchor: nextAnchor, head: nextHead },
        userEvent: "input.format"
      });
    };

    window.addEventListener(SOURCE_FORMAT_REQUEST_EVENT, handleFormatRequest);
    return () => { window.removeEventListener(SOURCE_FORMAT_REQUEST_EVENT, handleFormatRequest); };
  }, [editorIndentSize, formatterMaxLineLength, formatterReflowLongOptions]);

  const handleInlineColorChange = (nextToken: string): void => {
    const session = activeColorPicker;
    const view = viewRef.current;
    if (!session || !view || !session.editable) {
      return;
    }

    colorPickerApplyingRef.current = true;
    dispatchSelectionWithStableHorizontalScroll(view, {
      changes: { from: session.from, to: session.to, insert: nextToken },
      selection: { anchor: session.from + nextToken.length },
      scrollIntoView: true,
      userEvent: "input"
    });

    setActiveColorPicker({
      ...session,
      to: session.from + nextToken.length,
      currentToken: nextToken
    });
  };

  const inlineColorPopoverStyle = activeColorPicker
    ? computeInlineColorPopoverStyle(activeColorPicker.anchorRect)
    : null;

  const diagnostics = useMemo(() => {
    const parse = snapshot.parseResult;
    const semantic = snapshot.semanticResult;
    const result: DiagnosticInput[] = [];
    if (parse) {
      for (const d of parse.diagnostics) {
        result.push({ ...d, from: d.span.from, to: d.span.to, source: "parse" });
      }
    }
    if (semantic) {
      for (const d of semantic.diagnostics) {
        result.push({ ...d, from: d.span.from, to: d.span.to, source: "semantic" });
      }
    }
    return prioritizeDiagnosticsForDisplay(result);
  }, [snapshot.parseResult, snapshot.semanticResult]);

  return (
    <div className={css.panel}>

      <div className={[css.editorWrap, editorLineNumbers ? "" : css.hideLineNumbers].filter(Boolean).join(" ")} ref={editorRef} />

      {diagnostics.length > 0 && (
        <div className={css.diagnostics}>
          {diagnostics.slice(0, 5).map((d, i) => {
            const line = snapshot.parseResult
              ? snapshot.parseResult.source.slice(0, d.from).split("\n").length
              : null;
            return (
              <div
                key={i}
                className={`${css.diagnostic} ${d.severity === "error" ? css.error : css.warning}`}
                onClick={(e) => {
                  // Don't navigate if user is selecting text within this row
                  const selection = window.getSelection();
                  if (
                    selection?.toString().trim() &&
                    e.currentTarget.contains(selection.anchorNode)
                  ) {
                    return;
                  }
                  const view = viewRef.current;
                  if (!view) return;
                  const pos = Math.min(d.from, view.state.doc.length);
                  dispatchSelectionWithStableHorizontalScroll(view, {
                    selection: { anchor: pos },
                    scrollIntoView: true,
                    annotations: [Transaction.addToHistory.of(false)]
                  });
                  view.focus();
                }}
              >
                <span className={css.diagnosticIcon}>{d.severity === "error" ? "\u2298" : "\u26A0"}</span>
                <span className={css.diagnosticMessage} data-select="text">{d.message}</span>
                {line != null && <span className={css.diagnosticLocation}>Ln {line}</span>}
              </div>
            );
          })}
          {diagnostics.length > 5 && (
            <div className={`${css.diagnostic} ${css.diagnosticMore}`}>
              <span className={css.diagnosticIcon} />
              <span className={css.diagnosticMessage} data-select="text">…{diagnostics.length - 5} more</span>
            </div>
          )}
        </div>
      )}

      {assistantLockReason ? <div className={css.lockBanner} data-select="text">{assistantLockReason}</div> : null}
      {activeColorPicker && inlineColorPopoverStyle ? (
        <div className={css.inlineColorPickerPopover} ref={colorPickerRef} style={inlineColorPopoverStyle}>
          <ColorPicker
            ariaLabel="Source color"
            options={SOURCE_PICKER_COLORS}
            namedColorSwatches={projectNamedColorSwatches}
            value={activeColorPicker.currentToken}
            syntaxValue={activeColorPicker.currentToken}
            disabled={!activeColorPicker.editable}
            onChange={handleInlineColorChange}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type FigureOverlayFigure = {
  id: string;
  span: { from: number; to: number };
};

function buildFigureOverlayDecorations(params: {
  docLength: number;
  figures: readonly FigureOverlayFigure[];
  activeFigureId: string | null;
}): DecorationSet {
  const { docLength, figures, activeFigureId } = params;
  if (figures.length < 2) {
    return Decoration.none;
  }
  const normalizedFigures = figures
    .map((figure) => {
      const spanFrom = clamp(figure.span.from, 0, docLength);
      const spanTo = clamp(figure.span.to, spanFrom, docLength);
      if (spanTo <= spanFrom) {
        return null;
      }
      return {
        ...figure,
        span: { from: spanFrom, to: spanTo }
      };
    })
    .filter((figure): figure is FigureOverlayFigure => figure != null);
  if (normalizedFigures.length < 2) {
    return Decoration.none;
  }
  const decorations: Range<Decoration>[] = [];
  const activeFigure = activeFigureId ? normalizedFigures.find((figure) => figure.id === activeFigureId) : null;
  if (activeFigure) {
    if (activeFigure.span.from > 0) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(0, activeFigure.span.from));
    }
    if (activeFigure.span.to < docLength) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(activeFigure.span.to, docLength));
    }
  } else {
    const sorted = [...normalizedFigures].sort((left, right) => left.span.from - right.span.from);
    let cursor = 0;
    for (const figure of sorted) {
      if (figure.span.from > cursor) {
        decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(cursor, figure.span.from));
      }
      cursor = Math.max(cursor, figure.span.to);
    }
    if (cursor < docLength) {
      decorations.push(Decoration.mark({ class: "cm-figure-dimmed" }).range(cursor, docLength));
    }
  }

  return Decoration.set(decorations, false);
}

function insertSoftIndent(view: EditorView): boolean {
  const indentSize = Math.max(1, view.state.facet(CMState.tabSize));
  const indentUnit = " ".repeat(indentSize);
  const transactionSpec = view.state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: indentUnit },
    range: EditorSelection.cursor(range.from + indentUnit.length)
  }));
  view.dispatch(
    view.state.update(transactionSpec, {
      scrollIntoView: true,
      userEvent: "input"
    })
  );
  return true;
}

function increaseEditorFontSize(): boolean {
  return adjustEditorFontSize(1);
}

function decreaseEditorFontSize(): boolean {
  return adjustEditorFontSize(-1);
}

function adjustEditorFontSize(delta: number): boolean {
  const { settings, updateEditorSettings } = useSettingsStore.getState();
  const nextFontSize = clampEditorFontSize(settings.editor.fontSize + delta);
  if (nextFontSize !== settings.editor.fontSize) {
    updateEditorSettings({ fontSize: nextFontSize });
  }
  return true;
}

function clampEditorFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return EDITOR_FONT_SIZE_MIN_PX;
  }
  const rounded = Math.round(value);
  return Math.max(EDITOR_FONT_SIZE_MIN_PX, Math.min(EDITOR_FONT_SIZE_MAX_PX, rounded));
}

function clampFormatterMaxLineLength(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_FORMATTER_MAX_LINE_LENGTH, Math.min(MAX_FORMATTER_MAX_LINE_LENGTH, rounded));
}


function buildSourceSpanIndex(elements: readonly SceneElement[], statements: readonly Statement[] | undefined): SourceSpanIndex {
  if (elements.length === 0 && (!statements || statements.length === 0)) {
    return EMPTY_SPAN_INDEX;
  }

  const sourceIds = new Set<string>();
  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId.trim();
    if (!sourceId) {
      continue;
    }
    sourceIds.add(sourceId);
  }

  const sceneSpansBySourceId = new Map<string, SourceSpan>();
  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId.trim();
    const sourceSpan = element.sourceRef.sourceSpan;
    if (!sourceId || !sourceSpan || sourceSpan.to <= sourceSpan.from) {
      continue;
    }
    const existing = sceneSpansBySourceId.get(sourceId);
    if (!existing) {
      sceneSpansBySourceId.set(sourceId, { from: sourceSpan.from, to: sourceSpan.to });
      continue;
    }
    sceneSpansBySourceId.set(sourceId, {
      from: Math.min(existing.from, sourceSpan.from),
      to: Math.max(existing.to, sourceSpan.to)
    });
  }

  const parseSpansById = collectParseSpansById(statements ?? []);
  const treeChildSpansBySourceId = collectTreeChildSpansBySourceId(elements);
  const adornmentSpansByTargetId = collectAdornmentSpansByTargetId(elements);
  const bySourceId = new Map<string, SourceSpan>();
  for (const sourceId of sourceIds) {
    const treeChildSpan = treeChildSpansBySourceId.get(sourceId);
    const parseSpan = parseSpansById.get(sourceId);
    const sceneSpan = sceneSpansBySourceId.get(sourceId);
    const chosen = treeChildSpan ?? parseSpan ?? sceneSpan;
    if (!chosen) {
      continue;
    }
    bySourceId.set(sourceId, chosen);
  }
  for (const [targetId, span] of adornmentSpansByTargetId) {
    bySourceId.set(targetId, span);
  }

  const sortedByWidth = [...bySourceId.entries()]
    .map(([sourceId, span]) => ({
      sourceId,
      from: span.from,
      to: span.to,
      width: Math.max(0, span.to - span.from)
    }))
    .sort((a, b) => {
      if (a.width !== b.width) return a.width - b.width;
      if (a.from !== b.from) return a.from - b.from;
      return a.sourceId.localeCompare(b.sourceId);
    });

  return { bySourceId, sortedByWidth };
}

function collectAdornmentSpansByTargetId(elements: readonly SceneElement[]): Map<string, SourceSpan> {
  const spans = new Map<string, SourceSpan>();
  for (const element of elements) {
    const adornment = element.adornment;
    if (!adornment || adornment.textSpan.to <= adornment.textSpan.from) {
      continue;
    }
    const existing = spans.get(adornment.targetId);
    if (!existing) {
      spans.set(adornment.targetId, {
        from: adornment.textSpan.from,
        to: adornment.textSpan.to
      });
      continue;
    }
    spans.set(adornment.targetId, {
      from: Math.min(existing.from, adornment.textSpan.from),
      to: Math.max(existing.to, adornment.textSpan.to)
    });
  }
  return spans;
}

function collectTreeChildSpansBySourceId(elements: readonly SceneElement[]): Map<string, SourceSpan> {
  const spans = new Map<string, SourceSpan>();
  for (const element of elements) {
    const treeChild = element.treeChild;
    if (!treeChild) {
      continue;
    }
    const sourceId = treeChild.childSourceId?.trim() ?? "";
    if (!sourceId) {
      continue;
    }
    const span = treeChild.bodySpan ?? treeChild.childOperationSpan;
    if (!span || span.to <= span.from) {
      continue;
    }
    const existing = spans.get(sourceId);
    if (!existing) {
      spans.set(sourceId, { from: span.from, to: span.to });
      continue;
    }
    spans.set(sourceId, {
      from: Math.min(existing.from, span.from),
      to: Math.max(existing.to, span.to)
    });
  }
  return spans;
}

function collectParseSpansById(statements: readonly Statement[]): Map<string, SourceSpan> {
  const spans = new Map<string, SourceSpan>();

  const addSpan = (id: string, span: Span | undefined) => {
    if (!span || span.to <= span.from) {
      return;
    }
    const existing = spans.get(id);
    if (!existing) {
      spans.set(id, { from: span.from, to: span.to });
      return;
    }
    spans.set(id, {
      from: Math.min(existing.from, span.from),
      to: Math.max(existing.to, span.to)
    });
  };

  const collectItems = (items: readonly PathItem[]) => {
    for (const item of items) {
      addSpan(item.id, item.span);
      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
        for (const node of item.nodes) {
          addSpan(node.id, node.span);
        }
      }
    }
  };

  const collectStatements = (items: readonly Statement[]) => {
    for (const statement of items) {
      addSpan(statement.id, statement.span);
      if (statement.kind === "Path") {
        collectItems(statement.items);
      } else if (statement.kind === "Scope") {
        collectStatements(statement.body);
      }
    }
  };

  collectStatements(statements);
  return spans;
}

function combineSelectedSourceSpan(
  selectedElementIds: ReadonlySet<string>,
  spansBySourceId: ReadonlyMap<string, SourceSpan>
): SourceSpan | null {
  let combined: SourceSpan | null = null;
  for (const sourceId of selectedElementIds) {
    const span = spansBySourceId.get(sourceId);
    if (!span) continue;
    if (!combined) {
      combined = { ...span };
      continue;
    }
    combined = {
      from: Math.min(combined.from, span.from),
      to: Math.max(combined.to, span.to)
    };
  }
  return combined;
}

function syncSelectionFromSourceCursor(
  state: CMState,
  spanIndex: SourceSpanIndex,
  selectedElementIds: ReadonlySet<string>,
  onDispatchingStoreSelection: () => void,
  dispatch: (action: { type: "SELECT"; id: string; additive: boolean } | { type: "CLEAR_SELECTION" }) => void
): void {
  const sourceId = findSourceIdAtPosition(state.selection.main.head, state.doc.length, spanIndex);

  if (sourceId) {
    const alreadySelected = selectedElementIds.size === 1 && selectedElementIds.has(sourceId);
    if (alreadySelected) {
      return;
    }
    onDispatchingStoreSelection();
    dispatch({ type: "SELECT", id: sourceId, additive: false });
    return;
  }

  if (selectedElementIds.size === 0) {
    return;
  }

  onDispatchingStoreSelection();
  dispatch({ type: "CLEAR_SELECTION" });
}

function findSourceIdAtPosition(
  position: number | null | undefined,
  docLength: number,
  spanIndex: SourceSpanIndex
): string | null {
  if (position == null || docLength <= 0) {
    return null;
  }

  const probe = clamp(position, 0, Math.max(0, docLength - 1));
  for (const span of spanIndex.sortedByWidth) {
    if (probe >= span.from && probe < span.to) {
      return span.sourceId;
    }
  }
  return null;
}

function normalizeDiagnostics(inputs: DiagnosticInput[], docLength: number): Diagnostic[] {
  return [...inputs]
    .sort((a, b) => {
      const sa = a.severity === "error" ? 1 : 0;
      const sb = b.severity === "error" ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return Math.abs(a.to - a.from) - Math.abs(b.to - b.from);
    })
    .slice(0, MAX_DIAGNOSTICS)
    .map((d) => {
      const { from, to: normalizedTo } = normalizeRange(d.from, d.to, docLength);
      let to = normalizedTo;
      if (to - from > MAX_DECORATED_SPAN) to = from + MAX_DECORATED_SPAN;
      return { ...d, from, to };
    })
    .filter((d) => d.to > d.from);
}

function normalizeRange(from: number, to: number, length: number): { from: number; to: number } {
  if (length <= 0) return { from: 0, to: 0 };
  const start = clamp(Math.min(from, to), 0, length);
  const end = clamp(Math.max(from, to), 0, length);
  if (start === end) {
    return start < length ? { from: start, to: start + 1 } : { from: Math.max(0, start - 1), to: start };
  }
  return { from: start, to: end };
}

function normalizeSelectionAnchorHead(anchor: number, head: number, length: number): { anchor: number; head: number } {
  if (length <= 0) {
    return { anchor: 0, head: 0 };
  }
  return {
    anchor: clamp(Math.floor(anchor), 0, length),
    head: clamp(Math.floor(head), 0, length)
  };
}

function dispatchSelectionWithStableHorizontalScroll(
  view: EditorView,
  spec: Parameters<EditorView["dispatch"]>[0]
): void {
  const previousScrollLeft = view.scrollDOM.scrollLeft;
  view.dispatch(spec);
  if (previousScrollLeft === 0) {
    return;
  }
  if (view.scrollDOM.scrollLeft === previousScrollLeft) {
    return;
  }
  scheduleHorizontalScrollRestore(view, previousScrollLeft);
}

function dispatchPatchChainWithStableHorizontalScroll(
  view: EditorView,
  patchChain: readonly SourceSyncPatchStep[],
  nextSource: string,
  sourceRevision: number
): void {
  const previousScrollLeft = view.scrollDOM.scrollLeft;
  const specs = patchChain.map((step, index) => ({
    sequential: index > 0,
    changes: sourcePatchChanges(step.patches),
    annotations: [
      Transaction.addToHistory.of(false),
      isolateHistory.of("before"),
      isolateHistory.of("after"),
      ...(index === patchChain.length - 1
        ? [sourcePanelExternalSyncAnnotation.of({ nextSource, sourceRevision })]
        : [])
    ]
  }));
  view.dispatch(...specs);
  if (previousScrollLeft === 0) {
    return;
  }
  if (view.scrollDOM.scrollLeft === previousScrollLeft) {
    return;
  }
  scheduleHorizontalScrollRestore(view, previousScrollLeft);
}

function restoreHorizontalScroll(view: EditorView, scrollLeft: number): void {
  if (!view.scrollDOM.isConnected) {
    return;
  }
  if (view.scrollDOM.scrollLeft === scrollLeft) {
    return;
  }
  view.scrollDOM.scrollLeft = scrollLeft;
}

function scheduleHorizontalScrollRestore(view: EditorView, scrollLeft: number): void {
  view.requestMeasure({
    read(measuredView) {
      return {
        hasOverflow: measuredView.scrollDOM.scrollWidth > measuredView.scrollDOM.clientWidth,
        currentScrollLeft: measuredView.scrollDOM.scrollLeft
      };
    },
    write(measure, measuredView) {
      if (!measure.hasOverflow || measure.currentScrollLeft === scrollLeft) {
        return;
      }
      restoreHorizontalScroll(measuredView, scrollLeft);
      measuredView.requestMeasure({
        read() {
          return null;
        },
        write(_ignored, followupView) {
          restoreHorizontalScroll(followupView, scrollLeft);
        }
      });
    }
  });
}

function shouldAutoRevealSourceSelection(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return !window.matchMedia("(max-width: 768px)").matches;
}

function buildDecorations(diagnostics: Diagnostic[]): DecorationSet {
  return Decoration.set(
    diagnostics.map((d) =>
      Decoration.mark({
        class: `cm-editor-diagnostic-range cm-editor-diagnostic-${d.severity}`
      }).range(d.from, d.to)
    ),
    true
  );
}

function bestDiagnosticAt(diagnostics: Diagnostic[], pos: number): Diagnostic | null {
  let best: Diagnostic | null = null;
  for (const d of diagnostics) {
    if (pos < d.from || pos > d.to) continue;
    if (!best) {
      best = d;
      continue;
    }
    const currentSeverity = d.severity === "error" ? 2 : 1;
    const bestSeverity = best.severity === "error" ? 2 : 1;
    if (currentSeverity > bestSeverity) {
      best = d;
      continue;
    }
    if (currentSeverity === bestSeverity && d.to - d.from < best.to - best.from) {
      best = d;
    }
  }
  return best;
}

function uniqueStrings(values: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    unique.add(trimmed);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function computeInlineColorPopoverStyle(anchorRect: DOMRectReadOnly): CSSProperties {
  const VIEWPORT_PADDING_PX = 8;
  const POPOVER_WIDTH_PX = 284;
  const POPOVER_HEIGHT_PX = 320;
  const POPOVER_GAP_PX = 6;

  const maxLeft = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_PADDING_PX);
  const left = clamp(anchorRect.left, VIEWPORT_PADDING_PX, maxLeft);

  const spaceBelow = window.innerHeight - anchorRect.bottom - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const spaceAbove = anchorRect.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX;
  const openUpward = POPOVER_HEIGHT_PX > spaceBelow && spaceAbove > 0;
  const top = openUpward
    ? Math.max(VIEWPORT_PADDING_PX, anchorRect.top - POPOVER_HEIGHT_PX - POPOVER_GAP_PX)
    : Math.min(
        anchorRect.bottom + POPOVER_GAP_PX,
        Math.max(VIEWPORT_PADDING_PX, window.innerHeight - POPOVER_HEIGHT_PX - VIEWPORT_PADDING_PX)
      );

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`
  };
}
