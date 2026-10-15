import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "./types.js";
export { APP_MENU_DEFINITION } from "./default-menu.js";
export { APP_MENU_COMMAND_IDS } from "./types.js";
export { filterAppMenuDefinitionForTarget } from "./platform-visibility.js";
export { appMenuForDocument } from "./document-context.js";

export type {
  AppMenuDefinition,
  AppMenuSection,
  AppMenuSectionId,
  AppMenuPlatformTarget,
  AppMenuItem,
  AppMenuCommandItem,
  AppMenuSubmenuItem,
  AppMenuRecentFilesItem,
  AppMenuWorkspaceListItem,
  AppMenuSeparatorItem,
  AppMenuCommandId
} from "./types.js";

const commandIds: ReadonlySet<string> = new Set(Object.values(APP_MENU_COMMAND_IDS));

export function isAppMenuCommandId(value: unknown): value is AppMenuCommandId {
  return typeof value === "string" && commandIds.has(value);
}
