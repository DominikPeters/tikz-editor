import { RiArrowRightUpLine } from "@remixicon/react";
import { useId } from "react";
import type { BeamerSlideMoveAnalysis, BeamerSlideMoveExcerpt } from "@tikz-editor/core/beamer/index";
import { Modal } from "../Modal";
import css from "./SlideMoveReview.module.css";

export function SlideMoveReview({ analysis, onClose, onConfirm, onReveal }: {
  analysis: BeamerSlideMoveAnalysis;
  onClose: () => void;
  onConfirm: () => void;
  onReveal: (span: BeamerSlideMoveExcerpt["span"]) => void;
}) {
  const titleId = useId();
  return <Modal size="md" labelledBy={titleId} onClose={onClose} dataTestId="slide-move-review">
    <Modal.Header title={analysis.status === "blocked" ? "Cannot move slides" : "Review slide move"} titleId={titleId} />
    <Modal.Body>
      <div className={css.issues}>
        {analysis.issues.map((issue, index) => <section className={css.issue} key={index}>
          <p>{issue.message}</p>
          {issue.excerpts.map((excerpt, index) => <button type="button" key={index} className={css.excerpt}
            onClick={() => { onReveal(excerpt.span); }} aria-label={`Show source: ${excerpt.label}, line ${excerpt.line}`}>
            <span className={css.caption}>{excerpt.label} · Line {excerpt.line}<span>Show source <RiArrowRightUpLine size={12} aria-hidden /></span></span>
            <code>{excerpt.text}</code>
          </button>)}
        </section>)}
      </div>
    </Modal.Body>
    <Modal.Footer>
      <Modal.SecondaryButton autoFocus onClick={onClose}>{analysis.status === "blocked" ? "Close" : "Cancel"}</Modal.SecondaryButton>
      {analysis.status === "review" ? <Modal.PrimaryButton onClick={onConfirm}>Move anyway</Modal.PrimaryButton> : null}
    </Modal.Footer>
  </Modal>;
}
