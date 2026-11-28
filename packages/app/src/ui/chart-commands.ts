/**
 * Chart commands (pgfplots axes): insert one chart kind, and the canvas
 * context-menu entries for an axis, a plot and an axis part. Each runs a core
 * edit action the inspector and the Objects panel also use
 * (`insertPgfplotsTemplate`, `setAxisElement`, `insertAxisPlot`,
 * `resetPlotStyle`, the inspector's `grid` write); none edits the source
 * itself.
 */
import type { Span } from "@tikz-editor/core/ast/types";
import { applyResetPlotStyleAction, AXIS_ELEMENT_KINDS, readAxisElements, type AxisElementKind, type AxisElementsState } from "@tikz-editor/core/edit/pgfplots/chart-elements";
import { CHART_KINDS, type ChartKindId } from "@tikz-editor/core/edit/pgfplots/chart-kinds";
import { CHART_KIND_COMMAND_IDS } from "../app-menu/chart-menu";
import { legendAssociationFor } from "@tikz-editor/core/edit/pgfplots/legend-edits";
import { applyReorderPlotsAction } from "@tikz-editor/core/edit/pgfplots/axis-actions";
import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import { resolvePropertyTarget } from "@tikz-editor/core/edit/property-target";
import { isAxisId, owningAxisId, parseAxisDescriptionId, parseAxisPlotId } from "@tikz-editor/core/pgfplots/edit-ids";
import { legendEntryOf } from "@tikz-editor/core/pgfplots/legend";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import { normalizeOptionKey } from "@tikz-editor/core/edit/option-key";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../app-menu";
import type { EditorAction } from "../store/types";

/** Every command id this module binds. */
export const CHART_COMMAND_IDS = [
  APP_MENU_COMMAND_IDS.INSERT_FUNCTION_PLOT, APP_MENU_COMMAND_IDS.INSERT_DATA_PLOT, APP_MENU_COMMAND_IDS.INSERT_SCATTER_PLOT,
  APP_MENU_COMMAND_IDS.INSERT_BAR_CHART, APP_MENU_COMMAND_IDS.INSERT_STACKED_BAR_CHART, APP_MENU_COMMAND_IDS.INSERT_AREA_PLOT,
  APP_MENU_COMMAND_IDS.INSERT_LOG_PLOT,
  APP_MENU_COMMAND_IDS.CHART_TOGGLE_TITLE, APP_MENU_COMMAND_IDS.CHART_TOGGLE_XLABEL, APP_MENU_COMMAND_IDS.CHART_TOGGLE_YLABEL,
  APP_MENU_COMMAND_IDS.CHART_TOGGLE_LEGEND, APP_MENU_COMMAND_IDS.CHART_GRID_NONE, APP_MENU_COMMAND_IDS.CHART_GRID_MAJOR,
  APP_MENU_COMMAND_IDS.CHART_GRID_MINOR, APP_MENU_COMMAND_IDS.CHART_GRID_BOTH, APP_MENU_COMMAND_IDS.CHART_INSERT_PLOT,
  APP_MENU_COMMAND_IDS.CHART_EDIT_LEGEND_ENTRY, APP_MENU_COMMAND_IDS.CHART_RESET_PLOT_STYLE, APP_MENU_COMMAND_IDS.CHART_EDIT_TEXT,
  APP_MENU_COMMAND_IDS.CHART_REMOVE_PART
] as const;

export type ChartCommandId = (typeof CHART_COMMAND_IDS)[number];

type CommandBindingLike = { enabled: boolean; checked?: boolean; reason?: string; run: () => void };

export { CHART_KIND_COMMAND_IDS };

const ELEMENT_COMMANDS: Record<AxisElementKind, AppMenuCommandId> = {
  title: APP_MENU_COMMAND_IDS.CHART_TOGGLE_TITLE,
  xlabel: APP_MENU_COMMAND_IDS.CHART_TOGGLE_XLABEL,
  ylabel: APP_MENU_COMMAND_IDS.CHART_TOGGLE_YLABEL,
  legend: APP_MENU_COMMAND_IDS.CHART_TOGGLE_LEGEND
};

const GRID_COMMANDS: ReadonlyArray<[AppMenuCommandId, string]> = [
  [APP_MENU_COMMAND_IDS.CHART_GRID_NONE, "none"],
  [APP_MENU_COMMAND_IDS.CHART_GRID_MAJOR, "major"],
  [APP_MENU_COMMAND_IDS.CHART_GRID_MINOR, "minor"],
  [APP_MENU_COMMAND_IDS.CHART_GRID_BOTH, "both"]
];

export type ChartSelection =
  | { kind: "axis"; axisId: string }
  | { kind: "plot"; axisId: string; plotId: string }
  | { kind: "part"; axisId: string; partId: string; part: AxisElementKind }
  | null;

export function resolveChartSelection(selectedElementIds: ReadonlySet<string>): ChartSelection {
  if (selectedElementIds.size !== 1) return null;
  const [id = ""] = selectedElementIds;
  if (isAxisId(id)) return { kind: "axis", axisId: id };
  const plot = parseAxisPlotId(id);
  if (plot) return { kind: "plot", axisId: plot.axisId, plotId: id };
  const part = parseAxisDescriptionId(id);
  if (part) return { kind: "part", axisId: part.axisId, partId: id, part: part.part };
  return null;
}

/** Which elements the axis of a chart selection shows (for "Add"/"Remove" labels). */
export function readChartElements(source: string, axisId: string, elements: readonly SceneElement[] | null, parseOptions: EditParseOptions): AxisElementsState | null {
  return readAxisElements(source, axisId, elements ?? [], parseOptions);
}

function readGrid(source: string, axisId: string, parseOptions: EditParseOptions): string {
  const resolved = resolvePropertyTarget(source, axisId, parseOptions);
  if (resolved.kind !== "found") return "none";
  let value = "none";
  for (const entry of resolved.target.options?.entries ?? []) {
    if (entry.kind === "kv" && normalizeOptionKey(entry.key).replace(/^\/pgfplots\//u, "") === "grid") value = entry.valueRaw.trim();
  }
  return value;
}

export type ChartCommandInput = {
  source: string;
  sceneElements: readonly SceneElement[] | null;
  selectedElementIds: ReadonlySet<string>;
  parseOptions: EditParseOptions;
  canEdit: boolean;
  /** How a chart is inserted where the default (`insertPgfplotsTemplate` into the picture) does not apply: a slide. */
  insertChart?: (template: ChartKindId) => void;
  dispatch: (action: EditorAction) => void;
  /** Opens in-place text editing of an axis part (`within`: the source span of the legend entry to edit). */
  onEditChartText?: (targetId: string, within?: Span) => void;
};

/** Every chart command's binding: insert commands always, the others for a chart selection. */
export function buildChartCommandBindings(input: ChartCommandInput): Record<ChartCommandId, CommandBindingLike> {
  const { source, sceneElements, selectedElementIds, parseOptions, canEdit, insertChart, dispatch, onEditChartText } = input;
  const bindings: Record<string, CommandBindingLike> = {};
  for (const kind of CHART_KINDS) {
    bindings[CHART_KIND_COMMAND_IDS[kind.id]] = {
      enabled: canEdit,
      run: () => {
        if (insertChart) insertChart(kind.id);
        else dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "insertPgfplotsTemplate", template: kind.id } });
      }
    };
  }
  const disabled = (reason?: string): CommandBindingLike => ({ enabled: false, ...(reason ? { reason } : {}), run: () => {} });
  const selection = canEdit ? resolveChartSelection(selectedElementIds) : null;
  const elements = selection ? readChartElements(source, selection.axisId, sceneElements, parseOptions) : null;

  for (const kind of AXIS_ELEMENT_KINDS) {
    const commandId = ELEMENT_COMMANDS[kind];
    const state = elements?.[kind];
    if (!selection || !state) { bindings[commandId] = disabled(); continue; }
    const axisId = selection.axisId;
    bindings[commandId] = {
      enabled: state.enabled,
      ...(state.reason ? { reason: state.reason } : {}),
      run: () => {
        const adding = !state.present;
        dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setAxisElement", axisId, element: kind, visible: adding, selectNew: adding && kind !== "legend" } });
        if (adding && kind !== "legend") onEditChartText?.(`${axisId}:${kind}`);
      }
    };
  }

  const grid = selection ? readGrid(source, selection.axisId, parseOptions) : null;
  for (const [commandId, value] of GRID_COMMANDS) {
    if (!selection || grid === null) { bindings[commandId] = disabled(); continue; }
    const axisId = selection.axisId;
    bindings[commandId] = {
      enabled: true,
      checked: grid === value,
      run: () => { dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId: axisId, level: "command", key: "grid", value } }); }
    };
  }

  bindings[APP_MENU_COMMAND_IDS.CHART_INSERT_PLOT] = selection
    ? { enabled: true, run: () => { dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "insertAxisPlot", axisId: selection.axisId } }); } }
    : disabled();

  if (selection?.kind === "plot") {
    const plotId = selection.plotId;
    const reset = applyResetPlotStyleAction(source, plotId, parseOptions);
    bindings[APP_MENU_COMMAND_IDS.CHART_RESET_PLOT_STYLE] = reset.kind === "unsupported"
      ? disabled(reset.reason)
      : { enabled: true, run: () => { dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "resetPlotStyle", plotId } }); } };
    const association = legendAssociationFor(source, selection.axisId, parseOptions, sceneElements ?? undefined);
    const entry = association ? legendEntryOf(association, plotId) : null;
    const span = entry?.drawn ? entry.text?.origin?.span ?? null : null;
    const legendId = `${selection.axisId}:legend`;
    bindings[APP_MENU_COMMAND_IDS.CHART_EDIT_LEGEND_ENTRY] = span && onEditChartText
      ? { enabled: true, run: () => { dispatch({ type: "SELECT", id: legendId, additive: false }); onEditChartText(legendId, span); } }
      : disabled(entry === null ? "A `forget plot` has no legend entry." : "The plot has no legend entry to edit; type one in the inspector's Legend entry field.");
  } else {
    bindings[APP_MENU_COMMAND_IDS.CHART_RESET_PLOT_STYLE] = disabled();
    bindings[APP_MENU_COMMAND_IDS.CHART_EDIT_LEGEND_ENTRY] = disabled();
  }

  if (selection?.kind === "part") {
    const { axisId, partId, part } = selection;
    bindings[APP_MENU_COMMAND_IDS.CHART_EDIT_TEXT] = onEditChartText
      ? { enabled: true, run: () => { onEditChartText(partId); } }
      : disabled();
    bindings[APP_MENU_COMMAND_IDS.CHART_REMOVE_PART] = {
      enabled: elements?.[part].enabled ?? true,
      run: () => { dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setAxisElement", axisId, element: part, visible: false } }); }
    };
  } else {
    bindings[APP_MENU_COMMAND_IDS.CHART_EDIT_TEXT] = disabled();
    bindings[APP_MENU_COMMAND_IDS.CHART_REMOVE_PART] = disabled();
  }
  return bindings;
}

/**
 * Bring Forward / Send Backward for one selected plot: the reorder action's own
 * answer (refused at either end, or across an axis scope), with its reason.
 */
export function plotReorderAvailability(
  source: string,
  selectedElementIds: ReadonlySet<string>,
  direction: "bringForward" | "sendBackward",
  parseOptions: EditParseOptions
): { enabled: boolean; reason?: string } | null {
  const selection = resolveChartSelection(selectedElementIds);
  if (selection?.kind !== "plot") return null;
  const result = applyReorderPlotsAction(source, [selection.plotId], direction, parseOptions);
  return result.kind === "unsupported" ? { enabled: false, reason: result.reason } : { enabled: true };
}

/** The owning axis of the single selected id, if any. */
export function selectedAxisId(selectedElementIds: ReadonlySet<string>): string | null {
  if (selectedElementIds.size !== 1) return null;
  const [id = ""] = selectedElementIds;
  return owningAxisId(id);
}
