import { useEffect, useState, type JSX, type RefObject } from "react";
import css from "./CanvasPanel.module.css";
import { stepTagAt, type StepTag } from "./step-tags";

/** How long the pointer rests on an object before its tag shows, as a tooltip. */
const HOVER_DELAY_MS = 500;

/**
 * Step tags on the canvas: every one while the Overlays panel is shown,
 * otherwise the one for the object the pointer rests on.
 */
export function StepTags({ tags, all, hover, svgRef, scale }: {
  tags: readonly StepTag[];
  all: boolean;
  /** Whether a resting pointer shows a tag: with the select tool, outside drags and text editing. */
  hover: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  /** CSS pixels per SVG unit. */
  scale: number;
}): JSX.Element | null {
  const [hovered, setHovered] = useState<string | null>(null);
  const tracking = hover && !all && tags.length > 0;
  useEffect(() => {
    if (!tracking) { setHovered(null); return; }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let over: string | null = null;
    const move = (event: PointerEvent) => {
      const svg = svgRef.current;
      const inverse = svg?.getScreenCTM()?.inverse();
      if (!svg || !inverse || event.buttons !== 0 || !(event.target instanceof Node) || !svg.contains(event.target)) { leave(); return; }
      const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
      const tag = stepTagAt(tags, point.matrixTransform(inverse));
      if ((tag?.rowId ?? null) === over) return;
      leave();
      over = tag?.rowId ?? null;
      if (over) timer = setTimeout(() => { setHovered(over); }, HOVER_DELAY_MS);
    };
    const leave = () => {
      if (timer) clearTimeout(timer);
      timer = null; over = null;
      setHovered(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", leave, true);
    window.addEventListener("blur", leave);
    return () => {
      leave();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", leave, true);
      window.removeEventListener("blur", leave);
    };
  }, [svgRef, tags, tracking]);

  const shown = all ? tags : tags.filter((tag) => tag.rowId === hovered);
  if (shown.length === 0) return null;
  const unit = 1 / Math.max(scale, 1e-3);
  const height = 14 * unit, pad = 4 * unit;
  return (
    <g data-testid="step-tags" pointerEvents="none">
      {shown.map((tag) => {
        // Sized for the screen, at the object's top-left corner.
        const width = (tag.label.length * 6 + 8) * unit;
        return (
          <g key={tag.rowId} data-testid="step-tag" data-row-id={tag.rowId} transform={`translate(${tag.bounds.x - pad} ${tag.bounds.y - height - 2 * unit})`}>
            <rect className={css.stepTag} width={width} height={height} rx={3 * unit} />
            <text className={css.stepTagLabel} x={width / 2} y={height / 2} fontSize={10 * unit} textAnchor="middle" dominantBaseline="central">{tag.label}</text>
          </g>
        );
      })}
    </g>
  );
}
