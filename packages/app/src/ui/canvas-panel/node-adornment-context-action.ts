import { parseTikzForEdit, type EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { PathStatement, Statement } from "@tikz-editor/core/ast/types";
import type { EditAction } from "@tikz-editor/core/edit/actions";
import { resolvePropertyTarget } from "@tikz-editor/core/edit/property-target";
import { extractNodeAdornmentPlan } from "@tikz-editor/core/semantic/path/label-quotes";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/index";
import { collectSourceBounds } from "./panel-helpers";
import { worldToSvgPoint } from "./geometry";

export type ResolveNodeAdornmentContextActionInput = {
  source: string;
  clickedTargetId: string | null;
  selectedTargetId: string | null;
  clickedWorld: WorldPoint | null;
  sceneElements: readonly SceneElement[];
  viewBox: SvgViewBox | null;
  adornmentKind: "label" | "pin";
  text: string;
  parseOptions?: EditParseOptions;
};

export type ResolveNodeAdornmentContextActionResult =
  | {
      kind: "ready";
      action: Extract<EditAction, { kind: "addNodeAdornment" }>;
      pendingTextTargetId: string;
    }
  | {
      kind: "unsupported";
      reason: string;
    };

export function resolveNodeAdornmentContextAction(
  input: ResolveNodeAdornmentContextActionInput
): ResolveNodeAdornmentContextActionResult {
  const baseTargetId = input.clickedTargetId ?? input.selectedTargetId;
  if (!baseTargetId) {
    return { kind: "unsupported", reason: "No node target is selected." };
  }

  const nodeId = resolveNodeAdornmentOwnerTargetId(input.source, baseTargetId, input.parseOptions);
  if (!nodeId) {
    return { kind: "unsupported", reason: "The context menu target is not a node." };
  }

  const target = resolvePropertyTarget(input.source, nodeId, input.parseOptions);
  if (target.kind !== "found") {
    return { kind: "unsupported", reason: target.reason };
  }

  const adornmentIndex = extractNodeAdornmentPlan(target.target.options).adornments.length;
  return {
    kind: "ready",
    action: {
      kind: "addNodeAdornment",
      nodeId,
      adornmentKind: input.adornmentKind,
      angle: resolveContextMenuAdornmentAngleKeyword(
        [baseTargetId, nodeId],
        input.clickedWorld,
        input.sceneElements,
        input.viewBox
      ),
      text: input.text
    },
    pendingTextTargetId: `node-adornment:${nodeId}:${input.adornmentKind}:${adornmentIndex}`
  };
}

export function resolveNodeAdornmentOwnerTargetId(
  source: string,
  targetId: string,
  parseOptions: EditParseOptions = {}
): string | null {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found") {
    return null;
  }
  if (resolved.target.kind === "node-item") {
    return targetId;
  }
  if (resolved.target.kind !== "path-statement" || resolved.target.pathCommand !== "node") {
    return null;
  }

  const statements = parseTikzForEdit(source, {
    ...parseOptions,
  }).figure.body;
  const statement = findPathStatementById(statements, targetId);
  const inlineNode = statement?.items.find((item: PathStatement["items"][number]) => item.kind === "Node");
  return inlineNode?.kind === "Node" ? inlineNode.id : null;
}

export function resolveContextMenuAdornmentAngleKeyword(
  targetIds: readonly string[],
  clickedWorld: WorldPoint | null,
  sceneElements: readonly SceneElement[],
  viewBox: SvgViewBox | null
): string {
  if (!clickedWorld || !viewBox) {
    return "above";
  }
  const boundsBySource = collectSourceBounds([...sceneElements], viewBox);
  const bounds = targetIds.map((targetId) => boundsBySource.get(targetId)).find((entry) => entry != null);
  if (!bounds) {
    return "above";
  }

  const clickedSvg = worldToSvgPoint(clickedWorld, viewBox);
  const dx = clickedSvg.x - (bounds.minX + bounds.maxX) / 2;
  const dy = clickedSvg.y - (bounds.minY + bounds.maxY) / 2;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return "above";
  }
  const angleDeg = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  const octant = Math.round(angleDeg / 45) % 8;
  return ["right", "above right", "above", "above left", "left", "below left", "below", "below right"][octant] ?? "above";
}

function findPathStatementById(statements: readonly Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested: PathStatement | null = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}
