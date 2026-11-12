import { create } from "zustand";
import { beamerBuildStateAt, type BeamerBuildModel, type BeamerFrameLayout, type BeamerRect } from "@tikz-editor/core/beamer/index";
import type { Span } from "@tikz-editor/core/ast/types";
import { computeBounds } from "@tikz-editor/core/semantic/evaluate";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import { buildSelectionRects } from "../builds-panel/build-selection";
import { worldToSvgY } from "./geometry";

/** Whether the Overlays panel is on screen: its tab is the one shown. */
export const useOverlaysPanelShown = create<{ shown: boolean; setShown: (shown: boolean) => void }>((set) => ({
  shown: false,
  setShown: (shown) => { set((state) => state.shown === shown ? state : { shown }); },
}));

/** A step tag: the steps of an object with an overlay rule of its own, at the object. */
export type StepTag = {
  /** The rule's row in the Overlays panel. */
  readonly rowId: string;
  /** The steps as the source says them, `2-`. */
  readonly label: string;
  /** What the rule's object draws on this step, in canvas SVG coordinates. */
  readonly bounds: BeamerRect;
};

function union(rects: readonly BeamerRect[]): BeamerRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x)), y = Math.min(...rects.map((rect) => rect.y));
  return { x, y, width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x, height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y };
}

/**
 * The tags of a frame's rules on `step`: one per rule with a specification
 * of its own whose content is drawn on the step. `boundsOf` gives what the
 * source ranges of a rule draw.
 */
function stepTags(model: BeamerBuildModel, step: number, boundsOf: (spans: readonly Span[]) => readonly BeamerRect[]): StepTag[] {
  return model.rows.flatMap((row) => {
    // A list's default and the branches of an alternative are told by their owner's row.
    if (row.kind !== "content" || !row.spec || row.provenance === "list-default") return [];
    const bounds = union(boundsOf(beamerBuildStateAt(model, row, step).contentSpans));
    return bounds ? [{ rowId: row.id, label: row.spec.source.value.trim(), bounds }] : [];
  });
}

/** Step tags for a slide. */
export function slideStepTags(model: BeamerBuildModel, layout: BeamerFrameLayout): StepTag[] {
  return stepTags(model, layout.step, (spans) => buildSelectionRects(layout, model.source, spans));
}

/** Step tags for a slide picture edited on its own, from what its statements draw. */
export function pictureStepTags(model: BeamerBuildModel, step: number, elements: readonly SceneElement[], viewBox: { readonly y: number; readonly height: number }): StepTag[] {
  return stepTags(model, step, (spans) => {
    const drawn = elements.filter((element) => !element.overlayCovered &&
      spans.some((span) => span.from <= element.sourceRef.sourceSpan.from && element.sourceRef.sourceSpan.to <= span.to));
    const bounds = drawn.length ? computeBounds(drawn) : undefined;
    return bounds ? [{ x: bounds.minX, y: worldToSvgY(bounds.maxY, viewBox), width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }] : [];
  });
}

/** The tag whose object is under a point, the smallest when several are. */
export function stepTagAt(tags: readonly StepTag[], point: { readonly x: number; readonly y: number }): StepTag | null {
  return tags.filter(({ bounds }) => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height)
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] ?? null;
}
