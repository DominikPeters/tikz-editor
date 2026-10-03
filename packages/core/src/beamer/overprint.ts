import type { Span } from "../ast/types.js";
import { concatMappedText, createGeneratedMappedText, createIdentityMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";
import { beamerOverlaySpecContains, projectBeamerOverlayText, type BeamerOverlayModel } from "./overlay.js";

/** Each overprint alternative is a top-aligned minipage; all alternatives
 * contribute their dimensions, but only the selected box is shipped. */
export function projectBeamerOverprints(params: {
  mapped: MappedText;
  sourceSpan: Span;
  overlays: BeamerOverlayModel;
  step: number;
  width: (raw: string | undefined) => number | null;
  measure: (body: MappedText, width: number) => { height: number; depth: number } | null;
}): MappedText {
  let mapped = params.mapped;
  for (const overprint of [...params.overlays.overprints ?? []].reverse()) {
    if (overprint.span.from < params.sourceSpan.from || overprint.span.to > params.sourceSpan.to) continue;
    const indices = mapped.sourceMap.charOrigins.flatMap((origin, index) => origin.kind === "direct" && origin.from >= overprint.span.from && origin.to <= overprint.span.to ? [index] : []);
    const width = params.width(overprint.width?.value);
    if (!indices.length || width === null || !overprint.branches.length) continue;
    const active = overprint.branches.filter(branch => beamerOverlaySpecContains(branch.spec, params.step));
    if (active.length > 1) continue; // Beamer reports an overlapping-overprint error.
    let height = 0, depth = 0;
    let selected: MappedText | null = null;
    let selectedHeight = 0;
    let valid = true;
    for (const branch of overprint.branches) {
      const body = branch.branches[0];
      const ownStep = branch === active[0] ? params.step : branch.spec.minimumStep ?? 1;
      const projected = projectBeamerOverlayText(createIdentityMappedText(body.value, body.contentSpan.from), body.contentSpan, params.overlays, ownStep).mapped;
      const measured = params.measure(projected, width);
      if (!measured) { valid = false; break; }
      height = Math.max(height, measured.height);
      depth = Math.max(depth, measured.depth);
      if (branch === active[0]) { selected = projected; selectedHeight = measured.height; }
    }
    if (!valid) continue;
    const owner = overprint.span;
    const start = indices[0], end = indices.at(-1)! + 1;
    const generated = (text: string) => createGeneratedMappedText(text, "Beamer overprint minipage dimensions", owner);
    mapped = concatMappedText([
      sliceMappedText(mapped, 0, start),
      generated(`\\raisebox{${height - selectedHeight}pt}[${height}pt][${depth}pt]{\\scalebox{1}{\\begin{minipage}[t]{${width}pt}\\raggedright `),
      selected ?? generated(""),
      generated("\\end{minipage}}}"),
      sliceMappedText(mapped, end, mapped.text.length),
    ]);
  }
  return mapped;
}
