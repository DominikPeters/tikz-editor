import type { Span } from "../ast/types.js";
import type { SvgRenderModel, SvgRenderPart } from "../svg/types.js";

export type BeamerParagraphPaint = {
  sourceSpan: Span;
  whole: string;
  render: (range: Span, paintUnmapped: boolean) => string;
};
export type BeamerPicturePaintOwner = { paragraphId: string; span: Span; sourceId: string };

/** An inline picture is painted between surrounding text, including when its
 * zero-size overlay box shares a paragraph with text it overlaps. Splitting
 * paint only retains exactly the same layout and paints every glyph once. */
export function interleaveBeamerPicturePaint(
  model: SvgRenderModel,
  owners: readonly BeamerPicturePaintOwner[],
  paragraphs: ReadonlyMap<string, BeamerParagraphPaint>
): SvgRenderModel {
  if (!owners.length) return model;
  const replacements = new Map<string, SvgRenderPart[]>();
  const consumedPictures = new Set<string>();
  const byParagraph = new Map<string, BeamerPicturePaintOwner[]>();
  for (const owner of owners) {
    const list = byParagraph.get(owner.paragraphId) ?? [];
    list.push(owner); byParagraph.set(owner.paragraphId, list);
  }
  for (const [id, pictures] of byParagraph) {
    const paint = paragraphs.get(id);
    if (!paint) continue;
    const text = model.parts.find(part => part.markup.includes(paint.whole));
    if (!text) continue;
    const ordered = pictures.map(picture => ({ ...picture, part: model.parts.find(part => part.sourceId === picture.sourceId) }))
      .filter((picture): picture is BeamerPicturePaintOwner & { part: SvgRenderPart } => picture.part !== undefined)
      .sort((left, right) => left.span.from - right.span.from);
    if (!ordered.length) continue;
    let cursor = paint.sourceSpan.from;
    const pieces: SvgRenderPart[] = [];
    const appendText = (to: number) => {
      const markup = text.markup.replace(paint.whole, paint.render({ from: cursor, to }, cursor === paint.sourceSpan.from));
      pieces.push({ ...text, partId: pieces.length === 0 ? text.partId : `${text.partId}:paint:${pieces.length}`, markup, fingerprint: markup });
    };
    for (const picture of ordered) {
      appendText(picture.span.from);
      pieces.push(picture.part);
      consumedPictures.add(picture.part.partId);
      cursor = picture.span.to;
    }
    appendText(paint.sourceSpan.to);
    replacements.set(text.partId, pieces);
  }
  return { ...model, parts: model.parts.flatMap(part => replacements.get(part.partId) ?? (consumedPictures.has(part.partId) ? [] : [part]))
    .map((part, order) => ({ ...part, order })) };
}
