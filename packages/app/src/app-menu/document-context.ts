import type { DocumentKind } from "@tikz-editor/core/document/kind";
import { APP_MENU_COMMAND_IDS as IDS, type AppMenuCommandId, type AppMenuDefinition, type AppMenuItem } from "./types";
const LAUNCH_COMMANDS: readonly AppMenuCommandId[] = [IDS.PRESENT_CURRENT, IDS.PRESENT_BEGINNING, IDS.PRESENT_WINDOW, IDS.PRESENT_REHEARSE];

function trim(items: AppMenuItem[]): AppMenuItem[] {
  const result: AppMenuItem[] = [];
  for (const item of items) {
    if (item.kind !== "separator" || (result.length && result.at(-1)?.kind !== "separator")) result.push(item);
  }
  while (result.at(-1)?.kind === "separator") result.pop();
  return result;
}
/** Document commands follow the tab; drawing tools follow its active editing surface. */
export function appMenuForDocument(definition: AppMenuDefinition, context: { kind: DocumentKind; nestedDrawing: boolean; presenting: boolean; focus?: "editor" | "audience" | "presenter" }): AppMenuDefinition {
  const deck = context.kind === "beamer", drawing = !deck || context.nestedDrawing;
  return definition.flatMap(section => {
    if (section.id === "present" && !deck && !context.presenting) return [];
    if (section.id === "path" && !drawing) return [];
    const items = section.items.flatMap<AppMenuItem>(item => {
      if (item.kind !== "command") return [item];
      if (item.commandId === IDS.NEW_BEAMER_DOCUMENT && deck) return [];
      if (item.commandId === IDS.NEW_TIKZ_DOCUMENT && !deck) return [];
      if (item.commandId === IDS.NEW_DOCUMENT) return [{ ...item, label: deck ? "New Beamer Presentation" : "New TikZ Drawing" }];
      if (section.id === "present") {
        const launch = LAUNCH_COMMANDS.includes(item.commandId);
        if (launch ? !deck || context.presenting : item.commandId !== IDS.PRESENT_OPTIONS && !context.presenting) return [];
      }
      if (!deck && item.commandId === IDS.TOGGLE_BUILDS_PANEL) return [];
      if (!drawing && section.id === "insert" && item.commandId !== IDS.INSERT_EQUATION) return [];
      if (!drawing && item.commandId === IDS.SHOW_COMPILED_PICTURE) return [];
      if (item.commandId === IDS.TOGGLE_FIGURES_PANEL) return [{ ...item, label: deck ? "Slides Panel" : "Figures Panel" }];
      if (item.commandId === IDS.CLOSE_DOCUMENT && context.focus && context.focus !== "editor") return [{ ...item, label: "Close Window" }];
      if (item.commandId === IDS.FORMAT_TIKZ && deck) return [{ ...item, label: "Format Source Code" }];
      return [item];
    });
    return items.length ? [{ ...section, items: trim(items) }] : [];
  });
}
