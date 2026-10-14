import type { BeamerEmbeddedTikzLayout } from "@tikz-editor/core/beamer/types";
import { namespaceSvgModel, serializeSvgModel } from "@tikz-editor/core/svg/index";
import type { SvgRenderModel } from "@tikz-editor/core/svg/types";
import type { DeckActiveFrame, SessionSnapshot } from "./compute";

/**
 * Whether a page laid out with a drawing layer undrawn stands for a new
 * source. TeX sets the layer as an empty box, so the page does not depend on
 * what it draws: it stands while nothing outside the layer changed and the
 * layer kept its length (the offsets after it stay put).
 */
export function undrawnLayerPageStands(before: { source: string; span: { from: number; to: number } }, source: string, span: { from: number; to: number }): boolean {
  return before.span.to - before.span.from === span.to - span.from &&
    before.source.slice(0, before.span.from) === source.slice(0, span.from) &&
    before.source.slice(before.span.to) === source.slice(span.to);
}

/**
 * Paints a drawing layer from its own render into the page that left it
 * undrawn (`drawingLayer` in renderFrame), with its diagnostics.
 */
export function composeOverlayPage(frame: DeckActiveFrame, layer: SessionSnapshot, diagnostics: readonly { code: string; message: string }[]): DeckActiveFrame {
  const rootId = layer.overlayLayer?.rootId;
  const entry = frame.layout.embeddedTikz.find(picture => picture.overlay?.rootId === rootId);
  if (!entry || !layer.svgModel || !layer.parseResult || !layer.scene) return frame;
  const model = namespaceSvgModel(layer.svgModel, entry.itemId);
  // Keep each object as a separate DOM part. A drag then patches only the
  // moved objects, instead of replacing the entire embedded picture group.
  const prefix = `${entry.itemId}/`;
  const ownsPart = (part: SvgRenderModel["parts"][number]) => part.sourceId === entry.itemId || part.partId.startsWith(prefix);
  const firstIndex = frame.svgModel.parts.findIndex(ownsPart);
  if (firstIndex < 0) return frame;
  const parts = frame.svgModel.parts.filter(part => !ownsPart(part));
  const defs = `<defs>${model.defs.join("")}</defs>`;
  parts.splice(firstIndex, 0, { partId: `${prefix}defs`, sourceId: entry.itemId, elementId: null,
    order: firstIndex, markup: defs, fingerprint: defs },
    ...model.parts.map(part => ({ ...part, partId: prefix + part.partId })));
  const svgModel: SvgRenderModel = { ...frame.svgModel, parts: parts.map((part, order) =>
    part.order === order ? part : { ...part, order }),
    diagnostics: [...frame.svgModel.diagnostics, ...diagnostics.map(({ code, message }) => ({ code, message }))] };
  const bounds = layer.scene.bounds;
  const updated: BeamerEmbeddedTikzLayout = { ...entry, sourceSpan: layer.parseResult.figure.span,
    bounds: bounds ? { x: bounds.minX, y: model.viewBox.height - bounds.maxY,
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY } : entry.bounds,
    viewBox: model.viewBox, model,
    overlay: { ...entry.overlay!, elements: layer.scene.elements, sourceOffset: 0, pageCoordinates: true } };
  return { ...frame, svgModel, svg: serializeSvgModel(svgModel), layout: { ...frame.layout,
    items: frame.layout.items.map(item => item.id === entry.itemId ? { ...item, sourceSpan: updated.sourceSpan, bounds: updated.bounds } : item),
    embeddedTikz: frame.layout.embeddedTikz.map(picture => picture === entry ? updated : picture) } };
}

