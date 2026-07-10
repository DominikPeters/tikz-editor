import type { EditAction } from "@tikz-editor/core/edit/actions";
import type { NodeAnchorTarget } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";

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
