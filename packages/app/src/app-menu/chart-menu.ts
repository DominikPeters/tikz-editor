import { CHART_KINDS, type ChartKindId } from "@tikz-editor/core/edit/pgfplots/chart-kinds";
import { PLOT_TYPES, type PlotTypeId } from "@tikz-editor/core/edit/pgfplots/chart-type";
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

/** Change Chart Type on an axis: one command per chart kind (the insert gallery's list). */
export const CHART_TYPE_COMMAND_IDS: Record<ChartKindId, AppMenuCommandId> = {
  function: APP_MENU_COMMAND_IDS.CHART_TYPE_FUNCTION,
  data: APP_MENU_COMMAND_IDS.CHART_TYPE_DATA,
  scatter: APP_MENU_COMMAND_IDS.CHART_TYPE_SCATTER,
  bar: APP_MENU_COMMAND_IDS.CHART_TYPE_BAR,
  "stacked-bar": APP_MENU_COMMAND_IDS.CHART_TYPE_STACKED_BAR,
  area: APP_MENU_COMMAND_IDS.CHART_TYPE_AREA,
  semilogy: APP_MENU_COMMAND_IDS.CHART_TYPE_SEMILOGY
};

/** Change Plot Type on a plot: one command per plot type. */
export const PLOT_TYPE_COMMAND_IDS: Record<PlotTypeId, AppMenuCommandId> = {
  line: APP_MENU_COMMAND_IDS.PLOT_TYPE_LINE,
  scatter: APP_MENU_COMMAND_IDS.PLOT_TYPE_SCATTER,
  smooth: APP_MENU_COMMAND_IDS.PLOT_TYPE_SMOOTH,
  step: APP_MENU_COMMAND_IDS.PLOT_TYPE_STEP,
  comb: APP_MENU_COMMAND_IDS.PLOT_TYPE_COMB,
  bar: APP_MENU_COMMAND_IDS.PLOT_TYPE_BAR,
  area: APP_MENU_COMMAND_IDS.PLOT_TYPE_AREA
};

export const CHART_TYPE_MENU_ITEMS: readonly AppMenuItem[] = CHART_KINDS.map((kind) => ({ kind: "command", commandId: CHART_TYPE_COMMAND_IDS[kind.id], label: kind.label }));
export const PLOT_TYPE_MENU_ITEMS: readonly AppMenuItem[] = PLOT_TYPES.map((type) => ({ kind: "command", commandId: PLOT_TYPE_COMMAND_IDS[type.id], label: type.label }));
