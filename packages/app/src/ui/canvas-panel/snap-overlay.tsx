import type { SnapLine, SnapBounds } from "@tikz-editor/core/edit/snapping";
import type { WorldPoint } from "../coords/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import { pt, worldPoint } from "@tikz-editor/core/coords/index";
import { PT_PER_CM } from "@tikz-editor/core/edit/format";
import { worldToSvgPoint } from "./geometry";
import { primarySnapLines, placeSnapLabel, type LabelRect } from "./snap-feedback";
import css from "./CanvasPanel.module.css";

export function SnapOverlay({ snapLines, sourceNames, viewBox, scale, snapStrokeWidth, snapCrossSize }: {
  snapLines: readonly SnapLine[]; sourceNames?: ReadonlyMap<string, string>;
  viewBox: SvgViewBox; scale: number; snapStrokeWidth: number; snapCrossSize: number;
}) {
  if (!snapLines.length) return null;
  const unit = 1 / Math.max(scale, 1e-3);
  const visible = primarySnapLines(snapLines);
  const references = new Map<string, SnapBounds>();
  for (const line of visible) {
    const primaryId = line.type === "points" ? line.primary?.sourceId : line.type === "pointer" ? line.sourceIds?.[0] : undefined;
    for (const bounds of line.referenceBounds ?? []) if (!primaryId || bounds.sourceId === primaryId) references.set(bounds.sourceId, bounds);
  }
  const boxes = [...references.values()].map(bounds => {
    const corner = worldToSvgPoint(worldPoint(pt(bounds.minX), pt(bounds.maxY)), viewBox);
    return { x: corner.x, y: corner.y, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
  });
  const occupied: LabelRect[] = [...boxes];
  const guides = visible.map(line => {
    let segments: Array<[WorldPoint, WorldPoint]>;
    let anchor: WorldPoint;
    let text: string;
    if (line.type === "gap") {
      segments = line.segments;
      const [a, b] = segments[0];
      anchor = worldPoint(pt((a.x + b.x) / 2), pt((a.y + b.y) / 2));
      const distance = Math.hypot(a.x - b.x, a.y - b.y) / PT_PER_CM;
      text = `${line.gapKind === "equal" ? "Equal spacing" : "Centered"} · ${Number(distance.toFixed(2))} cm`;
    } else {
      const a = line.type === "pointer" ? line.to : line.primary?.from ?? line.points[0];
      const b = line.type === "pointer" ? line.from : line.primary?.to ?? line.points.at(-1)!;
      segments = [[a, b]]; anchor = b;
      const sourceId = line.type === "points" ? line.primary?.sourceId ?? line.sourceIds?.[0] : line.sourceIds?.[0];
      const bounds = sourceId ? references.get(sourceId) : undefined;
      const coordinate = b[line.axis];
      const min = line.axis === "x" ? bounds?.minX : bounds?.minY;
      const max = line.axis === "x" ? bounds?.maxX : bounds?.maxY;
      text = min != null && Math.abs(coordinate - min) < 1e-5 ? (line.axis === "x" ? "Left edge" : "Bottom edge")
        : max != null && Math.abs(coordinate - max) < 1e-5 ? (line.axis === "x" ? "Right edge" : "Top edge")
        : line.type === "points" && line.role === "center" ? "Center" : "Aligned";
      const name = sourceId ? sourceNames?.get(sourceId) : undefined;
      if (name) text += ` · ${name}`;
    }
    text = text.length > 40 ? `${text.slice(0, 39)}…` : text;
    const position = placeSnapLabel(worldToSvgPoint(anchor, viewBox), text, unit, viewBox, occupied);
    if (position) occupied.push(position);
    return { line, segments, text, position };
  });
  return <g className={css.snapOverlay} data-testid="snap-overlay">
    {boxes.map((box, i) => <rect key={i} {...box} className={css.snapReference} strokeWidth={snapStrokeWidth} data-testid="snap-reference" />)}
    {guides.map(({ line, segments, text, position }, i) => <g key={i}>
      {segments.map(([a, b], j) => {
        const from = worldToSvgPoint(a, viewBox), to = worldToSvgPoint(b, viewBox);
        return <g key={j}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            className={`${css.snapLine} ${line.type === "gap" ? css.snapGapLine : line.type === "points" && line.role === "center" ? css.snapCenterLine : ""}`}
            strokeWidth={snapStrokeWidth} />
          <circle cx={to.x} cy={to.y} r={snapCrossSize} className={css.snapReferencePoint} strokeWidth={snapStrokeWidth} />
          {line.type === "gap" && <circle cx={from.x} cy={from.y} r={snapCrossSize} className={css.snapReferencePoint} strokeWidth={snapStrokeWidth} />}
        </g>;
      })}
      {position && <g data-testid="snap-label">
        <rect {...position} rx={3 * unit} className={css.snapGapLabelRect} strokeWidth={unit * .5} />
        <text x={position.x + position.width / 2} y={position.y + position.height / 2} dominantBaseline="central" textAnchor="middle"
          className={css.snapGapLabelText} fontSize={10 * unit}>{text}</text>
      </g>}
    </g>)}
  </g>;
}
