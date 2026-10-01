import type { BeamerFrameLayoutItem, BeamerParagraphLayout, BeamerSpacingLayout } from "./types.js";
import { flattenPositionedTexVListItems } from "../text/tex/vlist/traversal.js";
import type { TexGlueItem } from "../text/tex/vlist/types.js";

function spacingCommand(command: string | undefined): BeamerSpacingLayout["command"] | null {
  return command === "vspace" || command === "smallskip" || command === "medskip" || command === "bigskip" ? command : null;
}

/** Lift only authored glue, excluding paragraph/list/theme spacing and flexible fills. */
export function collectBeamerParagraphSpacing(paragraphs: readonly BeamerParagraphLayout[], items: readonly BeamerFrameLayoutItem[]): BeamerSpacingLayout[] {
  const hidden = new Set(items.filter(item => item.visibility === "hidden").map(item => item.paragraphId));
  const result: BeamerSpacingLayout[] = [];
  for (const paragraph of paragraphs) {
    if (hidden.has(paragraph.paragraphId) || !["body", "block-body"].includes(paragraph.role)) continue;
    const push = (glue: Pick<TexGlueItem, "sourceSpan" | "origin" | "size" | "relativeUnitPt">, x: number, y: number, sizePt: number, horizontal = false) => {
      const command = glue.origin?.kind === "explicit-command" ? spacingCommand(glue.origin.command) : null;
      const span = glue.sourceSpan;
      if (!command || !span || [...(paragraph.hiddenSourceSpans ?? []), ...(paragraph.readOnlySourceSpans ?? [])]
        .some(hiddenSpan => hiddenSpan.from < span.end && hiddenSpan.to > span.start)) return;
      result.push({ command, horizontal, sourceSpan: { from: span.start, to: span.end }, sizePt,
        ...(glue.relativeUnitPt != null ? { relativeUnitPt: Number(glue.relativeUnitPt) } : {}),
        bounds: { x: paragraph.bounds.x + x, y: paragraph.bounds.y + y,
          width: Math.max(0, paragraph.bounds.width - x), height: sizePt } });
    };
    for (const box of paragraph.vlistLayout.boxReport.items) {
      if (box.itemKind !== "glue" || !box.glue) continue;
      push({ ...box.glue, sourceSpan: box.sourceSpan }, Number(box.x), Number(box.y),
        box.glue.size < 0 ? Number(box.glue.size) : Number(box.totalHeight));
    }
    // Horizontal-mode \vspace is attached to a line by \vadjust rather than
    // represented as a separate VList box. Its position follows line breaking.
    for (const positioned of flattenPositionedTexVListItems(paragraph.vlistLayout.items)) {
      if (positioned.item.kind !== "paragraph") continue;
      const input = positioned.item.paragraph;
      const placement = paragraph.vlistLayout.paragraphPlacements.find(item => item.blockIndex === input.blockIndex);
      if (!placement) continue;
      const lines = paragraph.report.lines.filter(line => placement.lineIndices.includes(line.lineIndex)).map(line => {
        const spans = line.segments.filter(segment => segment.sourceStartRaw != null && segment.sourceEndRaw != null);
        return { line, from: Math.min(...spans.map(segment => Number(segment.sourceStartRaw))),
          to: Math.max(...spans.map(segment => Number(segment.sourceEndRaw))) };
      });
      const precedingSpace = new Map<number, number>();
      for (const glue of input.verticalAdjustments ?? []) {
        const offset = glue.sourceSpan?.start;
        if (offset == null) continue;
        const owner = [...lines].reverse().find(line => line.from <= offset && offset <= line.to) ??
          [...lines].reverse().find(line => line.to <= offset) ?? lines[0];
        const line = owner && paragraph.vlistLayout.linePlacements.find(item => item.lineIndex === owner.line.lineIndex);
        if (!line || !owner) continue;
        const before = precedingSpace.get(line.lineIndex) ?? 0;
        push(glue, Number(line.x), Number(line.y) + Number(owner.line.ascent) + Number(owner.line.descent) + before, Number(glue.size), true);
        precedingSpace.set(line.lineIndex, before + Number(glue.size));
      }
    }
  }
  return result;
}
