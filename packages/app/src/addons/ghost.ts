import type { AddonTemplate } from "@tikz-editor/addon-api";
import { parseTikz } from "@tikz-editor/core/parser/index";
import { evaluateTikzFigure } from "@tikz-editor/core/semantic/evaluate";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "@tikz-editor/core/coords/index";

import { getActiveAddonRuntime } from "./registry";

export type GhostPointMapper = (point: WorldPoint) => { x: number; y: number };

/** Find an add-on template by id across the active runtime's ui entries. */
export function findAddonTemplate(templateId: string | null): AddonTemplate | null {
  if (!templateId) {
    return null;
  }
  const runtime = getActiveAddonRuntime();
  if (!runtime) {
    return null;
  }
  for (const ui of runtime.uis.values()) {
    for (const template of ui.templates ?? []) {
      if (template.id === templateId) {
        return template;
      }
    }
  }
  return null;
}

/**
 * Build the tool-preview ghost for an add-on template drag: generate the
 * snippet for the current rectangle, evaluate it through the normal
 * pipeline, and encode the resulting scene elements as one compound SVG
 * path in canvas svg space (text elements are skipped). Returns null when
 * nothing is drawable.
 */
export function buildAddonGhostPathData(
  template: AddonTemplate,
  start: WorldPoint,
  current: WorldPoint,
  mapPoint: GhostPointMapper
): string | null {
  const runtime = getActiveAddonRuntime();
  if (!runtime) {
    return null;
  }
  const dragDistance = Math.hypot(current.x - start.x, current.y - start.y);
  let snippet: string;
  try {
    snippet = template.generateSource(start, dragDistance >= 1e-3 ? current : undefined);
  } catch {
    return null;
  }
  if (!snippet.trim()) {
    return null;
  }

  let elements: SceneElement[];
  try {
    const source = `\\begin{tikzpicture}\n${snippet}\n\\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true, addons: runtime });
    elements = evaluateTikzFigure(parsed.figure, parsed.source, { addons: runtime }).scene.elements;
  } catch {
    return null;
  }

  const parts: string[] = [];
  for (const element of elements) {
    const part = encodeGhostElement(element, mapPoint);
    if (part) {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function encodeGhostElement(element: SceneElement, mapPoint: GhostPointMapper): string | null {
  if (element.kind === "Path") {
    const segments: string[] = [];
    for (const command of element.commands) {
      switch (command.kind) {
        case "M": {
          const to = mapPoint(command.to);
          segments.push(`M ${fmt(to.x)} ${fmt(to.y)}`);
          break;
        }
        case "L": {
          const to = mapPoint(command.to);
          segments.push(`L ${fmt(to.x)} ${fmt(to.y)}`);
          break;
        }
        case "C": {
          const c1 = mapPoint(command.c1);
          const c2 = mapPoint(command.c2);
          const to = mapPoint(command.to);
          segments.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
          break;
        }
        case "A": {
          const to = mapPoint(command.to);
          // The world -> svg mapping flips y, which inverts arc orientation.
          segments.push(
            `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(-command.xAxisRotation)} ` +
              `${command.largeArc ? 1 : 0} ${command.sweep ? 0 : 1} ${fmt(to.x)} ${fmt(to.y)}`
          );
          break;
        }
        case "Z":
          segments.push("Z");
          break;
      }
    }
    return segments.length > 0 ? segments.join(" ") : null;
  }
  if (element.kind === "Circle") {
    return encodeEllipseGhost(mapPoint(element.center), element.radius, element.radius);
  }
  if (element.kind === "Ellipse") {
    return encodeEllipseGhost(mapPoint(element.center), element.rx, element.ry);
  }
  return null;
}

function encodeEllipseGhost(center: { x: number; y: number }, rx: number, ry: number): string {
  const left = center.x - rx;
  const right = center.x + rx;
  return (
    `M ${fmt(left)} ${fmt(center.y)} ` +
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(right)} ${fmt(center.y)} ` +
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(left)} ${fmt(center.y)} Z`
  );
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}
