import { RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine, RiMoreLine } from "@remixicon/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  beamerBuildSpecPatch,
  beamerBuildBoundaryPatch,
  beamerBuildRange,
  beamerBuildTimingPatch,
  canEditBeamerBuildTiming,
  beamerBuildStateAt,
  buildBeamerBuildModel,
  firstVisibleBeamerBuildStep,
  isExplicitBeamerBuildSpec,
  reconcileBeamerBuildRow,
  type BeamerBuildModel,
  type BeamerBuildRow,
  type BeamerBuildBoundary,
} from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { useEditorStore } from "../../store/store";
import { rootKey } from "../../root-key";
import { getDockLayoutHandle } from "../DockLayout";
import { SidePanel } from "../SidePanel";
import inspector from "../inspector-panel/InspectorPanel.module.css";
import objects from "../objects-panel/ObjectsPanel.module.css";
import css from "./BuildsPanel.module.css";
import { BuildTimingMenu, type BuildTimingMenuAnchor } from "./BuildTimingMenu";
import { useBuildBoundaryDrag } from "./useBuildBoundaryDrag";

const PAGE_SIZE = 4;

export function BuildsPanel() {
  const source = useEditorStore((s) => s.source);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const frameId = useEditorStore((s) => s.activeRootId);
  const activeSelection = useEditorStore((s) => s.deckBuildSelection);
  const requestedStep = useEditorStore((s) => s.deckStepByRootKey[rootKey(s.activeDocumentId, s.activeRootId)] ?? 1);
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null || s.activeCanvasTextEditSourceId != null);
  const dispatch = useEditorStore((s) => s.dispatch);
  const model = useMemo(() => frameId ? buildBeamerBuildModel(source, frameId) : null, [frameId, source]);
  const [selection, setSelection] = useState<{ documentId: string; model: BeamerBuildModel; rowId: string } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const { drag, begin: beginBoundaryDrag } = useBuildBoundaryDrag();
  const tableRef = useRef<HTMLTableElement>(null);
  const focusBoundary = useRef<{ rowId: string; boundary: BeamerBuildBoundary } | null>(null);
  const [menu, setMenu] = useState<{ rowId: string; step: number; documentId: string; frameId: string; revision: number; anchor: BuildTimingMenuAnchor } | null>(null);
  const closeMenu = useCallback(() => { setMenu(null); }, []);
  const selected = model && activeSelection?.documentId === documentId && activeSelection.frameId === frameId
    ? activeSelection.sourceRevision === sourceRevision
      ? model.rows.find((row) => row.id === activeSelection.rowId) ?? null
      : activeSelection.rowId === selection?.rowId && selection.documentId === documentId
        ? reconcileBeamerBuildRow(selection.model, selection.rowId, model) : null
    : null;
  const step = Math.min(requestedStep, model?.stepCount ?? 1);
  const page = Math.min(pageOverride ?? Math.floor((step - 1) / PAGE_SIZE), Math.floor(((model?.stepCount ?? 1) - 1) / PAGE_SIZE));
  const steps = drag?.steps ?? Array.from({ length: Math.min(PAGE_SIZE, (model?.stepCount ?? 1) - page * PAGE_SIZE) }, (_, index) => page * PAGE_SIZE + index + 1);

  useEffect(() => {
    setPageOverride(null);
    if (!model || !activeSelection) return;
    const parents = new Set<string>();
    let row = model.rows.find((candidate) => candidate.id === activeSelection.rowId);
    while (row?.parentId) {
      parents.add(row.parentId);
      row = model.rows.find((candidate) => candidate.id === row!.parentId);
    }
    if (parents.size) setCollapsed((current) => new Set([...current].filter((id) => !parents.has(id))));
    // External canvas selection should reveal its row, including collapsed owners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelection?.rowId]);

  useEffect(() => {
    const target = focusBoundary.current;
    if (!target) return;
    const button = Array.from(tableRef.current?.querySelectorAll<HTMLButtonElement>("button[data-boundary]") ?? [])
      .find((element) => element.dataset.rowId === target.rowId && element.dataset.boundary === target.boundary);
    button?.focus();
    focusBoundary.current = null;
  }, [page, sourceRevision]);

  const publishSelection = useCallback((row: BeamerBuildRow, revealSource = false) => {
    if (!model) return;
    dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: {
      documentId, frameId: model.frameId, sourceRevision, rowId: row.id,
      step,
      sourceSpan: revealSource ? row.ruleSpan : row.sourceSpan,
      contentSpans: beamerBuildStateAt(model, row, step).contentSpans,
      revealSource,
    } });
  }, [dispatch, documentId, model, sourceRevision, step]);

  useEffect(() => {
    if (selected && selection?.model !== model) setSelection({ documentId, model: model!, rowId: selected.id });
    if (selected) {
      if (activeSelection?.sourceRevision !== sourceRevision || activeSelection.rowId !== selected.id || activeSelection.step !== step) publishSelection(selected);
    } else dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: null });
  }, [activeSelection, dispatch, documentId, model, publishSelection, selected, selection?.model, sourceRevision, step]);

  useEffect(() => () => { dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: null }); }, [dispatch]);

  const select = (row: BeamerBuildRow) => {
    if (!model) return;
    setSelection({ documentId, model, rowId: row.id });
    publishSelection(row);
  };
  const preview = (next: number) => {
    if (!model) return;
    setPageOverride(null);
    dispatch({ type: "SET_DECK_STEP", rootId: model.frameId, step: next });
  };
  const reveal = (row: BeamerBuildRow) => {
    if (!model) return;
    setSelection({ documentId, model, rowId: row.id });
    const layout = getDockLayoutHandle();
    if (layout && !layout.getModel().getNodeById("source")) layout.togglePanel("source");
    publishSelection(row, true);
  };
  const applyPatch = (patch: SourcePatch | null) => {
    if (patch && !locked && !drag) dispatch({ type: "APPLY_SOURCE_PATCHES", documentId, baseRevision: sourceRevision, patches: [patch], changedSourceIds: [] });
  };
  const canSetTiming = (row: BeamerBuildRow) => !!model && !locked && !drag && canEditBeamerBuildTiming(row) &&
    (row.kind === "list" || beamerBuildStateAt(model, row, step).visibility !== "unknown");
  const openTimingMenu = (row: BeamerBuildRow, value: number, trigger: HTMLElement, x?: number, y?: number) => {
    if (!model || !canSetTiming(row)) return;
    select(row);
    const bounds = trigger.getBoundingClientRect();
    setMenu({ rowId: row.id, step: value, documentId, frameId: model.frameId, revision: sourceRevision,
      anchor: { trigger, x: x ?? bounds.left, y: y ?? bounds.bottom } });
  };
  const rowById = new Map(model?.rows.map((row) => [row.id, row]));
  const ancestors = (row: BeamerBuildRow): BeamerBuildRow[] => {
    const result: BeamerBuildRow[] = [];
    let parent = row.parentId ? rowById.get(row.parentId) : null;
    while (parent) { result.push(parent); parent = parent.parentId ? rowById.get(parent.parentId) : null; }
    return result;
  };
  const firstVisible = selected && model ? firstVisibleBeamerBuildStep(model, selected) : null;
  const hasTimeline = model?.rows.some((row) => row.kind !== "list" &&
    steps.every((value) => beamerBuildStateAt(model, row, value).visibility !== "unknown"));
  const openMenu = model && menu && !locked && !drag && menu.documentId === documentId && menu.frameId === frameId && menu.revision === sourceRevision ? menu : null;

  return (
    <SidePanel className={inspector.panel}>
      <SidePanel.Header>
        Overlays
        {model && model.stepCount > PAGE_SIZE ? <div className={inspector.multiArrangeGroup}>
          <button type="button" className={inspector.multiArrangeIconButton} aria-label="Earlier overlay steps" title="Earlier overlay steps" disabled={page === 0} onClick={() => { setPageOverride(page - 1); }}><RiArrowLeftSLine size={14} /></button>
          <button type="button" className={inspector.multiArrangeIconButton} aria-label="Later overlay steps" title="Later overlay steps" disabled={(page + 1) * PAGE_SIZE >= model.stepCount} onClick={() => { setPageOverride(page + 1); }}><RiArrowRightSLine size={14} /></button>
        </div> : null}
      </SidePanel.Header>
      <SidePanel.Content className={css.content}>
        {!model ? <p className={inspector.hint}>Select a slide to view its overlays.</p>
          : model.rows.length === 0 ? <p className={inspector.hint}>No overlays on this slide.</p>
            : <>
              <table ref={tableRef} className={css.timeline} aria-label="Slide overlays">
                <thead><tr><th scope="col">Content</th>{hasTimeline ? steps.map((value) => <th scope="col" key={value}>
                  <button type="button" aria-label={`Preview step ${value}`} aria-pressed={step === value} onClick={() => { preview(value); }}>{value}</button>
                </th>) : <th scope="col" colSpan={steps.length} />}</tr></thead>
                <tbody>{model.rows.filter((row) => !ancestors(row).some((parent) => collapsed.has(parent.id))).map((row) => {
                  const parents = ancestors(row);
                  const expandable = model.rows.some((child) => child.parentId === row.id);
                  const cells = steps.map((value) => beamerBuildStateAt(model, row, value));
                  const sourceOnly = row.kind !== "list" && cells.some((cell) => cell.visibility === "unknown");
                  const range = selected?.id === row.id && !locked ? beamerBuildRange(row) : null;
                  return <tr key={row.id} data-testid="build-row" data-build-id={row.id} data-selected={selected?.id === row.id}>
                    <th scope="row"><div className={css.rowLabel} style={{ paddingLeft: Math.min(parents.length, 5) * 10 }}>
                      {expandable ? <button type="button" className={`${objects.iconButton} ${css.disclosure}`} aria-label={`${collapsed.has(row.id) ? "Expand" : "Collapse"} ${row.label}`} aria-expanded={!collapsed.has(row.id)} onClick={() => {
                        setCollapsed((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
                      }}>{collapsed.has(row.id) ? <RiArrowRightSLine size={14} /> : <RiArrowDownSLine size={14} />}</button> : null}
                      <button type="button" className={`${objects.titleButton} ${css.label}`} title={`${row.label}\nLine ${source.slice(0, row.sourceSpan.from).split("\n").length}`} aria-pressed={selected?.id === row.id} onClick={() => { select(row); }}>
                        <span className={objects.title}>{row.label}</span>
                      </button>
                    </div></th>
                    {row.kind === "list" ? <td colSpan={steps.length} /> : sourceOnly ? <td colSpan={steps.length}>
                      <button type="button" className={inspector.moreOptionsToggle} onClick={() => { reveal(row); }}>Edit in source</button>
                    </td> : steps.map((value, index) => {
                      const cell = cells[index];
                      return <td key={value} data-state={cell.visibility} title={`Step ${value}: ${cell.label}`}>
                        <button type="button" aria-label={`${row.label}, step ${value}: ${cell.label}`} onClick={() => { select(row); preview(value); }}
                          onContextMenu={(event) => {
                            if (!canSetTiming(row)) return;
                            event.preventDefault();
                            openTimingMenu(row, value, event.currentTarget, event.clientX, event.clientY);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                              event.preventDefault(); openTimingMenu(row, value, event.currentTarget);
                            }
                          }}>
                          {cell.visibility === "visible" ? "●" : cell.visibility === "hidden" ? "○" : "—"}
                        </button>
                        {range ? (["start", "end"] as const).filter((boundary) => (boundary === "start" ? range.from : range.to) === value).map((boundary) =>
                          <button key={boundary} type="button" className={css.boundary} data-boundary={boundary} data-row-id={row.id}
                            aria-label={`${boundary === "start" ? "Start" : "End"} step for ${row.label}`}
                            title={`${boundary === "start" ? "Start" : "End"} step ${value} · Drag or use arrow keys`}
                            onPointerDown={(event) => { beginBoundaryDrag(event, model, row, boundary, steps); }}
                            onClick={(event) => { event.stopPropagation(); }}
                            onKeyDown={(event) => {
                              if (drag || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                              event.preventDefault(); event.stopPropagation();
                              const next = Math.max(1, value + (event.key === "ArrowRight" ? 1 : -1));
                              const patch = beamerBuildBoundaryPatch(model, row.id, boundary, next);
                              if (!patch) return;
                              focusBoundary.current = { rowId: row.id, boundary };
                              setPageOverride(Math.floor((next - 1) / PAGE_SIZE));
                              applyPatch(patch);
                            }} />
                        ) : null}
                      </td>;
                    })}
                  </tr>;
                })}</tbody>
              </table>
              {hasTimeline ? <div className={css.legend}><span>● Visible</span><span title="Hidden, with its space retained">○ Covered</span><span>— Absent</span></div> : null}
            </>}
      </SidePanel.Content>
      {model && selected ? <SidePanel.Footer className={css.details}>
        <section aria-label="Overlay rule">
          <SidePanel.SectionHeader>
            <span className={css.detailTitle} title={selected.label}>{selected.label}</span>
            {canSetTiming(selected) ? <button type="button" className={objects.iconButton} aria-label="Timing actions" title="Timing actions" aria-haspopup="menu" aria-expanded={openMenu != null}
              onClick={(event) => { openTimingMenu(selected, step, event.currentTarget); }}><RiMoreLine size={14} /></button> : null}
          </SidePanel.SectionHeader>
          <SidePanel.SectionBody>
          {selected.editable && selected.spec ? <BuildRuleEditor key={`${selected.id}:${selected.spec.source.value}:${sourceRevision}`} value={selected.spec.source.value} disabled={locked || drag != null} onApply={(value) => {
            const patch = beamerBuildSpecPatch(model, selected.id, value);
            applyPatch(patch);
          }} /> : selected.spec ? <div className={inspector.property}>
            <span className={inspector.propertyLabel}>Steps</span>
            <output className={css.value} aria-label="Overlay steps">{selected.provenance === "list-default" ? selected.spec.resolved : selected.spec.source.value}</output>
          </div> : null}
          {ancestors(selected).map((parent) => <div key={parent.id} className={inspector.property}>
            <span className={inspector.propertyLabel}>{parent.kind === "list" ? "List default" : "Within"}</span>
            <button type="button" className={`${inspector.moreOptionsToggle} ${css.owner}`} onClick={() => { select(parent); }}>{parent.label}</button>
          </div>)}
          <div className={css.actions}>
            <button type="button" className={inspector.moreOptionsToggle} onClick={() => { reveal(selected); }}>Edit in source</button>
            {firstVisible != null && !steps.includes(firstVisible) ? <button type="button" className={inspector.moreOptionsToggle} onClick={() => { preview(firstVisible); }}>Go to step {firstVisible}</button> : null}
          </div>
          </SidePanel.SectionBody>
        </section>
      </SidePanel.Footer> : null}
      {model && openMenu ? <BuildTimingMenu anchor={openMenu.anchor} step={openMenu.step} onClose={closeMenu}
        onApply={(action) => { applyPatch(beamerBuildTimingPatch(model, openMenu.rowId, action, openMenu.step)); }} /> : null}
    </SidePanel>
  );
}

function BuildRuleEditor({ value, disabled, onApply }: { value: string; disabled: boolean; onApply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const errorId = useId();
  const skipBlur = useRef(false);
  const valid = isExplicitBeamerBuildSpec(draft);
  const commit = () => {
    if (valid && !disabled && draft.trim() !== value) onApply(draft);
  };
  return <div className={inspector.property}>
    <label className={inspector.propertyLabel} htmlFor={`${errorId}-input`}>Steps</label>
    <input id={`${errorId}-input`} className={inspector.textInput} aria-label="Overlay steps" value={draft} disabled={disabled} aria-invalid={!valid} aria-describedby={!valid ? errorId : undefined} spellCheck={false} placeholder="2-, 1,3, or 2-4"
      onChange={(event) => { setDraft(event.target.value); }}
      onBlur={() => { if (!skipBlur.current) commit(); skipBlur.current = false; }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && valid) {
          event.preventDefault();
          skipBlur.current = true;
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          skipBlur.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
    {!valid ? <span id={errorId} className={css.error} role="alert">Use steps or ranges, such as 2-, 1,3, or 2-4.</span> : null}
  </div>;
}
