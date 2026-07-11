import type { EditHandle, SceneElement, ScenePath } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";

export type CurveControlLine = {
  key: string;
  sourceId: string;
  from: WorldPoint;
  to: WorldPoint;
};

export function deriveCurveControlLines(
  elements: readonly SceneElement[],
  selectedSourceIds: ReadonlySet<string>,
  editHandles: readonly EditHandle[]
): CurveControlLine[] {
  const selectedSourcesWithPathControlHandles = new Set<string>();
  const bendLines: CurveControlLine[] = [];
  for (const handle of editHandles) {
    if (!selectedSourceIds.has(handle.sourceRef.sourceId)) {
      continue;
    }
    if (handle.kind === "path-control") {
      selectedSourcesWithPathControlHandles.add(handle.sourceRef.sourceId);
      continue;
    }
    if (handle.kind === "path-bend" && handle.curveEdit?.kind === "to-bend") {
      bendLines.push(
        {
          key: `curve-bend:${handle.id}:start`,
          sourceId: handle.sourceRef.sourceId,
          from: handle.curveEdit.startWorld,
          to: handle.world
        },
        {
          key: `curve-bend:${handle.id}:end`,
          sourceId: handle.sourceRef.sourceId,
          from: handle.curveEdit.endWorld,
          to: handle.world
        }
      );
    }
  }
  if (selectedSourcesWithPathControlHandles.size === 0 && bendLines.length === 0) {
    return [];
  }

  const lines: CurveControlLine[] = [];
  for (const element of elements) {
    if (element.kind !== "Path" || !selectedSourcesWithPathControlHandles.has(element.sourceRef.sourceId)) {
      continue;
    }
    lines.push(...collectControlLinesFromPath(element));
  }
  lines.push(...bendLines);
  return lines;
}

function collectControlLinesFromPath(path: ScenePath): CurveControlLine[] {
  const lines: CurveControlLine[] = [];
  let current: WorldPoint | null = null;
  let subpathStart: WorldPoint | null = null;

  path.commands.forEach((command, commandIndex) => {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      return;
    }

    if (command.kind === "Z") {
      if (subpathStart) {
        current = subpathStart;
      }
      return;
    }

    if (!current) {
      current = command.to;
      return;
    }

    if (command.kind === "C") {
      lines.push(
        {
          key: `curve-control:${path.id}:${commandIndex}:start`,
          sourceId: path.sourceRef.sourceId,
          from: current,
          to: command.c1
        },
        {
          key: `curve-control:${path.id}:${commandIndex}:end`,
          sourceId: path.sourceRef.sourceId,
          from: command.to,
          to: command.c2
        }
      );
    }

    current = command.to;
  });

  return lines;
}
