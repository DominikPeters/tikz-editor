import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import { px, viewportPoint } from "tikz-editor/coords/index";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";

import { APP_MENU_COMMAND_IDS } from "../../app-menu";
import type { CommandBindings } from "../editor-command-runtime";
import { buildCanvasContextMenuDefinition, type CanvasContextMenuTarget } from "../../context-menu";
import type { getActiveEditorPlatform } from "../../platform/current";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { resolveEquationNodeTarget } from "../equation-utils";
import type { ClientPoint, WorldPoint } from "../coords/types";
import { resolveFocusedScopeIdForSelection, type ScopeOverlayIndex } from "./scope-overlay";
import { resolveCanvasContextMenuTarget } from "./context-menu-target";
import { viewportToWorldPoint } from "./geometry";
import {
  isPathContextMenuSource,
  resolveNodePositioningContextMenuAction,
  type NodePositioningContextMenuAction
} from "./node-positioning-context-action";
import type { CanvasContextMenuState, CanvasDispatch, CanvasEditParseOptions, CanvasSnapshot } from "./types";

type PendingNativeContextMenuRequest = {
  clientPoint: ClientPoint;
  clickedSourceId: string;
  clickedHandleId: string | null;
};

type CanvasPlatform = ReturnType<typeof getActiveEditorPlatform>;

type MatrixMultiContextMenuOptions = {
  includeMatrixMultiRemoveRow: boolean;
  includeMatrixMultiRemoveColumn: boolean;
  includeMatrixMultiInsertRowAbove: boolean;
  includeMatrixMultiInsertRowBelow: boolean;
  includeMatrixMultiInsertColumnLeft: boolean;
  includeMatrixMultiInsertColumnRight: boolean;
};

export type CanvasContextMenuContext = {
  clickedTargetId: string | null;
  clickedWorld: WorldPoint | null;
};

export type CanvasContextMenuRuntimeState = {
  contextMenuState: CanvasContextMenuState | null;
  setContextMenuState: Dispatch<SetStateAction<CanvasContextMenuState | null>>;
  pendingNativeContextMenuRequest: PendingNativeContextMenuRequest | null;
  setPendingNativeContextMenuRequest: Dispatch<SetStateAction<PendingNativeContextMenuRequest | null>>;
  contextMenuContextRef: MutableRefObject<CanvasContextMenuContext>;
  contextMenuHandleIdOverride: string | null | undefined;
};

export function useCanvasContextMenuState(): CanvasContextMenuRuntimeState {
  const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null);
  const [pendingNativeContextMenuRequest, setPendingNativeContextMenuRequest] =
    useState<PendingNativeContextMenuRequest | null>(null);
  const contextMenuContextRef = useRef<CanvasContextMenuContext>({
    clickedTargetId: null,
    clickedWorld: null
  });
  const contextMenuHandleIdOverride =
    pendingNativeContextMenuRequest?.clickedHandleId ?? contextMenuState?.handleIdOverride;

  return useMemo(
    () => ({
      contextMenuState,
      setContextMenuState,
      pendingNativeContextMenuRequest,
      setPendingNativeContextMenuRequest,
      contextMenuContextRef,
      contextMenuHandleIdOverride
    }),
    [contextMenuHandleIdOverride, contextMenuState, pendingNativeContextMenuRequest]
  );
}

export type UseCanvasContextMenuControllerArgs = {
  state: CanvasContextMenuRuntimeState;
  platform: CanvasPlatform;
  commandBindings: CommandBindings;
  source: string;
  snapshot: CanvasSnapshot;
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  focusedScopeId: string | null;
  scopeOverlay: ScopeOverlayIndex;
  svgResult: { viewBox: { x: number; y: number; width: number; height: number } } | null;
  canvasTransform: CanvasTransform;
  editParseOptions: CanvasEditParseOptions;
  viewportRef: RefObject<HTMLDivElement | null>;
  dispatch: CanvasDispatch;
};

export function useCanvasContextMenuController({
  state,
  platform,
  commandBindings,
  source,
  snapshot,
  toolMode,
  selectedElementIds,
  focusedScopeId,
  scopeOverlay,
  svgResult,
  canvasTransform,
  editParseOptions,
  viewportRef,
  dispatch
}: UseCanvasContextMenuControllerArgs): {
  openCanvasContextMenuAt: (clientPoint: ClientPoint, clickedSourceId: string | null, clickedHandleId?: string | null) => void;
} {
  const pendingNativeContextMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNativeContextMenu = useCallback(
    (
      target: CanvasContextMenuTarget,
      options: {
        includeEditEquationForSingleNode?: boolean;
        nodePositioningAction?: NodePositioningContextMenuAction | null;
        includePathSubmenuForSingleSelection?: boolean;
        includeFlattenForeach?: boolean;
        includeMatrixMultiRemoveRow?: boolean;
        includeMatrixMultiRemoveColumn?: boolean;
        includeMatrixMultiInsertRowAbove?: boolean;
        includeMatrixMultiInsertRowBelow?: boolean;
        includeMatrixMultiInsertColumnLeft?: boolean;
        includeMatrixMultiInsertColumnRight?: boolean;
      } = {}
    ) => {
      const definition = buildCanvasContextMenuDefinition({
        includeEditEquationForSingleNode: options.includeEditEquationForSingleNode,
        nodePositioningAction: options.nodePositioningAction,
        includePathSubmenuForSingleSelection: options.includePathSubmenuForSingleSelection,
        includeFlattenForeach: options.includeFlattenForeach,
        includeMatrixMultiRemoveRow: options.includeMatrixMultiRemoveRow,
        includeMatrixMultiRemoveColumn: options.includeMatrixMultiRemoveColumn,
        includeMatrixMultiInsertRowAbove: options.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: options.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiInsertColumnLeft: options.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: options.includeMatrixMultiInsertColumnRight
      });
      void platform.menu?.showNativeContextMenu?.({
        items: definition[target],
        commandStates: commandBindings,
        onCommandRun: (commandId, origin) => {
          const binding = commandBindings[commandId];
          if (!binding?.enabled) {
            return;
          }
          void binding.run(origin);
        }
      });
    },
    [commandBindings, platform.menu]
  );

  const resolveIncludeEditEquationForSingleNode = useCallback(
    (target: CanvasContextMenuTarget, sourceId: string | null): boolean => {
      if ((target !== "selection-single-node" && target !== "selection-single-node-tree") || !sourceId) {
        return false;
      }
      return resolveEquationNodeTarget(source, sourceId, editParseOptions) != null;
    },
    [editParseOptions, source]
  );

  const resolveNodePositioningAction = useCallback(
    (target: CanvasContextMenuTarget, sourceId: string | null): NodePositioningContextMenuAction | null => {
      if (target !== "selection-single-node") {
        return null;
      }
      return resolveNodePositioningContextMenuAction({
        source,
        sourceId,
        snapshot,
        parseOptions: editParseOptions
      });
    },
    [editParseOptions, snapshot, source]
  );

  const resolveIncludePathSubmenuForSingleSelection = useCallback(
    (target: CanvasContextMenuTarget, sourceId: string | null): boolean => {
      if (target === "selection-single-path-point" || target === "selection-single-path-point-tree") {
        return true;
      }
      if (target !== "selection-single" && target !== "selection-single-tree") {
        return false;
      }
      return isPathContextMenuSource({
        source,
        sourceId,
        snapshot,
        parseOptions: editParseOptions
      });
    },
    [editParseOptions, snapshot, source]
  );

  const resolveMatrixMultiContextMenuOptions = useCallback(
    (target: CanvasContextMenuTarget, sourceIds: ReadonlySet<string>): MatrixMultiContextMenuOptions => {
      if (target !== "selection-multi") {
        return emptyMatrixMultiContextMenuOptions();
      }

      let matrixSourceId: string | null = null;
      let row: number | null = null;
      let column: number | null = null;

      for (const sourceId of sourceIds) {
        const resolved = resolvePropertyTarget(source, sourceId, editParseOptions);
        if (resolved.kind !== "found" || resolved.target.kind !== "matrix-cell") {
          return emptyMatrixMultiContextMenuOptions();
        }
        const currentMatrixSourceId = resolved.target.matrixSourceId?.trim() ?? "";
        const currentRow = resolved.target.row ?? 0;
        const currentColumn = resolved.target.column ?? 0;
        if (!currentMatrixSourceId || currentRow <= 0 || currentColumn <= 0) {
          return emptyMatrixMultiContextMenuOptions();
        }
        if (matrixSourceId == null) {
          matrixSourceId = currentMatrixSourceId;
          row = currentRow;
          column = currentColumn;
          continue;
        }
        if (matrixSourceId !== currentMatrixSourceId) {
          return emptyMatrixMultiContextMenuOptions();
        }
        if (row !== null && row !== currentRow) {
          row = null;
        }
        if (column !== null && column !== currentColumn) {
          column = null;
        }
      }

      return {
        includeMatrixMultiInsertRowAbove: row != null,
        includeMatrixMultiInsertRowBelow: row != null,
        includeMatrixMultiRemoveRow: row != null,
        includeMatrixMultiInsertColumnLeft: column != null,
        includeMatrixMultiInsertColumnRight: column != null,
        includeMatrixMultiRemoveColumn: column != null
      };
    },
    [editParseOptions, source]
  );

  useEffect(() => {
    const pendingNativeContextMenuRequest = state.pendingNativeContextMenuRequest;
    if (!platform.menu?.usesNativeContextMenus || !pendingNativeContextMenuRequest) {
      return;
    }
    if (!selectedElementIds.has(pendingNativeContextMenuRequest.clickedSourceId)) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const resolution = resolveCanvasContextMenuTarget({
      source,
      toolMode,
      clickedSourceId: pendingNativeContextMenuRequest.clickedSourceId,
      selectedElementIds,
      parseOptions: editParseOptions
    });

    state.contextMenuContextRef.current = {
      clickedTargetId: pendingNativeContextMenuRequest.clickedSourceId,
      clickedWorld:
        svgResult
          ? viewportToWorldPoint(
              viewportPointFromClient(pendingNativeContextMenuRequest.clientPoint, viewportRef.current),
              canvasTransform,
              svgResult.viewBox
            )
          : null
    };

    if (pendingNativeContextMenuTimeoutRef.current) {
      clearTimeout(pendingNativeContextMenuTimeoutRef.current);
    }
    dispatch({ type: "SET_ACTIVE_HANDLE", handleId: pendingNativeContextMenuRequest.clickedHandleId });

    const nativeEffectiveTarget =
      pendingNativeContextMenuRequest.clickedHandleId
      && (resolution.target === "selection-single" || resolution.target === "selection-single-tree")
        ? (resolution.target === "selection-single-tree"
            ? "selection-single-path-point-tree"
            : "selection-single-path-point") as CanvasContextMenuTarget
        : resolution.target;
    const includeEditEquationForSingleNode = resolveIncludeEditEquationForSingleNode(
      nativeEffectiveTarget,
      pendingNativeContextMenuRequest.clickedSourceId
    );
    const nodePositioningAction = resolveNodePositioningAction(
      nativeEffectiveTarget,
      pendingNativeContextMenuRequest.clickedSourceId
    );
    const includePathSubmenuForSingleSelection = resolveIncludePathSubmenuForSingleSelection(
      nativeEffectiveTarget,
      pendingNativeContextMenuRequest.clickedSourceId
    );
    const includeFlattenForeach = commandBindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH].enabled;
    const matrixMultiOptions = resolveMatrixMultiContextMenuOptions(nativeEffectiveTarget, selectedElementIds);

    pendingNativeContextMenuTimeoutRef.current = setTimeout(() => {
      pendingNativeContextMenuTimeoutRef.current = null;
      showNativeContextMenu(nativeEffectiveTarget, {
        includeEditEquationForSingleNode,
        nodePositioningAction,
        includePathSubmenuForSingleSelection,
        includeFlattenForeach,
        includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
        includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn,
        includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight
      });
      state.setPendingNativeContextMenuRequest(null);
      viewport.focus({ preventScroll: true });
    }, 75);

    return () => {
      if (pendingNativeContextMenuTimeoutRef.current) {
        clearTimeout(pendingNativeContextMenuTimeoutRef.current);
        pendingNativeContextMenuTimeoutRef.current = null;
      }
    };
  }, [
    canvasTransform,
    commandBindings,
    dispatch,
    editParseOptions,
    platform.menu?.usesNativeContextMenus,
    resolveIncludeEditEquationForSingleNode,
    resolveIncludePathSubmenuForSingleSelection,
    resolveMatrixMultiContextMenuOptions,
    resolveNodePositioningAction,
    selectedElementIds,
    showNativeContextMenu,
    source,
    state,
    svgResult,
    toolMode,
    viewportRef
  ]);

  const openCanvasContextMenuAt = useCallback(
    (clientPoint: ClientPoint, clickedSourceId: string | null, clickedHandleId: string | null = null) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const resolution = resolveCanvasContextMenuTarget({
        source,
        toolMode,
        clickedSourceId,
        selectedElementIds,
        parseOptions: editParseOptions
      });

      if (resolution.selectionAction.kind === "clear") {
        if (selectedElementIds.size > 0 || focusedScopeId != null) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        if (clickedHandleId != null) {
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        }
      } else if (resolution.selectionAction.kind === "select-only") {
        if (platform.menu?.usesNativeContextMenus) {
          state.setPendingNativeContextMenuRequest({
            clientPoint,
            clickedSourceId: resolution.selectionAction.sourceId,
            clickedHandleId
          });
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
          dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
          dispatch({
            type: "SET_FOCUSED_SCOPE",
            scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
        });
      } else {
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
      }

      state.contextMenuContextRef.current = {
        clickedTargetId: clickedSourceId,
        clickedWorld:
          svgResult
            ? viewportToWorldPoint(
                viewportPointFromClient(clientPoint, viewport),
                canvasTransform,
                svgResult.viewBox
              )
            : null
      };

      const effectiveTarget =
        clickedHandleId && (resolution.target === "selection-single" || resolution.target === "selection-single-tree")
          ? (resolution.target === "selection-single-tree"
              ? "selection-single-path-point-tree"
              : "selection-single-path-point") as CanvasContextMenuTarget
          : resolution.target;
      const equationSourceId = resolution.selectionAction.kind === "select-only"
        ? resolution.selectionAction.sourceId
        : clickedSourceId ?? (selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null);
      const includeEditEquationForSingleNode = resolveIncludeEditEquationForSingleNode(effectiveTarget, equationSourceId);
      const nodePositioningAction = resolveNodePositioningAction(effectiveTarget, equationSourceId);
      const includePathSubmenuForSingleSelection = resolveIncludePathSubmenuForSingleSelection(effectiveTarget, equationSourceId);
      const includeFlattenForeach = commandBindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH].enabled;
      const matrixMultiOptions = resolveMatrixMultiContextMenuOptions(effectiveTarget, selectedElementIds);

      const nextContextMenuState: CanvasContextMenuState = {
        target: effectiveTarget,
        anchor: viewportPointFromClient(clientPoint, viewport),
        handleIdOverride: clickedHandleId,
        includeEditEquationForSingleNode,
        nodePositioningAction,
        includePathSubmenuForSingleSelection,
        includeFlattenForeach,
        includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
        includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight,
        includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn
      };

      if (platform.menu?.usesNativeContextMenus) {
        if (clickedHandleId && clickedSourceId) {
          state.setPendingNativeContextMenuRequest({
            clientPoint,
            clickedSourceId,
            clickedHandleId
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        showNativeContextMenu(effectiveTarget, {
          includeEditEquationForSingleNode,
          nodePositioningAction,
          includePathSubmenuForSingleSelection,
          includeFlattenForeach,
          includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
          includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
          includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
          includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
          includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight,
          includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn
        });
        viewport.focus({ preventScroll: true });
        return;
      }

      state.setContextMenuState(nextContextMenuState);
      viewport.focus({ preventScroll: true });
    },
    [
      canvasTransform,
      commandBindings,
      dispatch,
      editParseOptions,
      focusedScopeId,
      platform.menu?.usesNativeContextMenus,
      resolveIncludeEditEquationForSingleNode,
      resolveIncludePathSubmenuForSingleSelection,
      resolveMatrixMultiContextMenuOptions,
      resolveNodePositioningAction,
      scopeOverlay,
      selectedElementIds,
      showNativeContextMenu,
      source,
      state,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  return { openCanvasContextMenuAt };
}

function emptyMatrixMultiContextMenuOptions(): MatrixMultiContextMenuOptions {
  return {
    includeMatrixMultiInsertRowAbove: false,
    includeMatrixMultiInsertRowBelow: false,
    includeMatrixMultiRemoveRow: false,
    includeMatrixMultiInsertColumnLeft: false,
    includeMatrixMultiInsertColumnRight: false,
    includeMatrixMultiRemoveColumn: false
  };
}

function viewportPointFromClient(clientPoint: ClientPoint, viewport: HTMLDivElement | null) {
  const rect = viewport?.getBoundingClientRect();
  return viewportPoint(
    px(rect ? clientPoint.x - rect.left : clientPoint.x),
    px(rect ? clientPoint.y - rect.top : clientPoint.y)
  );
}
