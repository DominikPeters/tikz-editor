import type { Span } from "@tikz-editor/core/ast/types";
import { beamerTikzStep, scanBeamerDocument, scanBeamerFrameOverlays, type BeamerDocumentModel } from "@tikz-editor/core/beamer/index";
import type { EvaluateOptions } from "@tikz-editor/core/semantic/types";

/** The frame and overlay step a slide picture's snapshot was evaluated on, when the step hides part of it. */
export type PictureOverlayStep = { readonly frameIndex: number; readonly step: number };

let scanned: { source: string; document: BeamerDocumentModel } | null = null;

/**
 * What the snapshot's overlay step does to the statements of the picture at
 * `span`: an edit evaluates the picture as the snapshot showed it, so what
 * is absent on the step neither moves nor is measured. `source` is the
 * document the edit works on (with a pending drawing layer inserted).
 */
export function pictureOverlayVisibility(
  source: string,
  span: Span | null | undefined,
  pictureStep: PictureOverlayStep | null | undefined
): Pick<EvaluateOptions, "overlayVisibility"> {
  if (!span || !pictureStep) return {};
  if (scanned?.source !== source) scanned = { source, document: scanBeamerDocument(source) };
  const frame = scanned.document.frames[pictureStep.frameIndex];
  if (!frame) return {};
  const overlayVisibility = beamerTikzStep(source, span, scanBeamerFrameOverlays(source, frame), pictureStep.step).overlayVisibility;
  return overlayVisibility ? { overlayVisibility } : {};
}
