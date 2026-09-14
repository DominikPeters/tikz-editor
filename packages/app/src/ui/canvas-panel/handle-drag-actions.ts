import type { EditAction } from "tikz-editor/edit/actions";
import type { NodeAnchorTarget } from "tikz-editor/semantic/types";
import type { WorldPoint } from "../coords/types";
import type { ApplyActionFeedback, DragState } from "./types";

export function updateHandleDragAfterAction(
  drag: Extract<DragState, { kind: "handle" }>,
  result: ApplyActionFeedback,
  nextWorld: WorldPoint
): void {
  if (!result.sourceChanged) {
    return;
  }
  drag.lastKnownWorld = nextWorld;
  drag.connectedHandle = result.connectedHandle;
  if (result.connectedHandle && drag.activeEndpointAnchor) {
    // An unnamed target may have acquired a name and a different statement id.
    // Mouse release can occur before another move refreshes the anchor overlay.
    drag.activeEndpointAnchor = {
      ...drag.activeEndpointAnchor,
      nodeName: result.connectedHandle.nodeName,
      nodeSourceId: undefined,
      anchor: result.connectedHandle.anchor
    };
  }
}

export function resolveHandleDragAction(input: {
  handleId: string;
  newWorld: WorldPoint;
  activeEndpointAnchor: NodeAnchorTarget | null;
}): EditAction {
  if (input.activeEndpointAnchor) {
    return {
      kind: "connectHandle",
      handleId: input.handleId,
      nodeName: input.activeEndpointAnchor.nodeName,
      ...(input.activeEndpointAnchor.nodeSourceId ? { nodeSourceId: input.activeEndpointAnchor.nodeSourceId } : {}),
      anchor: input.activeEndpointAnchor.anchor
    };
  }

  return {
    kind: "moveHandle",
    handleId: input.handleId,
    newWorld: input.newWorld
  };
}

export function shouldCommitHandleAnchorOnPointerUp(input: {
  snapshotSource: string;
  source: string;
  activeEndpointAnchor: NodeAnchorTarget | null;
}): boolean {
  return input.snapshotSource === input.source && input.activeEndpointAnchor != null;
}
