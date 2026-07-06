import { RiArrowDownSLine, RiAspectRatioLine, RiGridLine } from "@remixicon/react";
import { useEditorStore } from "../store/store";
import type { CanvasDragKind, ToolMode } from "../store/types";
import { getModifierKeyLabels, type ModifierKeyLabels } from "./key-labels";
import { useFrameTimingStats } from "./useFrameTimingStats";
import { RenderedTooltip } from "./RenderedTooltip";
import css from "./StatusBar.module.css";

const TEX_PT_PER_IN = 72.27;
const CSS_SCREEN_DPI = 96;
// Canvas transforms use CSS pixels, whose reference inch is 96 px.
const ACTUAL_SIZE_SCALE = CSS_SCREEN_DPI / TEX_PT_PER_IN;
const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;
const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 400;

export function StatusBar() {
  const snapshot = useEditorStore((s) => s.snapshot);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const currentDocument = useEditorStore((s) => s.documents[s.activeDocumentId] ?? null);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
  const canvasFitToContentScale = useEditorStore((s) => s.canvasFitToContentScale);
  const fitToContentModeActive = useEditorStore((s) => s.fitToContentModeActive);
  const showGrid = useEditorStore((s) => s.showGrid);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const pendingRequestId = useEditorStore((s) => s.pendingRequestId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const canvasStatusHint = useEditorStore((s) => s.canvasStatusHint);
  const dispatch = useEditorStore((s) => s.dispatch);

  const showPerf = import.meta.env.DEV;
  const perfStats = useFrameTimingStats(activeCanvasDragKind, showPerf);

  const parseResult = snapshot.parseResult;
  const semanticResult = snapshot.semanticResult;
  const incrementalInfo = snapshot.incremental;

  const parseDiags = parseResult?.diagnostics ?? [];
  const semanticDiags = semanticResult?.diagnostics ?? [];
  const allDiags = [...parseDiags, ...semanticDiags];
  const errorCount = allDiags.filter((d) => d.severity === "error").length;
  const warnCount = allDiags.filter((d) => d.severity === "warning").length;

  const elementCount = snapshot.scene?.elements.length ?? 0;
  const selectedCount = selectedIds.size;
  const figures = snapshot.figures;
  const activeFigureIndex = activeFigureId ? figures.findIndex((figure) => figure.id === activeFigureId) : -1;
  const showFigureContext = figures.length > 1 && activeFigureIndex >= 0;
  const zoomPercent = Math.round((canvasTransform.scale / ACTUAL_SIZE_SCALE) * 100);
  const fitToContentDoubleZoomPercent = canvasFitToContentScale == null
    ? MAX_ZOOM_PERCENT
    : Math.ceil((canvasFitToContentScale / ACTUAL_SIZE_SCALE) * 200);
  const maxZoomPercent = Math.max(MAX_ZOOM_PERCENT, fitToContentDoubleZoomPercent, zoomPercent);
  const sliderZoomPercent = Math.max(MIN_ZOOM_PERCENT, Math.min(maxZoomPercent, zoomPercent));
  const zoomOptions = [...new Set([
    ...ZOOM_LEVELS.filter((level) => level <= maxZoomPercent),
    maxZoomPercent,
    zoomPercent
  ])].sort((left, right) => left - right);

  const requestZoomPercent = (percent: number) => {
    if (!Number.isFinite(percent)) {
      return;
    }
    dispatch({ type: "REQUEST_ZOOM_SCALE", scale: (percent / 100) * ACTUAL_SIZE_SCALE });
  };
  const toggleFitToContent = () => {
    if (fitToContentModeActive) {
      dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
      return;
    }
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
  };

  const perfClassName =
    perfStats.maxFrameMs != null && perfStats.maxFrameMs >= 40
      ? css.error
      : perfStats.p95FrameMs != null && perfStats.p95FrameMs >= 20
        ? css.warning
        : css.ok;
  const perfSummary = perfStats.frameCount === 0
    ? "warming…"
    : `${formatPerf(perfStats.fps, 0)} fps · p95 ${formatPerf(perfStats.p95FrameMs)} ms · max ${formatPerf(perfStats.maxFrameMs)} ms`;
  const dragSummary = perfStats.dragFrameCount > 0
    ? ` · drag max ${formatPerf(perfStats.dragMaxFrameMs)} ms${activeCanvasDragKind ? ` (${activeCanvasDragKind})` : ""}`
    : "";
  const showIncrementalFallback =
    showPerf &&
    incrementalInfo != null &&
    (
      (incrementalInfo.parseStrategy === "full" &&
        incrementalInfo.parseFallbackReason !== undefined &&
        incrementalInfo.parseFallbackReason !== "no-previous-cache") ||
      (incrementalInfo.strategy === "full" &&
        incrementalInfo.fallbackReason !== "no-previous-cache")
    );
  const incrementalFallbackClass =
    incrementalInfo?.parseFallbackReason === "runtime-error" ||
    incrementalInfo?.fallbackReason === "runtime-error" ||
    incrementalInfo?.fallbackReason === "restore-failed"
      ? css.error
      : css.warning;
  const incrementalFallbackReason = [
    incrementalInfo?.parseStrategy === "full" && incrementalInfo.parseFallbackReason
      ? `parser ${incrementalInfo.parseFallbackReason}`
      : null,
    incrementalInfo?.strategy === "full" && incrementalInfo.fallbackReason
      ? `semantic ${incrementalInfo.fallbackReason}`
      : null
  ].filter(Boolean).join(" + ") || "unknown";
  const modifierHint = resolveModifierHint(
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    toolMode,
    getModifierKeyLabels()
  );

  return (
    <div className={css.bar} data-testid="status-bar" data-select="chrome">
      <div className={css.group}>
        {showFigureContext && (
          <div className={css.cell}>
            <span>Figure {activeFigureIndex + 1} of {figures.length}</span>
          </div>
        )}

        <div className={css.cell}>
          <span>{elementCount} object{elementCount === 1 ? "" : "s"}</span>
        </div>

        {selectedCount > 0 && (
          <div className={css.cell}>
            <span>{selectedCount} selected</span>
          </div>
        )}

        {showPerf && (
          <div className={css.cell}>
            <span className={css.label}>Perf:</span>
            <span className={perfClassName}>
              {perfSummary}
              {dragSummary}
            </span>
          </div>
        )}

        {showIncrementalFallback && (
          <div className={css.cell}>
            <span className={css.label}>Inc:</span>
            <span className={incrementalFallbackClass}>
              fallback ({incrementalFallbackReason})
            </span>
          </div>
        )}

        {canvasStatusHint && (
          <div className={css.cell}>
            <span className={css.hint}>{canvasStatusHint}</span>
          </div>
        )}

        {modifierHint && (
          <div className={css.cell}>
            <span className={css.label}>Modifiers:</span>
            <span className={css.hint}>{modifierHint}</span>
          </div>
        )}
      </div>

      <div className={css.spacer} />

      <div className={css.group}>
        {currentDocument?.dirty && (
          <div className={css.cell}>
            <span>Unsaved</span>
          </div>
        )}

        {currentDocument?.externalChangeStatus && currentDocument.externalChangeStatus !== "none" ? (
          <div className={css.cell}>
            <span className={css.warning}>
              {currentDocument.externalChangeStatus === "changed"
                ? "Changed on disk"
                : currentDocument.externalChangeStatus === "missing"
                  ? "File missing"
                  : currentDocument.externalChangeStatus === "permission-needed"
                    ? "File permission needed"
                    : "File sync error"}
            </span>
          </div>
        ) : null}

        {pendingRequestId && (
          <div className={css.cell}>
            <span>Computing...</span>
          </div>
        )}

        {errorCount > 0 && (
          <div className={css.cell}>
            <span className={css.error}>{errorCount} error{errorCount !== 1 ? "s" : ""}</span>
          </div>
        )}

        {warnCount > 0 && (
          <div className={css.cell}>
            <span className={css.warning}>{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>
          </div>
        )}

        <RenderedTooltip content={showGrid ? "Hide grid" : "Show grid"}>
          <button
            type="button"
            className={[css.iconButton, showGrid ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
            aria-label={showGrid ? "Hide grid" : "Show grid"}
            aria-pressed={showGrid}
            onClick={() => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" }); }}
          >
            <RiGridLine size={15} aria-hidden="true" />
          </button>
        </RenderedTooltip>

        <RenderedTooltip content="Fit to content">
          <button
            type="button"
            className={[css.iconButton, fitToContentModeActive ? css.iconButtonActive : ""].filter(Boolean).join(" ")}
            aria-label="Fit to content"
            aria-pressed={fitToContentModeActive}
            onClick={toggleFitToContent}
          >
            <RiAspectRatioLine size={15} aria-hidden="true" />
          </button>
        </RenderedTooltip>

        <input
          className={css.zoomSlider}
          type="range"
          min={MIN_ZOOM_PERCENT}
          max={maxZoomPercent}
          step={1}
          value={sliderZoomPercent}
          aria-label="Zoom"
          onChange={(event) => { requestZoomPercent(Number(event.currentTarget.value)); }}
        />

        <span className={css.zoomSelectWrap}>
          <select
            className={css.zoomSelect}
            value={String(zoomPercent)}
            aria-label="Zoom percentage"
            onChange={(event) => { requestZoomPercent(Number(event.currentTarget.value)); }}
          >
            {zoomOptions.map((level) => (
              <option key={level} value={level}>{level}%</option>
            ))}
          </select>
          <RiArrowDownSLine className={css.zoomSelectCaret} size={14} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function formatPerf(value: number | null, digits = 1): string {
  return value == null ? "—" : value.toFixed(digits);
}

function resolveModifierHint(
  activeCanvasDragKind: CanvasDragKind | null,
  activeSourceScrubSourceId: string | null,
  toolMode: ToolMode,
  keys: ModifierKeyLabels
): string | null {
  if (activeSourceScrubSourceId) {
    return `${keys.shift} adjust numbers more slowly · ${keys.alt} adjust numbers faster`;
  }

  switch (activeCanvasDragKind) {
    case "rotate":
      return `${keys.shift} snap to 15° increments · ${keys.primary} ignore snapping · ${keys.alt} rotate around center`;
    case "resize":
      return `${keys.shift} keep proportions`;
    case "element":
      return `${keys.primary} ignore snapping`;
    case "handle":
      return `${keys.primary} ignore snapping`;
    case "tool-create":
      return resolveToolCreateModifierHint(toolMode, keys);
    case "marquee":
      return `${keys.shift} or ${keys.primary} add to selection`;
    case "pan":
    case null:
      return null;
  }
}

function resolveToolCreateModifierHint(toolMode: ToolMode, keys: ModifierKeyLabels): string {
  const snapHint = `${keys.primary} ignore snapping`;
  switch (toolMode) {
    case "addRect":
      return `${keys.shift} draw a square · ${snapHint}`;
    case "addEllipse":
      return `${keys.shift} draw a circle · ${snapHint}`;
    case "addGrid":
      return `${keys.shift} draw a square grid · ${snapHint}`;
    case "select":
    case "magnify":
    case "addBucket":
    case "addNode":
    case "addMatrix":
    case "addShape":
    case "addPath":
    case "addFreehand":
    case "addLine":
    case "addCircle":
    case "addArrow":
    case "addBezier":
      return snapHint;
  }
}
