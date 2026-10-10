export {
  createPositionIndex,
  positionOffset,
  type Affinity,
  type Position,
  type PositionIndex,
} from "./position.js";
export { promotedOffsets, promoteSelection, selectionEndsAt, type SelectionEnds } from "./selection.js";
export { createEditView, type EditView, type EditViewOptions } from "./view.js";
export { renderedVisibility, type RenderedStops } from "./rendered.js";
export { createEditViewCache, type EditViewCache } from "./view-cache.js";
export { caretContext, caretEdge, type CaretEdge, type ContextCrumb } from "./context.js";
