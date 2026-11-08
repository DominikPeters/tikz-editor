import { useId, useMemo, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createDocumentGraphicsResolverFromPreviewBundle } from "@tikz-editor/core/graphics";
import type { BeamerFrameLayout, BeamerImageCropHandle, BeamerImageCropTarget } from "@tikz-editor/core/beamer/index";
import { getDocumentGraphicsPreviewBundle } from "../../image-asset-cache";
import { useEditorStore } from "../../store/store";
import type { DeckResizeTarget } from "./useDeckResize";
import css from "./CanvasPanel.module.css";

const HANDLES: readonly { handle: Exclude<BeamerImageCropHandle, "move">; x: number; y: number; cursor: string; name: string }[] = [
  { handle: "nw", x: 0, y: 0, cursor: "nwse-resize", name: "top left corner" },
  { handle: "n", x: 0.5, y: 0, cursor: "ns-resize", name: "top edge" },
  { handle: "ne", x: 1, y: 0, cursor: "nesw-resize", name: "top right corner" },
  { handle: "e", x: 1, y: 0.5, cursor: "ew-resize", name: "right edge" },
  { handle: "se", x: 1, y: 1, cursor: "nwse-resize", name: "bottom right corner" },
  { handle: "s", x: 0.5, y: 1, cursor: "ns-resize", name: "bottom edge" },
  { handle: "sw", x: 0, y: 1, cursor: "nesw-resize", name: "bottom left corner" },
  { handle: "w", x: 0, y: 0.5, cursor: "ew-resize", name: "left edge" },
];

/** The whole image behind its crop window, from the same data the slide was drawn with. */
function useImageHref(layout: BeamerFrameLayout, target: BeamerImageCropTarget): string | null {
  const bundleKey = useEditorStore((s) => s.snapshot.graphicsPreviewBundleKey ?? null);
  const ownedBundle = useEditorStore((s) => s.snapshot.graphicsPreviewBundle ?? null);
  return useMemo(() => {
    const graphic = layout.graphics.find((item) => item.itemId === target.objectId);
    const bundle = ownedBundle?.cacheKey === bundleKey ? ownedBundle : bundleKey ? getDocumentGraphicsPreviewBundle(bundleKey) : null;
    if (!graphic || !bundle) return null;
    const resolution = createDocumentGraphicsResolverFromPreviewBundle(bundle).resolve({
      filename: target.filename, options: graphic.options, source: "", sourceStart: graphic.sourceSpan.from, sourceEnd: graphic.sourceSpan.to,
    });
    return resolution.status === "resolved" && resolution.dataBase64 ? `data:${resolution.mimeType};base64,${resolution.dataBase64}` : null;
  }, [bundleKey, ownedBundle, layout, target.filename, target.objectId]);
}

export function DeckCropOverlay({ layout, target, scale, begin, onKeyDown }: {
  layout: BeamerFrameLayout;
  target: BeamerImageCropTarget;
  scale: number;
  begin: (event: ReactPointerEvent<SVGElement>, target: DeckResizeTarget) => void;
  onKeyDown: (event: KeyboardEvent<SVGElement>, target: DeckResizeTarget) => void;
}) {
  const clipId = useId();
  const href = useImageHref(layout, target);
  const { bounds: kept, imageBounds: image } = target;
  const arm = Math.min(12 / scale, kept.width / 3, kept.height / 3);
  const bar = Math.min(16 / scale, kept.width / 3, kept.height / 3);
  const hit = 8 / scale;
  const outside = `M${image.x} ${image.y}h${image.width}v${image.height}h${-image.width}Z` +
    `M${kept.x} ${kept.y}h${kept.width}v${kept.height}h${-kept.width}Z`;
  const grip = (h: (typeof HANDLES)[number]) => {
    const x = kept.x + h.x * kept.width;
    const y = kept.y + h.y * kept.height;
    if (h.handle.length === 1) {
      return h.x === 0.5 ? `M${x - bar / 2} ${y}h${bar}` : `M${x} ${y - bar / 2}v${bar}`;
    }
    const dx = h.x === 0 ? arm : -arm;
    const dy = h.y === 0 ? arm : -arm;
    return `M${x + dx} ${y}H${x}V${y + dy}`;
  };
  return <g data-testid="deck-crop-overlay" className={css.deckCrop}>
    <defs><clipPath id={clipId}><path d={outside} clipRule="evenodd" /></clipPath></defs>
    {href ? <image href={href} x={image.x} y={image.y} width={image.width} height={image.height} preserveAspectRatio="none"
      clipPath={`url(#${clipId})`} className={css.deckCropGhost} data-testid="deck-crop-ghost" /> : null}
    <rect x={image.x} y={image.y} width={image.width} height={image.height} className={css.deckCropImageOutline} />
    <rect x={kept.x} y={kept.y} width={kept.width} height={kept.height} className={css.deckCropWindow}
      data-testid="deck-crop-move" role="button" tabIndex={0} aria-label="Move image inside crop"
      onPointerDown={(event) => { begin(event, { kind: "crop", crop: target, handle: "move" }); }}
      onKeyDown={(event) => { onKeyDown(event, { kind: "crop", crop: target, handle: "move" }); }}>
      <title>Move image inside crop</title>
    </rect>
    {HANDLES.map((h) => {
      const x = kept.x + h.x * kept.width;
      const y = kept.y + h.y * kept.height;
      const handleTarget: DeckResizeTarget = { kind: "crop", crop: target, handle: h.handle };
      return <g key={h.handle} className={css.deckCropHandle} style={{ cursor: h.cursor }} data-testid={`deck-crop-${h.handle}`}
        role="button" tabIndex={0} aria-label={`Crop from ${h.name}`}
        onPointerDown={(event) => { begin(event, handleTarget); }} onKeyDown={(event) => { onKeyDown(event, handleTarget); }}>
        <title>Crop image</title>
        <rect x={x - hit} y={y - hit} width={hit * 2} height={hit * 2} fill="transparent" />
        <path d={grip(h)} className={css.deckCropGripHalo} />
        <path d={grip(h)} className={css.deckCropGrip} />
      </g>;
    })}
  </g>;
}
