import type {
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
} from "./types.js";

export type BeamerGradientStop = {
  offset: number;
  colorRole: string;
  paint: "foreground" | "background";
  opacity?: number;
};

/**
 * Build a backend-neutral role-colored gradient rectangle.
 *
 * Theme planners own source geometry and semantic color roles; the SVG
 * backend owns gradient IDs and serialization.
 */
export function gradientRectPrimitive(params: {
  context: BeamerFrameTemplateContext;
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  templateId: string;
  layoutKind: Extract<
    BeamerTemplatePrimitive,
    { kind: "vector" }
  >["layoutKind"];
  direction: "horizontal" | "vertical";
  stops: readonly BeamerGradientStop[];
}): BeamerTemplatePrimitive {
  return {
    kind: "vector",
    id: `${params.context.frame.id}:${params.id}`,
    sourceSpan: params.context.frame.span,
    bounds: params.bounds,
    templateId: params.templateId,
    layoutKind: params.layoutKind,
    shapes: [{
      kind: "rect",
      ...params.bounds,
      fillGradient: {
        direction: params.direction,
        stops: params.stops,
      },
    }],
  };
}

export function backgroundGradientStop(
  offset: number,
  colorRole: string,
  opacity?: number
): BeamerGradientStop {
  return {
    offset,
    colorRole,
    paint: "background",
    ...(opacity == null ? {} : { opacity }),
  };
}

export function foregroundGradientStop(
  offset: number,
  colorRole: string,
  opacity?: number
): BeamerGradientStop {
  return {
    offset,
    colorRole,
    paint: "foreground",
    ...(opacity == null ? {} : { opacity }),
  };
}
