import { useMemo, type KeyboardEvent, type RefObject } from "react";
import { beamerColumnDividers, beamerImageResizeTarget, beamerSpacingTargets, type BeamerFrameLayout, type BeamerObjectIndex, type BeamerObjectNode } from "@tikz-editor/core/beamer/index";
import { useEditorStore } from "../../store/store";
import { useDeckResize, type DeckResizeTarget } from "./useDeckResize";
import css from "./CanvasPanel.module.css";

export function DeckResizeOverlay({ source, layout, index, selected, scale, svgRef, closeText }: {
  source: string; layout: BeamerFrameLayout | null; index: BeamerObjectIndex | null;
  selected: BeamerObjectNode | null; scale: number; svgRef: RefObject<SVGSVGElement | null>; closeText: () => void;
}) {
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null);
  const toolMode = useEditorStore((s) => s.toolMode);
  const { dragging, begin, nudge } = useDeckResize({ source, layout, svgRef, closeText });
  const dividers = useMemo(() => layout && index ? beamerColumnDividers(source, layout, index) : [], [source, layout, index]);
  const image = useMemo(() => layout && selected?.kind === "graphics" ? beamerImageResizeTarget(source, layout, selected.id) : null, [source, layout, selected]);
  const spacing = useMemo(() => layout ? beamerSpacingTargets(source, layout) : [], [source, layout]);
  const onKeyDown = (event: KeyboardEvent<SVGElement>, target: DeckResizeTarget) => {
    const step = event.shiftKey ? 10 : 1;
    const dx = target.kind !== "spacing" ? (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) : 0;
    const dy = target.kind !== "columns" ? (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) : 0;
    if (!dx && !dy) return;
    event.preventDefault(); event.stopPropagation(); nudge(target, dx, dy);
  };
  if (!layout || locked || toolMode !== "select") return null;
  const size = 7 / scale;
  return <g data-testid="deck-resize-overlay" onClick={(event) => { event.stopPropagation(); }}>
    {dividers.map((divider, i) => {
      const target: DeckResizeTarget = { kind: "columns", divider };
      const active = dragging?.kind === "columns" && dragging.divider.id === divider.id;
      const selectedPair = selected && [divider.parentId, divider.leftId, divider.rightId].includes(selected.id);
      return <g key={divider.id} className={css.deckColumnDivider} data-visible={active || selectedPair ? "true" : undefined}
        data-testid="deck-column-divider" role="separator" aria-label={`Resize columns at divider ${i + 1}`}
        aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(100 * divider.leftWidth / (divider.leftWidth + divider.rightWidth))}
        tabIndex={0} onPointerDown={(event) => { begin(event, target); }} onKeyDown={(event) => { onKeyDown(event, target); }}>
        <title>Resize adjacent columns</title>
        <line x1={divider.x} x2={divider.x} y1={divider.y} y2={divider.y + divider.height} className={css.deckDividerHit} strokeWidth={12 / scale} />
        <line x1={divider.x} x2={divider.x} y1={divider.y} y2={divider.y + divider.height} className={css.deckDividerLine} />
        <rect x={divider.x - 1.5 / scale} y={divider.y + divider.height / 2 - 9 / scale} width={3 / scale} height={18 / scale} rx={1.5 / scale} className={css.deckDividerGrip} />
      </g>;
    })}
    {spacing.map((space) => {
      const target: DeckResizeTarget = { kind: "spacing", spacing: space };
      const active = dragging?.kind === "spacing" && dragging.spacing.id === space.id;
      const { x, y, width } = space.bounds;
      const end = y + space.sizePt;
      const top = Math.min(y, end);
      const height = Math.abs(space.sizePt);
      const value = `${Number(space.value.toFixed(4))} ${space.unit}`;
      return <g key={space.id} className={css.deckSpacingHandle} data-active={active ? "true" : undefined}
        data-testid="deck-spacing-handle" data-spacing-command={space.command}
        role="spinbutton" aria-label={`Vertical spacing, ${space.command}`}
        aria-valuenow={space.value} aria-valuetext={value} tabIndex={0}
        onPointerDown={(event) => { begin(event, target); }} onKeyDown={(event) => { onKeyDown(event, target); }}>
        <title>{`Resize \\${space.command} (${value})`}</title>
        {space.sizePt > 0 ? <rect x={x} y={top} width={width} height={height} fill="transparent" /> : null}
        <rect data-testid="deck-spacing-edge" x={x - 15 / scale} y={end - 6 / scale} width={14 / scale} height={12 / scale} fill="transparent" />
        <rect x={x} y={top} width={width} height={height} className={css.deckSpacingBand} />
        <path d={`M${x} ${y}h${width}M${x} ${end}h${width}`} className={css.deckSpacingEdges} />
        <rect x={x - 14 / scale} y={end - 1.5 / scale} width={12 / scale} height={3 / scale} rx={1.5 / scale} className={css.deckSpacingGrip} />
      </g>;
    })}
    {image ? (["nw", "ne", "sw", "se"] as const).map((corner) => {
      const target: DeckResizeTarget = { kind: "image", image, corner };
      const x = image.bounds.x + (corner.endsWith("e") ? image.bounds.width : 0);
      const y = image.bounds.y + (corner.startsWith("s") ? image.bounds.height : 0);
      const name = `${corner.startsWith("n") ? "top" : "bottom"} ${corner.endsWith("w") ? "left" : "right"}`;
      return <g key={corner} className={css.deckImageCorner} style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}
        role="button" aria-label={`Resize image from ${name}`} tabIndex={0} data-testid={`deck-image-resize-${corner}`}
        onPointerDown={(event) => { begin(event, target); }} onKeyDown={(event) => { onKeyDown(event, target); }}>
        <title>Resize image</title>
        <rect x={x - size} y={y - size} width={size * 2} height={size * 2} fill="transparent" />
        <rect x={x - size / 2} y={y - size / 2} width={size} height={size} className={css.handle} strokeWidth={1 / scale} />
      </g>;
    }) : null}
  </g>;
}
