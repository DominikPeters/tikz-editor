import type { Span } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import { maskTikzPictureSource } from "../document/masking.js";
import { parseTikz } from "../parser/index.js";
import { resolveBeamerOverlaySpanVisibility, scanBeamerFrameOverlays } from "./overlay.js";
import { scanBeamerDocument } from "./scan.js";

/** A slide picture in one revision of its document. */
export type BeamerPictureRevision = { readonly source: string; readonly frameIndex: number; readonly span: Span };

/** The path statements of a picture, each with what it is on every step: a letter per step, visible, hidden or removed. */
function statementSteps(picture: BeamerPictureRevision, stepCount: number): { text: string; steps: string }[] | null {
  const frame = scanBeamerDocument(picture.source).frames[picture.frameIndex];
  if (!frame) return null;
  const overlays = scanBeamerFrameOverlays(picture.source, frame);
  const statements: { text: string; steps: string }[] = [];
  walkStatements(parseTikz(maskTikzPictureSource(picture.source, picture.span), { recover: true }).figure.body, {
    onStatement: (statement) => {
      if (statement.kind !== "Path") return;
      let steps = "";
      for (let step = 1; step <= stepCount; step += 1) steps += resolveBeamerOverlaySpanVisibility(overlays, statement.span, step)[0];
      statements.push({ text: picture.source.slice(statement.span.from, statement.span.to), steps });
    }
  });
  return statements;
}

/** How many steps a frame has. */
function frameStepCount(source: string, frameIndex: number): number {
  const frame = scanBeamerDocument(source).frames[frameIndex];
  return frame ? scanBeamerFrameOverlays(source, frame).stepCount : 1;
}

/**
 * A statement an edit left as written but whose steps it changed, or null.
 *
 * An edit that reorders, groups, pastes or deletes in a picture can move a
 * statement past a `\pause` or `\onslide`, out of a scope that bounded one,
 * or shift the `+` specifications after it: the statement's text is the
 * same and it now appears on other steps. Statements are matched by their
 * text; one the edit rewrote is not compared.
 */
export function beamerPictureStepsChanged(before: BeamerPictureRevision, after: BeamerPictureRevision): { readonly text: string } | null {
  const beforeCount = frameStepCount(before.source, before.frameIndex);
  const afterCount = frameStepCount(after.source, after.frameIndex);
  // A frame with one step before and after has nothing to change.
  if (beforeCount < 2 && afterCount < 2) return null;
  const stepCount = Math.min(Math.max(beforeCount, afterCount), 64);
  const was = statementSteps(before, stepCount), is = statementSteps(after, stepCount);
  if (!was || !is) return null;
  const byText = (statements: readonly { text: string; steps: string }[]) => {
    const map = new Map<string, string[]>();
    for (const { text, steps } of statements) map.set(text, [...(map.get(text) ?? []), steps]);
    for (const steps of map.values()) steps.sort();
    return map;
  };
  const wasByText = byText(was), isByText = byText(is);
  for (const [text, steps] of wasByText) {
    const now = isByText.get(text);
    // A duplicate or a deletion of statements written alike leaves no way to pair them up.
    if (now?.length !== steps.length) continue;
    if (steps.some((value, index) => value !== now[index])) return { text };
  }
  return null;
}
