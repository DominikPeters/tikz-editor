import { formatSvgNumber as fmt } from "../../svg/format.js";

export function beamerRoundedShadowMarkup(params: {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): string {
  // beamerbaseboxes.sty composes several shadings into a single fading mask
  // and clips that mask against the rounded box. Emitting those shadings as
  // independent SVG shapes exposes their seams and opaque centers. A blurred
  // rounded silhouette reproduces the final, already-composited fading.
  const extent = 4 * (72.27 / 72);
  const blurStdDeviation = 1.25;
  const offset = 2.5;
  const opacity = 0.45;
  const filterMargin = 4 * blurStdDeviation + offset;
  const filterId = `${params.id}-filter`;
  const width = Math.max(0, params.right - params.left);
  const height = Math.max(0, params.bottom - params.top);
  return (
    `<defs><filter id="${filterId}" filterUnits="userSpaceOnUse" ` +
    `x="${fmt(params.left - filterMargin)}" ` +
    `y="${fmt(params.top - filterMargin)}" ` +
    `width="${fmt(width + 2 * filterMargin)}" ` +
    `height="${fmt(height + 2 * filterMargin)}" ` +
    `color-interpolation-filters="sRGB">` +
    `<feGaussianBlur stdDeviation="${fmt(blurStdDeviation)}" />` +
    `</filter></defs>` +
    `<rect x="${fmt(params.left + offset)}" ` +
    `y="${fmt(params.top + offset)}" ` +
    `width="${fmt(width)}" height="${fmt(height)}" ` +
    `rx="${fmt(extent)}" fill="#000000" opacity="${fmt(opacity)}" ` +
    `filter="url(#${filterId})" />`
  );
}
