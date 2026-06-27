import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { PlatformLatex } from "../platform/types";
import type { DocumentFileRef } from "../store/types";
import { createStandaloneLatexExportArtifact } from "tikz-editor/export/index";
import css from "./TikzJaxModal.module.css";

const TIKZJAX_FONTS_CSS = "https://cdn.jsdelivr.net/npm/@drgrice1/tikzjax@1.0.0-beta24/dist/fonts.css";
const TIKZJAX_JS = "https://cdn.jsdelivr.net/npm/@drgrice1/tikzjax@1.0.0-beta24/dist/tikzjax.js";
const NATIVE_COMPILE_TIMEOUT_MS = 22000;


type LibState = "idle" | "loading" | "loaded" | "error";

let _libState: LibState = "idle";
let _libPromise: Promise<void> | null = null;

function ensureTikzJaxLoaded(): Promise<void> {
  if (_libState === "loaded") return Promise.resolve();
  if (_libPromise) return _libPromise;

  _libState = "loading";
  _libPromise = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = TIKZJAX_FONTS_CSS;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = TIKZJAX_JS;
    script.onload = () => {
      _libState = "loaded";
      resolve();
    };
    script.onerror = () => {
      _libState = "idle";
      _libPromise = null;
      reject(new Error("Failed to load TikZJax from CDN"));
    };
    document.head.appendChild(script);
  });

  return _libPromise;
}

function latexSourceDirectoryFromFileRef(fileRef: DocumentFileRef | null | undefined): string | null {
  if (fileRef?.provider !== "desktop-fs" || typeof fileRef.path !== "string") {
    return null;
  }
  const path = fileRef.path.trim();
  if (!path) {
    return null;
  }
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null;
}

type Phase =
  | "checking-native"
  | "compiling-native"
  | "native-error"
  | "loading-lib"
  | "lib-error"
  | "rendering"
  | "done";

type TikzJaxModalProps = {
  source: string;
  activeFigureId: string | null;
  documentFileRef?: DocumentFileRef | null;
  onClose: () => void;
  latex?: PlatformLatex;
  showOpenInNewTab?: boolean;
  showLogToggle?: boolean;
};

export function TikzJaxModal({
  source,
  activeFigureId,
  documentFileRef = null,
  onClose,
  latex,
  showOpenInNewTab = true,
  showLogToggle = false
}: TikzJaxModalProps) {
  const [phase, setPhase] = useState<Phase>(latex ? "checking-native" : "loading-lib");
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [nativeLog, setNativeLog] = useState<string>("");
  const [showLogView, setShowLogView] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const svgMarkupRef = useRef<string | null>(null);

  const renderSvgIntoOutput = (svg: string): void => {
    svgMarkupRef.current = svg;
    const output = outputRef.current;
    if (!output) {
      return;
    }
    output.innerHTML = svg;
    const svgEl = output.querySelector("svg");
    if (svgEl) {
      svgEl.removeAttribute("width");
      svgEl.removeAttribute("height");
    }
  };

  // Try native LaTeX compilation if available
  useEffect(() => {
    if (!latex) {
      setPhase("loading-lib");
      return;
    }
    let cancelled = false;
    let pollId: number | null = null;
    svgMarkupRef.current = null;
    setShowLogView(false);
    setNativeError(null);
    setNativeLog("Probing native LaTeX toolchain...");
    latex.checkAvailable().then((status) => {
      if (cancelled) return;
      const details = `Native LaTeX probe:\n${status.details}`;
      if (!status.available) {
        setNativeError("Native LaTeX is not available in this app environment.");
        setNativeLog(details);
        setPhase("native-error");
        return;
      }
      const prefix = `${details}\n\nStarting compilation...`;
      setNativeLog(prefix);
      setPhase("compiling-native");
      const latexDocument = createStandaloneLatexExportArtifact({
        source,
        activeFigureId,
        documentClassOptions: ["dvisvgm", "border=2pt"]
      }).text;
      const readLastCompileLog = latex.readLastCompileLog;
      if (typeof readLastCompileLog === "function") {
        pollId = window.setInterval(() => {
          void readLastCompileLog().then((logText) => {
            if (cancelled) {
              return;
            }
            if (!logText) {
              return;
            }
            setNativeLog(`${prefix}\n\n--- input.log ---\n${logText}`);
          }).catch(() => {
            // Ignore log polling failures; compile result path remains authoritative.
          });
        }, 120);
      }
      const compilePromise = latex.compileTikzToSvg(latexDocument, {
        sourceDirectory: latexSourceDirectoryFromFileRef(documentFileRef)
      });
      const timeoutPromise = new Promise<string>((_resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error(`Native compile did not return within ${NATIVE_COMPILE_TIMEOUT_MS}ms.`));
        }, NATIVE_COMPILE_TIMEOUT_MS);
        void compilePromise.finally(() => { window.clearTimeout(timeoutId); });
      });
      return Promise.race([compilePromise, timeoutPromise]).then((svg) => {
        if (cancelled) return;
        setShowLogView(false);
        if (pollId != null) {
          window.clearInterval(pollId);
        }
        renderSvgIntoOutput(svg);
        setPhase("done");
      });
    }).catch((error) => {
      if (cancelled) return;
      if (pollId != null) {
        window.clearInterval(pollId);
      }
      const message = String(error);
      setNativeError(message);
      setNativeLog(message);
      setPhase("native-error");
    });
    return () => {
      cancelled = true;
      if (pollId != null) {
        window.clearInterval(pollId);
      }
    };
  }, [activeFigureId, documentFileRef, latex, source]);

  // TikZJax fallback path
  useEffect(() => {
    if (phase !== "loading-lib") return;
    ensureTikzJaxLoaded().then(
      () => { setPhase("rendering"); },
      () => { setPhase("lib-error"); }
    );
  }, [phase]);

  // Trigger TikZJax rendering once the library is ready
  useEffect(() => {
    if (phase !== "rendering") return;
    const output = outputRef.current;
    if (!output) return;

    output.innerHTML = "";

    const tikzScript = document.createElement("script");
    tikzScript.type = "text/tikz";
    tikzScript.textContent = source;

    const container = document.createElement("div");
    container.appendChild(tikzScript);
    output.appendChild(container);

    const onFinished = (e: Event) => {
      if (output.contains(e.target as Node)) {
        const svg = output.querySelector("svg");
        if (svg) {
          svg.removeAttribute("width");
          svg.removeAttribute("height");
        }
        setPhase("done");
        document.removeEventListener("tikzjax-load-finished", onFinished);
      }
    };
    document.addEventListener("tikzjax-load-finished", onFinished);

    return () => {
      document.removeEventListener("tikzjax-load-finished", onFinished);
    };
  }, [phase, source]);

  // Show progress/errors inside the same output panel while native compile is running/failing.
  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    if (phase === "done" || phase === "rendering" || phase === "loading-lib") return;
    const pre = document.createElement("pre");
    pre.className = css.outputLog;
    pre.textContent = nativeLog.length > 0 ? nativeLog : nativeError !== null && nativeError.length > 0 ? nativeError : "No diagnostic output.";
    output.innerHTML = "";
    output.appendChild(pre);
    pre.scrollTop = pre.scrollHeight;
  }, [nativeError, nativeLog, phase]);

  useEffect(() => {
    if (phase !== "done") return;
    const output = outputRef.current;
    if (!output) return;
    if (showLogView) {
      const pre = document.createElement("pre");
      pre.className = css.outputLog;
      pre.textContent = nativeLog || "No diagnostic output.";
      output.innerHTML = "";
      output.appendChild(pre);
      pre.scrollTop = pre.scrollHeight;
      return;
    }
    const svg = svgMarkupRef.current;
    if (svg) {
      renderSvgIntoOutput(svg);
    }
  }, [nativeLog, phase, showLogView]);

  const statusText =
    phase === "checking-native" ? "Checking LaTeX availability…" :
    phase === "compiling-native" ? "Compiling with LaTeX…" :
    phase === "loading-lib" ? "Loading TikZJax…" :
    phase === "lib-error" ? "Failed to load TikZJax from CDN." :
    phase === "native-error" ? "Native LaTeX compile failed." :
    phase === "rendering" ? "Compiling…" :
    null;

  const downloadSvg = () => {
    const svg = outputRef.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tikz.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openInNewTab = () => {
    const svg = outputRef.current?.querySelector("svg");
    if (!svg) return;
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff}svg{width:auto;height:auto;max-width:90vw;max-height:90vh}</style>
</head><body>${svg.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <Modal
      variant="panel"
      onClose={onClose}
      labelledBy="tikzjax-title"
      draggable
      resizable
      closeOnBackdrop
      initialWidth={760}
      initialHeight={560}
      className={css.dialog}
    >
      <Modal.Header
        title="Compiled Picture"
        titleId="tikzjax-title"
        draggable
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close compiled picture"
      />

      {statusText ? (
        <div className={css.statusBar} data-select="text">{statusText}</div>
      ) : null}

      {phase === "native-error" ? (
        <div className={css.fallbackRow}>
          <Modal.SecondaryButton onClick={() => { setPhase("loading-lib"); }}>
            Continue with TikZJax Fallback
          </Modal.SecondaryButton>
        </div>
      ) : null}

      <Modal.Body padding="none">
        <div className={css.output} ref={outputRef} />
      </Modal.Body>

      <Modal.Footer align="between">
        <div className={css.footerLeft}>
          {showLogToggle && phase === "done" && nativeLog.trim().length > 0 ? (
            <Modal.GhostButton onClick={() => { setShowLogView((prev) => !prev); }}>
              {showLogView ? "Show Image" : "Show Log"}
            </Modal.GhostButton>
          ) : null}
        </div>
        <div className={css.footerRight}>
          {showOpenInNewTab ? (
            <Modal.SecondaryButton disabled={phase !== "done"} onClick={openInNewTab}>
              Open in New Tab
            </Modal.SecondaryButton>
          ) : null}
          <Modal.PrimaryButton disabled={phase !== "done"} onClick={downloadSvg}>
            Download SVG
          </Modal.PrimaryButton>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
