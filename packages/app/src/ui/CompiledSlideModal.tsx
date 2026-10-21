import { useCallback, useEffect, useMemo, useState } from "react";
import { beamerCompiledPages, createBeamerCompileDocument, type BeamerCompiledPages, type BeamerTexEngine } from "@tikz-editor/core/beamer/index";
import { Modal } from "./Modal";
import { openPdfDocument, type PdfDocument } from "../pdf-asset-rasterizer";
import type { LatexPdfCompileResult, PlatformFileApi, PlatformLatex } from "../platform/types";
import type { DocumentFileRef } from "../store/types";
import { PdfPageView } from "./PdfPageView";
import css from "./CompiledSlideModal.module.css";

const ENGINE_NAMES: Record<BeamerTexEngine, string> = { pdflatex: "pdfLaTeX", xelatex: "XeLaTeX", lualatex: "LuaLaTeX" };

type CompiledSlideModalProps = {
  source: string;
  /** The active slide's frame index, whose page (at `step`) the dialog opens on. */
  frameIndex: number | null;
  step: number;
  documentFileRef: DocumentFileRef | null;
  /** Keeps the deck's auxiliary files between compiles: its path, or its document id. */
  buildKey: string;
  latex: PlatformLatex;
  exportFile?: PlatformFileApi["exportFile"];
  onClose: () => void;
};

type Compiled = LatexPdfCompileResult & { pages: BeamerCompiledPages };

type State =
  | { phase: "compiling" }
  | { phase: "error"; message: string; log: string }
  | { phase: "done"; compiled: Compiled };

/**
 * The deck compiled by the TeX installation, opened on the active slide's
 * page: the whole deck compiles, so that frame numbers, navigation bars and
 * references read as in the PDF, and its pages can be stepped through.
 */
export function CompiledSlideModal({ source, frameIndex, step, documentFileRef, buildKey, latex, exportFile, onClose }: CompiledSlideModalProps) {
  const job = useMemo(() => createBeamerCompileDocument(source), [source]);
  const [state, setState] = useState<State>({ phase: "compiling" });
  const [page, setPage] = useState(1);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const compileToPdf = latex.compileToPdf;
    if (!compileToPdf) return;
    let cancelled = false;
    const started = performance.now();
    const timer = window.setInterval(() => { setElapsed(Math.floor((performance.now() - started) / 1000)); }, 1000);
    compileToPdf(job.text, { engine: job.engine, sourceDirectory: sourceDirectoryFromFileRef(documentFileRef), buildKey }).then((result) => {
      if (cancelled) return;
      const pages = beamerCompiledPages(result.marks);
      const builds = frameIndex == null ? undefined : pages.framePages.get(frameIndex);
      setPage(builds?.[Math.min(Math.max(step, 1), builds.length) - 1] ?? 1);
      setState({ phase: "done", compiled: { ...result, pages } });
    }, (error: unknown) => {
      if (cancelled) return;
      const log = error instanceof Error ? error.message : String(error);
      const message = /Failed to spawn/u.test(log)
        ? `${ENGINE_NAMES[job.engine]} not found. Install MacTeX or TeX Live to compile slides.`
        : `${ENGINE_NAMES[job.engine]} stopped without making a PDF.`;
      setState({ phase: "error", message, log });
    }).finally(() => { window.clearInterval(timer); });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [buildKey, documentFileRef, frameIndex, job, latex, step]);

  const compiled = state.phase === "done" ? state.compiled : null;
  // One parse of the PDF serves every page the dialog shows.
  useEffect(() => {
    if (!compiled) return;
    let cancelled = false;
    let opened: PdfDocument | null = null;
    openPdfDocument(compiled.pdf).then((document) => {
      if (cancelled) {
        void document.loadingTask.destroy();
        return;
      }
      opened = document;
      setPdf(document);
    }, (error: unknown) => {
      if (!cancelled) setRenderError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
      setPdf(null);
      if (opened) void opened.loadingTask.destroy();
    };
  }, [compiled]);
  const onRenderError = useCallback((message: string) => { setRenderError(message); }, []);

  const pageCount = compiled ? Math.max(compiled.pages.pageCount, 1) : 0;
  const go = (delta: number) => { setPage((current) => Math.min(Math.max(current + delta, 1), pageCount)); };
  // The arrow keys page through the PDF wherever focus is in the dialog, as in a PDF viewer.
  useEffect(() => {
    if (!pageCount || showLog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown" ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 0;
      if (!delta || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setPage((current) => Math.min(Math.max(current + delta, 1), pageCount));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => { window.removeEventListener("keydown", onKeyDown, true); };
  }, [pageCount, showLog]);
  const missing = compiled != null && frameIndex != null && !compiled.pages.framePages.has(frameIndex);
  const statusText = state.phase === "compiling" ? `Compiling with ${ENGINE_NAMES[job.engine]}…${elapsed >= 2 ? ` ${elapsed} s` : ""}`
    : state.phase === "error" ? state.message
      : renderError ? `Can't display the PDF: ${renderError}`
        : compiled?.hadErrors ? `${ENGINE_NAMES[job.engine]} reported errors. See the log.`
          : missing ? "This slide isn't in the compiled PDF." : null;
  const savePdf = () => {
    if (!compiled || !exportFile) return;
    void exportFile([new Uint8Array(compiled.pdf)], { fileName: pdfFileName(documentFileRef), mimeType: "application/pdf" });
  };

  return (
    <Modal variant="panel" onClose={onClose} labelledBy="compiled-slide-title" draggable resizable closeOnBackdrop
      initialWidth={760} initialHeight={600} className={css.dialog ?? ""}>
      <Modal.Header title="Compiled Slide" titleId="compiled-slide-title" draggable showCloseButton onClose={onClose}
        closeAriaLabel="Close compiled slide" />
      {statusText ? <div className={css.statusBar} data-select="text" role={state.phase === "error" ? "alert" : "status"}>{statusText}</div> : null}
      <Modal.Body padding="none">
        <div className={css.output}>
          {state.phase === "error" || showLog ? <pre className={css.log} data-select="text">{state.phase === "error" ? state.log : compiled?.log ?? "No log."}</pre>
            : pdf && compiled ? <PdfPageView pdf={pdf} page={page} label={pageLabel(compiled.pages, page)} className={css.view ?? ""}
              pageClassName={css.page ?? ""} onError={onRenderError} />
              : null}
        </div>
      </Modal.Body>
      <Modal.Footer align="between">
        <div className={css.footerSide}>
          {compiled ? <Modal.GhostButton onClick={() => { setShowLog((shown) => !shown); }}>{showLog ? "Show Slide" : "Show Log"}</Modal.GhostButton> : null}
        </div>
        {compiled && !showLog ? (
          <div className={css.pager}>
            <button type="button" className={css.step} aria-label="Previous page" disabled={page <= 1} onClick={() => { go(-1); }}>‹</button>
            <span className={css.pageLabel} title={`Page ${page} of ${pageCount}`} aria-live="polite">{pageLabel(compiled.pages, page)}</span>
            <button type="button" className={css.step} aria-label="Next page" disabled={page >= pageCount} onClick={() => { go(1); }}>›</button>
          </div>
        ) : null}
        <div className={css.footerSide}>
          {exportFile ? <Modal.SecondaryButton disabled={!compiled} onClick={savePdf}>Save PDF…</Modal.SecondaryButton> : null}
        </div>
      </Modal.Footer>
    </Modal>
  );
}

/** "Slide 3 · build 2 of 3", by the editor's slide numbers; pages outside frames (note pages) by page number. */
function pageLabel(pages: BeamerCompiledPages, page: number): string {
  const frame = pages.pageFrames[page - 1];
  if (frame == null) return `Page ${page}`;
  const builds = pages.framePages.get(frame) ?? [];
  const build = builds.indexOf(page);
  return build >= 0 && builds.length > 1 ? `Slide ${frame + 1} · build ${build + 1} of ${builds.length}` : `Slide ${frame + 1}`;
}

function sourceDirectoryFromFileRef(fileRef: DocumentFileRef | null): string | null {
  const path = fileRef?.provider === "desktop-fs" && typeof fileRef.path === "string" ? fileRef.path.trim() : "";
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator > 0 ? path.slice(0, separator) : null;
}

function pdfFileName(fileRef: DocumentFileRef | null): string {
  const path = fileRef?.provider === "desktop-fs" && typeof fileRef.path === "string" ? fileRef.path : "";
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1).replace(/\.[^.]*$/u, "");
  return `${name || "slides"}.pdf`;
}
