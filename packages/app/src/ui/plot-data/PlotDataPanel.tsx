import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { applyEditPlotDataAction, readPlotDataGrid, type PlotDataChange } from "@tikz-editor/core/edit/pgfplots/plot-data";
import { owningAxisId } from "@tikz-editor/core/pgfplots/edit-ids";
import { useEditorStore } from "../../store/store";
import { CustomDropdown } from "../CustomDropdown";
import { Modal } from "../Modal";
import css from "./PlotDataPanel.module.css";

/**
 * Edit Data…: the data of one plot as a grid (core plot-data.ts). A floating
 * panel like the other tool panels (Repeat, Equation): it does not block the
 * canvas, and every committed change is one edit action, so one undo step.
 *
 * Keys follow a spreadsheet: arrows move, Enter or typing edits, Enter/Tab
 * commit and move on, Escape cancels the cell edit (and closes the panel when
 * no cell is being edited); a pasted block of tab-, comma- or
 * newline-separated values is one change. Rows are drawn only while they are
 * in view, so a 20,000-row table opens and scrolls without delay.
 */
const ROW_HEIGHT = 22;
const OVERSCAN = 8;

type Active = { row: number; column: number };

/** Clipboard text as rows of cells: tabs (a spreadsheet), else commas, else blanks. */
export function parsePastedBlock(text: string): string[][] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();
  return lines.map((line) => {
    if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
    if (line.includes(",")) return line.split(",").map((cell) => cell.trim());
    return line.trim().split(/\s+/u);
  });
}

export function PlotDataPanel(props: { plotId: string; onClose: () => void }): JSX.Element {
  const source = useEditorStore((s) => s.source);
  const dispatch = useEditorStore((s) => s.dispatch);
  const [plotId, setPlotId] = useState(props.plotId);
  useEffect(() => { setPlotId(props.plotId); }, [props.plotId]);
  const grid = useMemo(() => readPlotDataGrid(source, plotId), [plotId, source]);
  const [active, setActive] = useState<Active>({ row: 0, column: 0 });
  const [draft, setDraftState] = useState<string | null>(null);
  // The draft as of now: an editor removed after Enter or Escape still fires its blur, which must not commit again.
  const draftRef = useRef<string | null>(null);
  const setDraft = useCallback((next: string | null) => { draftRef.current = next; setDraftState(next); }, []);
  const [message, setMessage] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(300);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);

  const plots = useMemo(() => {
    const axisId = owningAxisId(plotId);
    const parsed = useEditorStore.getState().snapshot.parseResult;
    const axis = parsed?.figure.body.find((statement) => statement.kind === "Axis" && statement.id === axisId);
    if (axis?.kind !== "Axis") return [{ value: plotId, label: "Plot" }];
    return axis.body.flatMap((item) => (item.kind === "AddPlot" ? [{ value: item.id, label: `Plot ${String(item.plotIndex + 1)} (${item.input.kind === "table" ? "table" : item.input.kind})` }] : []));
    // The parse result follows `source`; re-read when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotId, source]);

  const rows = grid.kind === "coordinates" || grid.kind === "table" || grid.kind === "readonly" ? grid.rows : [];
  const columns = grid.kind === "coordinates" || grid.kind === "table" || grid.kind === "readonly" ? grid.columns : [];
  const editable = grid.kind === "coordinates" || grid.kind === "table";
  const headerEditable = grid.kind === "table" && grid.headerEditable;
  const firstRow = headerEditable ? -1 : 0;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setViewHeight(element.clientHeight);
    const observer = new ResizeObserver(() => { setViewHeight(element.clientHeight); });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [grid.kind]);

  /** Keeps the active cell in view (virtualised rows). */
  const reveal = useCallback((row: number) => {
    const element = scrollRef.current;
    if (!element || row < 0) return;
    const top = row * ROW_HEIGHT;
    const headerHeight = ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight - headerHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight + headerHeight;
  }, []);

  const apply = useCallback((change: PlotDataChange): boolean => {
    const result = applyEditPlotDataAction(source, plotId, change);
    if (result.kind !== "success" && result.kind !== "partial") {
      setMessage(result.kind === "unsupported" ? result.reason : "The change could not be made.");
      return false;
    }
    setMessage(null);
    dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "editPlotData", plotId, change } });
    return true;
  }, [dispatch, plotId, source]);

  const valueAt = (cell: Active): string => (cell.row < 0 ? columns[cell.column]?.label ?? "" : rows[cell.row]?.[cell.column] ?? "");

  const move = useCallback((rowDelta: number, columnDelta: number) => {
    setActive((current) => {
      const row = Math.max(firstRow, Math.min(rows.length - 1, current.row + rowDelta));
      const column = Math.max(0, Math.min(columns.length - 1, current.column + columnDelta));
      reveal(row);
      return { row, column };
    });
  }, [columns.length, firstRow, reveal, rows.length]);

  const focusGrid = () => { scrollRef.current?.focus({ preventScroll: true }); };

  const commit = (then?: [number, number]) => {
    const value = draftRef.current;
    if (value === null) return;
    const before = valueAt(active);
    setDraft(null);
    if (value !== before) {
      apply(active.row < 0 ? { type: "renameColumn", column: active.column, name: value } : { type: "set", row: active.row, column: active.column, value });
    }
    if (then) move(then[0], then[1]);
    focusGrid();
  };

  const startEditing = (initial?: string) => {
    if (!editable) return;
    if (active.row < 0 && !headerEditable) return;
    if (!columns[active.column]?.editable) return;
    setDraft(initial ?? valueAt(active));
  };

  useEffect(() => {
    if (draft !== null) {
      editorRef.current?.focus();
      if (editorRef.current && draft === valueAt(active)) editorRef.current.select();
    }
    // Focus the editor when an edit starts, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft !== null]);

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (draft !== null || event.target !== event.currentTarget) return;
    const key = event.key;
    let handled = true;
    if (key === "ArrowDown") move(1, 0);
    else if (key === "ArrowUp") move(-1, 0);
    else if (key === "ArrowLeft") move(0, -1);
    else if (key === "ArrowRight") move(0, 1);
    else if (key === "Tab") move(0, event.shiftKey ? -1 : 1);
    else if (key === "Enter" || key === "F2") startEditing();
    else if (key === "Escape") props.onClose();
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) startEditing(key);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); commit([event.shiftKey ? -1 : 1, 0]); }
    else if (event.key === "Tab") { event.preventDefault(); commit([0, event.shiftKey ? -1 : 1]); }
    else if (event.key === "Escape") { event.preventDefault(); setDraft(null); focusGrid(); }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (draft !== null || !editable || active.row < 0) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const values = parsePastedBlock(text);
    if (values.length === 1 && values[0]?.length === 1) apply({ type: "set", row: active.row, column: active.column, value: values[0][0] ?? "" });
    else apply({ type: "paste", row: active.row, column: active.column, values });
  };

  const insertRow = () => { if (apply({ type: "insertRow", at: Math.max(0, active.row) + 1 })) { move(1, 0); } focusGrid(); };
  const deleteRow = () => { if (active.row >= 0 && apply({ type: "deleteRows", rows: [active.row] })) setActive((current) => ({ ...current, row: Math.max(0, Math.min(current.row, rows.length - 2)) })); focusGrid(); };

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
  const note = grid.kind === "table" ? grid.note : grid.kind === "readonly" || grid.kind === "none" ? grid.reason : undefined;

  const cellClass = (row: number, column: number) => [css.cell, row === active.row && column === active.column ? css.cellActive : ""].filter(Boolean).join(" ");
  const renderCell = (row: number, column: number, text: string) => {
    const isActive = row === active.row && column === active.column;
    return (
      <div key={column} role="gridcell" aria-selected={isActive} data-row={row} data-column={column} className={cellClass(row, column)}
        onMouseDown={(event) => { if (draft !== null && !isActive) commit(); setActive({ row, column }); if (!isActive) { event.preventDefault(); focusGrid(); } }}
        onDoubleClick={() => { startEditing(); }}>
        {isActive && draft !== null ? (
          <input ref={editorRef} className={css.cellEditor} value={draft} aria-label={`${row < 0 ? "Column name" : columns[column]?.label ?? ""} ${row < 0 ? "" : String(row + 1)}`.trim()} spellCheck={false}
            onChange={(event) => { setDraft(event.target.value); }} onKeyDown={onEditorKeyDown} onBlur={() => { commit(); }} />
        ) : <span className={css.cellText}>{text}</span>}
      </div>
    );
  };
  const template = `${String(40)}px repeat(${String(Math.max(1, columns.length))}, minmax(72px, 1fr))`;

  return (
    <Modal variant="panel" onClose={props.onClose} labelledBy="plot-data-title" dataTestId="plot-data-panel" draggable resizable closeOnEscape={false} initialWidth={380} initialHeight={420} className={css.panel ?? ""}>
      <Modal.Header title="Data" titleId="plot-data-title" draggable showCloseButton onClose={props.onClose} closeAriaLabel="Close data panel"
        trailing={plots.length > 1 ? (
          <div className={css.plotPicker}>
            <CustomDropdown ariaLabel="Plot" value={plotId} options={plots} onChange={(next) => { setPlotId(next); setActive({ row: 0, column: 0 }); setDraft(null); dispatch({ type: "SELECT", id: next, additive: false }); }} />
          </div>
        ) : undefined} />
      <Modal.Body padding="none" scroll={false} className={css.body ?? ""}>
        {note ? <div className={grid.kind === "table" ? css.note : css.notice}>{note}</div> : null}
        {columns.length > 0 ? (
          <div ref={scrollRef} className={css.scroll} role="grid" aria-label="Plot data" aria-rowcount={rows.length + 1} tabIndex={0}
            onKeyDown={onGridKeyDown} onPaste={onPaste} onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); }}>
            <div className={css.headerRow} role="row" style={{ gridTemplateColumns: template }}>
              <div className={css.rowNumber} />
              {columns.map((column, index) => (headerEditable ? renderCell(-1, index, column.label) : <div key={column.id} role="columnheader" className={css.columnHeader}>{column.label}</div>))}
            </div>
            <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
              {rows.slice(start, end).map((cells, offset) => {
                const row = start + offset;
                return (
                  <div key={row} role="row" className={css.row} style={{ top: row * ROW_HEIGHT, gridTemplateColumns: template }}>
                    <div className={css.rowNumber}>{row + 1}</div>
                    {cells.map((text, column) => renderCell(row, column, text))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer align="between">
        <span className={message ? css.error : css.status} role={message ? "alert" : undefined}>
          {message ?? (columns.length > 0 ? `${String(rows.length)} row${rows.length === 1 ? "" : "s"}` : "")}
        </span>
        {editable ? (
          <span className={css.actions}>
            <Modal.SecondaryButton onClick={insertRow}>Add Row</Modal.SecondaryButton>
            <Modal.SecondaryButton onClick={deleteRow} disabled={active.row < 0 || rows.length <= 1}>Delete Row</Modal.SecondaryButton>
          </span>
        ) : null}
      </Modal.Footer>
    </Modal>
  );
}
