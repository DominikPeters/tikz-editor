import { formatSvgNumber as fmt } from "../../svg/format.js";
import type { BeamerRect } from "../types.js";
import type {
  BeamerTemplatePrimitive,
  BeamerTemplateVectorShape,
  ResolvedBeamerTheme,
} from "./types.js";
import {
  resolveBeamerThemeColor,
} from "./resolve.js";

export function textColor(
  theme: ResolvedBeamerTheme,
  role: string
): string {
  return resolveBeamerThemeColor(theme, role).fg ??
    resolveBeamerThemeColor(theme, "normal text").fg ??
    "#000000";
}

export function paragraphMarkup(
  svgBody: string,
  x: number,
  y: number,
  color: string
): string {
  return `<g color="${color}" transform="translate(${fmt(x)} ${fmt(y)})">${svgBody}</g>`;
}

export function rectMarkup(
  bounds: BeamerRect,
  fill: string,
  templatePart?: string
): string {
  const data = templatePart
    ? ` data-beamer-template-part="${templatePart}"`
    : "";
  return `<rect${data} x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="${fill}" />`;
}

export function vectorTemplateMarkup(
  primitive: Extract<BeamerTemplatePrimitive, { kind: "vector" }>,
  theme: ResolvedBeamerTheme
): string {
  return (
    `<g data-beamer-vector-template="${escapeAttribute(primitive.templateId)}">` +
    primitive.shapes.map((shape, index) =>
      vectorShapeMarkup(
        shape,
        theme,
        `${primitive.id}:gradient:${index}`
      )
    ).join("") +
    `</g>`
  );
}

export function escapeAttribute(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function vectorShapeMarkup(
  shape: BeamerTemplateVectorShape,
  theme: ResolvedBeamerTheme,
  gradientId: string
): string {
  const gradient = shape.kind === "rect" && shape.fillGradient
    ? vectorGradientMarkup(shape, theme, gradientId)
    : "";
  const paint = vectorShapePaintAttributes(
    shape,
    theme,
    gradient ? gradientId : undefined
  );
  if (shape.kind === "rect") {
    return (
      gradient +
      `<rect x="${fmt(shape.x)}" y="${fmt(shape.y)}" ` +
      `width="${fmt(shape.width)}" height="${fmt(shape.height)}"${paint} />`
    );
  }
  if (shape.kind === "circle") {
    return (
      `<circle cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" ` +
      `r="${fmt(shape.radius)}"${paint} />`
    );
  }
  const path = shape.commands.map((command) => {
    if (command.kind === "move") {
      return `M${fmt(command.x)} ${fmt(command.y)}`;
    }
    if (command.kind === "line") {
      return `L${fmt(command.x)} ${fmt(command.y)}`;
    }
    if (command.kind === "cubic") {
      return (
        `C${fmt(command.control1X)} ${fmt(command.control1Y)} ` +
        `${fmt(command.control2X)} ${fmt(command.control2Y)} ` +
        `${fmt(command.x)} ${fmt(command.y)}`
      );
    }
    return "Z";
  }).join("");
  const lineCap = shape.lineCap
    ? ` stroke-linecap="${shape.lineCap}"`
    : "";
  const lineJoin = shape.lineJoin
    ? ` stroke-linejoin="${shape.lineJoin}"`
    : "";
  const miterLimit = shape.strokeColorRole &&
      (shape.lineJoin == null || shape.lineJoin === "miter")
    ? ` stroke-miterlimit="10"`
    : "";
  return `<path d="${path}"${paint}${lineCap}${lineJoin}${miterLimit} />`;
}

function vectorShapePaintAttributes(
  shape: BeamerTemplateVectorShape,
  theme: ResolvedBeamerTheme,
  gradientId?: string
): string {
  const fill = gradientId
    ? `url(#${escapeAttribute(gradientId)})`
    : shape.fillColorRole
      ? textColor(theme, shape.fillColorRole)
      : "none";
  const fillOpacity = shape.fillOpacity == null
    ? ""
    : ` fill-opacity="${fmt(shape.fillOpacity)}"`;
  const stroke = shape.strokeColorRole
    ? textColor(theme, shape.strokeColorRole)
    : "none";
  const strokeWidth = shape.strokeWidthPt == null
    ? ""
    : ` stroke-width="${fmt(shape.strokeWidthPt)}"`;
  return ` fill="${fill}"${fillOpacity} stroke="${stroke}"${strokeWidth}`;
}

function vectorGradientMarkup(
  shape: Extract<BeamerTemplateVectorShape, { kind: "rect" }>,
  theme: ResolvedBeamerTheme,
  gradientId: string
): string {
  const gradient = shape.fillGradient;
  if (!gradient) {
    return "";
  }
  const coordinates = gradient.direction === "horizontal"
    ? {
        x1: shape.x,
        y1: shape.y,
        x2: shape.x + shape.width,
        y2: shape.y,
      }
    : {
        x1: shape.x,
        y1: shape.y,
        x2: shape.x,
        y2: shape.y + shape.height,
      };
  const stops = gradient.stops.map((stop) => {
    const color = resolveBeamerThemeColor(theme, stop.colorRole);
    const value = stop.paint === "background"
      ? color.bg ?? color.fg ?? "transparent"
      : color.fg ?? color.bg ?? "transparent";
    const opacity = stop.opacity == null
      ? ""
      : ` stop-opacity="${fmt(stop.opacity)}"`;
    return (
      `<stop offset="${fmt(Math.max(0, Math.min(1, stop.offset)))}" ` +
      `stop-color="${value}"${opacity} />`
    );
  }).join("");
  return (
    `<defs><linearGradient id="${escapeAttribute(gradientId)}" ` +
    `gradientUnits="userSpaceOnUse" x1="${fmt(coordinates.x1)}" ` +
    `y1="${fmt(coordinates.y1)}" x2="${fmt(coordinates.x2)}" ` +
    `y2="${fmt(coordinates.y2)}">${stops}</linearGradient></defs>`
  );
}
