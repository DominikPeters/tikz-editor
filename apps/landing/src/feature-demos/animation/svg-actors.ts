import type gsap from "gsap";

export type SvgAttrs = Record<string, string | number>;

export function setSvgAttrs(target: Element, attrs: SvgAttrs): void {
  Object.entries(attrs).forEach(([name, value]) => {
    const next = String(value);
    if (target.getAttribute(name) !== next) {
      target.setAttribute(name, next);
    }
  });
}

export function toSvgAttrs(
  timeline: gsap.core.Timeline,
  target: Element,
  attrs: SvgAttrs,
  duration: number,
  position?: gsap.Position,
  ease = "power1.inOut"
): void {
  timeline.to(target, { attr: attrs, duration, ease }, position);
}

export function toTranslate(
  timeline: gsap.core.Timeline,
  target: Element,
  x: number,
  y: number,
  duration: number,
  position?: gsap.Position,
  ease = "power1.inOut"
): void {
  timeline.to(target, { x, y, duration, ease }, position);
}

export function prepareTransformDrivenLinePath(target: Element): void {
  setSvgAttrs(target, {
    d: "M 0 0 L 1 0",
    "vector-effect": "non-scaling-stroke"
  });
}

export function applyLinePathEndpoints(
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number }
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  setSvgAttrs(target, {
    transform: `translate(${from.x} ${from.y}) rotate(${angle}) scale(${Math.max(0.001, length)} 1)`
  });
}
