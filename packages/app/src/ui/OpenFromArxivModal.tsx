import { useEffect, useMemo, useState } from "react";
import type { RenderTikzToSvgResult } from "tikz-editor/render/index";
import {
  extractArxivTikzCandidates,
  type ArxivPaperSession,
  type ArxivTikzCandidate
} from "../arxiv-source";
import { getActiveEditorPlatform } from "../platform/current";
import { Modal } from "./Modal";
import css from "./OpenFromArxivModal.module.css";

type OpenFromArxivModalProps = {
  session: ArxivPaperSession;
  onSessionChange: (session: ArxivPaperSession) => void;
  onClose: () => void;
  onOpenCandidate: (candidate: ArxivTikzCandidate) => void;
};

type CandidatePreview =
  | { status: "loading" }
  | { status: "ready"; svg: string; warningCount: number; errorCount: number; message: string | null }
  | { status: "failed"; message: string };

type CandidatePreviewMap = Record<string, CandidatePreview>;

function formatFileCount(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function formatCandidateCount(count: number): string {
  return `${count} picture${count === 1 ? "" : "s"}`;
}

function candidateLocation(candidate: ArxivTikzCandidate): string {
  return candidate.lineStart === candidate.lineEnd
    ? `${candidate.path}:${candidate.lineStart}`
    : `${candidate.path}:${candidate.lineStart}-${candidate.lineEnd}`;
}

function countDiagnostics(
  result: RenderTikzToSvgResult,
  severity: "error" | "warning"
): number {
  return (
    result.parse.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length +
    result.semantic.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length +
    result.renderDiagnostics.filter((diagnostic) => diagnostic.severity === severity).length
  );
}

function firstErrorMessage(
  result: RenderTikzToSvgResult
): string | null {
  return (
    result.parse.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ??
    result.semantic.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ??
    result.renderDiagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ??
    null
  );
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function OpenFromArxivModal({
  session,
  onSessionChange,
  onClose,
  onOpenCandidate
}: OpenFromArxivModalProps) {
  const [input, setInput] = useState(session.input.length > 0 ? session.input : (session.paper?.id ?? ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(session.selectedCandidateId);
  const [previews, setPreviews] = useState<CandidatePreviewMap>({});
  const candidates = useMemo(
    () => session.paper ? extractArxivTikzCandidates(session.paper) : [],
    [session.paper]
  );
  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    candidates[0] ??
    null;
  const fetchArxivSource = getActiveEditorPlatform().files?.fetchArxivSource;
  const canLoad = input.trim().length > 0 && !loading && typeof fetchArxivSource === "function";
  const canOpen = selectedCandidate != null && !loading;

  useEffect(() => {
    if (candidates.length === 0) {
      setPreviews({});
      return;
    }

    let cancelled = false;
    setPreviews(Object.fromEntries(candidates.map((candidate) => [candidate.id, { status: "loading" }])));

    void (async () => {
      const { renderTikzToSvgAsync } = await import("tikz-editor/render/index");
      await Promise.all(candidates.map(async (candidate) => {
        try {
          const result = await renderTikzToSvgAsync(candidate.contextualSource, {
            parse: { recover: true, includeContextDefinitions: true },
            svg: { padding: 18 }
          });
          if (cancelled) {
            return;
          }
          setPreviews((current) => ({
            ...current,
            [candidate.id]: {
              status: "ready",
              svg: result.svg.svg,
              warningCount: countDiagnostics(result, "warning"),
              errorCount: countDiagnostics(result, "error"),
              message: firstErrorMessage(result)
            }
          }));
        } catch (renderError) {
          if (cancelled) {
            return;
          }
          setPreviews((current) => ({
            ...current,
            [candidate.id]: {
              status: "failed",
              message: renderError instanceof Error ? renderError.message : String(renderError)
            }
          }));
        }
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [candidates]);

  async function loadPaper(): Promise<void> {
    if (!canLoad || !fetchArxivSource) {
      return;
    }
    const nextInput = input.trim();
    setLoading(true);
    setError(null);
    try {
      const paper = await fetchArxivSource(nextInput);
      const nextSession: ArxivPaperSession = {
        input: nextInput,
        paper,
        selectedCandidateId: null
      };
      onSessionChange(nextSession);
      setSelectedCandidateId(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  function openSelectedCandidate(): void {
    if (!selectedCandidate) {
      return;
    }
    openCandidate(selectedCandidate);
  }

  function openCandidate(candidate: ArxivTikzCandidate): void {
    const nextSession: ArxivPaperSession = {
      input: session.input,
      paper: session.paper,
      selectedCandidateId: candidate.id
    };
    onSessionChange(nextSession);
    onOpenCandidate(candidate);
  }

  return (
    <Modal
      onClose={onClose}
      size="xl"
      labelledBy="open-from-arxiv-title"
      dataTestId="open-from-arxiv-modal"
      className={css.dialog}
    >
      <Modal.Header
        title="Open from arXiv"
        titleId="open-from-arxiv-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close arXiv dialog"
      />
      <Modal.Body padding="none">
        <div className={css.layout}>
          <form
            className={css.searchRow}
            onSubmit={(event) => {
              event.preventDefault();
              void loadPaper();
            }}
          >
            <input
              className={css.input}
              type="text"
              value={input}
              onChange={(event) => { setInput(event.target.value); }}
              onFocus={(event) => { event.currentTarget.select(); }}
              placeholder="1706.03762 or https://arxiv.org/abs/1706.03762"
              disabled={loading}
              aria-label="arXiv URL or ID"
            />
            <Modal.PrimaryButton
              className={css.loadButton}
              disabled={!canLoad}
              onClick={() => { void loadPaper(); }}
            >
              {loading ? "Loading" : "Open"}
            </Modal.PrimaryButton>
          </form>

          {error ? <div className={css.error}>{error}</div> : null}

          {session.paper ? (
            <div className={css.paperBar}>
              <div>
                <div className={css.paperId}>{session.paper.id}</div>
                <div className={css.paperMeta}>
                  {formatFileCount(session.paper.files.length)} · {formatCandidateCount(candidates.length)}
                </div>
              </div>
              <a
                className={css.paperLink}
                href={`https://arxiv.org/abs/${session.paper.id}`}
                target="_blank"
                rel="noreferrer"
              >
                arXiv
              </a>
            </div>
          ) : null}

          <div className={css.content}>
            <div className={css.gallery} role="listbox" aria-label="TikZ pictures">
              {candidates.map((candidate, index) => {
                const selected = selectedCandidate?.id === candidate.id;
                const preview = previews[candidate.id] ?? { status: "loading" };
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`${css.card} ${selected ? css.selected : ""}`}
                    onClick={() => { setSelectedCandidateId(candidate.id); }}
                    onDoubleClick={() => { openCandidate(candidate); }}
                    role="option"
                    aria-selected={selected}
                  >
                    <span className={css.cardIndex}>{index + 1}</span>
                    <span className={css.previewFrame}>
                      {preview.status === "ready" ? (
                        <img
                          className={css.previewImage}
                          src={svgToDataUri(preview.svg)}
                          alt=""
                          draggable={false}
                        />
                      ) : preview.status === "failed" ? (
                        <span className={css.previewMessage}>{preview.message}</span>
                      ) : (
                        <span className={css.previewMessage}>Rendering</span>
                      )}
                    </span>
                    <span className={css.cardFooter}>
                      <span className={css.cardPath}>{candidateLocation(candidate)}</span>
                      {preview.status === "ready" && (preview.errorCount > 0 || preview.warningCount > 0) ? (
                        <span className={preview.errorCount > 0 ? css.errorBadge : css.warningBadge}>
                          {preview.errorCount > 0
                            ? `${preview.errorCount} error${preview.errorCount === 1 ? "" : "s"}`
                            : `${preview.warningCount} warning${preview.warningCount === 1 ? "" : "s"}`}
                        </span>
                      ) : null}
                    </span>
                    {preview.status === "ready" && preview.message ? (
                      <span className={css.cardMessage}>{preview.message}</span>
                    ) : null}
                  </button>
                );
              })}
              {session.paper && candidates.length === 0 ? (
                <div className={css.empty}>No tikzpicture environments found.</div>
              ) : null}
              {!session.paper && !loading ? (
                <div className={css.empty}>Enter an arXiv ID to load source files.</div>
              ) : null}
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.SecondaryButton onClick={onClose}>Cancel</Modal.SecondaryButton>
        <Modal.PrimaryButton onClick={openSelectedCandidate} disabled={!canOpen}>
          Open Picture
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}
