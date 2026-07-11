import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { EmitSvgResult } from "@tikz-editor/core/svg/index";
import {
  copySvgText,
  downloadSvgMarkup,
  preloadSvgOptimizer,
  serializeSvgForExport,
  transformSvgMarkup,
  validateSvgMarkup,
  type SvgTransformPreset
} from "./export-commands";
import { Modal } from "./Modal";
import css from "./SvgExportModal.module.css";

const DEFAULT_FILE_NAME = "tikz-export.svg";
const SVG_CODE_EDITOR_ARIA_LABEL = "SVG code";

const SvgCodeEditor = lazy(async () => {
  const mod = await import("./SvgCodeEditor");
  return { default: mod.SvgCodeEditor };
});

let rememberedFileName = DEFAULT_FILE_NAME;

type OptimizerState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type SvgExportModalProps = {
  svgResult: EmitSvgResult;
  onClose: () => void;
};

export function SvgExportModal({ svgResult, onClose }: SvgExportModalProps) {
  const [fileName, setFileName] = useState(rememberedFileName);
  const [markup, setMarkup] = useState("");
  const [baselineMarkup, setBaselineMarkup] = useState("");
  const [loadingMarkup, setLoadingMarkup] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [optimizerState, setOptimizerState] = useState<OptimizerState>({ status: "loading" });
  const [activeTransform, setActiveTransform] = useState<SvgTransformPreset | null>(null);
  const [copyPending, setCopyPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    rememberedFileName = fileName;
  }, [fileName]);

  useEffect(() => {
    let active = true;
    setLoadingMarkup(true);
    setLoadError(null);
    setOptimizerState({ status: "loading" });
    setCopyFeedback(null);

    void serializeSvgForExport(svgResult).then(
      (text) => {
        if (!active) {
          return;
        }
        setMarkup(text);
        setBaselineMarkup(text);
        setLoadingMarkup(false);
      },
      (error) => {
        if (!active) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoadingMarkup(false);
      }
    );

    void preloadSvgOptimizer().then(
      () => {
        if (active) {
          setOptimizerState({ status: "ready" });
        }
      },
      (error) => {
        if (active) {
          setOptimizerState({
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );

    return () => {
      active = false;
    };
  }, [svgResult]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }
    const timer = window.setTimeout(() => { setCopyFeedback(null); }, 1800);
    return () => { window.clearTimeout(timer); };
  }, [copyFeedback]);

  const validation = useMemo(() => validateSvgMarkup(markup), [markup]);

  const previewUrl = usePreviewUrl(markup, validation.valid);
  const isBusy = loadingMarkup || activeTransform != null || downloadPending || copyPending;
  const canExportMarkup = !loadingMarkup && loadError == null && validation.valid && markup.trim().length > 0;
  const lineCount = markup.length === 0 ? 0 : markup.split(/\r?\n/).length;
  const hasEdits = markup !== baselineMarkup;

  const handleTransform = async (preset: SvgTransformPreset) => {
    if (optimizerState.status !== "ready") {
      return;
    }
    setActiveTransform(preset);
    setCopyFeedback(null);
    try {
      const nextMarkup = await transformSvgMarkup(markup, preset);
      setMarkup(nextMarkup);
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setActiveTransform(null);
    }
  };

  const handleCopy = async () => {
    if (!canExportMarkup) {
      return;
    }
    setCopyPending(true);
    setCopyFeedback(null);
    try {
      const copied = await copySvgText(markup);
      setCopyFeedback(copied ? "Copied SVG markup." : "Clipboard export failed.");
    } finally {
      setCopyPending(false);
    }
  };

  const handleDownload = async () => {
    if (!canExportMarkup) {
      return;
    }
    setDownloadPending(true);
    try {
      const exported = await downloadSvgMarkup(markup, { fileName });
      if (exported) {
        onClose();
      }
    } finally {
      setDownloadPending(false);
    }
  };

  const handleMarkupChange = (nextMarkup: string) => {
    setMarkup(nextMarkup);
    setCopyFeedback(null);
  };

  return (
    <Modal
      onClose={onClose}
      size="xl"
      labelledBy="svg-export-title"
      dataTestId="svg-export-modal"
      className={css.dialog}
    >
      <Modal.Header
        title="Export SVG"
        titleId="svg-export-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close SVG export"
      />

      <Modal.Body padding="none" scroll={false}>
        <div className={css.body}>
          <div className={css.previewColumn}>
            <div className={css.previewFrame}>
              {loadingMarkup ? (
                <div className={css.previewStatus} data-select="text">Preparing SVG export…</div>
              ) : loadError ? (
                <div className={css.previewStatus} data-select="text">{loadError}</div>
              ) : !validation.valid ? (
                <div className={css.previewStatus} data-select="text">{validation.message}</div>
              ) : previewUrl ? (
                <img className={css.previewImage} src={previewUrl} alt="SVG export preview" />
              ) : (
                <div className={css.previewStatus} data-select="text">SVG preview is unavailable in this browser.</div>
              )}
            </div>

            <div className={css.metaRow} data-select="text">
              <span>{svgResult.viewBox.width.toFixed(1)} × {svgResult.viewBox.height.toFixed(1)}pt</span>
              <span>{markup.length.toLocaleString()} chars</span>
              <span>{lineCount.toLocaleString()} lines</span>
              <span>{hasEdits ? "Edited" : "Generated from render"}</span>
            </div>
          </div>

          <div className={css.controlColumn}>
            <div className={css.controls}>
              <label className={css.field}>
                <span className={css.label}>File name</span>
                <input
                  type="text"
                  className={css.input}
                  value={fileName}
                  onChange={(event) => { setFileName(event.target.value); }}
                />
              </label>

              <div className={css.field}>
                <span className={css.label}>SVGO tools</span>
                <div className={css.transformRow}>
                  <Modal.SecondaryButton
                    disabled={loadingMarkup || loadError != null || optimizerState.status !== "ready" || activeTransform != null}
                    onClick={() => {
                      void handleTransform("beautify");
                    }}
                  >
                    {activeTransform === "beautify" ? "Beautifying…" : "Beautify"}
                  </Modal.SecondaryButton>
                  <Modal.SecondaryButton
                    disabled={loadingMarkup || loadError != null || optimizerState.status !== "ready" || activeTransform != null}
                    onClick={() => {
                      void handleTransform("compress");
                    }}
                  >
                    {activeTransform === "compress" ? "Compressing…" : "Compress"}
                  </Modal.SecondaryButton>
                  <Modal.GhostButton
                    disabled={loadingMarkup || !hasEdits}
                    onClick={() => {
                      setMarkup(baselineMarkup);
                      setCopyFeedback(null);
                    }}
                  >
                    Reset
                  </Modal.GhostButton>
                </div>
                {optimizerState.status === "error" ? (
                  <span className={css.help} data-select="text">SVGO unavailable: {optimizerState.message}</span>
                ) : null}
                {copyFeedback ? <span className={css.help} data-select="text">{copyFeedback}</span> : null}
              </div>
            </div>

            <label className={css.editorLabel}>
              <span className={css.label}>SVG code</span>
              <Suspense
                fallback={(
                  <textarea
                    className={css.textarea}
                    value={markup}
                    spellCheck={false}
                    aria-label={SVG_CODE_EDITOR_ARIA_LABEL}
                    onChange={(event) => {
                      handleMarkupChange(event.target.value);
                    }}
                  />
                )}
              >
                <SvgCodeEditor
                  value={markup}
                  ariaLabel={SVG_CODE_EDITOR_ARIA_LABEL}
                  onChange={handleMarkupChange}
                />
              </Suspense>
            </label>
          </div>
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Modal.SecondaryButton data-testid="svg-export-cancel" onClick={onClose}>
          Cancel
        </Modal.SecondaryButton>
        <Modal.SecondaryButton
          data-testid="svg-export-copy"
          disabled={isBusy || !canExportMarkup}
          onClick={() => {
            void handleCopy();
          }}
        >
          {copyPending ? "Copying…" : "Copy SVG"}
        </Modal.SecondaryButton>
        <Modal.PrimaryButton
          data-testid="svg-export-download"
          disabled={isBusy || !canExportMarkup}
          onClick={() => {
            void handleDownload();
          }}
        >
          {downloadPending ? "Exporting…" : "Download SVG"}
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}

function usePreviewUrl(svgMarkup: string, enabled: boolean): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function" ||
      typeof URL.revokeObjectURL !== "function" ||
      typeof Blob === "undefined"
    ) {
      setPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }));
    setPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [enabled, svgMarkup]);

  return previewUrl;
}
