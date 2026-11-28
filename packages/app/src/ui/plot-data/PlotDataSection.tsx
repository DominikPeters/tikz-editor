import { useMemo, type JSX } from "react";
import { readPlotDataGrid } from "@tikz-editor/core/edit/pgfplots/plot-data";
import { SidePanel } from "../SidePanel";
import css from "../inspector-panel/InspectorPanel.module.css";

/**
 * The plot inspector's data table row: how many points or rows the plot has
 * and the Edit Data… button that opens the grid. Expression plots have none.
 */
export function PlotDataSection(props: { plotId: string; source: string; onOpen: (plotId: string) => void }): JSX.Element | null {
  const { plotId, source, onOpen } = props;
  const grid = useMemo(() => readPlotDataGrid(source, plotId), [plotId, source]);
  if (grid.kind === "none") return null;
  const summary = grid.kind === "readonly"
    ? "Read-only"
    : `${String(grid.rows.length)} ${grid.kind === "coordinates" ? (grid.rows.length === 1 ? "point" : "points") : grid.rows.length === 1 ? "row" : "rows"}`;
  return (
    <SidePanel.Section collapseId="inspector:plot-data">
      <SidePanel.SectionHeader>Data table</SidePanel.SectionHeader>
      <SidePanel.SectionBody>
        <div className={css.property}>
          <span className={css.propertyLabel}>{summary}</span>
          <button type="button" className={css.deckCommandButton} onClick={() => { onOpen(plotId); }}>Edit Data…</button>
        </div>
      </SidePanel.SectionBody>
    </SidePanel.Section>
  );
}
