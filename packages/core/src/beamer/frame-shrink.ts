import type { TexListLayoutProfile } from "../text/tex/layout-options.js";
import type { BeamerFrameModel, BeamerPaintTransform, BeamerRect } from "./types.js";

const SP_PER_PT = 65_536;

export type BeamerFrameShrink = {
  /** TeX's rounded minimum paint scale, including its .01pt multiplier. */
  minimumScale: number;
  /** Reciprocal computed by Beamer before it lays out the frame body. */
  widthMultiplier: number;
};

export function resolveBeamerFrameShrink(frame: BeamerFrameModel): BeamerFrameShrink | null {
  const option = [...frame.options?.entries ?? []].reverse().find(entry => entry.key === "shrink");
  if (!option) return null;
  const percentage = option.value == null ? 0 : Number(option.value.trim());
  if (!Number.isFinite(percentage) || percentage < 0 || percentage >= 100) return null;
  // beamerbaseframesize.sty multiplies a dimension by .01, whose TeX value
  // is 655sp. The reciprocal is deliberately an integer division by 256.
  const minimumSp = SP_PER_PT + Math.trunc(-Math.round(percentage * SP_PER_PT) * 655 / SP_PER_PT);
  const reciprocalSp = Math.trunc(256 * SP_PER_PT / Math.trunc(minimumSp / 256));
  return {
    minimumScale: texDecimal(minimumSp / SP_PER_PT),
    widthMultiplier: texDecimal(reciprocalSp / SP_PER_PT),
  };
}

export function beamerFrameShrinkWidth(widthPt: number, shrink: BeamerFrameShrink): number {
  return Math.trunc(Math.round(widthPt * SP_PER_PT) * Math.round(shrink.widthMultiplier * SP_PER_PT) / SP_PER_PT) / SP_PER_PT;
}

export function beamerFrameShrinkScale(shrink: BeamerFrameShrink, intrinsicHeightPt: number, availableHeightPt: number): number {
  // Beamer divides the available dimension by the integer part of the
  // original box height, then clamps to the configured minimum percentage.
  const heightCount = Math.trunc(Math.round(intrinsicHeightPt * SP_PER_PT) / SP_PER_PT);
  const fitSp = heightCount > 0 ? Math.trunc(Math.round(availableHeightPt * SP_PER_PT) / heightCount) : SP_PER_PT;
  return texDecimal(Math.min(fitSp, Math.round(shrink.minimumScale * SP_PER_PT)) / SP_PER_PT);
}

export function crampedBeamerListProfile(profile: TexListLayoutProfile): TexListLayoutProfile {
  // \list has already copied \topsep into \@topsepadd when Beamer runs
  // \beamer@cramped. Preserve those boundary skips; only \itemsep is live.
  const zeros = profile.itemsepPtByDepth.map(() => 0);
  return {
    ...profile,
    itemsepPtByDepth: zeros,
    itemsepStretchPtByDepth: zeros,
    itemsepShrinkPtByDepth: zeros,
    sizeOverrides: profile.sizeOverrides?.map(size => ({ ...size, itemsepPt: 0, itemsepStretchPt: 0, itemsepShrinkPt: 0 })),
  };
}

export function beamerFrameBodyTransform(scale: number, origin: { x: number; y: number }): BeamerPaintTransform {
  return [scale, 0, 0, scale, origin.x * (1 - scale), origin.y * (1 - scale)];
}

export function transformBeamerPoint(matrix: BeamerPaintTransform, point: { x: number; y: number }): { x: number; y: number } {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

export function inverseTransformBeamerPoint(matrix: BeamerPaintTransform, point: { x: number; y: number }): { x: number; y: number } {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const x = point.x - matrix[4];
  const y = point.y - matrix[5];
  return { x: (matrix[3] * x - matrix[2] * y) / determinant, y: (matrix[0] * y - matrix[1] * x) / determinant };
}

export function transformBeamerRect(matrix: BeamerPaintTransform, rect: BeamerRect): BeamerRect {
  const corners = [
    transformBeamerPoint(matrix, rect),
    transformBeamerPoint(matrix, { x: rect.x + rect.width, y: rect.y }),
    transformBeamerPoint(matrix, { x: rect.x, y: rect.y + rect.height }),
    transformBeamerPoint(matrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
  ];
  const x = Math.min(...corners.map(point => point.x));
  const y = Math.min(...corners.map(point => point.y));
  return { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
}

function texDecimal(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}
