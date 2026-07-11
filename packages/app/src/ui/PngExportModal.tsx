import { useEffect, useMemo, useState } from "react";
import type { EmitSvgResult } from "@tikz-editor/core/svg/index";
import {
  exportPngDownload,
  normalizePngExportDpi,
  renderPngExport
} from "./export-commands";
import { Modal } from "./Modal";
import css from "./PngExportModal.module.css";

const DEFAULT_FILE_NAME = "tikz-export.png";

let rememberedDpi = "144";
let rememberedTransparentBackground = true;

type PreviewState =
  | {
      status: "loading";
      previousUrl: string | null;
      previousPixelWidth: number | null;
      previousPixelHeight: number | null;
      previousDpi: number | null;
    }
  | { status: "error"; message: string }
  | {
      status: "ready";
      url: string;
      pixelWidth: number;
      pixelHeight: number;
      dpi: number;
    };

type PngExportModalProps = {
  svgResult: EmitSvgResult;
  onClose: () => void;
};

export function PngExportModal({ svgResult, onClose }: PngExportModalProps) {
  const [dpiInput, setDpiInput] = useState(rememberedDpi);
  const [transparentBackground, setTransparentBackground] = useState(rememberedTransparentBackground);
  const [preview, setPreview] = useState<PreviewState>({
    status: "loading",
    previousUrl: null,
    previousPixelWidth: null,
    previousPixelHeight: null,
    previousDpi: null
  });
  const [downloadPending, setDownloadPending] = useState(false);
  const [showRefreshOverlay, setShowRefreshOverlay] = useState(false);

  const effectiveDpi = useMemo(() => normalizePngExportDpi(parseDpiInput(dpiInput)), [dpiInput]);

  useEffect(() => {
    rememberedDpi = dpiInput;
  }, [dpiInput]);

  useEffect(() => {
    rememberedTransparentBackground = transparentBackground;
  }, [transparentBackground]);

  useEffect(() => {
    let active = true;
    let nextPreviewUrl: string | null = null;

    setPreview((current) => ({
      status: "loading",
      previousUrl: current.status === "ready" ? current.url : current.status === "loading" ? current.previousUrl : null,
      previousPixelWidth:
        current.status === "ready"
          ? current.pixelWidth
          : current.status === "loading"
            ? current.previousPixelWidth
            : null,
      previousPixelHeight:
        current.status === "ready"
          ? current.pixelHeight
          : current.status === "loading"
            ? current.previousPixelHeight
            : null
      ,
      previousDpi:
        current.status === "ready"
          ? current.dpi
          : current.status === "loading"
            ? current.previousDpi
            : null
    }));

    void renderPngExport(svgResult, {
      dpi: effectiveDpi,
      transparentBackground,
      fileName: DEFAULT_FILE_NAME
    }).then(
      (result) => {
        if (!active) {
          return;
        }
        nextPreviewUrl = URL.createObjectURL(result.blob);
        setPreview({
          status: "ready",
          url: nextPreviewUrl,
          pixelWidth: result.pixelWidth,
          pixelHeight: result.pixelHeight,
          dpi: result.dpi
        });
      },
      (error) => {
        if (!active) {
          return;
        }
        setPreview({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    );

    return () => {
      active = false;
      if (nextPreviewUrl) {
        URL.revokeObjectURL(nextPreviewUrl);
      }
    };
  }, [effectiveDpi, svgResult, transparentBackground]);

  useEffect(() => {
    if (!(preview.status === "loading" && preview.previousUrl)) {
      setShowRefreshOverlay(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowRefreshOverlay(true);
    }, 180);

    return () => {
      window.clearTimeout(timer);
      setShowRefreshOverlay(false);
    };
  }, [preview]);

  const handleExport = async () => {
    setDownloadPending(true);
    try {
      const exported = await exportPngDownload(svgResult, {
        dpi: effectiveDpi,
        transparentBackground,
        fileName: DEFAULT_FILE_NAME
      });
      if (exported) {
        onClose();
      }
    } finally {
      setDownloadPending(false);
    }
  };

  const previewDisplay =
    preview.status === "ready"
      ? {
          url: preview.url,
          pixelWidth: preview.pixelWidth,
          pixelHeight: preview.pixelHeight,
          dpi: preview.dpi,
          isRefreshing: false
        }
      : preview.status === "loading" && preview.previousUrl
        ? {
            url: preview.previousUrl,
            pixelWidth: preview.previousPixelWidth ?? Math.max(1, Math.ceil(svgResult.viewBox.width * (effectiveDpi / 72))),
            pixelHeight: preview.previousPixelHeight ?? Math.max(1, Math.ceil(svgResult.viewBox.height * (effectiveDpi / 72))),
            dpi: preview.previousDpi ?? effectiveDpi,
            isRefreshing: true
          }
        : null;

  const canExport = !downloadPending && previewDisplay != null;

  return (
    <Modal
      onClose={onClose}
      size="lg"
      labelledBy="png-export-title"
      dataTestId="png-export-modal"
      className={css.dialog}
    >
      <Modal.Header
        title="Export PNG"
        titleId="png-export-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close PNG export"
      />

      <Modal.Body padding="none" scroll={false}>
        <div className={css.body}>
          <div className={css.previewColumn}>
            <div
              className={[
                css.previewFrame,
                transparentBackground ? css.previewFrameTransparent : css.previewFrameOpaque
              ].join(" ")}
            >
              {previewDisplay ? (
                <div className={css.previewStack}>
                  <img
                    className={[
                      css.previewImage,
                      previewDisplay.isRefreshing ? css.previewImageRefreshing : ""
                    ].filter(Boolean).join(" ")}
                    src={previewDisplay.url}
                    alt="PNG export preview"
                  />
                  {previewDisplay.isRefreshing && showRefreshOverlay ? (
                    <div className={css.previewOverlay} data-select="text">Rendering preview…</div>
                  ) : null}
                </div>
              ) : (
                <div className={css.previewStatus} data-select="text">
                  {preview.status === "loading"
                    ? "Rendering preview…"
                    : preview.status === "error"
                      ? preview.message
                      : "Preview unavailable."}
                </div>
              )}
            </div>
            <div className={css.previewMeta} data-select="text">
              {previewDisplay ? (
                <>
                  <span>{previewDisplay.pixelWidth} × {previewDisplay.pixelHeight}px</span>
                  <span>{previewDisplay.dpi} DPI</span>
                  <span>{transparentBackground ? "Transparent background" : "White background"}</span>
                </>
              ) : (
                <span>PNG preview updates as you change the export settings.</span>
              )}
            </div>
          </div>

          <form
            className={css.controls}
            onSubmit={(event) => {
              event.preventDefault();
              if (canExport) {
                void handleExport();
              }
            }}
          >
            <label className={css.field}>
              <span className={css.label}>DPI</span>
              <input
                type="number"
                min={36}
                max={1200}
                step={1}
                inputMode="numeric"
                className={css.input}
                value={dpiInput}
                onChange={(event) => { setDpiInput(event.target.value); }}
              />
              <span className={css.help}>Canvas export uses the selected DPI to choose the PNG pixel size.</span>
            </label>

            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={transparentBackground}
                onChange={(event) => { setTransparentBackground(event.target.checked); }}
              />
              <span className={css.checkboxText}>
                <span className={css.label}>Transparent background</span>
                <span className={css.helpBlock}>Turn this off to flatten the image onto solid white.</span>
              </span>
            </label>

            <div className={css.summary}>
              <div className={css.summaryRow}>
                <span>Canvas size</span>
                <span>
                  {(previewDisplay?.pixelWidth ?? Math.max(1, Math.ceil(svgResult.viewBox.width * (effectiveDpi / 72))))} ×{" "}
                  {(previewDisplay?.pixelHeight ?? Math.max(1, Math.ceil(svgResult.viewBox.height * (effectiveDpi / 72))))}px
                </span>
              </div>
              <div className={css.summaryRow}>
                <span>Source bounds</span>
                <span>
                  {svgResult.viewBox.width.toFixed(1)} × {svgResult.viewBox.height.toFixed(1)}pt
                </span>
              </div>
              <div className={css.summaryRow}>
                <span>Background</span>
                <span>{transparentBackground ? "Alpha preserved" : "Opaque white"}</span>
              </div>
            </div>
          </form>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Modal.SecondaryButton data-testid="png-export-cancel" onClick={onClose}>
          Cancel
        </Modal.SecondaryButton>
        <Modal.PrimaryButton
          data-testid="png-export-download"
          disabled={!canExport}
          onClick={() => {
            void handleExport();
          }}
        >
          {downloadPending ? "Exporting…" : "Export PNG"}
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}

function parseDpiInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
