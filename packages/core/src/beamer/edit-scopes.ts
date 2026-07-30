import type { BeamerFrameBodyIr } from "./content-types.js";
import type { BeamerEditScope, BeamerFrameModel } from "./types.js";

/**
 * Editing scopes for one frame, per design/beamer-canvas-editing.md: a
 * canvas editing session's buffer is the full span of the nearest container
 * scope — a column's content, the frame title argument, else the whole
 * frame body. Blocks and theorems are deliberately not scopes.
 */
export function collectBeamerEditScopes(
  frame: BeamerFrameModel,
  bodyIr: BeamerFrameBodyIr
): BeamerEditScope[] {
  const scopes: BeamerEditScope[] = [];
  if (frame.title) {
    scopes.push({
      kind: "frame-title",
      id: `${frame.id}:scope:title`,
      span: frame.title.contentSpan,
    });
  }
  for (const node of bodyIr.children) {
    if (node.kind !== "columns") {
      continue;
    }
    for (const column of node.columns) {
      scopes.push({
        kind: "column",
        id: `${column.id}:scope`,
        span: column.bodySpan,
      });
    }
  }
  scopes.push({
    kind: "frame-body",
    id: `${frame.id}:scope:body`,
    span: frame.bodySpan,
  });
  return scopes;
}

/**
 * The scope owning a document offset: the smallest scope span containing
 * it. Column spans nest inside the body span, so smallest-wins implements
 * the nearest-container rule.
 */
export function resolveBeamerEditScopeAt(
  scopes: readonly BeamerEditScope[],
  offset: number
): BeamerEditScope | null {
  let best: BeamerEditScope | null = null;
  for (const scope of scopes) {
    if (offset < scope.span.from || offset > scope.span.to) {
      continue;
    }
    const size = scope.span.to - scope.span.from;
    if (!best || size < best.span.to - best.span.from) {
      best = scope;
    }
  }
  return best;
}
