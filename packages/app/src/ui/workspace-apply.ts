import type { IJsonModel } from "flexlayout-react";
import { BUILT_IN_WORKSPACES, getDockLayoutHandle } from "./DockLayout";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { useEditorStore } from "../store/store";

export type WorkspaceEntry =
  | { kind: "built-in"; id: string; name: string; json: IJsonModel }
  | { kind: "user"; id: string; name: string; json: IJsonModel };

export function listAllWorkspaces(): WorkspaceEntry[] {
  const kind = useEditorStore.getState().documentKind;
  const builtIns: WorkspaceEntry[] = BUILT_IN_WORKSPACES.map((b) => ({
    kind: "built-in" as const,
    id: b.id,
    name: b.name,
    json: b.build(kind),
  }));
  const users = useWorkspaceListStore.getState().userWorkspaces.map((u): WorkspaceEntry => ({
    kind: "user",
    id: u.id,
    name: u.name,
    json: u.json,
  }));
  return [...builtIns, ...users];
}

/** Canonical JSON for comparing layouts (ignores selection/minor ephemeral state). */
function canonicalLayout(json: IJsonModel): string {
  const layout = json.layout;
  return JSON.stringify(layout);
}

/** Find which workspace (if any) the current dock layout matches. */
export function findActiveWorkspaceId(): string | null {
  const handle = getDockLayoutHandle();
  if (!handle) return null;
  const currentSig = canonicalLayout(handle.getCurrentJson());
  for (const entry of listAllWorkspaces()) {
    if (canonicalLayout(entry.json) === currentSig) {
      return entry.id;
    }
  }
  return null;
}

export function applyWorkspace(id: string): void {
  const handle = getDockLayoutHandle();
  if (!handle) return;
  const builtIn = BUILT_IN_WORKSPACES.find((b) => b.id === id);
  if (builtIn) {
    handle.applyLayoutJson(builtIn.build(useEditorStore.getState().documentKind));
    return;
  }
  const user = useWorkspaceListStore.getState().userWorkspaces.find((u) => u.id === id);
  if (user) {
    handle.applyLayoutJson(user.json);
  }
}

/**
 * Built-in workspace names are reserved and can never be overwritten.
 * Returns true if the name collides with a built-in.
 */
export function isReservedWorkspaceName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return BUILT_IN_WORKSPACES.some((b) => b.name.toLowerCase() === trimmed);
}
