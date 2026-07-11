import type { Span } from "@tikz-editor/core/ast/types";
import type { SceneElement, SceneFigure } from "@tikz-editor/core/semantic/types";

export function buildRepeatPreviewScene(
  scene: SceneFigure | null,
  previewGroupSpan: Span
): SceneFigure | null {
  if (!scene) {
    return null;
  }
  const previewElements = scene.elements.filter((element) => isRepeatPreviewElement(element, previewGroupSpan));
  if (previewElements.length === 0) {
    return null;
  }
  return {
    ...scene,
    elements: previewElements
  };
}

function isRepeatPreviewElement(element: SceneElement, previewGroupSpan: Span): boolean {
  const foreachStack = element.origin?.foreachStack ?? [];
  if (foreachStack.length === 0) {
    return false;
  }
  const belongsToPreviewBlock = foreachStack.some((frame) => spansOverlap(frame.loopSpan, previewGroupSpan));
  if (!belongsToPreviewBlock) {
    return false;
  }
  return foreachStack.some((frame) => frame.iterationIndex !== 0);
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}
