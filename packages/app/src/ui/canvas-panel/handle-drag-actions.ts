import type { EditAction } from "@tikz-editor/core/edit/actions";
import { toAddonHandleView } from "@tikz-editor/core/addons/edit-context";
import type { EditHandle, NodeAnchorTarget } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";

import { getActiveAddonRuntime } from "../../addons/registry";

export function resolveHandleDragAction(input: {
  handleId: string;
  newWorld: WorldPoint;
  activeEndpointAnchor: NodeAnchorTarget | null;
  /** The live handle object; required to route add-on handles to their engine. */
  handle?: EditHandle | null;
}): EditAction | null {
  if (input.handle?.handleType === "addon") {
    const runtime = getActiveAddonRuntime();
    const engine = runtime?.engineById(input.handle.addonId);
    const edit = engine?.planHandleDrag?.(toAddonHandleView(input.handle), {
      x: input.newWorld.x,
      y: input.newWorld.y
    });
    if (edit == null) {
      return null;
    }
    return { kind: "addonEdit", addonId: input.handle.addonId, edit };
  }

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
