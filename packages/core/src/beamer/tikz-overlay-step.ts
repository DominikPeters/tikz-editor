import type { Span } from "../ast/types.js";
import { maskTikzPictureSource } from "../document/masking.js";
import type { OverlayStatementVisibility } from "../semantic/types.js";
import { tikzOverlayTrace } from "./tikz-overlay-trace.js";
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
  readonly overlayVisibility?: (span: Span, instance: readonly number[]) => OverlayStatementVisibility;
  /**
   * What the frame's rules hide or remove in the picture on this step, as
   * text relative to the picture's start, a loop's rules once per iteration.
   * Empty when every statement is there. Two steps (or two edits) with the
   * same key treat the same statements alike, so an evaluation cached for
   * one serves the other.
   */
  readonly overlayKey: string;
  /** Whether the statement at a span stands under an overlay rule of the frame. */
  readonly ruled?: (span: Span) => boolean;
};

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
  const overlayVisibility = (statement: Span, instance: readonly number[] = []) => resolveBeamerOverlaySpanVisibility(overlays, statement, step, instance);
  const regions = [...overlays.commands.flatMap(command => command.branches.map(branch => branch.contentSpan)),
    ...overlays.pauses.map(pause => pause.contentSpan), ...overlays.items.map(item => item.contentSpan)]
    .filter(region => within(region, span) && region.to > region.from);
  // Where each rule starts to hold, asked as the iteration that performs it would ask.
  const effects = [
    ...overlays.commands.flatMap(command => command.branches.map(branch => ({ at: branch.contentSpan.from, to: branch.contentSpan.to, instance: command.instance ?? [] }))),
    ...overlays.pauses.map(pause => ({ at: pause.contentSpan.from, to: pause.contentSpan.to, instance: pause.instance ?? [] })),
    ...overlays.items.map(item => ({ at: item.contentSpan.from, to: item.contentSpan.to, instance: [] as readonly number[] })),
  ].filter(effect => within({ from: effect.at, to: effect.to }, span) && effect.to > effect.at);
  const inside = overlays.commands.some(command => command.commandSpan.from >= span.from && command.commandSpan.from < span.to) ||
    overlays.pauses.some(pause => pause.span.from >= span.from && pause.span.from < span.to) ||
    (overlays.switches ?? []).some(entry => entry.commandSpan.from >= span.from && entry.commandSpan.from < span.to);
  return {
    source: inside
      ? maskTikzPictureSource(projectBeamerTikzSource(source, span, overlays, step, tikzOverlayTrace(source, span).statementStarts), span)
      : masked,
    overlayVisibility,
    ruled: (statement) => regions.some(region => region.from <= statement.from && statement.to <= region.to),
    // Only what is hidden or removed: on a step that shows everything, edits keep the key.
    overlayKey: effects.flatMap(({ at, to, instance }) => {
      const state = overlayVisibility({ from: at, to: at }, instance);
      return state === "visible" ? [] : [`${at - span.from}-${to - span.from}${instance.length ? `@${instance.join(".")}` : ""}${state[0]}`];
    }).join(","),
  };
}
