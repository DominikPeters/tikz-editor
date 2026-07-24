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
    primitive.shapes.map((shape) => vectorShapeMarkup(shape, theme)).join("") +
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
  theme: ResolvedBeamerTheme
): string {
  const paint = vectorShapePaintAttributes(shape, theme);
  if (shape.kind === "rect") {
    return (
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
  theme: ResolvedBeamerTheme
): string {
  const fill = shape.fillColorRole
    ? textColor(theme, shape.fillColorRole)
    : "none";
  const stroke = shape.strokeColorRole
    ? textColor(theme, shape.strokeColorRole)
    : "none";
  const strokeWidth = shape.strokeWidthPt == null
    ? ""
    : ` stroke-width="${fmt(shape.strokeWidthPt)}"`;
  return ` fill="${fill}" stroke="${stroke}"${strokeWidth}`;
}
