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
  let parts = [...model.parts];
  const byParagraph = new Map<string, BeamerPicturePaintOwner[]>();
  for (const owner of owners) {
    const list = byParagraph.get(owner.paragraphId) ?? [];
    list.push(owner); byParagraph.set(owner.paragraphId, list);
  }
  for (const [id, pictures] of byParagraph) {
    const paint = paragraphs.get(id);
    if (!paint) continue;
    const text = parts.find(part => part.markup.includes(paint.whole));
    if (!text) continue;
    const ordered = pictures.map(picture => ({ ...picture, part: parts.find(part => part.sourceId === picture.sourceId) }))
      .filter((picture): picture is BeamerPicturePaintOwner & { part: SvgRenderPart } => picture.part !== undefined)
      .sort((left, right) => left.span.from - right.span.from);
    if (!ordered.length) continue;
    let cursor = paint.sourceSpan.from;
    const pieces: SvgRenderPart[] = [];
    const at = text.markup.indexOf(paint.whole);
    const prefix = text.markup.slice(0, at);
    const suffix = text.markup.slice(at + paint.whole.length);
    const context = openSvgGroups(prefix);
    const appendText = (to: number, last = false) => {
      // A structural part can contain several paragraphs. Preserve its other
      // paint exactly once, and reopen only the surrounding SVG context at
      // each split; copying the entire part duplicates siblings and lets the
      // next paragraph replacement overwrite earlier inserted pictures.
      const markup = (pieces.length === 0 ? prefix : context.open) +
        paint.render({ from: cursor, to }, cursor === paint.sourceSpan.from) +
        (last ? suffix : context.close);
      pieces.push({ ...text, partId: pieces.length === 0 ? text.partId : `${text.partId}:${id}:paint:${pieces.length}`, markup, fingerprint: markup });
    };
    for (const picture of ordered) {
      appendText(picture.span.from);
      pieces.push(picture.part);
      cursor = picture.span.to;
    }
    appendText(paint.sourceSpan.to, true);
    const consumedPictures = new Set(ordered.map(picture => picture.part.partId));
    parts = parts.flatMap(part => part === text ? pieces : consumedPictures.has(part.partId) ? [] : [part]);
  }
  return { ...model, parts: parts.map((part, order) => ({ ...part, order })) };
}

function openSvgGroups(prefix: string): { open: string; close: string } {
  const stack: { name: string; tag: string }[] = [];
  for (const match of prefix.matchAll(/<\/?([\w:-]+)\b[^>]*>/gu)) {
    const tag = match[0];
    const name = match[1];
    if (!name) continue;
    if (tag.startsWith("</")) stack.pop();
    else if (!tag.endsWith("/>") && !["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "image", "use", "stop"].includes(name)) {
      stack.push({ name, tag });
    }
  }
  return { open: stack.map(entry => entry.tag).join(""), close: stack.reverse().map(entry => `</${entry.name}>`).join("") };
}
