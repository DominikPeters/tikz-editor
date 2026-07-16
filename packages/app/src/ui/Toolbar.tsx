import { useEffect, useMemo, useState } from "react";
import { RiDownloadCloudLine } from "@remixicon/react";
import { useProjectNamedColorSwatches } from "../colors/project-named-colors";
import { useEditorStore } from "../store/store";
import { getActiveEditorPlatform } from "../platform/current";
import { NODE_SHAPE_OPTIONS } from "@tikz-editor/core/edit/inspector";
import { ColorPicker, cssColorForToken } from "./ColorPicker";
import { getToolCapabilityStatus } from "./capabilities";
import { RenderedTooltip } from "./RenderedTooltip";
import {
  resolveToolbarToolMode,
  TOOL_BUTTONS,
  TOOL_COLOR_OPTIONS,
  CaretDownIcon,
  type ToolPopupKind
} from "./tool-config";
import { GENERATED_NODE_SHAPE_PREVIEWS } from "./generated-node-shape-previews";
import { ToolbarToolPopup, ToolbarPopupSection, ToolbarPopupVisualChoiceGrid } from "./ToolbarToolPopup";
import popupCss from "./ToolbarToolPopup.module.css";
import type { ToolMode } from "../store/types";
import { isMacLikePlatform } from "./key-labels";
import { listAddonToolTemplates, type AddonToolTemplate } from "../addons/templates";
import { useAddonRuntimeRevision } from "../addons/registry";
import css from "./Toolbar.module.css";

/** Generic puzzle-piece glyph for add-on tools without an iconPath. */
const GENERIC_ADDON_TOOL_ICON_PATH =
  "M10 3a2 2 0 0 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4H4a2 2 0 1 1 0-4h1V5a1 1 0 0 1 1-1h4z";

const SHAPE_POPUP_CHOICES = NODE_SHAPE_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  previewSvg: GENERATED_NODE_SHAPE_PREVIEWS[option.value] ?? null
}));

type ToolbarProps = {
  updateChip?: {
    version: string;
    onClick: () => void;
  } | null;
};

export function Toolbar({ updateChip = null }: ToolbarProps) {
  const toolMode = useEditorStore((s) => s.toolMode);
  const activeAddonTemplateId = useEditorStore((s) => s.activeAddonTemplateId);
  const addonRuntimeRevision = useAddonRuntimeRevision();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- addon templates live outside React state; the revision signal tracks them
  const addonToolTemplates = useMemo(() => listAddonToolTemplates(), [addonRuntimeRevision]);
  const bucketFillColor = useEditorStore((s) => s.bucketFillColor);
  const selectedAddShape = useEditorStore((s) => s.selectedAddShape);
  const selectedAddMatrixRows = useEditorStore((s) => s.selectedAddMatrixRows);
  const selectedAddMatrixColumns = useEditorStore((s) => s.selectedAddMatrixColumns);
  const dispatch = useEditorStore((s) => s.dispatch);
  const projectNamedColorSwatches = useProjectNamedColorSwatches();
  const namedColorLookup = useMemo(
    () => new Map(projectNamedColorSwatches.map((swatch) => [swatch.token, swatch.cssColor] as const)),
    [projectNamedColorSwatches]
  );
  const [openPopupMode, setOpenPopupMode] = useState<ToolMode | null>(null);
  const [bucketPopupClosePending, setBucketPopupClosePending] = useState(false);
  const [matrixHoverSize, setMatrixHoverSize] = useState<{ rows: number; columns: number } | null>(null);
  const matrixPreviewRows = matrixHoverSize?.rows ?? selectedAddMatrixRows;
  const matrixPreviewColumns = matrixHoverSize?.columns ?? selectedAddMatrixColumns;
  const isDesktop = getActiveEditorPlatform().id.startsWith("desktop");
  const isMacDesktop = isDesktop && isMacLikePlatform();
  const showAppTitle = !isDesktop;

  // Close popup when tool mode changes (unless it's a popup that can be used independently)
  useEffect(() => {
    if (openPopupMode && openPopupMode !== "addShape" && openPopupMode !== "addBucket" && openPopupMode !== "addMatrix" && openPopupMode !== toolMode) {
      setOpenPopupMode(null);
    }
  }, [openPopupMode, toolMode]);

  useEffect(() => {
    if (openPopupMode !== "addBucket" && bucketPopupClosePending) {
      setBucketPopupClosePending(false);
    }
  }, [bucketPopupClosePending, openPopupMode]);

  useEffect(() => {
    if (openPopupMode !== "addBucket" || !bucketPopupClosePending) {
      return;
    }

    function onPointerUp(): void {
      setBucketPopupClosePending(false);
      setOpenPopupMode(null);
    }

    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointerup", onPointerUp); };
  }, [bucketPopupClosePending, openPopupMode]);

  const closeBucketPopup = () => {
    setBucketPopupClosePending(false);
    setOpenPopupMode(null);
  };

  const renderPopup = (popupKind: ToolPopupKind) => {
    if (popupKind === "bucket-color") {
      return (
        <ToolbarPopupSection title="Bucket Color">
          <ColorPicker
            ariaLabel="Bucket fill color"
            value={bucketFillColor}
            syntaxValue={bucketFillColor}
            options={TOOL_COLOR_OPTIONS}
            namedColorSwatches={projectNamedColorSwatches}
            onChange={(nextValue) => {
              dispatch({ type: "SET_BUCKET_FILL_COLOR", value: nextValue });
              // Auto-activate bucket tool after selecting a color
              dispatch({ type: "SET_TOOL_MODE", mode: "addBucket" });
              setBucketPopupClosePending(true);
            }}
          />
        </ToolbarPopupSection>
      );
    }
    if (popupKind === "shape-picker") {
      return (
        <ToolbarPopupSection title="Shape">
          <ToolbarPopupVisualChoiceGrid
            choices={SHAPE_POPUP_CHOICES}
            selectedId={selectedAddShape}
            onSelect={(id) => {
              dispatch({ type: "SET_ADD_SHAPE_PRESET", value: id as typeof selectedAddShape });
              // Activate the shape tool and close popup
              dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
              setOpenPopupMode(null);
            }}
            testIdPrefix="toolbar-shape-choice"
          />
        </ToolbarPopupSection>
      );
    }
    if (popupKind === "matrix-picker") {
      const maxColumns = 10;
      const maxRows = 8;
      const isSelected = (row: number, column: number): boolean =>
        row <= matrixPreviewRows && column <= matrixPreviewColumns;
      return (
        <ToolbarPopupSection title={`Insert Matrix (${matrixPreviewColumns} x ${matrixPreviewRows})`}>
          <div
            className={popupCss.matrixPicker}
            data-testid="toolbar-matrix-picker-grid"
            onMouseLeave={() => { setMatrixHoverSize(null); }}
          >
            {Array.from({ length: maxRows }, (_, rowIndex) => rowIndex + 1).map((row) => (
              <div key={row} className={popupCss.matrixPickerRow}>
                {Array.from({ length: maxColumns }, (_, columnIndex) => columnIndex + 1).map((column) => (
                  <button
                    key={`${row}-${column}`}
                    type="button"
                    className={[
                      popupCss.matrixPickerCell,
                      isSelected(row, column) ? popupCss.matrixPickerCellSelected : ""
                    ].filter(Boolean).join(" ")}
                    onMouseEnter={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                    onFocus={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                    onClick={() => {
                      dispatch({ type: "SET_ADD_MATRIX_PRESET", rows: row, columns: column });
                      dispatch({ type: "SET_TOOL_MODE", mode: "addMatrix" });
                      setMatrixHoverSize(null);
                      setOpenPopupMode(null);
                    }}
                    data-testid={`toolbar-matrix-picker-cell-${row}-${column}`}
                    aria-label={`${row} rows by ${column} columns`}
                    aria-selected={isSelected(row, column)}
                  />
                ))}
              </div>
            ))}
          </div>
        </ToolbarPopupSection>
      );
    }
    return null;
  };

  const renderBucketButton = () => {
    const mode = "addBucket" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    const bucketFillColorCss = cssColorForToken(bucketFillColor, namedColorLookup) ?? "transparent";

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={closeBucketPopup}
        popup={renderPopup("bucket-color")}
        popupTestId="toolbar-tool-popup-addBucket"
        popupClassName={popupCss.bucketColorPopup}
      >
        <div className={css.splitButton}>
          <RenderedTooltip content={buttonTitle}>
            <button
              type="button"
              className={[css.btn, css.splitButtonMain, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label={toolDef.label}
              disabled={unsupported}
              onClick={() => {
                dispatch({ type: "SET_TOOL_MODE", mode: isActive ? "select" : mode });
                closeBucketPopup();
              }}
            >
              <Icon size={18} />
              <div
                className={css.bucketColorIndicator}
                style={{ backgroundColor: bucketFillColorCss }}
              />
            </button>
          </RenderedTooltip>
          <RenderedTooltip content="Choose bucket color">
            <button
              type="button"
              className={[css.btn, css.splitButtonCaret, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
              aria-label="Choose bucket color"
              aria-haspopup="dialog"
              aria-expanded={openPopupMode === mode}
              disabled={unsupported}
              data-testid="toolbar-bucket-color-caret"
              onClick={(e) => {
                e.stopPropagation();
                setOpenPopupMode((current) => (current === mode ? null : mode));
              }}
            >
              <CaretDownIcon size={8} />
            </button>
          </RenderedTooltip>
        </div>
      </ToolbarToolPopup>
    );
  };

  const renderShapeButton = () => {
    const mode = "addShape" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => { setOpenPopupMode(null); }}
        popup={renderPopup("shape-picker")}
        popupTestId="toolbar-tool-popup-addShape"
      >
        <RenderedTooltip content={buttonTitle}>
          <button
            type="button"
            className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
            aria-label={toolDef.label}
            aria-haspopup="dialog"
            aria-expanded={openPopupMode === mode}
            disabled={unsupported}
            onClick={() => {
              // Just open the popup, don't activate the tool
              setOpenPopupMode((current) => (current === mode ? null : mode));
            }}
          >
            <Icon size={18} />
          </button>
        </RenderedTooltip>
      </ToolbarToolPopup>
    );
  };

  const renderMatrixButton = () => {
    const mode = "addMatrix" as const;
    const toolDef = TOOL_BUTTONS.find((b) => b.mode === mode)!;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${toolDef.title}\n${capability.reason}`
      : toolDef.title;
    const Icon = toolDef.icon;
    const isActive = toolMode === mode;

    return (
      <ToolbarToolPopup
        key={mode}
        open={openPopupMode === mode}
        onClose={() => {
          setOpenPopupMode(null);
          setMatrixHoverSize(null);
        }}
        popup={renderPopup("matrix-picker")}
        popupTestId="toolbar-tool-popup-addMatrix"
      >
        <RenderedTooltip content={buttonTitle}>
          <button
            type="button"
            className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
            aria-label={toolDef.label}
            aria-haspopup="dialog"
            aria-expanded={openPopupMode === mode}
            disabled={unsupported}
            onClick={() => {
              setMatrixHoverSize(null);
              setOpenPopupMode((current) => (current === mode ? null : mode));
            }}
          >
            <Icon size={18} />
          </button>
        </RenderedTooltip>
      </ToolbarToolPopup>
    );
  };

  const renderStandardButton = (toolDef: (typeof TOOL_BUTTONS)[number]) => {
    const { mode, label, title, icon: Icon } = toolDef;
    const capability = getToolCapabilityStatus(mode);
    const unsupported = capability.status === "unsupported";
    const buttonTitle = unsupported
      ? `${title}\n${capability.reason}`
      : title;
    const nextMode = resolveToolbarToolMode(toolMode, mode);
    const isActive = toolMode === mode;

    return (
      <RenderedTooltip key={mode} content={buttonTitle}>
        <button
          type="button"
          className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
          aria-label={label}
          disabled={unsupported}
          onClick={() => {
            dispatch({ type: "SET_TOOL_MODE", mode: nextMode });
            setOpenPopupMode(null);
          }}
        >
          <Icon size={18} />
        </button>
      </RenderedTooltip>
    );
  };

  const renderAddonTemplateButton = (template: AddonToolTemplate) => {
    const isActive = toolMode === "addonTemplate" && activeAddonTemplateId === template.id;

    return (
      <RenderedTooltip key={template.id} content={template.label}>
        <button
          type="button"
          className={[css.btn, isActive ? css.btnActive : ""].filter(Boolean).join(" ")}
          aria-label={template.label}
          data-testid={`toolbar-addon-${template.id}`}
          onClick={() => {
            dispatch(
              isActive
                ? { type: "SET_TOOL_MODE", mode: "select" }
                : { type: "SET_TOOL_MODE", mode: "addonTemplate", addonTemplateId: template.id }
            );
            setOpenPopupMode(null);
          }}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
            <path d={template.iconPath ?? GENERIC_ADDON_TOOL_ICON_PATH} fill="currentColor" fillRule="evenodd" />
          </svg>
        </button>
      </RenderedTooltip>
    );
  };

  return (
    <div className={`${css.toolbar}${isMacDesktop ? ` ${css.toolbarDesktop}` : ""}`} data-tauri-drag-region data-select="chrome">
      {showAppTitle ? (
        <>
          <span className={css.title}>
            TikZ Editor <span className={css.titleQualifier}>Web</span>
          </span>
          <div className={css.separator} />
        </>
      ) : null}

      <div className={css.group}>
        {TOOL_BUTTONS.flatMap((toolDef) => {
          const separator = toolDef.separatorBefore ? <div key={`sep-${toolDef.mode}`} className={css.separator} /> : null;
          // Special handling for bucket and shape buttons
          let button;
          if (toolDef.mode === "addBucket") {
            button = renderBucketButton();
          } else if (toolDef.mode === "addMatrix") {
            button = renderMatrixButton();
          } else if (toolDef.mode === "addShape") {
            button = renderShapeButton();
          } else {
            button = renderStandardButton(toolDef);
          }
          return separator ? [separator, button] : [button];
        })}
        {addonToolTemplates.length > 0 ? <div className={css.separator} /> : null}
        {addonToolTemplates.map(renderAddonTemplateButton)}
      </div>
      <div className={css.spacer} />
      {updateChip ? (
        <RenderedTooltip content={`Install update ${updateChip.version}`}>
          <button
            type="button"
            className={css.updateChip}
            onClick={updateChip.onClick}
            data-testid="toolbar-update-chip"
            aria-label={`Update available: ${updateChip.version}`}
          >
            <RiDownloadCloudLine size={15} aria-hidden="true" />
            <span>Update available</span>
          </button>
        </RenderedTooltip>
      ) : null}
    </div>
  );
}
