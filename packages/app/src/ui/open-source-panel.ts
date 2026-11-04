import { Actions } from "flexlayout-react";
import { useEditorStore } from "../store/store";
import { getDockLayoutHandle } from "./DockLayout";

/** Brings the source into view: its dock tab on the desktop, the source panel on the iPad. */
export function openSourcePanel(): void {
  const dock = getDockLayoutHandle();
  if (dock) {
    if (!dock.getModel().getNodeById("source")) dock.togglePanel("source");
    dock.getModel().doAction(Actions.selectTab("source"));
    return;
  }
  const { showSourcePanel, dispatch } = useEditorStore.getState();
  if (!showSourcePanel) dispatch({ type: "TOGGLE_PANEL", panel: "source" });
}
