import { CHART_KINDS, type ChartKindId } from "@tikz-editor/core/edit/pgfplots/chart-kinds";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId, type AppMenuItem } from "./types.js";

/** The insert command of each chart kind: the Insert menu and the toolbar gallery run the same ones. */
export const CHART_KIND_COMMAND_IDS: Record<ChartKindId, AppMenuCommandId> = {
  function: APP_MENU_COMMAND_IDS.INSERT_FUNCTION_PLOT,
  data: APP_MENU_COMMAND_IDS.INSERT_DATA_PLOT,
  scatter: APP_MENU_COMMAND_IDS.INSERT_SCATTER_PLOT,
  bar: APP_MENU_COMMAND_IDS.INSERT_BAR_CHART,
  "stacked-bar": APP_MENU_COMMAND_IDS.INSERT_STACKED_BAR_CHART,
  area: APP_MENU_COMMAND_IDS.INSERT_AREA_PLOT,
  semilogy: APP_MENU_COMMAND_IDS.INSERT_LOG_PLOT
};

/** Insert > Chart: one item per chart kind, in the kind list's order. */
export const CHART_INSERT_MENU_ITEMS: readonly AppMenuItem[] = CHART_KINDS.map((kind) => ({
  kind: "command",
  commandId: CHART_KIND_COMMAND_IDS[kind.id],
  label: kind.label
}));
