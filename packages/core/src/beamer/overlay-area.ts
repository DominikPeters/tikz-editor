import type { MappedText } from "../text/source-map.js";
import { concatMappedText, createGeneratedMappedText, sliceMappedText } from "../text/source-map.js";
import { beamerSyntaxContext, beamerEnvironmentBoundariesIn, beamerRequiredArgumentAfter, type BeamerEnvironmentBoundary } from "./syntax.js";

/** Lower the fixed outer vbox and top-aligned minipage from
 * beamerbaseoverlay.sty. Overlay projection has already selected the body. */
export function projectBeamerOverlayAreas(mapped: MappedText, params: {
  dimension: (raw: string) => number | null;
  firstHeight: (body: MappedText, width: number) => number | null;
}): MappedText {
  if (!mapped.text.includes("overlayarea")) return mapped;
  const context = beamerSyntaxContext(mapped.text);
  const starts: BeamerEnvironmentBoundary[] = [];
  const pieces: MappedText[] = [];
  let cursor = 0;
  for (const token of beamerEnvironmentBoundariesIn(context, { from: 0, to: mapped.text.length })) {
    if (token.name !== "overlayarea") continue;
    if (token.kind === "begin") { starts.push(token); continue; }
    const begin = starts.pop();
    if (!begin || starts.length) continue;
    const widthArg = beamerRequiredArgumentAfter(context, begin.span.to, token.span.from);
    const heightArg = widthArg && beamerRequiredArgumentAfter(context, widthArg.span.to, token.span.from);
    if (!widthArg || !heightArg) continue;
    const width = params.dimension(widthArg.value), height = params.dimension(heightArg.value);
    if (width === null || height === null) continue;
    const body = projectBeamerOverlayAreas(sliceMappedText(mapped, heightArg.span.to, token.span.from), params);
    const owner = body.sourceMap.charOrigins.find(origin => origin.kind === "direct");
    const span = owner?.kind === "direct" ? { from: owner.from, to: owner.to } : { from: 0, to: 0 };
    const generated = (text: string) => createGeneratedMappedText(text, "Beamer fixed overlay area", span);
    const content = body;
    const firstHeight = params.firstHeight(concatMappedText([generated("\\strut{}"), content]), width);
    if (firstHeight === null) continue;
    pieces.push(sliceMappedText(mapped, cursor, begin.span.from),
      generated(`\\raisebox{${height - firstHeight}pt}[${height}pt][0pt]{\\strut\\scalebox{1}{\\begin{minipage}[t]{${width}pt}\\raggedright `),
      content, generated("\\end{minipage}}}"));
    cursor = token.span.to;
  }
  if (!cursor) return mapped;
  pieces.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(pieces);
}
