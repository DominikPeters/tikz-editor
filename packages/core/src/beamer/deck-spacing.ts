import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { texDimensionUnitFactor } from "../text/tex/dimensions.js";
import { beamerControlSequencesIn, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerFrameLayout, BeamerSpacingLayout } from "./types.js";

export type BeamerSpacingTarget = BeamerSpacingLayout & {
  id: string;
  value: number;
  unit: string;
  unitPt: number;
  numericSpan?: Span;
};

/** Match rendered material back to an exact authored command before offering an edit. */
export function beamerSpacingTargets(source: string, layout: BeamerFrameLayout): BeamerSpacingTarget[] {
  const context = createBeamerSyntaxContext(source);
  const targets: BeamerSpacingTarget[] = [];
  const seen = new Set<number>();
  for (const spacing of layout.spacing ?? []) {
    if (seen.has(spacing.sourceSpan.from)) continue;
    const command = beamerControlSequencesIn(context, spacing.sourceSpan)[0];
    if (command?.from !== spacing.sourceSpan.from || command.name !== spacing.command) continue;
    if (command.starred && command.name !== "vspace") continue;
    let value = spacing.sizePt;
    let unit = "pt";
    let unitPt = 1;
    let numericSpan: Span | undefined;
    if (command.name === "vspace") {
      const argument = beamerRequiredArgumentAfter(context, command.to, spacing.sourceSpan.to);
      if (argument?.span.to !== spacing.sourceSpan.to) continue;
      const match = /^(\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+))(\s*)([a-z]+)\s*$/u.exec(argument.value);
      if (!match) continue;
      value = Number(match[2]); unit = match[4];
      unitPt = (unit === "em" || unit === "ex" ? spacing.relativeUnitPt : texDimensionUnitFactor(unit)) ?? 0;
      if (!Number.isFinite(value) || !(unitPt > 0)) continue;
      // A handle must describe the same fixed amount as the rendered source.
      if (Math.abs(value * unitPt - spacing.sizePt) > .001) continue;
      const from = argument.contentSpan.from + match[1].length;
      numericSpan = { from, to: from + match[2].length };
    } else if (command.to !== spacing.sourceSpan.to) continue;
    seen.add(spacing.sourceSpan.from);
    targets.push({ ...spacing, id: `spacing:${spacing.sourceSpan.from}`, value, unit, unitPt, numericSpan });
  }
  return targets;
}

export function beamerSpacingResizePatches(source: string, target: BeamerSpacingTarget, deltaPt: number): SourcePatch[] {
  if (!Number.isFinite(deltaPt) || Math.abs(deltaPt) < 1e-6) return [];
  const value = Number((target.value + deltaPt / target.unitPt).toFixed(4));
  if (value === target.value) return [];
  let span = target.numericSpan ?? target.sourceSpan;
  if (!target.numericSpan && target.horizontal && !/\s/u.test(source[target.sourceSpan.from - 1] ?? "")) {
    // A control word consumes following whitespace during TeX tokenization.
    // Preserve that behavior when replacing it with a braced command. Blank
    // lines remain intact because they represent a paragraph break.
    const following = /^\s*/u.exec(source.slice(span.to))?.[0] ?? "";
    if (!/\n[ \t\r]*\n/u.test(following)) span = { ...span, to: span.to + following.length };
  }
  let number = String(value);
  const previous = source.slice(span.from, span.to);
  if (/^[+-]?\./u.test(previous)) number = number.replace(/^(-?)0\./u, "$1.");
  const replacement = target.numericSpan ? number : `\\vspace{${number}pt}`;
  return [{ oldSpan: span, newSpan: { from: span.from, to: span.from + replacement.length }, replacement }];
}
