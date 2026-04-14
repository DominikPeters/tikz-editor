import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  APP_MENU_COMMAND_IDS,
  APP_MENU_DEFINITION,
  filterAppMenuDefinitionForTarget,
  type AppMenuPlatformTarget
} from "../app-menu";
import { useEditorStore, useEditorStoreApi } from "../store/store";
import { computeSnapshot, makeEmptySnapshot, setMathJaxFont, type ComputeRequest, type ComputeResponse } from "../compute";
import { applyEditAction } from "tikz-editor/edit/actions";
import { getRepeatSelectionEligibility } from "tikz-editor/edit/actions/repeat";
import { collectSourceWorldBounds } from "tikz-editor/edit/snapping";
import { PT_PER_CM } from "tikz-editor/edit/format";
import { emitSvgModel, type SvgRenderModel } from "tikz-editor/svg";
import type { SceneFigure } from "tikz-editor/semantic/types";
import { installAppProfilingRecorder, readAppProfilingSnapshot, resetAppProfilingSession } from "../profiling";
import { AppMenuBar } from "./AppMenuBar";
import { Toolbar } from "./Toolbar";
import { DockLayout } from "./DockLayout";
import { StatusBar } from "./StatusBar";
import { isCodeMirrorEventTarget } from "./editor-commands";
import { useEditorCommandRuntime } from "./editor-command-runtime";
import { toolModeFromShortcut } from "./tool-config";
import { createSingleFlightScheduler } from "./compute-scheduler";
import { computeTrigger } from "./compute-trigger";
import { buildRepeatPreviewScene } from "./repeat-preview";
import { useSettingsStore } from "../settings/useSettingsStore";
import { getActiveEditorPlatform } from "../platform/current";
import css from "./App.module.css";
import "./variables.css";
import { TabStrip } from "./TabStrip";
import type { UnsavedChangesDecision } from "./UnsavedChangesModal";
import { collectDirtyDocumentIdsForIntent, type CloseIntent } from "./close-guard";
import { OPEN_EXAMPLE_CATALOG, type TikzOpenExample } from "./examples/open-example-catalog";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { AssistantEvent } from "../platform/types";
import { resolveOpenedFileForDocument, dataTransferHasFilePayload } from "./svg-import";
import type { AssistantComposerImageAttachment } from "./assistant-image-attachments";
import { formatEquationText, type EquationNodeTarget } from "./equation-utils";
import { useDebouncedEffect } from "./hooks/useDebouncedEffect";
import "./selection.css";

const DevPanel = lazy(async () => {
  const mod = await import("./DevPanel");
  return { default: mod.DevPanel };
});

const OpenExampleModal = lazy(async () => {
  const mod = await import("./OpenExampleModal");
  return { default: mod.OpenExampleModal };
});

const SettingsModal = lazy(async () => {
  const mod = await import("./SettingsModal");
  return { default: mod.SettingsModal };
});

const SvgExportModal = lazy(async () => {
  const mod = await import("./SvgExportModal");
  return { default: mod.SvgExportModal };
});

const PngExportModal = lazy(async () => {
  const mod = await import("./PngExportModal");
  return { default: mod.PngExportModal };
});

const TikzJaxModal = lazy(async () => {
  const mod = await import("./TikzJaxModal");
  return { default: mod.TikzJaxModal };
});

const UnsavedChangesModal = lazy(async () => {
  const mod = await import("./UnsavedChangesModal");
  return { default: mod.UnsavedChangesModal };
});

const EquationModal = lazy(async () => {
  const mod = await import("./EquationModal");
  return { default: mod.EquationModal };
});

const RepeatModal = lazy(async () => {
  const mod = await import("./RepeatModal");
  return { default: mod.RepeatModal };
});

function menuTargetFromPlatformId(platformId: string): AppMenuPlatformTarget {
  if (platformId.startsWith("desktop")) {
    if (typeof navigator !== "undefined") {
      if (/(mac|iphone|ipad)/i.test(navigator.platform)) {
        return "desktop-macos";
      }
      if (/win/i.test(navigator.platform)) {
        return "desktop-windows";
      }
    }
    return "desktop";
  }
  return "web";
}

function desktopOsFromPlatformId(platformId: string): "windows" | "macos" | "other" | null {
  if (!platformId.startsWith("desktop")) {
    return null;
  }
  if (typeof navigator === "undefined") {
    return "other";
  }
  if (/(mac|iphone|ipad)/i.test(navigator.platform)) {
    return "macos";
  }
  if (/win/i.test(navigator.platform)) {
    return "windows";
  }
  return "other";
}

function isCanvasViewportFocused(): boolean {
  return (
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest("[data-canvas-viewport=\"true\"]") != null
  );
}

function isEditableShortcutTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function selectAllInEditableTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    target.select();
    return true;
  }
  if (target.isContentEditable) {
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}

type RepeatModalState = {
  documentId: string;
  source: string;
  activeFigureId: string | null;
  selectedSourceIds: string[];
  selectionWidthPt: number;
  selectionHeightPt: number;
  columns: number;
  rows: number;
  horizontalStepPt: number;
  verticalStepPt: number;
};

export function App() {
  const storeApi = useEditorStoreApi();
  const {
    source,
    snapshot,
    activeFigureId,
    selectedElementIds,
    pendingRequestId,
    activeDocumentId,
    documents,
    tabOrder,
    toolMode,
    lastEditChangedSourceIds,
    lastEditPatches,
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    hoveredElementId,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    source: s.source,
    snapshot: s.snapshot,
    activeFigureId: s.activeFigureId,
    selectedElementIds: s.selectedElementIds,
    pendingRequestId: s.pendingRequestId,
    activeDocumentId: s.activeDocumentId,
    documents: s.documents,
    tabOrder: s.tabOrder,
    toolMode: s.toolMode,
    lastEditChangedSourceIds: s.lastEditChangedSourceIds,
    lastEditPatches: s.lastEditPatches,
    activeCanvasDragKind: s.activeCanvasDragKind,
    activeSourceScrubSourceId: s.activeSourceScrubSourceId,
    hoveredElementId: s.hoveredElementId,
    dispatch: s.dispatch
  })));
  const { uiFontSizePx, colorScheme, canvasInvert, mathJaxFont } = useSettingsStore(useShallow((s) => ({
    uiFontSizePx: s.settings.general.uiFontSizePx,
    colorScheme: s.settings.general.colorScheme,
    canvasInvert: s.settings.general.canvasInvert,
    mathJaxFont: s.settings.rendering.mathJaxFont
  })));
  const platform = getActiveEditorPlatform();
  const menuTarget = menuTargetFromPlatformId(platform.id);
  const menuDefinition = useMemo(() => filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, menuTarget), [menuTarget]);
  const [showOpenExampleModal, setShowOpenExampleModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const isDesktop = platform.id.startsWith("desktop");
  const [equationModalState, setEquationModalState] = useState<
    | { mode: "insert" }
    | { mode: "edit"; target: EquationNodeTarget }
    | null
  >(null);
  const [repeatModalState, setRepeatModalState] = useState<RepeatModalState | null>(null);
  const [repeatPreviewModel, setRepeatPreviewModel] = useState<SvgRenderModel | null>(null);
  const [insertEquationDraft, setInsertEquationDraft] = useState("");
  const [compiledPictureSource, setCompiledPictureSource] = useState<{
    source: string;
    activeFigureId: string | null;
  } | null>(null);
  const [svgExportSvgResult, setSvgExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pngExportSvgResult, setPngExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pendingAutoFit, setPendingAutoFit] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ intent: CloseIntent; dirtyDocumentIds: string[] } | null>(null);
  const requestCloseIntentRef = useRef<(intent: CloseIntent) => void>(() => undefined);
  const computeSchedulerRef = useRef<ReturnType<typeof createSingleFlightScheduler<ComputeRequest, ComputeResponse>> | null>(null);
  const sourceRef = useRef(source);
  const snapshotRef = useRef(snapshot);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const documentsRef = useRef(documents);

  function executeCloseIntent(intent: CloseIntent): void {
    if (intent.kind === "close-document") {
      dispatch({ type: "CLOSE_DOCUMENT", documentId: intent.documentId });
      return;
    }
    if (intent.kind === "close-all") {
      dispatch({ type: "CLOSE_ALL_DOCUMENTS" });
      return;
    }
    void getActiveEditorPlatform().window?.close?.();
  }

  function requestCloseIntent(intent: CloseIntent): void {
    const dirtyDocumentIds = collectDirtyDocumentIdsForIntent(intent, documents, tabOrder);
    if (dirtyDocumentIds.length === 0) {
      executeCloseIntent(intent);
      return;
    }
    const confirmNative = getActiveEditorPlatform().window?.confirmUnsavedChanges;
    if (confirmNative) {
      const titles = dirtyDocumentIds.map((id) => documents[id]?.title ?? "Untitled");
      const message =
        titles.length === 1
          ? `The document "${titles[0]}" has unsaved changes.`
          : `${titles.length} documents have unsaved changes.`;
      void confirmNative(message).then((decision) => {
        void handleUnsavedDecision(decision, { intent, dirtyDocumentIds });
      });
      return;
    }
    setPendingClose({ intent, dirtyDocumentIds });
  }

  requestCloseIntentRef.current = requestCloseIntent;

  const commandRuntime = useEditorCommandRuntime({
    onOpenExample: () => {
      setShowOpenExampleModal(true);
    },
    onOpenSvgExport: (svgResult) => {
      setSvgExportSvgResult(svgResult);
    },
    onOpenPngExport: (svgResult) => {
      setPngExportSvgResult(svgResult);
    },
    onShowCompiledPicture: () => {
      setCompiledPictureSource({
        source,
        activeFigureId
      });
    },
    onOpenSettings: () => {
      setShowSettingsModal(true);
    },
    onOpenInsertEquation: () => {
      setEquationModalState({ mode: "insert" });
    },
    onOpenEditEquation: (target) => {
      setEquationModalState({ mode: "edit", target });
    },
    onOpenRepeat: () => {
      const nextState = resolveRepeatModalState({
        source,
        activeFigureId,
        selectedElementIds,
        scene: snapshot.scene,
        documentId: activeDocumentId
      });
      if (nextState) {
        setRepeatModalState(nextState);
      }
    },
    onFocusAssistant: () => {
      dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
    },
    onInterruptAssistant: () => {
      void platform.assistant?.interruptTurn?.({ documentId: activeDocumentId });
    },
    onRequestCloseDocument: (documentId) => {
      requestCloseIntent({ kind: "close-document", documentId });
    },
    onRequestCloseAllDocuments: () => {
      requestCloseIntent({ kind: "close-all" });
    }
  });

  useEffect(() => {
    const apply = (dark: boolean) => {
      document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
      if (dark && canvasInvert) {
        document.documentElement.dataset.canvasInvert = "true";
      } else {
        delete document.documentElement.dataset.canvasInvert;
      }
      void platform.window?.setTheme?.(colorScheme === "system" ? null : dark ? "dark" : "light");
    };
    if (colorScheme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      apply(colorScheme === "dark");
    }
  }, [colorScheme, canvasInvert]);

  useEffect(() => {
    const desktopOs = desktopOsFromPlatformId(platform.id);
    if (desktopOs) {
      document.documentElement.dataset.desktopOs = desktopOs;
      return;
    }
    delete document.documentElement.dataset.desktopOs;
  }, [platform.id]);

  useEffect(() => {
    sourceRef.current = source;
    snapshotRef.current = snapshot;
    activeDocumentIdRef.current = activeDocumentId;
    documentsRef.current = documents;
  }, [activeDocumentId, documents, snapshot, source]);

  useEffect(() => {
    if (!repeatModalState) {
      setRepeatPreviewModel(null);
      return;
    }
    if (repeatModalState.documentId !== activeDocumentId || repeatModalState.source !== source) {
      setRepeatModalState(null);
      setRepeatPreviewModel(null);
    }
  }, [activeDocumentId, repeatModalState, source]);

  useEffect(() => {
    if (!repeatModalState) {
      setRepeatPreviewModel(null);
      return;
    }
    if (!snapshot.svg?.viewBox) {
      setRepeatPreviewModel(null);
      return;
    }

    const action = {
      kind: "repeatElements" as const,
      elementIds: repeatModalState.selectedSourceIds,
      columns: repeatModalState.columns,
      rows: repeatModalState.rows,
      horizontalStep: repeatModalState.horizontalStepPt,
      verticalStep: repeatModalState.verticalStepPt
    };
    const result = applyEditAction(repeatModalState.source, [], action, {
      parseOptions: repeatModalState.activeFigureId == null ? {} : { activeFigureId: repeatModalState.activeFigureId }
    });
    if (result.kind !== "success" && result.kind !== "partial") {
      setRepeatPreviewModel(null);
      return;
    }
    const previewGroupSpan = result.patches[0]?.newSpan;
    if (!previewGroupSpan) {
      setRepeatPreviewModel(null);
      return;
    }

    let cancelled = false;
    void computeSnapshot({
      id: crypto.randomUUID(),
      source: result.newSource,
      activeFigureId: repeatModalState.activeFigureId
    }).then((response) => {
      if (cancelled) {
        return;
      }
      const previewScene = buildRepeatPreviewScene(response.snapshot.scene, previewGroupSpan);
      if (!previewScene || previewScene.elements.length === 0) {
        setRepeatPreviewModel(null);
        return;
      }
      setRepeatPreviewModel(
        emitSvgModel(previewScene, {
          padding: 18,
          viewBox: snapshot.svg!.viewBox
        })
      );
    }).catch(() => {
      if (!cancelled) {
        setRepeatPreviewModel(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repeatModalState, snapshot.svg]);

  const activeAssistantDoc = documents[activeDocumentId];

  useEffect(() => {
    const scheduler = createSingleFlightScheduler<ComputeRequest, ComputeResponse>({
      run: (request) => computeSnapshot(request),
      onStart: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({ type: "COMPUTE_REQUESTED", requestId: request.id, documentId: request.documentId });
      },
      onSuccess: (_request, response) => {
        if ((_request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: response.id,
          snapshot: response.snapshot,
          documentId: response.documentId
        });
      },
      onError: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source),
          documentId: request.documentId
        });
      }
    });
    computeSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      computeSchedulerRef.current = null;
    };
  }, [dispatch]);

  // ── Compute pipeline ─────────────────────────────────────────────────────────
  // Keep at most one in-flight compute; while in-flight, coalesce to the latest source.
  const changedSourceIds = lastEditChangedSourceIds ?? (activeSourceScrubSourceId ? [activeSourceScrubSourceId] : null);
  const trigger = computeTrigger(activeCanvasDragKind, activeSourceScrubSourceId);
  const typingComputeDelay = trigger === "other" && changedSourceIds == null
    ? (source.length > 80_000 ? 220 : 120)
    : null;

  useEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler || typingComputeDelay != null) {
      return;
    }
    setMathJaxFont(mathJaxFont);
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "render",
      source,
      activeFigureId,
      changedSourceIds,
      patches: lastEditPatches ? [...lastEditPatches] : null,
      trigger
    });
  }, [activeDocumentId, activeFigureId, changedSourceIds, dispatch, lastEditPatches, mathJaxFont, source, trigger, typingComputeDelay]);

  useDebouncedEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler || typingComputeDelay == null) {
      return;
    }
    setMathJaxFont(mathJaxFont);
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "render",
      source,
      activeFigureId,
      changedSourceIds,
      patches: lastEditPatches ? [...lastEditPatches] : null,
      trigger
    });
  }, typingComputeDelay, [activeDocumentId, activeFigureId, changedSourceIds, dispatch, lastEditPatches, mathJaxFont, source, trigger, typingComputeDelay]);

  const prewarmDelay = activeCanvasDragKind || activeSourceScrubSourceId || pendingRequestId != null || !hoveredElementId || snapshot.source !== source
    ? null
    : 120;

  useDebouncedEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler || !hoveredElementId) {
      return;
    }
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "prewarm",
      source,
      activeFigureId,
      changedSourceIds: [hoveredElementId],
      trigger: "drag-element"
    });
  }, prewarmDelay, [activeDocumentId, activeFigureId, hoveredElementId, source, prewarmDelay]);

  useEffect(() => {
    if (!platform.assistant?.bindEvents) {
      return;
    }
    const assistantApi = platform.assistant;
    const bindAssistantEvents = assistantApi.bindEvents!;

    async function respondToDynamicTool(event: Extract<AssistantEvent, { type: "dynamic-tool-call" }>): Promise<void> {
      const doc = documentsRef.current[event.documentId];
      if (!doc) {
        return;
      }
      const sourceForDoc = event.documentId === activeDocumentIdRef.current ? sourceRef.current : doc.source;
      const snapshotForDoc = event.documentId === activeDocumentIdRef.current ? snapshotRef.current : doc.snapshot;
      const args = (event.arguments ?? {}) as Record<string, unknown>;

      const respond = async (success: boolean, text: string, imageUrl?: string) => {
        const contentItems: unknown[] = [{ type: "inputText", text }];
        if (imageUrl) contentItems.push({ type: "inputImage", imageUrl });
        await assistantApi.respondToDynamicToolCall?.({
          documentId: event.documentId,
          requestId: event.requestId,
          result: { success, contentItems }
        });
      };

      // ── Resolve snapshot for figure_index (if provided) ─────────────
      // figure_index is 1-indexed; omit or 0 to use the active figure.
      const figureIndexArg = typeof args.figure_index === "number" ? args.figure_index : 0;
      let targetSnapshot = snapshotForDoc;
      let targetFigureId = snapshotForDoc.activeFigureId;
      if (figureIndexArg > 0 && snapshotForDoc.figures.length > 1) {
        const idx = figureIndexArg - 1;
        if (idx < 0 || idx >= snapshotForDoc.figures.length) {
          await respond(false, `Invalid figure_index ${figureIndexArg}. Document has ${snapshotForDoc.figures.length} figure(s).`);
          return;
        }
        const requestedFigId = snapshotForDoc.figures[idx]!.id;
        if (requestedFigId !== snapshotForDoc.activeFigureId) {
          try {
            const result = await computeSnapshot({
              id: crypto.randomUUID(),
              documentId: event.documentId,
              kind: "render",
              source: sourceForDoc,
              activeFigureId: requestedFigId,
              changedSourceIds: null,
              patches: null,
              trigger: "other"
            });
            targetSnapshot = result.snapshot;
            targetFigureId = requestedFigId;
          } catch {
            await respond(false, `Failed to compute snapshot for figure ${figureIndexArg}.`);
            return;
          }
        }
      }

      // ── get_diagnostics ───────────────────────────────────────────────
      if (event.tool === "get_diagnostics") {
        const { buildDiagnosticsText: buildDiag } = await import("./assistant-tool-handlers");
        const text = buildDiag(sourceForDoc, targetSnapshot);
        await respond(true, text || "No diagnostics — source parses cleanly.");
        return;
      }

      // ── get_element_list ──────────────────────────────────────────────
      if (event.tool === "get_element_list") {
        const { buildElementList } = await import("./assistant-tool-handlers");
        await respond(true, buildElementList(sourceForDoc, targetSnapshot));
        return;
      }

      // ── get_node_anchors ──────────────────────────────────────────────
      if (event.tool === "get_node_anchors") {
        const { buildNodeAnchors } = await import("./assistant-tool-handlers");
        const nodeName = typeof args.node_name === "string" ? args.node_name : "";
        await respond(true, buildNodeAnchors(targetSnapshot, nodeName));
        return;
      }

      // ── get_bounds ────────────────────────────────────────────────────
      if (event.tool === "get_bounds") {
        const { buildBoundsText } = await import("./assistant-tool-handlers");
        await respond(true, buildBoundsText(targetSnapshot));
        return;
      }

      // ── get_latest_preview_png ────────────────────────────────────────
      const hasOverlayCode = typeof args.overlay_code === "string" && args.overlay_code.length > 0;
      const hasGrid = args.show_grid != null;
      const hasZoom = args.zoom_region != null;

      let svgToRender = targetSnapshot.svg;
      let sourceMatches = targetSnapshot.source === sourceForDoc;

      // If overlay_code is requested, re-render with modified source
      if (hasOverlayCode && sourceMatches) {
        try {
          const { injectOverlayCode } = await import("./assistant-tool-handlers");
          const targetFig = targetSnapshot.figures.find((f) => f.id === targetFigureId);
          const modifiedSource = injectOverlayCode(sourceForDoc, args.overlay_code as string, targetFig?.span);
          const result = await computeSnapshot({
            id: crypto.randomUUID(),
            documentId: event.documentId,
            kind: "render",
            source: modifiedSource,
            activeFigureId: targetFigureId,
            changedSourceIds: null,
            patches: null,
            trigger: "other"
          });
          svgToRender = result.snapshot.svg;
          sourceMatches = true;
        } catch {
          await respond(false, "Failed to render with overlay code.");
          return;
        }
      }

      if (!svgToRender || !sourceMatches) {
        await respond(false, "Preview could not be rendered.");
        return;
      }

      try {
        const { applyPreviewEnhancements } = await import("./assistant-tool-handlers");
        const { renderPngExport } = await import("./export-commands");

        let enhancedSvg = svgToRender;
        if (hasGrid || hasZoom) {
          enhancedSvg = applyPreviewEnhancements(svgToRender, {
            showGrid: hasGrid ? (args.show_grid as { spacing?: number; color?: string }) : undefined,
            zoomRegion: hasZoom ? (args.zoom_region as { min_x: number; min_y: number; max_x: number; max_y: number }) : undefined
          });
        }

        const rendered = await renderPngExport(enhancedSvg, { dpi: 144, transparentBackground: false });
        const pngBase64 = await blobToBase64(rendered.blob);
        const dataUrl = `data:${rendered.artifact.mimeType};base64,${pngBase64}`;

        let description = "Rendered an updated PNG preview";
        if (hasOverlayCode) description += " with overlay code";
        if (hasGrid) description += " with coordinate grid";
        if (hasZoom) {
          const z = args.zoom_region as { min_x: number; min_y: number; max_x: number; max_y: number };
          description += ` zoomed to (${z.min_x},${z.min_y})–(${z.max_x},${z.max_y})`;
        }
        description += ".";

        await respond(true, description, dataUrl);
      } catch (error) {
        await respond(false, error instanceof Error ? error.message : String(error));
      }
    }

    const unbind = bindAssistantEvents((event) => {
      switch (event.type) {
        case "thread-ready":
          dispatch({
            type: "ASSISTANT_THREAD_READY",
            documentId: event.documentId,
            threadId: event.thread.threadId,
            workspacePath: event.thread.workspacePath,
            figurePath: event.thread.figurePath,
            previewPath: event.thread.previewPath
          });
          break;
        case "thread-state":
          dispatch({ type: "ASSISTANT_THREAD_LOADED", documentId: event.documentId, state: event.state });
          break;
        case "turn-status":
          dispatch({
            type: "ASSISTANT_TURN_STATUS",
            documentId: event.documentId,
            status: event.status,
            turnId: event.turnId ?? null,
            error: event.error ?? null
          });
          break;
        case "item-started":
          dispatch({ type: "ASSISTANT_ITEM_STARTED", documentId: event.documentId, item: event.item });
          break;
        case "item-updated":
          dispatch({ type: "ASSISTANT_ITEM_UPDATED", documentId: event.documentId, item: event.item });
          break;
        case "item-completed":
          dispatch({ type: "ASSISTANT_ITEM_COMPLETED", documentId: event.documentId, item: event.item });
          break;
        case "item-delta":
          dispatch({
            type: "ASSISTANT_ITEM_DELTA",
            documentId: event.documentId,
            itemId: event.itemId,
            deltaType: event.deltaType,
            delta: event.delta
          });
          break;
        case "approval-requested":
          dispatch({ type: "ASSISTANT_APPROVAL_REQUESTED", documentId: event.documentId, approval: event.approval });
          break;
        case "approval-cleared":
          dispatch({ type: "ASSISTANT_APPROVAL_CLEARED", documentId: event.documentId, requestId: event.requestId });
          break;
        case "source-updated":
          dispatch({
            type: "ASSISTANT_SOURCE_UPDATED",
            documentId: event.documentId,
            source: event.source,
            revisionToken: event.revisionToken,
            historyMergeKey: `assistant-turn:${event.documentId}`
          });
          break;
        case "dynamic-tool-call":
          void respondToDynamicTool(event);
          break;
        case "error":
          dispatch({ type: "ASSISTANT_SET_ERROR", documentId: event.documentId, message: event.message });
          break;
      }
    });

    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch, platform.assistant]);

  async function buildCurrentPreviewBase64(sourceForDoc: string, snapshotForDoc: ComputeResponse["snapshot"]): Promise<string | null> {
    if (!snapshotForDoc.svg || snapshotForDoc.source !== sourceForDoc) {
      return null;
    }
    const { renderPngExport } = await import("./export-commands");
    const rendered = await renderPngExport(snapshotForDoc.svg, { dpi: 144, transparentBackground: false });
    return await blobToBase64(rendered.blob);
  }

  async function handleAssistantPrompt(
    prompt: string,
    model: string | null,
    attachments: AssistantComposerImageAttachment[]
  ): Promise<void> {
    const documentId = activeDocumentId;
    const currentDocument = documents[documentId];
    const currentSource = currentDocument?.source ?? source;
    const currentSnapshot = currentDocument?.snapshot ?? snapshot;
    const { buildFigureContext: buildFigCtx, buildDiagnosticsText: buildDiag } = await import("./assistant-tool-handlers");
    const figureContext = buildFigCtx(currentSource, currentSnapshot);
    const diagnosticsText = buildDiag(currentSource, currentSnapshot);
    const pastedImages = await Promise.all(
      attachments.map(async (attachment) => ({
        base64: await blobToBase64(attachment.blob),
        mimeType: attachment.mimeType,
        fileName: attachment.fileName
      }))
    );
    const optimisticImageContent = pastedImages.map((image) => ({
      type: "image" as const,
      url: `data:${image.mimeType};base64,${image.base64}`
    }));
    dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
    dispatch({ type: "ASSISTANT_TURN_STATUS", documentId, status: "starting", turnId: null });
    dispatch({
      type: "ASSISTANT_ITEM_STARTED",
      documentId,
      item: {
        type: "userMessage",
        id: `optimistic-user-message:${documentId}:${Date.now()}`,
        content: [
          { type: "text", text: prompt },
          ...optimisticImageContent
        ]
      }
    });
    try {
      const assistant = platform.assistant;
      const thread = await assistant?.ensureDocumentThread?.({
        documentId,
        source: currentSource,
        threadId: currentDocument?.assistantThreadId ?? null,
        workspacePath: currentDocument?.assistantWorkspacePath ?? null,
        figurePath: currentDocument?.assistantFigurePath ?? null,
        previewPath: currentDocument?.assistantPreviewPath ?? null
      });
      if (thread) {
        dispatch({
          type: "ASSISTANT_THREAD_READY",
          documentId,
          threadId: thread.threadId,
          workspacePath: thread.workspacePath,
          figurePath: thread.figurePath,
          previewPath: thread.previewPath
        });
      }
      const pngBase64 = await buildCurrentPreviewBase64(currentSource, currentSnapshot);
      await assistant?.startTurn?.({
        documentId,
        prompt,
        source: currentSource,
        pngBase64,
        pastedImages: pastedImages.length > 0 ? pastedImages : undefined,
        threadId: thread?.threadId ?? currentDocument?.assistantThreadId ?? null,
        workspacePath: thread?.workspacePath ?? currentDocument?.assistantWorkspacePath ?? null,
        figurePath: thread?.figurePath ?? currentDocument?.assistantFigurePath ?? null,
        previewPath: thread?.previewPath ?? currentDocument?.assistantPreviewPath ?? null,
        model,
        figureContext,
        diagnosticsText
      });
    } catch (error) {
      dispatch({
        type: "ASSISTANT_TURN_STATUS",
        documentId,
        status: "failed",
        turnId: null,
        error: error instanceof Error ? error.message : String(error)
      });
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleInterruptAssistantTurn(): Promise<void> {
    try {
      await platform.assistant?.interruptTurn?.({ documentId: activeDocumentId });
    } catch (error) {
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId: activeDocumentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    const unbind = getActiveEditorPlatform().menu?.bindCommandHandler?.((commandId) => {
      commandRuntime.runCommand(commandId, "platform");
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [commandRuntime]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      installAppProfilingRecorder();
    }
    const globalLike = globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        setSource: (nextSource: string) => void;
        getSource: () => string;
        getSourceRevision: () => number;
        getSnapshotSource: () => string;
        runCommand: (commandId: string) => boolean;
        selectFirstFigure: () => void;
        selectAllElements: () => void;
        selectSourceIds: (sourceIds: string[]) => void;
        clearSelection: () => void;
        getSelectedSourceIds: () => string[];
        getActiveFigureId: () => string | null;
        getFigureCount: () => number;
        getActiveCanvasDragKind: () => string | null;
        getCanvasTransform: () => { translateX: number; translateY: number; scale: number };
        setCanvasTransform: (transform: { translateX: number; translateY: number; scale: number }) => void;
        getSceneTextDebug: () => Array<{
          sourceId: string;
          sceneTextId: string;
          text: string;
          renderSourceText: string | null;
          paragraphId: string | null;
          layoutKind: string | null;
        }>;
        resetProfilingSession: (label?: string | null) => void;
        getProfilingSnapshot: () => ReturnType<typeof readAppProfilingSnapshot>;
      };
    };
    globalLike.__TIKZ_EDITOR_APP_TEST_API__ = {
      setSource: (nextSource) => {
        dispatch({ type: "CODE_EDITED", source: nextSource });
      },
      getSource: () => {
        return storeApi.getState().source;
      },
      getSourceRevision: () => {
        return storeApi.getState().sourceRevision;
      },
      getSnapshotSource: () => {
        return snapshotRef.current.source;
      },
      runCommand: (commandId) => {
        return commandRuntime.runCommand(commandId as keyof typeof commandRuntime.bindings, "platform");
      },
      selectFirstFigure: () => {
        const firstFigureId = snapshotRef.current.figures[0]?.id ?? null;
        dispatch({ type: "SET_ACTIVE_FIGURE", figureId: firstFigureId });
      },
      selectAllElements: () => {
        const ids = Array.from(
          new Set(
            (snapshotRef.current.scene?.elements ?? []).map((element) => element.sourceRef.sourceId)
          )
        );
        dispatch({ type: "SELECT_RANGE", ids });
      },
      selectSourceIds: (sourceIds) => {
        dispatch({ type: "SELECT_RANGE", ids: sourceIds });
      },
      clearSelection: () => {
        dispatch({ type: "CLEAR_SELECTION" });
      },
      getSelectedSourceIds: () => {
        return [...storeApi.getState().selectedElementIds];
      },
      getActiveFigureId: () => {
        return storeApi.getState().activeFigureId;
      },
      getFigureCount: () => {
        return storeApi.getState().snapshot.figures.length;
      },
      getActiveCanvasDragKind: () => {
        return storeApi.getState().activeCanvasDragKind;
      },
      getCanvasTransform: () => {
        const transform = storeApi.getState().canvasTransform;
        return {
          translateX: transform.translateX,
          translateY: transform.translateY,
          scale: transform.scale
        };
      },
      setCanvasTransform: (transform) => {
        dispatch({ type: "SET_CANVAS_TRANSFORM", transform });
      },
      getSceneTextDebug: () => {
        const elements = snapshotRef.current.scene?.elements ?? [];
        return elements
          .filter((element): element is Extract<(typeof elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => ({
            sourceId: element.sourceRef.sourceId,
            sceneTextId: element.id,
            text: element.text,
            renderSourceText: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.renderSourceText : null,
            paragraphId: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.paragraphId : null,
            layoutKind: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.layoutKind : null
          }));
      },
      resetProfilingSession: (label) => {
        resetAppProfilingSession(label ?? null);
      },
      getProfilingSnapshot: () => {
        return readAppProfilingSnapshot();
      }
    };
    return () => {
      delete globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    };
  }, [commandRuntime, dispatch, storeApi]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().files?.bindOpenRequest?.(async (opened) => {
      const resolved = await resolveOpenedFileForDocument(opened);
      if (resolved.kind === "failure") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(resolved.message);
        }
        return;
      }
      dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
      dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().window?.bindCloseRequest?.(() => {
      requestCloseIntentRef.current({ kind: "window-close" });
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, []);

  useEffect(() => {
    getActiveEditorPlatform().window?.setDocumentState?.({
      title: "TikZ Editor",
      dirty: snapshot.source !== source
    });
  }, [snapshot.source, source]);

  useEffect(() => {
    if (!pendingAutoFit) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
    setPendingAutoFit(false);
  }, [dispatch, pendingAutoFit, snapshot.source, source]);

  useEffect(() => {
    const sync = platform.menu?.syncNativeMenu;
    if (typeof sync !== "function") {
      return;
    }
    const commandStates = Object.fromEntries(
      Object.entries(commandRuntime.bindings).map(([commandId, binding]) => [
        commandId,
        { enabled: binding.enabled, checked: binding.checked }
      ])
    ) as Record<keyof typeof commandRuntime.bindings, { enabled: boolean; checked?: boolean }>;
    void sync({
      definition: menuDefinition,
      commandStates
    });
  }, [commandRuntime.bindings, menuDefinition, platform.menu]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) {
        return;
      }

      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "f") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.FORMAT_TIKZ, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "a") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "n") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.NEW_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "w") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "s") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "o") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "0") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === ",") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === "=" || key === "+")) {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_IN, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "-") {
        if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      // Ctrl+Shift+D: toggle dev panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "d") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL, "shortcut");
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd+Shift+E: edit equation when possible, otherwise insert equation.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "e") {
        const edited = commandRuntime.runCommand(APP_MENU_COMMAND_IDS.EDIT_EQUATION, "shortcut");
        if (!edited) {
          commandRuntime.runCommand(APP_MENU_COMMAND_IDS.INSERT_EQUATION, "shortcut");
        }
        e.preventDefault();
        return;
      }

      const target = e.target as EventTarget | null;
      const activeElement = document.activeElement;
      const inCodeMirror = isCodeMirrorEventTarget(target) || isCodeMirrorEventTarget(activeElement);
      if (inCodeMirror) return;

      // Keep browser/field-native behavior for editable fields outside CM.
      const editableShortcutTarget = isEditableShortcutTarget(target)
        ? target
        : (isEditableShortcutTarget(activeElement) ? activeElement : null);
      if (editableShortcutTarget) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "a") {
          if (selectAllInEditableTarget(editableShortcutTarget)) {
            e.preventDefault();
          }
        }
        return;
      }
      const canvasShortcutContext = isCanvasViewportFocused();

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === "escape" && toolMode !== "select") {
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const hasTextSelection = Boolean(window.getSelection()?.toString().trim());

        if (!e.shiftKey && key === "a") {
          if (!canvasShortcutContext) {
            return;
          }
          const ids = Array.from(
            new Set(
              (snapshotRef.current.scene?.elements ?? []).map((element) => element.sourceRef.sourceId)
            )
          );
          dispatch({ type: "SELECT_RANGE", ids });
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "c") {
          // If canvas is focused, let the native copy event fire there.
          if (canvasShortcutContext) {
            return;
          }
          // If there's a text selection anywhere, let native copy work for it.
          if (hasTextSelection) {
            return;
          }
          // Otherwise, if canvas elements are selected, copy them directly.
          if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.COPY, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "x") {
          // If canvas is focused, let the native cut event fire there.
          if (canvasShortcutContext) {
            return;
          }
          // If there's a text selection anywhere, let native cut work for it.
          if (hasTextSelection) {
            return;
          }
          // Otherwise, if canvas elements are selected, cut them directly.
          if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.CUT, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "v") {
          // If canvas is focused, let the native paste event fire there (supports DataTransfer).
          if (canvasShortcutContext) {
            return;
          }
          // Otherwise, paste directly via async clipboard API.
          if (commandRuntime.runCommand(APP_MENU_COMMAND_IDS.PASTE, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "d") {
          if (!canvasShortcutContext) {
            return;
          }
          commandRuntime.runCommand(APP_MENU_COMMAND_IDS.DUPLICATE, "shortcut");
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "g") {
          if (!canvasShortcutContext) {
            return;
          }
          commandRuntime.runCommand(APP_MENU_COMMAND_IDS.GROUP, "shortcut");
          e.preventDefault();
          return;
        }

        if (e.shiftKey && key === "g") {
          if (!canvasShortcutContext) {
            return;
          }
          commandRuntime.runCommand(APP_MENU_COMMAND_IDS.UNGROUP, "shortcut");
          e.preventDefault();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcutMode = toolModeFromShortcut(key);
        if (shortcutMode) {
          dispatch({ type: "SET_TOOL_MODE", mode: shortcutMode });
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === "z") {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        commandRuntime.runCommand(APP_MENU_COMMAND_IDS.REDO, "shortcut");
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    commandRuntime,
    dispatch,
    toolMode
  ]);

  const appStyle = {
    "--app-ui-font-size": `${uiFontSizePx}px`,
    "--app-ui-scale": `${uiFontSizePx / 11}`
  } as CSSProperties;

  const loadExampleIntoEditor = (example: TikzOpenExample) => {
    dispatch({ type: "NEW_DOCUMENT", source: example.source, title: example.title });
    setShowOpenExampleModal(false);
    setPendingAutoFit(true);
  };

  async function handleUnsavedDecision(
    decision: UnsavedChangesDecision,
    ctx?: { intent: CloseIntent; dirtyDocumentIds: string[] }
  ): Promise<void> {
    const closeCtx = ctx ?? pendingClose;
    if (!closeCtx) {
      return;
    }
    if (decision === "cancel") {
      setPendingClose(null);
      return;
    }
    if (decision === "discard") {
      setPendingClose(null);
      executeCloseIntent(closeCtx.intent);
      return;
    }

    const saveText = getActiveEditorPlatform().files?.saveText;
    if (!saveText) {
      setPendingClose(null);
      return;
    }
    for (const documentId of closeCtx.dirtyDocumentIds) {
      const doc = documents[documentId];
      if (!doc || !doc.dirty) {
        continue;
      }
      const result = await saveText(doc.source, {
        mode: "save",
        fileRef: doc.fileRef,
        suggestedName: doc.fileRef?.name ?? "tikz-document.tex"
      });
      if (result.status === "saved") {
        dispatch({
          type: "MARK_DOCUMENT_SAVED",
          documentId,
          fileRef: result.fileRef
        });
        continue;
      }
      if (result.status === "failed") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(result.reason ?? "Save failed. Close action was cancelled.");
        }
      }
      setPendingClose(null);
      return;
    }
    setPendingClose(null);
    executeCloseIntent(closeCtx.intent);
  }

  function isDroppableFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return name.endsWith(".tex") || name.endsWith(".tikz") || name.endsWith(".svg");
  }

  function onAppDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dataTransferHasFilePayload(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDesktop) {
      setIsDragOver(true);
    }
  }

  function onAppDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear when leaving the app root entirely
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  }

  async function onAppDrop(e: React.DragEvent<HTMLDivElement>) {
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(isDroppableFile);
    if (!file) {
      return;
    }
    e.preventDefault();
    const source = await file.text();
    const opened = { source, fileRef: { kind: "virtual" as const, name: file.name } };
    const resolved = await resolveOpenedFileForDocument(opened);
    if (resolved.kind === "failure") {
      return;
    }
    dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
    dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
  }

  return (
    <div
      className={css.app}
      style={appStyle}
      onDragOver={onAppDragOver}
      onDragLeave={onAppDragLeave}
      onDrop={(e) => { void onAppDrop(e); }}
    >
      {platform.menu?.usesNativeMenuBar ? null : (
        <AppMenuBar
          definition={menuDefinition}
          bindings={commandRuntime.bindings}
        />
      )}
      <Toolbar />
      <TabStrip
        onRequestCloseDocument={(documentId) => {
          requestCloseIntent({ kind: "close-document", documentId });
        }}
      />
      <div className={css.body}>
        <DockLayout
          repeatPreviewModel={repeatPreviewModel}
          onSubmitPrompt={handleAssistantPrompt}
          onInterruptTurn={handleInterruptAssistantTurn}
        />
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        <DevPanel />
      </Suspense>
      {showOpenExampleModal ? (
        <Suspense fallback={null}>
          <OpenExampleModal
            examples={OPEN_EXAMPLE_CATALOG}
            onClose={() => setShowOpenExampleModal(false)}
            onSelectExample={loadExampleIntoEditor}
          />
        </Suspense>
      ) : null}
      {compiledPictureSource !== null ? (
        <Suspense fallback={null}>
          <TikzJaxModal
            source={compiledPictureSource.source}
            activeFigureId={compiledPictureSource.activeFigureId}
            onClose={() => setCompiledPictureSource(null)}
            latex={platform.latex}
            showOpenInNewTab={!platform.id.startsWith("desktop")}
            showLogToggle={platform.id.startsWith("desktop")}
          />
        </Suspense>
      ) : null}
      {showSettingsModal ? (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setShowSettingsModal(false)} />
        </Suspense>
      ) : null}
      {equationModalState ? (
        <Suspense fallback={null}>
          <EquationModal
            mode={equationModalState.mode}
            initialLatex={equationModalState.mode === "edit" ? equationModalState.target.latex : insertEquationDraft}
            onValueChange={(latex) => {
              if (equationModalState.mode === "insert") {
                setInsertEquationDraft(latex);
              }
            }}
            onClose={() => setEquationModalState(null)}
            onConfirm={(latex) => {
              if (equationModalState.mode === "insert") {
                const text = formatEquationText(latex, "inline-dollar");
                dispatch({
                  type: "APPLY_EDIT_ACTION",
                  action: {
                    kind: "addElement",
                    template: {
                      kind: "node",
                      text
                    },
                    at: { x: 0, y: 0 }
                  }
                });
                setInsertEquationDraft("");
                setEquationModalState(null);
                return;
              }

              dispatch({
                type: "APPLY_EDIT_ACTION",
                action: {
                  kind: "updateNodeText",
                  elementId: equationModalState.target.sourceId,
                  text: formatEquationText(latex, equationModalState.target.delimiter)
                }
              });
              setEquationModalState(null);
            }}
          />
        </Suspense>
      ) : null}
      {repeatModalState ? (
        <Suspense fallback={null}>
          <RepeatModal
            columns={repeatModalState.columns}
            rows={repeatModalState.rows}
            horizontalStepCm={repeatModalState.horizontalStepPt / PT_PER_CM}
            verticalStepCm={repeatModalState.verticalStepPt / PT_PER_CM}
            horizontalGapCm={(repeatModalState.horizontalStepPt - repeatModalState.selectionWidthPt) / PT_PER_CM}
            verticalGapCm={(repeatModalState.verticalStepPt - repeatModalState.selectionHeightPt) / PT_PER_CM}
            selectionWidthCm={repeatModalState.selectionWidthPt / PT_PER_CM}
            selectionHeightCm={repeatModalState.selectionHeightPt / PT_PER_CM}
            onColumnsChange={(columns) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                columns: clampRepeatCount(columns)
              });
            }}
            onRowsChange={(rows) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                rows: clampRepeatCount(rows)
              });
            }}
            onHorizontalStepChange={(horizontalStepCm) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                horizontalStepPt: numericInputToPt(horizontalStepCm)
              });
            }}
            onVerticalStepChange={(verticalStepCm) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                verticalStepPt: numericInputToPt(verticalStepCm)
              });
            }}
            onClose={() => {
              setRepeatModalState(null);
              setRepeatPreviewModel(null);
            }}
            onConfirm={() => {
              const action = {
                kind: "repeatElements" as const,
                elementIds: repeatModalState.selectedSourceIds,
                columns: repeatModalState.columns,
                rows: repeatModalState.rows,
                horizontalStep: repeatModalState.horizontalStepPt,
                verticalStep: repeatModalState.verticalStepPt
              };
              const precomputedResult = applyEditAction(repeatModalState.source, [], action, {
                parseOptions: repeatModalState.activeFigureId == null ? {} : { activeFigureId: repeatModalState.activeFigureId }
              });
              if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
                return;
              }
              dispatch({
                type: "APPLY_EDIT_ACTION",
                action,
                precomputedResult
              });
              setRepeatModalState(null);
              setRepeatPreviewModel(null);
            }}
          />
        </Suspense>
      ) : null}
      {svgExportSvgResult ? (
        <Suspense fallback={null}>
          <SvgExportModal
            svgResult={svgExportSvgResult}
            onClose={() => setSvgExportSvgResult(null)}
          />
        </Suspense>
      ) : null}
      {pngExportSvgResult ? (
        <Suspense fallback={null}>
          <PngExportModal
            svgResult={pngExportSvgResult}
            onClose={() => setPngExportSvgResult(null)}
          />
        </Suspense>
      ) : null}
      {pendingClose ? (
        <Suspense fallback={null}>
          <UnsavedChangesModal
            documentTitles={pendingClose.dirtyDocumentIds.map((id) => documents[id]?.title ?? "Untitled")}
            onChoose={(decision) => {
              void handleUnsavedDecision(decision);
            }}
          />
        </Suspense>
      ) : null}
      {isDragOver ? (
        <div className={css.dropOverlay}>Drop to open</div>
      ) : null}
    </div>
  );
}

function resolveRepeatModalState(input: {
  source: string;
  activeFigureId: string | null;
  selectedElementIds: ReadonlySet<string>;
  scene: SceneFigure | null;
  documentId: string;
}): RepeatModalState | null {
  if (!input.scene) {
    return null;
  }
  const selectedSourceIds = [...input.selectedElementIds];
  const eligibility = getRepeatSelectionEligibility(
    input.source,
    selectedSourceIds,
    input.activeFigureId == null ? {} : { activeFigureId: input.activeFigureId }
  );
  if (eligibility.kind !== "eligible") {
    return null;
  }

  const boundsBySource = collectSourceWorldBounds(input.scene.elements);
  let selectionBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const ref of eligibility.refs) {
    const bounds = boundsBySource.get(ref.id);
    if (!bounds) {
      continue;
    }
    selectionBounds = selectionBounds == null
      ? { ...bounds }
      : {
          minX: Math.min(selectionBounds.minX, bounds.minX),
          minY: Math.min(selectionBounds.minY, bounds.minY),
          maxX: Math.max(selectionBounds.maxX, bounds.maxX),
          maxY: Math.max(selectionBounds.maxY, bounds.maxY)
        };
  }
  if (!selectionBounds) {
    return null;
  }

  const selectionWidthPt = Math.max(0, selectionBounds.maxX - selectionBounds.minX);
  const selectionHeightPt = Math.max(0, selectionBounds.maxY - selectionBounds.minY);
  return {
    documentId: input.documentId,
    source: input.source,
    activeFigureId: input.activeFigureId,
    selectedSourceIds: eligibility.refs.map((ref) => ref.id),
    selectionWidthPt,
    selectionHeightPt,
    columns: 2,
    rows: 1,
    horizontalStepPt: selectionWidthPt,
    verticalStepPt: selectionHeightPt
  };
}

function clampRepeatCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function numericInputToPt(valueCm: number): number {
  if (!Number.isFinite(valueCm)) {
    return 0;
  }
  return valueCm * PT_PER_CM;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}
