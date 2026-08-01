import { formatSvgNumber as fmt } from "../svg/format.js";
import type { createSvgModelBuilder } from "../svg/model.js";
import type { PreparedColumnFlowItem } from "./render-model.js";
import type {
  BeamerEmbeddedTikzLayout,
  BeamerFrameLayoutItem,
} from "./types.js";

export function emitEmbeddedTikz(params: {
  tikz: Extract<PreparedColumnFlowItem, { kind: "tikzpicture" }>;
  x: number;
  y: number;
  parentId: string | null;
  items: BeamerFrameLayoutItem[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
}): void {
  const { tikz } = params;
  const bounds = {
    x: params.x,
    y: params.y,
    width: tikz.width,
    height: tikz.height,
  };
  const scale = tikz.width / tikz.viewBox.width;
  const translateX = params.x - tikz.viewBox.x * scale;
  const translateY = params.y - tikz.viewBox.y * scale;
  const innerDefs = tikz.model.defs.length > 0
    ? `<defs>${tikz.model.defs.join("")}</defs>`
    : "";
  const innerBody = tikz.model.parts.map((part) => part.markup).join("");
  params.embeddedTikz.push({
    itemId: tikz.id,
    sourceSpan: tikz.sourceSpan,
    bounds,
    viewBox: tikz.viewBox,
    model: tikz.model,
  });
  params.items.push({
    id: tikz.id,
    kind: "tikzpicture",
    // The document root id (`frame:i:tikzpicture:j`) is rebound from the
    // scan model once the frame layout assembles its final item list.
    sourceSpan: tikz.sourceSpan,
    bounds,
    parentId: params.parentId,
  });
  params.modelBuilder.addPart({
    basePartId: tikz.id,
    sourceId: tikz.id,
    elementId: null,
    markup:
      `<g transform="translate(${fmt(translateX)} ${fmt(translateY)}) scale(${fmt(scale)})">` +
      innerDefs +
      innerBody +
      `</g>`,
  });
}
