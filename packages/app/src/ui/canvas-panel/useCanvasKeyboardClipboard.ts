import {
  useCallback,
  type MutableRefObject,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { pt, worldPoint } from "tikz-editor/coords/index";
import { snapKeyboardNudge, type SnapLine } from "tikz-editor/edit/snapping";
import type { EditAction } from "tikz-editor/edit/actions";
import type { SceneElement } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { EditorPlatform } from "../../platform/types";
import type { ToolMode } from "../../store/types";
import type { WorldPoint } from "../coords/types";
import {
  canPasteSelection,
  copySelection,
  copySelectionToClipboardData,
  cutSelection,
  cutSelectionToClipboardData,
  deleteSelection,
  pasteSelectionFromPayload,
  pasteSelectionFromClipboardData,
  pasteSnippetsWithOffset
} from "../editor-commands";
import { parseClipboardPayloadJson } from "../editor-clipboard";
import {
  buildScopeWrappedSnippet,
  convertKeynoteClipboardToScopeSnippet,
  convertPowerPointClipboardToScopeSnippet,
  convertSvgToScopeSnippet,
  dataTransferHasFilePayload,
  findSvgFileInDataTransfer
} from "../svg-import";
import { selectNudgeAnchorHandle } from "./panel-helpers";
import type {
  ApplyActionWithFeedbackFn,
  CanvasContextMenuState,
  CanvasDispatch,
  CanvasSnapshot,
  DragState,
  FreehandToolDraft,
  PendingBezier,
  SnapDebugLogInput,
  StateSetter,
  TextEditingSession,
  ValueSetter
} from "./types";

export type UseCanvasKeyboardClipboardArgs = {
  contextMenuState: CanvasContextMenuState | null;
  setContextMenuState: StateSetter<CanvasContextMenuState | null>;
  toolMode: ToolMode;
  finalizePathDraft: (closed: boolean) => void;
  undoPathDraftSegment: () => boolean;
  setWarning: StateSetter<string | null>;
  setFreehandDraft: StateSetter<FreehandToolDraft | null>;
  dragRef: MutableRefObject<DragState | null>;
  setDragState: ValueSetter<DragState | null>;
  dispatch: CanvasDispatch;
  setToolCursorWorld: StateSetter<WorldPoint | null>;
  setSnapLines: StateSetter<SnapLine[]>;
  setToolDraft: StateSetter<Extract<DragState, { kind: "tool-create" }> | null>;
  setBezierBendDraft: StateSetter<Extract<DragState, { kind: "tool-bezier-bend" }> | null>;
  setPendingBezier: StateSetter<PendingBezier | null>;
  textEditingSession: TextEditingSession | null;
  closeTextEditingSession: () => void;
  setMarqueeDraft: StateSetter<Extract<DragState, { kind: "marquee" }> | null>;
  selectedElementIds: ReadonlySet<string>;
  applyActionWithFeedback: ApplyActionWithFeedbackFn;
  snapshot: CanvasSnapshot;
  source: string;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  NUDGE_STEP_PT: number;
  NUDGE_STEP_SHIFT_PT: number;
  platform: EditorPlatform;
  DESKTOP_TIKZ_CLIPBOARD_FORMATS: readonly string[];
  DESKTOP_SVG_CLIPBOARD_FORMATS: readonly string[];
  DESKTOP_KEYNOTE_CLIPBOARD_FORMATS: readonly string[];
  DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS: readonly string[];
  computeAutoScaleForImportedTikz: (
    importedTikzSource: string,
    currentScene: { elements: SceneElement[] } | null,
    currentViewBox: SvgViewBox | null
  ) => number | null;
};

function logClipboardImportDebug(message: string, error: unknown): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  console.info(`[tikz-editor] ${message}`, error);
}

function decodeBase64Bytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  if (typeof atob !== "function") {
    throw new Error("No base64 decoder available in this environment.");
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") {
    return false;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function isEditableClipboardTarget(target: EventTarget | null): boolean {
  if (isEditableElement(target)) {
    return true;
  }
  if (typeof document === "undefined") {
    return false;
  }
  return isEditableElement(document.activeElement);
}

export function useCanvasKeyboardClipboard(args: UseCanvasKeyboardClipboardArgs) {
  const {
    contextMenuState,
    setContextMenuState,
    toolMode,
    finalizePathDraft,
    undoPathDraftSegment,
    setWarning,
    setFreehandDraft,
    dragRef,
    setDragState,
    dispatch,
    setToolCursorWorld,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    textEditingSession,
    closeTextEditingSession,
    setMarqueeDraft,
    selectedElementIds,
    applyActionWithFeedback,
    snapshot,
    source,
    logSnapDebug,
    NUDGE_STEP_PT,
    NUDGE_STEP_SHIFT_PT,
    platform,
    DESKTOP_TIKZ_CLIPBOARD_FORMATS,
    DESKTOP_SVG_CLIPBOARD_FORMATS,
    DESKTOP_KEYNOTE_CLIPBOARD_FORMATS,
    DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS,
    computeAutoScaleForImportedTikz
  } = args;

  const onViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (event.key === "Escape" && contextMenuState) {
        setContextMenuState(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Escape") {
        if (toolMode === "addPath") {
          finalizePathDraft(false);
          setWarning(null);
          event.preventDefault();
          return;
        }
        if (toolMode === "addFreehand") {
          setFreehandDraft(null);
          if (dragRef.current?.kind === "tool-freehand") {
            setDragState(null);
          }
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
          setWarning(null);
          setSnapLines([]);
          event.preventDefault();
          return;
        }

        if (toolMode !== "select") {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolDraft(null);
          setBezierBendDraft(null);
          setPendingBezier(null);
          setToolCursorWorld(null);
        } else if (textEditingSession) {
          closeTextEditingSession();
          event.preventDefault();
          return;
        }
        setMarqueeDraft(null);
        if (
          dragRef.current?.kind === "marquee" ||
          dragRef.current?.kind === "tool-create" ||
          dragRef.current?.kind === "tool-bezier-bend" ||
          dragRef.current?.kind === "tool-path-segment" ||
          dragRef.current?.kind === "tool-freehand"
        ) {
          setDragState(null);
        }
        dispatch({ type: "CLEAR_SELECTION" });
        setWarning(null);
        setSnapLines([]);
        event.preventDefault();
        return;
      }

      if (event.key === "Enter" && toolMode === "addPath") {
        finalizePathDraft(false);
        setWarning(null);
        event.preventDefault();
        return;
      }

      if (
        toolMode === "addPath" &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "z" &&
        undoPathDraftSegment()
      ) {
        setWarning(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedElementIds.size > 0) {
        const didDelete = deleteSelection({
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        });
        if (didDelete) {
          event.preventDefault();
        }
        return;
      }

      let axis: "x" | "y" | null = null;
      let direction: -1 | 1 = 1;
      const step = event.shiftKey ? NUDGE_STEP_SHIFT_PT : NUDGE_STEP_PT;
      if (event.key === "ArrowLeft") {
        axis = "x";
        direction = -1;
      }
      if (event.key === "ArrowRight") {
        axis = "x";
        direction = 1;
      }
      if (event.key === "ArrowUp") {
        axis = "y";
        direction = 1;
      }
      if (event.key === "ArrowDown") {
        axis = "y";
        direction = -1;
      }

      if (!axis) return;

      const selectedIds = [...selectedElementIds];
      if (selectedIds.length === 0) return;

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before nudging again.");
        logSnapDebug({
          phase: "keyboard-nudge",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: null,
          rawDelta: axis === "x" ? worldPoint(pt(direction * step), pt(0)) : worldPoint(pt(0), pt(direction * step)),
          lines: []
        });
        event.preventDefault();
        return;
      }

      const sceneElements = snapshot.scene?.elements ?? [];
      if (sceneElements.length === 0) {
        return;
      }

      const selectedSet = new Set(selectedIds);
      const elementHandles = snapshot.editHandles.filter((handle) => selectedSet.has(handle.sourceRef.sourceId));
      const anchorHandle = selectNudgeAnchorHandle(elementHandles);
      const snapped = snapKeyboardNudge({
        anchor: anchorHandle?.world ?? null,
        axis,
        direction,
        step
      });
      const delta = snapped.snappedDelta ??
        (axis === "x"
          ? worldPoint(pt(direction * step), pt(0))
          : worldPoint(pt(0), pt(direction * step)));

      const moveAction: EditAction =
        selectedIds.length === 1
          ? {
              kind: "moveElement",
              elementId: selectedIds[0],
              delta
            }
          : {
              kind: "moveElements",
              elementIds: selectedIds,
              delta
            };

      applyActionWithFeedback(moveAction);
      setSnapLines(snapped.lines);
      logSnapDebug({
        phase: "keyboard-nudge",
        snapshotMatchesSource: true,
        dragKind: null,
        rawDelta: axis === "x" ? worldPoint(pt(direction * step), pt(0)) : worldPoint(pt(0), pt(direction * step)),
        snappedDelta: delta,
        offset: snapped.offset,
        lines: snapped.lines
      });
      event.preventDefault();
    },
    [
      NUDGE_STEP_PT,
      NUDGE_STEP_SHIFT_PT,
      applyActionWithFeedback,
      contextMenuState,
      dispatch,
      dragRef,
      finalizePathDraft,
      logSnapDebug,
      selectedElementIds,
      setBezierBendDraft,
      setContextMenuState,
      setDragState,
      setFreehandDraft,
      setMarqueeDraft,
      setPendingBezier,
      setSnapLines,
      closeTextEditingSession,
      setToolCursorWorld,
      setToolDraft,
      setWarning,
      snapshot,
      source,
      textEditingSession,
      toolMode,
      undoPathDraftSegment
    ]
  );

  const onViewportPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      if (isEditableClipboardTarget(event.target)) {
        return;
      }
      const svgFile = findSvgFileInDataTransfer(event.clipboardData);
      if (svgFile) {
        event.preventDefault();
        void svgFile.text().then(async (svgSource) => {
          const converted = await convertSvgToScopeSnippet(svgSource);
          if (converted.kind === "failure") {
            setWarning(converted.message);
            return;
          }
          const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
          const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
          const pasted = pasteSnippetsWithOffset(
            {
              source,
              snapshotSource: snapshot.source,
              scene: snapshot.scene,
              editHandles: snapshot.editHandles,
              selectedElementIds,
              dispatch
            },
            [snippet]
          );
          if (!pasted) {
            setWarning("SVG import paste failed.");
          }
        });
        return;
      }
      event.preventDefault();
      const pasteContext = {
        source,
        snapshotSource: snapshot.source,
        scene: snapshot.scene,
        editHandles: snapshot.editHandles,
        selectedElementIds,
        dispatch
      };
      if (!canPasteSelection(pasteContext)) {
        return;
      }
      void (async () => {
        const readCustomText = platform.clipboard?.readCustomText;
        if (typeof readCustomText === "function") {
          try {
            const customTikz = await readCustomText(DESKTOP_TIKZ_CLIPBOARD_FORMATS);
            if (customTikz?.text?.trim()) {
              const payload = parseClipboardPayloadJson(customTikz.text);
              if (payload) {
                const result = pasteSelectionFromPayload(pasteContext, payload);
                if (result.kind === "success") {
                  return;
                }
              }
            }
          } catch (error) {
            // Fall through to existing dataTransfer/system fallback.
            logClipboardImportDebug("Desktop custom TikZ clipboard read failed; falling back to standard paste data.", error);
          }
        }

        const readCustomBytes = platform.clipboard?.readCustomBytes;
        if (typeof readCustomBytes === "function") {
          try {
            const custom = await readCustomBytes(DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS);
            if (custom?.bytesBase64?.trim()) {
              let decoded: Uint8Array;
              try {
                decoded = decodeBase64Bytes(custom.bytesBase64);
              } catch (error) {
                setWarning(`PowerPoint import failed: ${error instanceof Error ? error.message : String(error)}`);
                return;
              }
              const converted = await convertPowerPointClipboardToScopeSnippet(decoded);
              if (converted.kind === "failure") {
                setWarning(converted.message);
                return;
              }
              const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
              const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
              const pasted = pasteSnippetsWithOffset(
                {
                  source,
                  snapshotSource: snapshot.source,
                  scene: snapshot.scene,
                  editHandles: snapshot.editHandles,
                  selectedElementIds,
                  dispatch
                },
                [snippet]
              );
              if (!pasted) {
                setWarning("PowerPoint import paste failed.");
              }
              return;
            }
          } catch (error) {
            // Fall through to existing warning behavior.
            logClipboardImportDebug("PowerPoint clipboard import failed before conversion completed.", error);
          }
        }

        const result = pasteSelectionFromClipboardData(
          pasteContext,
          event.clipboardData
        );
        if (result.kind === "success") {
          return;
        }

        if (typeof readCustomText === "function") {
          try {
            const custom = await readCustomText(DESKTOP_SVG_CLIPBOARD_FORMATS);
            if (custom?.text?.trim()) {
              const converted = await convertSvgToScopeSnippet(custom.text);
              if (converted.kind === "failure") {
                setWarning(converted.message);
                return;
              }
              const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
              const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
              const pasted = pasteSnippetsWithOffset(
                {
                  source,
                  snapshotSource: snapshot.source,
                  scene: snapshot.scene,
                  editHandles: snapshot.editHandles,
                  selectedElementIds,
                  dispatch
                },
                [snippet]
              );
              if (!pasted) {
                setWarning("SVG import paste failed.");
              }
              return;
            }
          } catch (error) {
            // Fall through to existing warning behavior.
            logClipboardImportDebug("SVG clipboard import failed before conversion completed.", error);
          }
        }

        if (typeof readCustomText === "function") {
          try {
            const custom = await readCustomText(DESKTOP_KEYNOTE_CLIPBOARD_FORMATS);
            if (custom?.text?.trim()) {
              const converted = await convertKeynoteClipboardToScopeSnippet(custom.text);
              if (converted.kind === "failure") {
                setWarning(converted.message);
                return;
              }
              const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
              const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
              const pasted = pasteSnippetsWithOffset(
                {
                  source,
                  snapshotSource: snapshot.source,
                  scene: snapshot.scene,
                  editHandles: snapshot.editHandles,
                  selectedElementIds,
                  dispatch
                },
                [snippet]
              );
              if (!pasted) {
                setWarning("Keynote import paste failed.");
              }
              return;
            }
          } catch (error) {
            // Fall through to existing warning behavior.
            logClipboardImportDebug("Keynote clipboard import failed before conversion completed.", error);
          }
        }
        if (result.reason === "invalid") {
          setWarning("Clipboard did not contain a valid TikZ payload.");
          return;
        }
        if (result.reason === "empty") {
          return;
        }
        setWarning("Paste failed. Try copying again, then press Cmd/Ctrl+V while the canvas is focused.");
      })();
    },
    [
      DESKTOP_SVG_CLIPBOARD_FORMATS,
      DESKTOP_KEYNOTE_CLIPBOARD_FORMATS,
      DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS,
      DESKTOP_TIKZ_CLIPBOARD_FORMATS,
      computeAutoScaleForImportedTikz,
      dispatch,
      platform,
      selectedElementIds,
      setWarning,
      snapshot.editHandles,
      snapshot.scene,
      snapshot.source,
      snapshot.svg?.viewBox,
      source
    ]
  );

  const onViewportDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const hasFile = dataTransferHasFilePayload(event.dataTransfer);
      if (!hasFile) {
        return;
      }
      if (findSvgFileInDataTransfer(event.dataTransfer)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    []
  );

  const onViewportDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const hasFile = dataTransferHasFilePayload(event.dataTransfer);
      if (!hasFile) {
        return;
      }
      const svgFile = findSvgFileInDataTransfer(event.dataTransfer);
      if (!svgFile) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void svgFile.text().then(async (svgSource) => {
        const converted = await convertSvgToScopeSnippet(svgSource);
        if (converted.kind === "failure") {
          setWarning(converted.message);
          return;
        }
        const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
        const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
        const pasted = pasteSnippetsWithOffset(
          {
            source,
            snapshotSource: snapshot.source,
            scene: snapshot.scene,
            editHandles: snapshot.editHandles,
            selectedElementIds,
            dispatch
          },
          [snippet]
        );
        if (!pasted) {
          setWarning("SVG import drop failed.");
        }
      });
    },
    [dispatch, selectedElementIds, setWarning, snapshot.editHandles, snapshot.scene, snapshot.source, snapshot.svg?.viewBox, source, computeAutoScaleForImportedTikz]
  );

  const onViewportCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      if (isEditableClipboardTarget(event.target)) {
        return;
      }
      const supportsNativeClipboardBundle = typeof platform.clipboard?.writeBundle === "function";
      if (supportsNativeClipboardBundle) {
        event.preventDefault();
        void copySelection(
          {
            source,
            snapshotSource: snapshot.source,
            scene: snapshot.scene,
            editHandles: snapshot.editHandles,
            selectedElementIds,
            dispatch
          },
          { pasteBehavior: "offset" }
        );
        return;
      }
      const copied = copySelectionToClipboardData(
        {
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        },
        event.clipboardData,
        { pasteBehavior: "offset" }
      );
      if (!copied) {
        return;
      }
      event.preventDefault();
    },
    [dispatch, platform, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  const onViewportCut = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      if (isEditableClipboardTarget(event.target)) {
        return;
      }
      const supportsNativeClipboardBundle = typeof platform.clipboard?.writeBundle === "function";
      if (supportsNativeClipboardBundle) {
        event.preventDefault();
        void cutSelection(
          {
            source,
            snapshotSource: snapshot.source,
            scene: snapshot.scene,
            editHandles: snapshot.editHandles,
            selectedElementIds,
            dispatch
          }
        );
        return;
      }
      const cut = cutSelectionToClipboardData(
        {
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        },
        event.clipboardData
      );
      if (!cut) {
        return;
      }
      event.preventDefault();
    },
    [dispatch, platform, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  return {
    onViewportKeyDown,
    onViewportPaste,
    onViewportDragOver,
    onViewportDrop,
    onViewportCopy,
    onViewportCut
  };
}
