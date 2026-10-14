import type { Span } from "@tikz-editor/core/ast/types";
import type { BeamerEmbeddedTikzLayout } from "@tikz-editor/core/beamer/types";
import { namespaceSvgModel, serializeSvgModel } from "@tikz-editor/core/svg/index";
import type { SvgRenderModel } from "@tikz-editor/core/svg/types";
import type { DeckActiveFrame, SessionSnapshot } from "./compute";

/** Rebind document coordinates after replacing an empty-box overlay's contents. */
export function rebindOverlayPage(frame: DeckActiveFrame, before: Span, after: Span): DeckActiveFrame {
  const delta = after.to - before.to;
  if (delta === 0) return frame;
  const offset = (value: number) => value >= before.to ? value + delta : value;
  const identity = (value: string) => value.replace(/:(footnote|unsupported):([0-9]+)(?=[:/]|$)/gu,
    (_, kind: string, raw: string) => `:${kind}:${offset(Number(raw))}`);
  const markup = (value: string) => value.replace(/(data-source-(?:start|end)=")([0-9]+)(")/gu,
    (_, prefix: string, raw: string, suffix: string) => prefix + String(offset(Number(raw))) + suffix)
    .replace(/((?:id|data-tex-paragraph-id|data-source-id|data-part-id)=")([^"]+)(")/gu,
      (_, prefix: string, id: string, suffix: string) => prefix + identity(id) + suffix);
  const bound = new WeakMap<object, unknown>();
  const rebind = <T>(value: T): T => {
    if (!value || typeof value !== "object") return value;
    const known = bound.get(value);
    if (known) return known as T;
    const record = value as Record<string, unknown>;
    let result: Record<string, unknown> | undefined;
    bound.set(value, value);
    for (const [key, entry] of Object.entries(record)) {
      const isOffset = /^(?:(?:source(?:Start|End|Offset)|content(?:Start|End))(?:Raw)?|filename(?:Start|End)Raw)$/u.test(key) ||
        ((key === "from" || key === "to") && typeof record.from === "number" && typeof record.to === "number") ||
        ((key === "start" || key === "end") && typeof record.start === "number" && typeof record.end === "number") ||
        (key === "offset" && record.kind === "offset");
      const next = isOffset && typeof entry === "number" ? offset(entry)
        : (key === "svgBody" || key === "mathSvgBody") && typeof entry === "string" ? markup(entry)
        : (key === "id" || key.endsWith("Id")) && typeof entry === "string" ? identity(entry)
        : key === "childIds" && Array.isArray(entry) ? entry.map((id: string) => identity(id)) : rebind(entry);
      if (next !== entry) {
        result ??= (Array.isArray(value) ? [...value] : { ...record }) as Record<string, unknown>;
        result[key] = next;
      }
    }
    const rebound = (result ?? value) as T;
    bound.set(value, rebound);
    return rebound;
  };
  // Embedded pictures own local source coordinates; only their document span
  // and source origin move. Paragraph/VList reports are in document coordinates.
  const embeddedTikz = frame.layout.embeddedTikz.map(entry => ({ ...entry, sourceSpan: rebind(entry.sourceSpan),
    ...(entry.overlay && { overlay: { ...entry.overlay, sourceOffset: offset(entry.overlay.sourceOffset),
      ...(entry.overlay.pageCoordinates && { elements: rebind(entry.overlay.elements) }) } }) }));
  const layout = { ...rebind({ ...frame.layout, embeddedTikz: [] }), embeddedTikz };
  const embeddedIds = new Set(embeddedTikz.map(entry => entry.itemId));
  const parts = frame.svgModel.parts.map(part => {
    if (embeddedIds.has(part.sourceId) || embeddedTikz.some(entry => part.partId.startsWith(`${entry.itemId}/`))) return part;
    const next = markup(part.markup);
    const partId = identity(part.partId), sourceId = identity(part.sourceId);
    return next === part.markup && partId === part.partId && sourceId === part.sourceId ? part
      : { ...part, partId, sourceId, elementId: part.elementId && identity(part.elementId), markup: next, fingerprint: next };
  });
  const svgModel = { ...frame.svgModel, parts };
  return { ...frame, layout, svgModel, svg: serializeSvgModel(svgModel) };
}

/** Replace one picture's paint without laying out the surrounding slide again. */
export function composeOverlayPage(frame: DeckActiveFrame, layer: SessionSnapshot): DeckActiveFrame {
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
    part.order === order ? part : { ...part, order }) };
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


// Layout/model payloads are immutable. Reused subtrees keep their estimates,
// so bounding the page cache does not rescan every glyph on every drag frame.
const retainedBytes = new WeakMap<object, number>();
export function overlayPageRetainedBytes(frame: DeckActiveFrame): number {
  const estimate = (value: unknown): number => {
    if (value === null || typeof value !== "object") return typeof value === "string" ? value.length * 2 : 8;
    const known = retainedBytes.get(value);
    if (known !== undefined) return known;
    retainedBytes.set(value, 0);
    const entries = Object.values(value);
    const bytes = 48 + entries.length * 16 + entries.reduce<number>((sum, entry) => sum + estimate(entry), 0);
    retainedBytes.set(value, bytes);
    return bytes;
  };
  return estimate(frame);
}
