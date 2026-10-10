import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { scanTexRecovery, type TexVirtualCloser } from "../text/tex/recovery.js";
import type { BeamerFrameBodyIr } from "./content-types.js";
import type {
  BeamerEditScope,
  BeamerRecovery,
  BeamerFrameModel,
  BeamerMetadataFieldModel,
  BeamerMetadataFieldName,
} from "./types.js";

const TITLE_PAGE_METADATA_FIELDS: readonly BeamerMetadataFieldName[] = [
  "title",
  "subtitle",
  "author",
  "institute",
  "date",
];

/**
 * Editing scopes for one frame, per design/beamer-canvas-editing.md: a
 * canvas editing session's buffer is the full span of the nearest container
 * scope — a column's content, the frame title argument, else the whole
 * frame body. Blocks and theorems are deliberately not scopes. Frames that
 * show the title page additionally expose one scope per preamble metadata
 * field, so clicking rendered title-page text patches the preamble.
 */
export function collectBeamerEditScopes(
  frame: BeamerFrameModel,
  bodyIr: BeamerFrameBodyIr,
  metadata: Partial<
    Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>
  > = {}
): BeamerEditScope[] {
  const scopes: BeamerEditScope[] = [];
  if (frame.title) {
    scopes.push({
      kind: "frame-title",
      id: `${frame.id}:scope:title`,
      span: frame.title.contentSpan,
    });
  }
  if (bodyIr.children.some((node) => node.kind === "title-page")) {
    for (const field of TITLE_PAGE_METADATA_FIELDS) {
      const value = metadata[field]?.value;
      if (!value || value.contentSpan.to <= value.contentSpan.from) {
        continue;
      }
      scopes.push({
        kind: "preamble-field",
        id: `${frame.id}:scope:preamble:${field}`,
        span: value.contentSpan,
      });
    }
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

/**
 * What TeX recovery closes or drops in a frame's edit scopes (T5), in
 * document coordinates: the canvas draws the missing closers as ghosts
 * (T2) and offers to write them in when a session ends (T6). Nested
 * scopes are covered by the scope around them.
 */
export function collectBeamerRecovery(source: string, scopes: readonly BeamerEditScope[]): BeamerRecovery {
  const closers: TexVirtualCloser[] = [];
  const strays: Span[] = [];
  const outermost = scopes.filter((scope) => !scopes.some((other) => other !== scope &&
    other.span.from <= scope.span.from && scope.span.to <= other.span.to &&
    (other.span.from < scope.span.from || scope.span.to < other.span.to)));
  for (const scope of outermost) {
    const offset = scope.span.from;
    const recovery = scanTexRecovery(source.slice(scope.span.from, scope.span.to));
    closers.push(...recovery.closers.map((closer) => ({
      ...closer,
      opener: { from: closer.opener.from + offset, to: closer.opener.to + offset },
      at: closer.at + offset,
    })));
    strays.push(...recovery.strays.map((stray) => ({ from: stray.from + offset, to: stray.to + offset })));
  }
  return { closers, strays };
}

/** Recovery as diagnostics, for the frame's warning badge (T5). */
export function beamerRecoveryDiagnostics(recovery: BeamerRecovery): Diagnostic[] {
  return [
    ...recovery.closers.map((closer): Diagnostic => ({
      severity: "warning",
      code: "tex-missing-closer",
      message: `Missing ${closer.closer}: closed where its ${closer.kind === "group" ? "paragraph" : closer.kind === "delimiter" ? "formula" : "formula's paragraph"} ends`,
      span: { from: closer.opener.from, to: closer.at },
    })),
    ...recovery.strays.map((stray): Diagnostic => ({
      severity: "warning",
      code: "tex-unmatched-delimiter",
      message: "Unmatched delimiter, shown as source",
      span: stray,
    })),
  ];
}
