export { App } from "./ui/App";
export { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION } from "./app-menu/index.js";
export { CANVAS_CONTEXT_MENU_DEFINITION } from "./context-menu/index.js";
export { setActiveEditorPlatform, getActiveEditorPlatform } from "./platform/current.js";
export {
  applyWorkspace,
  findActiveWorkspaceId,
  listAllWorkspaces
} from "./ui/workspace-apply.js";
export { useWorkspaceListStore } from "./store/workspace-list-store.js";
export { hashTextForRevision, revisionForText } from "./linked-file-sync.js";

export type {
  AppMenuDefinition,
  AppMenuSection,
  AppMenuSectionId,
  AppMenuItem,
  AppMenuCommandItem,
  AppMenuSubmenuItem,
  AppMenuSeparatorItem,
  AppMenuWorkspaceListItem,
  AppMenuCommandId
} from "./app-menu/index.js";
export type {
  CanvasContextMenuTarget,
  CanvasContextMenuCommandId,
  CanvasContextMenuDefinition
} from "./context-menu/index.js";
export type {
  AssistantApi,
  AssistantAccountSnapshot,
  ArxivSourceFile,
  ArxivSourcePayload,
  AssistantChatContent,
  DesktopContextMenuItem,
  DesktopContextMenuPayload,
  AssistantDynamicToolResult,
  AssistantEvent,
  AssistantItem,
  AssistantModelOption,
  AssistantPendingApproval,
  AssistantPastedImage,
  AssistantThreadState,
  AssistantThreadSummary,
  AssistantTurnStatus,
  EditorPlatform,
  PlatformUpdateApi,
  UpdateInfo,
  UpdateInstallProgress,
  PlatformLatex,
  MenuCommandOrigin,
  MenuCommandHandler
} from "./platform/types.js";
export type { DocumentFileRef, ExternalChangeStatus, FileRevision } from "./store/types.js";
export type { LinkedTextReadResult, LinkedTextWriteResult } from "./linked-file-sync.js";
