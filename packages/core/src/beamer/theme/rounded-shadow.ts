import { formatSvgNumber as fmt } from "../../svg/format.js";

export function beamerRoundedShadowMarkup(params: {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): string {
  // beamerbaseboxes.sty builds its fading from two 4bp radial "shadow
  // balls", one 8bp bottom-right ball, and horizontal/vertical edge
  // shadings. The box paint that follows clips the inward halves, so the
  // native SVG can express the same mask as gradients behind the box.
  const extent = 4 * (72.27 / 72);
  const largeExtent = 8 * (72.27 / 72);
  const bottomId = `${params.id}-bottom`;
  const rightId = `${params.id}-right`;
  const cornerId = `${params.id}-corner`;
  const largeCornerId = `${params.id}-corner-large`;
  const width = Math.max(0, params.right - params.left);
  const height = Math.max(0, params.bottom - params.top);
  return (
    `<defs>` +
    `<linearGradient id="${bottomId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="0.525" />` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0" />` +
    `</linearGradient>` +
    `<linearGradient id="${rightId}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="0.52" />` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0" />` +
    `</linearGradient>` +
    `<radialGradient id="${cornerId}">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="0.5" />` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0" />` +
    `</radialGradient>` +
    `<radialGradient id="${largeCornerId}">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="1" />` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0" />` +
    `</radialGradient>` +
    `</defs>` +
    `<rect x="${fmt(params.left + 2 * extent)}" y="${fmt(params.bottom)}" ` +
    `width="${fmt(Math.max(0, width - 2 * extent))}" height="${fmt(extent)}" ` +
    `fill="url(#${bottomId})" />` +
    `<rect x="${fmt(params.right)}" y="${fmt(params.top + extent)}" ` +
    `width="${fmt(extent)}" height="${fmt(Math.max(0, height - extent))}" ` +
    `fill="url(#${rightId})" />` +
    `<circle cx="${fmt(params.left + 2 * extent)}" cy="${fmt(params.bottom)}" ` +
    `r="${fmt(extent)}" fill="url(#${cornerId})" />` +
    `<circle cx="${fmt(params.right)}" cy="${fmt(params.top + extent)}" ` +
    `r="${fmt(extent)}" fill="url(#${cornerId})" />` +
    `<circle cx="${fmt(params.right)}" cy="${fmt(params.bottom)}" ` +
    `r="${fmt(largeExtent)}" fill="url(#${largeCornerId})" />`
  );
}
