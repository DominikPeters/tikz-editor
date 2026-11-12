import type { Span } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import { maskTikzPictureSource } from "../document/masking.js";
import { parseTikz } from "../parser/index.js";
import type { OverlayStatementVisibility } from "../semantic/types.js";
import { projectBeamerTikzSource, resolveBeamerOverlaySpanVisibility, type BeamerOverlayModel } from "./overlay.js";

/** A slide picture on one overlay step, for the TikZ pipeline. */
export type BeamerTikzStep = {
  /**
   * The document masked to the picture. Overlay commands at statement level
   * are as written, for the parser; those inside a statement (in node text or
   * option values) are resolved for the step, as in the slide's own text.
   * Offsets are the authored source's.
   */
  readonly source: string;
  /** What the evaluator does with each statement on this step; absent when the frame has no overlays. */
  readonly overlayVisibility?: (span: Span) => OverlayStatementVisibility;
  /**
   * What `overlayVisibility` hides or removes, as text relative to the
   * picture's start: two steps (or two edits) with the same key treat the
   * same statements alike, so an evaluation cached for one serves the other.
   */
  readonly overlayKey: string;
};

let structuralStarts: { masked: string; starts: ReadonlySet<number> } | null = null;

/** Where the picture's statement-level overlay commands start: those its parser reads and its evaluator applies. */
function statementOverlayStarts(masked: string): ReadonlySet<number> {
  if (structuralStarts?.masked === masked) return structuralStarts.starts;
  const starts = new Set<number>();
  walkStatements(parseTikz(masked, { recover: true }).figure.body, {
    onStatement: (statement) => {
      if (statement.kind === "OverlayGroup" || statement.kind === "OverlayDeclaration" ||
        (statement.kind === "Path" && statement.overlay)) starts.add(statement.span.from);
    }
  });
  structuralStarts = { masked, starts };
  return starts;
}

function within(span: Span, picture: Span): boolean {
  return span.from < picture.to && span.to > picture.from;
}

/**
 * The picture at `span` on `step`. The slide renderer, the picture's edit
 * snapshot and its edit actions all take the picture this way, so they agree
 * on what is there.
 */
export function beamerTikzStep(source: string, span: Span, overlays: BeamerOverlayModel, step: number): BeamerTikzStep {
  const masked = maskTikzPictureSource(source, span);
  const touched = overlays.commands.some(command => within(command.span, span)) ||
    overlays.pauses.some(pause => within(pause.span, span) || within(pause.contentSpan, span)) ||
    overlays.items.some(item => within(item.contentSpan, span)) ||
    (overlays.switches ?? []).some(entry => within(entry.commandSpan, span)) ||
    overlays.referenceSpecs.some(reference => reference.contentSpan !== undefined && within(reference.contentSpan, span));
  if (!touched) return { source: masked, overlayKey: "" };
  const overlayVisibility = (statement: Span) => resolveBeamerOverlaySpanVisibility(overlays, statement, step);
  const regions = [...overlays.commands.flatMap(command => command.branches.map(branch => branch.contentSpan)),
    ...overlays.pauses.map(pause => pause.contentSpan), ...overlays.items.map(item => item.contentSpan)]
    .filter(region => within(region, span) && region.to > region.from);
  const inside = overlays.commands.some(command => command.commandSpan.from >= span.from && command.commandSpan.from < span.to) ||
    overlays.pauses.some(pause => pause.span.from >= span.from && pause.span.from < span.to) ||
    (overlays.switches ?? []).some(entry => entry.commandSpan.from >= span.from && entry.commandSpan.from < span.to);
  return {
    source: inside
      ? maskTikzPictureSource(projectBeamerTikzSource(source, span, overlays, step, statementOverlayStarts(masked)), span)
      : masked,
    overlayVisibility,
    // Only what is hidden or removed: on a step that shows everything, edits keep the key.
    overlayKey: regions.flatMap(region => {
      const state = overlayVisibility(region);
      return state === "visible" ? [] : [`${region.from - span.from}-${region.to - span.from}${state[0]}`];
    }).join(","),
  };
}
